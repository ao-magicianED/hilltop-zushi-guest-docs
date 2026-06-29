// 管理者認証：パスワードハッシュ(PBKDF2)・管理者CRUD・KVセッション
import type { Env } from "../types";
import { newId, generateToken } from "./tokens";
import { nowIso } from "./db";

function b64e(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}
function b64d(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Cloudflare Workers の Web Crypto は PBKDF2 の反復回数を最大100,000に制限している
const DEFAULT_ITER = 100000;

export async function hashPassword(
  password: string,
  saltB64?: string,
  iter = DEFAULT_ITER
): Promise<{ hash: string; salt: string; iter: number }> {
  const salt = saltB64 ? b64d(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, key, 256);
  return { hash: b64e(new Uint8Array(bits)), salt: b64e(salt), iter };
}

export async function verifyPassword(password: string, hashB64: string, saltB64: string, iter: number): Promise<boolean> {
  const { hash } = await hashPassword(password, saltB64, iter);
  if (hash.length !== hashB64.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ hashB64.charCodeAt(i);
  return diff === 0;
}

// ---- 管理者 ----
export type Admin = {
  id: string;
  email: string;
  email_norm: string;
  password_hash: string;
  password_salt: string;
  password_iter: number;
  totp_secret: string | null;
  totp_enabled: number;
  is_master: number;
  status: string;
  must_change_pw: number;
  created_by: string | null;
  created_at: string;
  last_login_at: string | null;
};

export async function getAdminByEmail(env: Env, email: string): Promise<Admin | null> {
  return await env.DB.prepare("SELECT * FROM admins WHERE email_norm = ?").bind(normalizeEmail(email)).first<Admin>();
}
export async function getAdminById(env: Env, id: string): Promise<Admin | null> {
  return await env.DB.prepare("SELECT * FROM admins WHERE id = ?").bind(id).first<Admin>();
}
export async function listAdmins(env: Env): Promise<Admin[]> {
  const r = await env.DB.prepare("SELECT * FROM admins ORDER BY created_at ASC").all<Admin>();
  return r.results ?? [];
}
export async function countAdmins(env: Env): Promise<number> {
  const r = await env.DB.prepare("SELECT count(*) AS c FROM admins").first<{ c: number }>();
  return r?.c ?? 0;
}

export async function createAdmin(
  env: Env,
  opts: { email: string; password: string; isMaster?: boolean; createdBy?: string; mustChangePw?: boolean }
): Promise<Admin> {
  const { hash, salt, iter } = await hashPassword(opts.password);
  const id = newId("adm_");
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO admins (id, email, email_norm, password_hash, password_salt, password_iter, is_master, status, must_change_pw, created_by, created_at)
     VALUES (?,?,?,?,?,?,?, 'active', ?, ?, ?)`
  )
    .bind(id, opts.email.trim(), normalizeEmail(opts.email), hash, salt, iter, opts.isMaster ? 1 : 0, opts.mustChangePw ? 1 : 0, opts.createdBy ?? null, now)
    .run();
  return (await getAdminById(env, id))!;
}

export async function setAdminStatus(env: Env, id: string, status: "active" | "disabled"): Promise<void> {
  await env.DB.prepare("UPDATE admins SET status = ? WHERE id = ?").bind(status, id).run();
}
export async function setAdminTotp(env: Env, id: string, secret: string): Promise<void> {
  await env.DB.prepare("UPDATE admins SET totp_secret = ?, totp_enabled = 1 WHERE id = ?").bind(secret, id).run();
}
export async function setAdminPassword(env: Env, id: string, password: string, mustChange = false): Promise<void> {
  const { hash, salt, iter } = await hashPassword(password);
  await env.DB.prepare("UPDATE admins SET password_hash=?, password_salt=?, password_iter=?, must_change_pw=? WHERE id=?")
    .bind(hash, salt, iter, mustChange ? 1 : 0, id)
    .run();
}
export async function touchLogin(env: Env, id: string): Promise<void> {
  await env.DB.prepare("UPDATE admins SET last_login_at = ? WHERE id = ?").bind(nowIso(), id).run();
}

// ---- セッション・一時状態（KV）----
export type Session = { adminId: string; email: string; isMaster: boolean; exp: number };

export async function createSession(env: Env, admin: Admin, ttlSec = 8 * 3600): Promise<string> {
  const token = generateToken();
  const sess: Session = { adminId: admin.id, email: admin.email, isMaster: admin.is_master === 1, exp: Date.now() + ttlSec * 1000 };
  await env.KV.put(`sess:${token}`, JSON.stringify(sess), { expirationTtl: ttlSec });
  return token;
}
export async function getSession(env: Env, token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  const raw = await env.KV.get(`sess:${token}`);
  if (!raw) return null;
  const s = JSON.parse(raw) as Session;
  if (s.exp < Date.now()) {
    await env.KV.delete(`sess:${token}`);
    return null;
  }
  return s;
}
export async function destroySession(env: Env, token: string | undefined): Promise<void> {
  if (token) await env.KV.delete(`sess:${token}`);
}

// 一時状態（2FA待ち・TOTP登録待ち）汎用
export async function putTemp(env: Env, prefix: string, value: object, ttlSec: number): Promise<string> {
  const token = generateToken();
  await env.KV.put(`${prefix}:${token}`, JSON.stringify(value), { expirationTtl: ttlSec });
  return token;
}
export async function getTemp<T>(env: Env, prefix: string, token: string | undefined): Promise<T | null> {
  if (!token) return null;
  const raw = await env.KV.get(`${prefix}:${token}`);
  return raw ? (JSON.parse(raw) as T) : null;
}
export async function delTemp(env: Env, prefix: string, token: string | undefined): Promise<void> {
  if (token) await env.KV.delete(`${prefix}:${token}`);
}
