import { createServer } from 'node:http';
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");
const PUBLIC_RELAY_PATH = normalizeRelayPath(process.env.PUBLIC_RELAY_PATH || "/digimamad");
const RELAY_PATH = normalizeRelayPath(process.env.RELAY_PATH || "/");

function normalizeRelayPath(rawPath) {
  if (!rawPath) return "";
  let path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

function normalizeIncomingPath(pathname) {
  if (!pathname) return "/";
  let normalized = String(pathname).replace(/\/{2,}/g, "/");
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  if (normalized.length > 1 && normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  return normalized;
}

async function handler(req, res) {
  try {
    const host = req.headers.host || "localhost";
    const url = new URL(req.url || "/", `https://${host}`);
    const normalizedPath = normalizeIncomingPath(url.pathname);

    if (!normalizedPath.startsWith(PUBLIC_RELAY_PATH)) {
      res.statusCode = 404;
      return res.end("Not Found");
    }

    const upstreamPath = normalizedPath === PUBLIC_RELAY_PATH 
      ? RELAY_PATH 
      : normalizedPath.replace(PUBLIC_RELAY_PATH, RELAY_PATH || "");

    const targetUrl = `${TARGET_BASE}${upstreamPath}${url.search || ""}`;

    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      const lower = key.toLowerCase();
      if (["host", "connection", "x-relay-key"].includes(lower)) continue;
      headers[lower] = value;
    }

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req,
      duplex: "half",
      redirect: "manual",
    });

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
  console.log(`🚀 XHTTP Relay running on port ${PORT} | Target: ${TARGET_BASE}`);
});
