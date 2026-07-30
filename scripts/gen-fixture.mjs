// Generates a realistic multi-room apartment floor plan (modeled on a real
// 2BR/2BA unit) as a PNG plus ground-truth wall JSON, for evaluating the
// AI wall-detection pipeline. Run: node scripts/gen-fixture.mjs
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const W = 1500;
const H = 1050;
const PPM = 100; // ground truth: 100 px per meter
const T = 12; // wall band thickness in px

// ---- Ground-truth wall centerlines (see layout sketch in eval README) ----
const walls = [
  // Outer boundary (closed loop, clockwise)
  { x1: 100, y1: 100, x2: 1400, y2: 100 }, // top
  { x1: 1400, y1: 100, x2: 1400, y2: 980 }, // right
  { x1: 1400, y1: 980, x2: 700, y2: 980 }, // bottom (right part)
  { x1: 700, y1: 980, x2: 700, y2: 760 }, // step up
  { x1: 700, y1: 760, x2: 470, y2: 760 }, // kitchen bottom
  { x1: 470, y1: 760, x2: 470, y2: 700 }, // step up
  { x1: 470, y1: 700, x2: 100, y2: 700 }, // bottom (left part)
  { x1: 100, y1: 700, x2: 100, y2: 100 }, // left
  // Interior partitions
  { x1: 420, y1: 100, x2: 420, y2: 520 }, // bedroom right
  { x1: 100, y1: 420, x2: 420, y2: 420 }, // bedroom bottom / closet top
  { x1: 100, y1: 520, x2: 470, y2: 520 }, // closet bottom / bath+wd top
  { x1: 350, y1: 520, x2: 350, y2: 700 }, // bathroom right / W/D left
  { x1: 470, y1: 520, x2: 470, y2: 700 }, // W/D right / kitchen left
  { x1: 830, y1: 640, x2: 830, y2: 980 }, // foyer left
  { x1: 830, y1: 640, x2: 1050, y2: 640 }, // foyer top
  { x1: 700, y1: 850, x2: 830, y2: 850 }, // foyer closet top
  { x1: 1050, y1: 100, x2: 1050, y2: 980 }, // master suite divider
  { x1: 1050, y1: 700, x2: 1400, y2: 700 }, // master bath top
  { x1: 1180, y1: 560, x2: 1400, y2: 560 }, // WIC top
  { x1: 1180, y1: 560, x2: 1180, y2: 700 }, // WIC left
];

// Door gaps: absolute segments painted white over the wall bands, plus swing arcs
const doorGaps = [
  { x1: 420, y1: 150, x2: 420, y2: 230, arc: "right" }, // bedroom entry
  { x1: 350, y1: 560, x2: 350, y2: 640, arc: "right" }, // bathroom entry
  { x1: 470, y1: 545, x2: 470, y2: 615, arc: "right" }, // W/D access
  { x1: 1050, y1: 180, x2: 1050, y2: 265, arc: "left" }, // master bedroom entry
  { x1: 1050, y1: 740, x2: 1050, y2: 820, arc: "left" }, // master bath entry
  { x1: 900, y1: 640, x2: 980, y2: 640, arc: "down" }, // foyer -> living
  { x1: 1180, y1: 605, x2: 1180, y2: 665, arc: "right" }, // WIC entry
  { x1: 890, y1: 980, x2: 975, y2: 980, arc: "up" }, // unit entry door
  { x1: 740, y1: 850, x2: 800, y2: 850, arc: "down" }, // foyer closet
];

// Windows: thin triple lines drawn within wall bands
const windows = [
  { x1: 160, y1: 100, x2: 340, y2: 100 },
  { x1: 520, y1: 100, x2: 720, y2: 100 },
  { x1: 780, y1: 100, x2: 980, y2: 100 },
  { x1: 1120, y1: 100, x2: 1330, y2: 100 },
  { x1: 1400, y1: 200, x2: 1400, y2: 420 },
];

const line = (w, stroke, width, opts = "") =>
  `<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="${stroke}" stroke-width="${width}" ${opts}/>`;

const rect = (x, y, w, h, fill, opts = "") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${opts}/>`;

function ftLabel(px) {
  const meters = px / PPM;
  const ftTotal = meters / 0.3048;
  const ft = Math.floor(ftTotal);
  const inches = Math.round((ftTotal - ft) * 12);
  return inches === 0 ? `${ft}'-0"` : `${ft}'-${inches}"`;
}

function doorArc(g) {
  const len = Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
  // Quarter-circle swing from the gap's start point
  let sweep;
  if (g.arc === "right") sweep = `M ${g.x1 + len} ${g.y1} A ${len} ${len} 0 0 1 ${g.x1} ${g.y2}`;
  else if (g.arc === "left") sweep = `M ${g.x1 - len} ${g.y1} A ${len} ${len} 0 0 0 ${g.x1} ${g.y2}`;
  else if (g.arc === "down") sweep = `M ${g.x1} ${g.y1 + len} A ${len} ${len} 0 0 0 ${g.x2} ${g.y1}`;
  else sweep = `M ${g.x1} ${g.y1 - len} A ${len} ${len} 0 0 1 ${g.x2} ${g.y1}`;
  return `<path d="${sweep}" fill="none" stroke="#8a8a8a" stroke-width="1.5"/>`;
}

const furniture = `
  <!-- bedroom bed -->
  ${rect(130, 170, 200, 150, "#ffffff", 'stroke="#9a9a9a" stroke-width="2" rx="6"')}
  ${rect(140, 180, 80, 40, "#f0f0f0", 'stroke="#b5b5b5" stroke-width="1.5" rx="4"')}
  ${rect(240, 180, 80, 40, "#f0f0f0", 'stroke="#b5b5b5" stroke-width="1.5" rx="4"')}
  <!-- dining table -->
  ${rect(500, 220, 90, 200, "#ffffff", 'stroke="#9a9a9a" stroke-width="2" rx="45"')}
  <!-- sofa -->
  ${rect(700, 200, 250, 130, "#ffffff", 'stroke="#9a9a9a" stroke-width="2" rx="8"')}
  ${rect(720, 220, 140, 90, "#f2f2f2", 'stroke="#c0c0c0" stroke-width="1.5"')}
  <!-- kitchen island -->
  ${rect(540, 555, 230, 80, "#ffffff", 'stroke="#8a8a8a" stroke-width="2"')}
  <text x="565" y="600" font-family="Helvetica" font-size="16" fill="#777">DW</text>
  ${rect(640, 570, 50, 40, "#ffffff", 'stroke="#aaa" stroke-width="1.5" rx="4"')}
  <!-- kitchen counter along bottom -->
  ${rect(480, 700, 220, 54, "#f4f4f4", 'stroke="#9a9a9a" stroke-width="2"')}
  ${rect(495, 712, 60, 30, "#ffffff", 'stroke="#aaa" stroke-width="1.5"')}
  <text x="565" y="732" font-family="Helvetica" font-size="14" fill="#777">MW</text>
  <text x="625" y="732" font-family="Helvetica" font-size="14" fill="#777">REF</text>
  <!-- bathroom fixtures -->
  ${rect(115, 540, 60, 130, "#ffffff", 'stroke="#9a9a9a" stroke-width="2" rx="10"')}
  ${rect(220, 620, 60, 45, "#ffffff", 'stroke="#9a9a9a" stroke-width="2" rx="14"')}
  ${rect(250, 540, 70, 45, "#ffffff", 'stroke="#9a9a9a" stroke-width="2"')}
  <!-- W/D -->
  ${rect(380, 600, 70, 70, "#ffffff", 'stroke="#9a9a9a" stroke-width="2"')}
  <text x="392" y="642" font-family="Helvetica" font-size="15" fill="#777">W/D</text>
  <!-- master bed -->
  ${rect(1120, 220, 220, 160, "#ffffff", 'stroke="#9a9a9a" stroke-width="2" rx="6"')}
  ${rect(1135, 232, 85, 42, "#f0f0f0", 'stroke="#b5b5b5" stroke-width="1.5" rx="4"')}
  ${rect(1240, 232, 85, 42, "#f0f0f0", 'stroke="#b5b5b5" stroke-width="1.5" rx="4"')}
  <!-- master bath -->
  ${rect(1150, 880, 210, 70, "#ffffff", 'stroke="#9a9a9a" stroke-width="2" rx="12"')}
  ${rect(1090, 730, 130, 50, "#ffffff", 'stroke="#9a9a9a" stroke-width="2"')}
  ${rect(1290, 730, 60, 45, "#ffffff", 'stroke="#9a9a9a" stroke-width="2" rx="14"')}
`;

// Hand-drawn style measurement annotations (like a user marking up their plan).
// Red on the left/center, blue on the master side — distractors that must NOT
// be detected as walls, but whose labels are valid scale sources.
function annotationFt(px) {
  return `${(px / PPM / 0.3048).toFixed(2)} ft`;
}
const annotations = `
  <g stroke="#e11d2e" stroke-width="4" stroke-linecap="round" fill="none">
    <line x1="130" y1="150" x2="395" y2="153"/>
    <line x1="128" y1="380" x2="130" y2="152"/>
    <line x1="455" y1="180" x2="1020" y2="182"/>
    <line x1="760" y1="130" x2="762" y2="600"/>
    <line x1="455" y1="470" x2="1015" y2="472"/>
    <line x1="855" y1="660" x2="857" y2="960"/>
  </g>
  <g font-family="Helvetica" font-size="20" fill="#c01020">
    <text x="200" y="142">${annotationFt(265)}</text>
    <text x="95" y="270" transform="rotate(-90 95 270)">${annotationFt(228)}</text>
    <text x="680" y="172">${annotationFt(565)}</text>
    <text x="775" y="370" transform="rotate(-90 775 370)">${annotationFt(470)}</text>
    <text x="600" y="462">${annotationFt(560)}</text>
    <text x="870" y="800" transform="rotate(-90 870 800)">${annotationFt(300)}</text>
  </g>
  <g stroke="#1d4ed8" stroke-width="4" stroke-linecap="round" fill="none">
    <line x1="1080" y1="160" x2="1370" y2="162"/>
    <line x1="1345" y1="130" x2="1347" y2="520"/>
    <line x1="1210" y1="600" x2="1370" y2="602"/>
  </g>
  <g font-family="Helvetica" font-size="20" fill="#1d4ed8">
    <text x="1170" y="150">${annotationFt(290)}</text>
    <text x="1360" y="300" transform="rotate(-90 1360 300)">${annotationFt(390)}</text>
    <text x="1240" y="592">${annotationFt(160)}</text>
  </g>
`;

const labels = `
  <text x="200" y="265" font-family="Helvetica" font-size="20" fill="#5d7a8a" letter-spacing="2">BEDROOM</text>
  <text x="205" y="290" font-family="Helvetica" font-size="14" fill="#8aa">${ftLabel(320)} x ${ftLabel(320)}</text>
  <text x="560" y="480" font-family="Helvetica" font-size="20" fill="#5d7a8a" letter-spacing="2">LIVING/DINING/KITCHEN</text>
  <text x="640" y="505" font-family="Helvetica" font-size="14" fill="#8aa">${ftLabel(630)} x ${ftLabel(540)}</text>
  <text x="150" y="480" font-family="Helvetica" font-size="16" fill="#5d7a8a">CL</text>
  <text x="170" y="615" font-family="Helvetica" font-size="18" fill="#5d7a8a" letter-spacing="1">BATHROOM</text>
  <text x="890" y="820" font-family="Helvetica" font-size="18" fill="#5d7a8a" letter-spacing="2">FOYER</text>
  <text x="745" y="925" font-family="Helvetica" font-size="15" fill="#5d7a8a">CL</text>
  <text x="1140" y="330" font-family="Helvetica" font-size="19" fill="#5d7a8a" letter-spacing="2">MASTER BEDROOM</text>
  <text x="1160" y="355" font-family="Helvetica" font-size="14" fill="#8aa">${ftLabel(350)} x ${ftLabel(460)}</text>
  <text x="1250" y="635" font-family="Helvetica" font-size="15" fill="#5d7a8a">WIC</text>
  <text x="1130" y="850" font-family="Helvetica" font-size="17" fill="#5d7a8a" letter-spacing="1">MASTER BATH</text>
`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  ${rect(0, 0, W, H, "#ffffff")}
  <!-- floor fills -->
  ${rect(100, 100, 1300, 880, "#fbfbf9")}
  <!-- herringbone-ish hatching in living area (distractor texture) -->
  <g stroke="#ececea" stroke-width="1">
    ${Array.from({ length: 30 }, (_, i) => `<line x1="${430 + i * 22}" y1="110" x2="${430 + i * 22 - 60}" y2="690"/>`).join("")}
  </g>
  <!-- wall bands -->
  <g stroke="#5c5c5c" stroke-width="${T}" stroke-linecap="square">
    ${walls.map((w) => line(w, "#5c5c5c", T)).join("\n")}
  </g>
  <!-- door gaps painted over walls -->
  <g stroke="#ffffff" stroke-width="${T + 4}" stroke-linecap="butt">
    ${doorGaps.map((g) => line(g, "#ffffff", T + 4)).join("\n")}
  </g>
  ${doorGaps.map(doorArc).join("\n")}
  <!-- windows: triple thin lines inside wall band -->
  <g stroke="#ffffff" stroke-width="${T - 2}" stroke-linecap="butt">
    ${windows.map((w) => line(w, "#ffffff", T - 2)).join("\n")}
  </g>
  <g stroke="#7c7c7c" stroke-width="1.5">
    ${windows
      .map((w) => {
        const horiz = w.y1 === w.y2;
        return [-3, 0, 3]
          .map((o) =>
            horiz
              ? line({ x1: w.x1, y1: w.y1 + o, x2: w.x2, y2: w.y2 + o }, "#7c7c7c", 1.5)
              : line({ x1: w.x1 + o, y1: w.y1, x2: w.x2 + o, y2: w.y2 }, "#7c7c7c", 1.5)
          )
          .join("");
      })
      .join("\n")}
  </g>
  ${furniture}
  ${labels}
  ${annotations}
</svg>`;

mkdirSync("test/fixtures", { recursive: true });
await sharp(Buffer.from(svg)).png().toFile("test/fixtures/apartment.png");
writeFileSync(
  "test/fixtures/apartment.json",
  JSON.stringify({ imageWidth: W, imageHeight: H, pixelsPerMeter: PPM, walls }, null, 2)
);
console.log(`Wrote test/fixtures/apartment.png (${W}x${H}) and ground truth (${walls.length} walls)`);
