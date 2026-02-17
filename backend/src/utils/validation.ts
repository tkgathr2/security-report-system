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
