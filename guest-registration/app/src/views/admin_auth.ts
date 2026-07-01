// 管理者の認証・管理画面（日本語・管理者向け）
import { html, raw } from "hono/html";
import type { HE } from "./layout";
import type { Admin } from "../lib/auth";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function loginPage(opts: { error?: string }): HE {
  return html`
  <div class="card">
    <h1>管理ログイン</h1>
    ${opts.error ? html`<div class="notice err">${opts.error}</div>` : ""}
    <form method="post" action="/admin/login">
      <label>メールアドレス</label>
      <input type="email" name="email" required autocomplete="username">
      <label>パスワード</label>
      <input type="password" name="password" required autocomplete="current-password">
      <button class="btn" type="submit">ログイン</button>
    </form>
  </div>`;
}

export function totpPage(opts: { error?: string }): HE {
  return html`
  <div class="card">
    <h1>2段階認証コード</h1>
    <p class="muted">認証アプリ（Google Authenticator等）に表示される6桁を入力してください。</p>
    ${opts.error ? html`<div class="notice err">${opts.error}</div>` : ""}
    <form method="post" action="/admin/2fa">
      <label>6桁コード</label>
      <input type="text" name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" required autocomplete="one-time-code">
      <button class="btn" type="submit">認証</button>
    </form>
  </div>`;
}

export function enrollPage(opts: { secret: string; uri: string; error?: string }): HE {
  return html`
  <div class="card">
    <h1>2段階認証の初期設定</h1>
    <p class="muted">認証アプリにこのアカウントを登録してください（初回のみ）。</p>
    ${opts.error ? html`<div class="notice err">${opts.error}</div>` : ""}
    <p><strong>手動登録キー</strong></p>
    <div class="notice ok" style="word-break:break-all;font-family:monospace">${opts.secret}</div>
    <p class="muted">アプリで「セットアップキーを入力」を選び、上のキーを貼り付け（種類：時間ベース）。<br>
    対応アプリならこのリンクから自動登録：<a href="${opts.uri}">${"認証アプリで開く"}</a></p>
    <form method="post" action="/admin/enroll">
      <label>アプリに表示された6桁コード</label>
      <input type="text" name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" required autocomplete="one-time-code">
      <button class="btn" type="submit">登録を完了する</button>
    </form>
  </div>`;
}

export function changePwPage(opts: { error?: string }): HE {
  return html`
  <div class="card">
    <h1>パスワードの変更</h1>
    <p class="muted">初回ログインのため、新しいパスワードを設定してください（8文字以上）。</p>
    ${opts.error ? html`<div class="notice err">${opts.error}</div>` : ""}
    <form method="post" action="/admin/change-pw">
      <label>新しいパスワード</label>
      <input type="password" name="password" required minlength="8" autocomplete="new-password">
      <label>新しいパスワード（確認）</label>
      <input type="password" name="password2" required minlength="8" autocomplete="new-password">
      <button class="btn" type="submit">変更する</button>
    </form>
  </div>`;
}

export function adminsPage(opts: { admins: Admin[]; meEmail: string; flash?: string; tempCred?: { email: string; password: string } }): HE {
  const rows = opts.admins
    .map((a) => {
      const role = a.is_master ? "マスター" : "管理者";
      const status = a.status === "active" ? "有効" : "無効";
      const twofa = a.totp_enabled ? "✅" : "未";
      const last = a.last_login_at ? esc(a.last_login_at.replace("T", " ").slice(0, 16)) : "-";
      const toggle =
        a.email === opts.meEmail
          ? '<span class="muted">本人</span>'
          : a.status === "active"
          ? `<form method="post" action="/admin/admins/${a.id}/disable" style="margin:0"><button class="btn secondary" style="width:auto;padding:4px 10px">無効化</button></form>`
          : `<form method="post" action="/admin/admins/${a.id}/enable" style="margin:0"><button class="btn secondary" style="width:auto;padding:4px 10px">有効化</button></form>`;
      return `<tr><td>${esc(a.email)}</td><td>${role}</td><td>${status}</td><td>2FA:${twofa}</td><td>${last}</td><td>${toggle}</td></tr>`;
    })
    .join("");

  return html`
  <div class="card">
    <h1>管理者の管理</h1>
    ${opts.flash ? html`<div class="notice ok">${opts.flash}</div>` : ""}
    ${opts.tempCred
      ? html`<div class="notice warn"><strong>新しい管理者の初期ログイン情報（一度だけ表示）</strong><br>
        メール：<code>${esc(opts.tempCred.email)}</code><br>
        仮パスワード：<code>${esc(opts.tempCred.password)}</code><br>
        本人に安全な方法で渡してください。初回ログイン時にパスワード変更と2段階認証の登録が必要です。</div>`
      : ""}
    <div style="overflow:auto">
    <table><thead><tr><th>メール</th><th>役割</th><th>状態</th><th>2FA</th><th>最終ログイン</th><th></th></tr></thead>
    <tbody>${raw(rows)}</tbody></table>
    </div>
  </div>
  <div class="card">
    <h2>管理者を追加</h2>
    <p class="muted">メールアドレスを登録すると仮パスワードを発行します（初回ログインで変更＋2FA登録）。</p>
    <form method="post" action="/admin/admins">
      <label>メールアドレス</label>
      <input type="email" name="email" required>
      <label><input type="checkbox" name="is_master" value="1"> マスター権限を付与（管理者の管理が可能）</label>
      <button class="btn" type="submit">追加する</button>
    </form>
    <p class="muted" style="margin-top:14px"><a href="/admin">← 予約一覧へ</a>　|　<a href="/admin/logout">ログアウト</a></p>
  </div>`;
}
