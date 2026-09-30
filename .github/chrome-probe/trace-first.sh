#!/usr/bin/env bash
# TEMPORARY (removed before merge): what does Chrome's FIRST launch on a fresh runner wait on?
set -u
CHROME="$(command -v google-chrome)"
echo "DBUS_SESSION_BUS_ADDRESS=${DBUS_SESSION_BUS_ADDRESS:-<unset>}"
busctl --system list --no-pager 2>/dev/null | awk '{print $1, $2, $3}' | head -40
profile=$(mktemp -d)
start=$(date +%s%N)
strace -f -tt -s 160 -o /tmp/st.txt -e trace=connect,execve,sendmsg,recvmsg,openat,wait4,ppoll,poll \
	"$CHROME" --headless --remote-debugging-port=0 --user-data-dir="$profile" --no-sandbox \
	--disable-dev-shm-usage --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader \
	about:blank 2> /tmp/chrome-err.txt &
spid=$!
for _ in $(seq 1 600); do grep -q 'DevTools listening' /tmp/chrome-err.txt && break; sleep 0.1; done
echo "first launch (under strace): $(( ($(date +%s%N) - start) / 1000000 )) ms"
kill $spid; pkill -f "$profile"; sleep 1
echo "--- gaps over 700 ms (the call BEFORE the gap, then the one that ended it):"
awk '{ split($2, t, ":"); s = t[1]*3600 + t[2]*60 + t[3]; if (NR > 1 && s - prev > 0.7) { printf "GAP %.2fs\n  %s\n  %s\n", s - prev, pl, $0 } prev = s; pl = $0 }' /tmp/st.txt | cut -c1-400 | head -60
echo "--- dbus / socket connects:"
grep -E 'connect\(.*(dbus|bus|sun_path)' /tmp/st.txt | cut -c1-250 | sort -u -k3 | head -30
echo "--- execs:"
grep execve /tmp/st.txt | cut -c1-200 | head -20
echo "--- chrome stderr:"
head -30 /tmp/chrome-err.txt
echo "--- second launch (no strace):"
p2=$(mktemp -d); start=$(date +%s%N)
"$CHROME" --headless --remote-debugging-port=0 --user-data-dir="$p2" --no-sandbox --disable-dev-shm-usage about:blank 2> /tmp/e2.txt &
for _ in $(seq 1 600); do grep -q 'DevTools listening' /tmp/e2.txt && break; sleep 0.1; done
echo "second launch: $(( ($(date +%s%N) - start) / 1000000 )) ms"
pkill -f "$p2"
