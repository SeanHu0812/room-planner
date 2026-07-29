# Room Planner

Turn a floor plan photo into a real-scale 3D room, then furnish it with **real, purchasable furniture** by pasting shopping links. Every product becomes a size-accurate 3D model you can move around the room — so you see exactly what your home could look like before you buy.

## How it works

1. **Upload a floor plan** — Claude vision detects walls, doors, and windows and estimates the scale. Fix anything in the 2D editor (drag endpoints, draw walls, calibrate scale against a known dimension), then build the 3D room.
2. **Paste a shopping link** — the product page is scraped, Claude extracts the name, price, photos, and real dimensions, and a size-accurate placeholder model appears in your room instantly. In the background, Meshy turns the product photo into a real 3D mesh (1–3 min) and swaps it in, rescaled to the true dimensions.
3. **Furnish** — drag furniture around the floor, rotate with `R`, duplicate with `⌘D`, delete with `Delete`. Every product is saved to **My Library**, so you can place it again in any project without re-scraping or re-generating.

Everything is stored locally in your browser (IndexedDB). Use **Export/Import** in the top bar to save a `.roomplan` file (includes the generated 3D models).

## Setup

```bash
npm install
cp .env.local.example .env.local
```

Fill in `.env.local`:

| Variable | Where to get it | Used for |
|---|---|---|
| `ANTHROPIC_API_KEY` | [platform.claude.com](https://platform.claude.com) | Floor plan wall detection, product data extraction |
| `MESHY_API_KEY` | [meshy.ai](https://www.meshy.ai) → API settings | Image-to-3D furniture generation (~$0.10–0.30/model) |

Then:

```bash
npm run dev
```

Open http://localhost:3000.

## Tips

- **Scale matters.** If the AI couldn't read a scale off your plan, use the **Scale** tool: click two points across a wall you know the length of (e.g. a labeled 4 m wall) and type the real distance. All furniture sizing depends on this.
- **Bot-blocked shops** (Amazon and others behind Cloudflare): when a link fails, the app offers a paste box — select-all + copy the product page and paste it; the AI extracts the product from the text.
- **Missing dimensions**: if a page doesn't list W×D×H, you'll be asked to type them (they're almost always in the product's spec section).
- IKEA links work particularly well for a first test.

## Stack

Next.js (App Router) · React Three Fiber + drei · Zustand · Claude API (structured outputs + vision) · Meshy image-to-3D · IndexedDB (idb-keyval)

## Notes & limitations

- Generated meshes are scaled uniformly to the product's real height (footprint may differ slightly from the true W×D for oddly oriented generations); the placeholder models always use exact W×D×H.
- If Meshy generation fails, the item keeps its size-accurate placeholder and shows a **Retry 3D** action.
- Door openings are cut to 2.05 m; windows span 0.9–2.1 m.
