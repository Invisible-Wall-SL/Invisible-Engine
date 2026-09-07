"""A soft lease over one document, for the Python tools.

The launcher's TypeScript half (`$lib/server/lease.ts`, `doc_leases`, `POST
/api/lease`) answers "which PERSON has this doc open" and is adjudicated by
Postgres. This is the same lease shape for a different collision: **two CONTAINERS
of one service**, during the overlap of a rolling Railway deploy. The names, the
timings and the semantics are copied from that module deliberately — a later move
onto `doc_leases` should be a transport swap, not a rewrite.

WHERE IT LIVES — a departure from the house rule, recorded in
`docs/design/multi-user-concurrency.md` (Phase 3 amendment). That rule says a lease
belongs in Postgres and never in the document it protects, because a lease inside
the doc is clobbered by the very race it exists to prevent. This lease is NOT in the
document: it is its own object, claimed with `If-None-Match: '*'` and renewed with
`If-Match`, so R2 adjudicates the claim atomically and the property the rule exists
to guarantee holds by a different mechanism. Postgres is unavailable here for
reasons that are structural rather than lazy — these services hold no launcher
session and no DB credentials, `doc_leases.holder_user_id` is a foreign key to a
real user and a container is not one, and routing the claim through the launcher
would make it fail open during precisely the deploy it exists to survive.

FAIL OPEN, ALWAYS. Every function answers "you may proceed" when the store cannot
be read or written: a lease that can wedge a render is worse than the race it
prevents. Be honest about what that costs, though — the conditional write on the
document is the floor for the DOC's state only. The other half of a double-submit
is a second `_submit` clearing the hand-off slots and deleting a render the first
one's job already uploaded, and no precondition covers that. So failing open
deliberately re-accepts the double-submit risk for as long as R2 itself is
unreachable, on the grounds that a tool which refuses to render at all is the worse
of the two failures.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass

from . import storage

# Copied from `lease.ts:21-24`. The two halves cannot read each other's rows today —
# different stores entirely — so this is not about agreeing live; it is so that
# moving these rows into `doc_leases` later does not silently change when a lease
# is considered dead.
LEASE_HEARTBEAT_MS = 10_000
LEASE_TTL_MS = 45_000


@dataclass(frozen=True)
class LeaseKey:
    """The composite key `doc_leases` uses as its PRIMARY KEY, in the same order."""
    tool_id: str
    client_key: str
    project_key: str
    doc_key: str

    def path(self) -> str:
        return (f"{self.client_key}/{self.project_key}/_leases/"
                f"{self.tool_id}/{self.doc_key}.json")


@dataclass(frozen=True)
class LeaseHolder:
    """Who is asking. `session_id` is what actually distinguishes two claimants
    here — one container id per process — mirroring `holderSessionId`, which the
    schema describes as the holder's server-side session id rather than a person."""
    user_id: str
    session_id: str


def _now_ms() -> int:
    """Note the one property this does NOT copy from `lease.ts`: there, every
    timestamp comes from a single Postgres `now()`, so a TTL means the same thing to
    every claimant. Here `expiresAt` is written by one container's clock and read by
    another's, so the TTL is only ever as good as their clock agreement (NTP on
    Railway, so milliseconds — but it is an assumption, not a guarantee)."""
    return int(time.time() * 1000)


def _is_transient_conflict(e: Exception) -> bool:
    """R2's 409 `ConditionalRequestConflict`: two conditional writes raced, try
    again. Distinct from the 412 `storage.Conflict` means, which is an answer."""
    resp = getattr(e, "response", None)
    if not isinstance(resp, dict):
        return False
    return (resp.get("ResponseMetadata", {}).get("HTTPStatusCode") == 409
            or str(resp.get("Error", {}).get("Code") or "")
            == "ConditionalRequestConflict")


def is_same_holder(row: dict | None, holder: LeaseHolder) -> bool:
    """`lease.ts:74-79`. Both halves, because one user in two containers is exactly
    the case this exists to separate."""
    if not row:
        return False
    return (str(row.get("holderUserId") or "") == holder.user_id
            and str(row.get("holderSessionId") or "") == holder.session_id)


def is_takeable(row: dict | None, holder: LeaseHolder, now_ms: int) -> bool:
    """`lease.ts:63-71`, kept pure for the same reason it is pure there: it has to
    read identically to the condition the store enforces, and that is only checkable
    if it can be fixtured on its own.

    Takeable when nothing holds it, when what holds it has expired, or when it is
    already ours.
    """
    if not row:
        return True
    if is_same_holder(row, holder):
        return True
    # `<`, not `<=`, because the SQL twin is `expires_at < now()` — these
    # predicates exist to read identically to the condition the store enforces.
    return int(row.get("expiresAt") or 0) < now_ms


def _row(key: LeaseKey, holder: LeaseHolder, acquired_ms: int, now_ms: int,
         ttl_ms: int) -> dict:
    return {
        "toolId": key.tool_id,
        "clientKey": key.client_key,
        "projectKey": key.project_key,
        "docKey": key.doc_key,
        "holderUserId": holder.user_id,
        "holderSessionId": holder.session_id,
        "acquiredAt": acquired_ms,
        "heartbeatAt": now_ms,
        "expiresAt": now_ms + ttl_ms,
    }


def read(key: LeaseKey) -> tuple[dict | None, str | None]:
    """The stored row and its ETag, or `(None, None)` when there genuinely is none.

    RAISES `storage.ObjectUnreadable` when the store could not be asked. Collapsing
    that into "nothing is there" is the mistake `get_with_etag` exists to prevent:
    a caller would take the create-if-absent branch over a live row, be refused by
    the precondition, and report "somebody else holds this" — failing CLOSED in a
    module whose whole contract is to fail open. Callers decide what unreadable
    means for them; here it means "proceed".
    """
    got = storage.get_with_etag(key.path())
    if not got:
        return None, None
    body, etag = got
    try:
        row = json.loads(body)
    except ValueError:
        return None, etag  # a corrupt row is a takeable one
    return (row if isinstance(row, dict) else None), etag


def acquire(key: LeaseKey, holder: LeaseHolder, *,
            ttl_ms: int = LEASE_TTL_MS) -> bool:
    """Take the lease if it is free, expired, or already ours. True when we hold it.

    `lease.ts:114` does this as ONE conditional upsert so the DB adjudicates and two
    racing acquires can never both win. Here R2 adjudicates instead: the write
    carries `If-None-Match: '*'` when we believe nothing holds it and `If-Match`
    when we believe we are replacing what we just read, so a claim that raced
    another container loses on the precondition rather than by overwriting it.
    """
    try:
        row, etag = read(key)
    except Exception:  # noqa: BLE001 — a store we cannot ask holds nobody
        return True
    now = _now_ms()
    if not is_takeable(row, holder, now):
        return False
    # `acquiredAt` survives a renewal by the same holder and resets on a change of
    # hands — `lease.ts:132`, where it is what "held since" is read from.
    acquired = int(row.get("acquiredAt") or now) if is_same_holder(row, holder) \
        else now
    body = json.dumps(_row(key, holder, acquired, now, ttl_ms),
                      indent=2).encode("utf-8")
    for attempt in range(3):
        try:
            if row is None and etag is None:
                storage.put(key.path(), body, "application/json",
                            if_none_match="*")
            else:
                storage.put(key.path(), body, "application/json",
                            if_match=etag or "*")
            return True
        except storage.Conflict:
            return False      # somebody claimed it between our read and our write
        except Exception as e:  # noqa: BLE001
            # R2 answers 409 `ConditionalRequestConflict` when two conditional
            # writes to one key are in flight at the same instant — which is
            # precisely two containers claiming one session. It is transient and
            # must be RETRIED: treating it as success would let both claimants
            # believe they won, and the destructive half of a double-submit (a
            # second `_submit` deleting the first job's uploaded render) has no
            # precondition protecting it.
            if _is_transient_conflict(e) and attempt < 2:
                time.sleep(0.15 * (attempt + 1))
                continue
            if _is_transient_conflict(e):
                return False  # still contended after retries: we did not get it
            return True       # a store we cannot write at all holds nobody
    return False


def heartbeat(key: LeaseKey, holder: LeaseHolder, *,
              ttl_ms: int = LEASE_TTL_MS) -> bool:
    """Extend a lease we still hold. False once somebody has taken it from us —
    `lease.ts:158`, where that is the signal the client flips read-only on.

    A same-holder heartbeat re-extends even past expiry: the alternative is a holder
    that is plainly alive being told to stop by a clock. A foreign row that has
    EXPIRED is not a takeover either — it is a lease nobody holds — so a dispatcher
    whose own lease lapsed under it can take it back rather than standing down for
    good."""
    try:
        row, _etag = read(key)
    except Exception:  # noqa: BLE001 — unreadable holds nobody
        return True
    if not is_takeable(row, holder, _now_ms()):
        return False
    return acquire(key, holder, ttl_ms=ttl_ms)


def release(key: LeaseKey, holder: LeaseHolder) -> None:
    """Give it up. Best-effort — expiry is the backstop (`lease.ts:177`), so a
    delete that fails costs one TTL, never correctness.

    Reads first and skips a row somebody else holds, so a release arriving after a
    takeover does not delete the new holder's lease. That check and the delete are
    two calls, not one conditional delete, so a takeover landing between them is
    still possible; the window is milliseconds and the cost is one TTL of nobody
    holding a session that is not being rendered anyway."""
    try:
        row, _etag = read(key)
    except Exception:  # noqa: BLE001 — if we cannot read it, let it expire
        return
    if row is None or is_same_holder(row, holder):
        try:
            storage.delete(key.path())
        except Exception:  # noqa: BLE001
            pass


def takeover(key: LeaseKey, holder: LeaseHolder, *,
             ttl_ms: int = LEASE_TTL_MS) -> bool:
    """Take it regardless of who holds it. Unconditional, because a lease must never
    permanently wedge a doc (`lease.ts:194`) — here that is Stop, which has to reach
    a session whichever container owns it."""
    now = _now_ms()
    body = json.dumps(_row(key, holder, now, now, ttl_ms), indent=2).encode("utf-8")
    try:
        storage.put(key.path(), body, "application/json")
        return True
    except Exception:  # noqa: BLE001 — fail open: the stop proceeds either way
        return True


def held_by(key: LeaseKey) -> dict | None:
    """The live holder's row, or None when nothing holds it — the read a caller
    makes to decide whether to defer, never to decide whether to be allowed."""
    row, _etag = read(key)          # raises when the store cannot be asked
    if row and int(row.get("expiresAt") or 0) > _now_ms():
        return row
    return None
