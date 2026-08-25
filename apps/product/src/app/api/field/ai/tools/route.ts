import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { privateJson } from '@/lib/http';
import { listJBoxAiTools } from '@/lib/ai-agent';

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
      const tools = listJBoxAiTools();
      return privateJson({ tools });
    });
  } catch (error) {
    console.error('Failed to list AI tools:', error);
    return privateJson({ error: 'Failed to list tools' }, 500);
  }
}
