import 'server-only';

import type { AiToolCall } from '@contractor-platform/ai/agent';
import { requireAiActorContext, runAsAiActor, type AiActorIdentity } from './ai-actor-context';
import { aiActorResolver } from './ai-actors';
import { recordAiToolAuditEvent } from './ai-audit';
import { createAscendAiToolRegistry } from './ai-tools';

const registry = createAscendAiToolRegistry();

/**
 * Executes one Ascend AI tool as a persistent, tenant-scoped application actor.
 * The caller must already be inside an authenticated organization context.
 */
export async function invokeAscendAiTool(
  identity: AiActorIdentity,
  call: AiToolCall,
  options: { confirm?: boolean } = {},
): Promise<unknown> {
  return runAsAiActor(identity, async () => {
    const context = await requireAiActorContext(aiActorResolver);
    return registry.invoke(context, call, {
      confirm: options.confirm,
      audit: recordAiToolAuditEvent,
    });
  });
}

export function listAscendAiTools() {
  return registry.list();
}
