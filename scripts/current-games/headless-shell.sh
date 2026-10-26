#!/usr/bin/env bash
# Playwright's headless shell and its apt dependencies, for every CI job that renders in it
# (current-games' build and render shards, the parity workflows).
#
#   headless-shell.sh key                   the actions/cache key: runner image + Playwright version
#   headless-shell.sh install <dir> <name>  install from <dir>, else online and fill <dir>
#
# COLD (no <dir>/manifest.txt for this image): exactly the install every job ran before the cache,
# `playwright install --with-deps chromium-headless-shell`, with apt downloading into <dir>. Once it
# succeeds, <dir> holds the .debs it fetched and the browser it unpacked, and the workflow's
# actions/cache step saves it.
# WARM: those same .debs are installed offline (apt is given no sources and no package lists, so it
# resolves against what is installed plus these files, and one missing fails rather than reaching
# the mirror) and the browser copied back, so the mirror and the browser CDN are not
# touched. The installed versions are then checked against the manifest. A warm install that fails
# for any reason falls back to the cold one.
#
# Why the pixels cannot change: the key is the runner image version, and the cache holds the very
# files a cold install on that image fetched, so a warm runner ends with the same package versions
# a cold one did on the day the entry was made (the log prints them). Every job of one run restores
# the same entry, where before each shard fetched from the mirror on its own.

set -uo pipefail

PLAYWRIGHT=1.63.0
IMAGE="${ImageOS:-unknown}-${ImageVersion:-unknown}"
BROWSERS="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"

if [ "${1:-}" = key ]; then
	echo "headless-shell-v1-$IMAGE-playwright-$PLAYWRIGHT"
	exit 0
fi
[ "${1:-}" = install ] && [ -n "${2:-}" ] && [ -n "${3:-}" ] || {
	echo "usage: headless-shell.sh key | install <dir> <name>" >&2
	exit 2
}
dir="$(realpath -m "$2")"
name="$3"

versions() {
	# `<package> <version>` of every .deb in $1, as installed now.
	local pkgs
	pkgs="$(for deb in "$1"/*.deb; do [ -e "$deb" ] && dpkg-deb -f "$deb" Package; done | sort -u)"
	[ -n "$pkgs" ] || return 0
	# shellcheck disable=SC2086
	dpkg-query -W -f '${Package} ${Version}\n' $pkgs | sort
}

warm() {
	[ -f "$dir/manifest.txt" ] || {
		echo "no cached headless shell for $IMAGE"
		return 1
	}
	grep -qxF "image $IMAGE" "$dir/manifest.txt" || {
		echo "::warning::the cached headless shell is for another image; installing online"
		return 1
	}
	local start=$SECONDS
	if compgen -G "$dir/debs/*.deb" >/dev/null; then
		local none
		none="$(mktemp -d)" && mkdir -p "$none/archives/partial"
		sudo apt-get install -y --no-install-recommends -o Dir::Etc::SourceList=/dev/null \
			-o Dir::Etc::SourceParts="$none" -o Dir::State::Lists="$none" \
			-o Dir::Cache::Archives="$none/archives/" "$dir"/debs/*.deb || return 1
	fi
	mkdir -p "$BROWSERS" && cp -a "$dir/browsers/." "$BROWSERS/" || return 1
	local want got
	want="$(sed -n 's/^deb //p' "$dir/manifest.txt")"
	got="$(versions "$dir/debs")"
	[ "$want" = "$got" ] || {
		echo "::warning::installed versions differ from the cached manifest; installing online"
		diff <(echo "$want") <(echo "$got")
		return 1
	}
	echo "headless shell installed from the cache in $((SECONDS - start))s ($(echo -n "$want" | grep -c '') packages):"
	echo "$want"
}

cold() {
	# The mirror can stall: apt times out a stalled fetch and retries it itself, and a retry of the
	# whole install waits for the dpkg lock instead of failing on it (killing an attempt can leave its
	# apt-get holding the lock). It downloads into the entry being filled — beside <dir>, moved in
	# whole once complete, so a cache never saves a half-made one — where no clean hook deletes them.
	local tmp="$dir.tmp"
	rm -rf "$tmp" && mkdir -p "$tmp/debs/partial" "$tmp/browsers"
	printf '%s\n' 'Acquire::Retries "5";' 'Acquire::http::Timeout "30";' \
		'Acquire::https::Timeout "30";' 'DPkg::Lock::Timeout "180";' \
		| sudo tee "/etc/apt/apt.conf.d/80-$name" >/dev/null
	local archives="/etc/apt/apt.conf.d/81-$name-archives"
	trap 'sudo rm -f "'"$archives"'"' EXIT
	printf 'Dir::Cache::Archives "%s/debs/";\n' "$tmp" | sudo tee "$archives" >/dev/null
	local start=$SECONDS ok=''
	for attempt in 1 2 3; do
		if timeout 240 pnpm dlx "playwright@$PLAYWRIGHT" install --with-deps chromium-headless-shell; then
			ok=1
			break
		fi
		echo "::warning::headless shell install attempt $attempt failed; retrying"
		# A slow mirror can outlast the timeout, which kills pnpm but not the `sudo apt-get` it
		# started: that apt-get runs on holding the dpkg lock, and the next attempt could only wait
		# on it and fail. Let it finish first; the step's timeout still bounds the wait.
		while pgrep -x apt-get >/dev/null || pgrep -x dpkg >/dev/null; do sleep 5; done
		sleep 10
	done
	sudo rm -f "$archives"
	[ -n "$ok" ] || return 1
	echo "headless shell installed online in $((SECONDS - start))s"

	sudo rm -rf "$tmp/debs/partial" "$tmp/debs/lock"
	sudo chown -R "$(id -u):$(id -g)" "$tmp"
	cp -a "$BROWSERS/." "$tmp/browsers/"
	{
		echo "image $IMAGE"
		echo "playwright $PLAYWRIGHT"
		versions "$tmp/debs" | sed 's/^/deb /'
	} >"$tmp/manifest.txt"
	rm -rf "$dir" && mv "$tmp" "$dir"
	echo "cached for $IMAGE ($(du -sh "$dir" | cut -f1)):"
	sed -n 's/^deb //p' "$dir/manifest.txt"
}

warm || cold
