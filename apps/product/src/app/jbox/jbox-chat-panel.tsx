'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { COLORS, FONT } from './jbox-tokens';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCallsMade?: number;
};

type Conversation = {
  id: string;
  title: string;
  updatedAt: string;
};

const S = {
  container: {
    display: 'flex',
    height: 'calc(100vh - 64px)',
    background: COLORS.bg,
    fontFamily: FONT.body,
  } as React.CSSProperties,
  sidebar: {
    width: '280px',
    borderRight: `1px solid ${COLORS.border}`,
    display: 'flex',
    flexDirection: 'column',
    background: COLORS.cardBg,
  } as React.CSSProperties,
  sidebarHeader: {
    padding: '16px',
    borderBottom: `1px solid ${COLORS.border}`,
  } as React.CSSProperties,
  newBtn: {
    width: '100%',
    background: COLORS.amberBg,
    color: COLORS.amber,
    border: `2px solid ${COLORS.amberBorder}`,
    borderRadius: '6px',
    padding: '10px',
    fontSize: '12px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    cursor: 'pointer',
  } as React.CSSProperties,
  convList: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px',
  } as React.CSSProperties,
  convItem: (active: boolean) => ({
    padding: '10px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    color: active ? COLORS.amber : COLORS.textSecondary,
    background: active ? 'rgba(245, 158, 11, 0.08)' : 'transparent',
    marginBottom: '4px',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }),
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  } as React.CSSProperties,
  messages: {
    flex: 1,
    overflowY: 'auto',
    padding: '24px',
  } as React.CSSProperties,
  msg: (role: string) => ({
    maxWidth: '720px',
    margin: '0 auto 16px',
    padding: '12px 16px',
    borderRadius: '8px',
    fontSize: '14px',
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap' as const,
    background: role === 'user' ? 'rgba(245, 158, 11, 0.08)' : COLORS.cardBg,
    border: `1px solid ${role === 'user' ? COLORS.amberBorder : COLORS.border}`,
    color: COLORS.textPrimary,
  }),
  inputBar: {
    padding: '16px 24px',
    borderTop: `1px solid ${COLORS.border}`,
    background: COLORS.cardBg,
  } as React.CSSProperties,
  inputRow: {
    display: 'flex',
    gap: '8px',
    maxWidth: '720px',
    margin: '0 auto',
  } as React.CSSProperties,
  input: {
    flex: 1,
    background: COLORS.bg,
    color: COLORS.textPrimary,
    border: `2px solid ${COLORS.border}`,
    borderRadius: '6px',
    padding: '10px 14px',
    fontSize: '14px',
    fontFamily: FONT.body,
    outline: 'none',
    resize: 'none' as const,
    minHeight: '42px',
  } as React.CSSProperties,
  sendBtn: {
    background: COLORS.amber,
    color: '#0f172a',
    border: 'none',
    borderRadius: '6px',
    padding: '10px 20px',
    fontSize: '12px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  toolBadge: {
    display: 'inline-block',
    background: 'rgba(34, 197, 94, 0.1)',
    color: '#22c55e',
    border: '1px solid rgba(34, 197, 94, 0.3)',
    borderRadius: '4px',
    padding: '2px 8px',
    fontSize: '11px',
    fontWeight: 600,
    marginTop: '6px',
  } as React.CSSProperties,
  empty: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: COLORS.textDim,
    fontSize: '14px',
  } as React.CSSProperties,
};

export function JBoxChatPanel() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(scrollToBottom, [messages, scrollToBottom]);

  // Load conversations on mount
  useEffect(() => {
    fetch('/api/field/ai/conversations')
      .then((r) => r.json())
      .then((data) => setConversations(data.conversations ?? []))
      .catch(() => {});
  }, []);

  // Load messages when conversation changes
  useEffect(() => {
    if (!activeConvId) { setMessages([]); return; }
    fetch(`/api/field/ai/conversations/${activeConvId}`)
      .then((r) => r.json())
      .then((data) => {
        const msgs = (data.messages ?? []).map((m: { id: string; role: string; content: string }) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));
        setMessages(msgs);
      })
      .catch(() => setMessages([]));
  }, [activeConvId]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setLoading(true);

    const userMsg: Message = { id: `temp-${Date.now()}`, role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch('/api/field/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversationId: activeConvId }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessages((prev) => [...prev, {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `Error: ${data.error ?? 'Something went wrong.'}`,
        }]);
        return;
      }

      const assistantMsg: Message = {
        id: `reply-${Date.now()}`,
        role: 'assistant',
        content: data.reply,
        toolCallsMade: data.toolCallsMade,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Update conversation list
      if (data.conversationId && !activeConvId) {
        setActiveConvId(data.conversationId);
        setConversations((prev) => [
          { id: data.conversationId, title: text.slice(0, 100), updatedAt: new Date().toISOString() },
          ...prev,
        ]);
      }
    } catch {
      setMessages((prev) => [...prev, {
        id: `net-${Date.now()}`,
        role: 'assistant',
        content: 'Network error — could not reach the assistant.',
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={S.container}>
      <div style={S.sidebar}>
        <div style={S.sidebarHeader}>
          <button style={S.newBtn} onClick={() => { setActiveConvId(null); setMessages([]); }}>
            + New Conversation
          </button>
        </div>
        <div style={S.convList}>
          {conversations.map((c) => (
            <div
              key={c.id}
              style={S.convItem(c.id === activeConvId)}
              onClick={() => setActiveConvId(c.id)}
            >
              {c.title || 'Untitled'}
            </div>
          ))}
          {conversations.length === 0 && (
            <p style={{ color: COLORS.textDim, fontSize: '12px', padding: '12px', textAlign: 'center' }}>
              No conversations yet
            </p>
          )}
        </div>
      </div>

      <div style={S.main}>
        {messages.length === 0 ? (
          <div style={S.empty}>
            Ask about your customers, estimates, or schedule.
          </div>
        ) : (
          <div style={S.messages}>
            {messages.map((m) => (
              <div key={m.id} style={S.msg(m.role)}>
                {m.content}
                {m.toolCallsMade ? (
                  <div style={S.toolBadge}>
                    {m.toolCallsMade} tool {m.toolCallsMade === 1 ? 'call' : 'calls'}
                  </div>
                ) : null}
              </div>
            ))}
            {loading && (
              <div style={S.msg('assistant')} color={COLORS.textDim}>
                Thinking...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}

        <div style={S.inputBar}>
          <div style={S.inputRow}>
            <textarea
              style={S.input}
              placeholder="Ask J-Box Assistant..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              rows={1}
              disabled={loading}
            />
            <button
              style={{ ...S.sendBtn, opacity: loading || !input.trim() ? 0.5 : 1 }}
              onClick={sendMessage}
              disabled={loading || !input.trim()}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
