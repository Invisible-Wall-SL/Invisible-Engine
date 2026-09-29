#!/usr/bin/env python3
"""Nightly backups of the launcher Postgres and the authored R2 sources, and their restores.

Design, owner setup and the restore runbooks: docs/guides/backups.md.

Every archive is encrypted with `age` to PUBLIC-key recipients before it leaves the machine, so the
job that writes backups can never read one back; only the owner's offline identity decrypts. In
GitHub Actions the job prints counts, sizes and table/prefix classes only - never object keys,
rows, connection strings, secrets or raw error text - because this repository's logs are public.

    iwbackup.py plan                       what tonight's R2 selection would hold (counts only)
    iwbackup.py backup [--only pg|r2]      the nightly job (--local-dir DIR skips the backup bucket)
    iwbackup.py list [--prefix P]          backups in the backup bucket
    iwbackup.py fetch KEY|latest:<prefix>  download one backup, verifying its sha256
    iwbackup.py restore-pg ARCHIVE ...     decrypt + pg_restore into a target database
    iwbackup.py restore-r2 ARCHIVE ...     decrypt + verify + extract and/or re-upload
"""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import io
import ipaddress
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import traceback
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

FORMAT_VERSION = 1

# Retention the backup bucket's lifecycle rules are expected to enforce (days). The job only WARNS
# when it sees older objects - deleting is the lifecycle rule's job, so the job's token never needs
# to delete, and a bucket lock can forbid it outright.
RETENTION_DAYS = {'postgres/': 35, 'r2-docs/': 90, 'r2-assets/': 14}

# The live authored bucket, as a constant so no environment variable can switch the guard off.
PRODUCTION_BUCKET = 'invisibleassets'
RAILWAY_HOST_SUFFIXES = ('.rlwy.net', '.railway.internal', '.railway.app')

# The R2 selection is include-by-default: a prefix nobody has classified yet is backed up, not lost.
EXCLUDED_ROOTS = (
	'comfyui-models/',  # third-party model weights, re-downloadable (~177 GB)
	'comfyui-nodes/',
	'tools/',  # desktop-launcher release artifacts, rebuilt by CI
	'test_server/',  # built game bundles + runtime releases, rebuilt from git
	'_shared/storybook/',  # a Storybook build
)
INCLUDED_KEYS = ('test_server/games.json',)
# `<client>/<project>/<dir>/…` subtrees that are OUTPUTS of the pipeline, not authored input.
DERIVED_PROJECT_DIRS = {'published', 'deploy', 'batch', 'video'}
DOC_SUFFIXES = {
	'.json', '.irig', '.atlas', '.xml', '.ts', '.ini', '.txt', '.md', '.csv', '.fnt', '.yaml', '.yml', '',
}
FETCH_WORKERS = 16
FETCH_WINDOW_BYTES = 512 << 20

IN_ACTIONS = os.environ.get('GITHUB_ACTIONS') == 'true'


class Failure(Exception):
	"""A failure whose message is safe to print in a public log."""


def log(msg: str) -> None:
	print(msg, flush=True)


def fail(msg: str) -> None:
	raise Failure(msg)


def warn(msg: str) -> None:
	log(f'::warning::{msg}' if IN_ACTIONS else f'WARNING: {msg}')


def report_error(msg: str) -> None:
	log(f'::error::{msg}' if IN_ACTIONS else f'ERROR: {msg}')


def report_exception(e: BaseException) -> None:
	"""Library errors carry request URLs (object keys), resolved IPs and row values; in Actions
	only the exception type is printed. Locally the operator gets the full traceback."""
	if isinstance(e, Failure):
		report_error(str(e))
	elif IN_ACTIONS:
		report_error(f'{type(e).__name__} (detail withheld from the public log; re-run locally for it)')
	else:
		traceback.print_exception(e)


def mask(*values: str | None) -> None:
	"""Actions masks a secret only as a WHOLE string; a password or host printed alone would leak."""
	if IN_ACTIONS:
		for v in values:
			if v:
				print(f'::add-mask::{v}', flush=True)


def env(name: str, default: str | None = None, required: bool = True) -> str:
	v = os.environ.get(name, '').strip() or default
	if required and not v:
		fail(f'{name} is not set')
	return v or ''


def human(n: float) -> str:
	for unit in ('B', 'KB', 'MB', 'GB'):
		if n < 1024 or unit == 'GB':
			return f'{n:.1f} {unit}' if unit != 'B' else f'{int(n)} B'
		n /= 1024
	return f'{n:.1f} GB'


def stamp() -> str:
	return datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')


# ---------------------------------------------------------------- tools on PATH (or overridden)


def tool(name: str) -> str:
	pg_dir = os.environ.get('PG_BIN_DIR')
	if pg_dir and (name.startswith('pg_') or name == 'psql'):
		cand = Path(pg_dir) / (name + ('.exe' if os.name == 'nt' else ''))
		if cand.exists():
			return str(cand)
	if name == 'age' and os.environ.get('AGE_BIN'):
		return os.environ['AGE_BIN']
	found = shutil.which(name)
	if not found:
		fail(f'`{name}` not found on PATH (set PG_BIN_DIR / AGE_BIN to point at it)')
	return found or name


def scrub_tool_error(text: str) -> str:
	"""One line a public log can carry: the first `error:` line, minus quoted values and anything
	after DETAIL/CONTEXT (where pg_restore echoes row data)."""
	line = next((ln for ln in text.splitlines() if 'error:' in ln), text.strip().splitlines()[0] if text.strip() else '')
	line = re.split(r'\b(?:DETAIL|CONTEXT|LINE \d+)\b', line)[0]
	line = re.sub(r'"[^"]*"|\'[^\']*\'|\([^)]*\)', '…', line)
	line = re.sub(r'\b\d{1,3}(?:\.\d{1,3}){3}\b|\[[0-9a-f:]+\]', '…', line)
	return line.strip()[:200]


def run_redacted(cmd: list[str], secrets: list[str], env_extra: dict[str, str]) -> None:
	proc = subprocess.run(cmd, capture_output=True, text=True, env={**os.environ, **env_extra})
	if proc.returncode == 0:
		return
	err = proc.stderr or proc.stdout
	for s in sorted((s for s in secrets if s), key=len, reverse=True):
		err = err.replace(s, '***')
	err = re.sub(r'postgres(?:ql)?://\S+', 'postgres://***', err)
	detail = scrub_tool_error(err) if IN_ACTIONS else err.strip()
	fail(f'{Path(cmd[0]).stem} exited {proc.returncode}: {detail}')


# ---------------------------------------------------------------- age


def age_recipients() -> list[str]:
	recips = env('BACKUP_AGE_RECIPIENTS').split()
	for r in recips:
		if not re.fullmatch(r'age1[0-9a-z]{58}', r):
			fail('BACKUP_AGE_RECIPIENTS must hold age public keys (age1…) separated by spaces')
	return recips


def age_encrypt_proc(out: Path) -> subprocess.Popen:
	args = [tool('age'), '--encrypt']
	for r in age_recipients():
		args += ['--recipient', r]
	return subprocess.Popen(args + ['--output', str(out)], stdin=subprocess.PIPE)


def age_decrypt(archive: Path, identity: Path, out: Path) -> None:
	proc = subprocess.run(
		[tool('age'), '--decrypt', '--identity', str(identity), '--output', str(out), str(archive)],
		capture_output=True,
		text=True,
	)
	if proc.returncode != 0:
		fail(f'age could not decrypt the archive: {proc.stderr.strip()}')


# ---------------------------------------------------------------- S3 (R2) clients


def s3_client(endpoint: str, key_id: str, secret: str):
	import boto3
	from botocore.config import Config

	mask(key_id, secret)
	return boto3.client(
		's3',
		endpoint_url=endpoint,
		aws_access_key_id=key_id,
		aws_secret_access_key=secret,
		region_name='auto',
		config=Config(
			retries={'max_attempts': 10, 'mode': 'standard'},
			max_pool_connections=32,
			# R2 rejects the CRC checksums newer botocore sends by default.
			request_checksum_calculation='when_required',
			response_checksum_validation='when_required',
		),
	)


def source_s3():
	return s3_client(
		env('BACKUP_SRC_R2_ENDPOINT'),
		env('BACKUP_SRC_R2_ACCESS_KEY_ID'),
		env('BACKUP_SRC_R2_SECRET_ACCESS_KEY'),
	), env('BACKUP_SRC_R2_BUCKET', PRODUCTION_BUCKET)


def backup_s3():
	return s3_client(
		env('BACKUP_R2_ENDPOINT', os.environ.get('BACKUP_SRC_R2_ENDPOINT')),
		env('BACKUP_R2_ACCESS_KEY_ID'),
		env('BACKUP_R2_SECRET_ACCESS_KEY'),
	), env('BACKUP_R2_BUCKET', 'invisible-backups')


def list_objects(s3, bucket: str, prefix: str = '') -> list[dict]:
	out: list[dict] = []
	for page in s3.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix=prefix):
		out.extend(page.get('Contents', []))
	return out


def sha256_file(path: Path) -> str:
	h = hashlib.sha256()
	with path.open('rb') as f:
		for chunk in iter(lambda: f.read(1 << 20), b''):
			h.update(chunk)
	return h.hexdigest()


class Sink:
	"""Where finished archives go: the backup bucket, or a local directory (drills, no bucket yet)."""

	def __init__(self, local_dir: str | None):
		self.local = Path(local_dir) if local_dir else None
		if self.local:
			self.local.mkdir(parents=True, exist_ok=True)
		else:
			self.s3, self.bucket = backup_s3()

	def put(self, key: str, path: Path, meta: dict[str, str]) -> None:
		digest = sha256_file(path)
		size = path.stat().st_size
		meta = {**meta, 'sha256': digest, 'format': str(FORMAT_VERSION)}
		if self.local:
			dest = self.local / key
			dest.parent.mkdir(parents=True, exist_ok=True)
			shutil.copyfile(path, dest)
			dest.with_name(dest.name + '.meta.json').write_text(json.dumps(meta, indent=1))
			log(f'  wrote {key} ({human(size)}) to the local sink')
			return
		self.s3.upload_file(str(path), self.bucket, key, ExtraArgs={'Metadata': meta})
		head = self.s3.head_object(Bucket=self.bucket, Key=key)
		if head['ContentLength'] != size:
			fail(f'{key}: the uploaded object is {head["ContentLength"]} bytes, the archive {size}')
		# The sha256 rides along as metadata; `fetch` checks the downloaded bytes against it.
		log(f'  uploaded {key} ({human(size)}), size verified')

	def retention_report(self) -> None:
		if self.local:
			return
		now = datetime.now(timezone.utc)
		for prefix, days in RETENTION_DAYS.items():
			objs = list_objects(self.s3, self.bucket, prefix)
			if not objs:
				continue
			oldest = min(o['LastModified'] for o in objs)
			age_days = (now - oldest).days
			log(f'  {prefix:<11} {len(objs):>4} backups, {human(sum(o["Size"] for o in objs))}, oldest {age_days} d')
			if age_days > days + 3:
				warn(f'{prefix} holds a {age_days}-day-old backup; is its {days}-day lifecycle rule set?')


# ---------------------------------------------------------------- Postgres


def pg_params(url: str) -> dict[str, str]:
	"""Parse with libpq's own parser, so `?host=` / `?hostaddr=` overrides are seen exactly as
	pg_dump/pg_restore will see them. A parse error can quote part of the password, so it is
	replaced by a generic message."""
	from psycopg.conninfo import conninfo_to_dict

	try:
		params = {k: str(v) for k, v in conninfo_to_dict(url).items() if v is not None}
	except Exception:
		fail('a database URL could not be parsed (URL-encode any special characters in the password)')
		raise
	if not params.get('host') and not params.get('hostaddr') and not params.get('service'):
		fail('a database URL must name a host')
	return params


def pg_env(params: dict[str, str]) -> tuple[str, dict[str, str]]:
	"""(conninfo without the password, env carrying it) - the password never goes on argv."""
	from psycopg.conninfo import make_conninfo

	rest = {k: v for k, v in params.items() if k != 'password'}
	extra = {'PGCONNECT_TIMEOUT': '20'}
	if params.get('password'):
		extra['PGPASSWORD'] = params['password']
	return make_conninfo(**rest), extra


def pg_connect(url: str):
	import psycopg

	return psycopg.connect(url, connect_timeout=20, autocommit=False)


def table_counts(cur) -> dict[str, int]:
	from psycopg import sql

	cur.execute(
		"select schemaname, tablename from pg_tables "
		"where schemaname not in ('pg_catalog', 'information_schema') "
		"and schemaname not like 'pg\\_temp%' and schemaname not like 'pg\\_toast%' order by 1, 2"
	)
	counts: dict[str, int] = {}
	for schema, table in cur.fetchall():
		cur.execute(sql.SQL('select count(*) from {}.{}').format(sql.Identifier(schema), sql.Identifier(table)))
		counts[f'{schema}.{table}'] = cur.fetchone()[0]
	return counts


def pg_restore_into(dump: Path, url: str, clean: bool) -> None:
	params = pg_params(url)
	conninfo, extra = pg_env(params)
	args = [tool('pg_restore'), '--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction']
	if clean:
		args += ['--clean', '--if-exists']
	run_redacted(args + ['--dbname', conninfo, str(dump)], [url, params.get('password', '')], extra)


def backup_postgres(sink: Sink, when: str, work: Path) -> None:
	url = env('BACKUP_DATABASE_URL')
	mask(url)
	params = pg_params(url)
	mask(*(params.get(k) for k in ('password', 'host', 'hostaddr', 'user', 'port', 'dbname')))
	conninfo, extra = pg_env(params)
	mask(conninfo)
	dump = work / 'launcher.dump'
	log('postgres: dumping (one repeatable-read snapshot for the dump AND the row counts)')
	t0 = time.time()
	from psycopg import IsolationLevel

	with pg_connect(url) as conn:
		conn.isolation_level = IsolationLevel.REPEATABLE_READ
		conn.read_only = True
		with conn.cursor() as cur:
			cur.execute("select pg_export_snapshot(), current_setting('server_version')")
			snapshot, server_version = cur.fetchone()
			run_redacted(
				[
					tool('pg_dump'),
					'--format=custom',
					'--compress=9',
					'--no-owner',
					'--no-privileges',
					f'--snapshot={snapshot}',
					'--dbname',
					conninfo,
					'--file',
					str(dump),
				],
				[url, params.get('password', '')],
				extra,
			)
			counts = table_counts(cur)
		conn.rollback()
	log(f'  dump {human(dump.stat().st_size)} in {time.time() - t0:.0f}s, {len(counts)} tables, server {server_version.split()[0]}')

	check_url = os.environ.get('RESTORE_CHECK_DATABASE_URL', '').strip()
	if check_url:
		if looks_like_production(check_url):
			fail('RESTORE_CHECK_DATABASE_URL points at a production-looking database')
		pg_restore_into(dump, check_url, clean=False)
		with pg_connect(check_url) as conn, conn.cursor() as cur:
			restored = table_counts(cur)
		bad = sorted(t for t in counts if restored.get(t) != counts[t])
		if bad or set(restored) != set(counts):
			fail(f'restore check: row counts differ for {", ".join(bad) or "the table set"}')
		log(f'  restore check: {len(counts)} tables restored into a scratch database, row counts identical')
	else:
		warn("RESTORE_CHECK_DATABASE_URL unset: tonight's dump was not test-restored")

	meta = {
		'format': FORMAT_VERSION,
		'created': when,
		'server_version': server_version,
		'pg_dump': subprocess.run([tool('pg_dump'), '--version'], capture_output=True, text=True).stdout.strip(),
		'tables': counts,
	}
	archive = work / 'postgres.tar.age'
	age = age_encrypt_proc(archive)
	with tarfile.open(fileobj=age.stdin, mode='w|') as tar:
		tar.add(dump, arcname='launcher.dump')
		add_bytes(tar, 'meta.json', json.dumps(meta, indent=1).encode())
	age.stdin.close()
	if age.wait() != 0:
		fail('age failed to encrypt the postgres archive')
	dump.unlink()
	sink.put(f'postgres/{when}.tar.age', archive, {'tables': str(len(counts))})
	archive.unlink()


# ---------------------------------------------------------------- R2 sources


def classify(key: str) -> str | None:
	"""None = not backed up; otherwise which archive the object goes into."""
	if key.endswith('/'):
		return None
	if key in INCLUDED_KEYS:
		return 'docs'
	if key.startswith(EXCLUDED_ROOTS):
		return None
	parts = key.split('/')
	if len(parts) > 3 and not parts[0].startswith('_') and parts[0] != 'editor' and parts[2] in DERIVED_PROJECT_DIRS:
		return None
	return 'docs' if PurePosixPath(key).suffix.lower() in DOC_SUFFIXES else 'assets'


def select_sources(s3, bucket: str) -> dict[str, list[dict]]:
	picked: dict[str, list[dict]] = {'docs': [], 'assets': []}
	for o in list_objects(s3, bucket):
		cls = classify(o['Key'])
		if cls:
			picked[cls].append(o)
	return picked


def cmd_plan(_args) -> None:
	s3, bucket = source_s3()
	for cls, objs in select_sources(s3, bucket).items():
		log(f'{cls:<7} {len(objs):>6} objects  {human(sum(o["Size"] for o in objs))}')


def add_bytes(tar: tarfile.TarFile, name: str, blob: bytes, mtime: float | None = None) -> None:
	info = tarfile.TarInfo(name)
	info.size = len(blob)
	info.mtime = int(mtime if mtime is not None else time.time())
	tar.addfile(info, io.BytesIO(blob))


MANIFEST_HEADER = 'key\tsize\tetag\tlast_modified\tcontent_type\tcache_control'


def write_archive(s3, bucket: str, objs: list[dict], out: Path, gzip: bool) -> tuple[int, int, int]:
	"""Stream every object into one tar piped through age. The bucket is live - autosave rewrites
	docs every few seconds - so each manifest row describes the bytes actually fetched, not the
	earlier listing; an object deleted since the listing is skipped and counted."""
	from botocore.exceptions import BotoCoreError, ClientError

	def fetch(o: dict) -> tuple[dict, dict | None, bytes]:
		for attempt in range(3):
			try:
				r = s3.get_object(Bucket=bucket, Key=o['Key'])
				body = r['Body'].read()
				if len(body) != r['ContentLength']:
					raise OSError('short read')
				return o, r, body
			except ClientError as e:
				if e.response.get('Error', {}).get('Code') in ('NoSuchKey', '404'):
					return o, None, b''
				if attempt == 2:
					raise
			except (OSError, BotoCoreError):
				if attempt == 2:
					raise
			time.sleep(2 ** attempt)
		raise AssertionError('unreachable')

	age = age_encrypt_proc(out)
	rows = [MANIFEST_HEADER]
	n = size = gone = 0
	with tarfile.open(fileobj=age.stdin, mode='w|gz' if gzip else 'w|') as tar:
		with ThreadPoolExecutor(FETCH_WORKERS) as pool:
			pending: dict = {}
			queue = iter(objs)
			nxt = next(queue, None)
			while nxt is not None or pending:
				while nxt is not None and (
					not pending
					or (len(pending) < 256 and sum(pending.values()) + nxt['Size'] <= FETCH_WINDOW_BYTES)
				):
					pending[pool.submit(fetch, nxt)] = nxt['Size']
					nxt = next(queue, None)
				done, _ = wait(pending, return_when=FIRST_COMPLETED)
				for fut in done:
					del pending[fut]
					o, r, body = fut.result()
					if r is None:
						gone += 1
						continue
					modified = r['LastModified']
					add_bytes(tar, o['Key'], body, modified.timestamp())
					rows.append(
						'\t'.join(
							(
								o['Key'],
								str(len(body)),
								r['ETag'].strip('"'),
								modified.isoformat(),
								r.get('ContentType', ''),
								r.get('CacheControl', ''),
							)
						)
					)
					n += 1
					size += len(body)
		add_bytes(tar, '_backup/manifest.tsv', ('\n'.join(rows) + '\n').encode())
	age.stdin.close()
	if age.wait() != 0:
		fail('age failed to encrypt an R2 archive')
	return n, size, gone


def backup_r2(sink: Sink, when: str, work: Path) -> None:
	s3, bucket = source_s3()
	log('r2: selecting authored sources')
	picked = select_sources(s3, bucket)
	for cls, suffix, gz, prefix in (
		('docs', '.tar.gz.age', True, 'r2-docs/'),
		('assets', '.tar.age', False, 'r2-assets/'),
	):
		objs = picked[cls]
		t0 = time.time()
		out = work / f'{cls}{suffix}'
		n, size, gone = write_archive(s3, bucket, objs, out, gz)
		if n + gone != len(objs):
			fail(f'r2 {cls}: archived {n} of {len(objs)} objects')
		note = f' ({gone} deleted while the backup ran)' if gone else ''
		log(f'  {cls}: {n} objects{note}, {human(size)} -> {human(out.stat().st_size)} encrypted in {time.time() - t0:.0f}s')
		sink.put(f'{prefix}{when}{suffix}', out, {'objects': str(n), 'bytes': str(size)})
		out.unlink()


def cmd_backup(args) -> None:
	when = stamp()
	age_recipients()
	sink = Sink(args.local_dir)
	failed: list[str] = []
	with tempfile.TemporaryDirectory(prefix='iwbackup-', dir=args.work_dir) as tmp:
		work = Path(tmp)
		for name, fn in (('pg', backup_postgres), ('r2', backup_r2)):
			if args.only not in (None, name):
				continue
			# One side failing (say, the Railway proxy is down) must not cost the other its night.
			try:
				fn(sink, when, work)
			except Exception as e:
				report_exception(e)
				failed.append(name)
	log('backup store:')
	sink.retention_report()
	if failed:
		fail(f'backup {when} FAILED for: {", ".join(failed)}')
	log(f'backup {when} complete')


# ---------------------------------------------------------------- list / fetch


def cmd_list(args) -> None:
	s3, bucket = backup_s3()
	for o in sorted(list_objects(s3, bucket, args.prefix), key=lambda o: o['Key']):
		log(f'{o["Key"]:<48} {human(o["Size"]):>10}  {o["LastModified"]:%Y-%m-%d %H:%M}Z')


def cmd_fetch(args) -> None:
	s3, bucket = backup_s3()
	key = args.key
	if key.startswith('latest:'):
		prefix = key.split(':', 1)[1].rstrip('/') + '/'
		objs = list_objects(s3, bucket, prefix)
		if not objs:
			fail(f'no backups under {prefix}')
		key = max(objs, key=lambda o: o['Key'])['Key']
	out = Path(args.out) if args.out else Path(PurePosixPath(key).name)
	s3.download_file(bucket, key, str(out))
	want = s3.head_object(Bucket=bucket, Key=key)['Metadata'].get('sha256')
	if want and sha256_file(out) != want:
		fail(f"{out}: sha256 does not match the backup's recorded digest")
	log(f'fetched {key} -> {out} ({human(out.stat().st_size)}), sha256 {"verified" if want else "not recorded"}')


# ---------------------------------------------------------------- restores


def is_local_host(h: str) -> bool:
	if h.startswith('/') or h == 'localhost':
		return True
	try:
		return ipaddress.ip_address(h.strip('[]')).is_loopback
	except ValueError:
		return False


def looks_like_production(url: str) -> bool:
	"""True unless every host libpq would try is plainly a scratch one."""
	p = pg_params(url)
	if p.get('service') or p.get('hostaddr'):
		return True
	hosts = [h.strip().rstrip('.').lower() for h in p.get('host', '').split(',') if h.strip()]
	if any(h.endswith(RAILWAY_HOST_SUFFIXES) for h in hosts):
		return True
	prod = os.environ.get('BACKUP_DATABASE_URL', '').strip()
	if prod:
		q = pg_params(prod)
		prod_hosts = {h.strip().rstrip('.').lower() for h in q.get('host', '').split(',')}
		if set(hosts) & prod_hosts and p.get('port', '5432') == q.get('port', '5432'):
			return True
	return False


def cmd_restore_pg(args) -> None:
	if looks_like_production(args.target) and not args.production:
		fail('the target looks like a Railway/production database; pass --production only for a real recovery')
	hosts = [h for h in pg_params(args.target).get('host', '').split(',') if h]
	if not args.production and not args.allow_remote and not all(is_local_host(h) for h in hosts):
		fail('the target is not on this machine; pass --allow-remote for a remote scratch database')
	with tempfile.TemporaryDirectory(prefix='iwrestore-') as tmp:
		work = Path(tmp)
		tar_path = work / 'postgres.tar'
		age_decrypt(Path(args.archive), Path(args.identity), tar_path)
		with tarfile.open(tar_path) as tar:
			tar.extractall(work, filter='data')
		meta = json.loads((work / 'meta.json').read_text())
		log(f'archive: created {meta["created"]}, server {meta["server_version"].split()[0]}, {len(meta["tables"])} tables')
		with pg_connect(args.target) as conn, conn.cursor() as cur:
			cur.execute(
				"select count(*) from pg_tables where schemaname not in ('pg_catalog', 'information_schema') "
				"and schemaname not like 'pg\\_temp%' and schemaname not like 'pg\\_toast%'"
			)
			existing = cur.fetchone()[0]
		if existing and not args.clean:
			fail(f'the target already has {existing} tables; restore into an empty database or pass --clean')
		pg_restore_into(work / 'launcher.dump', args.target, clean=args.clean)
		with pg_connect(args.target) as conn, conn.cursor() as cur:
			restored = table_counts(cur)
	ok = True
	for t, want in sorted(meta['tables'].items()):
		got = restored.get(t)
		ok &= got == want
		log(f'  {t:<40} expected {want:>8}  restored {got if got is not None else "MISSING":>8}  {"ok" if got == want else "DIFF"}')
	if not ok:
		fail('restored row counts differ from the counts recorded at backup time')
	log(f'restore OK: {len(restored)} tables, every row count matches the backup snapshot')


def wanted_key(key: str, patterns: list[str]) -> bool:
	return not patterns or any(fnmatch.fnmatchcase(key, p) for p in patterns)


WINDOWS_RESERVED = re.compile(r'^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$', re.IGNORECASE)


def safe_segment(seg: str) -> str:
	"""A key segment as a portable file name: characters Windows forbids (a `:` would silently
	write an NTFS alternate data stream), reserved device names and trailing dots/spaces escaped."""
	seg = re.sub(r'[\\:*?"<>|\x00-\x1f%]', lambda m: f'%{ord(m.group()):02X}', seg)
	if WINDOWS_RESERVED.match(seg) or seg.endswith(('.', ' ')):
		seg = seg[:-1] + f'%{ord(seg[-1]):02X}' if seg.endswith(('.', ' ')) else '%' + seg
	return seg


def disk_path(out: Path, key: str, taken: dict[str, str]) -> Path:
	parts = [safe_segment(p) for p in key.split('/')]
	if not key or any(p in ('', '.', '..') for p in key.split('/')):
		fail(f'refusing an unsafe key in the archive: {key!r}')
	dest = out.joinpath(*parts)
	folded = str(dest).casefold()
	if folded in taken and taken[folded] != key:
		# Keys that differ only by case would overwrite each other on a Windows/macOS disk.
		warn(f'{key} differs from {taken[folded]} only by case; written as …{parts[-1]}.case-collision')
		dest = dest.with_name(dest.name + '.case-collision')
		folded = str(dest).casefold()
	taken[folded] = key
	if not dest.resolve().is_relative_to(out.resolve()):
		fail(f'refusing a key that escapes the output directory: {key!r}')
	return dest


def cmd_restore_r2(args) -> None:
	if args.out is None and args.upload_prefix is None:
		fail('give --out DIR, --upload-prefix PREFIX, or both')
	patterns = args.only or []
	out = Path(args.out) if args.out else None
	uploader = None
	prefix = ''
	if args.upload_prefix is not None:
		up_bucket = env('RESTORE_R2_BUCKET')
		prefix = args.upload_prefix
		if prefix and not prefix.endswith('/'):
			prefix += '/'
		live_buckets = {PRODUCTION_BUCKET, os.environ.get('BACKUP_SRC_R2_BUCKET', PRODUCTION_BUCKET)}
		if up_bucket in live_buckets and not prefix and not args.production:
			fail(f'uploading to the root of {up_bucket} overwrites live objects; pass --production for a real recovery')
		uploader = s3_client(
			env('RESTORE_R2_ENDPOINT', os.environ.get('BACKUP_SRC_R2_ENDPOINT')),
			env('RESTORE_R2_ACCESS_KEY_ID'),
			env('RESTORE_R2_SECRET_ACCESS_KEY'),
		)

	with tempfile.TemporaryDirectory(prefix='iwrestore-') as tmp:
		plain = Path(tmp) / 'r2.tar'
		age_decrypt(Path(args.archive), Path(args.identity), plain)
		with tarfile.open(plain) as tar:
			raw = tar.extractfile('_backup/manifest.tsv').read()
			rows = [r.split('\t') for r in raw.decode().splitlines()[1:]]
			manifest = {r[0]: (r + ['', ''])[1:6] for r in rows}
			wanted = {k for k in manifest if wanted_key(k, patterns)}

			# Pass 1: verify every selected object before anything is written or uploaded, so a bad
			# archive can never leave a half-restored bucket behind.
			seen: set[str] = set()
			md5_ok = multipart = 0
			bad: list[str] = []
			for member in tar:
				if member.name not in wanted:
					continue
				data = tar.extractfile(member).read()
				size, etag = int(manifest[member.name][0]), manifest[member.name][1]
				seen.add(member.name)
				if len(data) != size:
					bad.append(member.name)
				elif '-' in etag:
					multipart += 1
				elif hashlib.md5(data).hexdigest() == etag:
					md5_ok += 1
				else:
					bad.append(member.name)
			missing = wanted - seen
			if bad or missing:
				fail(
					f'{len(bad)} objects fail verification and {len(missing)} are missing from the archive '
					f'(first: {(bad or sorted(missing))[0]}); nothing was restored'
				)

			# Pass 2: write and/or upload.
			taken: dict[str, str] = {}
			if out:
				(out / '_backup').mkdir(parents=True, exist_ok=True)
				(out / '_backup' / 'manifest.tsv').write_bytes(raw)
			for member in tar:
				if member.name not in wanted:
					continue
				data = tar.extractfile(member).read()
				if out:
					dest = disk_path(out, member.name, taken)
					try:
						dest.parent.mkdir(parents=True, exist_ok=True)
						dest.write_bytes(data)
					except OSError:
						# e.g. key `a/b` beside `a/b/c`: a file and a folder cannot share a name.
						alt = out / '_unplaceable' / hashlib.sha1(member.name.encode()).hexdigest()
						alt.parent.mkdir(parents=True, exist_ok=True)
						alt.write_bytes(data)
						warn(f'{member.name} could not be written in place; saved as {alt.relative_to(out)}')
				if uploader:
					extra = {}
					content_type, cache_control = manifest[member.name][3], manifest[member.name][4]
					if content_type:
						extra['ContentType'] = content_type
					if cache_control:
						extra['CacheControl'] = cache_control
					uploader.put_object(Bucket=up_bucket, Key=prefix + member.name, Body=data, **extra)

	total = sum(int(manifest[k][0]) for k in wanted)
	log(
		f'restored {len(wanted)} objects ({human(total)}): {md5_ok} byte-verified against the ETag recorded '
		f'at backup time, {multipart} multipart (size-checked only)'
	)
	if out:
		log(f'  extracted to {out}')
	if uploader:
		log(f'  uploaded to {up_bucket}/{prefix}')

	if args.verify_source:
		s3, bucket = source_s3()
		live = {o['Key']: o['ETag'].strip('"') for o in list_objects(s3, bucket)}
		same = sum(live.get(k) == manifest[k][1] for k in wanted)
		gone = sum(k not in live for k in wanted)
		log(
			f'  vs the live bucket now: {same} unchanged since the backup, '
			f'{len(wanted) - same - gone} changed since, {gone} deleted since'
		)


def main() -> None:
	ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
	sub = ap.add_subparsers(dest='cmd', required=True)

	sub.add_parser('plan', help='count what the R2 selection would archive').set_defaults(fn=cmd_plan)

	b = sub.add_parser('backup', help='the nightly job')
	b.add_argument('--only', choices=['pg', 'r2'])
	b.add_argument('--local-dir', help='write archives here instead of the backup bucket')
	b.add_argument('--work-dir', help='scratch space for archives in flight (default: system temp)')
	b.set_defaults(fn=cmd_backup)

	ls = sub.add_parser('list', help='list backups')
	ls.add_argument('--prefix', default='')
	ls.set_defaults(fn=cmd_list)

	f = sub.add_parser('fetch', help='download one backup and verify it')
	f.add_argument('key', help='an object key, or latest:postgres | latest:r2-docs | latest:r2-assets')
	f.add_argument('--out')
	f.set_defaults(fn=cmd_fetch)

	rp = sub.add_parser('restore-pg', help='decrypt a postgres archive and restore it')
	rp.add_argument('archive')
	rp.add_argument('--identity', required=True, help='age identity file (the private key)')
	rp.add_argument('--target', required=True, help='database URL to restore INTO')
	rp.add_argument('--clean', action='store_true', help='drop objects in the target first')
	rp.add_argument('--allow-remote', action='store_true', help='allow a scratch target on another machine')
	rp.add_argument('--production', action='store_true', help='allow a Railway/production target')
	rp.set_defaults(fn=cmd_restore_pg)

	rr = sub.add_parser('restore-r2', help='decrypt an R2 archive, verify it, extract and/or re-upload')
	rr.add_argument('archive')
	rr.add_argument('--identity', required=True)
	rr.add_argument('--out', help='directory to extract into')
	rr.add_argument('--only', action='append', help='glob of keys to restore (repeatable)')
	rr.add_argument('--verify-source', action='store_true', help='compare with the live bucket')
	rr.add_argument('--upload-prefix', help='re-upload under this prefix of RESTORE_R2_BUCKET ("" = the original keys)')
	rr.add_argument('--production', action='store_true', help='allow overwriting the live keys')
	rr.set_defaults(fn=cmd_restore_r2)

	args = ap.parse_args()
	try:
		args.fn(args)
	except Exception as e:
		report_exception(e)
		sys.exit(1)


if __name__ == '__main__':
	main()
