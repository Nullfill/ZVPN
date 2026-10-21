// Adapted from XHTTP-Installer — Netlify Edge Relay.
// Copyright (C) 2025 avaco_cloud. GPL-3.0; see LICENSE, NOTICE and UPSTREAM.md.
// https://github.com/avacocloud/XHTTP-Installer
// ZVPN: forward only the existing XHTTP endpoint, without changing the VPN server.
const PREFIX = "/zvpn-xhttp/";
const STRIP_HEADERS = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "forwarded", "cookie",
  "authorization", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port",
  "x-forwarded-for", "x-real-ip", "content-length", "accept-encoding",
]);
function response(status, message) {
  return new Response(message, { status, headers: { "cache-control": "no-store" } });
}

export function createRelay(targetOrigin, fetchUpstream = fetch) {
  let origin;
  try {
    const parsed = new URL(targetOrigin);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
        parsed.pathname !== "/" || parsed.search || parsed.hash) throw Error("Invalid origin");
    origin = parsed.origin;
  } catch { /* Missing or invalid configuration fails closed. */ }
  return async (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(PREFIX)) return response(404, "Not found");
    const suffix = url.pathname.slice(PREFIX.length);
    // XHTTP uses an unescaped session ID and optional numeric sequence. Reject
    // encoded separators/dot segments that an upstream web server could normalize
    // into a different route, including the admin API.
    if (suffix.length > 200 || !/^(?:[a-zA-Z0-9_-]+(?:\/[0-9]+)?\/?)?$/.test(suffix)) {
      return response(404, "Not found");
    }
    if (!["GET", "HEAD", "POST"].includes(request.method)) return response(405, "Method not allowed");
    if (!origin) return response(503, "Service not configured");
    const headers = new Headers();
    const connectionTokens = new Set((request.headers.get("connection") || "")
      .split(",").map(value => value.trim().toLowerCase()));
    for (const [key, value] of request.headers) {
      const lower = key.toLowerCase();
      if (STRIP_HEADERS.has(lower) || connectionTokens.has(lower) ||
          lower.startsWith("x-nf-") || lower.startsWith("x-netlify-")) continue;
      headers.set(key, value);
    }
    headers.set("accept-encoding", "identity");
    try {
      const upstream = await fetchUpstream(new URL(url.pathname + url.search, origin), {
        method: request.method, headers, redirect: "manual", signal: request.signal,
        ...(request.method === "POST" ? { body: request.body } : {}),
      });
      // An origin redirect must never send the client directly to the server.
      if (upstream.status >= 300 && upstream.status < 400) {
        await upstream.body?.cancel();
        return response(502, "Upstream redirect rejected");
      }
      const output = new Headers(upstream.headers);
      for (const key of ["transfer-encoding", "connection", "keep-alive", "set-cookie", "location", "content-length"]) output.delete(key);
      output.set("cache-control", "no-store");
      return new Response(upstream.body, { status: upstream.status, headers: output });
    } catch { return response(502, "Relay unavailable"); }
  };
}

export default function handler(request) {
  return createRelay(Netlify.env.get("TARGET_DOMAIN"))(request);
}
