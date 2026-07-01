-- 完了通知・督促リマインド・代表者メール事前入力のための追加カラム
ALTER TABLE reservations ADD COLUMN rep_email_hint TEXT;          -- 予約作成時に分かっていれば代表者メールを先に登録（リマインド送付用）
ALTER TABLE reservations ADD COLUMN completion_notified_at TEXT;  -- 全員完了通知を送った日時（二重送信防止）
