import { createServer } from 'node:http';
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");
const PUBLIC_RELAY_PATH = normalizeRelayPath(process.env.PUBLIC_RELAY_PATH || "/digimamad");
const RELAY_PATH = normalizeRelayPath(process.env.RELAY_PATH || "/");

function normalizeRelayPath(rawPath) {
  if (!rawPath) return "/";
  let p = rawPath.startsWith("/") ? rawPath : "/" + rawPath;
  return p.replace(/\/$/, "") || "/";
}

async function handler(req, res) {
  const fullUrl = req.url || "/";
  console.log(`[${new Date().toISOString()}] Request: ${fullUrl}`);

  try {
    const url = new URL(fullUrl, `https://${req.headers.host}`);
    let pathname = url.pathname || "/";

    console.log(`Pathname received: "${pathname}" | Configured Public Path: "${PUBLIC_RELAY_PATH}"`);

    // شرط خیلی宽容 (宽松)
    if (pathname !== PUBLIC_RELAY_PATH && 
        !pathname.startsWith(PUBLIC_RELAY_PATH + "/")) {
      
      console.log("❌ 404 - Path did not match");
      res.statusCode = 404;
      return res.end("Not Found");
    }

    // ساخت مسیر برای تارگت
    let upstreamPath = pathname.replace(PUBLIC_RELAY_PATH, RELAY_PATH || "");
    if (!upstreamPath || upstreamPath === "") upstreamPath = "/";

    const targetUrl = `${TARGET_BASE}${upstreamPath}${url.search || ""}`;
    console.log(`✅ Proxying to: ${targetUrl}`);

    const headers = Object.fromEntries(
      Object.entries(req.headers).filter(([k]) => 
        !["host", "connection", "x-relay-key"].includes(k.toLowerCase())
      )
    );

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req,
      duplex: "half",
      redirect: "manual",
    });

    console.log(`Upstream Status: ${upstream.status}`);

    res.statusCode = upstream.status;

    for (const [key, value] of upstream.headers) {
      if (!["connection", "transfer-encoding"].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    }

    if (upstream.body) {
      await pipeline(Readable.fromWeb(upstream.body), res);
    } else {
      res.end();
    }

  } catch (err) {
    console.error("Relay Error:", err.message);
    if (!res.headersSent) {
      res.statusCode = 502;
      res.end("Bad Gateway");
    }
  }
}

const server = createServer(handler);
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Relay Started | Target: ${TARGET_BASE} | Public: ${PUBLIC_RELAY_PATH}`);
});
