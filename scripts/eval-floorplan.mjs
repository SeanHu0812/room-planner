// Scores the wall-detection API against the ground-truth fixture.
// Usage: node scripts/eval-floorplan.mjs [--url http://localhost:3000]
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const base = process.argv.includes("--url")
  ? process.argv[process.argv.indexOf("--url") + 1]
  : "http://localhost:3000";

const truth = JSON.parse(readFileSync("test/fixtures/apartment.json", "utf8"));
const png = readFileSync("test/fixtures/apartment.png");

const COVER_TOLERANCE = 15; // px point-to-segment distance to count as covered
const SAMPLE_STEP = 10; // px sampling interval along walls

function pointToSegDist(px, py, s) {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1) return Math.hypot(px - s.x1, py - s.y1);
  const t = Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / len2));
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
}

/** Fraction of segment `a`'s length lying within tolerance of any segment in `others`, plus mean distance of covered samples. */
function coverage(a, others) {
  const len = Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
  const n = Math.max(2, Math.ceil(len / SAMPLE_STEP));
  let covered = 0;
  let distSum = 0;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const px = a.x1 + (a.x2 - a.x1) * t;
    const py = a.y1 + (a.y2 - a.y1) * t;
    const d = Math.min(...others.map((o) => pointToSegDist(px, py, o)));
    if (d <= COVER_TOLERANCE) {
      covered++;
      distSum += d;
    }
  }
  return { frac: covered / (n + 1), meanDist: covered ? distSum / covered : null, len };
}

let json;
let secs = "0";
if (process.argv.includes("--rescore")) {
  json = JSON.parse(readFileSync("test/fixtures/last-result.json", "utf8"));
  console.log("Rescoring saved result…");
} else {
  console.log(`POST ${base}/api/floorplan/analyze (${truth.walls.length} ground-truth walls)…`);
  const t0 = Date.now();
  const res = await fetch(`${base}/api/floorplan/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64: png.toString("base64"), mediaType: "image/png" }),
  });
  json = await res.json();
  if (!res.ok) {
    console.error("API error:", json.error);
    process.exit(1);
  }
  secs = ((Date.now() - t0) / 1000).toFixed(0);
}

const pred = json.walls;
// Length-weighted coverage in both directions (robust to wall merges/splits)
let truthLen = 0;
let truthCovered = 0;
let distSum = 0;
let distN = 0;
const missedWalls = [];
for (const w of truth.walls) {
  const c = coverage(w, pred);
  truthLen += c.len;
  truthCovered += c.len * c.frac;
  if (c.meanDist != null) {
    distSum += c.meanDist * c.frac * c.len;
    distN += c.frac * c.len;
  }
  if (c.frac < 0.8) missedWalls.push({ w, frac: c.frac });
}
let predLen = 0;
let predCovered = 0;
for (const w of pred) {
  const c = coverage(w, truth.walls);
  predLen += c.len;
  predCovered += c.len * c.frac;
}

const recall = truthCovered / truthLen;
const precision = predLen ? predCovered / predLen : 0;
const meanDist = distN ? distSum / distN : Infinity;
const ppmErr = json.estimatedPixelsPerMeter
  ? Math.abs(json.estimatedPixelsPerMeter - truth.pixelsPerMeter) / truth.pixelsPerMeter
  : null;

console.log(`\n== Results (${secs}s) ==`);
console.log(`walls predicted:  ${pred.length} (truth: ${truth.walls.length})`);
console.log(`recall (length):   ${(recall * 100).toFixed(1)}%  of truth wall length covered by predictions`);
console.log(`precision (len):   ${(precision * 100).toFixed(1)}%  of predicted length lies on real walls`);
console.log(`mean deviation:    ${meanDist.toFixed(1)} px (covered portions)`);
console.log(
  `scale:             ${json.estimatedPixelsPerMeter?.toFixed(1) ?? "null"} px/m (truth ${truth.pixelsPerMeter}, err ${ppmErr != null ? (ppmErr * 100).toFixed(1) + "%" : "n/a"})`
);
console.log(`openings:          ${json.openings.length}`);
console.log(`notes:             ${json.notes?.slice(0, 200) ?? ""}`);

if (missedWalls.length) {
  console.log(`\nTruth walls <80% covered:`);
  for (const { w, frac } of missedWalls)
    console.log(`  (${w.x1},${w.y1})→(${w.x2},${w.y2})  ${(frac * 100).toFixed(0)}%`);
}

// Render a diagnostic overlay: green = truth, red = predicted
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${truth.imageWidth}" height="${truth.imageHeight}">
  ${truth.walls.map((w) => `<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="#00c853" stroke-width="9" stroke-opacity="0.45"/>`).join("")}
  ${pred.map((w) => `<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="#ff1744" stroke-width="3.5" stroke-opacity="0.95"/>`).join("")}
</svg>`;
await sharp(png).composite([{ input: Buffer.from(svg) }]).png().toFile("test/fixtures/eval-overlay.png");
writeFileSync("test/fixtures/last-result.json", JSON.stringify(json, null, 2));
console.log(`\nDiagnostic overlay: test/fixtures/eval-overlay.png (green=truth, red=predicted)`);
