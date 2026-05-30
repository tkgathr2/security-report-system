import { describe, it, expect, vi } from 'vitest';

// emailSender.ts imports `pool` from ../db/pool at module load, and that module
// throws if DATABASE_URL is unset. It also constructs a Resend client.
// Mock both so we can import the pure helper functions without touching a real DB
// or the network.
vi.mock('../db/pool', () => ({
  default: { query: vi.fn() },
}));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: vi.fn() };
  },
}));

import { isRetryableError, extractStatusCode, buildEmailContent } from './emailSender';

describe('extractStatusCode', () => {
  it('reads numeric statusCode', () => {
    expect(extractStatusCode({ statusCode: 429 })).toBe(429);
  });
  it('reads numeric status', () => {
    expect(extractStatusCode({ status: 503 })).toBe(503);
  });
  it('prefers statusCode over status', () => {
    expect(extractStatusCode({ statusCode: 400, status: 500 })).toBe(400);
  });
  it('parses numeric string status', () => {
    expect(extractStatusCode({ status: '404' })).toBe(404);
  });
  it('returns null for non-numeric / missing / non-object', () => {
    expect(extractStatusCode({ status: 'oops' })).toBeNull();
    expect(extractStatusCode({})).toBeNull();
    expect(extractStatusCode(null)).toBeNull();
    expect(extractStatusCode(new Error('network'))).toBeNull();
  });
});

describe('isRetryableError', () => {
  it('does NOT retry generic 4xx permanent errors', () => {
    expect(isRetryableError({ statusCode: 400 })).toBe(false);
    expect(isRetryableError({ statusCode: 401 })).toBe(false);
    expect(isRetryableError({ statusCode: 403 })).toBe(false);
    expect(isRetryableError({ statusCode: 404 })).toBe(false);
    expect(isRetryableError({ statusCode: 422 })).toBe(false);
  });

  it('DOES retry on 429 (rate limit)', () => {
    expect(isRetryableError({ statusCode: 429 })).toBe(true);
  });

  it('DOES retry on 5xx server errors', () => {
    expect(isRetryableError({ statusCode: 500 })).toBe(true);
    expect(isRetryableError({ statusCode: 502 })).toBe(true);
    expect(isRetryableError({ statusCode: 503 })).toBe(true);
  });

  it('DOES retry when status is unknown (network / timeout)', () => {
    expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true);
    expect(isRetryableError({})).toBe(true);
    expect(isRetryableError(null)).toBe(true);
    expect(isRetryableError(undefined)).toBe(true);
  });
});

describe('buildEmailContent — HTML escaping (XSS regression guard)', () => {
  const base = {
    companyName: 'Acme',
    contactName: 'Taro',
    contactTitle: 'Manager',
    clientAddress: 'Tokyo',
    workDate: '2026-05-30',
    projectName: 'Patrol',
    writerName: 'Writer',
    supervisorName: 'Sup',
    location: 'Gate',
    reportId: 'rep-1',
  };

  it('escapes <script> in companyName for client mail (no raw tag in html)', () => {
    const { html } = buildEmailContent('client', {
      ...base,
      companyName: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes img onerror payload in projectName for client mail', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const { html } = buildEmailContent('client', { ...base, projectName: payload });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('onerror=alert(1)>'); // not present as live attribute terminator
  });

  it('escapes payloads in writer mail fields (projectName, location, supervisorName)', () => {
    const { html } = buildEmailContent('writer', {
      ...base,
      projectName: '<script>p</script>',
      location: '<script>l</script>',
      supervisorName: '<img onerror=x>',
      writerName: '<b>w</b>',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>w</b>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes payloads in admin mail fields (companyName, reportId, writerName)', () => {
    const { html } = buildEmailContent('admin', {
      ...base,
      companyName: '<script>c</script>',
      reportId: '<script>r</script>',
      writerName: '<img onerror=y>',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes contactName/contactTitle in the client greeting line', () => {
    const { html } = buildEmailContent('client', {
      ...base,
      contactName: '<script>x</script>',
      contactTitle: '<b>t</b>',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>t</b>');
  });

  it('still produces a non-empty subject/text and an html body', () => {
    const { subject, text, html } = buildEmailContent('client', base);
    expect(subject.length).toBeGreaterThan(0);
    expect(text.length).toBeGreaterThan(0);
    expect(html).toContain('<p>'); // structural html present for legitimate content
  });
});
