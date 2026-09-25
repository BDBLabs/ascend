/**
 * Promotion gate (P1.2): refuses to approve a commit for production unless the
 * required quality checks ran on that exact commit and succeeded.
 *
 *   GITHUB_TOKEN=<read-only token> npm run promotion:check -- <full-sha> [owner/repo]
 *
 * Exit 0: promotable. Exit 1: refused, with the reasons. See
 * docs/RELEASE_PROMOTION.md for the procedure this is one step of.
 */
import { evaluatePromotion } from './promotion-policy.mjs';

const [sha, repository = process.env.GITHUB_REPOSITORY ?? 'BDBLabs/ascend'] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;
if (!sha) {
  process.stderr.write('usage: promotion-check.mjs <full-commit-sha> [owner/repo]\n');
  process.exit(2);
}
if (!token) {
  process.stderr.write('GITHUB_TOKEN is required (a read-only token is enough).\n');
  process.exit(2);
}

const checkRuns = [];
for (let page = 1; page <= 10; page += 1) {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/commits/${sha}/check-runs?per_page=100&page=${page}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!response.ok) {
    process.stderr.write(`GitHub API returned ${response.status}; cannot establish check status.\n`);
    process.exit(1);
  }
  const body = await response.json();
  checkRuns.push(...body.check_runs);
  if (body.check_runs.length < 100) break;
}

// The API lists newest first; the policy reads the last entry as newest.
checkRuns.sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));

const result = evaluatePromotion(checkRuns, { sha });
if (!result.ok) {
  process.stderr.write(`REFUSED: ${sha} is not promotable:\n  - ${result.problems.join('\n  - ')}\n`);
  process.exit(1);
}
process.stdout.write(`OK: ${sha} passed every required check and may be promoted.\n`);
