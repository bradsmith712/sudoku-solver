/**
 * Photo input: file pickers and decoding to ImageData for scan().
 *
 * Decoding goes through an <img>, which applies the JPEG's EXIF orientation in every
 * current browser (CSS image-orientation: from-image is the default), so phone photos
 * arrive upright, as the test decoder (readJpeg) also delivers them. The image is
 * drawn onto a canvas no larger than MAX_SIDE on its longer side: a 12 MP photo
 * would otherwise be a 48 MB ImageData and slow every later step.
 */

/** Longer side of the image handed to scan() (SPEC.md feature 8: about 1024 px). */
export const MAX_SIDE = 1024;

/** Decode an image file, upright per EXIF, scaled down to at most `maxSide` px. */
export async function decodePhoto(file: Blob, maxSide = MAX_SIDE): Promise<ImageData> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2D is not available");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * A hidden file input for photos. `camera` adds capture="environment", which opens
 * the rear camera on phones (and is ignored on desktop, where it is a file picker).
 */
export function createPhotoInput(camera: boolean, onFile: (file: File) => void): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  if (camera) input.setAttribute("capture", "environment");
  input.hidden = true;
  input.dataset.testid = camera ? "camera-input" : "upload-input";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = ""; // picking the same file again still fires change
    if (file) onFile(file);
  });
  return input;
}
