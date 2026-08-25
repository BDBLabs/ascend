import 'server-only';

import { db } from '@/lib/db';

export type AiConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type AiMessage = {
  id: string;
  conversationId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls: unknown[] | null;
  toolCallId: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  createdAt: string;
};

type ConversationRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  tool_calls: unknown[] | null;
  tool_call_id: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
};

function mapConversation(row: ConversationRow): AiConversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: MessageRow): AiMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as AiMessage['role'],
    content: row.content,
    toolCalls: row.tool_calls,
    toolCallId: row.tool_call_id,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    createdAt: row.created_at,
  };
}

export async function createConversation(title?: string): Promise<AiConversation> {
  const rows = await db().query(
    `INSERT INTO ai_conversations (organization_id, title)
     VALUES (app_require_organization_id(), $1)
     RETURNING id, title, created_at, updated_at`,
    [title ?? ''],
  ) as ConversationRow[];
  return mapConversation(rows[0]);
}

export async function getConversation(id: string): Promise<AiConversation | null> {
  const rows = await db().query(
    `SELECT id, title, created_at, updated_at
     FROM ai_conversations
     WHERE id = $1::uuid AND organization_id = app_require_organization_id()
     LIMIT 1`,
    [id],
  ) as ConversationRow[];
  return rows[0] ? mapConversation(rows[0]) : null;
}

export async function listConversations(limit = 20): Promise<AiConversation[]> {
  const rows = await db().query(
    `SELECT id, title, created_at, updated_at
     FROM ai_conversations
     WHERE organization_id = app_require_organization_id()
     ORDER BY updated_at DESC, id
     LIMIT $1`,
    [limit],
  ) as ConversationRow[];
  return rows.map(mapConversation);
}

export async function updateConversationTitle(id: string, title: string): Promise<void> {
  await db().query(
    `UPDATE ai_conversations
     SET title = $2, updated_at = now()
     WHERE id = $1::uuid AND organization_id = app_require_organization_id()`,
    [id, title],
  );
}

export async function deleteConversation(id: string): Promise<boolean> {
  const result = await db().query(
    `DELETE FROM ai_conversations
     WHERE id = $1::uuid AND organization_id = app_require_organization_id()`,
    [id],
  ) as Array<{ rowCount?: number }>;
  return (result as unknown as { rowCount: number }[])[0]?.rowCount > 0;
}

export async function getMessages(conversationId: string): Promise<AiMessage[]> {
  const rows = await db().query(
    `SELECT id, conversation_id, role, content, tool_calls, tool_call_id,
            tokens_in, tokens_out, created_at
     FROM ai_messages
     WHERE conversation_id = $1::uuid
       AND organization_id = app_require_organization_id()
     ORDER BY created_at ASC, id`,
    [conversationId],
  ) as MessageRow[];
  return rows.map(mapMessage);
}

export async function addMessage(input: {
  conversationId: string;
  role: AiMessage['role'];
  content: string;
  toolCalls?: unknown[] | null;
  toolCallId?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
}): Promise<AiMessage> {
  const rows = await db().query(
    `INSERT INTO ai_messages
       (organization_id, conversation_id, role, content, tool_calls, tool_call_id,
        tokens_in, tokens_out)
     VALUES (app_require_organization_id(), $1, $2, $3, $4, $5, $6, $7)
     RETURNING id, conversation_id, role, content, tool_calls, tool_call_id,
               tokens_in, tokens_out, created_at`,
    [
      input.conversationId,
      input.role,
      input.content,
      input.toolCalls ? JSON.stringify(input.toolCalls) : null,
      input.toolCallId ?? null,
      input.tokensIn ?? null,
      input.tokensOut ?? null,
    ],
  ) as MessageRow[];

  // Touch conversation timestamp
  await db().query(
    `UPDATE ai_conversations SET updated_at = now() WHERE id = $1::uuid`,
    [input.conversationId],
  );

  return mapMessage(rows[0]);
}
