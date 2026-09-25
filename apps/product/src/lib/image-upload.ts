/**
 * Validation for customer-supplied photos. The declared Content-Type and file
 * name are attacker-controlled, so the stored type and extension come from the
 * file's magic bytes; a file whose bytes are not a supported image is refused.
 */

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_PHOTOS = 5;

export type SniffedImage = { contentType: string; extension: string };

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** Identifies JPEG, PNG, WebP, GIF and HEIC/HEIF by content; null otherwise. */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { contentType: 'image/jpeg', extension: 'jpg' };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { contentType: 'image/png', extension: 'png' };
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return { contentType: 'image/webp', extension: 'webp' };
  }
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')) {
    return { contentType: 'image/gif', extension: 'gif' };
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(brand)) {
      return { contentType: 'image/heic', extension: 'heic' };
    }
    if (['mif1', 'msf1'].includes(brand)) return { contentType: 'image/heif', extension: 'heif' };
  }
  return null;
}

export type ValidatedPhoto = {
  bytes: Buffer;
  contentType: string;
  extension: string;
  filename: string;
  sizeBytes: number;
};

export type PhotoValidationResult =
  | { ok: true; photos: ValidatedPhoto[] }
  | { ok: false; error: string };

/** Checks count and size before reading, then content type from the bytes. */
export async function validatePhotos(files: File[]): Promise<PhotoValidationResult> {
  if (files.length > MAX_PHOTOS) return { ok: false, error: `Maximum ${MAX_PHOTOS} photos allowed` };
  for (const file of files) {
    if (file.size > MAX_PHOTO_BYTES) return { ok: false, error: 'Each photo must be under 8 MB' };
    if (file.size === 0) return { ok: false, error: 'A photo was empty' };
  }

  const photos: ValidatedPhoto[] = [];
  for (const file of files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length > MAX_PHOTO_BYTES) return { ok: false, error: 'Each photo must be under 8 MB' };
    const sniffed = sniffImage(bytes);
    if (!sniffed) return { ok: false, error: 'Photos must be JPEG, PNG, WebP, GIF or HEIC images' };
    photos.push({
      bytes,
      contentType: sniffed.contentType,
      extension: sniffed.extension,
      filename: file.name.replace(/[\u0000-\u001f]/g, '').slice(0, 200),
      sizeBytes: bytes.length,
    });
  }
  return { ok: true, photos };
}
