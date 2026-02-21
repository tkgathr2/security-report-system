const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  if (!EMAIL_REGEX.test(trimmed)) return false;
  const localPart = trimmed.split('@')[0];
  if (localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')) return false;
  return true;
}

export const MAX_LENGTHS = {
  PERSON_NAME: 100,
  COMPANY_NAME: 200,
  ADDRESS: 500,
  GUARD_CONTENT_ITEM: 200,
  GUARD_OTHER_TEXT: 1000,
  REASON: 500,
  CONTACT_TITLE: 100,
  STAFF_NO: 50,
  SIGNATURE_BASE64: 7_000_000,
  DRAFT_PAYLOAD: 1_000_000,
  DISPLAY_NAME: 100,
  GUARD_CONTENTS_MAX_ITEMS: 30,
  QUALIFIER_NAME_MAX_ITEMS: 10,
  GUARDS_MAX_ITEMS: 30,
} as const;

export function stripNullBytes(value: string): string {
  return value.replace(/\0/g, '');
}

export function sanitizeInput(value: unknown): unknown {
  if (typeof value === 'string') return stripNullBytes(value);
  if (Array.isArray(value)) return value.map(sanitizeInput);
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = sanitizeInput(v);
    }
    return result;
  }
  return value;
}

export function validateStringField(value: unknown, fieldName: string, maxLength: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return `${fieldName}は文字列で入力してください`;
  if (value.length > maxLength) return `${fieldName}は${maxLength}文字以内で入力してください`;
  return null;
}

export function validateArrayItems(arr: unknown[], fieldName: string, maxItemLength: number, maxItems: number): string | null {
  if (arr.length > maxItems) return `${fieldName}は${maxItems}件以内で入力してください`;
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (typeof item === 'string' && item.length > maxItemLength) {
      return `${fieldName}の各項目は${maxItemLength}文字以内で入力してください`;
    }
  }
  return null;
}
