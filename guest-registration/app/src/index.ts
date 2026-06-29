// Hilltop Zushi 宿泊者名簿アプリ — エントリポイント（Workers + Hono）
import { Hono } from "hono";
import { html, raw } from "hono/html";
import type { Env, Lang } from "./types";
import { normalizeLang } from "./types";
import { layout } from "./views/layout";
import { startPage, declarePage, progressPage, formPage, messagePage } from "./views/guest";
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
  type Guest,
} from "./lib/db";
import { encryptField, decryptField, encryptBytes, decryptBytes } from "./lib/crypto";
import { hashToken, sha256Hex, timingSafeEqual, generateToken, newId } from "./lib/tokens";
import { validateGuest, SUBMIT_RULE_VERSION, type GuestInput, type FieldErrors } from "./lib/validation";
import { t, optLabel, OCCUPATIONS, NATIONALITIES, GENDERS, CHOOSE_REASONS } from "./lib/i18n";
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

app.get("/start", (c) => {
  const lang = pickLang(c);
  return c.html(layout({ title: t(lang, "app_title"), lang, path: "/start", body: startPage(lang, {}) }));
});

app.post("/start", async (c) => {
  const lang = pickLang(c);
  const ok = await rateLimit(c.env, `start:${await hashToken(ipHashKey(c))}`, 10, 600);
  if (!ok) {
    return c.html(
      layout({ title: t(lang, "app_title"), lang, path: "/start", body: startPage(lang, { error: t(lang, "too_many") }) })
    );
  }
  const body = await c.req.parseBody();
  const code = String(body.code ?? "").trim();
  const lastName = String(body.last_name ?? "").trim();
  const res = await verifyReservation(c.env, code, lastName);
  if (!res) {
    return c.html(
      layout({
        title: t(lang, "app_title"),
        lang,
        path: "/start",
        body: startPage(lang, { error: t(lang, "verify_failed"), code }),
      })
    );
  }
  const token = await createGroupToken(c.env, res.id, checkoutExpiry(res.check_out_date));
  await appendAudit(c.env, { reservationId: res.id, actorType: "guest", action: "start_verified", ipHash: await hashToken(ipHashKey(c)) });
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
        progressPage(lang, { groupToken: token, guests: guests.map((g) => ({ slot_no: g.slot_no, full_name: g.full_name, submit_status: g.submit_status })), done, total }),
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

// 個人リンクの再表示（未提出ぶんはトークンを再生成）
app.get("/g/:token/reveal", async (c) => {
  const token = c.req.param("token");
  const res = await resolveGroupToken(c.env, token);
  const lang = pickLang(c, res?.preferred_lang);
  if (!res) return c.html(layout({ title: t(lang, "app_title"), lang, path: `/g/${token}`, body: messagePage(lang, { title: t(lang, "app_title"), message: t(lang, "expired"), kind: "err" }) }));
  const guests = await getGuestsByReservation(c.env, res.id);
  const out: { guestId: string; slotNo: number; role: string; token: string }[] = [];
  const exp = checkoutExpiry(res.check_out_date);
  for (const g of guests) {
    const tk = generateToken();
    const th = await hashToken(tk);
    // 既存トークンを失効させ、新しい個人トークンを発行
    await c.env.DB.prepare("UPDATE guest_tokens SET revoked_at = ? WHERE guest_id = ? AND revoked_at IS NULL").bind(nowIso(), g.id).run();
    await c.env.DB.prepare("INSERT INTO guest_tokens (id, guest_id, token_hash, expires_at, created_at) VALUES (?,?,?,?,?)").bind(newId("pt_"), g.id, th, exp, nowIso()).run();
    out.push({ guestId: g.id, slotNo: g.slot_no, role: g.member_role, token: tk });
  }
  return c.html(layout({ title: t(lang, "share_links"), lang, path: `/g/${token}/reveal`, body: linksPage(lang, c.env.APP_BASE_URL, token, out) }));
});

function linksPage(lang: Lang, base: string, groupToken: string, created: { slotNo: number; role: string; token: string }[]) {
  const rows = created
    .map((x) => {
      const url = `${base}/p/${x.token}?lang=${lang}`;
      const who = x.role === "representative" ? "👑 #1" : `#${x.slotNo}`;
      return `<li><span>${who}</span><a class="muted" href="${url}">${t(lang, "edit_link")}</a></li>`;
    })
    .join("");
  return html`
  <div class="card">
    <h1>${t(lang, "share_links")}</h1>
    <p class="muted">${t(lang, "declare_desc")}</p>
    <ul class="list">${raw(rows)}</ul>
    <a class="btn secondary" href="/g/${groupToken}?lang=${lang}">${t(lang, "progress_title")}</a>
  </div>`;
}

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
    passport_no: (await decryptField(c.env.MASTER_KEY, guest.passport_no_enc)) ?? "",
    occupation: guest.occupation ?? "",
    age: guest.age == null ? "" : String(guest.age),
    gender: guest.gender ?? "",
    phone: (await decryptField(c.env.MASTER_KEY, guest.phone_enc)) ?? "",
    prev_stay: guest.prev_stay ?? "",
    next_stay: guest.next_stay ?? "",
    email: guest.email ?? "",
    choose_reason_other: guest.choose_reason_other ?? "",
  };
  return c.html(layout({ title: t(lang, "form_title"), lang, path: `/p/${token}`, body: formPage(lang, { token, guest, isRep: guest.member_role === "representative", values }) }));
});

// 個人入力フォーム（POST）
app.post("/p/:token", async (c) => {
  const token = c.req.param("token");
  const guest = await resolveGuestToken(c.env, token);
  const lang = pickLang(c);
  if (!guest) return c.html(layout({ title: t(lang, "app_title"), lang, path: `/p/${token}`, body: messagePage(lang, { title: t(lang, "app_title"), message: t(lang, "expired"), kind: "err" }) }));

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
    passport_no: get("passport_no"),
    has_passport_img: Boolean(guest.passport_img_key) || !!(file && file.size > 0),
    occupation: get("occupation"),
    age: get("age"),
    gender: get("gender"),
    phone: get("phone"),
    email: get("email"),
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
        prev_stay: get("prev_stay"),
        next_stay: get("next_stay"),
        choose_reason_other: get("choose_reason_other"),
      });
    }
    imgInfo = res.info;
  }

  if (!ok || !consentOk) {
    const banner = !consentOk ? t(lang, "consent_required") : undefined;
    return renderFormError(c, lang, token, guest, input, errors, banner, true, {
      prev_stay: get("prev_stay"),
      next_stay: get("next_stay"),
      choose_reason_other: get("choose_reason_other"),
    });
  }

  // 暗号化して保存
  const now = nowIso();
  const addressEnc = await encryptField(c.env.MASTER_KEY, input.address);
  const passportEnc = await encryptField(c.env.MASTER_KEY, input.passport_no);
  const phoneEnc = await encryptField(c.env.MASTER_KEY, input.phone);
  // choose_reason は許可リストに含まれる値だけを保存（不正値を排除）
  const allowedReasons = new Set(CHOOSE_REASONS.map((r) => r.code));
  const chooseReasons = form.getAll("choose_reason").map(String).filter((x) => allowedReasons.has(x));
  const isRep = guest.member_role === "representative";
  const chooseReasonJson = isRep && chooseReasons.length ? JSON.stringify(chooseReasons) : null;
  const chooseReasonOther = isRep ? get("choose_reason_other") || null : null;
  const marketing = form.get("marketing_optin") === "1" ? 1 : 0;

  // 画像カラムは「新規アップロードがあれば更新、なければ既存値を維持」（静的SQLでbindズレを防止）
  const imgKey = imgInfo?.key ?? guest.passport_img_key;
  const imgMime = imgInfo?.mime ?? guest.passport_img_mime;
  const imgSize = imgInfo?.size ?? guest.passport_img_size;
  const imgUploadedAt = imgInfo ? now : guest.passport_img_uploaded_at;

  await c.env.DB.prepare(
    `UPDATE guests SET
      full_name=?, has_jp_address=?, address_enc=?, nationality=?, nationality_other=?,
      passport_no_enc=?, occupation=?, age=?, gender=?, phone_enc=?, prev_stay=?, next_stay=?, email=?,
      choose_reason=?, choose_reason_other=?, marketing_optin=?, marketing_optin_at=?,
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
      passportEnc,
      input.occupation,
      parseInt(input.age, 10),
      input.gender,
      phoneEnc,
      get("prev_stay") || null,
      get("next_stay") || null,
      input.email || null,
      chooseReasonJson,
      chooseReasonOther,
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

  return c.html(layout({ title: t(lang, "submitted_ok"), lang, path: `/p/${token}`, body: messagePage(lang, { title: t(lang, "app_title"), message: t(lang, "submitted_ok"), kind: "ok", backHref: `/p/${token}?lang=${lang}`, backLabel: t(lang, "edit_link") }) }));
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
  extra: { prev_stay?: string; next_stay?: string; choose_reason_other?: string } = {}
) {
  const values: Record<string, string> = {
    full_name: input.full_name,
    has_jp_address: input.has_jp_address,
    address: input.address,
    nationality: input.nationality,
    nationality_other: input.nationality_other,
    passport_no: input.passport_no,
    occupation: input.occupation,
    age: input.age,
    gender: input.gender,
    phone: input.phone,
    email: input.email,
    prev_stay: extra.prev_stay ?? "",
    next_stay: extra.next_stay ?? "",
    choose_reason_other: extra.choose_reason_other ?? "",
  };
  const body = [
    banner ? html`<div class="card"><div class="notice err">${banner}</div></div>` : html``,
    formPage(lang, { token, guest, isRep: guest.member_role === "representative", values, errors, showErrorBanner: showBanner }),
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
    String(b.airbnb_reservation_code ?? "").trim() || null,
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
    String(b.airbnb_reservation_code ?? "").trim() || null,
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
  const rs = (await c.env.DB.prepare("SELECT check_in_date, check_out_date, total_amount, cleaning_fee, channel, status FROM reservations").all<ResForMetrics>()).results ?? [];
  const metrics = computeMonthly(rs, y, m);
  const cur = `${y}-${String(m).padStart(2, "0")}`;
  return c.html(layout({ title: "指標", lang: "ja", path: "/admin/metrics", showLangs: false, body: metricsPage({ nav: navFor(c, "metrics"), m: metrics, ym: cur, prevYm: shiftYm(y, m, -1), nextYm: shiftYm(y, m, 1) }) }));
});

// iCal取込（手動）
app.post("/admin/ical/import", async (c) => {
  const sess = c.get("admin");
  if (!c.env.ICAL_URL) return c.redirect("/admin/reservations?flash=" + encodeURIComponent("ICAL_URLが未設定です。"));
  let imported = 0, updated = 0;
  try {
    const resp = await fetch(c.env.ICAL_URL);
    const text = await resp.text();
    const events = reservedEvents(parseIcal(text));
    const now = nowIso();
    for (const ev of events) {
      const n = nights(ev.start, ev.end);
      if (n <= 0) continue;
      const existing = await c.env.DB.prepare("SELECT id FROM reservations WHERE ical_uid=?").bind(ev.uid).first<{ id: string }>();
      if (existing) {
        await c.env.DB.prepare("UPDATE reservations SET check_in_date=?, check_out_date=?, nights=?, airbnb_reservation_code=COALESCE(airbnb_reservation_code, ?), updated_at=? WHERE id=?").bind(ev.start, ev.end, n, ev.code ?? null, now, existing.id).run();
        updated++;
      } else {
        const id = newId("r_");
        const purge = addYears(laterIso(now, ev.end + "T00:00:00Z"), parseInt(c.env.DATA_RETENTION_YEARS || "5", 10));
        await c.env.DB.prepare(
          `INSERT INTO reservations (id, airbnb_reservation_code, property_name, check_in_date, check_out_date, nights, expected_guests, preferred_lang, ical_uid, status, review_status, currency, channel, source, created_at, updated_at, data_purge_at)
           VALUES (?,?,?,?,?,?,0,'ja',?, 'open','pending','JPY','airbnb','ical',?,?,?)`
        ).bind(id, ev.code ?? null, c.env.PROPERTY_NAME || "Hilltop Zushi", ev.start, ev.end, n, ev.uid, now, now, purge).run();
        imported++;
      }
    }
    await appendAudit(c.env, { actorType: "admin", actorId: sess.email, action: "ical_import", detail: { imported, updated } });
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
      <table><thead><tr><th>枠</th><th>氏名/状態</th><th>国籍</th><th>旅券</th><th>住所</th><th>職業</th><th>年齢/性別</th><th>電話</th><th>メール</th><th>画像</th></tr></thead>
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
  const header = ["slot", "role", "name", "has_jp_address", "address", "nationality", "passport_no", "occupation", "age", "gender", "phone", "email", "check_in", "check_out"];
  const lines = [header.join(",")];
  for (const g of guests) {
    const address = (await decryptField(c.env.MASTER_KEY, g.address_enc)) ?? "";
    const passport = (await decryptField(c.env.MASTER_KEY, g.passport_no_enc)) ?? "";
    const phone = (await decryptField(c.env.MASTER_KEY, g.phone_enc)) ?? "";
    const cells = [
      g.slot_no, g.member_role, g.full_name ?? "", g.has_jp_address ?? "", address,
      optLabel(NATIONALITIES, g.nationality, "ja") + (g.nationality_other ? `(${g.nationality_other})` : ""),
      passport, optLabel(OCCUPATIONS, g.occupation, "ja"), g.age ?? "", g.gender ?? "", phone, g.email ?? "", res.check_in_date, res.check_out_date,
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

// 定期実行（自動削除・リマインド）— MVPは雛形
async function scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
  // TODO: data_purge_at / img_purge_at を過ぎたレコードの削除、未提出リマインド生成
  void env;
}

export default { fetch: app.fetch, scheduled };
