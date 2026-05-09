import { createServer } from 'node:http';
import { PassThrough, Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setDefaultResultOrder } from "node:dns";

const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");
const UPSTREAM_DNS_ORDER = (process.env.UPSTREAM_DNS_ORDER || "ipv4first").trim().toLowerCase();
const PLATFORM_HEADER_PREFIX = `x-${String.fromCharCode(118, 101, 114, 99, 101, 108)}-`;
const RELAY_PATH = normalizeRelayPath(process.env.RELAY_PATH || "/relay");
const PUBLIC_RELAY_PATH = normalizeRelayPath(process.env.PUBLIC_RELAY_PATH || "/");
const RELAY_KEY = (process.env.RELAY_KEY || "").trim();
const UPSTREAM_TIMEOUT_MS = parsePositiveInt(process.env.UPSTREAM_TIMEOUT_MS, 25000, 1000);
const MAX_INFLIGHT = parsePositiveInt(process.env.MAX_INFLIGHT, 128, 1);
const MAX_UP_BPS = parseNonNegativeInt(process.env.MAX_UP_BPS, 2621440);
const MAX_DOWN_BPS = parseNonNegativeInt(process.env.MAX_DOWN_BPS, 2621440);
const SUCCESS_LOG_SAMPLE_RATE = clampNumber(parseFloat(process.env.SUCCESS_LOG_SAMPLE_RATE || "0"), 0, 1);
const SUCCESS_LOG_MIN_DURATION_MS = parseNonNegativeInt(process.env.SUCCESS_LOG_MIN_DURATION_MS, 3000);
const ERROR_LOG_MIN_INTERVAL_MS = parseNonNegativeInt(process.env.ERROR_LOG_MIN_INTERVAL_MS, 5000);

const GLOBAL_UPLOAD_LIMITER = createGlobalLimiter(MAX_UP_BPS);
const GLOBAL_DOWNLOAD_LIMITER = createGlobalLimiter(MAX_DOWN_BPS);

applyDnsPreference();

const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST"]);
const FORWARD_HEADER_EXACT = new Set(["accept","accept-encoding","accept-language","cache-control","content-length","content-type","pragma","range","referer","user-agent"]);
const FORWARD_HEADER_PREFIXES = ["sec-ch-", "sec-fetch-"];

const STRIP_HEADERS = new Set(["host","connection","proxy-connection","keep-alive","via","proxy-authenticate","proxy-authorization","te","trailer","transfer-encoding","upgrade","forwarded","x-forwarded-host","x-forwarded-proto","x-forwarded-port","x-forwarded-for","x-real-ip"]);

let inFlight = 0;
const logState = { timeout: { lastAt: 0, suppressed: 0 }, error: { lastAt: 0, suppressed: 0 } };

async function handler(req, res) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  let slotAcquired = false;

  if (!TARGET_BASE) {
    res.statusCode = 500;
    return res.end("Misconfigured: TARGET_DOMAIN is not set");
  }
  if (!RELAY_PATH || RELAY_PATH === "/") {
    res.statusCode = 500;
    return res.end("Misconfigured: RELAY_PATH is invalid");
  }
  if (!PUBLIC_RELAY_PATH) {
    res.statusCode = 500;
    return res.end("Misconfigured: PUBLIC_RELAY_PATH is not set");
  }

  try {
    const host = req.headers.host || "localhost";
    const url = new URL(req.url || "/", `https://${host}`);
    const normalizedPath = normalizeIncomingPath(url.pathname);

    if (!isAllowedRelayPath(normalizedPath, PUBLIC_RELAY_PATH))
