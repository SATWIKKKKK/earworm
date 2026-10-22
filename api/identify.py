"""POST /api/identify  (body: a few seconds of 16 kHz mono 16-bit WAV)

Asks Shazam which song is playing and returns {"title", "artist"}, or {} when
nothing matches. The browser decodes and trims the clip itself, so there's no
ffmpeg here and the upload stays small (~400 KB for 12 s).

Also runnable as a CLI for local dev:  python3 api/identify.py < clip.wav
"""

import asyncio
import json
import sys
import warnings
from http.server import BaseHTTPRequestHandler

warnings.filterwarnings("ignore", message=".*ffmpeg.*")  # pydub warns on import; we never call it
from shazamio import Shazam  # noqa: E402

MAX_BYTES = 2_000_000


class IdentifyError(Exception):
    pass


async def _recognize(wav):
    out = await asyncio.wait_for(Shazam().recognize(wav), 20)
    track = (out or {}).get("track") or {}
    if not track.get("title"):
        return {}
    return {"title": track["title"], "artist": track.get("subtitle") or ""}


def identify(wav):
    if len(wav) < 44 or wav[:4] != b"RIFF" or wav[8:12] != b"WAVE":
        raise IdentifyError("Send a WAV clip.")
    try:
        return asyncio.run(_recognize(wav))
    except Exception:  # noqa: BLE001 - recognition is best effort; "no match" is a fine answer
        return {}


class handler(BaseHTTPRequestHandler):
    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not 0 < n <= MAX_BYTES:
            return self._send(413, {"error": "Send a clip under 2 MB."})
        try:
            self._send(200, identify(self.rfile.read(n)))
        except IdentifyError as e:
            self._send(400, {"error": str(e)})


if __name__ == "__main__":
    try:
        print(json.dumps(identify(sys.stdin.buffer.read(MAX_BYTES + 1)[:MAX_BYTES])))
    except IdentifyError as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(2)
