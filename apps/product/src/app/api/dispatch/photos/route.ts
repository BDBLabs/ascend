import type { NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { db, isDatabaseConfigured } from '@/lib/db';
import { hashTrackingToken, isWellFormedTrackingToken } from '@/lib/dispatch-tracking';
import { classifyHost } from '@/lib/host';
import { privateJson } from '@/lib/http';
import { MAX_PHOTOS, validatePhotos } from '@/lib/image-upload';
import { getClientIp } from '@/lib/rate-limit';
import { rateLimitWithFallback } from '@/lib/redis-rate-limit';
import { deleteUpload, saveUpload } from '@/lib/storage';
import { TenantResolutionError, withTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

/**
 * Attaches photos to a dispatch ticket. The caller proves ownership with the
 * ticket's tracking token (not its id, which was the previous, unauthenticated
 * key), and the rows are written through the tenant path so RLS binds them to
 * the ticket's tenant. Content type comes from magic bytes, not the upload.
 * If the database write fails, the stored objects are deleted again so a
 * failed request leaves no orphans.
 */
export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Service temporarily unavailable' }, 503);
  }

  const host = (await headers()).get('host') ?? '';
  if (classifyHost(host) !== 'tenant') {
    return privateJson({ error: 'Dispatch is not available on this host.' }, 404);
  }

  const ip = getClientIp(request);
  if (!(await rateLimitWithFallback(`dispatch-photos:${ip}`, { capacity: 10, refillPerMinute: 3 }))) {
    return privateJson({ error: 'Too many requests. Please try again later.' }, 429);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return privateJson({ error: 'Invalid form data' }, 400);
  }

  const token = formData.get('token');
  if (typeof token !== 'string' || !isWellFormedTrackingToken(token)) {
    return privateJson({ error: 'Ticket not found.' }, 404);
  }

  const files = formData.getAll('photos').filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return privateJson({ error: 'No photos provided' }, 400);
  }
  const validated = await validatePhotos(files);
  if (!validated.ok) {
    return privateJson({ error: validated.error }, 400);
  }

  try {
    return await withTenant(async () => {
      const sql = db();
      const tickets = (await sql.query(
        `SELECT t.id, (SELECT count(*) FROM dispatch_ticket_photos p WHERE p.ticket_id = t.id) AS photo_count
           FROM dispatch_tickets t
          WHERE t.tracking_token_hash = $1`,
        [hashTrackingToken(token)],
      )) as Array<{ id: string; photo_count: string | number }>;
      const ticket = tickets[0];
      if (!ticket) return privateJson({ error: 'Ticket not found.' }, 404);
      if (Number(ticket.photo_count) + validated.photos.length > MAX_PHOTOS) {
        return privateJson({ error: `Maximum ${MAX_PHOTOS} photos allowed` }, 400);
      }

      const stored: string[] = [];
      try {
        for (const photo of validated.photos) {
          stored.push(await saveUpload(photo.bytes, photo.extension, photo.contentType));
        }
        const rows = (await sql.query(
          `INSERT INTO dispatch_ticket_photos
             (organization_id, ticket_id, storage_key, filename, mime_type, size_bytes)
           SELECT app_require_organization_id(), $1::uuid, photo.storage_key, photo.filename,
                  photo.mime_type, photo.size_bytes
             FROM json_to_recordset($2::json) AS photo(
               storage_key text, filename text, mime_type text, size_bytes bigint)
           RETURNING id, filename`,
          [
            ticket.id,
            JSON.stringify(validated.photos.map((photo, index) => ({
              storage_key: stored[index],
              filename: photo.filename,
              mime_type: photo.contentType,
              size_bytes: photo.sizeBytes,
            }))),
          ],
        )) as Array<{ id: string; filename: string }>;
        return privateJson({ ok: true, photos: rows }, 201);
      } catch (error) {
        await Promise.allSettled(stored.map((key) => deleteUpload(key)));
        throw error;
      }
    });
  } catch (error) {
    if (error instanceof TenantResolutionError) {
      return privateJson({ error: 'Dispatch is not available on this host.' }, 404);
    }
    console.error('Dispatch photo upload failed:', error);
    return privateJson({ error: 'Failed to store photos' }, 500);
  }
}
