#!/usr/bin/env bash
# TEMPORARY (removed before merge): the launch retry must not hide a real failure or a real hang.
set -u
REAL_CHROME="$(command -v google-chrome)"
bad=0
expect() { if eval "$2"; then echo "  ✓ $1"; else echo "  ✗ $1"; bad=1; fi; }
chromes() { pgrep -f -- '-cdp-' | wc -l; }

echo "== 1. an assertion mutant still fails (one launch, no retry)"
sed "s/n === 1, n);/n === 2, n);/" tools/rigger-spike/skins-panel.mjs > tools/rigger-spike/skins-mutant.mjs
grep -q "n === 2, n);" tools/rigger-spike/skins-mutant.mjs || { echo "mutant not planted"; exit 1; }
out=$(CHROME_PATH="$REAL_CHROME" node tools/rigger-spike/skins-mutant.mjs 2>&1); code=$?
echo "$out" | grep -E '^\[chrome\]|✗|FAIL|PASS'
expect "exit code is non-zero ($code)" '[ $code -ne 0 ]'
expect "the planted assertion is the one that failed" 'echo "$out" | grep -q "✗ the picker fired"'
expect "exactly one launch" '[ "$(echo "$out" | grep -c "\[chrome\] ready")" = 1 ] && ! echo "$out" | grep -q "launch attempt"'
rm tools/rigger-spike/skins-mutant.mjs
sleep 1; expect "no Chrome left behind ($(chromes))" '[ "$(chromes)" = 0 ]'

echo "== 2. a page that hangs after launch fails its CDP timeout, once"
s=$(date +%s); out=$(CHROME_PATH="$REAL_CHROME" node .github/chrome-probe/hang.mjs 2>&1); code=$?
echo "$out"
expect "exit code is non-zero ($code) after $(( $(date +%s) - s ))s" '[ $code -ne 0 ]'
expect "rejected by the CDP timeout" 'echo "$out" | grep -q "got no answer in 10 s"'
expect "no relaunch" '! echo "$out" | grep -q "launch attempt"'
sleep 1; expect "no Chrome left behind ($(chromes))" '[ "$(chromes)" = 0 ]'

echo "== 3. a Chrome that never answers fails in bounded time"
printf '#!/bin/sh\nexec sleep 600\n' > /tmp/hung-chrome && chmod +x /tmp/hung-chrome
s=$(date +%s); out=$(CHROME_PATH=/tmp/hung-chrome node tools/rigger-spike/skins-panel.mjs 2>&1); code=$?; took=$(( $(date +%s) - s ))
echo "$out" | grep -E '^\[chrome\]|did not start'
expect "exit code is non-zero ($code)" '[ $code -ne 0 ]'
expect "gave up after 3 attempts in ${took}s (< 160 s)" 'echo "$out" | grep -q "did not start in 3 attempts" && [ $took -lt 160 ]'
expect "no fake Chrome left running" '! pgrep -f "sleep 600" > /dev/null'
expect "no profile left behind" '[ -z "$(ls -d /tmp/skins-cdp-* 2>/dev/null)" ]'

echo "== 4. a Chrome that crashes fails fast, with its stderr"
printf '#!/bin/sh\necho "boom: no display" >&2\nexit 3\n' > /tmp/crash-chrome && chmod +x /tmp/crash-chrome
s=$(date +%s); out=$(CHROME_PATH=/tmp/crash-chrome node tools/rigger-spike/skins-panel.mjs 2>&1); code=$?; took=$(( $(date +%s) - s ))
echo "$out" | grep -E '^\[chrome\]|did not start|boom' | head -8
expect "exit code is non-zero ($code) in ${took}s" '[ $code -ne 0 ] && [ $took -lt 20 ]'
expect "Chrome's stderr is in the report" 'echo "$out" | grep -q "boom: no display"'

echo "== 5. a spike killed hard takes its Chrome with it (the pipe closes)"
CHROME_PATH="$REAL_CHROME" node tools/rigger-spike/rig-switch.mjs > /tmp/rs.log 2>&1 &
pid=$!
for _ in $(seq 1 100); do grep -q '\[chrome\] ready' /tmp/rs.log && break; sleep 0.2; done
sleep 2
expect "Chrome is running mid-spike ($(chromes))" '[ "$(chromes)" -gt 0 ]'
kill -9 $pid; sleep 3
expect "no Chrome left after SIGKILL of the spike ($(chromes))" '[ "$(chromes)" = 0 ]'

exit $bad
