import { describe, expect, it } from 'vitest';
import { MAX_PHOTO_BYTES, sniffImage, validatePhotos } from '@/lib/image-upload';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ');
const HEIC = Uint8Array.from([0, 0, 0, 0x18, ...new TextEncoder().encode('ftypheic')]);

function file(bytes: Uint8Array, name: string, type: string) {
  return new File([bytes as BlobPart], name, { type });
}

describe('sniffImage', () => {
  it('identifies supported images by their bytes', () => {
    expect(sniffImage(JPEG)?.contentType).toBe('image/jpeg');
    expect(sniffImage(PNG)?.contentType).toBe('image/png');
    expect(sniffImage(WEBP)?.contentType).toBe('image/webp');
    expect(sniffImage(HEIC)?.contentType).toBe('image/heic');
  });

  it('rejects everything else', () => {
    expect(sniffImage(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
    expect(sniffImage(new TextEncoder().encode('%PDF-1.7'))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe('validatePhotos', () => {
  it('takes the stored type from the bytes, not the declared type or name', async () => {
    const result = await validatePhotos([file(PNG, 'photo.jpg', 'image/jpeg')]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.photos[0]).toMatchObject({ contentType: 'image/png', extension: 'png' });
    }
  });

  it('refuses a script disguised as an image', async () => {
    const result = await validatePhotos([
      file(new TextEncoder().encode('<html><script>x</script>'), 'x.png', 'image/png'),
    ]);
    expect(result).toEqual({ ok: false, error: 'Photos must be JPEG, PNG, WebP, GIF or HEIC images' });
  });

  it('enforces count and size limits', async () => {
    expect((await validatePhotos(Array.from({ length: 6 }, () => file(JPEG, 'a.jpg', 'image/jpeg')))).ok).toBe(false);
    const big = new Uint8Array(MAX_PHOTO_BYTES + 1);
    big.set(JPEG);
    expect((await validatePhotos([file(big, 'big.jpg', 'image/jpeg')])).ok).toBe(false);
    expect((await validatePhotos([file(new Uint8Array(), 'empty.jpg', 'image/jpeg')])).ok).toBe(false);
  });
});
