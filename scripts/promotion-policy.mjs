/**
 * Promotion policy (P1.2). Branch protection is unavailable on the current
 * GitHub plan, so nothing in GitHub stops an unverified commit reaching main
 * or production. Until it is, promotion is an explicit operator step gated by
 * this policy: a commit may be promoted only when every required quality
 * check ran on that exact commit and succeeded.
 *
 * Pure so the refusal cases are unit-tested (promotion-policy.test.mjs).
 */

/** Job names from .github/workflows/quality.yml. */
export const REQUIRED_CHECKS = Object.freeze(['workflows', 'verify', 'isolation']);

/**
 * @param {Array<{ name: string, status: string, conclusion: string | null, head_sha?: string }>} checkRuns
 * @param {{ sha: string, required?: readonly string[] }} options
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function evaluatePromotion(checkRuns, { sha, required = REQUIRED_CHECKS }) {
  const problems = [];
  if (!/^[0-9a-f]{40}$/.test(sha)) problems.push('a full 40-character commit SHA is required');

  for (const name of required) {
    // A check may have been re-run; the newest attempt decides.
    const runs = checkRuns
      .filter((run) => run.name === name || run.name.endsWith(` / ${name}`))
      .filter((run) => !run.head_sha || run.head_sha === sha);
    const latest = runs.at(-1);
    if (!latest) {
      problems.push(`${name}: no run found for ${sha.slice(0, 12)}`);
    } else if (latest.status !== 'completed') {
      problems.push(`${name}: still ${latest.status}`);
    } else if (latest.conclusion !== 'success') {
      problems.push(`${name}: concluded ${latest.conclusion}`);
    }
  }
  return { ok: problems.length === 0, problems };
}
