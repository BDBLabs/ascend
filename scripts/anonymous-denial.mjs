/**
 * P0.1 exit evidence against a DEPLOYED environment: the anonymous GET and
 * mutation matrix over every Field and Ascend workspace route.
 *
 *   node scripts/anonymous-denial.mjs https://field.usejbox.com            # GETs only
 *   node scripts/anonymous-denial.mjs https://field.usejbox.com --mutations # + forged-Origin mutations
 *
 * Routes are discovered from apps/product/src/app/api/{field,ascend}, so the
 * matrix always matches the code being deployed. Requests carry no cookie and
 * a non-browser user agent; mutations carry a forged cross-site Origin. The
 * pass condition is 401 for every GET and 401/403 for every mutation.
 *
 * --mutations sends real POST/PUT/PATCH/DELETE requests. Only run it once the
 * GET matrix is fully green: if a route were still exposed, a mutation would
 * be accepted. Bodies are a harmless placeholder, and dynamic ids are a random
 * UUID that matches no row.
 *
 * Output: a Markdown table suitable for pasting into the incident record,
 * followed by PASS/FAIL. Exit 1 on any non-denial.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';

const [baseArg, ...flags] = process.argv.slice(2);
if (!baseArg) {
  process.stderr.write('usage: anonymous-denial.mjs <base-url> [--mutations]\n');
  process.exit(2);
}
const base = new URL(baseArg);
const includeMutations = flags.includes('--mutations');
const API_ROOT = join(process.cwd(), 'apps/product/src/app/api');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const ID = randomUUID();

function routeFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === 'route.ts' ? [path] : [];
  });
}

const rows = [];
let failures = 0;

for (const file of ['field', 'ascend'].flatMap((area) => routeFiles(join(API_ROOT, area))).sort()) {
  const path = `/api/${relative(API_ROOT, file).replace(/\/route\.ts$/, '').replace(/\[[^\]]+\]/g, ID)}`;
  const source = readFileSync(file, 'utf8');
  const methods = METHODS.filter((method) =>
    new RegExp(`export (async )?function ${method}\\b|export const ${method}\\b`).test(source));

  for (const method of methods) {
    const mutation = method !== 'GET';
    if (mutation && !includeMutations) continue;
    let status;
    try {
      const response = await fetch(new URL(path, base), {
        method,
        redirect: 'manual',
        headers: {
          'user-agent': 'jbox-anonymous-denial/1.0',
          ...(mutation ? { origin: 'https://attacker.example', 'content-type': 'application/json' } : {}),
        },
        body: mutation ? '{"probe":true}' : undefined,
        signal: AbortSignal.timeout(15_000),
      });
      status = response.status;
    } catch (error) {
      status = `error: ${error instanceof Error ? error.message : String(error)}`;
    }
    const denied = mutation ? status === 401 || status === 403 : status === 401;
    if (!denied) failures += 1;
    rows.push(`| ${method} | \`${path.replace(ID, '{id}')}\` | ${status} | ${denied ? 'denied' : '**NOT DENIED**'} |`);
  }
}

process.stdout.write(`Anonymous-denial matrix for ${base.origin} at ${new Date().toISOString()}\n\n`);
process.stdout.write('| Method | Route | Status | Result |\n|---|---|---|---|\n');
process.stdout.write(`${rows.join('\n')}\n\n`);
process.stdout.write(`${failures ? 'FAIL' : 'PASS'}: ${rows.length - failures}/${rows.length} denied`
  + `${includeMutations ? '' : ' (GETs only; re-run with --mutations once green)'}\n`);
process.exit(failures ? 1 : 0);
