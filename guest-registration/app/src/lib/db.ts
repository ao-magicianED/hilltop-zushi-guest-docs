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

/** 入口の二要素マッチ（予約番号＋姓）。設計 E-1 */
export async function verifyReservation(env: Env, code: string, lastName: string): Promise<Reservation | null> {
  const res = await env.DB.prepare(
    "SELECT * FROM reservations WHERE airbnb_reservation_code = ? AND status != 'cancelled'"
  )
    .bind(code.trim())
    .first<Reservation>();
  if (!res) return null;
  if (res.match_last_name && res.match_last_name !== normalizeName(lastName)) return null;
  return res;
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
  const imgPurge = addYears(res.check_out_date, parseInt(env.DATA_RETENTION_YEARS || "5", 10));

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
  const dataPurge = addYears(laterIso(res.created_at, res.check_out_date + "T00:00:00Z"), parseInt(env.DATA_RETENTION_YEARS || "5", 10));
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
