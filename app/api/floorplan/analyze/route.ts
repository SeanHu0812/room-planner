import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { postprocessWalls, Seg } from "@/lib/server/wall-postprocess";

export const maxDuration = 300;

type MediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    imageWidth: { type: "number", description: "Width in pixels of the image you analyzed" },
    imageHeight: { type: "number", description: "Height in pixels of the image you analyzed" },
    walls: {
      type: "array",
      description: "Every wall segment, as straight centerlines in image pixel coordinates",
      items: {
        type: "object",
        properties: {
          x1: { type: "number" },
          y1: { type: "number" },
          x2: { type: "number" },
          y2: { type: "number" },
        },
        required: ["x1", "y1", "x2", "y2"],
        additionalProperties: false,
      },
    },
    openings: {
      type: "array",
      description: "Doors and windows located on walls",
      items: {
        type: "object",
        properties: {
          wallIndex: {
            type: "integer",
            description: "Index into the walls array of the wall this opening is on",
          },
          type: { type: "string", enum: ["door", "window"] },
          t0: {
            type: "number",
            description: "Opening start as a fraction (0-1) along the wall from (x1,y1) to (x2,y2)",
          },
          t1: { type: "number", description: "Opening end fraction, greater than t0" },
        },
        required: ["wallIndex", "type", "t0", "t1"],
        additionalProperties: false,
      },
    },
    estimatedPixelsPerMeter: {
      type: ["number", "null"],
      description:
        "Image pixels per real-world METER. Derive from printed dimension labels (convert feet/inches to meters: 1 ft = 0.3048 m) or scale bars. Null only if no scale info is visible anywhere.",
    },
    notes: { type: "string", description: "Brief notes about ambiguities or assumptions" },
  },
  required: ["imageWidth", "imageHeight", "walls", "openings", "estimatedPixelsPerMeter", "notes"],
  additionalProperties: false,
} as const;

function detectionPrompt(width: number, height: number): string {
  return `Analyze this floor plan image (${width}×${height} pixels, origin top-left, y down) and extract its wall structure precisely.

Work systematically:
1. First trace the OUTER BOUNDARY of the unit: follow the thick exterior walls around the whole perimeter, segment by segment. The boundary must form a closed loop — consecutive segments share exact endpoint coordinates. Exterior walls are usually the thickest dark/gray bands; use each wall's CENTERLINE.
2. Then add every INTERIOR partition wall: walls between rooms, around bathrooms, closets (CL/WIC), kitchens, foyers. Include short stub walls beside doorways, and partition walls inside walk-in closets when they are drawn as full-thickness wall bands (thin single lines inside closets are shelving, not walls). Interior partition endpoints must land exactly on the walls they meet (T-junctions) or on corner points.
3. Almost all walls in apartment floor plans are exactly horizontal or vertical. Only output a diagonal wall if the drawing clearly shows one. Keep horizontal walls at constant y, vertical walls at constant x.
4. A doorway gap in a wall is still one wall: draw the wall THROUGH the gap and record the gap as a door opening (t0..t1 along the wall). Door swing arcs mark doors. Thin double/triple lines within exterior walls are windows.
5. Read printed dimension labels (e.g. "12'-5\\" x 10'-8\\"", "9.93 ft", "3.5 m") and measurement annotations. Pick one clearly-labeled straight distance, measure its pixel length, and compute pixels per METER (1 ft = 0.3048 m). Cross-check with a second label if available.
6. Floor plans are often annotated with hand-drawn colored lines (red/blue measurement lines with length labels, arrows, highlights). These annotation lines are NOT walls — never trace them as walls — but their labels are excellent scale information: an annotation line's pixel length divided by its labeled real length gives you pixels-per-meter directly.

Precision matters more than speed: before answering, double-check that coordinates you output actually lie on the drawn walls (e.g. a wall you place at x=500 must be at the dark band near x=500 in the image), corners close, and no room is missing its walls. Do NOT include furniture, fixtures, appliances, counters, text, dimension lines, or decorative hatching as walls.`;
}

const REFINE_PROMPT = `The first image is the original floor plan. The second image is the SAME floor plan with a previous wall-detection attempt drawn on top (bright MAGENTA lines = detected walls, magenta dots = endpoints). Ignore any other colored markings (red/blue hand-drawn measurement annotations are part of the original plan, not the detection).

Compare them carefully and output a corrected, COMPLETE wall list (not a diff):
- Remove magenta lines that don't correspond to real walls (furniture, counters, dimension/annotation lines).
- Add walls that are missing (check every room: bedrooms, bathrooms, closets, kitchen, foyer — each room must be fully enclosed by walls, except where it opens into another space). Full-thickness wall bands inside walk-in closets are partition walls — keep them; only thin single lines are shelving.
- Fix misaligned lines: each magenta line should sit ON the dark wall band it represents; corners must close; interior walls must reach the walls they meet.
- Keep walls axis-aligned (constant x or constant y) unless the drawing clearly shows a diagonal.
- Re-check doors (swing arcs / gaps) and windows, and the pixels-per-meter estimate from dimension labels (1 ft = 0.3048 m).

Output the full corrected analysis.`;

async function renderOverlay(
  imageBuffer: Buffer,
  walls: Seg[],
  width: number,
  height: number
): Promise<Buffer> {
  const lines = walls
    .map(
      (w) =>
        `<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="#ff00ee" stroke-width="5" stroke-opacity="0.85" stroke-linecap="round"/>` +
        `<circle cx="${w.x1}" cy="${w.y1}" r="7" fill="#ff00ee" fill-opacity="0.9"/>` +
        `<circle cx="${w.x2}" cy="${w.y2}" r="7" fill="#ff00ee" fill-opacity="0.9"/>`
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${lines}</svg>`;
  return sharp(imageBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

interface RawAnalysis {
  imageWidth: number;
  imageHeight: number;
  walls: Seg[];
  openings: { wallIndex: number; type: "door" | "window"; t0: number; t1: number }[];
  estimatedPixelsPerMeter: number | null;
  notes: string;
}

/** Rescale coordinates if the model reported a different image size than actual. */
function normalizeCoords(a: RawAnalysis, width: number, height: number): RawAnalysis {
  const sx = a.imageWidth > 0 ? width / a.imageWidth : 1;
  const sy = a.imageHeight > 0 ? height / a.imageHeight : 1;
  if (Math.abs(sx - 1) < 0.02 && Math.abs(sy - 1) < 0.02) return a;
  return {
    ...a,
    walls: a.walls.map((w) => ({ x1: w.x1 * sx, y1: w.y1 * sy, x2: w.x2 * sx, y2: w.y2 * sy })),
    estimatedPixelsPerMeter:
      a.estimatedPixelsPerMeter != null ? a.estimatedPixelsPerMeter * (sx + sy) / 2 : null,
  };
}

async function callClaude(
  client: Anthropic,
  content: Anthropic.MessageParam["content"],
  effort: "medium" | "high"
): Promise<RawAnalysis> {
  const stream = client.messages.stream({
    model: "claude-opus-5",
    max_tokens: 32000,
    output_config: {
      effort,
      format: { type: "json_schema", schema: ANALYSIS_SCHEMA },
    },
    messages: [{ role: "user", content }],
  });
  const response = await stream.finalMessage();
  if (response.stop_reason === "refusal") {
    throw new Error("The AI declined to analyze this image. Try a different floor plan image.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("The floor plan is too complex to analyze in one pass. Try a cropped image.");
  }
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Empty analysis response");
  return JSON.parse(text) as RawAnalysis;
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server." },
      { status: 500 }
    );
  }

  let body: { imageBase64?: string; mediaType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { imageBase64, mediaType } = body;
  if (!imageBase64 || !mediaType) {
    return NextResponse.json({ error: "imageBase64 and mediaType are required" }, { status: 400 });
  }
  const allowedTypes: MediaType[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  if (!allowedTypes.includes(mediaType as MediaType)) {
    return NextResponse.json({ error: `Unsupported image type: ${mediaType}` }, { status: 400 });
  }

  const imageBuffer = Buffer.from(imageBase64, "base64");
  let width: number;
  let height: number;
  try {
    const meta = await sharp(imageBuffer).metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
    if (!width || !height) throw new Error("no dimensions");
  } catch {
    return NextResponse.json({ error: "Could not read image dimensions" }, { status: 400 });
  }

  const client = new Anthropic();
  const imageBlock = {
    type: "image" as const,
    source: { type: "base64" as const, media_type: mediaType as MediaType, data: imageBase64 },
  };

  try {
    // Pass 1: structured detection. High effort matters here — at medium the
    // model can drop entire boundary walls that pass 2 then fails to recover.
    const first = normalizeCoords(
      await callClaude(
        client,
        [imageBlock, { type: "text", text: detectionPrompt(width, height) }],
        "high"
      ),
      width,
      height
    );

    // Pass 2: draw pass-1 walls over the plan and let the model correct itself
    let refined = first;
    if (first.walls.length > 0) {
      try {
        const overlay = await renderOverlay(imageBuffer, first.walls, width, height);
        const overlayBlock = {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: "image/jpeg" as const,
            data: overlay.toString("base64"),
          },
        };
        refined = normalizeCoords(
          await callClaude(
            client,
            [imageBlock, overlayBlock, { type: "text", text: REFINE_PROMPT }],
            "high"
          ),
          width,
          height
        );
        if (refined.walls.length === 0) refined = first; // never regress to nothing
      } catch (e) {
        console.error("Refinement pass failed; using first-pass result:", e);
      }
    }

    // Deterministic cleanup: axis snap, corner weld, T-junctions
    const { walls, indexMap } = postprocessWalls(refined.walls, width, height);
    const openings = refined.openings
      .filter((o) => o.wallIndex >= 0 && o.wallIndex < refined.walls.length)
      .map((o) => ({ ...o, wallIndex: indexMap[o.wallIndex] }))
      .filter((o) => o.wallIndex >= 0);

    return NextResponse.json({
      walls,
      openings,
      estimatedPixelsPerMeter: refined.estimatedPixelsPerMeter,
      notes: refined.notes,
    });
  } catch (err) {
    console.error("Floor plan analysis failed:", err);
    const message = err instanceof Error ? err.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
