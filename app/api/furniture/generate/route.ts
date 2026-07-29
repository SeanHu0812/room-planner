import { NextRequest, NextResponse } from "next/server";
import { isBlockedUrl } from "@/lib/server/url-guard";

export const maxDuration = 120;

const MESHY_BASE = "https://api.meshy.ai/openapi/v1/image-to-3d";

function meshyHeaders() {
  return {
    Authorization: `Bearer ${process.env.MESHY_API_KEY}`,
    "Content-Type": "application/json",
  };
}

function requireKey(): NextResponse | null {
  if (!process.env.MESHY_API_KEY) {
    return NextResponse.json(
      {
        error:
          "MESHY_API_KEY is not set. Add it to .env.local and restart the dev server. Get a key at https://www.meshy.ai",
      },
      { status: 500 }
    );
  }
  return null;
}

/**
 * POST { imageUrl } — starts a Meshy image-to-3D task.
 * The product image is fetched server-side and sent as a base64 data URI,
 * so this works even when the app itself isn't publicly reachable.
 */
export async function POST(req: NextRequest) {
  const keyErr = requireKey();
  if (keyErr) return keyErr;

  let body: { imageUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.imageUrl) {
    return NextResponse.json({ error: "imageUrl is required" }, { status: 400 });
  }
  const guard = isBlockedUrl(body.imageUrl);
  if (guard) return NextResponse.json({ error: guard }, { status: 400 });

  // Fetch the product image and convert to a data URI for Meshy
  let dataUri: string;
  try {
    const imgRes = await fetch(body.imageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "image/png,image/jpeg,*/*;q=0.8",
        Referer: new URL(body.imageUrl).origin + "/",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!imgRes.ok) throw new Error(`image fetch returned ${imgRes.status}`);
    const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
    if (!/image\/(png|jpe?g)/.test(contentType)) {
      // Meshy accepts jpg/jpeg/png; webp etc. would need conversion — surface clearly.
      return NextResponse.json(
        { error: `Product image is ${contentType}; Meshy needs PNG or JPEG. Try another image.` },
        { status: 415 }
      );
    }
    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (buf.byteLength > 15 * 1024 * 1024) {
      return NextResponse.json({ error: "Product image too large for generation" }, { status: 413 });
    }
    dataUri = `data:${contentType.split(";")[0]};base64,${buf.toString("base64")}`;
  } catch (err) {
    console.error("Failed to fetch product image for Meshy:", err);
    return NextResponse.json({ error: "Could not download the product image" }, { status: 502 });
  }

  try {
    const res = await fetch(MESHY_BASE, {
      method: "POST",
      headers: meshyHeaders(),
      body: JSON.stringify({
        image_url: dataUri,
        ai_model: "latest",
        should_texture: true,
        enable_pbr: true,
      }),
      signal: AbortSignal.timeout(60000),
    });
    const json = await res.json();
    if (!res.ok) {
      console.error("Meshy task creation failed:", res.status, json);
      return NextResponse.json(
        { error: json?.message ?? `Meshy returned ${res.status}` },
        { status: 502 }
      );
    }
    return NextResponse.json({ taskId: json.result });
  } catch (err) {
    console.error("Meshy request failed:", err);
    return NextResponse.json({ error: "Could not reach Meshy API" }, { status: 502 });
  }
}

/** GET ?taskId=... — polls task status. Returns { status, progress, modelUrl, thumbnailUrl } */
export async function GET(req: NextRequest) {
  const keyErr = requireKey();
  if (keyErr) return keyErr;

  const taskId = req.nextUrl.searchParams.get("taskId");
  if (!taskId || !/^[\w-]+$/.test(taskId)) {
    return NextResponse.json({ error: "Valid taskId is required" }, { status: 400 });
  }

  try {
    const res = await fetch(`${MESHY_BASE}/${taskId}`, {
      headers: meshyHeaders(),
      signal: AbortSignal.timeout(30000),
    });
    const json = await res.json();
    if (!res.ok) {
      return NextResponse.json(
        { error: json?.message ?? `Meshy returned ${res.status}` },
        { status: 502 }
      );
    }
    return NextResponse.json({
      status: json.status as "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED",
      progress: json.progress ?? 0,
      modelUrl: json.model_urls?.glb ?? null,
      thumbnailUrl: json.thumbnail_url ?? null,
      error: json.task_error?.message ?? null,
    });
  } catch (err) {
    console.error("Meshy poll failed:", err);
    return NextResponse.json({ error: "Could not reach Meshy API" }, { status: 502 });
  }
}
