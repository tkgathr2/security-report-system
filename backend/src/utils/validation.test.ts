import { describe, it, expect } from 'vitest';
import { isValidEmail, maskEmail, escapeHtml, stripHtmlTags } from './validation';

describe('isValidEmail', () => {
  it('accepts a normal address', () => {
    expect(isValidEmail('taro@example.com')).toBe(true);
    expect(isValidEmail('a.b+c_d%e-f@sub.example.co.jp')).toBe(true);
  });

  it('trims surrounding whitespace before validating', () => {
    expect(isValidEmail('  taro@example.com  ')).toBe(true);
  });

  it('rejects empty / non-string', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('   ')).toBe(false);
    // @ts-expect-error testing runtime guard against non-string
    expect(isValidEmail(null)).toBe(false);
    // @ts-expect-error testing runtime guard against non-string
    expect(isValidEmail(undefined)).toBe(false);
    // @ts-expect-error testing runtime guard against non-string
    expect(isValidEmail(123)).toBe(false);
  });

  it('rejects addresses longer than 254 chars', () => {
    const local = 'a'.repeat(250);
    const longEmail = `${local}@ex.com`; // > 254
    expect(longEmail.length).toBeGreaterThan(254);
    expect(isValidEmail(longEmail)).toBe(false);
  });

  it('rejects consecutive dots in local part', () => {
    expect(isValidEmail('a..b@example.com')).toBe(false);
  });

  it('rejects leading / trailing dot in local part', () => {
    expect(isValidEmail('.taro@example.com')).toBe(false);
    expect(isValidEmail('taro.@example.com')).toBe(false);
  });

  it('rejects control characters such as CR/LF (header injection guard)', () => {
    expect(isValidEmail('taro@example.com\r\nbcc:evil@x.com')).toBe(false);
    expect(isValidEmail('taro\n@example.com')).toBe(false);
    expect(isValidEmail('taro@exa\rmple.com')).toBe(false);
  });

  it('rejects missing @ or missing domain TLD', () => {
    expect(isValidEmail('taro')).toBe(false);
    expect(isValidEmail('taro@')).toBe(false);
    expect(isValidEmail('taro@example')).toBe(false);
    expect(isValidEmail('@example.com')).toBe(false);
  });
});

describe('maskEmail', () => {
  it('masks a normal address keeping first local char and domain', () => {
    expect(maskEmail('taro@example.com')).toBe('t***@example.com');
  });

  it('masks longer local parts to a fixed pattern', () => {
    expect(maskEmail('taro.yamada@example.com')).toBe('t***@example.com');
  });

  it('trims whitespace before masking', () => {
    expect(maskEmail('  taro@example.com  ')).toBe('t***@example.com');
  });

  it('returns fixed mask for invalid / empty values', () => {
    expect(maskEmail('')).toBe('***');
    expect(maskEmail(null)).toBe('***');
    expect(maskEmail(undefined)).toBe('***');
    expect(maskEmail('no-at-sign')).toBe('***');
    expect(maskEmail('@leading.com')).toBe('***'); // atIdx === 0
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML-sensitive characters', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('"quote"')).toBe('&quot;quote&quot;');
    expect(escapeHtml("it's")).toBe('it&#x27;s');
  });

  it('does not leave a raw tag for an XSS payload', () => {
    const out = escapeHtml('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('returns empty string for null / undefined', () => {
    // @ts-expect-error runtime guard
    expect(escapeHtml(null)).toBe('');
    // @ts-expect-error runtime guard
    expect(escapeHtml(undefined)).toBe('');
  });

  it('escapes & before other entities (no double-escaping breakage)', () => {
    expect(escapeHtml('<')).toBe('&lt;');
    // ampersand of produced entity must itself be the literal input ampersand only
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('stripHtmlTags', () => {
  it('removes tags and dangerous schemes', () => {
    expect(stripHtmlTags('<b>hi</b>')).toBe('hi');
    expect(stripHtmlTags('javascript:alert(1)')).toBe('alert(1)');
  });
});
