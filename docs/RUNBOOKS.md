# Operations runbooks

REMEDIATION_PLAN.md P5. Each runbook names the exact command or endpoint.
Control-plane calls use a named operator token (`CONTROL_OPERATORS_JSON`);
every mutation is recorded in `identity_audit_events` with the operator id
(`GET <control>/api/audit`). Nothing here requires the owner credential except
where stated.

> **Status:** these procedures are written against the code in this repository.
> Each must be exercised once on a disposable branch and the result recorded in
> the release before GA (the "tested" part of P5 cannot happen in CI).

## 1. Backup and point-in-time restore

Neon keeps a history window per project (check the plan's retention). A restore
never overwrites production in place:

1. Create a branch from `production` at the target timestamp (Neon console →
   Branches → Create → *Point in time*), named `restore-<date>`.
2. Stamp it: `ASCEND_ENVIRONMENT=development npm run db:stamp -- --from=production`
   (register its endpoint under `development` in `config/database-environments.json`
   first). Until re-stamped every tool and app refuses it — by design.
3. Verify it: `ASCEND_ENVIRONMENT=development npm run db:preflight` and
   `npm run db:verify`.
4. Only then decide: promote the branch (full restore, maintenance window,
   rotate every runtime credential afterwards) or extract data (below).

## 2. Single-tenant restore

A tenant's rows are exactly the rows with its `organization_id` (FORCE RLS on
every such table; `isolation.sql` enforces NOT NULL).

1. Restore branch per §1.
2. As the **owner** on the restore branch, export the tenant with
   `COPY (SELECT * FROM <table> WHERE organization_id = '<org>') TO STDOUT`
   for each table listed by
   `SELECT c.relname FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id' WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'`.
3. In production, inside one transaction as the owner: delete the tenant's
   current rows in reverse FK order, `COPY ... FROM STDIN` the export in FK
   order, then run `isolation.sql`-style counts for that organization only.
   Append-only tables (`estimate_events`, `estimate_signed_evidence`,
   `identity_audit_events`, `estimate_deliveries`) reject deletes: restore only
   rows that are missing, never replace existing evidence.
4. Revoke the tenant's customer links (§4) — restored grants must not revive.
5. Record the operation with `control_audit` (action `tenant.restore`).

## 3. Secret rotation

| Secret | Rotation | Effect |
|---|---|---|
| `FIELD_AUTH_SECRET` | set new secret + bump `FIELD_AUTH_KEY_VERSION`; move the old one into `FIELD_AUTH_PREVIOUS_KEYS_JSON` for one token lifetime, then remove | sessions keep working during the window |
| Force sign-out of everyone | rotate `FIELD_AUTH_SECRET` **without** a previous-keys entry | every token fails verification |
| `CUSTOMER_LINK_SECRET` | new secret + `CUSTOMER_LINK_KEY_VERSION`; old one in `CUSTOMER_LINK_PREVIOUS_KEYS_JSON` until outstanding links expire (14 days) | links keep working; drop the old key to kill them |
| `CONTROL_API_TOKEN` | set new value on both apps, redeploy product then control | onboarding briefly 401 |
| Operator token | replace that operator's `tokenSha256` in `CONTROL_OPERATORS_JSON` | only that operator affected |
| `CRON_SECRET` | update the app env and the cron configuration together | one missed drain at most |
| Database runtime/control password | Neon → role → reset; `scripts/provision-neon-branch.mjs <project> <branch> <env> recover-existing`; update app env; redeploy | brief reconnects |
| `STORAGE_S3_*` keys | issue a new key pair scoped to the bucket, deploy, revoke the old | none |

After any rotation: `npm run db:preflight -- --app-env=<pulled env>` and the
anonymous-denial matrix.

## 4. Customer-link revocation

- One document: `POST <control>/api/organizations/<org>/links`
  `{"documentId":"<estimate id>","reason":"..."}`.
- Every link of a tenant (suspected leak): same call without `documentId`.
- Every link of every tenant: rotate `CUSTOMER_LINK_SECRET` without a
  previous-keys entry (§3).

Revocation is immediate (`customer_access_grants.status = 'revoked'`); a
re-send issues fresh links bound to the current draft.

## 5. Staff access incidents

- Remove one person from one tenant: `POST <control>/api/organizations/<org>/staff`
  `{"action":"revoke","userId":"..."}` — their sessions there end immediately.
- Suspend a login everywhere: `POST <control>/api/identities/<userId>`
  `{"status":"suspended","reason":"..."}` — every session ends; reactivation
  revives none.
- Reset a password: `{"action":"reset-password","userId":"..."}` (add
  `"platformAuthorized": true` for a login in several organizations); deliver
  the returned link out of band; it is single-use and expires in one hour.

## 6. Incident communications

1. **Declare** (anyone): open an incident record with time, reporter, symptom.
2. **Contain** (operator): the relevant action above; for a data exposure,
   preserve Vercel/Fly logs and a Neon branch at the exposure start **before**
   changing anything else.
3. **Assess**: which tenants, which records, which window. `identity_audit_events`,
   request logs (JSON, tenant-attributed), and `control_tenant_health` give the
   scope.
4. **Notify**: affected tenants within 72 hours of confirmation, with what
   happened, what data, what was done, what they should do. Follow any
   statutory notice duty (e.g. NY SHIELD Act, GBL §899-aa) — legal owns the
   determination.
5. **Close**: root cause, regression test, deployed evidence, and the
   REMEDIATION_STATUS.md entry.

### P0.1 exposure record (open)

The production demo-principal exposure recorded in
`docs/assurance/CURRENT_STATE.md` is an incident under §6. Containment in code
is done (production refuses to start with the variables set); the remaining
steps are operator actions: remove the variables, redeploy the exact commit,
run `scripts/anonymous-denial.mjs` (GETs, then `--mutations`) and attach the
output, then assess and decide notification from the preserved logs.
