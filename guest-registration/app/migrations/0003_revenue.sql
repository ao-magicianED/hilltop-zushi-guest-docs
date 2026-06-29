-- 予約に売上・チャネル情報を追加（ADR/稼働率/RevPAR等の指標算出元）
ALTER TABLE reservations ADD COLUMN total_amount INTEGER;     -- 総額（税送料込みの受取額・通貨はcurrency）
ALTER TABLE reservations ADD COLUMN cleaning_fee INTEGER;     -- 清掃料（ADRは室料=総額-清掃料で算出）
ALTER TABLE reservations ADD COLUMN currency TEXT NOT NULL DEFAULT 'JPY';
ALTER TABLE reservations ADD COLUMN channel TEXT NOT NULL DEFAULT 'airbnb'; -- airbnb/direct/other
ALTER TABLE reservations ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';  -- manual/ical
ALTER TABLE reservations ADD COLUMN notes TEXT;
