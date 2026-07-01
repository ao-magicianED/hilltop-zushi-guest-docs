// D1アクセス層と小さなドメインヘルパ
import type { Env } from "../types";
import { newId, generateToken, hashToken } from "./tokens";

export type Reservation = {
  id: string;
  airbnb_reservation_code: string | null;
  property_name: string;
  check_in_date: string;
  check_out_date: string;
  nights: number;
  expected_guests: number;
  declared_guests: number | null;
  preferred_lang: string;
  match_last_name: string | null;
  status: string;
  review_status: string;
  pin_sent_at: string | null;
  terms_ack_at: string | null;
  data_purge_at: string | null;
  total_amount: number | null;
  cleaning_fee: number | null;
  currency: string;
  channel: string;
  source: string;
  notes: string | null;
  rep_email_hint: string | null;
  completion_notified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Guest = {
  id: string;
  reservation_id: string;
  member_role: string;
  slot_no: number;
  full_name: string | null;
  has_jp_address: number | null;
  address_enc: string | null;
  prev_stay: string | null;
  next_stay: string | null;
  occupation: string | null;
  nationality: string | null;
  nationality_other: string | null;
  passport_no_enc: string | null;
  phone_enc: string | null;
  email: string | null;
  age: number | null;
  gender: string | null;
  passport_img_key: string | null;
  passport_img_mime: string | null;
  passport_img_size: number | null;
  passport_img_uploaded_at: string | null;
  img_purge_at: string | null;
  id_verified: number;
  choose_reason: string | null;
  choose_reason_other: string | null;
  stay_purpose: string | null;
  stay_purpose_other: string | null;
  marketing_optin: number;
  submit_status: string;
  submitted_at: string | null;
  filled_by: string;
  consent_at: string | null;
  consent_privacy: number;
  consent_cross_border: number;
  created_at: string;
  updated_at: string;
};

// ---- 日付・正規化ヘルパ ----
export function nowIso(): string {
  return new Date().toISOString();
}
export function addYears(dateStr: string, years: number): string {
  const d = new Date(dateStr + (dateStr.length === 10 ? "T00:00:00Z" : ""));
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString();
}
export function laterIso(a: string, b: string): string {
  return new Date(a) >= new Date(b) ? a : b;
}
/** グループ／個人トークンの失効日時：チェックアウト翌日 23:59 JST（設計 ⑧） */
export function checkoutExpiry(checkout: string): string {
  const d = new Date(checkout + "T23:59:00+09:00");
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}
/** 姓・氏名などの照合用正規化（小文字・空白除去） */
export function normalizeName(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}
/** 日付に日数を加算（YYYY-MM-DD or ISO 入力に対応） */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + (dateStr.length === 10 ? "T00:00:00Z" : ""));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}
/** YYYY-MM-DD を「1970-01-01からの通算日」に。範囲計算用。 */
export function daysFromYmd(ymd: string): number {
  return Math.floor(Date.parse(ymd + "T00:00:00Z") / 86400000);
}
/** JST基準の今日（YYYY-MM-DD）。日付妥当性の起点に使う。 */
export function jstTodayYmd(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// ---- OTA（Airbnb/Booking.com）自己申告まわり ----
// pending自己申告の短期purch日数。承認/提出で法定保持(5年)へ昇格する。
export const PENDING_PURGE_DAYS = 30;

/** OTA予約コードの正規化（NFKC・大文字化・空白除去）。DBキーに任意文字列を入れない。 */
export function normalizeOtaCode(code: string): string {
  return code.normalize("NFKC").toUpperCase().replace(/\s+/g, "").trim();
}
/** OTA予約コードの形式検証（英数とハイフン・6〜20文字）。例: HMAPDB2SSB */
export function isValidOtaCode(code: string): boolean {
  return /^[A-Z0-9-]{6,20}$/.test(code);
}

export type StayDateCheck = { ok: boolean; nights: number; error?: "format" | "nights" | "range" };
/** ゲスト自己申告の宿泊日を検証（泊数1〜30・CIは今日-3〜+180日・COは+210日以内）。
 * 直近予約の実運用に合わせて狭め、遠い未来の架空pending量産・枠汚染の余地を減らす。 */
export function validateStayDates(ci: string, co: string): StayDateCheck {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(ci) || !re.test(co)) return { ok: false, nights: 0, error: "format" };
  const ciD = daysFromYmd(ci);
  const coD = daysFromYmd(co);
  if (Number.isNaN(ciD) || Number.isNaN(coD)) return { ok: false, nights: 0, error: "format" };
  const nights = coD - ciD;
  if (nights < 1 || nights > 30) return { ok: false, nights, error: "nights" };
  const today = daysFromYmd(jstTodayYmd());
  if (ciD < today - 3 || ciD > today + 180 || coD > today + 210) return { ok: false, nights, error: "range" };
  return { ok: true, nights };
}

/** 同一OTAコードの非取消予約を新しい順で取得（突合せず attach 判定に使う）。 */
export async function findReservationsByOtaCode(env: Env, code: string): Promise<Reservation[]> {
  const r = await env.DB.prepare(
    "SELECT * FROM reservations WHERE airbnb_reservation_code = ? AND status != 'cancelled' ORDER BY created_at DESC"
  )
    .bind(code)
    .all<Reservation>();
  return r.results ?? [];
}
/** 既存予約の日程とゲスト入力が完全一致するか（自動ひも付けの条件）。 */
export function datesAlign(res: Reservation, ci: string, co: string): boolean {
  return res.check_in_date === ci && res.check_out_date === co;
}

/** OTA自己申告の新規予約を作成（pending隔離・短期purch）。突合はしない。 */
export async function createSelfReportReservation(
  env: Env,
  args: { channel: string; code: string; ci: string; co: string; nights: number; lang: string; propertyName: string }
): Promise<Reservation> {
  const id = newId("r_");
  const now = nowIso();
  const purge = addDays(now, PENDING_PURGE_DAYS); // pendingは短期。提出/承認で昇格。
  await env.DB.prepare(
    `INSERT INTO reservations (id, airbnb_reservation_code, property_name, check_in_date, check_out_date, nights, expected_guests, preferred_lang, status, review_status, currency, channel, source, created_at, updated_at, data_purge_at)
     VALUES (?,?,?,?,?,?,0,?, 'open','pending','JPY',?, 'guest_selfreport', ?, ?, ?)`
  )
    .bind(id, args.code, args.propertyName, args.ci, args.co, args.nights, args.lang, args.channel, now, now, purge)
    .run();
  return (await getReservation(env, id))!;
}

/** pending自己申告を法定保持(5年)へ昇格（提出/承認時）。data_purge_atを作成日とCOの遅い方+保持年数に。 */
export async function promoteSelfReportRetention(env: Env, res: Reservation, retentionYears: number): Promise<void> {
  if (res.source !== "guest_selfreport") return;
  const purge = addYears(laterIso(res.created_at, res.check_out_date + "T00:00:00Z"), retentionYears);
  await env.DB.prepare("UPDATE reservations SET data_purge_at = ?, updated_at = ? WHERE id = ?")
    .bind(purge, nowIso(), res.id)
    .run();
}

// ---- レート制限（KV）----
export async function rateLimit(env: Env, key: string, limit: number, windowSec: number): Promise<boolean> {
  const k = `rl:${key}`;
  const cur = parseInt((await env.KV.get(k)) ?? "0", 10);
  if (cur >= limit) return false;
  await env.KV.put(k, String(cur + 1), { expirationTtl: windowSec });
  return true;
}

// ---- 予約 ----
export async function getReservation(env: Env, id: string): Promise<Reservation | null> {
  return await env.DB.prepare("SELECT * FROM reservations WHERE id = ?").bind(id).first<Reservation>();
}

/** 入口の二要素マッチ（予約番号＋姓）。設計 E-1
 * 自己申告(guest_selfreport)行は match_last_name=NULL のため姓照合が効かない。
 * これらを直予約導線から引き当てると姓保護をすり抜けて他人の予約へ到達できるため除外する。 */
export async function verifyReservation(env: Env, code: string, lastName: string): Promise<Reservation | null> {
  const res = await env.DB.prepare(
    "SELECT * FROM reservations WHERE airbnb_reservation_code = ? AND status != 'cancelled' AND source != 'guest_selfreport'"
  )
    .bind(code.trim())
    .first<Reservation>();
  if (!res) return null;
  if (res.match_last_name && res.match_last_name !== normalizeName(lastName)) return null;
  return res;
}

/** 予約に「提出済み」ゲストが1名でもいるか。OTA自動合流の可否（既存PII露出の防止）に使う。 */
export async function hasSubmittedGuests(env: Env, reservationId: string): Promise<boolean> {
  const r = await env.DB.prepare(
    "SELECT 1 FROM guests WHERE reservation_id = ? AND submit_status = 'submitted' LIMIT 1"
  )
    .bind(reservationId)
    .first<{ 1: number }>();
  return !!r;
}

/** 直近の自己申告作成回数（IPハッシュ単位）。KVレート制限のTOCTOUを補うD1ベースの上限判定に使う。 */
export async function recentSelfReportCount(env: Env, ipHash: string, sinceIso: string): Promise<number> {
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM audit_logs WHERE ip_hash = ? AND action IN ('ota_selfreport_new','ota_selfreport_mismatch') AND created_at >= ?"
  )
    .bind(ipHash, sinceIso)
    .first<{ c: number }>();
  return r?.c ?? 0;
}

// ---- トークン ----
export async function createGroupToken(env: Env, reservationId: string, expiresAt: string): Promise<string> {
  const token = generateToken();
  const th = await hashToken(token);
  await env.DB.prepare(
    "INSERT INTO group_tokens (id, reservation_id, token_hash, expires_at, created_at) VALUES (?,?,?,?,?)"
  )
    .bind(newId("gt_"), reservationId, th, expiresAt, nowIso())
    .run();
  return token;
}

export async function resolveGroupToken(env: Env, token: string): Promise<Reservation | null> {
  const th = await hashToken(token);
  const row = await env.DB.prepare(
    "SELECT reservation_id, expires_at, revoked_at FROM group_tokens WHERE token_hash = ?"
  )
    .bind(th)
    .first<{ reservation_id: string; expires_at: string; revoked_at: string | null }>();
  if (!row || row.revoked_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return await getReservation(env, row.reservation_id);
}

export async function resolveGuestToken(env: Env, token: string): Promise<Guest | null> {
  const th = await hashToken(token);
  const row = await env.DB.prepare(
    "SELECT guest_id, expires_at, revoked_at FROM guest_tokens WHERE token_hash = ?"
  )
    .bind(th)
    .first<{ guest_id: string; expires_at: string; revoked_at: string | null }>();
  if (!row || row.revoked_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return await getGuest(env, row.guest_id);
}

// ---- 宿泊者 ----
export async function getGuest(env: Env, id: string): Promise<Guest | null> {
  return await env.DB.prepare("SELECT * FROM guests WHERE id = ?").bind(id).first<Guest>();
}

export async function getGuestsByReservation(env: Env, reservationId: string): Promise<Guest[]> {
  const r = await env.DB.prepare(
    "SELECT * FROM guests WHERE reservation_id = ? ORDER BY slot_no ASC"
  )
    .bind(reservationId)
    .all<Guest>();
  return r.results ?? [];
}

/** 代表者の人数申告：空のdraft行を slot 1..count 作成し、各個人トークンを発行して返す。 */
export async function declareGuests(
  env: Env,
  res: Reservation,
  count: number
): Promise<{ guestId: string; slotNo: number; role: string; token: string }[]> {
  const expiresAt = checkoutExpiry(res.check_out_date);

  const out: { guestId: string; slotNo: number; role: string; token: string }[] = [];
  const now = nowIso();
  // 画像の保持満了も本体(data_purge_at)と同じく「作成日とCOの遅い方」基準に揃える（画像だけ先に消える非対称を防ぐ）
  const imgPurge = addYears(laterIso(res.created_at, res.check_out_date + "T00:00:00Z"), parseInt(env.DATA_RETENTION_YEARS || "5", 10));

  for (let slot = 1; slot <= count; slot++) {
    const guestId = newId("g_");
    const role = slot === 1 ? "representative" : "companion";
    await env.DB.prepare(
      `INSERT INTO guests (id, reservation_id, member_role, slot_no, img_purge_at, submit_status, filled_by, created_at, updated_at)
       VALUES (?,?,?,?,?, 'draft', 'self', ?, ?)`
    )
      .bind(guestId, res.id, role, slot, imgPurge, now, now)
      .run();

    const token = generateToken();
    const th = await hashToken(token);
    await env.DB.prepare(
      "INSERT INTO guest_tokens (id, guest_id, token_hash, expires_at, created_at) VALUES (?,?,?,?,?)"
    )
      .bind(newId("pt_"), guestId, th, expiresAt, now)
      .run();
    out.push({ guestId, slotNo: slot, role, token });
  }

  // expected_guests と data_purge_at を更新
  // 自己申告pendingは「短期purch」を維持（提出/承認で法定保持へ昇格）。濫用での過剰保持を防ぐ。
  const isPendingSelfReport = res.source === "guest_selfreport" && res.review_status !== "approved";
  const dataPurge = isPendingSelfReport
    ? res.data_purge_at ?? addDays(res.created_at, PENDING_PURGE_DAYS)
    : addYears(laterIso(res.created_at, res.check_out_date + "T00:00:00Z"), parseInt(env.DATA_RETENTION_YEARS || "5", 10));
  await env.DB.prepare(
    "UPDATE reservations SET declared_guests = ?, expected_guests = ?, data_purge_at = ?, updated_at = ? WHERE id = ?"
  )
    .bind(count, count, dataPurge, now, res.id)
    .run();

  return out;
}

export function computeProgress(guests: Guest[], expected: number): { done: number; total: number } {
  const done = guests.filter((g) => g.submit_status === "submitted").length;
  return { done, total: expected || guests.length };
}

// ---- 監査ログ（追記専用＋ハッシュチェーン）----
export async function appendAudit(
  env: Env,
  entry: {
    reservationId?: string | null;
    guestId?: string | null;
    actorType: "admin" | "guest" | "system";
    actorId?: string | null;
    action: string;
    detail?: Record<string, unknown>;
    ipHash?: string | null;
  }
): Promise<void> {
  const last = await env.DB.prepare(
    "SELECT row_hash FROM audit_logs ORDER BY created_at DESC LIMIT 1"
  ).first<{ row_hash: string }>();
  const prev = last?.row_hash ?? "";
  const createdAt = nowIso();
  const id = newId("al_");
  const detailJson = entry.detail ? JSON.stringify(entry.detail) : null;
  const rowHash = await hashToken(
    [prev, id, entry.reservationId ?? "", entry.guestId ?? "", entry.actorType, entry.actorId ?? "", entry.action, detailJson ?? "", createdAt].join("|")
  );
  await env.DB.prepare(
    `INSERT INTO audit_logs (id, reservation_id, guest_id, actor_type, actor_id, action, detail, ip_hash, prev_hash, row_hash, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      id,
      entry.reservationId ?? null,
      entry.guestId ?? null,
      entry.actorType,
      entry.actorId ?? null,
      entry.action,
      detailJson,
      entry.ipHash ?? null,
      prev,
      rowHash,
      createdAt
    )
    .run();
}
