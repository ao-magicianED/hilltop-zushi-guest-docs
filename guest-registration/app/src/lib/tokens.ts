// トークン生成・ハッシュ・比較・ID生成（設計 ⑧）
// 生トークンはユーザーにだけ渡し、DBには SHA-256 ハッシュのみ保存する。

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 3) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += B64URL[((b1 & 15) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += B64URL[b2 & 63];
  }
  return out;
}

/** URL安全な乱数トークン（既定256bit）を生成 */
export function generateToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toBase64Url(buf);
}

/** ランダムID（DB主キー用） */
export function newId(prefix = ""): string {
  return prefix + generateToken(16);
}

/** トークンを SHA-256(hex) でハッシュ化（DB保存・照合用） */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 文字列の SHA-256(hex)（パスワード照合・ブラックリスト照合などに使用） */
export async function sha256Hex(input: string): Promise<string> {
  return hashToken(input);
}

/** 定数時間比較（応答時間差による推測を防ぐ） */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 数字のみのワンタイムコード（例：暗証番号表示用ではなく汎用） */
export function randomDigits(n = 6): string {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  let s = "";
  for (let i = 0; i < n; i++) s += (buf[i]! % 10).toString();
  return s;
}
