/**
 * P0.1 regression: the anonymous-denial matrix, in process.
 *
 * Every Field and Ascend workspace route, every exported HTTP method, called
 * with no session cookie -- GETs plainly, mutations with a forged cross-site
 * Origin and a non-browser user agent -- under the exact configuration that
 * exposed production (FIELD_DEMO_MODE=1 + DEVELOPMENT_FIELD_ORGANIZATION_ID on
 * a production deployment). Each must be refused (401, or 403 from the
 * same-origin gate) without touching the database.
 *
 * The route list is discovered from the filesystem, so a new route is covered
 * the day it is added. The deployed counterpart is scripts/anonymous-denial.mjs.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const databaseTouched = vi.hoisted(() => ({ count: 0 }));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
  headers: async () => new Headers({ host: 'field.useascend.com' }),
}));

vi.mock('@/lib/db', () => {
  const refuse = () => {
    databaseTouched.count += 1;
    throw new Error('anonymous request reached the database');
  };
  const client = () => {
    const sql = (() => refuse()) as unknown as Record<string, unknown>;
    sql.query = refuse;
    sql.transaction = refuse;
    return sql;
  };
  return {
    db: client,
    platformDb: client,
    isDatabaseConfigured: () => true,
    closeDatabasePool: async () => {},
  };
});

const API_ROOT = new URL('.', import.meta.url).pathname;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const ID = '0b8a0f6e-8f8f-4a4a-9b9b-0c0c0c0c0c0c';

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === 'route.ts' ? [path] : [];
  });
}

const routes = ['field', 'ascend']
  .flatMap((area) => routeFiles(join(API_ROOT, area)))
  .map((file) => ({
    file,
    path: `/api/${relative(API_ROOT, file).replace(/\/route\.ts$/, '').replace(/\[[^\]]+\]/g, ID)}`,
  }))
  .sort((a, b) => a.path.localeCompare(b.path));

const saved: Record<string, string | undefined> = {};
const EXPOSURE_ENV = {
  NODE_ENV: 'production',
  VERCEL_ENV: 'production',
  FIELD_DEMO_MODE: '1',
  DEVELOPMENT_FIELD_ORGANIZATION_ID: '11111111-1111-4111-8111-111111111111',
  FIELD_AUTH_SECRET: 'x'.repeat(48),
};

beforeAll(() => {
  for (const [key, value] of Object.entries(EXPOSURE_ENV)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

describe('anonymous-denial matrix (P0.1)', () => {
  it('discovers the workspace routes', () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  for (const route of routes) {
    it(`refuses anonymous access to ${route.path}`, async () => {
      const module = (await import(route.file)) as Record<string, unknown>;
      const exported = METHODS.filter((method) => typeof module[method] === 'function');
      expect(exported.length).toBeGreaterThan(0);

      for (const method of exported) {
        databaseTouched.count = 0;
        const mutation = method !== 'GET';
        const request = new NextRequest(`https://field.useascend.com${route.path}`, {
          method,
          headers: {
            'user-agent': 'curl/8.5.0',
            ...(mutation
              ? { origin: 'https://attacker.example', 'content-type': 'application/json' }
              : {}),
          },
          body: mutation ? JSON.stringify({ name: 'x' }) : undefined,
        });
        const handler = module[method] as (
          request: NextRequest,
          context: { params: Promise<Record<string, string>> },
        ) => Promise<Response>;
        const response = await handler(request, {
          params: Promise.resolve({ id: ID }),
        });

        expect(
          mutation ? [401, 403] : [401],
          `${method} ${route.path} answered ${response.status}`,
        ).toContain(response.status);
        expect(databaseTouched.count, `${method} ${route.path} touched the database`).toBe(0);
      }
    });
  }
});
