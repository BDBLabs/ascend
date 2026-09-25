import { resolveTxt } from 'node:dns/promises';

/**
 * Custom-domain ownership proof: the domain's DNS must publish
 *   _jbox-verify.<hostname>  TXT  "jbox-verify=<token>"
 * with the token stored for that domain (migration 036). Nothing else marks a
 * custom hostname verified, because a verified hostname IS the tenant boundary.
 */
export function verificationRecord(hostname: string, token: string) {
  return { name: `_jbox-verify.${hostname}`, value: `jbox-verify=${token}` };
}

export async function hasVerificationRecord(
  hostname: string,
  token: string,
  resolver: (name: string) => Promise<string[][]> = resolveTxt,
): Promise<boolean> {
  const { name, value } = verificationRecord(hostname, token);
  try {
    const records = await resolver(name);
    // A TXT record may be split into several strings; join each record.
    return records.some((chunks) => chunks.join('') === value);
  } catch {
    return false; // NXDOMAIN / ENODATA / timeout: not proven
  }
}
