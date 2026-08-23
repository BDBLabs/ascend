import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { listCustomers } from '@/lib/customers';

export const dynamic = 'force-dynamic';

const S = {
  heading: { fontSize: '1.5rem', fontWeight: 900, textTransform: 'uppercase', color: 'white', margin: '0 0 8px' } as const,
  subtitle: { color: '#94a3b8', fontSize: '0.875rem', margin: 0 } as const,
  card: { background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '32px' } as const,
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' } as const,
  th: { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #334155', color: '#64748b', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' } as const,
  td: { padding: '10px 12px', borderBottom: '1px solid #1e293b', color: '#cbd5e1' } as const,
  muted: { color: '#64748b', fontSize: '0.8125rem' } as const,
};

export default async function JBoxCustomersPage() {
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
        <h1 style={S.heading}>Client Accounts</h1>
        <p style={S.subtitle}>Customer directory and job history.</p>
        <div style={{ ...S.card, textAlign: 'center', marginTop: '32px' }}>
          <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            Database not configured
          </p>
        </div>
      </div>
    );
  }

  const customers = await withFieldContext(principal, () => listCustomers(''));

  return (
    <div>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={S.heading}>Client Accounts</h1>
        <p style={S.subtitle}>Customer directory and job history.</p>
      </div>

      {customers.length === 0 ? (
        <div style={{ ...S.card, textAlign: 'center' }}>
          <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            No customers yet.
          </p>
        </div>
      ) : (
        <div style={S.card}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Customer</th>
                <th style={S.th}>Contact</th>
                <th style={S.th}>Town</th>
                <th style={S.th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td style={S.td}>
                    <span style={{ fontWeight: 600 }}>{customer.displayId}</span>
                    <div>{customer.name}</div>
                  </td>
                  <td style={S.td}>
                    {(customer.phone || customer.email) ? (
                      <>
                        {customer.phone && <div>{customer.phone}</div>}
                        {customer.email && <div style={S.muted}>{customer.email}</div>}
                      </>
                    ) : (
                      <span style={S.muted}>No contact on file</span>
                    )}
                  </td>
                  <td style={S.td}>{customer.town || <span style={S.muted}>—</span>}</td>
                  <td style={{ ...S.td, ...S.muted }}>
                    {new Date(customer.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
