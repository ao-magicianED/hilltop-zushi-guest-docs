-- 「今回のご利用用途」（独自ルール・代表者向け）を追加
ALTER TABLE guests ADD COLUMN stay_purpose TEXT;        -- コード値（family/friends_family/company/friends/couple/other）
ALTER TABLE guests ADD COLUMN stay_purpose_other TEXT;  -- otherの自由記入
