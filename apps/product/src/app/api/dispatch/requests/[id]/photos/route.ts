import type { NextRequest } from 'next/server';
import { platformDb, isDatabaseConfigured } from '@/lib/db';
import { privateJson } from '@/lib/http';
import { saveUpload } from '@/lib/storage';

export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);
const MAX_PHOTOS = 5;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Service temporarily unavailable' }, 503);
  }

  const { id: ticketId } = await params;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return privateJson({ error: 'Invalid form data' }, 400);
  }

  const files = formData.getAll('photos').filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return privateJson({ error: 'No photos provided' }, 400);
  }
  if (files.length > MAX_PHOTOS) {
    return privateJson({ error: `Maximum ${MAX_PHOTOS} photos allowed` }, 400);
  }

  const sql = platformDb();
  const saved: Array<{ id: string; filename: string }> = [];

  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      return privateJson({ error: `File "${file.name}" exceeds 8 MB limit` }, 400);
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return privateJson({ error: `File type "${file.type}" is not supported` }, 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split('.').pop() ?? 'jpg';
    const storageKey = await saveUpload(buffer, ext);

    const rows = (await sql.query(
      `INSERT INTO dispatch_ticket_photos (ticket_id, storage_key, filename, mime_type)
       VALUES ($1, $2, $3, $4)
       RETURNING id, filename`,
      [ticketId, storageKey, file.name, file.type],
    )) as Array<{ id: string; filename: string }>;
    const inserted = rows[0];
    if (inserted) saved.push(inserted);
  }

  return privateJson({ ok: true, photos: saved }, 201);
}
