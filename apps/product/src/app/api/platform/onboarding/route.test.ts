import { describe, expect, it } from 'vitest';
import { honeypotTriggered } from '@/app/api/platform/onboarding/route';

describe('honeypotTriggered', () => {
  it('triggers on a populated company_website value', () => {
    expect(honeypotTriggered('{"company_website":"https://spam.example"}')).toBe(true);
  });

  it('does not trigger for a missing field', () => {
    expect(honeypotTriggered('{"company_name":"Acme"}')).toBe(false);
  });

  it('does not trigger for an empty or whitespace value', () => {
    expect(honeypotTriggered('{"company_website":""}')).toBe(false);
    expect(honeypotTriggered('{"company_website":"   "}')).toBe(false);
  });

  it('triggers even on an imperfectly-formed body (non-JSON)', () => {
    expect(honeypotTriggered('company_website="https://spam.example" trailing')).toBe(true);
  });
});
