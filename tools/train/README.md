# Digit model training (offline)

`train.py` renders digits 1-9 from system fonts, augments them, trains a small CNN
and exports `src/vision/model/model.onnx` (committed; must stay under 1 MB). Nothing
here ships with the app.

## Setup

```sh
python3 -m venv tools/train/.venv
tools/train/.venv/bin/pip install -r tools/train/requirements.txt
```

The venv, generated datasets (`data/`) and logs (`out/`) are git-ignored.

## Train

```sh
tools/train/.venv/bin/python tools/train/train.py            # ~10 min on a laptop CPU
tools/train/.venv/bin/python tools/train/train.py --help     # options
```

- Fonts: upright faces of the families in `FAMILIES` found in the macOS font folders,
  mostly sans-serif (Helvetica, Arial and similar, like the owner's puzzle books).
  `HELD_OUT` families are never trained on; they form the validation set used to pick
  the best epoch, so model selection never looks at real photos.
- Augmentation: digit height 40-60% of the cell, thin/bold weight, rotation +-8 deg,
  centre jitter, partial (thin, thick, broken, faint) grid lines at the cell edges,
  lighting gradients and hard shadow edges, faint mirrored show-through, low-resolution
  resampling, blur, noise and JPEG.
- Preprocessing mirrors `src/vision/cells.ts` exactly (grey-closing lighting flattening,
  15% inset, bilinear 32x32). `src/vision/cells.parity.test.ts` checks this against
  `tests/fixtures/train-parity.json`; regenerate that file with
  `train.py --parity-fixture tests/fixtures/train-parity.json` after changing either side.
- Model input: `[N, 1, 32, 32]` float, 1 - flattened brightness (ink = 1). Output:
  9 logits for digits 1-9.

## Confidence calibration

After training, refit the softmax temperature that `recognize.ts` applies:

```sh
tools/train/.venv/bin/python tools/train/train.py --dump-val tools/train/data/val-crops.bin
npx vite-node tools/train/calibrate.ts
```

`--dump-val` re-renders the held-out-font validation set with the same seed training
uses; `calibrate.ts` runs the shipped model through onnxruntime-web, fits T by
minimising NLL, and writes `src/vision/model/calibration.json` with ECE and NLL before
and after. Photos and the synthetic boards are never used to fit it.

## Real-photo crops

`--real-crops path/to/crops.json` adds crops from the owner's photos. The file must
only contain `split=train` crops (the script refuses anything else) and lives under the
git-ignored `data/`. Never train on, tune on, or pick a model with `split=test` photos.
