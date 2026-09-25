import 'server-only';

import type { OutboxMessage, OutboxOutcome } from '@/lib/transactional-outbox';
import {
  claimOutboxMessages,
  finishOutboxMessage,
} from '@/lib/transactional-outbox';

const RESEND_API_URL = 'https://api.resend.com/emails';
const MAX_DISPATCH_BATCH = 50;
// A drain run claims batches until the queue is empty, MAX_DRAIN_BATCHES is
// reached, or the time budget is spent -- whichever comes first. The budget
// stays well inside the 5-minute claim lease and the platform function limit,
// so a run never holds a claim past its lease.
const MAX_DRAIN_BATCHES = 10;
const DEFAULT_DRAIN_BUDGET_MS = 45_000;

// The finish call is the single source of truth for a message's delivery state.
// finish_outbox_message is fenced by the claim token, so retrying it is safe:
// a repeat either records the same outcome once or reports "not owner".
const FINISH_MAX_ATTEMPTS = 3;
const FINISH_BASE_DELAY_MS = 50;

/**
 * Single source of truth for "is the email provider actually usable?". The
 * enqueue gate (estimate-delivery) and the dispatch path (sendEstimateDeliveryEmail)
 * must agree on this, or deliveries would queue that the drain could never
 * send.
 */
export function isResendConfigured(): boolean {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? '';
  return apiKey.startsWith('re_') && apiKey.length >= 12;
}

export type OutboxDispatchSummary = {
  claimed: number;
  delivered: number;
  failed: number;
};

export class OutboxDispatchError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'OutboxDispatchError';
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function documentDate(value: Date | string, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeZone,
  }).format(new Date(value));
}

export type EstimateDeliveryPayload = {
  displayId: string;
  customerEmail: string;
  from: string;
  replyTo?: string;
  companyName: string;
  timeZone: string;
  expiresAt: string;
  viewUrl: string;
  approveUrl: string;
  declineUrl: string;
};

function isEstimateDeliveryPayload(value: unknown): value is EstimateDeliveryPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const strings: Array<keyof EstimateDeliveryPayload> = [
    'displayId', 'customerEmail', 'from', 'companyName', 'timeZone',
    'expiresAt', 'viewUrl', 'approveUrl', 'declineUrl',
  ];
  for (const field of strings) {
    if (typeof v[field] !== 'string' || (v[field] as string).length === 0) return false;
  }
  if (v.replyTo !== undefined && typeof v.replyTo !== 'string') return false;
  if (typeof v.expiresAt !== 'string' || new Date(v.expiresAt).getTime() <= 0) return false;
  for (const url of [v.viewUrl, v.approveUrl, v.declineUrl]) {
    try {
      const parsed = new URL(url as string);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function buildEstimateDeliveryEmail(options: {
  companyName: string;
  displayId: string;
  expiresAt: Date | string;
  timeZone: string;
  viewUrl: string;
  approveUrl: string;
  declineUrl: string;
}) {
  const expiry = documentDate(options.expiresAt, options.timeZone);
  const subject = `${options.displayId} from ${options.companyName}`;
  const text = [
    `${options.companyName} sent you estimate ${options.displayId}.`,
    '',
    `Review or download the estimate: ${options.viewUrl}`,
    '',
    `Approve this exact estimate: ${options.approveUrl}`,
    `Decline this exact estimate: ${options.declineUrl}`,
    '',
    `These private links expire on ${expiry}. If you did not expect this estimate, contact ${options.companyName} directly.`,
  ].join('\n');
  const html = `
    <div style="background:#f3f1eb;padding:32px 16px;font-family:Arial,sans-serif;color:#17242d">
      <div style="max-width:560px;margin:0 auto;background:#fff;border-top:4px solid #dda052;padding:28px">
        <p style="margin:0 0 8px;color:#986224;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">${escapeHtml(options.companyName)} · Private document</p>
        <h1 style="margin:0 0 10px;color:#081726;font-size:25px;line-height:1.2">Your estimate is ready</h1>
        <p style="margin:0 0 24px;color:#65717a;font-size:14px;line-height:1.6">${escapeHtml(options.displayId)} is available for review through ${escapeHtml(expiry)}.</p>
        <p style="margin:0 0 24px">
          <a href="${escapeHtml(options.viewUrl)}" style="display:inline-block;background:#081726;color:#fff;padding:13px 19px;text-decoration:none;font-size:13px;font-weight:700">Review estimate</a>
        </p>
        <table role="presentation" style="width:100%;border-collapse:collapse;border-top:1px solid #e3e7ea">
          <tr>
            <td style="padding:18px 8px 0 0"><a href="${escapeHtml(options.approveUrl)}" style="color:#126141;font-size:13px;font-weight:700">Approve this estimate</a></td>
            <td style="padding:18px 0 0 8px;text-align:right"><a href="${escapeHtml(options.declineUrl)}" style="color:#8a3434;font-size:13px;font-weight:700">Decline this estimate</a></td>
          </tr>
        </table>
        <p style="margin:24px 0 0;color:#65717a;font-size:11px;line-height:1.55">Each action is bound to this exact estimate. If you did not expect this estimate, contact ${escapeHtml(options.companyName)} directly.</p>
      </div>
    </div>
  `.trim();
  return { subject, text, html };
}

async function sendEstimateDeliveryEmail(
  payload: EstimateDeliveryPayload,
  idempotencyKey: string,
  fetchImplementation: typeof fetch,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? '';
  if (!isResendConfigured()) {
    throw new OutboxDispatchError('delivery_not_configured', false);
  }

  const email = buildEstimateDeliveryEmail({
    companyName: payload.companyName,
    displayId: payload.displayId,
    expiresAt: payload.expiresAt,
    timeZone: payload.timeZone,
    viewUrl: payload.viewUrl,
    approveUrl: payload.approveUrl,
    declineUrl: payload.declineUrl,
  });

  let response: Response;
  try {
    response = await fetchImplementation(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        'User-Agent': 'contractor-platform/0.2.0',
      },
      body: JSON.stringify({
        from: payload.from,
        to: [payload.customerEmail],
        ...(payload.replyTo ? { reply_to: payload.replyTo } : {}),
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new OutboxDispatchError('provider_network', true);
  }

  if (!response.ok) {
    throw providerError(response.status);
  }

  try {
    const body = await response.json() as { id?: unknown };
    if (typeof body.id !== 'string' || body.id.length < 1 || body.id.length > 200) {
      throw new Error('Invalid provider response.');
    }
  } catch {
    throw new OutboxDispatchError('provider_invalid_response', true);
  }
}

function providerError(status: number) {
  if (status === 429) return new OutboxDispatchError('provider_rate_limit', true);
  if (status >= 500) return new OutboxDispatchError('provider_unavailable', true);
  if (status === 401 || status === 403) {
    return new OutboxDispatchError('provider_auth', false);
  }
  if (status === 409) {
    return new OutboxDispatchError('provider_idempotency_conflict', false);
  }
  return new OutboxDispatchError('provider_rejected', false);
}

/**
 * Dispatches a single claimed outbox message. The payload is self-contained so
 * the handler needs no tenant context: the producer (the estimate delivery
 * route) put the recipient, the document links, and the sender config in the
 * payload at enqueue time.
 */
export async function dispatchOutboxMessage(
  message: OutboxMessage,
  fetchImplementation: typeof fetch = fetch,
): Promise<void> {
  if (message.topic !== 'estimate_delivery') {
    throw new OutboxDispatchError('unknown_topic', false);
  }
  if (!isEstimateDeliveryPayload(message.payload)) {
    throw new OutboxDispatchError('invalid_payload', false);
  }
  // The outbox key is the delivery ID; the row id is the fallback so every send
  // carries a stable provider idempotency key across re-claims.
  await sendEstimateDeliveryEmail(message.payload, message.key || message.id, fetchImplementation);
}

/**
 * Records the dispatch outcome, retrying the finish UPDATE to completion. If a
 * transient DB failure is swallowed here, the row stays 'claimed'; when the
 * 5-minute lease expires it is re-claimed and re-sent under the same
 * Idempotency-Key (the outbox key, i.e. the delivery ID), so the provider
 * de-duplicates it. Retrying closes that window in the common case.
 *
 * Returns whether this claim recorded the outcome (false: the lease was
 * reclaimed by another worker, which now owns the row).
 *
 * Exported for tests; not part of the public dispatch API.
 */
export async function finishWithRetry(
  message: Pick<OutboxMessage, 'id' | 'claimToken'>,
  outcome: OutboxOutcome,
  finish: (
    message: Pick<OutboxMessage, 'id' | 'claimToken'>,
    outcome: OutboxOutcome,
  ) => Promise<boolean>,
): Promise<boolean> {
  let attempt = 0;
  for (;;) {
    try {
      return await finish(message, outcome);
    } catch (caught) {
      attempt += 1;
      if (attempt >= FINISH_MAX_ATTEMPTS) throw caught;
      await new Promise((resolve) =>
        setTimeout(resolve, FINISH_BASE_DELAY_MS * 2 ** (attempt - 1)),
      );
    }
  }
}

export type OutboxDrainSummary = OutboxDispatchSummary & {
  batches: number;
  /** Outcomes not recorded because the claim was lost (lease reclaimed) or finish kept failing. */
  unrecorded: number;
  /** true when the run stopped on its batch/time budget with work possibly remaining. */
  budgetExhausted: boolean;
};

/**
 * Drains the outbox in bounded batches, then records each outcome through the
 * fenced finish window. Runs on the platform client end to end: claiming and
 * finishing are the cross-tenant windows and the delivery needs no tenant.
 *
 * Safe under duplicate or overlapping cron invocations (Vercel may deliver a
 * cron more than once and does not retry a failed one): claims use SKIP LOCKED
 * so two runs never hold the same row, finish is fenced by the claim token, and
 * the provider Idempotency-Key is the stable outbox key, so a re-send after a
 * lost finish is de-duplicated by the provider. The claim itself is
 * tenant-fair (migration 032).
 *
 * Retryable vs terminal: an OutboxDispatchError carries `retryable`; anything
 * else is treated as retryable. Terminal failures dead-letter immediately.
 */
export async function dispatchOutboxMessages(options: {
  limit?: number;
  maxBatches?: number;
  budgetMs?: number;
  fetchImplementation?: typeof fetch;
  now?: () => number;
} = {}): Promise<OutboxDrainSummary> {
  const limit = Math.min(
    MAX_DISPATCH_BATCH,
    Math.max(1, Math.trunc(options.limit ?? 20)),
  );
  const maxBatches = Math.min(
    MAX_DRAIN_BATCHES,
    Math.max(1, Math.trunc(options.maxBatches ?? MAX_DRAIN_BATCHES)),
  );
  const budgetMs = Math.max(1, options.budgetMs ?? DEFAULT_DRAIN_BUDGET_MS);
  const now = options.now ?? Date.now;
  const startedAt = now();
  const fetchImplementation = options.fetchImplementation ?? fetch;

  const summary: OutboxDrainSummary = {
    claimed: 0,
    delivered: 0,
    failed: 0,
    batches: 0,
    unrecorded: 0,
    budgetExhausted: false,
  };

  while (summary.batches < maxBatches) {
    if (now() - startedAt >= budgetMs) {
      summary.budgetExhausted = true;
      break;
    }
    const messages = await claimOutboxMessages(limit);
    summary.batches += 1;
    summary.claimed += messages.length;
    if (!messages.length) return summary;

    for (const message of messages) {
      let outcome: OutboxOutcome;
      try {
        await dispatchOutboxMessage(message, fetchImplementation);
        outcome = { succeeded: true };
      } catch (error) {
        outcome = error instanceof OutboxDispatchError
          ? { succeeded: false, retryable: error.retryable, error: error.code }
          : { succeeded: false, retryable: true, error: 'dispatch_error' };
      }

      if (outcome.succeeded) summary.delivered += 1;
      else summary.failed += 1;

      try {
        const recorded = await finishWithRetry(message, outcome, finishOutboxMessage);
        if (!recorded) summary.unrecorded += 1;
      } catch {
        // Even after retrying, the finish could not be recorded. The row stays
        // 'claimed' and is re-claimed after lease expiry (at-least-once); the
        // provider Idempotency-Key prevents a duplicate customer email.
        summary.unrecorded += 1;
      }
    }

    if (messages.length < limit) return summary;
  }

  if (summary.batches >= maxBatches) summary.budgetExhausted = true;
  return summary;
}
