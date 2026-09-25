# Security Policy — Ascend

## Supported versions

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | :white_check_mark: |
| older   | :x: (upgrade)      |

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Contact the
BagelTech maintainers privately with the affected surface, reproduction
steps, and impact assessment. Expect an acknowledgment within 5 business
days. Preserve Vercel/database evidence for exposure windows and follow
the incident process in `docs/assurance/REMEDIATION_PLAN.md`.

## Production notes (enforced + documented)

- **Tenant isolation is a database property**: forced RLS, restricted
  runtime logins (`contractor_app`, `platform_runtime`, `control_app`),
  per-transaction role assumption. An app path can forget tenant context;
  it cannot forget a database policy. Verify with `npm run db:verify`.
- **Demo mode is fail-closed in production**: `FIELD_DEMO_MODE=1` alone
  never yields a principal on a production process; both it and
  `FIELD_DEMO_ALLOW_IN_PRODUCTION=1` are required, and the latter belongs
  only on sandboxes without real tenant data.
- **Money is integer cents, server-authoritative**; unpublished pricing
  cannot enter a commercial document; configuration is versioned/immutable.
- **Regulatory claims are approval-flagged**: license/insurance statements
  render only after affirmative tenant approval.
- **Secrets**: `secrets:check` runs first in `verify:ci` and fails the build
  on committed secrets. Owner DB credentials never ship to running apps.
- **Outbound email fails closed** until delivery/outbox remediation (P0.2)
  is complete — do not add `RESEND_API_KEY` early.
