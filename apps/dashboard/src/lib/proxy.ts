/* ──────────────────────────────────────────────────────────────
   Runtime reverse-proxy helper for Next.js API routes.
   Reads backend URLs from env vars at REQUEST time (not build time).
   ────────────────────────────────────────────────────────────── */
import { NextRequest, NextResponse } from "next/server";

const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
  "host",
]);

/**
 * Headers that should be stripped from the upstream response.
 * Node.js fetch() auto-decompresses gzip/br, so forwarding
 * content-encoding would cause the browser to fail decoding
 * already-decompressed data ("cannot decode raw data").
 */
const STRIP_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
]);

/**
 * Create a proxy handler that forwards requests to a backend service.
 * The `envKey` is read at runtime so the image stays portable.
 */
export function createProxyHandler(envKey: string, fallback: string) {
  async function handler(
    req: NextRequest,
    { params }: { params: Promise<{ path?: string[] }> },
  ) {
    const { path } = await params;
    const upstream = process.env[envKey] || fallback;
    const suffix = path ? path.join("/") : "";
    const target = `${upstream}/${suffix}${req.nextUrl.search}`;

    // Forward headers, stripping hop-by-hop
    const headers = new Headers();
    req.headers.forEach((v, k) => {
      if (!HOP_HEADERS.has(k.toLowerCase())) headers.set(k, v);
    });

    // Read body as bytes to avoid stream issues in standalone mode
    let body: ArrayBuffer | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      try {
        body = await req.arrayBuffer();
      } catch {
        // no body
      }
    }

    try {
      const upstreamRes = await fetch(target, {
        method: req.method,
        headers,
        body,
      });

      // Forward response headers, stripping encoding headers
      // (Node.js fetch auto-decompresses, so content-encoding is stale)
      const resHeaders = new Headers();
      upstreamRes.headers.forEach((v, k) => {
        const lk = k.toLowerCase();
        if (!HOP_HEADERS.has(lk) && !STRIP_RESPONSE_HEADERS.has(lk)) {
          resHeaders.set(k, v);
        }
      });

      return new NextResponse(upstreamRes.body, {
        status: upstreamRes.status,
        statusText: upstreamRes.statusText,
        headers: resHeaders,
      });
    } catch (err) {
      console.error(`Proxy error [${envKey}] → ${target}:`, err);
      return NextResponse.json(
        { error: `Upstream ${envKey} unreachable`, target },
        { status: 502 },
      );
    }
  }

  return { GET: handler, POST: handler, PUT: handler, DELETE: handler, PATCH: handler };
}
