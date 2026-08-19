"""Serve ComfyUI on a SECOND port: forward 0.0.0.0:8189 -> 127.0.0.1:8188.

Why a pod needs two ports at all:

RunPod will not expose one container port as both HTTP and TCP, and we need both.

  * **TCP 8188** gives a direct `http://<ip>:<publicPort>` the launcher can LINK to.
    The HTTP proxy 403s any *clicked* link (`Sec-Fetch-Site: cross-site`), so without a
    TCP port the "Open ComfyUI" button cannot work at all — see `docs/INFRA.md`
    §"Access to …proxy.runpod.net was denied".
  * **HTTP 8189** keeps the proxy hostname alive. That is what the launcher's readiness
    probe uses, what a pasted url uses, and the only path that works on a pod with no
    public IP. Exposing 8188 as TCP *removes* its HTTP proxy (the hostname starts
    answering 404), which is how a pod ends up unreachable by every route at once.

Forwarding the second port sidesteps the either/or: configure the pod as
**HTTP ports 8189 + TCP ports 8188** and both paths work.

Raw TCP relay, so ComfyUI's `/ws` progress socket passes through untouched — an
HTTP-aware proxy would have to special-case the upgrade.

Stdlib only, deliberately: `socat` is not in this image, and adding an apt package to
solve a forty-line problem is the worse trade. Started by `start.sh`; logs to
`/workspace/port-forward.log`.
"""
from __future__ import annotations

import os
import socket
import sys
import threading

LISTEN_PORT = int(os.environ.get("COMFY_FORWARD_PORT", "8189"))
TARGET_PORT = int(os.environ.get("COMFY_PORT", "8188"))
BUF = 65536


def _pipe(src: socket.socket, dst: socket.socket) -> None:
	"""Shovel bytes one way until either end closes, then tear BOTH down.

	Closing both is what stops a half-open pair leaking a thread per dead connection —
	ComfyUI holds a `/ws` socket open for the whole session, so a pod left running for a
	day accumulates them.
	"""
	try:
		while True:
			data = src.recv(BUF)
			if not data:
				break
			dst.sendall(data)
	except OSError:
		pass
	finally:
		for s in (src, dst):
			try:
				s.shutdown(socket.SHUT_RDWR)
			except OSError:
				pass
			try:
				s.close()
			except OSError:
				pass


def _handle(client: socket.socket) -> None:
	try:
		upstream = socket.create_connection(("127.0.0.1", TARGET_PORT))
	except OSError as e:
		# ComfyUI not up yet (it boots in parallel with us) or mid-restart. Drop this
		# connection; the proxy reports 502 and the next attempt reconnects. Never fatal
		# — this process must outlive every ComfyUI restart.
		print(f"upstream {TARGET_PORT} unavailable: {e}", flush=True)
		try:
			client.close()
		except OSError:
			pass
		return
	threading.Thread(target=_pipe, args=(client, upstream), daemon=True).start()
	threading.Thread(target=_pipe, args=(upstream, client), daemon=True).start()


def main() -> None:
	srv = socket.socket()
	srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
	try:
		srv.bind(("0.0.0.0", LISTEN_PORT))
	except OSError as e:
		print(f"cannot bind :{LISTEN_PORT}: {e}", file=sys.stderr, flush=True)
		raise SystemExit(1)
	srv.listen(128)
	print(f"forwarding :{LISTEN_PORT} -> 127.0.0.1:{TARGET_PORT}", flush=True)
	while True:
		try:
			conn, _ = srv.accept()
		except OSError as e:
			print(f"accept failed: {e}", flush=True)
			continue
		threading.Thread(target=_handle, args=(conn,), daemon=True).start()


if __name__ == "__main__":
	main()
