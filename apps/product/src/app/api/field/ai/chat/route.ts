import type { NextRequest } from 'next/server';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { privateJson } from '@/lib/http';
import { runAgentLoop } from '@/lib/ai-agent-loop';
import { createConversation } from '@/lib/ai-conversations';
import { findAiActorByKey, provisionAiActor } from '@/lib/ai-actors';

const DEFAULT_ACTOR_KEY = 'ai:assistant:jbox';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.read')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'AI service unavailable' }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return privateJson({ error: 'Invalid JSON body' }, 400);
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return privateJson({ error: 'message is required' }, 400);
  }
  if (message.length > 4000) {
    return privateJson({ error: 'message must be at most 4000 characters' }, 400);
  }

  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : null;

  try {
    return await withFieldContext(principal, async () => {
      // Resolve AI actor (lazy provision on first use)
      let identity = await findAiActorByKey(DEFAULT_ACTOR_KEY);

      if (!identity) {
        identity = await provisionAiActor({
          actorKey: DEFAULT_ACTOR_KEY,
          displayName: 'J-Box Assistant',
          authorityRole: 'employee',
          modelProvider: process.env.AI_BASE_URL ? new URL(process.env.AI_BASE_URL).hostname : 'nvidia',
          modelName: process.env.AI_MODEL ?? 'meta/llama-3.1-405b-instruct',
        });
      }

      // Create or use existing conversation
      let convId = conversationId;
      if (!convId) {
        const conv = await createConversation();
        convId = conv.id;
      }

      const result = await runAgentLoop(identity, convId, message);

      return privateJson({
        ok: true,
        conversationId: convId,
        reply: result.reply,
        toolCallsMade: result.toolCallsMade,
      });
    });
  } catch (error) {
    console.error('AI chat error:', error);
    return privateJson({ error: 'AI assistant encountered an error' }, 500);
  }
}
