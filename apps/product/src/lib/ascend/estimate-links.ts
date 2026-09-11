import 'server-only';

import { db } from '@/lib/db';

/**
 * Commercial loop: binds the signed winning estimate to its project.
 * Only signed estimates link (a bid becomes a project on award), the
 * estimate's customer must match the project's, and one estimate feeds
 * at most one project (partial unique index from 029).
 */

export type LinkEstimateResult =
  | { ok: true; projectId: string; estimateId: string }
  | {
      ok: false;
      error:
        | 'project-not-found'
        | 'estimate-not-found'
        | 'estimate-not-signed'
        | 'customer-mismatch'
        | 'already-linked';
    };

export async function linkEstimateToProject(
  estimateId: string,
  projectId: string,
): Promise<LinkEstimateResult> {
  const sql = db();

  const projects = (await sql.query(
    `SELECT id, customer_id, estimate_id FROM modernization_projects
     WHERE id = $1::uuid LIMIT 1`,
    [projectId],
  )) as Array<{
    id: string;
    customer_id: string;
    estimate_id: string | null;
  }>;
  const project = projects[0];
  if (!project) return { ok: false, error: 'project-not-found' };
  if (project.estimate_id && project.estimate_id !== estimateId) {
    return { ok: false, error: 'already-linked' };
  }
  if (project.estimate_id === estimateId) {
    return { ok: true, projectId, estimateId };
  }

  const estimates = (await sql.query(
    `SELECT id, status, customer_id FROM estimates WHERE id = $1::uuid LIMIT 1`,
    [estimateId],
  )) as Array<{ id: string; status: string; customer_id: string }>;
  const estimate = estimates[0];
  if (!estimate) return { ok: false, error: 'estimate-not-found' };
  if (estimate.status !== 'signed') {
    return { ok: false, error: 'estimate-not-signed' };
  }
  if (estimate.customer_id !== project.customer_id) {
    return { ok: false, error: 'customer-mismatch' };
  }

  try {
    await sql.query(
      `UPDATE modernization_projects SET estimate_id = $2::uuid, updated_at = now()
       WHERE id = $1::uuid`,
      [projectId, estimateId],
    );
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) {
      return { ok: false, error: 'already-linked' };
    }
    throw error;
  }
  return { ok: true, projectId, estimateId };
}

export async function unlinkEstimateFromProject(
  projectId: string,
): Promise<boolean> {
  const rows = (await db().query(
    `UPDATE modernization_projects SET estimate_id = NULL, updated_at = now()
     WHERE id = $1::uuid AND estimate_id IS NOT NULL
     RETURNING id`,
    [projectId],
  )) as Array<Record<string, unknown>>;
  return rows.length > 0;
}

export type EstimateProjectLink = {
  estimateId: string;
  projectId: string;
  projectDisplayId: string;
};

/** Batch lookup for bid lists: which estimates already feed projects. */
export async function getEstimateProjectMap(
  estimateIds: string[],
): Promise<Map<string, EstimateProjectLink>> {
  if (estimateIds.length === 0) return new Map();
  const rows = (await db().query(
    `SELECT estimate_id, id, display_id FROM modernization_projects
     WHERE estimate_id = ANY($1::uuid[])`,
    [estimateIds],
  )) as Array<{ estimate_id: string; id: string; display_id: string }>;
  return new Map(
    rows.map((r) => [
      r.estimate_id,
      {
        estimateId: r.estimate_id,
        projectId: r.id,
        projectDisplayId: r.display_id,
      },
    ]),
  );
}
