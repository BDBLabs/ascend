import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { listInvoices } from '@/lib/invoices';
import {
  FONT,
  STATUS_LABELS,
  card,
  heading,
  muted,
  statusBadge,
  subtitle,
  table,
  td,
  th,
} from '../jbox-tokens';

export const dynamic = 'force-dynamic';

const S = {
  price: { fontFamily: FONT.mono, textAlign: 'right' as const, fontWeight: 600 },
};

export default async function JBoxInvoicesPage() {
  const principal = await getFieldPrincipal();
  if (!fieldPrincipalCan(principal, 'invoices.read')) {
    return (
      <div style={{ padding: '2rem', color: '#ef4444', fontSize: '0.875rem' }}>
        Your staff role does not include access to billing.
      </div>
    );
  }

  if (!isDatabaseConfigured()) {
    return (
      <div>
        <h1 style={heading}>Billing &amp; Tickets</h1>
        <p style={subtitle}>Invoices, payment tracking, and service tickets.</p>
        <div style={{ ...card, textAlign: 'center', marginTop: '32px' }}>
          <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            Database not configured
          </p>
        </div>
      </div>
    );
  }

  let invoices: Awaited<ReturnType<typeof listInvoices>> = [];
  try {
    invoices = await withFieldContext(principal, () => listInvoices({}));
  } catch {
    invoices = [];
  }

  return (
    <div>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={heading}>Billing &amp; Tickets</h1>
        <p style={subtitle}>Invoices, payment tracking, and service tickets.</p>
      </div>

      {invoices.length === 0 ? (
        <div style={{ ...card, textAlign: 'center' }}>
          <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            No invoices yet.
          </p>
        </div>
      ) : (
        <div style={card}>
          <div style={{ overflowX: 'auto' }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Invoice</th>
                <th style={th}>Customer</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Total</th>
                <th style={th}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td style={td}>
                    <a href={`/jbox/invoices/${invoice.id}`} style={{ color: '#f59e0b', textDecoration: 'none', fontWeight: 600 }}>{invoice.displayId}</a>
                    {invoice.title && <div style={muted}>{invoice.title}</div>}
                  </td>
                  <td style={td}>{invoice.customerName}</td>
                  <td style={td}>
                    <span style={statusBadge(invoice.status)}>
                      {STATUS_LABELS[invoice.status] ?? invoice.status}
                    </span>
                  </td>
                  <td style={{ ...td, ...S.price }}>
                    ${(invoice.totals.totalCents / 100).toFixed(2)}
                  </td>
                  <td style={{ ...td, ...muted }}>
                    {new Date(invoice.updatedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
