// Resend経由のトランザクションメール送信。APIキー未設定時は安全にスキップする（ローカル開発を壊さない）。
import type { Env } from "../types";

const FROM = "Hilltop Zushi <noreply@send.bluestage-lcc.com>";

export type SendEmailResult = { ok: boolean; error?: string };

export async function sendEmail(
  env: Env,
  opts: { to: string; subject: string; html: string; replyTo?: string; bcc?: string | string[] }
): Promise<SendEmailResult> {
  if (!env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY未設定のため送信をスキップ:", opts.subject);
    return { ok: false, error: "no_api_key" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        ...(opts.replyTo ? { reply_to: [opts.replyTo] } : {}),
        ...(opts.bcc ? { bcc: Array.isArray(opts.bcc) ? opts.bcc : [opts.bcc] } : {}),
      }),
    });
    if (!res.ok) {
      // レスポンス本文には宛先メールアドレス等が含まれうるためログに出さない（ステータスのみ）
      console.error("[email] send failed", res.status);
      return { ok: false, error: `http_${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error("[email] send exception", e);
    return { ok: false, error: "exception" };
  }
}
