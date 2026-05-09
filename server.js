import { createServer } from 'node:http';
import { PassThrough, Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setDefaultResultOrder } from "node:dns";

const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");
const UPSTREAM_DNS_ORDER = (process.env.UPSTREAM_DNS_ORDER || "ipv4first").trim().toLowerCase();
const RELAY_PATH = normalizeRelayPath(process.env.RELAY_PATH || "/relay");
const PUBLIC_RELAY_PATH = normalizeRelayPath(process.env.PUBLIC_RELAY_PATH || "/");
const RELAY_KEY = (process.env.RELAY_KEY || "").trim();
const UPSTREAM_TIMEOUT_MS = parsePositiveInt(process.env.UPSTREAM_TIMEOUT_MS, 25000, 1000);
const MAX_INFLIGHT = parsePositiveInt(process.env.MAX_INFLIGHT, 128, 1);
const MAX_UP_BPS = parseNonNegativeInt(process.env.MAX_UP_BPS, 2621440);
const MAX_DOWN_BPS = parseNonNegativeInt(process.env.MAX_DOWN_BPS, 2621440);

// بقیه توابع helper (از index.js اصلی) رو کامل کپی کن
// برای کوتاه کردن پیام، اینجا فقط ساختار اصلی رو می‌دم. اگر بخوای کاملش رو برات می‌فرستم.

function normalizeRelayPath(rawPath) { /* کپی از api/index.js */ }
function normalizeIncomingPath(pathname) { /* کپی */ }
// ... تمام توابع دیگر (shouldForwardHeader, isAllowedRelayPath و غیره) رو از api/index.js کپی کن.

async function handler(req, res) {
  // دقیقاً همان کد handler داخل api/index.js رو اینجا paste کن
  // فقط export default رو حذف کن و به function handler تبدیلش کن.
}

const server = createServer(handler);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 XHTTP Relay listening on port ${PORT}`);
});
