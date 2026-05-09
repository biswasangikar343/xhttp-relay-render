import { createServer } from 'node:http';
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");
const PUBLIC_RELAY_PATH = normalizeRelayPath(process.env.PUBLIC_RELAY_PATH || "/digimamad");
const RELAY_PATH = normalizeRelayPath(process.env.RELAY_PATH || "/");

function normalizeRelayPath(rawPath) {
  if (!rawPath || rawPath === "") return "/";
  let path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

async function handler(req, res) {
  const requestPath = req.url || "/";
  
  console.log(`[${new Date().toISOString()}] Request: ${requestPath} | PUBLIC_PATH: ${PUBLIC_RELAY_PATH}`);

  try {
    const host = req.headers.host || "localhost";
    const url = new URL(requestPath, `https://${host}`);
    let pathname = url.pathname;

    // لاگ دقیق‌تر
    console.log(`Pathname: ${pathname} | Should match: ${PUBLIC_RELAY_PATH}`);

    // چک مسیر (حساسیت کمتر)
    if (pathname !== PUBLIC_RELAY_PATH && 
        !pathname.startsWith(PUBLIC_RELAY_PATH + "/") && 
        !(PUBLIC_RELAY_PATH === "/" && pathname.startsWith("/"))) {
      
      res.statusCode = 404;
      console.log(`404 - Path not matched`);
      return res.end("Not Found");
    }

    // ساخت مسیر هدف
    let upstreamPath = pathname.replace(PUBLIC_RELAY_PATH, RELAY_PATH);
    if (upstreamPath === "" || upstreamPath === "//") upstreamPath = "/";

    const targetUrl = `${TARGET_BASE}${upstreamPath}${url.search || ""}`;
    console.log(`Proxying to → ${targetUrl}`);

    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      const lower = key.toLowerCase();
      if (["host", "connection", "x-relay-key", "accept-encoding"].includes(lower)) continue;
      headers[lower] = value;
    }

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req,
      duplex: "half",
      redirect: "manual",
    });

    console.log(`Upstream responded with status: ${upstream.status}`);

    res.statusCode = upstream.status;

    for (const [key, value] of upstream.headers) {
      const lower = key.toLowerCase();
      if (!["connection", "transfer-encoding", "keep-alive"].includes(lower)) {
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
  console.log(`🚀 Relay Started | Target: ${TARGET_BASE} | Public Path: ${PUBLIC_RELAY_PATH}`);
});
