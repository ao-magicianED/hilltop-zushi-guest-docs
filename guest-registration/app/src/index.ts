// Hilltop Zushi 宿泊者名簿アプリ — エントリポイント（Workers + Hono）
import { Hono } from "hono";
import { html, raw } from "hono/html";
import type { Env, Lang } from "./types";
import { normalizeLang } from "./types";
import { layout } from "./views/layout";
import { startPage, channelChooserPage, declarePage, progressPage, formPage, messagePage, type StartChannel } from "./views/guest";
import { privacyPolicyPage } from "./views/privacy";
import {
  verifyReservation,
  createGroupToken,
  resolveGroupToken,
  resolveGuestToken,
  getReservation,
  getGuest,
  getGuestsByReservation,
  declareGuests,
  computeProgress,
  appendAudit,
  rateLimit,
  nowIso,
  checkoutExpiry,
  normalizeOtaCode,
  isValidOtaCode,
  validateStayDates,
  findReservationsByOtaCode,
  datesAlign,
  createSelfReportReservation,
  promoteSelfReportRetention,
  hasSubmittedGuests,
  recentSelfReportCount,
  addDays,
  type Guest,
  type Reservation,
} from "./lib/db";
import { encryptField, decryptField, encryptBytes, decryptBytes } from "./lib/crypto";
import { hashToken, sha256Hex, timingSafeEqual, generateToken, newId } from "./lib/tokens";
import { validateGuest, isDomesticJapanese, needsPassportPhoto, SUBMIT_RULE_VERSION, type GuestInput, type FieldErrors } from "./lib/validation";
import { t, optLabel, OCCUPATIONS, NATIONALITIES, GENDERS, CHOOSE_REASONS, STAY_PURPOSES } from "./lib/i18n";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import {
  getAdminByEmail,
  getAdminById,
  listAdmins,
  createAdmin,
  setAdminStatus,
  setAdminTotp,
  setAdminPassword,
  touchLogin,
  verifyPassword,
  createSession,
  getSession,
  destroySession,
  putTemp,
  getTemp,
  delTemp,
  type Session,
  type Admin,
} from "./lib/auth";
import { generateTotpSecret, otpauthURI, verifyTotp } from "./lib/totp";
import { loginPage, totpPage, enrollPage, changePwPage, adminsPage } from "./views/admin_auth";
import { normalizeName, addYears, laterIso } from "./lib/db";
import { computeMonthly, type ResForMetrics } from "./lib/metrics";
import { parseIcal, reservedEvents } from "./lib/ical";
import { reservationsPage, reservationForm, metricsPage, adminNav } from "./views/admin_manage";

const app = new Hono<{ Bindings: Env; Variables: { admin: Session } }>();

function pickLang(c: any, fallback?: string): Lang {
  const q = c.req.query("lang");
  if (q) return normalizeLang(q);
  if (fallback) return normalizeLang(fallback);
  return normalizeLang(c.req.header("accept-language"));
}

function ipHashKey(c: any): string {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
}

// HTMLエスケープ（管理画面など raw 埋め込み箇所のXSS対策）
function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// CSRF軽減：状態変更POSTは同一オリジンのみ許可（Origin/Refererのホスト一致を確認）
app.use("*", async (c, next) => {
  if (c.req.method === "POST") {
    const host = c.req.header("host");
    const origin = c.req.header("origin") ?? c.req.header("referer");
    if (origin) {
      try {
        if (new URL(origin).host !== host) return c.text("Bad origin", 403);
      } catch {
        return c.text("Bad origin", 403);
      }
    }
  }
  await next();
});

// ============ ゲスト動線 ============

app.get("/", (c) => c.redirect(`/start?lang=${pickLang(c)}`));

// プライバシーポリシー（認証不要・多言語）
app.get("/privacy", (c) => {
  const lang = pickLang(c);
  return c.html(layout({ title: t(lang, "privacy_title"), lang, path: "/privacy", body: privacyPolicyPage(lang) }));
});

function parseChannel(raw: string | undefined | null): StartChannel | null {
  return raw === "direct" || raw === "airbnb" || raw === "booking" ? raw : null;
}

// 予約元の選択 → 各チャネルの入口
app.get("/start", (c) => {
  const lang = pickLang(c);
  const channel = parseChannel(c.req.query("channel"));
  if (!channel) {
    return c.html(layout({ title: t(lang, "app_title"), lang, path: "/start", body: channelChooserPage(lang) }));
  }
  // OTAは言語切替(GET再訪)で入力が消えないよう、クエリから値を復元してプレフィル
  const code = c.req.query("code") || undefined;
  const checkIn = c.req.query("check_in") || undefined;
  const checkOut = c.req.query("check_out") || undefined;
  const qs = [
    `channel=${channel}`,
    code ? `code=${encodeURIComponent(code)}` : "",
    checkIn ? `check_in=${encodeURIComponent(checkIn)}` : "",
    checkOut ? `check_out=${encodeURIComponent(checkOut)}` : "",
  ].filter(Boolean).join("&");
  return c.html(layout({ title: t(lang, "app_title"), lang, path: `/start?${qs}`, body: startPage(lang, { channel, code, checkIn, checkOut }) }));
});

app.post("/start", async (c) => {
  const lang = pickLang(c);
  const body = await c.req.parseBody();
  const channel = parseChannel(String(body.channel ?? "")) ?? "direct";
  const path = `/start?channel=${channel}`;
  const ipHash = await hashToken(ipHashKey(c));

  // ハニーポット：見えない罠欄が埋まっていればbotとみなし黙って弾く
  if (String(body.hp_extra ?? "").trim() !== "") {
    return c.html(layout({ title: t(lang, "app_title"), lang, path, body: startPage(lang, { channel, error: t(lang, "verify_failed") }) }));
  }
  if (!(await rateLimit(c.env, `start:${ipHash}`, 10, 600))) {
    return c.html(layout({ title: t(lang, "app_title"), lang, path, body: startPage(lang, { channel, error: t(lang, "too_many") }) }));
  }

  // ---- 直予約：従来どおり 予約番号＋姓で突合 ----
  if (channel === "direct") {
    const code = String(body.code ?? "").trim();
    const lastName = String(body.last_name ?? "").trim();
    const res = await verifyReservation(c.env, code, lastName);
    if (!res) {
      return c.html(layout({ title: t(lang, "app_title"), lang, path, body: startPage(lang, { channel, error: t(lang, "verify_failed"), code }) }));
    }
    const token = await createGroupToken(c.env, res.id, checkoutExpiry(res.check_out_date));
    await appendAudit(c.env, { reservationId: res.id, actorType: "guest", action: "start_verified", detail: { channel }, ipHash });
    return c.redirect(`/g/${token}?lang=${lang}`);
  }

  // ---- OTA(Airbnb/Booking.com)：突合なし。コード＋日付を検証し、安全に合流できる場合のみattach、無ければpending新規 ----
  const rawCode = String(body.code ?? "");
  const code = normalizeOtaCode(rawCode);
  const ci = String(body.check_in ?? "").trim();
  const co = String(body.check_out ?? "").trim();
  if (!isValidOtaCode(code)) {
    return c.html(layout({ title: t(lang, "app_title"), lang, path, body: startPage(lang, { channel, error: t(lang, "err_code_format"), code: rawCode, checkIn: ci, checkOut: co }) }));
  }
  const dv = validateStayDates(ci, co);
  if (!dv.ok) {
    return c.html(layout({ title: t(lang, "app_title"), lang, path, body: startPage(lang, { channel, error: t(lang, "err_dates"), code, checkIn: ci, checkOut: co }) }));
  }

  // 自動合流の対象は「OTA予約(airbnb/booking) かつ 姓保護(match_last_name)なし かつ まだ誰も提出していない」
  // 予約だけに限定する。→ 直予約の姓保護バイパス・既存提出者のPII露出（IDOR）を防ぐ。該当外は pending新規。
  const sameCode = await findReservationsByOtaCode(c.env, code);
  const aligned = sameCode.filter((r) => datesAlign(r, ci, co));
  let attachTarget: Reservation | null = null;
  if (aligned.length === 1) {
    const cand = aligned[0]!;
    const isOta = cand.channel === "airbnb" || cand.channel === "booking";
    if (isOta && !cand.match_last_name && !(await hasSubmittedGuests(c.env, cand.id))) attachTarget = cand;
  }

  let res: Reservation;
  let action: string;
  if (attachTarget) {
    res = attachTarget; // 正規/未提出のOTA予約に合流（売上・正式日程を継承。ゲスト入力日付は不採用）
    action = "ota_attach";
  } else {
    // 新規作成のみ濫用対策を二重化：KVレート制限(1時間5件)＋D1の日次上限(IP単位20件。KVのTOCTOUを補う)
    const tooFast = !(await rateLimit(c.env, `selfreport:${ipHash}`, 5, 3600));
    const overDay = (await recentSelfReportCount(c.env, ipHash, addDays(nowIso(), -1))) >= 20;
    if (tooFast || overDay) {
      return c.html(layout({ title: t(lang, "app_title"), lang, path, body: startPage(lang, { channel, error: t(lang, "too_many"), code, checkIn: ci, checkOut: co }) }));
    }
    res = await createSelfReportReservation(c.env, {
      channel, code, ci, co, nights: dv.nights, lang, propertyName: c.env.PROPERTY_NAME || "Hilltop Zushi",
    });
    action = sameCode.length > 0 ? "ota_selfreport_mismatch" : "ota_selfreport_new";
  }
  const token = await createGroupToken(c.env, res.id, checkoutExpiry(res.check_out_date));
  await appendAudit(c.env, { reservationId: res.id, actorType: "guest", action, detail: { channel, code_match: sameCode.length, aligned: aligned.length, attached: !!attachTarget }, ipHash });
  return c.redirect(`/g/${token}?lang=${lang}`);
});

// グループ入口：未申告なら人数申告、申告済みなら進捗
app.get("/g/:token", async (c) => {
  const token = c.req.param("token");
  const res = await resolveGroupToken(c.env, token);
  const lang = pickLang(c, res?.preferred_lang);
  if (!res) {
    return c.html(layout({ title: t(lang, "app_title"), lang, path: `/g/${token}`, body: messagePage(lang, { title: t(lang, "app_title"), message: t(lang, "expired"), kind: "err" }) }));
  }
  const guests = await getGuestsByReservation(c.env, res.id);
  if (!res.declared_guests || guests.length === 0) {
    return c.html(layout({ title: t(lang, "declare_title"), lang, path: `/g/${token}`, body: declarePage(lang, { token }) }));
  }
  const { done, total } = computeProgress(guests, res.expected_guests);
  return c.html(
    layout({
      title: t(lang, "progress_title"),
      lang,
      path: `/g/${token}`,
      body: [
        progressPage(lang, { groupToken: token, guests: guests.map((g) => ({ slot_no: g.slot_no, full_name: g.full_name, submit_status: g.submit_status, guestId: g.id })), done, total }),
        html`<div class="card"><a class="btn" href="/g/${token}/reveal?lang=${lang}">${t(lang, "share_links")}</a></div>`,
      ],
    })
  );
});

// 人数申告 → 個人リンクを生成して表示
app.post("/g/:token/declare", async (c) => {
  const token = c.req.param("token");
  const res = await resolveGroupToken(c.env, token);
  const lang = pickLang(c, res?.preferred_lang);
  if (!res) return c.html(layout({ title: t(lang, "app_title"), lang, path: `/g/${token}`, body: messagePage(lang, { title: t(lang, "app_title"), message: t(lang, "expired"), kind: "err" }) }));
  if (!(await rateLimit(c.env, `declare:${await hashToken(ipHashKey(c))}`, 20, 600))) {
    return c.html(layout({ title: t(lang, "declare_title"), lang, path: `/g/${token}`, body: declarePage(lang, { token, error: t(lang, "too_many") }) }));
  }

  const existing = await getGuestsByReservation(c.env, res.id);
  if (existing.length > 0) return c.redirect(`/g/${token}?lang=${lang}`);

  const body = await c.req.parseBody();
  const count = parseInt(String(body.count ?? "0"), 10);
  if (!count || count < 1 || count > 12) {
    return c.html(layout({ title: t(lang, "declare_title"), lang, path: `/g/${token}`, body: declarePage(lang, { token, error: t(lang, "fix_errors") }) }));
  }
  const created = await declareGuests(c.env, res, count);
  await appendAudit(c.env, { reservationId: res.id, actorType: "guest", action: "declare_guests", detail: { count } });
  return c.html(layout({ title: t(lang, "share_links"), lang, path: `/g/${token}`, body: linksPage(lang, c.env.APP_BASE_URL, token, created) }));
});

// 個人リンクの再表示（未提出ぶんはトークンを再発行）
// 注意：発行済みの生トークンはハッシュ化されサーバ側に残らないため「同じリンクを再表示」はできない。
// 過去に共有したリンクを無効化すると、同行者が先に受け取ったリンクが使えなくなる（再共有のたびに壊れる）ため、
// 既存トークンは失効させず、新しいトークンを追加発行するだけにする（旧リンクも新リンクもチェックアウトまで両方有効）。
app.get("/g/:token/reveal", async (c) => {
  const token = c.req.param("token");
  const res = await resolveGroupToken(c.env, token);
  const lang = pickLang(c, res?.preferred_lang);
  if (!res) return c.html(layout({ title: t(lang, "app_title"), lang, path: `/g/${token}`, body: messagePage(lang, { title: t(lang, "app_title"), message: t(lang, "expired"), kind: "err" }) }));
  if (!(await rateLimit(c.env, `reveal:${await hashToken(ipHashKey(c))}`, 20, 600))) {
    return c.html(layout({ title: t(lang, "app_title"), lang, path: `/g/${token}`, body: messagePage(lang, { title: t(lang, "app_title"), message: t(lang, "too_many"), kind: "err" }) }));
  }
  const guests = await getGuestsByReservation(c.env, res.id);
  const out: { guestId: string; slotNo: number; role: string; token: string }[] = [];
  const exp = checkoutExpiry(res.check_out_date);
  for (const g of guests) {
    // 提出済みゲストはトークンを発行しない（再発行リンクで他人のPII閲覧・上書きを防ぐ）
    if (g.submit_status === "submitted") continue;
    const tk = generateToken();
    const th = await hashToken(tk);
    await c.env.DB.prepare("INSERT INTO guest_tokens (id, guest_id, token_hash, expires_at, created_at) VALUES (?,?,?,?,?)").bind(newId("pt_"), g.id, th, exp, nowIso()).run();
    out.push({ guestId: g.id, slotNo: g.slot_no, role: g.member_role, token: tk });
  }
  await appendAudit(c.env, { reservationId: res.id, actorType: "guest", action: "reveal_links", detail: { count: out.length }, ipHash: await hashToken(ipHashKey(c)) });
  return c.html(layout({ title: t(lang, "share_links"), lang, path: `/g/${token}/reveal`, body: linksPage(lang, c.env.APP_BASE_URL, token, out) }));
});

// 進捗ページから未提出ゲスト1名の編集ページへ：クリック時にその場で新しい個人トークンを発行して
// リダイレクトする（生の個人トークンはハッシュ化保存で復元不可なための設計。revealと同じ考え方だが
// 対象を1名に絞りオンデマンド発行）。提出済みゲストは対象外（第三者による他人PIIの再オープンを
// 防ぐ、revealと同じ安全策）。guestIdは必ずこの予約に属するか検証しクロスIDORを防ぐ。
app.get("/g/:token/edit/:guestId", async (c) => {
  const token = c.req.param("token");
  const guestId = c.req.param("guestId");
  const res = await resolveGroupToken(c.env, token);
  const lang = pickLang(c, res?.preferred_lang);
  if (!res) return c.html(layout({ title: t(lang, "app_title"), lang, path: `/g/${token}`, body: messagePage(lang, { title: t(lang, "app_title"), message: t(lang, "expired"), kind: "err" }) }));
  if (!(await rateLimit(c.env, `groupedit:${await hashToken(ipHashKey(c))}`, 30, 600))) {
    return c.html(layout({ title: t(lang, "app_title"), lang, path: `/g/${token}`, body: messagePage(lang, { title: t(lang, "app_title"), message: t(lang, "too_many"), kind: "err" }) }));
  }
  const guest = await getGuest(c.env, guestId);
  if (!guest || guest.reservation_id !== res.id || guest.submit_status === "submitted") {
    return c.redirect(`/g/${token}?lang=${lang}`);
  }
  const tk = generateToken();
  const th = await hashToken(tk);
  await c.env.DB.prepare("INSERT INTO guest_tokens (id, guest_id, token_hash, expires_at, created_at) VALUES (?,?,?,?,?)").bind(newId("pt_"), guest.id, th, checkoutExpiry(res.check_out_date), nowIso()).run();
  await appendAudit(c.env, { reservationId: res.id, guestId: guest.id, actorType: "guest", action: "edit_link_minted", ipHash: await hashToken(ipHashKey(c)) });
  return c.redirect(`/p/${tk}?lang=${lang}`);
});

function linksPage(lang: Lang, base: string, groupToken: string, created: { slotNo: number; role: string; token: string }[]) {
  const rows = created
    .map((x) => {
      const url = `${base}/p/${x.token}?lang=${lang}`;
      const who = x.role === "representative" ? `👑 ${t(lang, "representative_label")}` : `#${x.slotNo}`;
      return `<li><span>${who}</span><a class="muted" href="${url}">${t(lang, "edit_link")}</a></li>`;
    })
    .join("");
  return html`
  <div class="card">
    <h1>${t(lang, "share_links")}</h1>
    <p class="muted">${t(lang, "links_note")}</p>
    <ul class="list">${raw(rows)}</ul>
    <a class="btn secondary" href="/g/${groupToken}?lang=${lang}">← ${t(lang, "progress_title")}</a>
  </div>`;
}

// 個人トークンから進捗ページへ戻る導線。生のグループトークンはハッシュ化され保存されていないため
// 復元できない → その場で新しいグループトークンを発行してリダイレクトする（個人トークンを知っている
// ＝本人性は既に確認済みなので、追加認証なしで許容。乱発防止に軽くレート制限のみ掛ける）。
app.get("/p/:token/back-to-group", async (c) => {
  const token = c.req.param("token");
  const guest = await resolveGuestToken(c.env, token);
  const lang = pickLang(c);
  if (!guest) return c.html(layout({ title: t(lang, "app_title"), lang, path: `/p/${token}`, body: messagePage(lang, { title: t(lang, "app_title"), message: t(lang, "expired"), kind: "err" }) }));
  if (!(await rateLimit(c.env, `backgroup:${await hashToken(ipHashKey(c))}`, 30, 600))) {
    return c.html(layout({ title: t(lang, "app_title"), lang, path: `/p/${token}`, body: messagePage(lang, { title: t(lang, "app_title"), message: t(lang, "too_many"), kind: "err" }) }));
  }
  const res = await getReservation(c.env, guest.reservation_id);
  if (!res) return c.html(layout({ title: t(lang, "app_title"), lang, path: `/p/${token}`, body: messagePage(lang, { title: t(lang, "app_title"), message: t(lang, "expired"), kind: "err" }) }));
  const gtoken = await createGroupToken(c.env, res.id, checkoutExpiry(res.check_out_date));
  return c.redirect(`/g/${gtoken}?lang=${lang}`);
});

// 個人入力フォーム（GET）
app.get("/p/:token", async (c) => {
  const token = c.req.param("token");
  const guest = await resolveGuestToken(c.env, token);
  const lang = pickLang(c);
  if (!guest) return c.html(layout({ title: t(lang, "app_title"), lang, path: `/p/${token}`, body: messagePage(lang, { title: t(lang, "app_title"), message: t(lang, "expired"), kind: "err" }) }));

  // 自分のデータのみ復号して prefill
  const values: Record<string, string> = {
    full_name: guest.full_name ?? "",
    has_jp_address: guest.has_jp_address == null ? "" : String(guest.has_jp_address),
    address: (await decryptField(c.env.MASTER_KEY, guest.address_enc)) ?? "",
    nationality: guest.nationality ?? "",
    nationality_other: guest.nationality_other ?? "",
    occupation: guest.occupation ?? "",
    age: guest.age == null ? "" : String(guest.age),
    gender: guest.gender ?? "",
    phone: (await decryptField(c.env.MASTER_KEY, guest.phone_enc)) ?? "",
    prev_stay: guest.prev_stay ?? "",
    next_stay: guest.next_stay ?? "",
    email: guest.email ?? "",
    choose_reason_other: guest.choose_reason_other ?? "",
    choose_reason: guest.choose_reason ?? "",
    stay_purpose: guest.stay_purpose ?? "",
    stay_purpose_other: guest.stay_purpose_other ?? "",
  };
  const groupBackHref = `/p/${token}/back-to-group?lang=${lang}`;
  const savedNotice = c.req.query("saved") === "1";
  const imgWarnNotice = c.req.query("imgwarn") === "1";
  const bucketInput = { nationality: values.nationality ?? "", has_jp_address: values.has_jp_address ?? "" };
  const showPassport = needsPassportPhoto(bucketInput);
  const showStayPurpose = isDomesticJapanese(bucketInput);
  return c.html(layout({
    title: t(lang, "form_title"), lang, path: `/p/${token}`,
    body: formPage(lang, {
      token, guest, isRep: guest.member_role === "representative", values, groupBackHref,
      marketingOptin: !!guest.marketing_optin, savedNotice, imgWarnNotice, showPassport, showStayPurpose,
    }),
  }));
});

// 個人入力フォーム（POST）
app.post("/p/:token", async (c) => {
  const token = c.req.param("token");
  const guest = await resolveGuestToken(c.env, token);
  const lang = pickLang(c);
  if (!guest) return c.html(layout({ title: t(lang, "app_title"), lang, path: `/p/${token}`, body: messagePage(lang, { title: t(lang, "app_title"), message: t(lang, "expired"), kind: "err" }) }));
  if (!(await rateLimit(c.env, `submit:${await hashToken(ipHashKey(c))}`, 40, 600))) {
    return c.html(layout({ title: t(lang, "app_title"), lang, path: `/p/${token}`, body: messagePage(lang, { title: t(lang, "app_title"), message: t(lang, "too_many"), kind: "err" }) }));
  }
  const resv = await getReservation(c.env, guest.reservation_id);

  const form = await c.req.formData();
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const fileEntry = form.get("passport_img");
  const file: File | null = fileEntry && typeof fileEntry !== "string" ? (fileEntry as File) : null;

  const input: GuestInput = {
    member_role: guest.member_role,
    full_name: get("full_name"),
    has_jp_address: get("has_jp_address"),
    address: get("address"),
    nationality: get("nationality"),
    nationality_other: get("nationality_other"),
    has_passport_img: Boolean(guest.passport_img_key) || !!(file && file.size > 0),
    occupation: get("occupation"),
    age: get("age"),
    gender: get("gender"),
    phone: get("phone"),
    email: get("email"),
    prev_stay: get("prev_stay"),
    stay_purpose: get("stay_purpose"),
    stay_purpose_other: get("stay_purpose_other"),
    marketing_optin: form.get("marketing_optin") === "1",
  };

  // 同意（必須）チェック
  const consentPrivacy = form.get("consent_privacy") === "1";
  const consentCross = form.get("consent_cross_border") === "1";

  const { ok, errors } = validateGuest(input);
  const consentOk = consentPrivacy && consentCross;

  // 画像アップロード処理（あれば）
  let imgInfo: { key: string; mime: string; size: number } | null = null;
  if (file && file.size > 0) {
    const res = await handlePassportUpload(c.env, guest.id, file);
    if (!res.ok) {
      return renderFormError(c, lang, token, guest, input, errors, res.error, true, {
        next_stay: get("next_stay"),
        choose_reason_other: get("choose_reason_other"),
      });
    }
    imgInfo = res.info;
  }

  if (!ok || !consentOk) {
    const banner = !consentOk ? t(lang, "consent_required") : undefined;
    return renderFormError(c, lang, token, guest, input, errors, banner, true, {
      next_stay: get("next_stay"),
      choose_reason_other: get("choose_reason_other"),
    });
  }

  // 暗号化して保存
  const now = nowIso();
  const addressEnc = await encryptField(c.env.MASTER_KEY, input.address);
  const phoneEnc = await encryptField(c.env.MASTER_KEY, input.phone);
  // choose_reason は許可リストに含まれる値だけを保存（不正値を排除）
  const allowedReasons = new Set(CHOOSE_REASONS.map((r) => r.code));
  const chooseReasons = form.getAll("choose_reason").map(String).filter((x) => allowedReasons.has(x));
  const isRep = guest.member_role === "representative";
  const chooseReasonJson = isRep && chooseReasons.length ? JSON.stringify(chooseReasons) : null;
  const chooseReasonOther = isRep ? get("choose_reason_other") || null : null;
  // 利用用途はchoose_reasonと同じ「代表者かつ日本国籍・国内住所ありのみのグループ設問」。
  // 表示条件(showStayPurpose)と保存条件を一致させる＝isRep単独ではなくisDomesticJapaneseも必須にし、
  // 対象外の代表者(外国籍等)が改ざん送信しても混入しないようガードする。許可リストで不正値も排除。
  const allowedPurposes = new Set(STAY_PURPOSES.map((p) => p.code));
  const stayPurposeAllowed = isRep && isDomesticJapanese(input) && allowedPurposes.has(input.stay_purpose);
  const stayPurpose = stayPurposeAllowed ? input.stay_purpose : null;
  const stayPurposeOther = stayPurpose === "other" ? input.stay_purpose_other || null : null;
  const marketing = form.get("marketing_optin") === "1" ? 1 : 0;
  // 前泊地・後泊地は日本国籍の場合は項目自体を出していない（独自ルール）。改ざん送信で値が来ても
  // 表示条件と保存内容を一致させるため、非表示対象（日本国籍）なら保存時に強制的にnull化する。
  const needsStayHistory = needsPassportPhoto(input);
  const prevStayToSave = needsStayHistory ? input.prev_stay || null : null;
  const nextStayToSave = needsStayHistory ? get("next_stay") || null : null;

  // 画像カラムは「新規アップロードがあれば更新、なければ既存値を維持」（静的SQLでbindズレを防止）
  const imgKey = imgInfo?.key ?? guest.passport_img_key;
  const imgMime = imgInfo?.mime ?? guest.passport_img_mime;
  const imgSize = imgInfo?.size ?? guest.passport_img_size;
  const imgUploadedAt = imgInfo ? now : guest.passport_img_uploaded_at;

  // 旅券番号は独自ルールで収集廃止（passport_no_encはSETから除外＝既存の過去データを再送信で消さない）
  await c.env.DB.prepare(
    `UPDATE guests SET
      full_name=?, has_jp_address=?, address_enc=?, nationality=?, nationality_other=?,
      occupation=?, age=?, gender=?, phone_enc=?, prev_stay=?, next_stay=?, email=?,
      choose_reason=?, choose_reason_other=?, stay_purpose=?, stay_purpose_other=?,
      marketing_optin=?, marketing_optin_at=?,
      passport_img_key=?, passport_img_mime=?, passport_img_size=?, passport_img_uploaded_at=?,
      submit_status='submitted', submitted_at=?, submit_rule_version=?,
      consent_at=?, consent_lang=?, consent_privacy=?, consent_cross_border=?, updated_at=?
     WHERE id=?`
  )
    .bind(
      input.full_name,
      parseInt(input.has_jp_address, 10),
      addressEnc,
      input.nationality,
      input.nationality_other || null,
      input.occupation,
      input.age.trim() ? parseInt(input.age, 10) : null,
      input.gender || null,
      phoneEnc,
      prevStayToSave,
      nextStayToSave,
      input.email || null,
      chooseReasonJson,
      chooseReasonOther,
      stayPurpose,
      stayPurposeOther,
      marketing,
      marketing ? now : null,
      imgKey,
      imgMime,
      imgSize,
      imgUploadedAt,
      now,
      SUBMIT_RULE_VERSION,
      now,
      lang,
      consentPrivacy ? 1 : 0,
      consentCross ? 1 : 0,
      now,
      guest.id
    )
    .run();

  await appendAudit(c.env, { reservationId: guest.reservation_id, guestId: guest.id, actorType: "guest", action: "guest_submitted", detail: { slot: guest.slot_no, marketing } });

  // 自己申告pendingは「名簿提出済み」になった時点で法定保持(5年)へ昇格（30日短期purchから移行）
  if (resv && resv.source === "guest_selfreport") {
    await promoteSelfReportRetention(c.env, resv, parseInt(c.env.DATA_RETENTION_YEARS || "5", 10));
  }

  return c.html(layout({
    title: t(lang, "submitted_ok"), lang, path: `/p/${token}`,
    body: messagePage(lang, {
      title: t(lang, "app_title"), message: t(lang, "submitted_ok"), kind: "ok",
      backHref: `/p/${token}?lang=${lang}`, backLabel: t(lang, "edit_link"),
      secondaryHref: `/p/${token}/back-to-group?lang=${lang}`, secondaryLabel: t(lang, "progress_title"),
    }),
  }));
});

// 一時保存（下書き）：必須項目や同意チェックを求めず、入力済みの分だけをそのまま保存する。
// キャッシュ削除・機種変更・タブを閉じても、次に同じ個人リンクを開けば続きから入力できるようにするため。
app.post("/p/:token/draft", async (c) => {
  const token = c.req.param("token");
  const guest = await resolveGuestToken(c.env, token);
  const lang = pickLang(c);
  if (!guest) return c.html(layout({ title: t(lang, "app_title"), lang, path: `/p/${token}`, body: messagePage(lang, { title: t(lang, "app_title"), message: t(lang, "expired"), kind: "err" }) }));
  if (!(await rateLimit(c.env, `draft:${await hashToken(ipHashKey(c))}`, 40, 600))) {
    return c.html(layout({ title: t(lang, "app_title"), lang, path: `/p/${token}`, body: messagePage(lang, { title: t(lang, "app_title"), message: t(lang, "too_many"), kind: "err" }) }));
  }
  // 提出済みは一時保存の対象外（このボタン自体を表示していないが、直POSTされた場合の防御）
  if (guest.submit_status === "submitted") return c.redirect(`/p/${token}?lang=${lang}`);

  const form = await c.req.formData();
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const getOrNull = (k: string) => { const v = get(k); return v ? v : null; };
  const getIntOrNull = (k: string) => { const n = parseInt(get(k), 10); return Number.isNaN(n) ? null : n; };
  const fileEntry = form.get("passport_img");
  const file: File | null = fileEntry && typeof fileEntry !== "string" ? (fileEntry as File) : null;

  // 画像は失敗しても他項目の保存は止めない（下書きは「入力済みの分だけ守る」ための機能のため）
  let imgInfo: { key: string; mime: string; size: number } | null = null;
  let imgFailed = false;
  if (file && file.size > 0) {
    const res = await handlePassportUpload(c.env, guest.id, file);
    if (res.ok) imgInfo = res.info; else imgFailed = true;
  }
  const imgKey = imgInfo?.key ?? guest.passport_img_key;
  const imgMime = imgInfo?.mime ?? guest.passport_img_mime;
  const imgSize = imgInfo?.size ?? guest.passport_img_size;
  const imgUploadedAt = imgInfo ? nowIso() : guest.passport_img_uploaded_at;

  const isRep = guest.member_role === "representative";
  const allowedReasons = new Set(CHOOSE_REASONS.map((r) => r.code));
  const chooseReasons = form.getAll("choose_reason").map(String).filter((x) => allowedReasons.has(x));
  const chooseReasonJson = isRep && chooseReasons.length ? JSON.stringify(chooseReasons) : null;
  const chooseReasonOther = isRep ? getOrNull("choose_reason_other") : null;
  // 利用用途は「代表者かつ日本国籍・国内住所あり」のみのグループ設問（表示条件と保存条件を一致させ、
  // 対象外の代表者からの改ざん送信での混入を防ぐ。choose_reasonと同様、同行者からの直接POSTも防止）
  const allowedPurposes = new Set(STAY_PURPOSES.map((p) => p.code));
  const rawPurpose = get("stay_purpose");
  const purposeDomestic = isDomesticJapanese({ nationality: get("nationality"), has_jp_address: get("has_jp_address") });
  const stayPurpose = isRep && purposeDomestic && allowedPurposes.has(rawPurpose) ? rawPurpose : null;
  const stayPurposeOther = stayPurpose === "other" ? getOrNull("stay_purpose_other") : null;
  const marketing = form.get("marketing_optin") === "1" ? 1 : 0;
  const now = nowIso();
  // 前泊地・後泊地は日本国籍なら項目自体を出していない（独自ルール）。改ざん送信で値が来ても
  // 表示条件と保存内容を一致させるため、非表示対象（日本国籍）なら保存時に強制的にnull化する。
  const needsStayHistory = needsPassportPhoto({ nationality: get("nationality") });
  const prevStayToSave = needsStayHistory ? getOrNull("prev_stay") : null;
  const nextStayToSave = needsStayHistory ? getOrNull("next_stay") : null;

  // 旅券番号は独自ルールで収集廃止（passport_no_encはSETから除外＝既存の過去データを消さない）
  await c.env.DB.prepare(
    `UPDATE guests SET
      full_name=?, has_jp_address=?, address_enc=?, nationality=?, nationality_other=?,
      occupation=?, age=?, gender=?, phone_enc=?, prev_stay=?, next_stay=?, email=?,
      choose_reason=?, choose_reason_other=?, stay_purpose=?, stay_purpose_other=?, marketing_optin=?,
      passport_img_key=?, passport_img_mime=?, passport_img_size=?, passport_img_uploaded_at=?, updated_at=?
     WHERE id=? AND submit_status != 'submitted'`
  )
    .bind(
      getOrNull("full_name"),
      get("has_jp_address") === "1" ? 1 : get("has_jp_address") === "0" ? 0 : null,
      await encryptField(c.env.MASTER_KEY, getOrNull("address")),
      getOrNull("nationality"),
      getOrNull("nationality_other"),
      getOrNull("occupation"),
      getIntOrNull("age"),
      getOrNull("gender"),
      await encryptField(c.env.MASTER_KEY, getOrNull("phone")),
      prevStayToSave,
      nextStayToSave,
      getOrNull("email"),
      chooseReasonJson,
      chooseReasonOther,
      stayPurpose,
      stayPurposeOther,
      marketing,
      imgKey,
      imgMime,
      imgSize,
      imgUploadedAt,
      now,
      guest.id
    )
    .run();

  await appendAudit(c.env, { reservationId: guest.reservation_id, guestId: guest.id, actorType: "guest", action: "guest_draft_saved", detail: { slot: guest.slot_no } });
  return c.redirect(`/p/${token}?lang=${lang}&saved=1${imgFailed ? "&imgwarn=1" : ""}`);
});

function renderFormError(
  c: any,
  lang: Lang,
  token: string,
  guest: Guest,
  input: GuestInput,
  errors: FieldErrors,
  banner?: string,
  showBanner = true,
  extra: { next_stay?: string; choose_reason_other?: string } = {}
) {
  const values: Record<string, string> = {
    full_name: input.full_name,
    has_jp_address: input.has_jp_address,
    address: input.address,
    nationality: input.nationality,
    nationality_other: input.nationality_other,
    occupation: input.occupation,
    age: input.age,
    gender: input.gender,
    phone: input.phone,
    email: input.email,
    prev_stay: input.prev_stay,
    next_stay: extra.next_stay ?? "",
    choose_reason_other: extra.choose_reason_other ?? "",
    stay_purpose: input.stay_purpose,
    stay_purpose_other: input.stay_purpose_other,
  };
  const showPassport = needsPassportPhoto({ nationality: input.nationality });
  const showStayPurpose = isDomesticJapanese({ nationality: input.nationality, has_jp_address: input.has_jp_address });
  const body = [
    banner ? html`<div class="card"><div class="notice err">${banner}</div></div>` : html``,
    formPage(lang, { token, guest, isRep: guest.member_role === "representative", values, errors, showErrorBanner: showBanner, groupBackHref: `/p/${token}/back-to-group?lang=${lang}`, showPassport, showStayPurpose, marketingOptin: input.marketing_optin }),
  ];
  return c.html(layout({ title: t(lang, "form_title"), lang, path: `/p/${token}`, body }));
}

// パスポート画像：検証→暗号化→本番R2へ保存（MVPはWorker仲介。直PUT＋再エンコードは将来の堅牢化）
async function handlePassportUpload(
  env: Env,
  guestId: string,
  file: File
): Promise<{ ok: true; info: { key: string; mime: string; size: number } } | { ok: false; error: string }> {
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: "画像は10MB以内にしてください / Image must be ≤10MB" };
  const buf = new Uint8Array(await file.arrayBuffer());
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (!isJpeg && !isPng) return { ok: false, error: "JPEG/PNG画像のみ対応しています / JPEG or PNG only" };
  const mime = isJpeg ? "image/jpeg" : "image/png";
  // TODO(堅牢化): R2有効化後に「署名直PUT＋再エンコードでポリグロット/EXIF除去」へ移行（設計 B-1/B-2）
  const enc = await encryptBytes(env.MASTER_KEY, buf);
  const key = `img:${guestId}:${generateToken(8)}`;
  // MVP: 暗号化済み画像をKVに保存（R2未有効化のため）
  await env.KV.put(key, enc, { metadata: { mime } });
  return { ok: true, info: { key, mime, size: file.size } };
}

// ============ 管理画面：認証（複数管理者・TOTP 2FA・KVセッション）============
const COOKIE = "hz_admin";
function cookieOpts(c: any) {
  const https = new URL(c.req.url).protocol === "https:";
  return { httpOnly: true, secure: https, sameSite: "Lax" as const, path: "/admin", maxAge: 8 * 3600 };
}
// 認証不要の管理パス
const PUBLIC_ADMIN = new Set(["/admin/login", "/admin/2fa", "/admin/enroll"]);

const adminAuth = async (c: any, next: any) => {
  const path = new URL(c.req.url).pathname;
  if (PUBLIC_ADMIN.has(path)) return next();
  const sess = await getSession(c.env, getCookie(c, COOKIE));
  if (!sess) return c.redirect("/admin/login");
  c.set("admin", sess);
  const a = await getAdminById(c.env, sess.adminId);
  if (!a || a.status !== "active") {
    await destroySession(c.env, getCookie(c, COOKIE));
    return c.redirect("/admin/login");
  }
  if (a.must_change_pw && path !== "/admin/change-pw") return c.redirect("/admin/change-pw");
  await next();
};
app.use("/admin", adminAuth);
app.use("/admin/*", adminAuth);

async function finalizeLogin(c: any, admin: Admin) {
  await touchLogin(c.env, admin.id);
  const token = await createSession(c.env, admin);
  setCookie(c, COOKIE, token, cookieOpts(c));
  await appendAudit(c.env, { actorType: "admin", actorId: admin.email, action: "login" });
  const fresh = await getAdminById(c.env, admin.id);
  return c.redirect(fresh?.must_change_pw ? "/admin/change-pw" : "/admin");
}

function authView(c: any, title: string, body: any) {
  return c.html(layout({ title, lang: "ja", path: new URL(c.req.url).pathname, showLangs: false, body }));
}

app.get("/admin/login", (c) => authView(c, "管理ログイン", loginPage({})));
app.post("/admin/login", async (c) => {
  const body = await c.req.parseBody();
  const email = String(body.email ?? "");
  const password = String(body.password ?? "");
  const ipk = await hashToken((c.req.header("cf-connecting-ip") ?? "x") + ":" + email.toLowerCase());
  if (!(await rateLimit(c.env, `login:${ipk}`, 8, 600))) {
    return authView(c, "管理ログイン", loginPage({ error: "試行回数が多すぎます。しばらくお待ちください。" }));
  }
  // 古い一時トークン（前回の登録/2FA待ち）を掃除（奪取・再利用防止）
  await delTemp(c.env, "enroll", getCookie(c, "hz_enroll"));
  await delTemp(c.env, "p2fa", getCookie(c, "hz_2fa"));
  const admin = await getAdminByEmail(c.env, email);
  const okPw =
    !!admin &&
    admin.status === "active" &&
    (await verifyPassword(password, admin.password_hash, admin.password_salt, admin.password_iter));
  if (!admin || !okPw) {
    return authView(c, "管理ログイン", loginPage({ error: "メールアドレスまたはパスワードが違います。" }));
  }
  if (admin.totp_enabled && admin.totp_secret) {
    const tok = await putTemp(c.env, "p2fa", { adminId: admin.id }, 300);
    setCookie(c, "hz_2fa", tok, { ...cookieOpts(c), maxAge: 300 });
    return c.redirect("/admin/2fa");
  }
  const secret = generateTotpSecret();
  const tok = await putTemp(c.env, "enroll", { adminId: admin.id, secret }, 600);
  setCookie(c, "hz_enroll", tok, { ...cookieOpts(c), maxAge: 600 });
  return c.redirect("/admin/enroll");
});

app.get("/admin/2fa", (c) => authView(c, "2段階認証", totpPage({})));
app.post("/admin/2fa", async (c) => {
  const tok = getCookie(c, "hz_2fa");
  const pending = await getTemp<{ adminId: string }>(c.env, "p2fa", tok);
  if (!pending) {
    deleteCookie(c, "hz_2fa", { path: "/admin" }); // 期限切れCookieを掃除
    return c.redirect("/admin/login");
  }
  const admin = await getAdminById(c.env, pending.adminId);
  const body = await c.req.parseBody();
  const code = String(body.code ?? "").replace(/\s+/g, "");
  // 同一コードの再利用（リプレイ）を防ぐ
  const usedKey = `totp_used:${pending.adminId}:${code}`;
  const reused = await c.env.KV.get(usedKey);
  if (!admin || !admin.totp_secret || reused || !(await verifyTotp(admin.totp_secret, code))) {
    return authView(c, "2段階認証", totpPage({ error: "コードが正しくありません。" }));
  }
  await c.env.KV.put(usedKey, "1", { expirationTtl: 90 });
  await delTemp(c.env, "p2fa", tok);
  deleteCookie(c, "hz_2fa", { path: "/admin" });
  return finalizeLogin(c, admin);
});

app.get("/admin/enroll", async (c) => {
  const tok = getCookie(c, "hz_enroll");
  const pending = await getTemp<{ adminId: string; secret: string }>(c.env, "enroll", tok);
  if (!pending) return c.redirect("/admin/login");
  const admin = await getAdminById(c.env, pending.adminId);
  if (!admin) return c.redirect("/admin/login");
  if (admin.totp_enabled && admin.totp_secret) return c.redirect("/admin/login"); // 既存TOTPの上書き防止
  return authView(c, "2段階認証の設定", enrollPage({ secret: pending.secret, uri: otpauthURI(pending.secret, admin.email) }));
});
app.post("/admin/enroll", async (c) => {
  const tok = getCookie(c, "hz_enroll");
  const pending = await getTemp<{ adminId: string; secret: string }>(c.env, "enroll", tok);
  if (!pending) return c.redirect("/admin/login");
  const admin = await getAdminById(c.env, pending.adminId);
  if (!admin) return c.redirect("/admin/login");
  if (admin.totp_enabled && admin.totp_secret) return c.redirect("/admin/login"); // 既存TOTPの上書き防止
  const body = await c.req.parseBody();
  if (!(await verifyTotp(pending.secret, String(body.code ?? "")))) {
    return authView(c, "2段階認証の設定", enrollPage({ secret: pending.secret, uri: otpauthURI(pending.secret, admin.email), error: "コードが正しくありません。アプリの時刻設定をご確認ください。" }));
  }
  await setAdminTotp(c.env, admin.id, pending.secret);
  await delTemp(c.env, "enroll", tok);
  deleteCookie(c, "hz_enroll", { path: "/admin" });
  return finalizeLogin(c, { ...admin, totp_enabled: 1, totp_secret: pending.secret });
});

app.get("/admin/change-pw", (c) => authView(c, "パスワード変更", changePwPage({})));
app.post("/admin/change-pw", async (c) => {
  const sess = c.get("admin");
  const body = await c.req.parseBody();
  const p1 = String(body.password ?? "");
  const p2 = String(body.password2 ?? "");
  if (p1.length < 8 || p1 !== p2) {
    return authView(c, "パスワード変更", changePwPage({ error: "8文字以上で、確認欄と一致させてください。" }));
  }
  await setAdminPassword(c.env, sess.adminId, p1, false);
  await appendAudit(c.env, { actorType: "admin", actorId: sess.email, action: "change_password" });
  return c.redirect("/admin");
});

app.get("/admin/logout", async (c) => {
  await destroySession(c.env, getCookie(c, COOKIE));
  deleteCookie(c, COOKIE, { path: "/admin" });
  deleteCookie(c, "hz_2fa", { path: "/admin" });
  deleteCookie(c, "hz_enroll", { path: "/admin" });
  return c.redirect("/admin/login");
});

// 管理者の管理（マスター専用）
app.get("/admin/admins", async (c) => {
  const sess = c.get("admin");
  if (!sess.isMaster) return c.text("権限がありません", 403);
  const admins = await listAdmins(c.env);
  const msg = c.req.query("msg");
  const flash =
    msg === "self" ? "自分自身は無効化できません。" : msg === "lastmaster" ? "最後のマスター管理者は無効化できません。" : undefined;
  return authView(c, "管理者の管理", adminsPage({ admins, meEmail: sess.email, flash }));
});
app.post("/admin/admins", async (c) => {
  const sess = c.get("admin");
  if (!sess.isMaster) return c.text("権限がありません", 403);
  const body = await c.req.parseBody();
  const email = String(body.email ?? "").trim();
  const isMaster = body.is_master === "1";
  const admins0 = await listAdmins(c.env);
  if (!email.includes("@")) {
    return authView(c, "管理者の管理", adminsPage({ admins: admins0, meEmail: sess.email, flash: "有効なメールアドレスを入力してください。" }));
  }
  if (await getAdminByEmail(c.env, email)) {
    return authView(c, "管理者の管理", adminsPage({ admins: admins0, meEmail: sess.email, flash: "そのメールは既に登録されています。" }));
  }
  const tempPw = generateToken(12);
  await createAdmin(c.env, { email, password: tempPw, isMaster, createdBy: sess.email, mustChangePw: true });
  await appendAudit(c.env, { actorType: "admin", actorId: sess.email, action: "add_admin", detail: { email, isMaster } });
  const admins = await listAdmins(c.env);
  return authView(c, "管理者の管理", adminsPage({ admins, meEmail: sess.email, flash: "管理者を追加しました。", tempCred: { email, password: tempPw } }));
});
app.post("/admin/admins/:id/disable", async (c) => {
  const sess = c.get("admin");
  if (!sess.isMaster) return c.text("権限がありません", 403);
  const id = c.req.param("id");
  if (id === sess.adminId) return c.redirect("/admin/admins?msg=self");
  const target = await getAdminById(c.env, id);
  if (target?.is_master) {
    const r = await c.env.DB.prepare(
      "SELECT count(*) AS c FROM admins WHERE is_master=1 AND status='active' AND id != ?"
    ).bind(id).first<{ c: number }>();
    if ((r?.c ?? 0) < 1) return c.redirect("/admin/admins?msg=lastmaster");
  }
  await setAdminStatus(c.env, id, "disabled");
  await appendAudit(c.env, { actorType: "admin", actorId: sess.email, action: "disable_admin", detail: { id } });
  return c.redirect("/admin/admins");
});
app.post("/admin/admins/:id/enable", async (c) => {
  const sess = c.get("admin");
  if (!sess.isMaster) return c.text("権限がありません", 403);
  const id = c.req.param("id");
  await setAdminStatus(c.env, id, "active");
  await appendAudit(c.env, { actorType: "admin", actorId: sess.email, action: "enable_admin", detail: { id } });
  return c.redirect("/admin/admins");
});

// ============ 予約・売上管理 ============
function nights(ci: string, co: string): number {
  return Math.floor((Date.parse(co + "T00:00:00Z") - Date.parse(ci + "T00:00:00Z")) / 86400000);
}
function navFor(c: any, active: string) {
  const s = c.get("admin");
  return adminNav(active, s.isMaster, s.email);
}

app.get("/admin/reservations", async (c) => {
  const rs = (await c.env.DB.prepare("SELECT * FROM reservations ORDER BY check_in_date DESC LIMIT 200").all<any>()).results ?? [];
  const counts = (await c.env.DB.prepare("SELECT reservation_id, SUM(CASE WHEN submit_status='submitted' THEN 1 ELSE 0 END) AS done FROM guests GROUP BY reservation_id").all<{ reservation_id: string; done: number }>()).results ?? [];
  const dmap = new Map(counts.map((x) => [x.reservation_id, x.done]));
  const rows = rs.map((r: any) => ({ ...r, done: dmap.get(r.id) ?? 0 }));
  const flash = c.req.query("flash") || undefined;
  return c.html(layout({ title: "予約・売上管理", lang: "ja", path: "/admin/reservations", showLangs: false, body: reservationsPage({ rows, nav: navFor(c, "res"), flash, icalConfigured: !!c.env.ICAL_URL }) }));
});

app.get("/admin/reservations/new", (c) =>
  c.html(layout({ title: "新規予約", lang: "ja", path: "/admin/reservations/new", showLangs: false, body: reservationForm({ nav: navFor(c, "res") }) }))
);

app.post("/admin/reservations", async (c) => {
  const sess = c.get("admin");
  const b = await c.req.parseBody();
  const ci = String(b.check_in_date ?? "");
  const co = String(b.check_out_date ?? "");
  const n = nights(ci, co);
  if (!ci || !co || n <= 0) {
    return c.html(layout({ title: "新規予約", lang: "ja", path: "/admin/reservations/new", showLangs: false, body: reservationForm({ nav: navFor(c, "res"), error: "チェックイン/アウト日を正しく入力してください（アウトはイン以降）。" }) }));
  }
  const id = newId("r_");
  const now = nowIso();
  const lang = String(b.preferred_lang ?? "ja");
  const expected = parseInt(String(b.expected_guests ?? "0"), 10) || 0;
  const purge = addYears(laterIso(now, co + "T00:00:00Z"), parseInt(c.env.DATA_RETENTION_YEARS || "5", 10));
  await c.env.DB.prepare(
    `INSERT INTO reservations (id, airbnb_reservation_code, property_name, check_in_date, check_out_date, nights, expected_guests, preferred_lang, match_last_name, status, review_status, total_amount, cleaning_fee, currency, channel, source, notes, created_at, updated_at, data_purge_at)
     VALUES (?,?,?,?,?,?,?,?,?, 'open','pending', ?,?, 'JPY', ?, 'manual', ?, ?, ?, ?)`
  ).bind(
    id,
    String(b.airbnb_reservation_code ?? "").trim() ? normalizeOtaCode(String(b.airbnb_reservation_code)) : null,
    c.env.PROPERTY_NAME || "Hilltop Zushi",
    ci, co, n, expected, lang,
    String(b.match_last_name ?? "").trim() ? normalizeName(String(b.match_last_name)) : null,
    parseInt(String(b.total_amount ?? ""), 10) || null,
    parseInt(String(b.cleaning_fee ?? ""), 10) || null,
    String(b.channel ?? "airbnb"),
    String(b.notes ?? "").trim() || null,
    now, now, purge
  ).run();
  await appendAudit(c.env, { reservationId: id, actorType: "admin", actorId: sess.email, action: "create_reservation" });
  const token = await createGroupToken(c.env, id, checkoutExpiry(co));
  const groupUrl = `${c.env.APP_BASE_URL}/g/${token}?lang=${lang}`;
  const res = await getReservation(c.env, id);
  return c.html(layout({ title: "予約を作成", lang: "ja", path: "/admin/reservations", showLangs: false, body: reservationForm({ nav: navFor(c, "res"), res: res!, groupUrl }) }));
});

app.get("/admin/reservations/:id", async (c) => {
  const res = await getReservation(c.env, c.req.param("id"));
  if (!res) return c.notFound();
  return c.html(layout({ title: "予約の編集", lang: "ja", path: `/admin/reservations/${res.id}`, showLangs: false, body: reservationForm({ nav: navFor(c, "res"), res }) }));
});

app.post("/admin/reservations/:id", async (c) => {
  const sess = c.get("admin");
  const id = c.req.param("id");
  const res = await getReservation(c.env, id);
  if (!res) return c.notFound();
  const b = await c.req.parseBody();
  const ci = String(b.check_in_date ?? "");
  const co = String(b.check_out_date ?? "");
  const n = nights(ci, co);
  if (!ci || !co || n <= 0) {
    return c.html(layout({ title: "予約の編集", lang: "ja", path: `/admin/reservations/${id}`, showLangs: false, body: reservationForm({ nav: navFor(c, "res"), res, error: "日付を正しく入力してください。" }) }));
  }
  await c.env.DB.prepare(
    `UPDATE reservations SET airbnb_reservation_code=?, match_last_name=?, check_in_date=?, check_out_date=?, nights=?, expected_guests=?, preferred_lang=?, channel=?, total_amount=?, cleaning_fee=?, notes=?, updated_at=? WHERE id=?`
  ).bind(
    String(b.airbnb_reservation_code ?? "").trim() ? normalizeOtaCode(String(b.airbnb_reservation_code)) : null,
    String(b.match_last_name ?? "").trim() ? normalizeName(String(b.match_last_name)) : null,
    ci, co, n,
    parseInt(String(b.expected_guests ?? "0"), 10) || 0,
    String(b.preferred_lang ?? "ja"),
    String(b.channel ?? "airbnb"),
    parseInt(String(b.total_amount ?? ""), 10) || null,
    parseInt(String(b.cleaning_fee ?? ""), 10) || null,
    String(b.notes ?? "").trim() || null,
    nowIso(), id
  ).run();
  await appendAudit(c.env, { reservationId: id, actorType: "admin", actorId: sess.email, action: "update_reservation" });
  return c.redirect("/admin/reservations?flash=" + encodeURIComponent("予約を更新しました。"));
});

app.post("/admin/reservations/:id/cancel", async (c) => {
  const sess = c.get("admin");
  const id = c.req.param("id");
  await c.env.DB.prepare("UPDATE reservations SET status='cancelled', updated_at=? WHERE id=?").bind(nowIso(), id).run();
  await appendAudit(c.env, { reservationId: id, actorType: "admin", actorId: sess.email, action: "cancel_reservation" });
  return c.redirect("/admin/reservations?flash=" + encodeURIComponent("予約を取消にしました。"));
});

// 指標ダッシュボード
function ymParts(ym: string): { y: number; m: number } {
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  if (m) return { y: parseInt(m[1]!, 10), m: parseInt(m[2]!, 10) };
  const d = new Date();
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
}
function shiftYm(y: number, m: number, delta: number): string {
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}
app.get("/admin/metrics", async (c) => {
  const ym = c.req.query("ym") || "";
  const { y, m } = ymParts(ym);
  const rs = (await c.env.DB.prepare("SELECT check_in_date, check_out_date, total_amount, cleaning_fee, channel, status, review_status, source FROM reservations").all<ResForMetrics>()).results ?? [];
  const metrics = computeMonthly(rs, y, m);
  const cur = `${y}-${String(m).padStart(2, "0")}`;
  return c.html(layout({ title: "指標", lang: "ja", path: "/admin/metrics", showLangs: false, body: metricsPage({ nav: navFor(c, "metrics"), m: metrics, ym: cur, prevYm: shiftYm(y, m, -1), nextYm: shiftYm(y, m, 1) }) }));
});

// 自動削除の履歴（PIIなしの要約のみ。audit_logsから data_purge / image_purge を表示）
app.get("/admin/purge-log", async (c) => {
  const rows = (await c.env.DB.prepare(
    "SELECT created_at, reservation_id, action, detail FROM audit_logs WHERE action IN ('data_purge','image_purge') ORDER BY created_at DESC LIMIT 300"
  ).all<{ created_at: string; reservation_id: string | null; action: string; detail: string | null }>()).results ?? [];
  const yen = (n: number) => "¥" + Number(n).toLocaleString("en-US");
  const body = rows.map((r) => {
    let d: any = {};
    try { d = r.detail ? JSON.parse(r.detail) : {}; } catch { d = {}; }
    const when = escHtml((r.created_at || "").replace("T", " ").slice(0, 16));
    if (r.action === "data_purge") {
      const code = escHtml(String(d.code ?? (r.reservation_id ?? "").slice(0, 10)));
      const meta = `${d.nights ?? "?"}泊・${escHtml(String(d.channel ?? ""))}${d.source ? "/" + escHtml(String(d.source)) : ""}`;
      const stay = `${escHtml(String(d.check_in ?? ""))}〜${escHtml(String(d.check_out ?? ""))}`;
      const amt = d.total_amount != null ? yen(d.total_amount) : "—";
      return `<tr><td>${when}</td><td>名簿削除</td><td>${code}<br><span class="muted">${meta}</span></td><td>${stay}</td><td>${d.guests ?? "?"}名</td><td>${amt}</td></tr>`;
    }
    return `<tr><td>${when}</td><td>画像削除</td><td>${escHtml(String((r.reservation_id ?? "").slice(0, 10)))}</td><td>—</td><td>—</td><td>—</td></tr>`;
  }).join("");
  return c.html(layout({
    title: "削除履歴", lang: "ja", path: "/admin/purge-log", showLangs: false,
    body: html`<div class="card">
      ${navFor(c, "purge")}
      <h1>自動削除の履歴</h1>
      <p class="muted">保存期限切れ(5年)・未提出の自己申告(30日)などで自動削除した予約・画像の記録です。氏名・旅券番号・住所などの個人情報は含みません（削除済み）。</p>
      <div style="overflow:auto">
      <table><thead><tr><th>日時</th><th>種別</th><th>予約/コード</th><th>日程</th><th>人数</th><th>売上</th></tr></thead>
      <tbody>${raw(body || '<tr><td colspan="6" class="muted">まだ削除履歴はありません。</td></tr>')}</tbody></table>
      </div>
    </div>`,
  }));
});

// iCal取込のコア（手動ボタンとCronで共用）。actorEmail=null はCron実行。
async function importIcalReservations(env: Env, actorEmail: string | null): Promise<{ imported: number; updated: number }> {
  let imported = 0, updated = 0;
  const resp = await fetch(env.ICAL_URL!);
  if (!resp.ok) throw new Error(`ical fetch ${resp.status}`);
  const text = await resp.text();
  const events = reservedEvents(parseIcal(text));
  const now = nowIso();
  for (const ev of events) {
    const n = nights(ev.start, ev.end);
    if (n <= 0) continue;
    const existing = await env.DB.prepare("SELECT id, created_at FROM reservations WHERE ical_uid=?").bind(ev.uid).first<{ id: string; created_at: string }>();
    const retention = parseInt(env.DATA_RETENTION_YEARS || "5", 10);
    if (existing) {
      // チェックアウト変更に追従して保持期限(data_purge_at/img_purge_at)を再計算（早すぎる削除/過剰保持を防止）
      const purge = addYears(laterIso(existing.created_at, ev.end + "T00:00:00Z"), retention);
      await env.DB.prepare("UPDATE reservations SET check_in_date=?, check_out_date=?, nights=?, airbnb_reservation_code=COALESCE(airbnb_reservation_code, ?), data_purge_at=?, updated_at=? WHERE id=?").bind(ev.start, ev.end, n, ev.code ?? null, purge, now, existing.id).run();
      await env.DB.prepare("UPDATE guests SET img_purge_at=?, updated_at=? WHERE reservation_id=?").bind(addYears(ev.end + "T00:00:00Z", retention), now, existing.id).run();
      updated++;
    } else {
      // iCal未取込。先に自己申告pendingが「同コード＆同日程でちょうど1件」あれば正規予約として統合する。
      // （複数候補・日付不一致は自動統合せず新規作成。重複は管理画面で人が解決＝Codex指摘B）
      let merged = false;
      if (ev.code) {
        const cands = (await env.DB.prepare(
          "SELECT id, created_at, check_in_date, check_out_date FROM reservations WHERE airbnb_reservation_code=? AND ical_uid IS NULL AND source='guest_selfreport' AND status!='cancelled'"
        ).bind(ev.code).all<{ id: string; created_at: string; check_in_date: string; check_out_date: string }>()).results ?? [];
        const aligned = cands.filter((r) => r.check_in_date === ev.start && r.check_out_date === ev.end);
        if (cands.length === 1 && aligned.length === 1) {
          const m = aligned[0]!;
          const purge = addYears(laterIso(m.created_at, ev.end + "T00:00:00Z"), retention);
          await env.DB.prepare(
            "UPDATE reservations SET ical_uid=?, source='ical', check_in_date=?, check_out_date=?, nights=?, data_purge_at=?, updated_at=? WHERE id=?"
          ).bind(ev.uid, ev.start, ev.end, n, purge, now, m.id).run();
          // 統合先の画像保持も正式日程基準に再計算
          await env.DB.prepare("UPDATE guests SET img_purge_at=?, updated_at=? WHERE reservation_id=?").bind(addYears(ev.end + "T00:00:00Z", retention), now, m.id).run();
          await appendAudit(env, { reservationId: m.id, actorType: actorEmail ? "admin" : "system", actorId: actorEmail, action: "ical_merge_selfreport", detail: { uid: ev.uid, code: ev.code } });
          merged = true;
          updated++;
        }
      }
      if (!merged) {
        const id = newId("r_");
        const purge = addYears(laterIso(now, ev.end + "T00:00:00Z"), retention);
        await env.DB.prepare(
          `INSERT INTO reservations (id, airbnb_reservation_code, property_name, check_in_date, check_out_date, nights, expected_guests, preferred_lang, ical_uid, status, review_status, currency, channel, source, created_at, updated_at, data_purge_at)
           VALUES (?,?,?,?,?,?,0,'ja',?, 'open','pending','JPY','airbnb','ical',?,?,?)`
        ).bind(id, ev.code ?? null, env.PROPERTY_NAME || "Hilltop Zushi", ev.start, ev.end, n, ev.uid, now, now, purge).run();
        imported++;
      }
    }
  }
  await appendAudit(env, { actorType: actorEmail ? "admin" : "system", actorId: actorEmail, action: "ical_import", detail: { imported, updated } });
  return { imported, updated };
}

// iCal取込（手動ボタン）
app.post("/admin/ical/import", async (c) => {
  const sess = c.get("admin");
  if (!c.env.ICAL_URL) return c.redirect("/admin/reservations?flash=" + encodeURIComponent("ICAL_URLが未設定です。"));
  try {
    const { imported, updated } = await importIcalReservations(c.env, sess.email);
    return c.redirect("/admin/reservations?flash=" + encodeURIComponent(`iCal取込: 新規${imported}件・更新${updated}件。姓と売上を各予約で補完してください。`));
  } catch (e) {
    return c.redirect("/admin/reservations?flash=" + encodeURIComponent("iCal取込に失敗しました。URLをご確認ください。"));
  }
});

app.get("/admin", async (c) => {
  const sess = c.get("admin");
  const r = await c.env.DB.prepare(
    "SELECT * FROM reservations ORDER BY check_in_date DESC LIMIT 100"
  ).all<any>();
  const rows = (r.results ?? [])
    .map((res: any) => {
      return `<tr>
        <td><a href="/admin/r/${res.id}">${escHtml(res.airbnb_reservation_code ?? res.id.slice(0, 8))}</a></td>
        <td>${res.check_in_date}〜${res.check_out_date}</td>
        <td>${res.expected_guests || "-"}</td>
        <td>${res.review_status}</td>
      </tr>`;
    })
    .join("");
  return c.html(layout({
    title: "管理 — 予約一覧",
    lang: "ja",
    path: "/admin",
    showLangs: false,
    body: html`<div class="card">
      ${navFor(c, "list")}
      <h1>予約一覧</h1>
      <table><thead><tr><th>予約</th><th>宿泊</th><th>人数</th><th>審査</th></tr></thead>
      <tbody>${raw(rows)}</tbody></table></div>`,
  }));
});

app.get("/admin/r/:id", async (c) => {
  const id = c.req.param("id");
  const res = await getReservation(c.env, id);
  if (!res) return c.notFound();
  const guests = await getGuestsByReservation(c.env, id);
  const { done, total } = computeProgress(guests, res.expected_guests);

  // 機微情報の閲覧を監査ログに記録（誰が＝操作者メール）
  await appendAudit(c.env, { reservationId: id, actorType: "admin", actorId: c.get("admin").email, action: "view_guest_pii", detail: { guest_count: guests.length } });

  const rows: string[] = [];
  for (const g of guests) {
    const address = (await decryptField(c.env.MASTER_KEY, g.address_enc)) ?? "";
    const passport = (await decryptField(c.env.MASTER_KEY, g.passport_no_enc)) ?? "";
    const phone = (await decryptField(c.env.MASTER_KEY, g.phone_enc)) ?? "";
    const img = g.passport_img_key ? `<a href="/admin/img/${g.id}">画像</a>` : "-";
    rows.push(`<tr>
      <td>#${g.slot_no}${g.member_role === "representative" ? "👑" : ""}</td>
      <td>${escHtml(g.full_name ?? "")}<br><span class="muted">${escHtml(g.submit_status)}</span></td>
      <td>${escHtml(optLabel(NATIONALITIES, g.nationality, "ja"))}${g.nationality_other ? "（" + escHtml(g.nationality_other) + "）" : ""}</td>
      <td>${escHtml(passport)}</td>
      <td>${escHtml(address)}</td>
      <td>${escHtml(optLabel(OCCUPATIONS, g.occupation, "ja"))}</td>
      <td>${g.age ?? ""} / ${escHtml(optLabel(GENDERS, g.gender, "ja"))}</td>
      <td>${escHtml(phone)}</td>
      <td>${escHtml(g.email ?? "")}${g.marketing_optin ? " ✉️" : ""}</td>
      <td>${img}</td>
      <td>${escHtml(optLabel(STAY_PURPOSES, g.stay_purpose, "ja"))}${g.stay_purpose_other ? "（" + escHtml(g.stay_purpose_other) + "）" : ""}</td>
    </tr>`);
  }

  return c.html(layout({
    title: `管理 — ${res.airbnb_reservation_code ?? id}`,
    lang: "ja",
    path: `/admin/r/${id}`,
    showLangs: false,
    body: html`<div class="card">
      <h1>${res.airbnb_reservation_code ?? id.slice(0, 8)}</h1>
      <p>${res.check_in_date}〜${res.check_out_date}／進捗 ${done}/${total}／審査 ${res.review_status}</p>
      <div style="overflow:auto">
      <table><thead><tr><th>枠</th><th>氏名/状態</th><th>国籍</th><th>旅券番号(過去分)</th><th>住所</th><th>職業</th><th>年齢/性別</th><th>電話</th><th>メール</th><th>画像</th><th>利用用途</th></tr></thead>
      <tbody>${raw(rows.join(""))}</tbody></table>
      </div>
      <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
        <form method="post" action="/admin/r/${id}/approve"><button class="btn" style="width:auto">承認</button></form>
        <form method="post" action="/admin/r/${id}/send-pin"><button class="btn secondary" style="width:auto">暗証番号リンク発行</button></form>
        <a class="btn secondary" style="width:auto" href="/admin/r/${id}/export.csv">CSV出力</a>
      </div>
    </div>`,
  }));
});

// 認証済みプロキシ配信（署名URLを渡さない：設計 B-4）
app.get("/admin/img/:guestId", async (c) => {
  const g = await getGuest(c.env, c.req.param("guestId"));
  if (!g || !g.passport_img_key) return c.notFound();
  const obj = await c.env.KV.get(g.passport_img_key, "arrayBuffer");
  if (!obj) return c.notFound();
  const dec = await decryptBytes(c.env.MASTER_KEY, new Uint8Array(obj));
  await appendAudit(c.env, { reservationId: g.reservation_id, guestId: g.id, actorType: "admin", actorId: c.get("admin").email, action: "view_passport_image" });
  return new Response(dec as BodyInit, { headers: { "Content-Type": g.passport_img_mime ?? "image/jpeg", "Cache-Control": "no-store" } });
});

app.post("/admin/r/:id/approve", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("UPDATE reservations SET review_status='approved', updated_at=? WHERE id=?").bind(nowIso(), id).run();
  // 承認＝正式予約として確定。自己申告pendingなら短期purchから法定保持(5年)へ昇格。
  const res = await getReservation(c.env, id);
  if (res) await promoteSelfReportRetention(c.env, res, parseInt(c.env.DATA_RETENTION_YEARS || "5", 10));
  await appendAudit(c.env, { reservationId: id, actorType: "admin", actorId: c.get("admin").email, action: "approve_reservation" });
  return c.redirect(`/admin/r/${id}`);
});

app.post("/admin/r/:id/send-pin", async (c) => {
  const id = c.req.param("id");
  const tk = generateToken();
  const th = await hashToken(tk);
  const exp = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await c.env.DB.prepare("INSERT INTO pin_view_tokens (id, reservation_id, token_hash, expires_at, created_at) VALUES (?,?,?,?,?)").bind(newId("pv_"), id, th, exp, nowIso()).run();
  await appendAudit(c.env, { reservationId: id, actorType: "admin", actorId: c.get("admin").email, action: "issue_pin_link" });
  const url = `${c.env.APP_BASE_URL}/pin/${tk}`;
  // TODO: 実際の送付（Airbnbメッセージ手動 or メール）。MVPはリンクを管理者へ表示。
  return c.html(layout({ title: "暗証番号リンク", lang: "ja", path: `/admin/r/${id}`, showLangs: false, body: messagePage("ja", { title: "暗証番号リンク（24時間有効・要手動送付）", message: url, kind: "ok", backHref: `/admin/r/${id}`, backLabel: "戻る" }) }));
});

app.get("/admin/r/:id/export.csv", async (c) => {
  const id = c.req.param("id");
  const res = await getReservation(c.env, id);
  if (!res) return c.notFound();
  const guests = await getGuestsByReservation(c.env, id);
  const header = ["slot", "role", "name", "has_jp_address", "address", "nationality", "passport_no_legacy", "occupation", "age", "gender", "phone", "email", "prev_stay", "stay_purpose", "check_in", "check_out"];
  const lines = [header.join(",")];
  for (const g of guests) {
    const address = (await decryptField(c.env.MASTER_KEY, g.address_enc)) ?? "";
    const passport = (await decryptField(c.env.MASTER_KEY, g.passport_no_enc)) ?? "";
    const phone = (await decryptField(c.env.MASTER_KEY, g.phone_enc)) ?? "";
    const stayPurpose = optLabel(STAY_PURPOSES, g.stay_purpose, "ja") + (g.stay_purpose_other ? `(${g.stay_purpose_other})` : "");
    const cells = [
      g.slot_no, g.member_role, g.full_name ?? "", g.has_jp_address ?? "", address,
      optLabel(NATIONALITIES, g.nationality, "ja") + (g.nationality_other ? `(${g.nationality_other})` : ""),
      passport, optLabel(OCCUPATIONS, g.occupation, "ja"), g.age ?? "", g.gender ?? "", phone, g.email ?? "", g.prev_stay ?? "", stayPurpose, res.check_in_date, res.check_out_date,
    ].map((x) => {
      // CSVインジェクション対策：改行除去＋数式起動文字を無効化
      let s = String(x).replace(/[\r\n]+/g, " ");
      if (/^[=+\-@\t]/.test(s)) s = "'" + s;
      return `"${s.replace(/"/g, '""')}"`;
    });
    lines.push(cells.join(","));
  }
  // TODO: Shift_JIS化（Workers標準はUTF-8のみ）。当面はUTF-8 BOM付き（Excel可）。
  const body = "﻿" + lines.join("\r\n");
  await appendAudit(c.env, { reservationId: id, actorType: "admin", actorId: c.get("admin").email, action: "export_csv" });
  return c.body(body, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="roster_${id}.csv"` });
});

// 暗証番号の一度だけ表示（MVPスタブ：実際の番号管理はTODO）
app.get("/pin/:token", async (c) => {
  const token = c.req.param("token");
  const th = await hashToken(token);
  const row = await c.env.DB.prepare("SELECT * FROM pin_view_tokens WHERE token_hash=?").bind(th).first<any>();
  if (!row || row.viewed_at || new Date(row.expires_at) < new Date()) {
    return c.html(layout({ title: "Hilltop Zushi", lang: "ja", path: "/pin", body: messagePage("ja", { title: "Hilltop Zushi", message: t("ja", "expired"), kind: "err" }) }));
  }
  await c.env.DB.prepare("UPDATE pin_view_tokens SET viewed_at=? WHERE id=?").bind(nowIso(), row.id).run();
  // TODO: 実際の暗証番号を keybox_codes から復号して表示。MVPは案内文のみ。
  return c.html(layout({ title: "Hilltop Zushi", lang: "ja", path: "/pin", body: messagePage("ja", { title: "チェックイン情報", message: "（ここに暗証番号が表示されます。MVPでは番号管理は未実装）", kind: "ok" }) }));
});

// 保存期限切れデータの自動削除。画像=KVから削除、名簿本体=予約と全子テーブルを明示削除。
// 監査ログ(audit_logs)はFK無しの追記専用なので削除後も証跡として残る。冪等（再実行で対象0件）。
async function purgeExpiredData(env: Env): Promise<{ imagesPurged: number; reservationsPurged: number }> {
  const now = nowIso();
  let imagesPurged = 0, reservationsPurged = 0;

  // フェーズA: 画像のみ保存期限切れ（img_purge_at <= now）→ KVから画像を消しメタをクリア
  const imgRows = await env.DB.prepare(
    "SELECT id, reservation_id, passport_img_key FROM guests WHERE passport_img_key IS NOT NULL AND img_purge_at IS NOT NULL AND img_purge_at <= ?"
  ).bind(now).all<{ id: string; reservation_id: string; passport_img_key: string }>();
  for (const g of imgRows.results ?? []) {
    // KV削除が成功したときだけDBメタをクリア。失敗時はキーを残し次回cronで再試行する。
    // （先にDBを消すと「KVに画像が残ったまま参照キーを失う」＝削除したつもりのPII残存になるため）
    let kvOk = true;
    try { await env.KV.delete(g.passport_img_key); } catch { kvOk = false; }
    if (!kvOk) { console.error("[purge] KV delete failed (imgA), retry next run:", g.id); continue; }
    await env.DB.prepare(
      "UPDATE guests SET passport_img_key=NULL, passport_img_mime=NULL, passport_img_size=NULL, updated_at=? WHERE id=?"
    ).bind(now, g.id).run();
    // 画像の自動削除も履歴に残す（内部IDのみ・PIIなし）
    await appendAudit(env, { reservationId: g.reservation_id, guestId: g.id, actorType: "system", action: "image_purge", detail: { reason: "image_retention_expired" } });
    imagesPurged++;
  }

  // フェーズB: 名簿本体の保存期限切れ（data_purge_at <= now）→ 予約と全子テーブルを完全削除
  // 管理側が「何がいつ消えたか」を把握できるよう、削除前にPIIを含まない要約を取得して履歴に残す。
  const resRows = await env.DB.prepare(
    "SELECT id, airbnb_reservation_code, check_in_date, check_out_date, nights, channel, source, review_status, total_amount, cleaning_fee FROM reservations WHERE data_purge_at IS NOT NULL AND data_purge_at <= ?"
  ).bind(now).all<{ id: string; airbnb_reservation_code: string | null; check_in_date: string; check_out_date: string; nights: number; channel: string; source: string; review_status: string; total_amount: number | null; cleaning_fee: number | null }>();
  for (const r of resRows.results ?? []) {
    // 配下guestの画像をKVから先に削除。1つでも失敗したらこの予約のDB削除は見送り次回再試行する。
    // （DBを先に消すとKV画像が孤児として永久残存＝削除したつもりのPII残存になるため）
    const gs = await env.DB.prepare(
      "SELECT passport_img_key FROM guests WHERE reservation_id=? AND passport_img_key IS NOT NULL"
    ).bind(r.id).all<{ passport_img_key: string }>();
    let kvAllOk = true;
    for (const g of gs.results ?? []) { try { await env.KV.delete(g.passport_img_key); } catch { kvAllOk = false; } }
    if (!kvAllOk) { console.error("[purge] KV delete failed (resB), skip & retry next run:", r.id); continue; }
    // 削除前に履歴記録：氏名/旅券/住所等のPIIは含めず、予約コード・日程・人数・チャネル・金額の要約のみ。
    // audit_logsはFK無しの追記専用なので予約削除後も「削除した事実と概要」が永続的に残る。
    const gc = await env.DB.prepare("SELECT COUNT(*) AS c FROM guests WHERE reservation_id=?").bind(r.id).first<{ c: number }>();
    await appendAudit(env, {
      reservationId: r.id, actorType: "system", action: "data_purge",
      detail: {
        reason: "retention_expired",
        code: r.airbnb_reservation_code, check_in: r.check_in_date, check_out: r.check_out_date,
        nights: r.nights, channel: r.channel, source: r.source, review_status: r.review_status,
        guests: gc?.c ?? 0, total_amount: r.total_amount, cleaning_fee: r.cleaning_fee,
      },
    });
    // 子テーブル→親の順に明示削除（D1のFK/CASCADE設定に依存せず確実に全消去）。batchでアトミック実行。
    await env.DB.batch([
      env.DB.prepare("DELETE FROM guest_tokens WHERE guest_id IN (SELECT id FROM guests WHERE reservation_id=?)").bind(r.id),
      env.DB.prepare("DELETE FROM guests WHERE reservation_id=?").bind(r.id),
      env.DB.prepare("DELETE FROM group_tokens WHERE reservation_id=?").bind(r.id),
      env.DB.prepare("DELETE FROM pin_view_tokens WHERE reservation_id=?").bind(r.id),
      env.DB.prepare("DELETE FROM blacklist_hits WHERE reservation_id=?").bind(r.id),
      env.DB.prepare("DELETE FROM reminders WHERE reservation_id=?").bind(r.id),
      env.DB.prepare("DELETE FROM keybox_codes WHERE reservation_id=?").bind(r.id),
      env.DB.prepare("DELETE FROM reservations WHERE id=?").bind(r.id),
    ]);
    reservationsPurged++;
  }
  return { imagesPurged, reservationsPurged };
}

// 定期実行（Cron）: ①iCal自動取込 ②保存期限切れデータの自動削除。
// どちらも失敗が他方を巻き込まないよう個別にtry。waitUntilでハンドラ完了後も処理継続。
async function scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil((async () => {
    if (env.ICAL_URL) {
      try {
        const r = await importIcalReservations(env, null);
        console.log("[cron] ical import", JSON.stringify(r));
      } catch (e) {
        console.error("[cron] ical import failed", e);
      }
    }
    try {
      const p = await purgeExpiredData(env);
      console.log("[cron] purge", JSON.stringify(p));
    } catch (e) {
      console.error("[cron] purge failed", e);
    }
  })());
}

export default { fetch: app.fetch, scheduled };
