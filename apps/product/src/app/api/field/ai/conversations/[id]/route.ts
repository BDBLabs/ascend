import type { NextRequest } from 'next/server';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { privateJson } from '@/lib/http';
import {
  getConversation,
  getMessages,
} from '@/lib/ai-conversations';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.read')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'AI service unavailable' }, 503);
  }

  const { id } = await params;

  try {
    return await withFieldContext(principal, async () => {
      const conversation = await getConversation(id);
      if (!conversation) {
        return privateJson({ error: 'Conversation not found' }, 404);
      }

      const messages = await getMessages(id);
      return privateJson({ conversation, messages });
    });
  } catch (error) {
    console.error('Failed to load conversation:', error);
    return privateJson({ error: 'Failed to load conversation' }, 500);
  }
}
