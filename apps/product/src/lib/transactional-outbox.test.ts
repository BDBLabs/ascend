import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  platformQuery: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: () => ({ query: mocks.dbQuery }),
  platformDb: () => ({ query: mocks.platformQuery }),
}));

import {
  claimOutboxMessages,
  enqueueOutboxMessage,
  finishOutboxMessage,
} from '@/lib/transactional-outbox';

beforeEach(() => {
  mocks.dbQuery.mockReset();
  mocks.platformQuery.mockReset();
});

describe('enqueueOutboxMessage', () => {
  it('inserts a pending row in tenant context with a JSON payload', async () => {
    mocks.dbQuery.mockResolvedValue([]);
    await enqueueOutboxMessage('estimate_delivery', 'idem-1', { displayId: 'EST-0001' });

    expect(mocks.dbQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.dbQuery.mock.calls[0] as [string, unknown[]];
    const [topic, key, payload] = params as [string, string, string];
    expect(sql).toContain('INSERT INTO transactional_outbox');
    expect(sql).toContain('app_require_organization_id()');
    expect(topic).toBe('estimate_delivery');
    expect(key).toBe('idem-1');
    expect(JSON.parse(payload)).toEqual({ displayId: 'EST-0001' });
  });
});

describe('claimOutboxMessages', () => {
  it('claims a batch through the SECURITY DEFINER window and maps columns', async () => {
    mocks.platformQuery.mockResolvedValue([{
      id: '11111111-1111-4111-8111-111111111111',
      organization_id: '22222222-2222-4222-8222-222222222222',
      topic: 'estimate_delivery',
      key: 'idem-1',
      payload: { displayId: 'EST-0001' },
      attempts: 2,
      claim_token: '33333333-3333-4333-8333-333333333333',
    }]);

    const messages = await claimOutboxMessages(20);

    expect(mocks.platformQuery).toHaveBeenCalledWith(
      'SELECT * FROM claim_ready_outbox_messages($1)',
      [20],
    );
    expect(messages).toEqual([{
      id: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      topic: 'estimate_delivery',
      key: 'idem-1',
      payload: { displayId: 'EST-0001' },
      attempts: 2,
      claimToken: '33333333-3333-4333-8333-333333333333',
    }]);
  });

  it('returns no messages when the queue is empty', async () => {
    mocks.platformQuery.mockResolvedValue([]);
    expect(await claimOutboxMessages(5)).toEqual([]);
  });
});

describe('finishOutboxMessage', () => {
  const claim = { id: 'id-1', claimToken: 'token-1' };

  it('records success through the fenced finish window', async () => {
    mocks.platformQuery.mockResolvedValue([{ recorded: true }]);
    await expect(finishOutboxMessage(claim, { succeeded: true })).resolves.toBe(true);
    expect(mocks.platformQuery).toHaveBeenCalledWith(
      'SELECT finish_outbox_message($1, $2, $3, $4, $5) AS recorded',
      ['id-1', 'token-1', true, true, null],
    );
  });

  it('records a failure with the error code and retryability', async () => {
    mocks.platformQuery.mockResolvedValue([{ recorded: true }]);
    await finishOutboxMessage(claim, { succeeded: false, retryable: false, error: 'provider_rejected' });
    expect(mocks.platformQuery).toHaveBeenCalledWith(
      'SELECT finish_outbox_message($1, $2, $3, $4, $5) AS recorded',
      ['id-1', 'token-1', false, false, 'provider_rejected'],
    );
  });

  it('reports a lost claim (reclaimed lease) as not recorded', async () => {
    mocks.platformQuery.mockResolvedValue([{ recorded: false }]);
    await expect(finishOutboxMessage(claim, { succeeded: true })).resolves.toBe(false);
  });
});
