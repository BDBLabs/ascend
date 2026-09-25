# Release promotion

REMEDIATION_PLAN.md P1.2. Branch protection and protected GitHub Environments are not
available on the current GitHub plan, so GitHub itself cannot stop an unverified commit
reaching `main` or production. Until an upgrade makes enforcement available, promotion to
production is an **explicit, recorded operator approval** gated by the quality workflow.

## The gate

`.github/workflows/quality.yml` runs on every push to `main`, every pull request, and (via
`workflow_call`) every release tag. Its three jobs are the required checks:

| Job | What it proves |
|---|---|
| `workflows` | Every workflow file parses and passes actionlint (the failure mode that previously left the repo with zero executing jobs). |
| `verify` | Secret scan, lint, unit tests (all workspaces + `scripts/*.test.mjs`), production builds of both apps, production dependency audit. |
| `isolation` | A PostgreSQL 17 database built from zero by the migration runner, then every SQL suite in `packages/database/checks/` (tenant isolation, adversarial isolation, function ACL matrix, identity/outbox, documents, pricing, field, regressions), idempotent re-migration, and refusal of cross-environment runs. Needs no secret, so it cannot silently skip. |

`scripts/promotion-policy.mjs` defines promotable: all three checks ran on the **exact**
commit and concluded `success`; a failed, skipped, cancelled, missing or still-running
check, or a check for a different commit, refuses. The refusal cases are unit-tested in
`scripts/promotion-policy.test.mjs` (including "a deliberately failing branch is refused
promotion").

## Procedure

1. Merge only pull requests whose `quality` run is green. (Reviewers check the run; there is
   no enforcement yet.)
2. Identify the exact commit to promote (full 40-character SHA).
3. Run the gate:

   ```bash
   GITHUB_TOKEN=<read-only token> npm run promotion:check -- <sha>
   ```

   Exit 0 prints `OK`; anything else prints `REFUSED` with the failing checks. Do not promote
   a refused commit.
4. Apply pending migrations to production **before** deploying code that needs them:

   ```bash
   ASCEND_ENVIRONMENT=production node --env-file=.env.neon.production.local \
     packages/database/migrate.mjs --production
   ```

5. Promote that exact commit (Vercel: promote the deployment built from that SHA; Fly:
   `fly deploy` from a checkout of that SHA).
6. Record the promotion in the release issue/PR: SHA, `promotion:check` output, migration
   output, approver, time. The approver must not be the author of every change in the
   promotion.
7. Verify the deployment: `GET /api/health` is 200 with `checks.schema = true` and
   `latestMigration` equal to the newest migration file; the anonymous-denial matrix in
   `DEPLOYMENT.md` still returns 401 on every Field route.

## When enforcement becomes available

Turn on branch protection for `main` requiring `workflows`, `verify`, and `isolation`, and a
protected `production` environment with required reviewers. Keep `promotion:check` as the
promotion step's first action.
