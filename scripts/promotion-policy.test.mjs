import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePromotion } from './promotion-policy.mjs';

const SHA = 'a'.repeat(40);
const run = (name, conclusion, status = 'completed') => ({ name, status, conclusion, head_sha: SHA });
const green = [run('workflows', 'success'), run('verify', 'success'), run('isolation', 'success')];

test('a commit whose every required check passed may be promoted', () => {
  assert.deepEqual(evaluatePromotion(green, { sha: SHA }), { ok: true, problems: [] });
});

test('a deliberately failing branch is refused promotion', () => {
  const result = evaluatePromotion(
    [run('workflows', 'success'), run('verify', 'failure'), run('isolation', 'success')],
    { sha: SHA },
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.problems, ['verify: concluded failure']);
});

test('a skipped or missing isolation run is refused, not treated as green', () => {
  assert.equal(evaluatePromotion([run('workflows', 'success'), run('verify', 'success'), run('isolation', 'skipped')], { sha: SHA }).ok, false);
  assert.equal(evaluatePromotion([run('workflows', 'success'), run('verify', 'success')], { sha: SHA }).ok, false);
});

test('an in-progress run is refused', () => {
  const result = evaluatePromotion([...green.slice(0, 2), run('isolation', null, 'in_progress')], { sha: SHA });
  assert.deepEqual(result.problems, ['isolation: still in_progress']);
});

test('runs for a different commit do not count', () => {
  const other = green.map((entry) => ({ ...entry, head_sha: 'b'.repeat(40) }));
  assert.equal(evaluatePromotion(other, { sha: SHA }).ok, false);
});

test('the newest attempt of a re-run check decides', () => {
  assert.equal(evaluatePromotion([...green, run('verify', 'failure')], { sha: SHA }).ok, false);
  assert.equal(evaluatePromotion([run('verify', 'failure'), ...green], { sha: SHA }).ok, true);
});

test('reusable-workflow job names (quality / verify) are recognised', () => {
  const nested = green.map((entry) => ({ ...entry, name: `quality / ${entry.name}` }));
  assert.equal(evaluatePromotion(nested, { sha: SHA }).ok, true);
});

test('an abbreviated SHA is refused', () => {
  assert.equal(evaluatePromotion(green, { sha: 'aaaaaaa' }).ok, false);
});
