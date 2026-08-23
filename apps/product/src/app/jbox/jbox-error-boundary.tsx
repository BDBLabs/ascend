'use client';

import type { ReactNode } from 'react';
import { Component, type ErrorInfo } from 'react';

type Props = { children: ReactNode; fallbackTitle?: string };
type State = { hasError: boolean; error: Error | null };

export class JBoxErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('J-Box page error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          background: '#1e293b', border: '1px solid #334155', borderRadius: '8px',
          padding: '32px', textAlign: 'center',
        }}>
          <p style={{
            fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.08em', color: '#ef4444', marginBottom: '8px',
          }}>
            {this.props.fallbackTitle ?? 'Something went wrong'}
          </p>
          <p style={{ color: '#64748b', fontSize: '0.8125rem', margin: '0 0 16px' }}>
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              background: '#334155', color: '#cbd5e1', border: '2px solid #475569',
              borderRadius: '6px', padding: '8px 16px', fontSize: '11px', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'pointer',
            }}
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
