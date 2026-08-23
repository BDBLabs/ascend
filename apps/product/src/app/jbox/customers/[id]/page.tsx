import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { getCustomer } from '@/lib/customers';
import {
  COLORS,
  card,
  heading,
  muted,
  subtitle,
} from '../../jbox-tokens';

export const dynamic = 'force-dynamic';

const S = {
  backLink: { color: COLORS.textMuted, textDecoration: 'none', fontSize: '0.875rem' } as const,
  heading: { ...heading, margin: '8px 0 0' },
  subtitle: { ...subtitle, marginTop: '4px' },
  card: { ...card, padding: '24px', marginBottom: '20px' },
  sectionTitle: { fontSize: '0.875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: COLORS.amber, margin: '0 0 16px' } as const,
  infoGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '20px' } as const,
  infoLabel: { fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: COLORS.textDim, margin: '0 0 4px' } as const,
  infoValue: { color: COLORS.textSecondary, fontSize: '0.875rem', margin: 0 } as const,
};

export default async function JBoxCustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'customers.read')) {
    return (
      <div style={{ padding: '2rem', color: '#ef4444', fontSize: '0.875rem' }}>
        Your staff role does not include access to the customer directory.
      </div>
    );
  }

  if (!isDatabaseConfigured()) {
    return (
      <div>
        <a href="/jbox/customers" style={S.backLink}>&larr; All Customers</a>
        <div style={{ ...S.card, textAlign: 'center', marginTop: '24px' }}>
          <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            Database not configured
          </p>
        </div>
      </div>
    );
  }

  const customer = await withFieldContext(principal, () => getCustomer(id));

  if (!customer) {
    return (
      <div>
        <a href="/jbox/customers" style={S.backLink}>&larr; All Customers</a>
        <div style={{ ...S.card, textAlign: 'center', marginTop: '24px' }}>
          <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            Customer not found
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <a href="/jbox/customers" style={S.backLink}>&larr; All Customers</a>
        <h1 style={S.heading}>{customer.displayId}</h1>
        <p style={S.subtitle}>{customer.name}</p>
      </div>

      <div style={S.card}>
        <h2 style={S.sectionTitle}>Contact &amp; Location</h2>
        <div style={S.infoGrid}>
          <div>
            <p style={S.infoLabel}>Phone</p>
            <p style={S.infoValue}>{customer.phone || '—'}</p>
          </div>
          <div>
            <p style={S.infoLabel}>Email</p>
            <p style={S.infoValue}>{customer.email || '—'}</p>
          </div>
          <div>
            <p style={S.infoLabel}>Address</p>
            <p style={S.infoValue}>{customer.address || '—'}</p>
          </div>
          <div>
            <p style={S.infoLabel}>Town</p>
            <p style={S.infoValue}>{customer.town || '—'}</p>
          </div>
        </div>
      </div>

      <div style={{ ...S.card }}>
        <h2 style={S.sectionTitle}>Record</h2>
        <div style={S.infoGrid}>
          <div>
            <p style={S.infoLabel}>Created</p>
            <p style={{ ...S.infoValue, ...muted }}>{new Date(customer.createdAt).toLocaleString()}</p>
          </div>
          <div>
            <p style={S.infoLabel}>Updated</p>
            <p style={{ ...S.infoValue, ...muted }}>{new Date(customer.updatedAt).toLocaleString()}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
