import { createServer } from 'node:http';
import { PassThrough, Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setDefaultResultOrder } from "node:dns";

const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");
const PUBLIC_RELAY_PATH = normalizeRelayPath(process.env.PUBLIC_RELAY_PATH || "/api");
const RELAY_PATH = normalizeRelayPath(process.env.RELAY_PATH || "/relay");
const RELAY_KEY = (process.env.RELAY_KEY || "").trim();

const MAX_INFLIGHT = 128;
const UPSTREAM_TIMEOUT_MS = 30000;

let inFlight = 0;

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
  if (!TARGET_BASE) {
    res.statusCode = 500;
    return res.end("TARGET_DOMAIN is not set");
  }

  try {
    const host = req.headers.host || "localhost";
    const url = new URL(req.url || "/", `https://${host}`);
    const normalizedPath = normalizeIncomingPath(url.pathname);

    if (!normalizedPath.startsWith(PUBLIC_RELAY_PATH)) {
      res.statusCode = 404;
      return res.end("Not Found");
    }

    const upstreamPath = normalizedPath.replace(PUBLIC_RELAY_PATH, RELAY_PATH || "");

    if (RELAY_KEY) {
      const token = (req.headers["x-relay-key"] || "").toString().trim();
      if (token !== RELAY_KEY) {
        res.statusCode = 403;
        return res.end("Forbidden");
      }
    }

    if (inFlight >= MAX_INFLIGHT) {
      res.statusCode = 503;
      return res.end("Server Busy");
    }
    inFlight++;

    const targetUrl = `${TARGET_BASE}${upstreamPath}${url.search || ""}`;

    const headers = { ...req.headers };
    delete headers.host;
    delete headers.connection;
    delete headers["x-relay-key"];

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? req : undefined,
      duplex: "half",
      redirect: "manual",
    });

    res.statusCode = upstream.status;
    for (const [key, value] of upstream.headers) {
      if (!["connection", "transfer-encoding"].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    }

    if (upstream.body) {
      const reader = Readable.fromWeb(upstream.body);
      await pipeline(reader, res);
    } else {
      res.end();
    }

  } catch (err) {
    if (!res.headersSent) {
      res.statusCode = 502;
      res.end("Bad Gateway");
    }
  } finally {
    inFlight = Math.max(0, inFlight - 1);
  }
}

const server = createServer(handler);
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 XHTTP Relay running on port ${PORT}`);
});
