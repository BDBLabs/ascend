import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { loadCustomerEstimateDocument } from '@/lib/customer-estimate-document';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { TenantResolutionError, loadInForceConfig, withTenant } from '@/lib/tenant';
import { EstimateView } from './estimate-view';
import styles from './estimate.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Private estimate',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

/**
 * The private customer estimate document. Served from the tenant subdomain for
 * view and sign tokens. It is deliberately not part of the storefront layout:
 * no navigation, no theming — a neutral document with only the business's name
 * and contact in the footer.
 */
export default async function CustomerEstimatePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { token } = await params;
  const intentRaw = (await searchParams).intent;
  const intent = intentRaw === 'approve' || intentRaw === 'decline' ? intentRaw : null;

  return withTenant(async () => {
    const headerValues = await headers();
    const clientIp = getClientIp(
      new Request('https://rate-limit.invalid', { headers: headerValues }),
    );
    if (!rateLimit(`document_view:${token}:${clientIp}`, { capacity: 60 })) {
      return (
        <main className={styles.unavailable}>
          <h1>Please wait a moment.</h1>
          <p>Too many requests were made for this private document.</p>
        </main>
      );
    }

    const document = await loadCustomerEstimateDocument(token);
    if (!document) notFound();

    if (document.signed === 'integrity-failure') {
      // Stored evidence and hash disagree: say so. Never re-render a signed
      // document from current data.
      return (
        <main className={styles.unavailable}>
          <h1>This document cannot be verified.</h1>
          <p>Its signed record failed an integrity check. Contact the business that sent it.</p>
        </main>
      );
    }

    // A signed estimate shows the business identity exactly as it was when it
    // was signed (stored evidence); only an unsigned draft uses current config.
    if (document.signed) {
      const business = document.signed.business;
      return (
        <EstimateView
          token={token}
          document={document}
          intent={null}
          companyName={business.name || null}
          contact={{ phone: business.phone, email: business.email }}
        />
      );
    }

    const config = await loadInForceConfig();
    return (
      <EstimateView
        token={token}
        document={document}
        intent={intent}
        companyName={config?.identity.businessName ?? null}
        contact={config
          ? { phone: config.contact.phone, email: config.contact.email }
          : null}
      />
    );
  }).catch((error: unknown) => {
    if (error instanceof TenantResolutionError) {
      return notFound();
    }
    throw error;
  });
}
