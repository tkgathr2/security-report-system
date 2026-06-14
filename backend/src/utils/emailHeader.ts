/**
 * メールヘッダ注入(CRLF Injection)対策の多層防御ユーティリティ。
 *
 * SMTP/IMF では subject ヘッダ内の改行が新規ヘッダ行の開始と解釈され、
 * 攻撃者がBcc/Reply-To/任意ヘッダを注入できる。Resend SDK 側でも
 * サニタイズはされているはずだが、全送信経路の最終層で改行と制御文字を
 * 除去して二重防御する（バグチェックラボ田所High#4）。
 */

// 改行: CR, LF
const NEWLINES = new RegExp('[\\r\\n]+', 'g');
// 制御文字: U+0000–U+001F + U+007F (DEL)。改行も含むが NEWLINES で先に処理する
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');
const MULTI_SPACE = / {2,}/g;

export function sanitizeEmailSubject(subject: string): string {
  if (!subject) return '';
  return subject
    .replace(NEWLINES, ' ')
    .replace(CONTROL_CHARS, ' ')
    .replace(MULTI_SPACE, ' ')
    .trim();
}
