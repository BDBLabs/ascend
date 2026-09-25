import 'server-only';

import { currentOrganizationContext } from '@/lib/organization-context-store';

/**
 * Structured logger for server-side use.
 *
 * Every log entry carries a consistent set of fields so that production
 * log aggregators (Datadog, Loki, CloudWatch Logs Insights) can filter and
 * correlate entries by request, tenant, and actor without manual string
 * parsing.
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info('Outbox dispatch started', { claimed: 20 });
 *   logger.error('Checkout session failed', { error: err.message, stripeCustomerId });
 *
 * Outputs newline-delimited JSON in production; pretty-prints in development.
 * Structured fields are always present; callers may add arbitrary extra fields.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogFields = Record<string, unknown>;

type LogEntry = {
  ts: string;
  level: LogLevel;
  msg: string;
  requestId?: string;
  organizationId?: string;
  [key: string]: unknown;
};

const isDevelopment = process.env.NODE_ENV === 'development';

// P5: logs never carry credentials or bearer links. Keys that name a secret are
// replaced wholesale; string values are scrubbed of bearer tokens, token path
// segments / query parameters, and credentials embedded in connection URLs.
const SECRET_KEY = /pass(word)?|secret|token|authorization|cookie|totp|api[_-]?key|signature|credential|hash/i;
const SCRUBBERS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]'],
  [/(\/(?:estimates|invoices|documents)\/)[A-Za-z0-9_-]{20,}/g, '$1[redacted]'],
  [/([?&](?:token|t|code)=)[^&\s"']+/gi, '$1[redacted]'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^:/\s]+:)[^@\s]+@/gi, '$1[redacted]@'],
  [/\b(?:re|sk|rk|whsec)_[A-Za-z0-9_]{8,}\b/g, '[redacted-key]'],
];

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (typeof value === 'string') {
    return SCRUBBERS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
  }
  if (value instanceof Error) {
    return { name: value.name, message: redactValue(value.message, depth + 1) };
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) ? '[redacted]' : redactValue(item, depth + 1),
    ]));
  }
  return value;
}

function write(level: LogLevel, msg: string, extra: LogFields = {}): void {
  const ctx = currentOrganizationContext();

  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    msg: redactValue(msg) as string,
    ...(ctx?.requestId ? { requestId: ctx.requestId } : {}),
    ...(ctx?.organizationId ? { organizationId: ctx.organizationId } : {}),
    ...(redactValue(extra) as LogFields),
  };

  const line = isDevelopment
    ? JSON.stringify(entry, null, 2)
    : JSON.stringify(entry);

  // Route by severity. Node.js process.stderr is unbuffered; using it for
  // warn/error keeps application logs out of stdout pipelines that treat
  // stdout as structured data.
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export const logger = {
  debug: (msg: string, extra?: LogFields) => write('debug', msg, extra),
  info: (msg: string, extra?: LogFields) => write('info', msg, extra),
  warn: (msg: string, extra?: LogFields) => write('warn', msg, extra),
  error: (msg: string, extra?: LogFields) => write('error', msg, extra),
};
