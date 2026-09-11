-- 029_ascend_estimate_link.sql
--
-- Commercial loop, part 1: a modernization project records the signed
-- estimate it was awarded from. One project per estimate (partial unique
-- index, mirroring the one-job-per-estimate rule in 011); most projects
-- start linked, unlinked rows remain valid for direct-created projects.
-- Unlinking is SET NULL-safe: deleting an estimate never deletes project
-- history (estimates are terminal-state guarded upstream).

ALTER TABLE modernization_projects
  ADD COLUMN IF NOT EXISTS estimate_id uuid;

-- migrate:split

ALTER TABLE modernization_projects
  ADD CONSTRAINT modernization_projects_estimate_fk
  FOREIGN KEY (estimate_id, organization_id)
    REFERENCES estimates (id, organization_id) ON DELETE SET NULL;

-- migrate:split

CREATE UNIQUE INDEX IF NOT EXISTS modernization_projects_estimate_id_uniq
  ON modernization_projects (organization_id, estimate_id)
  WHERE estimate_id IS NOT NULL;
