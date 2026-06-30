// 予約・売上管理＋指標ダッシュボードのビュー
import { html, raw } from "hono/html";
import type { HE } from "./layout";
import type { Reservation } from "../lib/db";
import type { MonthlyMetrics } from "../lib/metrics";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const yen = (n: number) => "¥" + n.toLocaleString("en-US");

export function adminNav(active: string, isMaster: boolean, email: string): HE {
  const link = (href: string, label: string, key: string) =>
    `<a href="${href}" style="${key === active ? "font-weight:700;color:var(--accent)" : "color:var(--muted)"};text-decoration:none">${label}</a>`;
  return html`<div class="muted" style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--line);padding-bottom:10px;margin-bottom:6px">
    ${raw(link("/admin", "予約一覧", "list"))}
    ${raw(link("/admin/reservations", "予約・売上管理", "res"))}
    ${raw(link("/admin/metrics", "指標", "metrics"))}
    ${raw(link("/admin/purge-log", "削除履歴", "purge"))}
    ${raw(isMaster ? link("/admin/admins", "管理者の管理", "admins") : "")}
    <span style="margin-left:auto"></span>
    ${raw(`<a href="/admin/logout" style="color:var(--muted);text-decoration:none">ログアウト（${esc(email)}）</a>`)}
  </div>`;
}

export function reservationsPage(opts: {
  rows: (Reservation & { done: number })[];
  nav: HE;
  flash?: string;
  icalConfigured: boolean;
}): HE {
  const body = opts.rows
    .map((r) => {
      const nm = r.match_last_name ? esc(r.match_last_name) : "(姓未設定)";
      const code = r.airbnb_reservation_code ? esc(r.airbnb_reservation_code) : "—";
      const amt = r.total_amount != null ? yen(r.total_amount) : "—";
      const prog = `${r.done}/${r.expected_guests || "?"}`;
      const st = r.status === "cancelled" ? "取消" : r.status;
      const rv = r.review_status === "approved" ? "承認済" : "未確認";
      const selfBadge = r.source === "guest_selfreport" ? '<br><span class="badge pending">自己申告</span>' : "";
      return `<tr>
        <td><a href="/admin/reservations/${r.id}">${code}</a><br><span class="muted">${nm}</span></td>
        <td>${r.check_in_date}〜${r.check_out_date}<br><span class="muted">${r.nights}泊・${esc(r.channel)}</span></td>
        <td>${prog}</td>
        <td>${amt}</td>
        <td>${st}<br><span class="muted">${rv}</span>${selfBadge}</td>
      </tr>`;
    })
    .join("");
  return html`
  <div class="card">
    ${opts.nav}
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <h1 style="margin:0">予約・売上管理</h1>
      <div style="display:flex;gap:8px">
        <a class="btn" style="width:auto;padding:8px 14px" href="/admin/reservations/new">＋ 新規予約</a>
        <form method="post" action="/admin/ical/import" style="margin:0">
          <button class="btn secondary" style="width:auto;padding:8px 14px" ${opts.icalConfigured ? "" : "disabled title='ICAL_URL未設定'"}>iCal取込</button>
        </form>
      </div>
    </div>
    ${opts.flash ? html`<div class="notice ok">${opts.flash}</div>` : ""}
    ${opts.icalConfigured ? "" : html`<p class="muted">iCal自動取込を使うには <code>ICAL_URL</code>（AirbnbのカレンダーエクスポートURL）を設定してください。</p>`}
    <div style="overflow:auto">
    <table><thead><tr><th>予約/姓</th><th>日程</th><th>提出</th><th>売上</th><th>状態</th></tr></thead>
    <tbody>${raw(body)}</tbody></table>
    </div>
  </div>`;
}

export function reservationForm(opts: { nav: HE; res?: Reservation; error?: string; groupUrl?: string }): HE {
  const r = opts.res;
  const v = (x: unknown) => (x == null ? "" : esc(String(x)));
  const langOpt = (code: string, label: string) =>
    `<option value="${code}" ${r?.preferred_lang === code ? "selected" : ""}>${label}</option>`;
  const chOpt = (code: string, label: string) =>
    `<option value="${code}" ${r?.channel === code ? "selected" : ""}>${label}</option>`;
  const action = r ? `/admin/reservations/${r.id}` : "/admin/reservations";
  return html`
  <div class="card">
    ${opts.nav}
    <h1>${r ? "予約の編集" : "新規予約"}</h1>
    ${opts.error ? html`<div class="notice err">${opts.error}</div>` : ""}
    ${opts.groupUrl
      ? html`<div class="notice ok"><strong>ゲスト用リンク（代表者へ送ってください）</strong><br>
          <code style="word-break:break-all">${opts.groupUrl}</code><br>
          代表者がこのリンクで人数を申告→各自入力できます。</div>`
      : ""}
    <form method="post" action="${action}">
      <label>予約番号（Airbnb確認コード等・任意）</label>
      <input type="text" name="airbnb_reservation_code" value="${v(r?.airbnb_reservation_code)}">
      <label>代表者の姓（ローマ字／/start照合に使用・任意）</label>
      <input type="text" name="match_last_name" value="${v(r?.match_last_name)}">
      <label>チェックイン日 <span class="req">*</span></label>
      <input type="date" name="check_in_date" value="${v(r?.check_in_date)}" required>
      <label>チェックアウト日 <span class="req">*</span></label>
      <input type="date" name="check_out_date" value="${v(r?.check_out_date)}" required>
      <label>宿泊人数（事前設定・任意。代表者申告でも可）</label>
      <input type="number" name="expected_guests" min="0" max="12" value="${v(r?.expected_guests || "")}">
      <label>言語</label>
      <select name="preferred_lang">${raw(langOpt("ja", "日本語") + langOpt("en", "English") + langOpt("zh-CN", "简体中文") + langOpt("zh-TW", "繁體中文"))}</select>
      <label>チャネル</label>
      <select name="channel">${raw(chOpt("airbnb", "Airbnb") + chOpt("booking", "Booking.com") + chOpt("direct", "直販") + chOpt("other", "その他"))}</select>
      <label>総額（円・税送料込みの受取額）</label>
      <input type="number" name="total_amount" min="0" value="${v(r?.total_amount)}">
      <label>清掃料（円・ADRは総額−清掃料で算出）</label>
      <input type="number" name="cleaning_fee" min="0" value="${v(r?.cleaning_fee)}">
      <label>メモ（任意）</label>
      <input type="text" name="notes" value="${v((r as any)?.notes)}">
      <button class="btn" type="submit">${r ? "更新する" : "作成してリンク発行"}</button>
    </form>
    ${r && r.status !== "cancelled"
      ? html`<form method="post" action="/admin/reservations/${r.id}/cancel" style="margin-top:10px">
          <button class="btn secondary" style="width:auto">この予約を取消にする</button></form>`
      : ""}
  </div>`;
}

function kpi(label: string, value: string, sub?: string): string {
  return `<div class="card" style="margin:0;padding:14px">
    <div class="muted" style="font-size:12px">${label}</div>
    <div style="font-size:22px;font-weight:700">${value}</div>
    ${sub ? `<div class="muted" style="font-size:12px">${sub}</div>` : ""}
  </div>`;
}

export function metricsPage(opts: { nav: HE; m: MonthlyMetrics; ym: string; prevYm: string; nextYm: string }): HE {
  const m = opts.m;
  const occ = (m.occupancy * 100).toFixed(1) + "%";
  const ch = m.byChannel
    .map((c) => `<tr><td>${esc(c.channel)}</td><td>${c.nights}泊</td><td>${yen(c.roomRevenue)}</td></tr>`)
    .join("");
  return html`
  <div class="card">
    ${opts.nav}
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h1 style="margin:0">指標</h1>
      <div style="display:flex;gap:8px;align-items:center">
        <a class="btn secondary" style="width:auto;padding:6px 10px" href="/admin/metrics?ym=${opts.prevYm}">←前月</a>
        <form method="get" action="/admin/metrics" style="margin:0"><input type="month" name="ym" value="${opts.ym}" onchange="this.form.submit()"></form>
        <a class="btn secondary" style="width:auto;padding:6px 10px" href="/admin/metrics?ym=${opts.nextYm}">翌月→</a>
      </div>
    </div>
    <p class="muted">${m.year}年${m.month}月（1棟貸し・月またぎは泊数按分）</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${raw(kpi("ADR（平均室料単価）", yen(m.adr), "室料 ÷ 販売泊数"))}
      ${raw(kpi("稼働率", occ, `${m.bookedNights} / ${m.availableNights} 泊`))}
      ${raw(kpi("RevPAR", yen(m.revpar), "室料 ÷ 在庫泊数"))}
      ${raw(kpi("室料売上", yen(m.roomRevenue), "清掃料を除く"))}
      ${raw(kpi("総売上", yen(m.grossRevenue), "清掃料込み"))}
      ${raw(kpi("予約数 / 平均泊数", `${m.bookings} / ${m.avgLos}`, "当月チェックイン基準"))}
    </div>
    <h2>チャネル別（室料）</h2>
    <table><thead><tr><th>チャネル</th><th>販売泊数</th><th>室料売上</th></tr></thead><tbody>${raw(ch || '<tr><td colspan="3" class="muted">データなし</td></tr>')}</tbody></table>
    <p class="muted" style="margin-top:10px">※ 売上は各予約の「総額・清掃料」入力に基づきます。未入力の予約は0として集計されます。</p>
  </div>`;
}
