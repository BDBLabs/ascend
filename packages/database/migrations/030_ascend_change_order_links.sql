-- 030_ascend_change_order_links.sql
--
-- Commercial loop, part 2: J-Box change orders (which attach to
-- estimate/job) link to modernization projects so approved change value
-- flows into current contract value, margin, and billing snapshots. The
-- change-order engine itself is untouched — this is an association, and
-- only approved change orders count toward contract value (computed in
-- the read model, not stored, so approvals apply immediately).
--
-- One change order links to at most one project: an approved CO has a
-- single commercial home and can never double-count across projects.

CREATE TABLE IF NOT EXISTS project_change_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,

  project_id uuid NOT NULL,
  change_order_id uuid NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, organization_id),
  UNIQUE (change_order_id, organization_id),
  FOREIGN KEY (project_id, organization_id)
    REFERENCES modernization_projects (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (change_order_id, organization_id)
    REFERENCES change_orders (id, organization_id) ON DELETE CASCADE
);

-- migrate:split

CREATE INDEX IF NOT EXISTS project_change_orders_project_idx
  ON project_change_orders (project_id, change_order_id);

-- migrate:split

ALTER TABLE project_change_orders ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE project_change_orders FORCE ROW LEVEL SECURITY;

-- migrate:split

CREATE POLICY project_change_orders_tenant_isolation ON project_change_orders
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

GRANT SELECT, INSERT, UPDATE, DELETE
  ON project_change_orders
  TO contractor_app;
