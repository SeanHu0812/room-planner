import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { isBlockedUrl } from "@/lib/server/url-guard";

export const maxDuration = 300;

const PRODUCT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Product name, cleaned up (no SKU codes or site name)" },
    brand: { type: ["string", "null"] },
    price: { type: ["number", "null"], description: "Numeric price without currency symbol" },
    currency: { type: ["string", "null"], description: "ISO currency code like USD, EUR" },
    imageUrls: {
      type: "array",
      items: { type: "string" },
      description:
        "Absolute URLs of product photos, best first. Prefer images showing the whole product on a clean background.",
    },
    dimensions: {
      type: ["object", "null"],
      description:
        "Overall assembled product dimensions. width = along the front face (left-right), depth = front-to-back, height = floor-to-top. Null ONLY if no dimensions appear anywhere in the content.",
      properties: {
        width: { type: "number" },
        depth: { type: "number" },
        height: { type: "number" },
        unit: { type: "string", enum: ["cm", "in", "m", "mm"] },
      },
      required: ["width", "depth", "height", "unit"],
      additionalProperties: false,
    },
    category: {
      type: "string",
      enum: [
        "sofa",
        "armchair",
        "chair",
        "table",
        "coffee_table",
        "desk",
        "bed",
        "dresser",
        "bookshelf",
        "cabinet",
        "lamp",
        "rug",
        "tv_stand",
        "other",
      ],
    },
  },
  required: ["name", "brand", "price", "currency", "imageUrls", "dimensions", "category"],
  additionalProperties: false,
} as const;

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/** Pull the highest-signal parts out of raw HTML: JSON-LD, OG/meta tags, title, and readable text. */
function condenseHtml(html: string, baseUrl: string): string {
  const parts: string[] = [];

  const jsonLd = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of jsonLd.slice(0, 8)) {
    const raw = m[1].trim();
    if (raw.length < 30000) parts.push(`JSON-LD:\n${raw}`);
  }

  const metaTags = [...html.matchAll(/<meta[^>]+(?:property|name)=["'](og:[^"']+|twitter:[^"']+|description|product:[^"']+)["'][^>]*>/gi)];
  if (metaTags.length) {
    parts.push("META TAGS:\n" + metaTags.map((m) => m[0]).slice(0, 60).join("\n"));
  }

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) parts.push(`TITLE: ${title[1].trim()}`);

  // Strip scripts/styles/svg and tags, collapse whitespace
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  parts.push(`PAGE TEXT:\n${text.slice(0, 15000)}`);

  parts.push(`PAGE URL: ${baseUrl}`);
  return parts.join("\n\n").slice(0, 80000);
}

/** Heuristic: did we hit a bot wall / consent page instead of the product? */
function looksBlocked(html: string, status: number): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  const lower = html.slice(0, 5000).toLowerCase();
  return (
    lower.includes("captcha") ||
    lower.includes("are you a robot") ||
    lower.includes("access denied") ||
    lower.includes("cf-challenge") ||
    (html.length < 2000 && !lower.includes("<title"))
  );
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server." },
      { status: 500 }
    );
  }

  let body: { url?: string; pastedText?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let content: string;
  let sourceUrl = body.url ?? null;

  if (body.pastedText && body.pastedText.trim().length > 20) {
    // Fallback path: user pasted the product page content manually
    content = `PASTED PRODUCT PAGE CONTENT:\n${body.pastedText.slice(0, 80000)}${
      sourceUrl ? `\n\nPAGE URL: ${sourceUrl}` : ""
    }`;
  } else if (body.url) {
    const guard = isBlockedUrl(body.url);
    if (guard) return NextResponse.json({ error: guard }, { status: 400 });

    let res: Response;
    try {
      res = await fetch(body.url, {
        headers: BROWSER_HEADERS,
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      return NextResponse.json(
        { error: "Could not reach that URL.", blocked: true },
        { status: 422 }
      );
    }
    const html = await res.text();
    if (looksBlocked(html, res.status)) {
      return NextResponse.json(
        {
          error: "This site blocks automated access. Paste the product page text instead.",
          blocked: true,
        },
        { status: 422 }
      );
    }
    sourceUrl = res.url || body.url;
    content = condenseHtml(html, sourceUrl);
  } else {
    return NextResponse.json({ error: "Provide a url or pastedText" }, { status: 400 });
  }

  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      output_config: { format: { type: "json_schema", schema: PRODUCT_SCHEMA } },
      messages: [
        {
          role: "user",
          content: `Extract structured product data for the piece of furniture on this shopping page. Search the JSON-LD, meta tags, and page text carefully for dimensions — they are often in a specifications/measurements section (look for width/depth/height, W x D x H, or similar). Resolve relative image URLs against the page URL. If several products appear, extract the main one.\n\n${content}`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json({ error: "The AI declined to process this page." }, { status: 422 });
    }
    const text = response.content.find((b) => b.type === "text")?.text;
    if (!text) return NextResponse.json({ error: "Empty extraction response" }, { status: 502 });

    return NextResponse.json({ product: JSON.parse(text), sourceUrl });
  } catch (err) {
    console.error("Product extraction failed:", err);
    const message = err instanceof Error ? err.message : "Extraction failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
