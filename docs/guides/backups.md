# Backups and restores

Nightly, encrypted, off-bucket backups of the two things we cannot rebuild from git:

- the **launcher Postgres**: accounts, roles, projects, the games registry and the rig/animation
  catalogues;
- the **authored sources in R2**: every `<client>/<project>/` document and source asset, the
  `_shared/` libraries, `editor/`, `_users/` and `test_server/games.json`.

The tool is [`scripts/backup/iwbackup.py`](../../scripts/backup/iwbackup.py). It runs from
[`.github/workflows/nightly-backup.yml`](../../.github/workflows/nightly-backup.yml).

The setup state and open items are in [status/infra](../status/infra.md). Secret names and
rotation are in [INFRA.md](../INFRA.md) under "Backups" and "Security / secret rotation".

## What runs, where it goes, how long it is kept

The workflow runs every night at 02:37 UTC. A normal run takes about 10 minutes.

| Archive (key in the backup bucket) | Contents | Size today | Kept |
| --- | --- | --- | --- |
| `postgres/<UTC stamp>.tar.age` | A `pg_dump` custom-format dump, plus `meta.json`: the row count of every table, taken in the dump's own snapshot | ~60 KB | 35 days |
| `r2-docs/<stamp>.tar.gz.age` | Every selected object with a text/doc extension (`.json`, `.irig`, `.atlas`, `.xml`, …), plus `_backup/manifest.tsv` (key, size, ETag, last-modified) | ~2,200 objects, 42 MB → 5.4 MB | 90 days |
| `r2-assets/<stamp>.tar.age` | Every other selected object: source images (`input/`, `sheet_src/`), rigs, fonts, sounds, sheets, atlas pages, plus the same manifest | ~13,400 objects, 3.3 GB | 14 days |

The archives go to their **own bucket**, `invisible-backups`, with **their own tokens**. The main
`R2_*` token that every service holds can neither read nor delete them. Retention comes from that
bucket's lifecycle rules, not from the job, so the job's token never needs delete rights. A 7-day
bucket lock protects the most recent week even from a leaked backup token.

### What is and is not copied from R2

The selection is **include-by-default**, so a new prefix nobody has classified yet gets backed up
rather than lost. `iwbackup.py plan` prints what tonight's run would take.

These are excluded, because each can be rebuilt or re-downloaded:

- `comfyui-models/` and `comfyui-nodes/`: third-party weights, about 177 GB;
- `tools/`: desktop-launcher release artifacts, rebuilt by CI;
- `test_server/` except `games.json`: built game bundles and runtime releases, rebuilt from git;
- `_shared/storybook/`: a Storybook build;
- the pipeline **outputs** inside each project: `published/`, `deploy/`, `batch/` (raw ComfyUI
  generations) and `video/` (generated frames). Re-export or re-publish recreates them.

The in-app rolling version histories cover intra-day mistakes inside the live bucket: the scene doc
backup (#417), Rigger `.irig` backups (#832), flow/symbols/config history (#847), and component
defaults (#857). This backup covers what they cannot: the bucket or the database being lost,
wiped or corrupted.

### Why it is safe in a public repo

The Actions logs of this repo are world-readable. The job is built so that nothing useful can
appear in them:

- **No artifacts, ever.** The archives go straight to the backup bucket.
- **Encrypted before upload** with [age](https://age-encryption.org) to *public* keys. The job
  holds no decryption key, so a leaked Actions secret can write backups but never read one. Only
  the owner's offline identity decrypts.
- **The log is counts, sizes and table names only.** It never prints object keys, rows or URLs.
  - Each part of the connection string (host, user, password, port) is masked separately.
  - In Actions, a library error prints only its type, such as `ConnectionTimeout`, because
    botocore and psycopg messages carry request URLs and resolved IPs.
  - A `pg_dump`/`pg_restore` error is cut to its first line, with quoted values and anything after
    `DETAIL`/`CONTEXT` removed. That is where row data would appear.
  - Run the same command locally to get the full detail.
- **Secrets reach one step only.** The "Back up" step gets them; checkout, setup-python, the PGDG
  install and `pip` never see them.
- **Pinned dependencies.** The Python dependencies are exact, hash-checked pins
  (`pip install --require-hashes`).
- **The secrets live in the `backups` environment, whose branch policy allows only `main`.** That
  policy is the real fence: a workflow edited on a branch can drop any `if:`, but it cannot reach
  environment secrets.

### Nightly self-test

Every night the fresh dump is restored into a throwaway `postgres:18` service container. The job
goes red unless every table's row count matches the counts taken in the dump's snapshot. A red run
opens or updates the issue **"Nightly backup failed"**. With no secrets configured, the run is a
green no-op with a warning, so nothing alerts before setup.

## Railway's built-in backups: turn them on too, if the plan allows

Railway has native Postgres volume backups on the **Pro and Enterprise plans only**. The pricing
table's "Built-in database and volume backups" row is a dash for Free and Hobby.

- **To turn them on:** Railway → project → **Postgres** service → **Backups** tab → tick
  **Daily** (kept 6 days) and **Weekly** (kept 27 days); **Monthly** (kept 89 days) is optional.
  If the tab is missing or locked, the workspace is on Hobby.
- **Cost:** the volume rate on the incremental size, $0.15/GB-month. Our database is 9 MB, so
  about $0.
- **Restoring from one:** in the Backups tab, click **Restore** on a dated backup. Railway
  *stages* a new volume. Then click **Deploy** on the staged change.
- **Point-in-time recovery:** the same tab has **Enable PITR** (WAL archiving to a Railway bucket,
  about a 4-week window). It needs the `postgres-ssl` image on a major tag. Nice to have, but not
  required.

Keep **both** Railway's backups and ours. Railway's are faster to restore, but they live inside
Railway, can only be restored into the same project, and "wiping a volume deletes all backups".
Ours sit outside Railway and survive losing the project or the account.

## R2: the nightly copy, not object versioning

We compared a nightly copy with turning on R2 object versioning. **R2 does not support versioning.**
Its S3-compatibility table marks `PutBucketVersioning`, object lock and bucket replication as
unsupported. So there is no versioning to enable. Even if R2 shipped it, it would be the wrong tool:

| | Nightly copy (built) | Object versioning (hypothetical) |
| --- | --- | --- |
| Available on R2 | yes | **no** |
| Scope | only authored sources, 3.4 GB | the whole bucket, including 177 GB of model weights and every churning `deploy/`, `published/` and runtime release (S3 versioning cannot be scoped to a prefix) |
| Survives the bucket being deleted or emptied, or a leaked main token | yes: separate bucket, separate tokens, bucket lock | no: same bucket, and the same token that deletes objects can delete versions |
| Granularity | one point per night | every save; but autosave writes scene and flow docs every few seconds, so the version count is unbounded |
| Encrypted at rest with our key | yes | no |
| Monthly cost | about $0.90 (below) | about $0.30–1.50 for the doc prefixes alone at our save rate, plus every re-export and re-publish of deploy pages. Not meaningfully cheaper, and unbounded |

**Recommendation: the nightly copy.** Intra-day granularity is already covered by the in-app
version histories listed above.

**Cost of the nightly copy** (R2 Standard: $0.015/GB-month; Class A $4.50/M; Class B $0.36/M):

- **Storage at steady state:** assets 3.3 GB × 14 + docs 5.4 MB × 90 + Postgres 60 KB × 35 ≈
  47 GB ≈ $0.70/month. The account's free 10 GB is already used by the main bucket.
- **Operations per night:** about 450 Class A (multipart parts and lists) and about 16,000
  Class B (source GETs), roughly 14k A and 480k B a month ≈ $0.06 + $0.17.
- **Egress:** free.
- **Total: under $1/month.** It grows with `input/`; assets retention is the lever.

## One-time owner setup

Don't do these from a session: they are dashboard settings and credentials. About 25 minutes.

1. **Create the backup bucket.** Cloudflare → R2 → Create bucket `invisible-backups`. If you can,
   pick a location hint different from `invisibleassets`.
2. **Add lifecycle rules** (bucket → Settings → Object lifecycle rules):
   - `postgres/`: delete after 35 days;
   - `r2-docs/`: delete after 90 days;
   - `r2-assets/`: delete after 14 days;
   - `_restore-drill/`: delete after 7 days;
   - whole bucket: abort incomplete multipart uploads after 1 day.
3. **Add bucket lock rules** (bucket → Settings → Bucket lock rules): prefixes `postgres/`,
   `r2-docs/` and `r2-assets/`, each with retention 7 days.
   - Never add a lock rule to `invisibleassets`: it blocks overwrites, so every save would fail.
4. **Create two R2 API tokens** (R2 → Manage API tokens). Neither is the existing main token.
   - `backup-writer`: **Object Read & Write**, scoped to **only** `invisible-backups`.
   - `backup-source-reader`: **Object Read only**, scoped to **only** `invisibleassets`.
5. **Create a read-only database role** (recommended). The job can use the public superuser URL,
   but it only needs to read. In Railway → Postgres → **Data** → query (or
   `railway connect Postgres`), run:

   ```sql
   CREATE ROLE backup_reader LOGIN PASSWORD '<generate one: letters and digits only>';
   GRANT pg_read_all_data TO backup_reader;
   ```

   The connection string is then the Postgres service's `DATABASE_PUBLIC_URL`, with that user and
   password: `postgresql://backup_reader:<pw>@<host>.proxy.rlwy.net:<port>/railway`. Use a
   letters-and-digits password: `#`, `/`, `?` or `@` would have to be URL-encoded in that URL.
6. **Create the age keys**, on your own machine, never in a session or CI:

   ```bash
   age-keygen -o iw-backup-identity.txt
   ```

   Store that file in your password manager **and** on an offline copy (a USB key, or printed).
   **Losing it makes every backup unreadable.** Make a second key the same way for break-glass,
   held by a second person or place. Each file prints its public key (`age1…`).
7. **Create the GitHub environment first, then the secrets.** Repo → Settings → Environments →
   New environment `backups`.
   - Deployment branches: **Selected branches → `main`**. Set this before adding any secret.
   - No required reviewers, or the nightly run would wait forever.
   - Add the secrets and variables listed in [INFRA.md → Backups](../INFRA.md#backups-2026-09-29)
     **to this environment only**, never as repository secrets. Repository secrets are readable
     from any branch.
   - Check the policy took:
     `gh api repos/Invisible-Wall-SL/Invisible-Engine/environments/backups --jq .deployment_branch_policy`
     must not be `null`.
8. **Run it once:** Actions → **Nightly backup** → Run workflow. It should go green, with three
   uploads and the line "restore check: … row counts identical".
9. **Do the drill below** within a week, with your real identity file. It proves the one part CI
   cannot test: that the key you stored actually decrypts.
10. **Railway:** if you are on Pro, turn on the built-in backups (see above).

## Restore runbooks

All restores run on your machine, never in Actions: a restore prints table names and counts, and
needs the private key.

**Tools:**

- Python 3.12 with `pip install -r scripts/backup/requirements.txt`;
- `age` (`winget install FiloSottile.age`, or the release zip);
- PostgreSQL 18 client tools (`pg_restore`, `psql`). On Windows, use the EDB "binaries" zip and
  point `PG_BIN_DIR` at its `bin/`.

**Environment**, in the shell you run the commands from:

```bash
export BACKUP_R2_ACCESS_KEY_ID=…   BACKUP_R2_SECRET_ACCESS_KEY=…   # backup-writer (list + fetch)
export BACKUP_SRC_R2_ENDPOINT=https://175d2ae4501d5de0a1ca970f2bb31448.r2.cloudflarestorage.com
# only for `plan` and `restore-r2 --verify-source` (backup-source-reader):
export BACKUP_SRC_R2_ACCESS_KEY_ID=…   BACKUP_SRC_R2_SECRET_ACCESS_KEY=…
export BACKUP_AGE_RECIPIENTS=age1…                                 # only for `backup`
```

**Built-in guards**, so a drill cannot hit production by accident:

- **`restore-pg`** refuses, unless you pass the named flag:
  - any Railway host (`*.rlwy.net`, `*.railway.internal`, `*.railway.app`), including one smuggled
    in through `?host=`, a `hostaddr` or a `service` in the URL: needs `--production`;
  - the `BACKUP_DATABASE_URL` host: needs `--production`;
  - any target not on this machine: needs `--allow-remote`;
  - a non-empty target: needs `--clean`.
- **`restore-r2`**:
  - refuses to upload onto the root of `invisibleassets` without `--production`;
  - verifies **every** selected object (size, and md5 against the backup-time ETag) before it
    writes or uploads anything, so a bad archive never leaves a half-restored bucket behind;
  - restores each object's Content-Type and Cache-Control;
  - on disk, escapes key characters Windows cannot hold, writes case-only collisions as
    `.case-collision`, and saves a file/folder name clash under `_unplaceable/`.

### A. The drill: prove the backups restore (quarterly, and after any key change)

1. Fetch the newest backups. `fetch` checks the sha256 recorded at upload:

   ```bash
   python scripts/backup/iwbackup.py list
   python scripts/backup/iwbackup.py fetch latest:postgres --out pg.tar.age
   python scripts/backup/iwbackup.py fetch latest:r2-docs  --out docs.tar.gz.age
   ```

2. Restore the database into a scratch database, never Railway: a local Postgres 18, or a
   throwaway Docker `postgres:18`. It prints every table's expected vs restored count, and fails on
   any difference:

   ```bash
   python scripts/backup/iwbackup.py restore-pg pg.tar.age --identity iw-backup-identity.txt \
     --target postgresql://postgres@localhost:5432/restore_drill
   ```

3. Restore the docs into a scratch directory. Every object's md5 is checked against the ETag it
   had in the bucket at backup time. `--verify-source` also reports what changed live since the
   backup:

   ```bash
   python scripts/backup/iwbackup.py restore-r2 docs.tar.gz.age --identity iw-backup-identity.txt \
     --out ./restore-drill --verify-source
   ```

4. Optionally, re-upload under a scratch prefix of the backup bucket. Lifecycle removes it after
   7 days:

   ```bash
   RESTORE_R2_BUCKET=invisible-backups RESTORE_R2_ACCESS_KEY_ID=… RESTORE_R2_SECRET_ACCESS_KEY=… \
   python scripts/backup/iwbackup.py restore-r2 docs.tar.gz.age --identity iw-backup-identity.txt \
     --upload-prefix _restore-drill/$(date +%Y%m%d)
   ```

5. Record the date and result in [status/infra](../status/infra.md) under "Recent changes".

### B. Recover the production database

1. **Prefer Railway's own backup if you have one** (Pro plan): Postgres → Backups → Restore →
   Deploy. Then stop here.
2. **Otherwise, stop the writers.** Scale the launcher to 0 replicas, or take it down in Railway,
   so nothing writes during the restore.
3. **Fetch the backup** from before the damage: `iwbackup.py list --prefix postgres/`, then
   `fetch postgres/<stamp>.tar.age`.
4. **Rehearse first:** restore it into a scratch database as in drill step 2, and check the data.
5. **Restore into production.** Either:
   - a fresh Railway Postgres service (safest), then point the launcher's `DATABASE_URL` at it; or
   - the existing database, in place:

   ```bash
   python scripts/backup/iwbackup.py restore-pg pg.tar.age --identity iw-backup-identity.txt \
     --target "$DATABASE_PUBLIC_URL" --production --clean
   ```

   `--clean` drops and recreates every object in the dump, inside one transaction. It rolls back
   entirely on any error.
6. **Start the launcher again.** The on-boot migrator applies any migration newer than the dump.
   Check that `/api/health` is green.
7. **Tell users what was lost:** everything after the backup's stamp. Sessions are restored too,
   so nobody gets logged out, but accounts created after the stamp are gone.

### C. Recover one project's docs, or a single file

1. **Try the in-app version history first.** Editor, Flow, Symbols, Config, Rigger and Components
   each keep rolling backups inside the live bucket.
2. **Otherwise, extract only what you need.** `--only` takes globs and can be repeated:

   ```bash
   python scripts/backup/iwbackup.py restore-r2 docs.tar.gz.age --identity iw-backup-identity.txt \
     --out ./recovered --only 'invisible_wall/bookofborutremake/editor/*'
   ```

3. **Put the files back on their original keys.** This needs `--production`, and a token that can
   write `invisibleassets`: the main `R2_*` one.

   ```bash
   RESTORE_R2_BUCKET=invisibleassets RESTORE_R2_ACCESS_KEY_ID=… RESTORE_R2_SECRET_ACCESS_KEY=… \
   python scripts/backup/iwbackup.py restore-r2 docs.tar.gz.age --identity iw-backup-identity.txt \
     --only 'invisible_wall/bookofborutremake/editor/*' --upload-prefix '' --production
   ```

4. **Re-open the tool.** If the game should pick up the change, re-publish from the Game Maker.
   Players boot published snapshots.

### D. Recover the whole authored bucket

1. **Restore both archives from the same night**, `r2-docs` and `r2-assets`, with
   `--upload-prefix '' --production`. The target can be a new bucket, or `invisibleassets`.
2. **Rebuild what was excluded:**
   - re-sync ComfyUI models from their sources (see the models manifest);
   - re-run the Runtime release workflow;
   - re-register or re-publish the games;
   - re-export `deploy/`, which re-publishing does per project.
3. **If you moved to a new bucket,** update `R2_BUCKET` on every service → Apply changes / Deploy.

### E. A key or token is compromised or lost

- **`backup-writer` leaked:** revoke it and create a new one, then update the two `BACKUP_R2_*`
  secrets. The bucket lock stops the last 7 days of backups being deleted, and the thief cannot
  decrypt anything.
- **`backup-source-reader` leaked:** it can *read* the authored bucket but not change it. Revoke
  it, recreate it, and update the secrets.
- **`BACKUP_DATABASE_URL` leaked:** rotate the `backup_reader` password (`ALTER ROLE backup_reader
  PASSWORD …`) and update the secret. If the URL was the superuser one, rotate per the INFRA
  Postgres row.
- **An age identity leaked:**
  1. Make a new key and replace the leaked public key in `BACKUP_AGE_RECIPIENTS`.
  2. Existing archives stay readable by the leaked key until lifecycle expires them: 90 days at
     most. To end that sooner, delete them once the lock has lapsed.
- **An age identity was lost:** backups made to it are readable only by the other recipient. That
  is why there are two. Make a new key and update the variable. Also rehearse drill A now, with the
  surviving key.

## Last test restore

The first end-to-end drill ran on **2026-09-29**, from production sources (read-only) into scratch
targets only. Every step passed:

- **Postgres:** 17 tables restored with every row count matching the snapshot, and 10 stable tables
  md5-identical to production.
- **R2:** all 2,199 docs and 13,431 assets byte-verified.
- **Guards:** each one refused as designed.

It also found 17 case-only key collisions in `borut/bookofborut/`. Full record: 2026-09-29 in
[status/infra](../status/infra.md). Log each future drill there too.
