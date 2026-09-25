import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LATEST_MIGRATION } from './index.ts';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

describe('LATEST_MIGRATION', () => {
  it('names the newest migration file, so health checks gate on the real schema', () => {
    const newest = readdirSync(MIGRATIONS_DIR)
      .filter((name) => /^\d+_.+\.sql$/.test(name))
      .sort()
      .at(-1);
    expect(LATEST_MIGRATION).toBe(newest);
  });
});
