import { brandFieldEyebrow } from '@/lib/brand';
import { ResetPasswordForm } from './reset-password-form';
import styles from '../../field/field.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Set your password',
  robots: { index: false, follow: false },
};

/**
 * Landing page for operator-issued set-password and reset links
 * (<platform host>/reset-password?token=...). The token is single-use and
 * expires; consuming it signs out every existing session.
 */
export default function ResetPasswordPage() {
  return (
    <main className={styles.accessPage}>
      <section className={styles.accessPanel}>
        <p className={styles.eyebrow}>{brandFieldEyebrow()}</p>
        <h1>Set your password</h1>
        <ResetPasswordForm />
      </section>
    </main>
  );
}
