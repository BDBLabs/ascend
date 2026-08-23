'use client';

import { useCallback, useEffect, useState } from 'react';

type PriceBookItem = {
  id: string;
  code: string;
  name: string;
  unit: string;
  unitPriceCents: number;
  category: string;
  taxable: boolean;
};

type PriceBookCategory = { code: string; name: string };

const S = {
  heading: { fontSize: '1.5rem', fontWeight: 900, textTransform: 'uppercase', color: 'white', margin: '0 0 8px' } as const,
  subtitle: { color: '#94a3b8', fontSize: '0.875rem', margin: '0 0 32px' } as const,
  card: { background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '32px' } as const,
  controls: { display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' } as const,
  search: { background: '#0f172a', border: '2px solid #334155', borderRadius: '6px', padding: '8px 12px', color: '#f1f5f9', fontSize: '0.875rem', outline: 'none', width: '280px' } as const,
  tab: (active: boolean) => ({
    padding: '6px 14px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.04em', border: 'none', cursor: 'pointer',
    background: active ? '#f59e0b' : '#334155', color: active ? '#0f172a' : '#94a3b8',
  }) as const,
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' } as const,
  th: { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #334155', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' } as const,
  td: { padding: '10px 12px', borderBottom: '1px solid #1e293b', color: '#cbd5e1' } as const,
  muted: { color: '#64748b', fontSize: '0.8125rem' } as const,
  price: { fontFamily: 'ui-monospace, monospace', textAlign: 'right' as const, fontWeight: 600 },
  empty: { textAlign: 'center', padding: '32px' as const },
  loading: { color: '#64748b', fontSize: '0.875rem', textAlign: 'center' as const, padding: '32px' },
};

export default function JBoxPriceBookPage() {
  const [items, setItems] = useState<PriceBookItem[]>([]);
  const [categories, setCategories] = useState<PriceBookCategory[]>([]);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('popular');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async (q: string, cat: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (q) params.set('q', q);
      if (cat && cat !== 'popular') params.set('category', cat);
      const res = await fetch(`/api/field/price-book?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        if (res.status === 409) {
          setError('The price book was updated. Please refresh.');
        } else if (res.status === 503) {
          setError(body?.error ?? 'Price book is not available yet.');
        } else {
          setError(body?.error ?? 'Failed to load price book.');
        }
        setItems([]);
        return;
      }
      const data = await res.json();
      setItems(data.items ?? []);
      if (data.categories?.length) setCategories(data.categories);
    } catch {
      setItems([]);
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems('', 'popular');
  }, [fetchItems]);

  useEffect(() => {
    const t = setTimeout(() => fetchItems(search, activeCategory), 300);
    return () => clearTimeout(t);
  }, [search, activeCategory, fetchItems]);

  return (
    <div>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={S.heading}>Parts &amp; Rates Index</h1>
        <p style={S.subtitle}>Price book, material rates, and labor unit costs.</p>
      </div>

      <div style={S.card}>
        <div style={S.controls}>
          <input
            type="text"
            placeholder="Search items..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={S.search}
          />
        </div>

        {categories.length > 0 && (
          <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setActiveCategory('popular')}
              style={S.tab(activeCategory === 'popular')}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat.code}
                onClick={() => setActiveCategory(cat.code)}
                style={S.tab(activeCategory === cat.code)}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <p style={S.loading}>Loading...</p>
        ) : error ? (
          <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: '6px', padding: '12px', marginBottom: '20px', color: '#fca5a5', fontSize: '13px' }}>
            {error}
          </div>
        ) : items.length === 0 ? (
          <div style={S.empty}>
            <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
              No items found
            </p>
          </div>
        ) : (
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Code</th>
                <th style={S.th}>Description</th>
                <th style={S.th}>Unit</th>
                <th style={S.th}>Category</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Unit Price</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td style={{ ...S.td, fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: '#f59e0b' }}>
                    {item.code}
                  </td>
                  <td style={S.td}>{item.name}</td>
                  <td style={S.muted}>{item.unit}</td>
                  <td style={S.muted}>{item.category}</td>
                  <td style={{ ...S.td, ...S.price }}>
                    ${(item.unitPriceCents / 100).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
