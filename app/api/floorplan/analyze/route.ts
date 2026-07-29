import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 300;

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    walls: {
      type: "array",
      description: "Every wall segment in the floor plan, as straight lines in image pixel coordinates",
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
        "How many image pixels correspond to one real-world meter, derived from printed dimension labels or scale bars. Null if no scale information is visible.",
    },
    notes: {
      type: "string",
      description: "Brief notes about ambiguities or assumptions",
    },
  },
  required: ["walls", "openings", "estimatedPixelsPerMeter", "notes"],
  additionalProperties: false,
} as const;

const PROMPT = `Analyze this floor plan image and extract its structure.

Rules:
- Trace every wall as a straight segment in IMAGE PIXEL coordinates (origin top-left, y down). Walls are usually drawn as thick dark lines or double lines. Use the centerline of each wall.
- Split walls at corners and junctions so each segment is straight.
- Connected walls must share exact endpoint coordinates so corners are closed.
- Identify doors (arc/swing symbols or gaps in walls) and windows (thin double/triple lines within walls) and place them on the nearest wall using fractional positions t0..t1 along that wall.
- If the plan shows dimension labels (e.g. "3.5m", "12'"), a scale bar, or grid, use them to estimate pixels-per-meter. Otherwise return null.
- Only include actual walls — ignore furniture, fixtures, text, and decorative elements.`;

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
  const allowedTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  if (!allowedTypes.includes(mediaType)) {
    return NextResponse.json({ error: `Unsupported image type: ${mediaType}` }, { status: 400 });
  }

  const client = new Anthropic();

  try {
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      output_config: {
        format: { type: "json_schema", schema: ANALYSIS_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
                data: imageBase64,
              },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json(
        { error: "The AI declined to analyze this image. Try a different floor plan image." },
        { status: 422 }
      );
    }
    if (response.stop_reason === "max_tokens") {
      return NextResponse.json(
        { error: "The floor plan is too complex to analyze in one pass. Try a simpler or cropped image." },
        { status: 422 }
      );
    }

    const text = response.content.find((b) => b.type === "text")?.text;
    if (!text) {
      return NextResponse.json({ error: "Empty analysis response" }, { status: 502 });
    }
    return NextResponse.json(JSON.parse(text));
  } catch (err) {
    console.error("Floor plan analysis failed:", err);
    const message = err instanceof Error ? err.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
