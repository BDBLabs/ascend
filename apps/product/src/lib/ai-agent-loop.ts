import 'server-only';

import { AiError } from '@contractor-platform/ai';
import { listJBoxAiTools, invokeJBoxAiTool } from './ai-agent';
import type { AiActorIdentity } from './ai-actor-context';
import {
  addMessage,
  getMessages,
  updateConversationTitle,
  type AiMessage,
} from './ai-conversations';

const AI_BASE_URL = process.env.AI_BASE_URL ?? 'https://integrate.api.nvidia.com/v1';
const AI_MODEL = process.env.AI_MODEL ?? 'meta/llama-3.1-405b-instruct';
const AI_TIMEOUT_MS = 90_000;
const MAX_TOOL_ROUNDS = 8;

type LlmMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
};

type LlmTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type LlmResponse = {
  choices: Array<{
    message?: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

const SYSTEM_PROMPT = `You are J-Box Assistant, an AI helper for trade contractors (electrical, plumbing, HVAC, general).

You have access to tools that search the business's customers, estimates, and work schedule.
Use tools when the user asks about specific business data. Always cite the data you find.
Keep answers concise, practical, and in plain language.

Rules:
- Never fabricate customer data, prices, or schedule information.
- If a tool returns no results, say so clearly.
- Do not make financial decisions or authorize changes — you are read-only.
- For urgent safety issues, tell the user to call their supervisor immediately.`;

function buildToolSchemas(): LlmTool[] {
  const tools = listJBoxAiTools();
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: toolParameters(t.name),
    },
  }));
}

function toolParameters(name: string): Record<string, unknown> {
  switch (name) {
    case 'search_customers':
      return {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term (name, phone, or email)' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      };
    case 'get_customer':
      return {
        type: 'object',
        properties: {
          customerId: { type: 'string', description: 'UUID of the customer' },
        },
        required: ['customerId'],
      };
    case 'get_estimate':
      return {
        type: 'object',
        properties: {
          estimateId: { type: 'string', description: 'UUID of the estimate' },
        },
        required: ['estimateId'],
      };
    case 'list_estimates':
      return {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status' },
          customerId: { type: 'string', description: 'Filter by customer UUID' },
        },
        required: [],
      };
    case 'get_schedule':
      return {
        type: 'object',
        properties: {
          startInclusive: { type: 'string', description: 'ISO-8601 start (inclusive)' },
          endExclusive: { type: 'string', description: 'ISO-8601 end (exclusive)' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: ['startInclusive', 'endExclusive'],
      };
    default:
      return { type: 'object', properties: {} };
  }
}

async function callLlm(messages: LlmMessage[], tools: LlmTool[]): Promise<LlmResponse> {
  const apiKey = process.env.NVIDIA_API_KEY || process.env.NVIDIA_KEY;
  if (!apiKey) {
    throw new AiError('NVIDIA_API_KEY is not set. The model cannot be called.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: 2048,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AiError(`Model API responded ${res.status}: ${text.slice(0, 200)}`);
    }

    return (await res.json()) as LlmResponse;
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError('Failed to reach the model API.', error);
  } finally {
    clearTimeout(timer);
  }
}

export type AgentResult = {
  reply: string;
  toolCallsMade: number;
  messagesAdded: AiMessage[];
};

/**
 * Runs the agent loop: sends the user message to the LLM, executes any tool
 * calls, feeds results back, and repeats until the LLM produces a text reply.
 */
export async function runAgentLoop(
  identity: AiActorIdentity,
  conversationId: string,
  userContent: string,
): Promise<AgentResult> {
  // Load conversation history
  const history = await getMessages(conversationId);
  const llmMessages: LlmMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map((m) => {
      const msg: LlmMessage = { role: m.role, content: m.content };
      if (m.toolCalls) msg.tool_calls = m.toolCalls as LlmMessage['tool_calls'];
      if (m.toolCallId) msg.tool_call_id = m.toolCallId;
      return msg;
    }),
    { role: 'user', content: userContent },
  ];

  // Save user message
  const userMsg = await addMessage({
    conversationId,
    role: 'user',
    content: userContent,
  });

  const tools = buildToolSchemas();
  const messagesAdded: AiMessage[] = [userMsg];
  let toolCallsMade = 0;

  // Auto-title: if conversation is untitled and this is the first user message
  if (history.length === 0) {
    const title = userContent.slice(0, 100).replace(/\n/g, ' ').trim();
    await updateConversationTitle(conversationId, title);
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const llmRes = await callLlm(llmMessages, tools);
    const choice = llmRes.choices[0];
    const message = choice?.message;
    if (!message) {
      throw new AiError('Model returned no message.');
    }

    const tokensIn = llmRes.usage?.prompt_tokens ?? null;
    const tokensOut = llmRes.usage?.completion_tokens ?? null;

    // If the model produced tool calls, execute them
    if (message.tool_calls && message.tool_calls.length > 0) {
      // Save assistant message with tool calls
      const assistantMsg = await addMessage({
        conversationId,
        role: 'assistant',
        content: message.content ?? '',
        toolCalls: message.tool_calls,
        tokensIn,
        tokensOut,
      });
      messagesAdded.push(assistantMsg);

      // Add to LLM context
      llmMessages.push({
        role: 'assistant',
        content: message.content ?? undefined,
        tool_calls: message.tool_calls,
      });

      // Execute each tool call
      for (const tc of message.tool_calls) {
        toolCallsMade++;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          args = {};
        }

        let result: unknown;
        try {
          result = await invokeJBoxAiTool(identity, {
            toolName: tc.function.name,
            input: args,
          });
        } catch (error) {
          result = { error: error instanceof Error ? error.message : 'Tool execution failed' };
        }

        const resultContent = typeof result === 'string'
          ? result
          : JSON.stringify(result, null, 2);

        // Save tool result message
        const toolMsg = await addMessage({
          conversationId,
          role: 'tool',
          content: resultContent,
          toolCallId: tc.id,
        });
        messagesAdded.push(toolMsg);

        // Add to LLM context
        llmMessages.push({
          role: 'tool',
          content: resultContent,
          tool_call_id: tc.id,
          name: tc.function.name,
        });
      }

      continue;
    }

    // No tool calls — the model produced a final text reply
    const finalMsg = await addMessage({
      conversationId,
      role: 'assistant',
      content: message.content ?? '',
      tokensIn,
      tokensOut,
    });
    messagesAdded.push(finalMsg);

    return {
      reply: message.content ?? '',
      toolCallsMade,
      messagesAdded,
    };
  }

  // Safety: if we exhausted tool rounds, return what we have
  const fallbackMsg = await addMessage({
    conversationId,
    role: 'assistant',
    content: 'I reached the maximum number of tool lookups. Please try a more specific question.',
  });
  messagesAdded.push(fallbackMsg);

  return {
    reply: 'I reached the maximum number of tool lookups. Please try a more specific question.',
    toolCallsMade,
    messagesAdded,
  };
}
