"""POST /api/extract  {"url": "<instagram or x link>"}

Finds the post's audio stream with yt-dlp (no download, no ffmpeg) and returns
metadata plus the direct media URL. The browser then pulls the bytes through
/api/media, which streams them so there's no response size cap.

Titles: Instagram's own song tag when the reel has one ("song": true), else the
caption's first line. The browser then tries /api/identify for untagged audio.

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
from yt_dlp.extractor.instagram import InstagramBaseIE

INSTAGRAM = {"instagram.com", "www.instagram.com", "m.instagram.com", "instagr.am"}
X = {"twitter.com", "www.twitter.com", "mobile.twitter.com", "x.com", "www.x.com", "mobile.x.com"}

# Audio-only stream if the site has one (Instagram usually does), otherwise the
# smallest progressive video that carries audio (X). Only plain http(s) files:
# HLS/DASH manifests can't be stitched without ffmpeg. X's progressive mp4s
# don't report codecs, hence "!=?" (also matches unknown).
FORMAT = (
    "bestaudio[vcodec=none][protocol^=http]"
    "/worst[acodec!=?none][vcodec!=?none][protocol^=http][ext=mp4]"
    "/worst[acodec!=?none][protocol^=http]"
)

MIME = {"m4a": "audio/mp4", "mp4": "video/mp4", "mp3": "audio/mpeg", "webm": "audio/webm", "aac": "audio/aac"}


class ExtractError(Exception):
    pass


def ig_song(product):
    """Instagram knows which song a reel uses; yt-dlp reads it but drops it."""
    for key in ("clips_metadata", "music_metadata"):
        meta = product.get(key)
        if not isinstance(meta, dict):
            continue
        music = (meta.get("music_info") or {}).get("music_asset_info") or {}
        if music.get("title"):
            return {"title": music["title"], "artist": music.get("display_artist") or "", "cover": music.get("cover_artwork_uri")}
        sound = meta.get("original_sound_info") or {}
        name = (sound.get("original_audio_title") or "").strip()
        # a renamed original sound is usually "Artist - Song"; the default name tells us nothing
        if name and name.lower() not in ("original audio", "original sound"):
            return {"title": name, "artist": (sound.get("ig_artist") or {}).get("username") or "", "cover": None}
    return None


_extract_product = InstagramBaseIE._extract_product


def _extract_product_with_song(self, product_info, *args, **kwargs):
    info = _extract_product(self, product_info, *args, **kwargs)
    song = ig_song(product_info[0] if isinstance(product_info, list) else product_info)
    if song:
        for entry in [info, *(info.get("entries") or [])]:
            entry["earworm_song"] = song
    return info


InstagramBaseIE._extract_product = _extract_product_with_song


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


EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿⬀-⯿️‍⃣]+")


def clean(s):
    return re.sub(r"\s+", " ", re.sub(r"https?://\S+", "", s or "")).strip()


def caption_text(info, source):
    t = info.get("description") or ""
    if source == "x":
        up = info.get("uploader") or ""
        t = t or info.get("title") or ""
        if up and t.startswith(f"{up} - "):
            t = t[len(up) + 3 :]
    return t


def headline(text):
    """First meaningful line of a caption: no links, hashtags or emoji."""
    t = re.sub(r"https?://\S+", " ", text or "")
    t = re.sub(r"(?:^|(?<=\s))[#＃][\w.]+", " ", t)
    t = EMOJI.sub(" ", t)
    for line in t.splitlines():
        line = re.sub(r"\s+", " ", line).strip(" -–—|•·:.,!\"'")
        if re.search(r"\w", line):
            return shorten(line, 90)
    return ""


def shorten(t, n):
    return t if len(t) <= n else re.sub(r"\s+\S*$", "", t[: n - 3]) + "…"


def poster_handle(info, source):
    # Instagram's uploader_id is a numeric account id; the username is "channel"
    h = info.get("channel") if source == "instagram" else info.get("uploader_id")
    return str(h or info.get("uploader_id") or "").lstrip("@")


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
    handle = poster_handle(info, source)
    poster = info.get("uploader") or handle or ("X" if source == "x" else "Instagram")
    thumb = info.get("thumbnail")
    if not thumb and info.get("thumbnails"):
        thumb = info["thumbnails"][-1].get("url")
    caption = caption_text(info, source)
    song = info.get("earworm_song")

    if song:
        title, artist, cover = song["title"], song["artist"] or poster, song["cover"] or thumb
    else:
        # no song info: the caption's first line is the best name we have; the
        # browser may still recognise the song from the audio and rename it
        title = headline(caption) or (f"Reel by @{handle}" if source == "instagram" and handle else f"Post by {poster}")
        artist, cover = poster, thumb

    return {
        "source": source,
        "url": raw.strip(),
        "title": title,
        "artist": artist,
        "song": bool(song),
        "handle": handle,
        "caption": shorten(clean(caption), 300),
        "duration": info.get("duration") or 0,
        "media": media,
        "mime": MIME.get(ext, "audio/mp4"),
        "ext": ext,
        "cover": cover,
        "postCover": thumb,
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
