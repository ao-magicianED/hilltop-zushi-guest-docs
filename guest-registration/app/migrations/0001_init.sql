-- Hilltop Zushi 宿泊者名簿アプリ 初期スキーマ
-- 設計書 DESIGN.md ⑤＋⑰(v1.1/v1.2) を統合。保存期間=5年（オーナー決定 v1.2）。
-- 機微カラムは _enc 接尾辞 = アプリ層でエンベロープ暗号化した文字列を格納。

-- 予約（グループ）
CREATE TABLE reservations (
  id                      TEXT PRIMARY KEY,
  airbnb_reservation_code TEXT,                         -- 予約番号（NULL可：手動作成あり）
  property_name           TEXT NOT NULL DEFAULT 'Hilltop Zushi',
  check_in_date           TEXT NOT NULL,                -- YYYY-MM-DD
  check_out_date          TEXT NOT NULL,
  nights                  INTEGER NOT NULL DEFAULT 0,
  expected_guests         INTEGER NOT NULL DEFAULT 0,   -- 進捗の分母（代表者申告で確定）
  declared_guests         INTEGER,                      -- 代表者の申告人数（17-1）
  declared_by_guest_id    TEXT,
  declared_at             TEXT,
  preferred_lang          TEXT NOT NULL DEFAULT 'ja',   -- ja/en/zh-CN/zh-TW
  -- 入口の二要素マッチ用（設計 E-1）。姓・人数のいずれかを照合に使う
  match_last_name         TEXT,                         -- 照合用に正規化した姓（小文字・空白除去）
  ical_uid                TEXT,                         -- iCal由来の安定キー（UPSERT用）
  status                  TEXT NOT NULL DEFAULT 'open', -- open/closed/cancelled
  review_status           TEXT NOT NULL DEFAULT 'pending', -- pending/approved/rejected
  pin_sent_at             TEXT,
  pin_override            INTEGER NOT NULL DEFAULT 0,
  pin_override_reason     TEXT,
  terms_ack_at            TEXT,                         -- 重要事項（人数厳守・超過3倍・法令協力）同意 17-2
  terms_ack_by            TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  data_purge_at           TEXT                          -- 名簿削除予定（作成日とCOの遅い方＋5年）
);
CREATE UNIQUE INDEX idx_res_ical ON reservations(ical_uid);
CREATE INDEX idx_res_airbnb ON reservations(airbnb_reservation_code); -- 非UNIQUE（E-2）
CREATE INDEX idx_res_status ON reservations(status);

-- 宿泊者メンバー
CREATE TABLE guests (
  id                      TEXT PRIMARY KEY,
  reservation_id          TEXT NOT NULL,
  member_role             TEXT NOT NULL DEFAULT 'companion', -- representative/companion
  slot_no                 INTEGER NOT NULL,             -- 1..12（1=代表）
  -- 法定・収集項目
  full_name               TEXT,
  has_jp_address          INTEGER,                      -- 1=日本国内に住所あり 0=なし
  address_enc             TEXT,                         -- 🔒
  prev_stay               TEXT,
  next_stay               TEXT,
  occupation              TEXT,                         -- コード値
  nationality             TEXT,                         -- コード値
  nationality_other       TEXT,
  passport_no_enc         TEXT,                         -- 🔒
  phone_enc               TEXT,                         -- 🔒（代表必須・同行任意）
  phone_role              TEXT,                         -- emergency 等
  email                   TEXT,                         -- 連絡先（17-4）
  age                     INTEGER,
  gender                  TEXT,                         -- MALE/FEMALE/X
  -- パスポート画像（実体はR2本番バケット）
  passport_img_key        TEXT,
  passport_img_mime       TEXT,
  passport_img_size       INTEGER,
  passport_img_uploaded_at TEXT,
  img_purge_at            TEXT,                         -- 画像削除予定（=CO+5年）
  -- 本人確認の証跡（画像を消しても残す）
  idcheck_verifier        TEXT,
  idcheck_at              TEXT,
  idcheck_passport_tail   TEXT,                         -- 旅券番号末尾4桁
  idcheck_note            TEXT,
  id_verified             INTEGER NOT NULL DEFAULT 0,
  -- おまけ（代表者のみ・任意）17-3
  choose_reason           TEXT,                         -- 選択コードのJSON配列
  choose_reason_other     TEXT,
  -- 任意マーケ同意 17-4（法定同意と別）
  marketing_optin         INTEGER NOT NULL DEFAULT 0,
  marketing_optin_at      TEXT,
  review_coupon_sent_at    TEXT,
  -- 状態
  submit_status           TEXT NOT NULL DEFAULT 'draft', -- draft/submitted/void
  submitted_at            TEXT,
  submit_rule_version     TEXT,
  filled_by               TEXT NOT NULL DEFAULT 'self', -- self/representative
  consent_at              TEXT,
  consent_lang            TEXT,
  consent_privacy         INTEGER NOT NULL DEFAULT 0, -- プライバシーポリシー同意（証跡）
  consent_cross_border    INTEGER NOT NULL DEFAULT 0, -- 越境移転同意（証跡）
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE
);
CREATE INDEX idx_guests_res ON guests(reservation_id);
CREATE UNIQUE INDEX idx_guests_slot ON guests(reservation_id, slot_no);

-- グループURLの鍵（予約全体）
CREATE TABLE group_tokens (
  id             TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL,
  token_hash     TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  revoked_at     TEXT,
  created_at     TEXT NOT NULL,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_grouptoken_hash ON group_tokens(token_hash);

-- 個人入力URLの鍵
CREATE TABLE guest_tokens (
  id         TEXT PRIMARY KEY,
  guest_id   TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_guesttoken_hash ON guest_tokens(token_hash);

-- 暗証番号表示用の短命トークン（一度だけ開く）
CREATE TABLE pin_view_tokens (
  id             TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL,
  token_hash     TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  viewed_at      TEXT,
  created_at     TEXT NOT NULL,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_pinview_hash ON pin_view_tokens(token_hash);

-- 暗証番号（既定はメタのみ。本体保存は任意：E-4）
CREATE TABLE keybox_codes (
  id             TEXT PRIMARY KEY,
  reservation_id TEXT,
  code_enc       TEXT,                                  -- 🔒（任意。NULL=本体保存しない）
  active         INTEGER NOT NULL DEFAULT 1,
  changed_by     TEXT,
  changed_at     TEXT NOT NULL
);

-- 監査ログ（追記専用＋ハッシュチェーン：E-5）
CREATE TABLE audit_logs (
  id             TEXT PRIMARY KEY,
  reservation_id TEXT,
  guest_id       TEXT,
  actor_type     TEXT NOT NULL,                         -- admin/guest/system
  actor_id       TEXT,
  action         TEXT NOT NULL,
  detail         TEXT,                                  -- JSON（PIIは入れない）
  ip_hash        TEXT,
  prev_hash      TEXT,
  row_hash       TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_audit_res ON audit_logs(reservation_id);
CREATE INDEX idx_audit_action ON audit_logs(action);

-- ブラックリスト（ハッシュ＝正規化＋完全一致のみ：F-3）
CREATE TABLE blacklist (
  id               TEXT PRIMARY KEY,
  match_type       TEXT NOT NULL,                       -- name/passport/phone/address
  match_value_hash TEXT NOT NULL,
  reason           TEXT,
  severity         TEXT NOT NULL DEFAULT 'warn',        -- warn/block
  created_by       TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_bl_value ON blacklist(match_value_hash);

CREATE TABLE blacklist_hits (
  id             TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL,
  guest_id       TEXT NOT NULL,
  blacklist_id   TEXT NOT NULL,
  match_kind     TEXT NOT NULL DEFAULT 'exact',
  matched_at     TEXT NOT NULL,
  resolved       INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE
);

-- リマインド履歴
CREATE TABLE reminders (
  id             TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL,
  guest_id       TEXT,
  channel        TEXT NOT NULL,                         -- airbnb/email/wechat/slack
  due_date       TEXT,
  sent_at        TEXT NOT NULL,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE
);
CREATE INDEX idx_reminders_res ON reminders(reservation_id);

-- バックアップのpurge管理（B-5）
CREATE TABLE backup_purge_queue (
  id               TEXT PRIMARY KEY,
  target_kind      TEXT NOT NULL,                       -- d1/r2
  target_ref       TEXT NOT NULL,
  source_deleted_at TEXT NOT NULL,
  backup_purge_at  TEXT NOT NULL,
  purged_at        TEXT
);
