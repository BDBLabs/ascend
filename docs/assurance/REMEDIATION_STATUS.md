# Remediation status

Tracks `REMEDIATION_PLAN.md` against the code in this repository. "Done in
code" means implemented with a regression test that runs in the remote
`quality` workflow. **Operator** items cannot be done from the repository:
they need access to Vercel/Fly/Neon/GitHub settings, a deployed environment,
or a human decision, and each lists the exact step.

The release gate is unchanged: no GA until P0 and P1 are complete **and
independently re-verified on the deployed environment**, and the legal gate is
signed off by counsel.

## Defects found during remediation (not in the original report)

Found by building the database from zero and running the suites and real-DB
tests the remote gate had never executed:

| Defect | Severity | Fix | Regression |
|---|---|---|---|
| Issued invoices editable; issue/pay/cancel always failed CHECKs (017 trigger) | High | 032 | `field.sql`, `regressions.sql` |
| `ai_conversations`/`ai_messages` RLS not forced | High | 032 | `isolation.sql` |
| Dispatch tickets unattributed, `platform_runtime USING(true)`, 6-digit enumerable tracker leaking name/phone, anonymous photo attach by UUID | High | 033 + routes | `regressions.sql`, route tests |
| `/api/platform/jbox-setup`: anonymous creation of ACTIVE orgs, rewrite of existing orgs by slug | Critical | 035 (function dropped), route removed | `function-acl.sql` |
| MFA secret overwritable from another org's session; enroll/disable always failed | Critical/High | 035 | `auth-lifecycle.sql`, `auth.integration.test.ts` |
| Custom-domain "verification" set `verified=true` with no DNS check (tenant hostname hijack) | High | 036 + DNS TXT with stored token | `regressions.sql`, `dns-verification.test.ts` |
| Customer estimate page and decision route: `AS grant` (reserved word) — failed on every request | High | alias fix | `estimate-evidence.integration.test.ts` |
| Signing failed for any customer without a phone (empty-string snapshot vs CHECK) | High | NULL snapshots | `estimate-evidence.integration.test.ts` |
| Migration runner could not bootstrap a fresh database | Medium | `migrate.mjs` | CI `isolation` job |
| Remote isolation job always skipped (step `if` read an env var the step itself defined) | High | `quality.yml` | CI run on PR |

## P0 — containment

| Item | Status | Evidence / next step |
|---|---|---|
| P0.1 code invariant | **Done in code**: a production deployment never serves the demo principal and refuses to start with any demo variable set | `field-api-auth.test.ts`, `anonymous-denial.test.ts` (60 routes, forged Origin, exposure config) |
| P0.1 remove variables, redeploy exact commit | **Operator** | Unset `FIELD_DEMO_MODE`, `DEVELOPMENT_FIELD_ORGANIZATION_ID` (and `FIELD_DEMO_ALLOW_IN_PRODUCTION`) in Product Production; deploy the promoted SHA |
| P0.1 anonymous GET + mutation matrix | **Tool ready; operator runs** | `node scripts/anonymous-denial.mjs https://<field host>` then `--mutations`; attach output (74/74 denied against a local production build) |
| P0.1 incident decision | **Operator** | `docs/RUNBOOKS.md` §6 "P0.1 exposure record" |
| P0.2 keep `RESEND_API_KEY` unset | **Operator (hold)**; `db:preflight` FAILs production if it is set | Lift only after sender/domain policy approval and one approved real delivery |

## P1 — trust boundaries

| Item | Status | Evidence / next step |
|---|---|---|
| P1.1 function ACLs | **Done in code** (034): PUBLIC revoked, explicit grants, secure default privileges | `function-acl.sql` positive/negative matrix per role + login roles + default privileges |
| P1.1 production | **Operator** | migrate production (`--production`), then `db:preflight` ("no function executable by PUBLIC") |
| P1.2 CI | **Done**: actionlint, secret-free Postgres 17 isolation job, release reuses the gate; a passing run with 3 executing jobs is on the PR | `quality.yml`; PR checks |
| P1.2 promotion approval | **Done (process)**: `docs/RELEASE_PROMOTION.md`, `promotion:check` | `promotion-policy.test.mjs` ("a deliberately failing branch is refused promotion") |
| P1.3 environment identity | **Done in code**: `ASCEND_ENVIRONMENT`, endpoint registry (pre-connect), DB stamp (post-connect) in every tool and both apps | `runtime-contract.test.mjs`, `control-db.test.ts`, CI cross-environment step |
| P1.3 repoint control `.env.local`, register endpoints, rotate | **Operator** | fill `config/database-environments.json` `endpointIds`; regenerate control env for development; rotate the misplaced production control credential (`RUNBOOKS.md` §3) |

## P2 — native auth

| Item | Status | Evidence |
|---|---|---|
| Per-membership identity; tenant ops cannot rewrite global identity | **Done** (035) | `auth-lifecycle.sql` §1 |
| Atomic, version-bound session lifecycle; no revivable tokens; role change forces re-login | **Done** (035) | `auth-lifecycle.sql` §2-4, 8; `auth.integration.test.ts` incl. concurrent role change |
| MFA implemented (not decorative), replay-safe, non-overwritable | **Done** | `auth-lifecycle.sql` §6; integration test; end-to-end run |
| Reset/recovery, password policy, rehash, max input, deployment-wide lockout | **Done** | `auth-lifecycle.sql` §5, 7; `auth-adversarial.test.ts` |
| Staff-provision secret replaced by audited operator actions | **Done**: `/api/auth/register` + `FIELD_PROVISION_SECRET` removed; control staff/identity/audit endpoints | `auth-lifecycle.sql` §9 |
| Deployed evidence | **Operator** | run the lifecycle on preview after migrating it |

## P3 — documents and delivery

| Item | Status | Evidence |
|---|---|---|
| P3.1 immutable signed evidence, verified on read, rendered from evidence | **Done** (037) | `signed-evidence.sql`; `estimate-evidence.integration.test.ts` (config change after signing; tamper → integrity failure) |
| P3.2 atomic delivery, version-bound links, atomic decisions | **Done** (037) | `signed-evidence.sql`; integration test (superseded link; 3-way race: one winner, consumed grant, one event, one evidence row) |
| P3.3 recoverable outbox (fencing, reclaim, terminal vs retryable, fairness, SLO signals, duplicate cron) | **Done** (032) | `identity.sql`, `isolation-adversarial.sql` §7, `outbox-dispatch.test.ts` |
| P3.3 cadence + alerts | **Operator** | schedule the drain ≤ 5 min (see DEPLOYMENT.md §7) and alert on `/api/health` outbox fields |
| Real provider delivery | **Operator** (blocked by P0.2 hold) | one approved delivery to an approved recipient |

## P4 — deployment and storage

| Item | Status | Evidence / next step |
|---|---|---|
| P4.1 private object storage, magic-byte validation, orphan cleanup | **Done in code** | `storage.test.ts`, `image-upload.test.ts` |
| P4.1 bucket + deployed upload/read/delete | **Operator** | create a private bucket, set `STORAGE_S3_*`, run a storefront request with a photo |
| P4.2 provisioning role fix + repair path | **Done** | `provision-neon-branch.mjs` (`recover-existing` repairs development/preview) |
| P4.2 pre-promotion gate; liveness/readiness | **Done** | `packages/database/preflight.mjs` (in CI), `?probe=live` |
| P4.2 migrate Preview to current | **Operator** | `ASCEND_ENVIRONMENT=preview … migrate.mjs` then `db:preflight` |
| P4.3 Node pin, explicit TLS, pool budget per topology | **Done in code** | `.nvmrc`/engines/CI, `runtime-contract.test.mjs`, `db.test.ts` |
| P4.3 load proof; remove duplicate Vercel project | **Operator** | DEPLOYMENT.md §7 load proof; delete the failed `control` Vercel project |

## P5 — operations

| Item | Status | Evidence / next step |
|---|---|---|
| Quota-controlled onboarding | **Done**: service credential limited to provision + slug check; daily quota; tenants start in `provisioning` until an operator verifies and activates | control route + `control-auth.test.ts` |
| Per-operator identity + durable audit | **Done**: hashed operator tokens; every mutation audited in-transaction | `auth-lifecycle.sql` §9; `signed-evidence.sql` §5 |
| Structured redacted logs | **Done in code** | `logger.test.ts`; `console.*` scrubbed at startup |
| Metrics/traces/aggregation, retention | **Operator** | ship JSON logs to the chosen aggregator; alert on health fields |
| Per-tenant health | **Done** | `GET <control>/api/organizations/<id>/health` |
| Runbooks | **Written**; **operator** to exercise once each | `docs/RUNBOOKS.md` |

## Legal gate (not an engineering item)

NY GBL Art. 36-A (home-improvement deposit escrow), GBL §396-t (cooling-off /
cancellation notice), Suffolk County HIC license number display, and NYS
ST-124 (capital-improvement certificate) must be reviewed and signed off by
counsel. Nothing in this repository constitutes that review; the consent text
and document templates must be updated to counsel's wording before GA, and any
wording change requires a new `CONSENT_TEXT_VERSION`.
