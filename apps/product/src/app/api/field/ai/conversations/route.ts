import type { NextRequest } from 'next/server';
import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { privateJson } from '@/lib/http';
import {
  listConversations,
  getConversation,
  deleteConversation,
} from '@/lib/ai-conversations';

export const dynamic = 'force-dynamic';

export async function GET() {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.read')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'AI service unavailable' }, 503);
  }

  try {
    return await withFieldContext(principal, async () => {
      const conversations = await listConversations(50);
      return privateJson({ conversations });
    });
  } catch (error) {
    console.error('Failed to list conversations:', error);
    return privateJson({ error: 'Failed to list conversations' }, 500);
  }
}

export async function DELETE(request: NextRequest) {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'estimates.read')) {
    return privateJson({ error: 'Unauthorized' }, 401);
  }

  if (!isDatabaseConfigured()) {
    return privateJson({ error: 'AI service unavailable' }, 503);
  }

  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return privateJson({ error: 'id query parameter is required' }, 400);
  }

  try {
    return await withFieldContext(principal, async () => {
      const deleted = await deleteConversation(id);
      return privateJson({ ok: deleted });
    });
  } catch (error) {
    console.error('Failed to delete conversation:', error);
    return privateJson({ error: 'Failed to delete conversation' }, 500);
  }
}
