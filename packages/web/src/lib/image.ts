const MAX_SIDE = 1200;

const QUALITY = 0.85;

/**
 * Same limit as the API (`MAX_IMAGE_BYTES`): a resized photo is far below it.
 */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const toBlob = (canvas: HTMLCanvasElement, type: string) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, QUALITY));

/**
 * Scales the photo down to at most 1200 px on the longest side and re-encodes it as WebP (JPEG where the browser
 * cannot encode WebP), so uploads stay small whatever the camera produced.
 */
export const resizeImage = async (file: File) => {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');

  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const webp = await toBlob(canvas, 'image/webp');
  const blob = webp?.type === 'image/webp' ? webp : await toBlob(canvas, 'image/jpeg');

  if (!blob || blob.size > MAX_IMAGE_BYTES) {
    throw new Error('Image could not be resized');
  }

  return blob;
};
