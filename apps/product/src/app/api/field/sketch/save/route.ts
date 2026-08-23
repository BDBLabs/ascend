import type { NextRequest } from 'next/server';
import { db, isDatabaseConfigured } from '@/lib/db';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { privateJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

interface PlacedElement {
  symbol_id: string;
  display_name: string;
  x: number;
  y: number;
  unit_price_cents: number;
}

export async function GET(request: NextRequest) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.read')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Sketch data unavailable' }, 503);
  }

  const estimateId = request.nextUrl.searchParams.get('estimateId');
  if (!estimateId) {
    return privateJson({ error: 'estimateId query parameter is required' }, 400);
  }

  try {
    return await withFieldContext(principal, async () => {
      const sql = db();
      const elements = await sql.query(
        `SELECT id, symbol_id, display_name, x, y, unit_price_cents, position
         FROM estimate_sketch_elements
         WHERE estimate_id = $1
         ORDER BY position ASC, created_at ASC`,
        [estimateId],
      );
      return privateJson({ elements });
    });
  } catch (error) {
    console.error('Failed to load sketch elements:', error);
    return privateJson({ error: 'Failed to load sketch elements' }, 503);
  }
}

export async function POST(request: NextRequest) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.prepare')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'Sketch save unavailable' }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return privateJson({ error: 'Invalid body' }, 400);
  }

  const estimateId = typeof body.estimateId === 'string' ? body.estimateId : null;
  const elements = Array.isArray(body.elements) ? body.elements as PlacedElement[] : null;

  if (!estimateId) {
    return privateJson({ error: 'estimateId is required' }, 400);
  }

  if (!elements || elements.length === 0) {
    return privateJson({ error: 'At least one element is required' }, 400);
  }

  try {
    return await withFieldContext(principal, async () => {
      const sql = db();

      await sql.transaction([
        sql.query(
          'DELETE FROM estimate_sketch_elements WHERE estimate_id = $1',
          [estimateId],
        ),
        ...elements.map((el, i) =>
          sql.query(
            `INSERT INTO estimate_sketch_elements
               (organization_id, estimate_id, symbol_id, display_name, x, y, unit_price_cents, position)
             VALUES (app_require_organization_id(), $1, $2, $3, $4, $5, $6, $7)`,
            [estimateId, el.symbol_id, el.display_name, el.x, el.y, el.unit_price_cents || 0, i],
          ),
        ),
      ]);

      const totalCents = elements.reduce((sum, el) => sum + (el.unit_price_cents || 0), 0);

      return privateJson({
        success: true,
        estimateId,
        elementCount: elements.length,
        totalCents,
      });
    });
  } catch (error) {
    console.error('Failed to save sketch elements:', error);
    return privateJson({ error: 'Failed to save sketch elements' }, 503);
  }
}
