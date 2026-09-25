import { beforeEach, describe, expect, it, vi } from 'vitest';

const { statements, released, behavior } = vi.hoisted(() => ({
  statements: [] as string[],
  released: { count: 0 },
  behavior: { failOn: undefined as string | undefined },
}));

// A class, not vi.fn(): db.ts calls `new pg.Pool(...)`, and a plain mock
// function is not constructible.
vi.mock('pg', () => {
  class Pool {
    async connect() {
      return {
        query: async (text: string) => {
          const normalized = String(text).replace(/\s+/g, ' ').trim();
          // The one-time environment-stamp probe is not part of the transaction.
          if (normalized.includes('_ascend_environment')) return { rows: [] };
          statements.push(normalized);
          if (behavior.failOn && normalized.includes(behavior.failOn)) {
            throw new Error('boom');
          }
          return { rows: [] };
        },
        release: () => { released.count += 1; },
      };
    }
  }
  return { default: { Pool } };
});

const CONTEXT = {
  organizationId: '11111111-1111-1111-1111-111111111111',
  actorId: null,
  requestId: '440b7258-2800-46ea-b6de-13857e1f10e8',
};

vi.mock('@/lib/organization-context-store', () => ({
  requireOrganizationContext: () => CONTEXT,
}));

beforeEach(() => {
  statements.length = 0;
  released.count = 0;
  behavior.failOn = undefined;
  process.env.DATABASE_URL = 'postgresql://ascend_runtime@example.test/ascend';
  vi.resetModules();
});

describe('db (tenant-scoped)', () => {
  it('opens a transaction and assumes contractor_app inside it', async () => {
    const { db } = await import('@/lib/db');

    await db().query('SELECT 1 FROM estimates');

    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toBe('SET LOCAL ROLE contractor_app');
  });

  it('establishes tenant context before the caller query, and commits', async () => {
    const { db } = await import('@/lib/db');

    await db().query('SELECT 1 FROM estimates');

    const contextIndex = statements.findIndex((s) => s.includes('set_application_context'));
    const queryIndex = statements.findIndex((s) => s.includes('FROM estimates'));
    expect(contextIndex).toBeGreaterThan(-1);
    expect(queryIndex).toBeGreaterThan(contextIndex);
    expect(statements.at(-1)).toBe('COMMIT');
  });

  it('returns only the caller rows, not the prelude results', async () => {
    const { db } = await import('@/lib/db');

    const [rows] = await db().transaction((sql) => [sql.query('SELECT 1 FROM estimates')]);

    expect(rows).toEqual([]);
  });

  // A pooled connection that is not returned is a connection leak, and on a
  // long-running process that exhausts the pool rather than merely erroring.
  it('rolls back and releases the connection when a query fails', async () => {
    behavior.failOn = 'FROM estimates';
    const { db } = await import('@/lib/db');

    await expect(db().query('SELECT 1 FROM estimates')).rejects.toThrow('boom');

    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(released.count).toBe(1);
  });

  it('releases the connection on success too', async () => {
    const { db } = await import('@/lib/db');

    await db().query('SELECT 1 FROM estimates');

    expect(released.count).toBe(1);
  });
});

describe('platformDb (cross-tenant)', () => {
  it('assumes platform_runtime inside the transaction', async () => {
    const { platformDb } = await import('@/lib/db');

    await platformDb().query('SELECT 1 FROM organizations');

    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toBe('SET LOCAL ROLE platform_runtime');
  });

  // platform_runtime holds no BYPASSRLS by design, so setting a tenant context
  // here would silently scope a cross-tenant job to one organization.
  it('sets no tenant context', async () => {
    const { platformDb } = await import('@/lib/db');

    await platformDb().query('SELECT 1 FROM organizations');

    expect(statements.some((s) => s.includes('set_application_context'))).toBe(false);
  });
});

describe('poolSettings (connection budget)', () => {
  it('uses the pooled endpoint and a small pool on serverless', async () => {
    const { poolSettings } = await import('@/lib/db');
    expect(poolSettings({ VERCEL: '1', DATABASE_URL: 'pooled', DATABASE_URL_UNPOOLED: 'direct' } as NodeJS.ProcessEnv))
      .toEqual({ connectionString: 'pooled', max: 3, idleTimeoutMillis: 5_000 });
  });

  it('uses the direct endpoint and a larger pool on a long-lived server', async () => {
    const { poolSettings } = await import('@/lib/db');
    expect(poolSettings({ DATABASE_URL: 'pooled', DATABASE_URL_UNPOOLED: 'direct' } as NodeJS.ProcessEnv))
      .toEqual({ connectionString: 'direct', max: 10, idleTimeoutMillis: 30_000 });
  });

  it('honours an explicit DATABASE_POOL_MAX and ignores junk', async () => {
    const { poolSettings } = await import('@/lib/db');
    expect(poolSettings({ VERCEL: '1', DATABASE_URL: 'p', DATABASE_POOL_MAX: '2' } as NodeJS.ProcessEnv).max).toBe(2);
    expect(poolSettings({ DATABASE_URL: 'p', DATABASE_POOL_MAX: 'lots' } as NodeJS.ProcessEnv).max).toBe(10);
  });
});
