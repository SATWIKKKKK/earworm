// GET /api/media?u=<cdn url>
// Streams audio/cover bytes from Instagram/X CDNs to the browser. Streaming keeps
// it clear of Vercel's 4.5 MB response cap, and the host allowlist stops it from
// being used as an open proxy.

const ALLOWED = [".cdninstagram.com", ".fbcdn.net", ".twimg.com", ".instagram.com"];
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

// Exact extra hosts (e.g. "localhost:9000") for local testing only.
const EXTRA = (process.env.MEDIA_EXTRA_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean);

export function allowed(raw) {
  try {
    const u = new URL(raw);
    if (EXTRA.includes(u.host)) return true;
    return u.protocol === "https:" && ALLOWED.some((d) => ("." + u.hostname).endsWith(d));
  } catch {
    return false;
  }
}

export async function GET(request) {
  const target = new URL(request.url).searchParams.get("u") || "";
  if (!allowed(target)) return Response.json({ error: "That address isn't allowed." }, { status: 400 });

  const headers = { "User-Agent": UA, Accept: "*/*" };
  const range = request.headers.get("range");
  if (range) headers.Range = range;

  let upstream;
  try {
    upstream = await fetch(target, { headers, redirect: "follow" });
  } catch {
    return Response.json({ error: "Couldn't reach the media server." }, { status: 502 });
  }
  if (!upstream.ok && upstream.status !== 206) {
    return Response.json({ error: `Media server answered ${upstream.status}. The link may have expired; add it again.` }, { status: 502 });
  }

  const out = new Headers({ "Cache-Control": "no-store" });
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
