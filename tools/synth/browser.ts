/**
 * Headless Chromium (via Playwright) used as a font rasterizer and JPEG encoder.
 * All randomness is decided in Node; the page only executes drawing commands.
 * Functions passed to page.evaluate are serialized, so they must be self-contained.
 */
import { chromium, type Browser, type Page } from "@playwright/test";
import type { BoardSpec } from "./render";

export type Rgba = { width: number; height: number; data: Uint8ClampedArray };

const fromBase64 = (width: number, height: number, b64: string): Rgba => ({
  width,
  height,
  data: new Uint8ClampedArray(Buffer.from(b64, "base64")),
});

export class Renderer {
  private constructor(
    private browser: Browser,
    private page: Page,
  ) {}

  static async launch(): Promise<Renderer> {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    return new Renderer(browser, page);
  }

  close() {
    return this.browser.close();
  }

  /** Families from `candidates` that the browser can render (differ from every generic fallback). */
  availableFonts(candidates: string[]): Promise<string[]> {
    return this.page.evaluate((fams) => {
      const ctx = document.createElement("canvas").getContext("2d")!;
      const generics = ["monospace", "serif", "sans-serif"];
      const width = (f: string) => {
        ctx.font = `40px ${f}`;
        return ctx.measureText("0123456789 wide").width;
      };
      const base = generics.map(width);
      return fams.filter((f) => generics.some((g, i) => width(`"${f}", ${g}`) !== base[i]));
    }, candidates);
  }

  /** Render a printed puzzle on a sheet of paper. Size is `size + 2 * margin` square. */
  async board(spec: BoardSpec): Promise<Rgba> {
    const b64 = await this.page.evaluate(async (s) => {
      const st = s.style;
      const font = (px: number) => `${st.fontWeight} ${px}px "${st.font}", sans-serif`;
      await document.fonts.load(font(20), "123456789");
      const dim = s.size + 2 * s.margin;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = dim;
      const ctx = canvas.getContext("2d")!;
      const cell = s.size / 9;
      const at = (i: number) => s.margin + i * cell;

      ctx.fillStyle = st.paper;
      ctx.fillRect(0, 0, dim, dim);
      if (st.shadeBoxes) {
        ctx.fillStyle = st.shade;
        for (let b = 0; b < 9; b++)
          if (b % 2 === 1)
            ctx.fillRect(at((b % 3) * 3), at(Math.floor(b / 3) * 3), 3 * cell, 3 * cell);
      }
      for (let i = 1; i < 9; i++) {
        const w = i % 3 === 0 ? st.thick : st.thin;
        ctx.fillStyle = i % 3 === 0 ? st.lineInk : st.thinInk;
        ctx.fillRect(at(i) - w / 2, s.margin, w, s.size);
        ctx.fillRect(s.margin, at(i) - w / 2, s.size, w);
      }
      // Outer border drawn inward, so the board's outer edge is exactly the margin square.
      ctx.fillStyle = st.lineInk;
      const bw = st.border;
      ctx.fillRect(s.margin, s.margin, s.size, bw);
      ctx.fillRect(s.margin, s.margin + s.size - bw, s.size, bw);
      ctx.fillRect(s.margin, s.margin, bw, s.size);
      ctx.fillRect(s.margin + s.size - bw, s.margin, bw, s.size);

      ctx.font = font(cell * st.digitScale);
      ctx.fillStyle = st.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      for (let r = 0; r < 9; r++)
        for (let c = 0; c < 9; c++) {
          const v = s.grid[r][c];
          if (!v) continue;
          const m = ctx.measureText(String(v));
          const [jx, jy] = s.jitter[r * 9 + c];
          const x = at(c) + cell / 2 + jx * cell;
          const y =
            at(r) +
            cell / 2 +
            (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2 +
            jy * cell;
          ctx.fillText(String(v), x, y);
        }

      const bytes = ctx.getImageData(0, 0, dim, dim).data;
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000)
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    }, spec);
    const dim = spec.size + 2 * spec.margin;
    return fromBase64(dim, dim, b64);
  }

  /** Encode RGBA pixels as JPEG (quality 0-1). */
  async jpeg(img: Rgba, quality: number): Promise<Buffer> {
    const b64 = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength).toString(
      "base64",
    );
    const url = await this.page.evaluate(
      ({ width, height, b64, quality }) => {
        const bin = atob(b64);
        const data = new Uint8ClampedArray(bin.length);
        for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")!.putImageData(new ImageData(data, width, height), 0, 0);
        return canvas.toDataURL("image/jpeg", quality);
      },
      { width: img.width, height: img.height, b64, quality },
    );
    return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  }
}
