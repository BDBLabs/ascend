import { beforeEach, describe, expect, it, vi } from 'vitest';

const { statements, released, behavior } = vi.hoisted(() => ({
  statements: [] as string[],
  released: { count: 0 },
  behavior: {
    failOn: undefined as string | undefined,
    stamp: null as string | null,
  },
}));

vi.mock('pg', () => {
  class Pool {
    async connect() {
      return {
        query: async (text: string) => {
          const normalized = String(text).replace(/\s+/g, ' ').trim();
          // The one-time environment-stamp probe (P1.3) is not part of the
          // transaction under test; answer it from `behavior.stamp`.
          if (normalized.includes('_jbox_environment')) {
            if (normalized.includes('to_regclass')) return { rows: [{ present: behavior.stamp !== null }] };
            return { rows: [{ environment: behavior.stamp }] };
          }
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

vi.mock('@/lib/control-env', () => ({
  controlDatabaseUrl: () => 'postgres://control:test@localhost/control',
}));

import { controlQuery, provision } from '@/lib/control-db';

beforeEach(() => {
  statements.length = 0;
  released.count = 0;
  behavior.failOn = undefined;
  behavior.stamp = null;
});

describe('control-db', () => {
  it('runs a control query in one transaction under control_app', async () => {
    await controlQuery('SELECT 1');
    expect(statements).toEqual([
      'BEGIN',
      'SET LOCAL ROLE control_app',
      'SELECT 1',
      'COMMIT',
    ]);
    expect(released.count).toBe(1);
  });

  it('switches roles only on change within a provisioning transaction', async () => {
    await provision([
      { role: 'control_app', text: 'INSERT INTO organizations ...' },
      { role: 'control_app', text: 'SELECT set_application_context(...)' },
      { role: 'contractor_app', text: 'INSERT INTO configuration_versions ...' },
      { role: 'contractor_app', text: 'INSERT INTO price_book_releases ...' },
    ]);
    expect(statements).toEqual([
      'BEGIN',
      'SET LOCAL ROLE control_app',
      'INSERT INTO organizations ...',
      'SELECT set_application_context(...)',
      'SET LOCAL ROLE contractor_app',
      'INSERT INTO configuration_versions ...',
      'INSERT INTO price_book_releases ...',
      'COMMIT',
    ]);
  });

  it('rolls back and releases the connection when a statement fails', async () => {
    behavior.failOn = 'price_book_releases';
    await expect(provision([
      { role: 'control_app', text: 'INSERT INTO organizations ...' },
      { role: 'contractor_app', text: 'INSERT INTO price_book_releases ...' },
    ])).rejects.toThrow('boom');
    expect(statements).toEqual([
      'BEGIN',
      'SET LOCAL ROLE control_app',
      'INSERT INTO organizations ...',
      'SET LOCAL ROLE contractor_app',
      'INSERT INTO price_book_releases ...',
      'ROLLBACK',
    ]);
    expect(released.count).toBe(1);
  });

  it('refuses a database stamped for another environment before any statement (P1.3)', async () => {
    vi.resetModules();
    behavior.stamp = 'production';
    const fresh = await import('@/lib/control-db');
    await expect(fresh.controlQuery('SELECT 1')).rejects.toThrow(/stamped production/);
    // Nothing ran: no transaction was opened (the catch-all ROLLBACK is a no-op).
    expect(statements.filter((statement) => statement !== 'ROLLBACK')).toEqual([]);
    expect(released.count).toBe(1);
  });
});
