const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function todayJST(): string {
  return new Date(Date.now() + JST_OFFSET_MS).toISOString().split('T')[0];
}

export function toJSTDateString(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().split('T')[0];
}

export function escapeLikePattern(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
