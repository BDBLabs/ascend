/**
 * Product brand. Ascend is its own product — elevator modernization — and
 * this codebase serves only it. There is no multi-brand mode: every
 * user-visible string resolves to Ascend. Dependency-free so the proxy
 * layer can share it. Pure string logic — unit tested without a database.
 */

export function brandName(): string {
  return 'Ascend';
}

/** "Ascend Field" — the staff workspace eyebrow. */
export function brandFieldEyebrow(): string {
  return 'Ascend Field';
}

export function brandTagline(): string {
  return 'Workspace for elevator modernization.';
}
