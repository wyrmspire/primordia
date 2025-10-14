import { URL } from "node:url";
const MAX_MS   = parseInt(process.env.PROXY_MAX_MS || "8000", 10);
const MAX_BYTES = parseInt(process.env.PROXY_MAX_BYTES || "1048576", 10);
const ALLOWLIST = (process.env.PROXY_ALLOWLIST || "").split(",").map(s => s.trim()).filter(Boolean);
function assertAllowed(target) {
  let u;
  try { u = new URL(target); } catch { throw new Error("Invalid URL"); }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http/https allowed");
  if (ALLOWLIST.length > 0) {
    const origin = `${u.protocol}//${u.host}`;
    const hostname = u.hostname;
    const isAllowed = ALLOWLIST.some(pattern => {
      if (pattern.startsWith('https://*')) {
        const domain = pattern.substring('https://*'.length);
        return hostname.endsWith(domain);
      }
      return pattern === origin;
    });
    if (!isAllowed) throw new Error(`Origin not allowed: ${origin}`);
  }
  return u.toString();
}
async function readCapped(res, cap) {
  const ct = res.headers.get("content-type") || "";
  const isText = /\b(text\/|application\/(json|xml|javascript|x-www-form-urlencoded))/i.test(ct);
  if (isText) {
    const text = await res.text();
    const sliced = text.length > cap ? text.slice(0, cap) : text;
    return { kind: ct.includes("json") ? "json-text" : "text", value: sliced };
  } else {
    const buf = Buffer.from(await res.arrayBuffer());
    const trimmed = buf.length > cap ? buf.subarray(0, cap) : buf;
    return { kind: "base64", value: trimmed.toString("base64") };
  }
}
export async function proxyHandler(req, res) {
  try {
    const started = Date.now();
    const { url, method = "GET", headers = {}, body = null } = req.body || {};
    if (!url) return res.status(400).json({ ok: false, error: "Missing 'url'." });
    const safeUrl = assertAllowed(url);
    const cleanHeaders = Object.fromEntries(
      Object.entries(headers || {}).filter(([k]) => !/^(connection|transfer-encoding|content-length|host)$/i.test(k))
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("timeout")), Math.min(MAX_MS, 60000));
    let fetchBody = body;
    if (fetchBody && typeof fetchBody === "object" && (/json/i.test(cleanHeaders["content-type"] || ""))) {
      fetchBody = JSON.stringify(fetchBody);
    }
    const resp = await fetch(safeUrl, { method, headers: cleanHeaders, body: ["GET","HEAD"].includes(method.toUpperCase()) ? undefined : fetchBody, signal: controller.signal, redirect: "follow",
    }).catch((e) => { throw (e.name === "AbortError" ? new Error("Upstream timeout") : e); }).finally(() => clearTimeout(timeout));
    const bodyRead = await readCapped(resp, MAX_BYTES);
    const durationMs = Date.now() - started;
    const hdrs = {};
    ["content-type","cache-control","date","etag","server","content-length","location"].forEach(h => {
      const v = resp.headers.get(h);
      if (v) hdrs[h] = v;
    });
    return res.status(200).json({ ok: true, status: resp.status, statusText: resp.statusText, durationMs, headers: hdrs, body: bodyRead, truncated: (hdrs["content-length"] ? parseInt(hdrs["content-length"],10) > MAX_BYTES : false) });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err?.message || String(err) });
  }
}
