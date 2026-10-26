"""Train the digit classifier (1-9) and export it to ONNX. Offline only.

    tools/train/.venv/bin/python tools/train/train.py [--samples 60000] [--epochs 12]

Digits are rendered from system fonts into a cell with partial grid lines, augmented
(weight, rotation, shift, scale, blur, noise, JPEG, lighting gradients, hard shadows,
faint show-through), then preprocessed exactly like src/vision/cells.ts: divide by
the local paper brightness from a 15 px grey-level closing, crop between the cell's
lines inset 15%, resample to 32x32. The model sees 1 - brightness (ink = 1).

Validation uses fonts held out of training, so model selection never looks at real
photos. --real-crops adds crops dumped from split=train photos only (never test).
"""

from __future__ import annotations

import argparse
import io
import json
import math
import os
import random
import sys
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
MODEL_PATH = ROOT / "src/vision/model/model.onnx"
DATA_DIR = Path(__file__).resolve().parent / "data"
MAX_MODEL_BYTES = 1_000_000

# Must match src/vision/cells.ts.
CELL_SIZE = 32
PAPER_RADIUS = 7
CELL_INSET = 0.15
CELL = 50  # warped board cell, px (450 / 9)

CANVAS = 110  # cell plus margins so the closing sees neighbouring paper
LINE_A = 30  # cell lines (centres) at LINE_A and LINE_A + CELL on both axes

FONT_DIRS = ["/System/Library/Fonts", "/System/Library/Fonts/Supplemental", "/Library/Fonts"]
# Upright Latin families with ordinary lining digits. Sans-serif dominates, like the
# owner's puzzle books (Arial/Helvetica-like); a few serifs keep the model general.
FAMILIES = [
    "Helvetica", "Helvetica Neue", "Arial", "Arial Narrow", "Arial Black", "Arial Rounded MT Bold",
    "Avenir", "Avenir Next", "Avenir Next Condensed", "Futura", "Trebuchet MS", "Tahoma",
    "Verdana", "Gill Sans", "DIN Alternate", "DIN Condensed", "Georgia", "Times New Roman",
    "Courier New", ".SF NS",
    # Common print faces seen in the synthetic set's misreads: American Typewriter's
    # flat-topped 3, and bold slab/old-style digits.
    "American Typewriter", "Rockwell", "Palatino", "Menlo", "Didot", "Baskerville", "Optima",
]
# Families never used for training: their crops form the validation set.
HELD_OUT = {"Verdana", "Gill Sans", "DIN Alternate", "Georgia"}
SKIP_STYLES = ("italic", "oblique")


def find_fonts() -> list[tuple[str, int, str]]:
    """(path, face index, family) for every upright face of FAMILIES on this machine."""
    fonts = []
    for d in FONT_DIRS:
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            if not name.lower().endswith((".ttf", ".ttc", ".otf")):
                continue
            path = os.path.join(d, name)
            for index in range(32):
                try:
                    font = ImageFont.truetype(path, 40, index=index)
                except OSError:
                    break
                family, style = font.getname()
                if family in FAMILIES and not any(s in style.lower() for s in SKIP_STYLES):
                    fonts.append((path, index, family))
    return fonts


# ---- preprocessing, mirrored from src/vision/cells.ts ----


def flatten_lighting(gray: np.ndarray) -> np.ndarray:
    """Brightness over local paper brightness (grey closing, edge-clamped), capped at 1."""
    r = PAPER_RADIUS

    def slide(a: np.ndarray, axis: int, op) -> np.ndarray:
        pad = [(0, 0), (0, 0)]
        pad[axis] = (r, r)
        p = np.pad(a, pad, mode="edge")
        win = np.lib.stride_tricks.sliding_window_view(p, 2 * r + 1, axis=axis)
        return op(win, axis=-1)

    bg = slide(gray, 1, np.max)
    bg = slide(bg, 0, np.max)
    bg = slide(bg, 1, np.min)
    bg = slide(bg, 0, np.min)
    return np.minimum(1.0, gray / np.maximum(bg, 1.0))


def crop_cell(flat: np.ndarray, left: float, right: float, top: float, bottom: float) -> np.ndarray:
    """Bilinear CELL_SIZE crop between the lines, inset CELL_INSET (cellsFrom in cells.ts)."""
    h, w = flat.shape
    ix = (right - left) * CELL_INSET
    iy = (bottom - top) * CELL_INSET
    x0, y0 = left + ix, top + iy
    cw, ch = right - left - 2 * ix, bottom - top - 2 * iy
    k = np.arange(CELL_SIZE)
    xs = np.clip(x0 + (k + 0.5) * cw / CELL_SIZE - 0.5, 0, w - 1)
    ys = np.clip(y0 + (k + 0.5) * ch / CELL_SIZE - 0.5, 0, h - 1)
    xa = np.floor(xs).astype(int)
    ya = np.floor(ys).astype(int)
    xb = np.minimum(xa + 1, w - 1)
    yb = np.minimum(ya + 1, h - 1)
    fx = (xs - xa)[None, :]
    fy = (ys - ya)[:, None]
    top_row = flat[np.ix_(ya, xa)] * (1 - fx) + flat[np.ix_(ya, xb)] * fx
    bot_row = flat[np.ix_(yb, xa)] * (1 - fx) + flat[np.ix_(yb, xb)] * fx
    return (top_row * (1 - fy) + bot_row * fy).astype(np.float32)


# ---- rendering and augmentation ----


def digit_mask(rng: random.Random, font: tuple[str, int, str], digit: int, mirror=False) -> np.ndarray:
    """Anti-aliased ink coverage (0-1) of one digit on the CANVAS, already rotated and placed."""
    ss = 4  # supersample
    height = rng.uniform(0.40, 0.80) * CELL  # digit height in board px (real books: ~0.5)
    text = str(digit)
    probe = ImageFont.truetype(font[0], 200, index=font[1])
    _, py0, _, py1 = probe.getbbox(text)
    f = ImageFont.truetype(font[0], max(8, round(200 * height * ss / max(1, py1 - py0))), index=font[1])
    img = Image.new("L", (CANVAS * ss, CANVAS * ss), 0)
    d = ImageDraw.Draw(img)
    stroke = int(rng.choice([0, 0, 0, 1, 2]) * ss * height / 30)  # some bolder strokes
    x0, y0, x1, y1 = d.textbbox((0, 0), text, font=f, stroke_width=stroke)
    cx = (LINE_A + CELL / 2 + rng.uniform(-3, 3)) * ss
    cy = (LINE_A + CELL / 2 + rng.uniform(-3, 3)) * ss
    d.text((cx - (x0 + x1) / 2, cy - (y0 + y1) / 2), text, font=f, fill=255, stroke_width=stroke, stroke_fill=255)
    img = img.rotate(rng.uniform(-8, 8), resample=Image.BILINEAR, center=(cx, cy))
    if mirror:
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
    weight = rng.choice([None, "thin", "bold", "bold"])
    if weight == "bold":
        img = img.filter(ImageFilter.MaxFilter(5))
    elif weight == "thin":
        img = img.filter(ImageFilter.MinFilter(3))
    img = img.resize((CANVAS, CANVAS), Image.BOX)
    return np.asarray(img, dtype=np.float64) / 255.0


def grid_lines(rng: random.Random) -> np.ndarray:
    """Ink coverage of the cell's four lines (thin or thick, sometimes broken or faint)."""
    m = np.zeros((CANVAS, CANVAS))
    for vertical in (True, False):
        for pos in (LINE_A, LINE_A + CELL):
            width = rng.choice([1, 1, 2, 2, 3, 4, 5])
            strength = rng.uniform(0.5, 1.0)
            lo = int(round(pos - width / 2))
            band = slice(max(0, lo), min(CANVAS, lo + width))
            coverage = np.full(CANVAS, strength)
            if rng.random() < 0.2:  # broken line
                a = rng.randrange(CANVAS)
                coverage[a : a + rng.randrange(5, 40)] = 0
            if vertical:
                m[:, band] = np.maximum(m[:, band], coverage[:, None])
            else:
                m[band, :] = np.maximum(m[band, :], coverage[None, :])
    return m


def lighting(rng: random.Random) -> np.ndarray:
    """Multiplicative light field: a gradient, sometimes a hard shadow edge."""
    y, x = np.mgrid[0:CANVAS, 0:CANVAS] / CANVAS
    a = rng.uniform(-0.4, 0.4)
    b = rng.uniform(-0.4, 0.4)
    field = 1 + a * (x - 0.5) + b * (y - 0.5)
    if rng.random() < 0.25:
        theta = rng.uniform(0, 2 * math.pi)
        c = rng.uniform(0.2, 0.8)
        side = (x - c) * math.cos(theta) + (y - c) * math.sin(theta) > 0
        field = np.where(side, field * rng.uniform(0.35, 0.8), field)
    return field / field.max()


def render(rng: random.Random, font: tuple[str, int, str], digit: int, others: list) -> np.ndarray:
    """One preprocessed 32x32 crop (brightness over paper, 1 = paper) of `digit`."""
    paper = rng.uniform(150, 250)
    ink = rng.uniform(5, 90)
    ink_cover = np.maximum(grid_lines(rng), digit_mask(rng, font, digit))
    gray = paper - (paper - ink) * ink_cover
    if rng.random() < 0.2:  # faint show-through from the other side of the page
        ghost = digit_mask(rng, rng.choice(others), rng.randint(1, 9), mirror=True)
        gray = gray * (1 - rng.uniform(0.04, 0.12) * ghost)
    gray = gray * lighting(rng) * rng.uniform(0.35, 1.0)
    img = Image.fromarray(np.clip(gray, 0, 255).astype(np.uint8))
    if rng.random() < 0.3:  # low-resolution source photo
        s = rng.uniform(0.45, 0.85)
        small = img.resize((max(8, round(CANVAS * s)),) * 2, Image.BILINEAR)
        img = small.resize((CANVAS, CANVAS), Image.BILINEAR)
    sigma = rng.choice([0, 0, 0.5, 0.8, 1.2, 1.6])
    if sigma:
        img = img.filter(ImageFilter.GaussianBlur(sigma))
    arr = np.asarray(img, dtype=np.float64)
    arr = arr + np.random.default_rng(rng.randrange(2**32)).normal(0, rng.uniform(0, 8), arr.shape)
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    if rng.random() < 0.5:
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=rng.randint(45, 95))
        img = Image.open(buf).convert("L")
    gray8 = np.asarray(img, dtype=np.float64)  # the warped board is 8-bit, like here
    # Line positions as the line tracer would report them: a pixel or three off.
    j = lambda: rng.uniform(-3, 3)  # noqa: E731
    return crop_cell(flatten_lighting(gray8), LINE_A + j(), LINE_A + CELL + j(), LINE_A + j(), LINE_A + CELL + j())


def _render_batch(args):
    seed, fonts, others, n = args
    rng = random.Random(seed)
    xs = np.empty((n, CELL_SIZE, CELL_SIZE), np.float32)
    ys = np.empty(n, np.int64)
    for i in range(n):
        digit = rng.randint(1, 9)
        xs[i] = render(rng, rng.choice(fonts), digit, others)
        ys[i] = digit - 1
    return xs, ys


def make_set(seed: int, fonts, others, n: int, workers: int) -> tuple[np.ndarray, np.ndarray]:
    chunk = 1000
    jobs = [(seed * 100_003 + i, fonts, others, min(chunk, n - i * chunk)) for i in range(math.ceil(n / chunk))]
    with Pool(workers) as pool:
        parts = pool.map(_render_batch, jobs)
    return np.concatenate([p[0] for p in parts]), np.concatenate([p[1] for p in parts])


# ---- model ----


class DigitNet(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        block = lambda i, o: nn.Sequential(nn.Conv2d(i, o, 3, padding=1), nn.BatchNorm2d(o), nn.ReLU(), nn.MaxPool2d(2))  # noqa: E731
        self.features = nn.Sequential(block(1, 16), block(16, 32), block(32, 64))
        self.head = nn.Sequential(nn.Flatten(), nn.Dropout(0.3), nn.Linear(64 * 4 * 4, 64), nn.ReLU(), nn.Linear(64, 9))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.head(self.features(x))


def to_input(crops: np.ndarray) -> torch.Tensor:
    """Crops (1 = paper) to model input (ink = 1), NCHW."""
    return torch.from_numpy(1.0 - crops).unsqueeze(1)


def accuracy(model: nn.Module, x: torch.Tensor, y: torch.Tensor) -> float:
    model.eval()
    with torch.no_grad():
        pred = torch.cat([model(x[i : i + 2048]).argmax(1) for i in range(0, len(x), 2048)])
    return (pred == y).float().mean().item()


def load_real_crops(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """Crops dumped from split=train photos: crops.json {split, crops: [{digit, pixels}]}."""
    data = json.loads(path.read_text())
    if any(c.get("split") != "train" for c in data["crops"]):
        sys.exit(f"{path}: refusing crops that are not from split=train")
    xs = np.array([c["pixels"] for c in data["crops"]], np.float32).reshape(-1, CELL_SIZE, CELL_SIZE)
    ys = np.array([c["digit"] - 1 for c in data["crops"]], np.int64)
    return xs, ys


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--samples", type=int, default=60_000, help="synthetic training crops")
    ap.add_argument("--val-samples", type=int, default=6_000)
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    ap.add_argument("--real-crops", type=Path, help="crops.json dumped from split=train photos")
    ap.add_argument("--real-weight", type=int, default=20, help="times each real crop is repeated")
    ap.add_argument("--out", type=Path, default=MODEL_PATH)
    ap.add_argument("--parity-fixture", type=Path, help="write one raw cell + its crop for the TS parity test, then exit")
    args = ap.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    fonts = find_fonts()
    train_fonts = [f for f in fonts if f[2] not in HELD_OUT]
    val_fonts = [f for f in fonts if f[2] in HELD_OUT]
    if not train_fonts or not val_fonts:
        sys.exit("no fonts found; see FAMILIES in train.py")
    print(f"fonts: {len(train_fonts)} train faces, {len(val_fonts)} held-out faces "
          f"({', '.join(sorted({f[2] for f in val_fonts}))})")

    if args.parity_fixture:
        write_parity_fixture(args.parity_fixture, train_fonts)
        return

    t = time.time()
    x_train, y_train = make_set(args.seed, train_fonts, train_fonts, args.samples, args.workers)
    x_val, y_val = make_set(args.seed + 1, val_fonts, val_fonts, args.val_samples, args.workers)
    print(f"rendered {len(x_train)} train / {len(x_val)} val crops in {time.time() - t:.0f}s")
    if args.real_crops:
        xr, yr = load_real_crops(args.real_crops)
        x_train = np.concatenate([x_train] + [xr] * args.real_weight)
        y_train = np.concatenate([y_train] + [yr] * args.real_weight)
        print(f"added {len(xr)} split=train real crops x{args.real_weight}")

    xt, yt = to_input(x_train), torch.from_numpy(y_train)
    xv, yv = to_input(x_val), torch.from_numpy(y_val)
    model = DigitNet()
    opt = torch.optim.Adam(model.parameters(), lr=2e-3)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, args.epochs)
    loss_fn = nn.CrossEntropyLoss()
    best, best_state = -1.0, None
    gen = torch.Generator().manual_seed(args.seed)
    for epoch in range(args.epochs):
        model.train()
        perm = torch.randperm(len(xt), generator=gen)
        for i in range(0, len(xt), 128):
            idx = perm[i : i + 128]
            opt.zero_grad()
            loss_fn(model(xt[idx]), yt[idx]).backward()
            opt.step()
        sched.step()
        val = accuracy(model, xv, yv)
        print(f"epoch {epoch + 1}/{args.epochs}: held-out-font val accuracy {val:.4f}")
        if val > best:
            best, best_state = val, {k: v.clone() for k, v in model.state_dict().items()}
    model.load_state_dict(best_state)
    model.eval()
    export(model, args.out)
    print(f"best held-out-font val accuracy {best:.4f}; wrote {args.out} ({args.out.stat().st_size} bytes)")


def export(model: nn.Module, out: Path) -> None:
    import onnx

    out.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model, torch.zeros(1, 1, CELL_SIZE, CELL_SIZE), str(out),
        input_names=["input"], output_names=["logits"],
        dynamic_axes={"input": {0: "n"}, "logits": {0: "n"}},
        opset_version=13, dynamo=False,
    )
    onnx.checker.check_model(onnx.load(str(out)))
    if out.stat().st_size >= MAX_MODEL_BYTES:
        sys.exit(f"model is {out.stat().st_size} bytes; must stay under {MAX_MODEL_BYTES}")


def write_parity_fixture(path: Path, fonts) -> None:
    """A raw 8-bit cell canvas, the line positions and the Python crop, for cells.parity.test.ts."""
    rng = random.Random(1)
    paper, ink = 210.0, 40.0
    cover = np.maximum(grid_lines(rng), digit_mask(rng, fonts[0], 7))
    gray = (paper - (paper - ink) * cover) * lighting(rng)
    gray8 = np.clip(np.round(gray), 0, 255).astype(np.uint8)
    lines = [LINE_A + 0.5, LINE_A + CELL - 1.0, LINE_A - 0.5, LINE_A + CELL + 1.5]
    crop = crop_cell(flatten_lighting(gray8.astype(np.float64)), *lines)
    path.write_text(json.dumps({
        "size": CANVAS, "gray": gray8.flatten().tolist(),
        "left": lines[0], "right": lines[1], "top": lines[2], "bottom": lines[3],
        "crop": [round(float(v), 5) for v in crop.flatten()],
    }) + "\n")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
