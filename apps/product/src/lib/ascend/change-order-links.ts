import 'server-only';

import { db } from '@/lib/db';

/**
 * Commercial loop: J-Box change orders attach to projects without
 * touching the change-order engine. One change order has a single
 * commercial home (unique per CO), and only approved change orders
 * count toward current contract value — computed live so approvals
 * apply immediately.
 */

export type ProjectChangeOrderRecord = {
  changeOrderId: string;
  displayId: string;
  title: string;
  status: string;
  changeAmountCents: number;
};

export type LinkChangeOrderResult =
  | { ok: true; projectId: string; changeOrderId: string }
  | {
      ok: false;
      error:
        | 'project-not-found'
        | 'change-order-not-found'
        | 'customer-mismatch'
        | 'already-linked';
    };

export async function linkChangeOrderToProject(
  changeOrderId: string,
  projectId: string,
): Promise<LinkChangeOrderResult> {
  const sql = db();

  const projects = (await sql.query(
    `SELECT id, customer_id FROM modernization_projects WHERE id = $1::uuid LIMIT 1`,
    [projectId],
  )) as Array<{ id: string; customer_id: string }>;
  const project = projects[0];
  if (!project) return { ok: false, error: 'project-not-found' };

  const orders = (await sql.query(
    `SELECT co.id, e.customer_id
     FROM change_orders AS co
     JOIN estimates AS e
       ON e.id = co.estimate_id
      AND e.organization_id = co.organization_id
     WHERE co.id = $1::uuid LIMIT 1`,
    [changeOrderId],
  )) as Array<{ id: string; customer_id: string }>;
  const order = orders[0];
  if (!order) return { ok: false, error: 'change-order-not-found' };
  if (order.customer_id !== project.customer_id) {
    return { ok: false, error: 'customer-mismatch' };
  }

  try {
    await sql.query(
      `INSERT INTO project_change_orders
         (organization_id, project_id, change_order_id)
       VALUES (app_require_organization_id(), $1::uuid, $2::uuid)`,
      [projectId, changeOrderId],
    );
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) {
      return { ok: false, error: 'already-linked' };
    }
    throw error;
  }
  return { ok: true, projectId, changeOrderId };
}

export async function unlinkChangeOrderFromProject(
  projectId: string,
  changeOrderId: string,
): Promise<boolean> {
  const rows = (await db().query(
    `DELETE FROM project_change_orders
     WHERE project_id = $1::uuid AND change_order_id = $2::uuid
     RETURNING id`,
    [projectId, changeOrderId],
  )) as Array<Record<string, unknown>>;
  return rows.length > 0;
}

export async function listProjectChangeOrders(
  projectId: string,
): Promise<ProjectChangeOrderRecord[]> {
  const rows = (await db().query(
    `SELECT co.id, co.display_id, co.title, co.status, co.change_amount_cents
     FROM project_change_orders AS link
     JOIN change_orders AS co
       ON co.id = link.change_order_id
      AND co.organization_id = link.organization_id
     WHERE link.project_id = $1::uuid
     ORDER BY co.display_id ASC`,
    [projectId],
  )) as Array<{
    id: string;
    display_id: string;
    title: string;
    status: string;
    change_amount_cents: string | number;
  }>;
  return rows.map((r) => ({
    changeOrderId: r.id,
    displayId: r.display_id,
    title: r.title,
    status: r.status,
    changeAmountCents: Number(r.change_amount_cents ?? 0),
  }));
}

/**
 * Approved change value for a project: the engine's own per-CO net
 * (add lines add, remove lines subtract). Unapproved links contribute
 * nothing until they approve.
 */
export async function getProjectApprovedChangeValue(
  projectId: string,
): Promise<number> {
  const rows = (await db().query(
    `SELECT COALESCE(SUM(co.change_amount_cents), 0)::bigint AS total
     FROM project_change_orders AS link
     JOIN change_orders AS co
       ON co.id = link.change_order_id
      AND co.organization_id = link.organization_id
     WHERE link.project_id = $1::uuid
       AND co.status = 'approved'`,
    [projectId],
  )) as Array<{ total: string | number }>;
  return Number(rows[0]?.total ?? 0);
}

export type RecentChangeOrder = {
  changeOrderId: string;
  displayId: string;
  title: string;
  status: string;
  changeAmountCents: number;
  customerName: string;
};

/**
 * Recent change orders across the tenant for link pickers. Read-only
 * over the J-Box tables; the engine itself is untouched.
 */
export async function listRecentChangeOrders(
  limit = 50,
): Promise<RecentChangeOrder[]> {
  const bounded = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const rows = (await db().query(
    `SELECT co.id, co.display_id, co.title, co.status, co.change_amount_cents,
            customer.display_name AS customer_name
     FROM change_orders AS co
     JOIN estimates AS e
       ON e.id = co.estimate_id
      AND e.organization_id = co.organization_id
     JOIN customers AS customer
       ON customer.id = e.customer_id
      AND customer.organization_id = co.organization_id
     ORDER BY co.created_at DESC, co.id
     LIMIT $1`,
    [bounded],
  )) as Array<{
    id: string;
    display_id: string;
    title: string;
    status: string;
    change_amount_cents: string | number;
    customer_name: string;
  }>;
  return rows.map((r) => ({
    changeOrderId: r.id,
    displayId: r.display_id,
    title: r.title,
    status: r.status,
    changeAmountCents: Number(r.change_amount_cents ?? 0),
    customerName: r.customer_name ?? '',
  }));
}
