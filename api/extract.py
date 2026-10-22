"""POST /api/extract  {"url": "<instagram or x link>"}

Finds the post's audio stream with yt-dlp (no download, no ffmpeg) and returns
metadata plus the direct media URL. The browser then pulls the bytes through
/api/media, which streams them so there's no response size cap.

Also runnable as a CLI for local dev:  python3 api/extract.py <url>
"""

import json
import os
import re
import sys
import tempfile
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, urlunparse

import yt_dlp

INSTAGRAM = {"instagram.com", "www.instagram.com", "m.instagram.com", "instagr.am"}
X = {"twitter.com", "www.twitter.com", "mobile.twitter.com", "x.com", "www.x.com", "mobile.x.com"}

# Audio-only stream if the site has one (Instagram usually does), otherwise the
# smallest progressive video that carries audio (X). Only plain http(s) files:
# HLS/DASH manifests can't be stitched without ffmpeg.
FORMAT = (
    "bestaudio[vcodec=none][protocol^=http]"
    "/worst[acodec!=none][vcodec!=none][protocol^=http][ext=mp4]"
    "/worst[acodec!=none][protocol^=http]"
)

MIME = {"m4a": "audio/mp4", "mp4": "video/mp4", "mp3": "audio/mpeg", "webm": "audio/webm", "aac": "audio/aac"}


class ExtractError(Exception):
    pass


def classify(raw):
    try:
        u = urlparse(raw.strip())
    except ValueError:
        return None
    if u.scheme not in ("http", "https"):
        return None
    host = (u.hostname or "").lower()
    if host in INSTAGRAM:
        return "instagram", raw.strip()
    if host in X:
        return "x", urlunparse(u._replace(netloc="twitter.com"))
    return None


def cookie_file():
    """Cookies come from env (Netscape cookies.txt contents) or a path."""
    path = os.environ.get("COOKIES_FILE")
    if path and os.path.exists(path):
        return path
    text = os.environ.get("COOKIES_TXT") or os.environ.get("INSTAGRAM_COOKIES")
    if not text:
        return None
    f = os.path.join(tempfile.gettempdir(), "earworm-cookies.txt")
    if not os.path.exists(f):
        with open(f, "w") as fh:
            fh.write(text if text.startswith("# ") else "# Netscape HTTP Cookie File\n" + text)
    return f


def friendly(msg):
    s = msg.lower()
    if "requested format" in s:
        return "That post's audio is only streamed in pieces, so it can't be saved yet."
    if any(k in s for k in ("login", "cookies", "rate-limit", "authentication", "not available")):
        return "This post needs a logged-in session. Add your cookies to the server (see README) and try again."
    if "no video" in s or "no media" in s:
        return "That post has no video or audio to pull from."
    if "private" in s:
        return "That post is private."
    if "404" in s or "not found" in s or "unavailable" in s or "deleted" in s:
        return "That post was deleted or isn't available."
    return re.sub(r"^.*ERROR:\s*", "", msg.strip().splitlines()[-1])[:200] or "Couldn't pull audio from that link."


def clean(s):
    return re.sub(r"\s+", " ", re.sub(r"https?://\S+", "", s or "")).strip()


def pick_title(info, source):
    t = clean(info.get("description") or info.get("title"))
    if not t or re.match(r"^video by ", t, re.I):
        t = clean(info.get("title"))
    up = info.get("uploader") or ""
    if source == "x" and up and t.startswith(f"{up} - "):
        t = t[len(up) + 3 :]
    if re.match(r"^video by ", t, re.I):
        t = "Reel by " + t[9:]
    if not t:
        t = "Post on X" if source == "x" else "Instagram reel"
    if len(t) > 90:
        t = re.sub(r"\s+\S*$", "", t[:87]) + "…"
    return t


def extract(raw):
    target = classify(raw)
    if not target:
        raise ExtractError("Paste an Instagram or X (Twitter) post link.")
    source, url = target

    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "playlist_items": "1",
        "format": FORMAT,
        "skip_download": True,
        "cachedir": False,
        "socket_timeout": 20,
    }
    cf = cookie_file()
    if cf:
        opts["cookiefile"] = cf

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as e:
        raise ExtractError(friendly(str(e)))

    if info.get("_type") == "playlist":  # carousel posts: take the first video
        entries = [e for e in (info.get("entries") or []) if e]
        if not entries:
            raise ExtractError("That post has no video or audio to pull from.")
        info = entries[0]

    media = info.get("url")
    if not media or not str(info.get("protocol", "https")).startswith("http"):
        raise ExtractError("That post's audio is only streamed in pieces, so it can't be saved yet.")

    ext = info.get("ext") or "mp4"
    if info.get("vcodec") in (None, "none") and ext == "mp4":
        ext = "m4a"
    handle = info.get("uploader_id") or info.get("channel") or info.get("uploader") or ""
    thumb = info.get("thumbnail")
    if not thumb and info.get("thumbnails"):
        thumb = info["thumbnails"][-1].get("url")

    return {
        "source": source,
        "url": raw.strip(),
        "title": pick_title(info, source),
        "artist": info.get("uploader") or handle or ("X" if source == "x" else "Instagram"),
        "handle": str(handle).lstrip("@"),
        "duration": info.get("duration") or 0,
        "media": media,
        "mime": MIME.get(ext, "audio/mp4"),
        "ext": ext,
        "cover": thumb,
    }


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
        try:
            n = min(int(self.headers.get("Content-Length") or 0), 32_000)
            url = json.loads(self.rfile.read(n) or b"{}").get("url", "")
        except (ValueError, AttributeError):
            return self._send(400, {"error": "Send JSON like {\"url\": \"…\"}."})
        try:
            self._send(200, extract(str(url)))
        except ExtractError as e:
            self._send(422, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": f"Something broke while reading that post: {e}"[:200]})

    def do_GET(self):
        self._send(200, {"ok": True, "ytdlp": yt_dlp.version.__version__})


if __name__ == "__main__":
    try:
        print(json.dumps(extract(sys.argv[1])))
    except ExtractError as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(2)
