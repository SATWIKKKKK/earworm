# Earworm

Paste an Instagram reel or X (Twitter) video link and it becomes a song in your own little music player. The audio is saved in your browser (IndexedDB), so it plays offline and keeps working even if the post gets deleted.

## Deploy to Vercel

```bash
npm i -g vercel
vercel login
vercel            # first run: links the project, accept the detected settings
vercel --prod
```

Or push this folder to GitHub and import it at vercel.com/new. `vercel.json` already sets everything up: the React app builds from `web/`, `api/extract.py` runs on Vercel's Python runtime (installs yt-dlp from `requirements.txt`), and `api/media.js` streams the audio.

### Instagram cookies (needed for most reels)

Instagram blocks logged-out requests, and Vercel's servers get blocked faster than a home connection.

1. Log into instagram.com in your browser (a spare account is safer).
2. Export cookies with a "Get cookies.txt LOCALLY" extension.
3. Vercel → Project → Settings → Environment Variables → add `COOKIES_TXT` and paste the whole file's contents.
4. Redeploy.

X links usually work without cookies. If a site starts failing, bump the yt-dlp version in `requirements.txt` and redeploy; sites change and yt-dlp releases fixes often.

## Run locally

Needs Node 18+ and Python 3.

```bash
npm install && npm run setup     # also runs: pip install -U yt-dlp
npm run dev                      # http://localhost:5173
```

For Instagram locally: `COOKIES_FILE=/path/to/cookies.txt npm run dev`.

Production without Vercel: `npm run build && npm start` (serves on :8787), or `docker build -t earworm . && docker run -p 8787:8787 -e COOKIES_TXT="$(cat cookies.txt)" earworm`.

## What it does

- Paste one link or several at once; paste anywhere on the page works too. Drag in audio/video files from your computer.
- Library with search and sorting (recently added, title, artist, most played, length)
- Liked songs, Recently played, playlists (create, rename, delete, drag to reorder, drag songs onto a playlist in the sidebar)
- Play next / Add to queue, queue panel with "Next in queue" and "Next from …"
- Shuffle, repeat all / repeat one, seek, volume, playback speed
- Full-screen player tinted by the cover art; mobile layout with mini player and swipe-down to close
- Lock screen / headphone / media key controls (Media Session API)
- Remembers the last song, position, volume, shuffle and repeat across reloads
- Edit title and artist, download the audio, open the original post, delete

Keyboard: `Space` play/pause, `←/→` seek 5s, `Shift+←/→` previous/next, `↑/↓` volume, `M` mute, `L` like, `S` shuffle, `R` repeat, `Q` queue, `/` search.

## How it works

- `api/extract.py` — `POST /api/extract {url}`. yt-dlp finds the post's audio-only stream (or the smallest video with audio) without downloading it, and returns metadata plus the media URL.
- `api/media.js` — `GET /api/media?u=…`. Streams the file from Instagram/X's CDN to the browser (streaming avoids Vercel's 4.5 MB response cap; only those CDNs are allowed).
- `web/` — React + TypeScript + Vite + Zustand. Saves the audio into IndexedDB and plays it from there forever after.
- `server/` — Express wrapper that runs the same two files, for local dev and Docker.

Your library lives in the browser you added songs from; it doesn't sync between devices.

Only use this for content you have the right to save.
