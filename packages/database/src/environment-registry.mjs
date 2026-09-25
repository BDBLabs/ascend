import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Loads config/database-environments.json (the committed endpoint registry). */
export function loadEnvironmentRegistry() {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'config', 'database-environments.json');
  return JSON.parse(readFileSync(path, 'utf8'));
}
