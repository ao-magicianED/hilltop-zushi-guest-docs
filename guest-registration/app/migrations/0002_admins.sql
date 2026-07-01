-- 管理者（複数）＋2FA(TOTP)。設計 A0 の本番認証像。
-- セッションは KV（sess:<token>）で管理するためテーブルは持たない。
CREATE TABLE admins (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL,
  email_norm     TEXT NOT NULL,                 -- 小文字正規化（一意キー）
  password_hash  TEXT NOT NULL,                 -- PBKDF2-SHA256 で導出（base64）
  password_salt  TEXT NOT NULL,                 -- base64
  password_iter  INTEGER NOT NULL DEFAULT 210000,
  totp_secret    TEXT,                          -- base32（登録後に設定）
  totp_enabled   INTEGER NOT NULL DEFAULT 0,    -- 1=2FA有効
  is_master      INTEGER NOT NULL DEFAULT 0,    -- 1=管理者の管理ができる
  status         TEXT NOT NULL DEFAULT 'active',-- active/disabled
  must_change_pw INTEGER NOT NULL DEFAULT 0,    -- 1=初回ログインでパスワード変更を促す
  created_by     TEXT,                          -- 追加した管理者のメール
  created_at     TEXT NOT NULL,
  last_login_at  TEXT
);
CREATE UNIQUE INDEX idx_admins_email ON admins(email_norm);
CREATE INDEX idx_admins_status ON admins(status);
