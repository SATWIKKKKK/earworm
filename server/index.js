// Local / Docker server. Runs the exact same code as the Vercel functions in /api:
//   POST /api/extract -> python3 api/extract.py <url>
//   GET  /api/media   -> api/media.js
import express from "express";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { GET as media } from "../api/media.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 8787;
const PYTHON = process.env.PYTHON || "python3";
const EXTRACT = process.env.EXTRACT_SCRIPT || path.join(ROOT, "api", "extract.py");

const app = express();
app.use(express.json({ limit: "32kb" }));

// At most 3 extractions at once; the rest wait their turn.
const MAX = 3;
let busy = 0;
const waiting = [];
const acquire = () => (busy < MAX ? (busy++, Promise.resolve()) : new Promise((r) => waiting.push(r)));
const release = () => {
  const next = waiting.shift();
  if (next) next();
  else busy--;
};

function runExtract(url) {
  return new Promise((resolve) => {
    const p = spawn(PYTHON, [EXTRACT, url], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let out = "";
    let err = "";
    const t = setTimeout(() => p.kill("SIGKILL"), 90_000);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", () => resolve({ code: 500, body: { error: `Couldn't start ${PYTHON}. Is Python installed?` } }));
    p.on("close", (code) => {
      clearTimeout(t);
      try {
        const body = JSON.parse(out.trim().split("\n").pop());
        resolve({ code: body.error ? 422 : 200, body });
      } catch {
        const missing = err.includes("No module named 'yt_dlp'");
        resolve({
          code: 500,
          body: { error: missing ? "yt-dlp isn't installed. Run: pip install -U yt-dlp" : code === null ? "Timed out while reading the post." : "Couldn't read that post." },
        });
      }
    });
  });
}

app.post("/api/extract", async (req, res) => {
  const url = String(req.body?.url || "");
  if (waiting.length > 20) return res.status(429).json({ error: "Too many links at once. Try again in a minute." });
  await acquire();
  try {
    const { code, body } = await runExtract(url);
    res.status(code).json(body);
  } finally {
    release();
  }
});

app.get("/api/media", async (req, res) => {
  const headers = new Headers();
  if (req.headers.range) headers.set("range", req.headers.range);
  const r = await media(new Request(`http://local${req.originalUrl}`, { headers }));
  res.status(r.status);
  r.headers.forEach((v, k) => res.setHeader(k, v));
  if (!r.body) return res.end();
  Readable.fromWeb(r.body).on("error", () => res.end()).pipe(res);
});

const dist = path.join(ROOT, "web", "dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.listen(PORT, () => console.log(`earworm on http://localhost:${PORT}`));
