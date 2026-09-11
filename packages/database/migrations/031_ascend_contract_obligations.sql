-- 031_ascend_contract_obligations.sql
--
-- Contractual-obligation tracing: Contract Obligation → Milestone →
-- Required Activity → Evidence → Status. Obligations hang off projects
-- (the commercial home); activities may pin to a work package so future
-- progress and billing events resolve against the same identifiers the
-- rest of Ascend already uses (project, work package, event actor).
--
-- Status is stored per level with guarded transitions (application
-- contract), and every change appends an immutable obligation_events
-- row. Evidence rows are the proof behind a done activity; activities
-- flagged evidence_required cannot complete with zero evidence.

CREATE TABLE IF NOT EXISTS contract_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,

  project_id uuid NOT NULL,

  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 4000),
  source_ref text NOT NULL DEFAULT '' CHECK (char_length(source_ref) <= 200),
  due_date date,

  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'satisfied', 'waived')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, organization_id),
  FOREIGN KEY (project_id, organization_id)
    REFERENCES modernization_projects (id, organization_id) ON DELETE CASCADE
);

-- migrate:split

CREATE INDEX IF NOT EXISTS contract_obligations_org_project_idx
  ON contract_obligations (organization_id, project_id, status);

-- migrate:split

CREATE TABLE IF NOT EXISTS obligation_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,

  obligation_id uuid NOT NULL,

  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 4000),
  due_date date,

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'met', 'missed', 'waived')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, organization_id),
  FOREIGN KEY (obligation_id, organization_id)
    REFERENCES contract_obligations (id, organization_id) ON DELETE CASCADE
);

-- migrate:split

CREATE INDEX IF NOT EXISTS obligation_milestones_obligation_idx
  ON obligation_milestones (obligation_id, status);

-- migrate:split

CREATE TABLE IF NOT EXISTS required_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,

  milestone_id uuid NOT NULL,
  work_package_id uuid,

  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 4000),
  evidence_required boolean NOT NULL DEFAULT false,

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'waived')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, organization_id),
  FOREIGN KEY (milestone_id, organization_id)
    REFERENCES obligation_milestones (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (work_package_id, organization_id)
    REFERENCES work_packages (id, organization_id) ON DELETE SET NULL
);

-- migrate:split

CREATE INDEX IF NOT EXISTS required_activities_milestone_idx
  ON required_activities (milestone_id, status);

-- migrate:split

CREATE TABLE IF NOT EXISTS activity_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,

  activity_id uuid NOT NULL,

  kind text NOT NULL
    CHECK (kind IN ('note', 'document', 'photo', 'event', 'other')),
  ref text NOT NULL DEFAULT '' CHECK (char_length(ref) <= 1000),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 1000),
  actor_id uuid,

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, organization_id),
  FOREIGN KEY (activity_id, organization_id)
    REFERENCES required_activities (id, organization_id) ON DELETE CASCADE
);

-- migrate:split

CREATE INDEX IF NOT EXISTS activity_evidence_activity_idx
  ON activity_evidence (activity_id, created_at DESC);

-- migrate:split

CREATE TABLE IF NOT EXISTS obligation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT app_require_organization_id()
    REFERENCES organizations(id) ON DELETE RESTRICT,
  obligation_id uuid NOT NULL,
  milestone_id uuid,
  activity_id uuid,
  event text NOT NULL
    CHECK (event IN
      ('created', 'status_changed', 'evidence_attached', 'note_added')),
  actor_id uuid,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(meta) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (obligation_id, organization_id)
    REFERENCES contract_obligations (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (milestone_id, organization_id)
    REFERENCES obligation_milestones (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (activity_id, organization_id)
    REFERENCES required_activities (id, organization_id) ON DELETE CASCADE
);

-- migrate:split

CREATE INDEX IF NOT EXISTS obligation_events_obligation_created_idx
  ON obligation_events (obligation_id, created_at DESC, id DESC);

-- migrate:split

CREATE TRIGGER obligation_events_append_only
  BEFORE UPDATE OR DELETE ON obligation_events
  FOR EACH ROW
  EXECUTE FUNCTION reject_mutation();

-- migrate:split

-- ── Row-level security ──────────────────────────────────────────────

ALTER TABLE contract_obligations ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE contract_obligations FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE obligation_milestones ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE obligation_milestones FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE required_activities ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE required_activities FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE activity_evidence ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE activity_evidence FORCE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE obligation_events ENABLE ROW LEVEL SECURITY;
-- migrate:split
ALTER TABLE obligation_events FORCE ROW LEVEL SECURITY;

-- migrate:split

CREATE POLICY contract_obligations_tenant_isolation ON contract_obligations
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY obligation_milestones_tenant_isolation ON obligation_milestones
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY required_activities_tenant_isolation ON required_activities
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY activity_evidence_tenant_isolation ON activity_evidence
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

CREATE POLICY obligation_events_tenant_isolation ON obligation_events
  FOR ALL TO contractor_app
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());

-- migrate:split

GRANT SELECT, INSERT, UPDATE, DELETE
  ON contract_obligations, obligation_milestones, required_activities,
     activity_evidence, obligation_events
  TO contractor_app;
