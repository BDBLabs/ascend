import {
  fieldPrincipalCan,
  getFieldPrincipal,
  withFieldContext,
} from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { listCustomers } from '@/lib/customers';
import {
  card,
  heading,
  muted,
  subtitle,
  table,
  td,
  th,
} from '../jbox-tokens';

export const dynamic = 'force-dynamic';

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
        <h1 style={heading}>Client Accounts</h1>
        <p style={subtitle}>Customer directory and job history.</p>
        <div style={{ ...card, textAlign: 'center', marginTop: '32px' }}>
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
        <h1 style={heading}>Client Accounts</h1>
        <p style={subtitle}>Customer directory and job history.</p>
      </div>

      {customers.length === 0 ? (
        <div style={{ ...card, textAlign: 'center' }}>
          <p style={{ color: '#475569', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, margin: 0 }}>
            No customers yet.
          </p>
        </div>
      ) : (
        <div style={card}>
          <div style={{ overflowX: 'auto' }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Customer</th>
                <th style={th}>Contact</th>
                <th style={th}>Town</th>
                <th style={th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td style={td}>
                    <a href={`/jbox/customers/${customer.id}`} style={{ color: '#f59e0b', textDecoration: 'none', fontWeight: 600 }}>{customer.displayId}</a>
                    <div>{customer.name}</div>
                  </td>
                  <td style={td}>
                    {(customer.phone || customer.email) ? (
                      <>
                        {customer.phone && <div>{customer.phone}</div>}
                        {customer.email && <div style={muted}>{customer.email}</div>}
                      </>
                    ) : (
                      <span style={muted}>No contact on file</span>
                    )}
                  </td>
                  <td style={td}>{customer.town || <span style={muted}>—</span>}</td>
                  <td style={{ ...td, ...muted }}>
                    {new Date(customer.createdAt).toLocaleDateString()}
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
