import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;

/** Proxies generated GLB downloads from Meshy's CDN (avoids CORS on the client). */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "url param required" }, { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }
  // Only allow Meshy-hosted assets through this proxy
  if (parsed.protocol !== "https:" || !/(^|\.)meshy\.ai$/.test(parsed.hostname)) {
    return NextResponse.json({ error: "Only Meshy asset URLs are allowed" }, { status: 400 });
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
    if (!res.ok) {
      return NextResponse.json({ error: `Upstream returned ${res.status}` }, { status: 502 });
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 100 * 1024 * 1024) {
      return NextResponse.json({ error: "Model too large" }, { status: 413 });
    }
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "model/gltf-binary",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to download model" }, { status: 502 });
  }
}
