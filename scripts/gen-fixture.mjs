// Generates a realistic 2BR/2BA apartment floor plan fixture (closely modeled
// on a real unit) as a PNG plus ground-truth wall JSON, for evaluating the
// AI wall-detection pipeline. Run: node scripts/gen-fixture.mjs
//
// v2 — replicates the hard features of real architectural plans:
//   - thick column/pier masses straddling the exterior walls
//   - a protruding entry vestibule bump in the top wall
//   - printed dimension lines with arrowheads and decimal-ft labels
//   - kitchen island + counters, subdivided WIC, herringbone floor texture
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const W = 1540;
const H = 1060;
const PPM = 100; // ground truth: 100 px per meter (30.48 px per foot)
const T = 14; // wall band thickness in px

const ftpx = (ft) => ft * 30.48;
const ftLabel = (px) => `${(px / 30.48).toFixed(2)} ft`;

// ---- Ground-truth wall centerlines ----
const walls = [
  // Top wall with entry vestibule bump (x 700..790 protrudes up to y=40)
  { x1: 100, y1: 100, x2: 700, y2: 100 },
  { x1: 700, y1: 100, x2: 700, y2: 40 },
  { x1: 700, y1: 40, x2: 790, y2: 40 },
  { x1: 790, y1: 40, x2: 790, y2: 100 },
  { x1: 790, y1: 100, x2: 1440, y2: 100 },
  // Right, bottom (stepped), left
  { x1: 1440, y1: 100, x2: 1440, y2: 990 },
  { x1: 1440, y1: 990, x2: 700, y2: 990 },
  { x1: 700, y1: 990, x2: 700, y2: 790 },
  { x1: 700, y1: 790, x2: 530, y2: 790 },
  { x1: 530, y1: 790, x2: 530, y2: 700 },
  { x1: 530, y1: 700, x2: 100, y2: 700 },
  { x1: 100, y1: 700, x2: 100, y2: 100 },
  // Bedroom (top-left)
  { x1: 480, y1: 100, x2: 480, y2: 520 }, // bedroom right
  { x1: 100, y1: 470, x2: 480, y2: 470 }, // bedroom bottom / CL top
  { x1: 100, y1: 560, x2: 530, y2: 560 }, // CL bottom / bath + W/D top
  { x1: 380, y1: 560, x2: 380, y2: 700 }, // bathroom right / W/D left
  { x1: 530, y1: 560, x2: 530, y2: 700 }, // W/D right / kitchen left
  // Foyer
  { x1: 860, y1: 650, x2: 860, y2: 990 }, // foyer left
  { x1: 860, y1: 650, x2: 1060, y2: 650 }, // foyer top
  { x1: 700, y1: 860, x2: 860, y2: 860 }, // foyer closet top
  // Master suite
  { x1: 1060, y1: 100, x2: 1060, y2: 990 }, // corridor / master divider
  { x1: 1060, y1: 720, x2: 1440, y2: 720 }, // master bath top
  { x1: 1210, y1: 500, x2: 1440, y2: 500 }, // WIC top
  { x1: 1210, y1: 500, x2: 1210, y2: 720 }, // WIC left
  { x1: 1300, y1: 640, x2: 1440, y2: 640 }, // WIC shelf partition
];

// Door gaps (painted white over wall bands) + swing arcs
const doorGaps = [
  { x1: 480, y1: 150, x2: 480, y2: 235, arc: "right" }, // bedroom entry
  { x1: 380, y1: 600, x2: 380, y2: 675, arc: "right" }, // bathroom entry
  { x1: 530, y1: 585, x2: 530, y2: 655, arc: "right" }, // W/D access
  { x1: 1060, y1: 185, x2: 1060, y2: 270, arc: "left" }, // master bedroom entry
  { x1: 1060, y1: 760, x2: 1060, y2: 845, arc: "left" }, // master bath entry
  { x1: 930, y1: 650, x2: 1010, y2: 650, arc: "down" }, // foyer -> living
  { x1: 1210, y1: 545, x2: 1210, y2: 610, arc: "right" }, // WIC entry
  { x1: 905, y1: 990, x2: 995, y2: 990, arc: "up" }, // unit entry
  { x1: 735, y1: 860, x2: 800, y2: 860, arc: "down" }, // foyer closet
  { x1: 715, y1: 40, x2: 775, y2: 40, arc: "down" }, // vestibule door
];

// Windows: gaps with mullion lines, placed between column masses on the top wall
const windows = [
  { x1: 165, y1: 100, x2: 330, y2: 100 },
  { x1: 415, y1: 100, x2: 640, y2: 100 },
  { x1: 850, y1: 100, x2: 1010, y2: 100 },
  { x1: 1130, y1: 100, x2: 1270, y2: 100 },
  { x1: 1310, y1: 100, x2: 1400, y2: 100 },
  { x1: 1440, y1: 190, x2: 1440, y2: 420 },
];

// Column / pier masses: filled dark rects straddling walls (real plans have
// these at corners and along curtain walls). GT centerlines pass through them.
const columns = [
  { x: 60, y: 60, w: 90, h: 85 }, // top-left corner block
  { x: 340, y: 72, w: 75, h: 60 },
  { x: 640, y: 65, w: 65, h: 70 },
  { x: 1015, y: 65, w: 70, h: 70 },
  { x: 1395, y: 60, w: 90, h: 85 }, // top-right corner block
  { x: 1270, y: 80, w: 45, h: 42 },
  { x: 60, y: 660, w: 80, h: 60 }, // bottom-left of left wing
  { x: 1400, y: 950, w: 80, h: 60 }, // bottom-right corner
];

const line = (w, stroke, width) =>
  `<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="${stroke}" stroke-width="${width}"/>`;
const rect = (x, y, w, h, fill, opts = "") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${opts}/>`;

function doorArc(g) {
  const len = Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
  let sweep;
  if (g.arc === "right") sweep = `M ${g.x1 + len} ${g.y1} A ${len} ${len} 0 0 1 ${g.x1} ${g.y2}`;
  else if (g.arc === "left") sweep = `M ${g.x1 - len} ${g.y1} A ${len} ${len} 0 0 0 ${g.x1} ${g.y2}`;
  else if (g.arc === "down") sweep = `M ${g.x1} ${g.y1 + len} A ${len} ${len} 0 0 0 ${g.x2} ${g.y1}`;
  else sweep = `M ${g.x1} ${g.y1 - len} A ${len} ${len} 0 0 1 ${g.x2} ${g.y1}`;
  return `<path d="${sweep}" fill="none" stroke="#8a8a8a" stroke-width="1.5"/>`;
}

// Printed dimension line with arrowheads and label (architectural style)
function dim(x1, y1, x2, y2, opts = {}) {
  const horiz = y1 === y2;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const label = ftLabel(len);
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const a = 7;
  const arrows = horiz
    ? `<path d="M ${x1} ${y1} l ${a} ${-a / 2} l 0 ${a} z" fill="#3a3a3a"/><path d="M ${x2} ${y2} l ${-a} ${-a / 2} l 0 ${a} z" fill="#3a3a3a"/>`
    : `<path d="M ${x1} ${y1} l ${-a / 2} ${a} l ${a} 0 z" fill="#3a3a3a"/><path d="M ${x2} ${y2} l ${-a / 2} ${-a} l ${a} 0 z" fill="#3a3a3a"/>`;
  const text = horiz
    ? `<text x="${midX}" y="${midY - 8}" text-anchor="middle" font-family="Helvetica" font-size="21" fill="#1c1c1c">${opts.label ?? label}</text>`
    : `<text x="${midX - 10}" y="${midY}" text-anchor="middle" font-family="Helvetica" font-size="21" fill="#1c1c1c" transform="rotate(-90 ${midX - 10} ${midY})">${opts.label ?? label}</text>`;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#3a3a3a" stroke-width="1.6"/>${arrows}${text}`;
}

const dims = [
  // (mirroring the real plan's printed measurements)
  dim(120, 165, 460, 165), // bedroom width
  dim(122, 190, 122, 450), // bedroom height
  dim(120, 445, 460, 445), // bedroom width lower
  dim(500, 175, 690, 175), // living left width
  dim(800, 175, 1040, 175), // living right width
  dim(755, 210, 755, 620), // living height mid
  dim(500, 430, 1040, 430), // living full width
  dim(1085, 200, 1085, 620), // corridor height
  dim(1090, 165, 1420, 165), // master width
  dim(1415, 200, 1415, 480), // master height
  dim(615, 545, 885, 545), // island width
  dim(905, 555, 905, 625, {}), // island depth
  dim(545, 715, 690, 715), // kitchen counter run
  dim(870, 700, 870, 975), // foyer height
  dim(1230, 520, 1430, 520), // WIC width
  dim(715, 20, 775, 20), // vestibule width
  dim(905, 1012, 995, 1012), // entry width
];

const furniture = `
  <!-- bedroom bed + side tables -->
  ${rect(130, 200, 210, 155, "#ffffff", 'stroke="#9a9a9a" stroke-width="2" rx="6"')}
  ${rect(140, 210, 85, 42, "#f0f0f0", 'stroke="#b5b5b5" stroke-width="1.5" rx="4"')}
  ${rect(245, 210, 85, 42, "#f0f0f0", 'stroke="#b5b5b5" stroke-width="1.5" rx="4"')}
  <!-- dining table with chairs -->
  ${rect(560, 230, 95, 210, "#ffffff", 'stroke="#9a9a9a" stroke-width="2" rx="10"')}
  ${[0, 1, 2, 3].map((i) => `<circle cx="545" cy="${255 + i * 52}" r="15" fill="#ffffff" stroke="#9a9a9a" stroke-width="1.5"/>`).join("")}
  ${[0, 1, 2, 3].map((i) => `<circle cx="672" cy="${255 + i * 52}" r="15" fill="#ffffff" stroke="#9a9a9a" stroke-width="1.5"/>`).join("")}
  <!-- sofa + coffee table + rug -->
  ${rect(790, 195, 210, 60, "#ffffff", 'stroke="#9a9a9a" stroke-width="2" rx="8"')}
  ${rect(780, 255, 230, 130, "#f7f7f5", 'stroke="#c9c9c9" stroke-width="1.5"')}
  ${rect(845, 285, 100, 65, "#ffffff", 'stroke="#9a9a9a" stroke-width="2"')}
  <!-- kitchen island with sink + DW -->
  ${rect(615, 555, 270, 70, "#ffffff", 'stroke="#7a7a7a" stroke-width="2.5"')}
  <text x="638" y="598" font-family="Helvetica" font-size="17" fill="#666">DW</text>
  ${rect(700, 568, 60, 44, "#ffffff", 'stroke="#9a9a9a" stroke-width="1.8" rx="5"')}
  ${rect(712, 576, 36, 28, "#f0f0f0", 'stroke="#b0b0b0" stroke-width="1.2" rx="3"')}
  <!-- kitchen counter along bottom step, stove + MW + REF -->
  ${rect(540, 700, 160, 58, "#f4f4f4", 'stroke="#9a9a9a" stroke-width="2"')}
  ${[0, 1].map((i) => [0, 1].map((j) => `<circle cx="${575 + i * 40}" cy="${718 + j * 24}" r="9" fill="none" stroke="#8a8a8a" stroke-width="1.5"/>`).join("")).join("")}
  ${rect(700, 700, 70, 58, "#ffffff", 'stroke="#9a9a9a" stroke-width="1.6"')}
  <text x="712" y="734" font-family="Helvetica" font-size="15" fill="#777">MW</text>
  ${rect(770, 700, 66, 58, "#ffffff", 'stroke="#9a9a9a" stroke-width="1.6"')}
  <text x="782" y="734" font-family="Helvetica" font-size="15" fill="#777">REF</text>
  <!-- bathroom: tub, vanity, toilet -->
  ${rect(115, 580, 62, 110, "#ffffff", 'stroke="#9a9a9a" stroke-width="2" rx="10"')}
  ${rect(230, 585, 70, 45, "#ffffff", 'stroke="#9a9a9a" stroke-width="2"')}
  ${rect(245, 640, 52, 42, "#ffffff", 'stroke="#9a9a9a" stroke-width="2" rx="13"')}
  <!-- W/D -->
  ${rect(415, 605, 78, 78, "#ffffff", 'stroke="#9a9a9a" stroke-width="2"')}
  <text x="428" y="650" font-family="Helvetica" font-size="16" fill="#777">W/D</text>
  <!-- master bed + side tables + bench -->
  ${rect(1150, 235, 230, 165, "#ffffff", 'stroke="#9a9a9a" stroke-width="2" rx="6"')}
  ${rect(1162, 246, 90, 44, "#f0f0f0", 'stroke="#b5b5b5" stroke-width="1.5" rx="4"')}
  ${rect(1272, 246, 90, 44, "#f0f0f0", 'stroke="#b5b5b5" stroke-width="1.5" rx="4"')}
  ${rect(1180, 415, 170, 32, "#ffffff", 'stroke="#9a9a9a" stroke-width="1.6" rx="4"')}
  <!-- armchair top-right of master (angled, distractor) -->
  <g transform="rotate(35 1135 150)">${rect(1105, 122, 60, 56, "#ffffff", 'stroke="#9a9a9a" stroke-width="2" rx="10"')}</g>
  <!-- master bath: double vanity, toilet, tub, shower -->
  ${rect(1105, 740, 190, 55, "#ffffff", 'stroke="#9a9a9a" stroke-width="2"')}
  <circle cx="1150" cy="767" r="16" fill="#f0f0f0" stroke="#a5a5a5" stroke-width="1.5"/>
  <circle cx="1245" cy="767" r="16" fill="#f0f0f0" stroke="#a5a5a5" stroke-width="1.5"/>
  ${rect(1330, 740, 52, 44, "#ffffff", 'stroke="#9a9a9a" stroke-width="2" rx="13"')}
  ${rect(1090, 890, 200, 75, "#ffffff", 'stroke="#9a9a9a" stroke-width="2" rx="12"')}
  ${rect(1320, 880, 100, 90, "#f2f2f2", 'stroke="#9a9a9a" stroke-width="2"')}
  <line x1="1320" y1="880" x2="1420" y2="970" stroke="#b5b5b5" stroke-width="1.5"/>
  <!-- WIC shelves -->
  ${rect(1225, 660, 60, 45, "#ffffff", 'stroke="#b0b0b0" stroke-width="1.4"')}
  <line x1="1310" y1="655" x2="1430" y2="655" stroke="#b0b0b0" stroke-width="1.4"/>
`;

const labels = `
  <text x="215" y="300" font-family="Helvetica" font-size="21" fill="#2c2c2c" letter-spacing="2">BEDROOM</text>
  <text x="218" y="326" font-family="Helvetica" font-size="15" fill="#666">12'-5" x 10'-8"</text>
  <text x="655" y="490" font-family="Helvetica" font-size="20" fill="#2c2c2c" letter-spacing="2">LIVING / DINING / KITCHEN</text>
  <text x="720" y="515" font-family="Helvetica" font-size="15" fill="#666">18'-9" x 20'-9"</text>
  <text x="255" y="510" font-family="Helvetica" font-size="17" fill="#2c2c2c">CL</text>
  <text x="180" y="635" font-family="Helvetica" font-size="18" fill="#2c2c2c" letter-spacing="1">BATHROOM</text>
  <text x="905" y="820" font-family="Helvetica" font-size="19" fill="#2c2c2c" letter-spacing="2">FOYER</text>
  <text x="770" y="930" font-family="Helvetica" font-size="16" fill="#2c2c2c">CL</text>
  <text x="1200" y="345" font-family="Helvetica" font-size="20" fill="#2c2c2c" letter-spacing="1">MASTER</text>
  <text x="1200" y="370" font-family="Helvetica" font-size="20" fill="#2c2c2c" letter-spacing="1">BEDROOM</text>
  <text x="1205" y="393" font-family="Helvetica" font-size="14" fill="#666">12'-7" x 13'-8"</text>
  <text x="1290" y="585" font-family="Helvetica" font-size="17" fill="#2c2c2c">WIC</text>
  <text x="1160" y="845" font-family="Helvetica" font-size="18" fill="#2c2c2c" letter-spacing="1">MASTER BATH</text>
`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  ${rect(0, 0, W, H, "#ffffff")}
  ${rect(100, 40, 1340, 950, "#fbfaf8")}
  <!-- herringbone floor texture (distractor) -->
  <g stroke="#eeece8" stroke-width="1">
    ${Array.from({ length: 34 }, (_, i) => `<line x1="${495 + i * 20}" y1="110" x2="${495 + i * 20 - 55}" y2="680"/>`).join("")}
    ${Array.from({ length: 18 }, (_, i) => `<line x1="${1070 + i * 22}" y1="110" x2="${1070 + i * 22 - 40}" y2="480"/>`).join("")}
  </g>
  <!-- wall bands -->
  <g stroke="#4a4a4a" stroke-width="${T}" stroke-linecap="square">
    ${walls.map((w) => line(w, "#4a4a4a", T)).join("\n")}
  </g>
  <!-- column / pier masses straddling walls -->
  ${columns.map((c) => rect(c.x, c.y, c.w, c.h, "#4a4a4a")).join("\n")}
  <!-- door gaps painted over walls -->
  <g stroke="#ffffff" stroke-width="${T + 4}" stroke-linecap="butt">
    ${doorGaps.map((g) => line(g, "#ffffff", T + 4)).join("\n")}
  </g>
  ${doorGaps.map(doorArc).join("\n")}
  <!-- windows: band gaps with mullions -->
  <g stroke="#ffffff" stroke-width="${T - 2}" stroke-linecap="butt">
    ${windows.map((w) => line(w, "#ffffff", T - 2)).join("\n")}
  </g>
  <g stroke="#7c7c7c" stroke-width="1.5">
    ${windows
      .map((w) => {
        const horiz = w.y1 === w.y2;
        return [-4, 0, 4]
          .map((o) =>
            horiz
              ? line({ x1: w.x1, y1: w.y1 + o, x2: w.x2, y2: w.y2 + o }, "#7c7c7c", 1.5)
              : line({ x1: w.x1 + o, y1: w.y1, x2: w.x2 + o, y2: w.y2 }, "#7c7c7c", 1.5)
          )
          .join("");
      })
      .join("\n")}
    ${windows
      .filter((w) => w.y1 === w.y2)
      .map((w) => {
        const n = Math.round((w.x2 - w.x1) / 55);
        return Array.from({ length: n - 1 }, (_, i) => {
          const x = w.x1 + ((i + 1) * (w.x2 - w.x1)) / n;
          return `<line x1="${x}" y1="${w.y1 - 6}" x2="${x}" y2="${w.y1 + 6}" stroke="#7c7c7c" stroke-width="1.5"/>`;
        }).join("");
      })
      .join("\n")}
  </g>
  ${furniture}
  ${labels}
  ${dims.join("\n")}
</svg>`;

mkdirSync("test/fixtures", { recursive: true });
await sharp(Buffer.from(svg)).png().toFile("test/fixtures/apartment.png");
writeFileSync(
  "test/fixtures/apartment.json",
  JSON.stringify({ imageWidth: W, imageHeight: H, pixelsPerMeter: PPM, walls }, null, 2)
);
console.log(`Wrote test/fixtures/apartment.png (${W}x${H}) and ground truth (${walls.length} walls)`);
