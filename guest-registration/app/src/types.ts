// Cloudflare バインディングと環境変数の型定義
export type Env = {
  // D1（名簿DB）
  DB: D1Database;
  // KV（トークン引当・進捗・レート制限・パスポート画像の暗号化保存）
  // 注: MVPではR2未有効化のため画像もKVに格納。将来R2へ移行（署名直PUT＋再エンコード）。
  KV: KVNamespace;

  // vars
  APP_BASE_URL: string;
  PROPERTY_NAME: string;
  DATA_RETENTION_YEARS: string;

  // secrets / 設定
  MASTER_KEY: string; // base64 32 bytes（機微情報の暗号化マスター鍵）
  SLACK_WEBHOOK_URL?: string;
  ICAL_URL?: string; // AirbnbカレンダーのエクスポートURL（予約自動取込）
  RESEND_API_KEY?: string; // 通知メール送信用（Resend）。未設定時は送信をスキップ
};

// 対応言語
export type Lang = "ja" | "en" | "zh-CN" | "zh-TW";
export const LANGS: Lang[] = ["ja", "en", "zh-CN", "zh-TW"];
export function normalizeLang(raw: string | undefined | null): Lang {
  if (!raw) return "ja";
  const v = raw.toLowerCase();
  if (v.startsWith("ja")) return "ja";
  if (v.startsWith("en")) return "en";
  if (v === "zh-tw" || v === "zh-hk" || v.includes("hant")) return "zh-TW";
  if (v.startsWith("zh")) return "zh-CN";
  return "ja";
}
