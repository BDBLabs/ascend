import 'server-only';

import type {
  ActivityInput,
  ActivityStatus,
  EvidenceInput,
  EvidenceKind,
  MilestoneInput,
  MilestoneStatus,
  ObligationInput,
  ObligationStatus,
} from './obligation-contract';
import {
  canTransitionActivity,
  canTransitionMilestone,
  canTransitionObligation,
  isActivityStatus,
  isMilestoneStatus,
  isObligationStatus,
  validateActivityInput,
  validateEvidenceInput,
  validateMilestoneInput,
  validateObligationInput,
} from './obligation-contract';
import type {
  ActivityRecord,
  EvidenceRecord,
  MilestoneRecord,
  ObligationRecord,
} from './ascend-records';
import {
  mapActivity,
  mapEvidence,
  mapMilestone,
  mapObligation,
} from './ascend-records';
import { db } from '@/lib/db';
import { requireOrganizationContext } from '@/lib/organization-context-store';

export type {
  ActivityRecord,
  EvidenceRecord,
  MilestoneRecord,
  ObligationRecord,
};

type Row = Record<string, unknown>;

const TOKENS = `to_json(created_at) AS created_at_token,
  to_json(updated_at) AS updated_at_token`;

/* ── Obligations ───────────────────────────────────────────────────── */

export async function createObligation(
  input: ObligationInput,
): Promise<ObligationRecord> {
  const errors = validateObligationInput(input);
  if (errors.length) throw new Error(`Invalid obligation: ${errors.join(' ')}`);
  const actorId = requireOrganizationContext().actorId;
  const rows = (await db().query(
    `WITH inserted AS (
       INSERT INTO contract_obligations
         (organization_id, project_id, title, description, source_ref, due_date)
       VALUES
         (app_require_organization_id(), $1::uuid, $2, $3, $4, $5::date)
       RETURNING *, ${TOKENS}
     ),
     event AS (
       INSERT INTO obligation_events
         (organization_id, obligation_id, event, actor_id, meta)
       SELECT app_require_organization_id(), inserted.id, 'created',
              $6::uuid, '{}'::jsonb
       FROM inserted
     )
     SELECT * FROM inserted`,
    [
      input.projectId,
      input.title.trim(),
      input.description?.trim() ?? '',
      input.sourceRef?.trim() ?? '',
      input.dueDate ?? null,
      actorId,
    ],
  )) as Row[];
  const row = rows[0];
  if (!row) throw new Error('Obligation insert returned no row.');
  return mapObligation(row);
}

export async function listObligations(
  projectId: string,
): Promise<ObligationRecord[]> {
  const rows = (await db().query(
    `SELECT *, ${TOKENS} FROM contract_obligations
     WHERE project_id = $1::uuid
     ORDER BY created_at ASC, id`,
    [projectId],
  )) as Row[];
  return rows.map(mapObligation);
}

export type ObligationStatusResult =
  | { ok: true; obligation: ObligationRecord }
  | { ok: false; error: 'obligation-not-found' | 'invalid-transition' };

export async function setObligationStatus(
  obligationId: string,
  toStatus: ObligationStatus,
  note?: string,
): Promise<ObligationStatusResult> {
  if (!isObligationStatus(toStatus)) {
    return { ok: false, error: 'invalid-transition' };
  }
  const actorId = requireOrganizationContext().actorId;
  const sql = db();
  const current = (await sql.query(
    `SELECT status FROM contract_obligations WHERE id = $1::uuid LIMIT 1`,
    [obligationId],
  )) as Array<{ status: ObligationStatus }>;
  const from = current[0]?.status;
  if (!from) return { ok: false, error: 'obligation-not-found' };
  if (!canTransitionObligation(from, toStatus)) {
    return { ok: false, error: 'invalid-transition' };
  }
  if (from === toStatus) {
    const same = (await sql.query(
      `SELECT *, ${TOKENS} FROM contract_obligations WHERE id = $1::uuid LIMIT 1`,
      [obligationId],
    )) as Row[];
    return same[0]
      ? { ok: true, obligation: mapObligation(same[0]) }
      : { ok: false, error: 'obligation-not-found' };
  }
  const rows = (await sql.query(
    `WITH updated AS (
       UPDATE contract_obligations
       SET status = $2, updated_at = now()
       WHERE id = $1::uuid
       RETURNING *, ${TOKENS}
     ),
     event AS (
       INSERT INTO obligation_events
         (organization_id, obligation_id, event, actor_id, meta)
       SELECT app_require_organization_id(), updated.id, 'status_changed',
              $3::uuid,
              jsonb_build_object('from_status', $4, 'to_status', $2,
                                 'note', COALESCE($5, ''))
       FROM updated
     )
     SELECT * FROM updated`,
    [obligationId, toStatus, actorId, from, note?.trim() ?? null],
  )) as Row[];
  const row = rows[0];
  if (!row) return { ok: false, error: 'obligation-not-found' };
  return { ok: true, obligation: mapObligation(row) };
}

/* ── Milestones ────────────────────────────────────────────────────── */

export async function createMilestone(
  input: MilestoneInput,
): Promise<MilestoneRecord> {
  const errors = validateMilestoneInput(input);
  if (errors.length) throw new Error(`Invalid milestone: ${errors.join(' ')}`);
  const actorId = requireOrganizationContext().actorId;
  const rows = (await db().query(
    `WITH inserted AS (
       INSERT INTO obligation_milestones
         (organization_id, obligation_id, title, description, due_date)
       VALUES
         (app_require_organization_id(), $1::uuid, $2, $3, $4::date)
       RETURNING *, ${TOKENS}
     ),
     event AS (
       INSERT INTO obligation_events
         (organization_id, obligation_id, milestone_id, event, actor_id, meta)
       SELECT app_require_organization_id(), inserted.obligation_id,
              inserted.id, 'created', $5::uuid, '{}'::jsonb
       FROM inserted
     )
     SELECT * FROM inserted`,
    [
      input.obligationId,
      input.title.trim(),
      input.description?.trim() ?? '',
      input.dueDate ?? null,
      actorId,
    ],
  )) as Row[];
  const row = rows[0];
  if (!row) throw new Error('Milestone insert returned no row.');
  return mapMilestone(row);
}

export async function listMilestones(
  obligationId: string,
): Promise<MilestoneRecord[]> {
  const rows = (await db().query(
    `SELECT *, ${TOKENS} FROM obligation_milestones
     WHERE obligation_id = $1::uuid
     ORDER BY created_at ASC, id`,
    [obligationId],
  )) as Row[];
  return rows.map(mapMilestone);
}

export type MilestoneStatusResult =
  | { ok: true; milestone: MilestoneRecord }
  | { ok: false; error: 'milestone-not-found' | 'invalid-transition' };

export async function setMilestoneStatus(
  milestoneId: string,
  toStatus: MilestoneStatus,
  note?: string,
): Promise<MilestoneStatusResult> {
  if (!isMilestoneStatus(toStatus)) {
    return { ok: false, error: 'invalid-transition' };
  }
  const actorId = requireOrganizationContext().actorId;
  const sql = db();
  const current = (await sql.query(
    `SELECT status, obligation_id FROM obligation_milestones WHERE id = $1::uuid LIMIT 1`,
    [milestoneId],
  )) as Array<{ status: MilestoneStatus; obligation_id: string }>;
  const from = current[0];
  if (!from) return { ok: false, error: 'milestone-not-found' };
  if (!canTransitionMilestone(from.status, toStatus)) {
    return { ok: false, error: 'invalid-transition' };
  }
  const rows = (await sql.query(
    `WITH updated AS (
       UPDATE obligation_milestones
       SET status = $2, updated_at = now()
       WHERE id = $1::uuid
       RETURNING *, ${TOKENS}
     ),
     event AS (
       INSERT INTO obligation_events
         (organization_id, obligation_id, milestone_id, event, actor_id, meta)
       SELECT app_require_organization_id(), updated.obligation_id,
              updated.id, 'status_changed', $3::uuid,
              jsonb_build_object('from_status', $4, 'to_status', $2,
                                 'note', COALESCE($5, ''))
       FROM updated
     )
     SELECT * FROM updated`,
    [milestoneId, toStatus, actorId, from.status, note?.trim() ?? null],
  )) as Row[];
  const row = rows[0];
  if (!row) return { ok: false, error: 'milestone-not-found' };
  return { ok: true, milestone: mapMilestone(row) };
}

/* ── Activities + evidence ─────────────────────────────────────────── */

export async function createActivity(
  input: ActivityInput,
): Promise<ActivityRecord> {
  const errors = validateActivityInput(input);
  if (errors.length) throw new Error(`Invalid activity: ${errors.join(' ')}`);
  const actorId = requireOrganizationContext().actorId;
  const rows = (await db().query(
    `WITH inserted AS (
       INSERT INTO required_activities
         (organization_id, milestone_id, work_package_id, title,
          description, evidence_required)
       VALUES
         (app_require_organization_id(), $1::uuid, $2::uuid, $3, $4, $5)
       RETURNING *, ${TOKENS}
     ),
     event AS (
       INSERT INTO obligation_events
         (organization_id, obligation_id, milestone_id, activity_id,
          event, actor_id, meta)
       SELECT app_require_organization_id(), milestone.obligation_id,
              inserted.milestone_id, inserted.id, 'created', $6::uuid,
              '{}'::jsonb
       FROM inserted
       JOIN obligation_milestones AS milestone
         ON milestone.id = inserted.milestone_id
        AND milestone.organization_id = inserted.organization_id
     )
     SELECT inserted.*, package.name AS work_package_name,
            0 AS evidence_count
     FROM inserted
     LEFT JOIN work_packages AS package
       ON package.id = inserted.work_package_id
      AND package.organization_id = inserted.organization_id`,
    [
      input.milestoneId,
      input.workPackageId ?? null,
      input.title.trim(),
      input.description?.trim() ?? '',
      input.evidenceRequired ?? false,
      actorId,
    ],
  )) as Row[];
  const row = rows[0];
  if (!row) throw new Error('Activity insert returned no row.');
  return mapActivity(row);
}

const ACTIVITY_SELECT = `
  SELECT
    activity.*,
    package.name AS work_package_name,
    (SELECT count(*)::int FROM activity_evidence AS ev
     WHERE ev.activity_id = activity.id
       AND ev.organization_id = activity.organization_id) AS evidence_count,
    to_json(activity.created_at) AS created_at_token,
    to_json(activity.updated_at) AS updated_at_token
  FROM required_activities AS activity
  LEFT JOIN work_packages AS package
    ON package.id = activity.work_package_id
   AND package.organization_id = activity.organization_id
`;

export async function listActivities(
  milestoneId: string,
): Promise<ActivityRecord[]> {
  const rows = (await db().query(
    `${ACTIVITY_SELECT}
     WHERE activity.milestone_id = $1::uuid
     ORDER BY activity.created_at ASC, activity.id`,
    [milestoneId],
  )) as Row[];
  return rows.map(mapActivity);
}

export type ActivityStatusResult =
  | { ok: true; activity: ActivityRecord }
  | {
      ok: false;
      error: 'activity-not-found' | 'invalid-transition' | 'evidence-required';
    };

export async function setActivityStatus(
  activityId: string,
  toStatus: ActivityStatus,
  note?: string,
): Promise<ActivityStatusResult> {
  if (!isActivityStatus(toStatus)) {
    return { ok: false, error: 'invalid-transition' };
  }
  const actorId = requireOrganizationContext().actorId;
  const sql = db();
  const current = (await sql.query(
    `SELECT activity.status, activity.evidence_required,
            activity.milestone_id, milestone.obligation_id,
            (SELECT count(*)::int FROM activity_evidence AS ev
             WHERE ev.activity_id = activity.id
               AND ev.organization_id = activity.organization_id) AS evidence_count
     FROM required_activities AS activity
     JOIN obligation_milestones AS milestone
       ON milestone.id = activity.milestone_id
      AND milestone.organization_id = activity.organization_id
     WHERE activity.id = $1::uuid LIMIT 1`,
    [activityId],
  )) as Array<{
    status: ActivityStatus;
    evidence_required: boolean;
    milestone_id: string;
    obligation_id: string;
    evidence_count: number;
  }>;
  const from = current[0];
  if (!from) return { ok: false, error: 'activity-not-found' };
  if (!canTransitionActivity(from.status, toStatus)) {
    return { ok: false, error: 'invalid-transition' };
  }
  if (
    toStatus === 'done' &&
    from.evidence_required &&
    Number(from.evidence_count) === 0
  ) {
    return { ok: false, error: 'evidence-required' };
  }
  const rows = (await sql.query(
    `WITH updated AS (
       UPDATE required_activities
       SET status = $2, updated_at = now()
       WHERE id = $1::uuid
       RETURNING *
     ),
     event AS (
       INSERT INTO obligation_events
         (organization_id, obligation_id, milestone_id, activity_id,
          event, actor_id, meta)
       SELECT app_require_organization_id(), $3::uuid, $4::uuid,
              updated.id, 'status_changed', $5::uuid,
              jsonb_build_object('from_status', $6, 'to_status', $2,
                                 'note', COALESCE($7, ''))
       FROM updated
     )
     SELECT updated.*,
            package.name AS work_package_name,
            to_json(updated.created_at) AS created_at_token,
            to_json(updated.updated_at) AS updated_at_token,
            $8 AS evidence_count
     FROM updated
     LEFT JOIN work_packages AS package
       ON package.id = updated.work_package_id
      AND package.organization_id = updated.organization_id`,
    [
      activityId,
      toStatus,
      from.obligation_id,
      from.milestone_id,
      actorId,
      from.status,
      note?.trim() ?? null,
      Number(from.evidence_count),
    ],
  )) as Row[];
  const row = rows[0];
  if (!row) return { ok: false, error: 'activity-not-found' };
  return { ok: true, activity: mapActivity(row) };
}

export async function attachEvidence(
  activityId: string,
  input: EvidenceInput,
): Promise<{ ok: true; evidence: EvidenceRecord } | { ok: false; error: 'activity-not-found' | 'invalid' }> {
  const errors = validateEvidenceInput(input);
  if (errors.length) return { ok: false, error: 'invalid' };
  const actorId = requireOrganizationContext().actorId;
  const sql = db();
  const found = (await sql.query(
    `SELECT m.obligation_id, activity.milestone_id
     FROM required_activities AS activity
     JOIN obligation_milestones AS m
       ON m.id = activity.milestone_id
      AND m.organization_id = activity.organization_id
     WHERE activity.id = $1::uuid LIMIT 1`,
    [activityId],
  )) as Array<{ obligation_id: string; milestone_id: string }>;
  const parent = found[0];
  if (!parent) return { ok: false, error: 'activity-not-found' };
  const rows = (await sql.query(
    `WITH inserted AS (
       INSERT INTO activity_evidence
         (organization_id, activity_id, kind, ref, note, actor_id)
       VALUES
         (app_require_organization_id(), $1::uuid, $2, $3, $4, $5::uuid)
       RETURNING *, to_json(created_at) AS created_at_token
     ),
     event AS (
       INSERT INTO obligation_events
         (organization_id, obligation_id, milestone_id, activity_id,
          event, actor_id, meta)
       SELECT app_require_organization_id(), $6::uuid, $7::uuid,
              inserted.activity_id, 'evidence_attached', $5::uuid,
              jsonb_build_object('kind', $2)
       FROM inserted
     )
     SELECT * FROM inserted`,
    [
      activityId,
      input.kind as EvidenceKind,
      input.ref?.trim() ?? '',
      input.note?.trim() ?? '',
      actorId,
      parent.obligation_id,
      parent.milestone_id,
    ],
  )) as Row[];
  const row = rows[0];
  if (!row) return { ok: false, error: 'activity-not-found' };
  return { ok: true, evidence: mapEvidence(row) };
}

export async function listEvidence(
  activityId: string,
): Promise<EvidenceRecord[]> {
  const rows = (await db().query(
    `SELECT *, to_json(created_at) AS created_at_token
     FROM activity_evidence
     WHERE activity_id = $1::uuid
     ORDER BY created_at ASC, id`,
    [activityId],
  )) as Row[];
  return rows.map(mapEvidence);
}

export type ObligationDetail = {
  obligation: ObligationRecord;
  milestones: Array<{
    milestone: MilestoneRecord;
    activities: Array<{
      activity: ActivityRecord;
      evidence: EvidenceRecord[];
    }>;
  }>;
};

/** Full obligation tree for detail views: milestones, activities, evidence. */
export async function getObligationDetail(
  obligationId: string,
): Promise<ObligationDetail | null> {
  const sql = db();
  const obligations = (await sql.query(
    `SELECT *, ${TOKENS} FROM contract_obligations WHERE id = $1::uuid LIMIT 1`,
    [obligationId],
  )) as Row[];
  const obligationRow = obligations[0];
  if (!obligationRow) return null;
  const milestones = await listMilestones(obligationId);
  const detail: ObligationDetail = {
    obligation: mapObligation(obligationRow),
    milestones: [],
  };
  for (const milestone of milestones) {
    const activities = await listActivities(milestone.id);
    const withEvidence = [];
    for (const activity of activities) {
      withEvidence.push({
        activity,
        evidence: await listEvidence(activity.id),
      });
    }
    detail.milestones.push({ milestone, activities: withEvidence });
  }
  return detail;
}
