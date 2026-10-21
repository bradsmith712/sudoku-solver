/**
 * Regenerate the browser-rendered board fixtures in ./boards (real fonts, CSS 3D
 * perspective, page clutter, lighting, JPEG compression):
 *   npx vite-node src/vision/__fixtures__/make-browser-fixtures.ts
 * Ground-truth corners are the board's border box projected through its computed
 * 3D transform. Needs the Playwright Chromium browser (npx playwright install chromium).
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Grid } from "../../types";
import type { Truth } from "./fixtures";

const here = new URL(".", import.meta.url).pathname;
const OUT = join(here, "boards");
const PUZZLES = join(here, "../../../tests/fixtures/solver");

type Case = {
  name: string;
  puzzle: string;
  transform: string;
  font: string;
  outer: number;
  box: number;
  cell: number;
  side: number;
  left: number;
  top: number;
  page: string;
  lighting: string;
  tags: string[];
};

const PROSE =
  "The council met on Tuesday to discuss the new bus timetable, which residents say leaves the north estate without a service after nine. ";

const CASES: Case[] = [
  {
    name: "browser-tilted-serif",
    puzzle: "medium-04",
    transform: "perspective(900px) rotateX(22deg) rotateZ(-6deg)",
    font: "Georgia, 'Times New Roman', serif",
    outer: 4,
    box: 3,
    cell: 1,
    side: 380,
    left: 200,
    top: 110,
    page: "#efe9dc",
    lighting: "linear-gradient(110deg, rgba(0,0,0,0.35), rgba(0,0,0,0) 60%)",
    tags: ["browser", "persp", "rot", "light", "text"],
  },
  {
    name: "browser-desk-sans",
    puzzle: "hard-04",
    transform: "perspective(1000px) rotateY(-18deg) rotateZ(9deg)",
    font: "Arial, Helvetica, sans-serif",
    outer: 3,
    box: 2,
    cell: 1,
    side: 340,
    left: 240,
    top: 120,
    page: "#6b4f3a",
    lighting: "radial-gradient(circle at 30% 20%, rgba(255,255,255,0.15), rgba(0,0,0,0.4))",
    tags: ["browser", "persp", "rot", "light", "dark-bg"],
  },
  {
    name: "browser-newspaper-thin",
    puzzle: "easy-04",
    transform: "perspective(1200px) rotateX(-10deg) rotateY(8deg) rotateZ(2deg)",
    font: "'Helvetica Neue', Arial, sans-serif",
    outer: 2,
    box: 2,
    cell: 1,
    side: 300,
    left: 430,
    top: 160,
    page: "#f4f1ea",
    lighting: "linear-gradient(200deg, rgba(0,0,0,0) 40%, rgba(60,40,0,0.25))",
    tags: ["browser", "persp", "thin", "text", "framed-article"],
  },
];

function html(c: Case, grid: Grid): string {
  // Lines are absolutely positioned at k * side / 9 from the board's outer edge (like
  // a printed grid), so the warped board's lines land exactly on k * 50 px.
  const pitch = c.side / 9;
  const lines = Array.from({ length: 8 }, (_, i) => {
    const k = i + 1;
    const w = k % 3 === 0 ? c.box : c.cell;
    const at = k * pitch - c.outer - w / 2;
    return (
      `<i style="left:${at}px;top:${-c.outer}px;width:${w}px;height:${c.side}px"></i>` +
      `<i style="top:${at}px;left:${-c.outer}px;height:${w}px;width:${c.side}px"></i>`
    );
  }).join("");
  const digits = grid
    .flatMap((row, r) =>
      row.map((d, k) =>
        d ? `<b style="left:${k * pitch - c.outer}px;top:${r * pitch - c.outer}px">${d}</b>` : "",
      ),
    )
    .join("");
  return `<!doctype html><html><head><style>
    html,body{margin:0;width:800px;height:600px;overflow:hidden;background:${c.page};font-family:Georgia,serif}
    .prose{position:absolute;inset:12px;columns:3;column-gap:24px;font-size:12px;line-height:1.35;color:#333;text-align:justify}
    .prose h2{column-span:all;font-size:26px;margin:0 0 6px;border-bottom:3px double #333}
    .frame{position:absolute;left:24px;top:330px;width:250px;height:180px;border:2px solid #222;padding:8px;font-size:11px;background:inherit}
    #board{position:absolute;left:${c.left}px;top:${c.top}px;width:${c.side}px;height:${c.side}px;box-sizing:border-box;
      border:${c.outer}px solid #111;background:#fbfaf6;transform:${c.transform};transform-origin:50% 50%;
      box-shadow:6px 8px 18px rgba(0,0,0,0.35)}
    #board i{position:absolute;background:#111}
    #board b{position:absolute;width:${pitch}px;height:${pitch}px;line-height:${pitch}px;text-align:center;
      font:${Math.round(c.side / 15)}px ${c.font};color:#151515}
    .light{position:absolute;inset:0;background:${c.lighting};pointer-events:none}
  </style></head><body>
    <div class="prose"><h2>Weekend Puzzles</h2>${PROSE.repeat(30)}</div>
    ${c.tags.includes("framed-article") ? `<div class="frame"><b>Letters</b><br>${PROSE.repeat(3)}</div>` : ""}
    <div id="board">${lines}${digits}</div>
    <div class="light"></div>
  </body></html>`;
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
  });
  for (const c of CASES) {
    const grid = (
      JSON.parse(readFileSync(join(PUZZLES, `${c.puzzle}.json`), "utf8")) as { grid: Grid }
    ).grid;
    await page.setContent(html(c, grid));
    const corners = await page.evaluate(() => {
      const el = document.getElementById("board")!;
      const m = new DOMMatrix(getComputedStyle(el).transform);
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const local: [number, number][] = [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ];
      return local.map(([x, y]) => {
        const p = m.transformPoint(new DOMPoint(x - w / 2, y - h / 2, 0, 1));
        return [el.offsetLeft + w / 2 + p.x / p.w, el.offsetTop + h / 2 + p.y / p.w] as [
          number,
          number,
        ];
      });
    });
    const image = `${c.name}.jpg`;
    writeFileSync(join(OUT, image), await page.screenshot({ type: "jpeg", quality: 82 }));
    const truth: Truth = {
      image,
      width: 800,
      height: 600,
      grid,
      corners: corners.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]),
      tags: c.tags,
    };
    writeFileSync(join(OUT, `${c.name}.json`), JSON.stringify(truth) + "\n");
    console.log("wrote", image, JSON.stringify(truth.corners));
  }
} finally {
  await browser.close();
}
