# Hilltop Zushi 宿泊者名簿アプリ（MVP）

Airbnb予約ごとに「グループ専用URL」を発行し、最大12名の宿泊者が自分のスマホから
法定名簿項目を入力できる、**中国本土からもアクセスできる**多言語（日/英/簡/繁）Webアプリ。
Googleフォームの置き換え。設計の全体像は親フォルダの [`../DESIGN.md`](../DESIGN.md) を参照。

## 本番（デプロイ済み）
- ゲスト入口: https://hilltop-guest-registration.2520000530.workers.dev/start
- 管理画面: https://hilltop-guest-registration.2520000530.workers.dev/admin
- 管理者は **複数管理者＋メール/パスワード＋TOTP 2FA**。初回ログインでパスワード変更＋2FA登録。
  マスターは `/admin/admins` で管理者の追加・無効化・一覧（誰が管理者か）を確認できる。
- パスポート画像は **KVに暗号化保存**（R2は当アカウントで未有効化のため。将来R2へ移行可）。
- ⚠ **予約はまだ手動投入**（下記）。iCal自動取り込みは次段階のTODO。

### 予約の登録（現状）
ゲストが入口で照合できるよう、予約を先にD1へ入れる（`match_last_name` は小文字・空白除去した姓）:
```bash
npx wrangler d1 execute hilltop-guest --remote --command \
 "INSERT INTO reservations (id,airbnb_reservation_code,property_name,check_in_date,check_out_date,nights,preferred_lang,match_last_name,status,review_status,created_at,updated_at) \
  VALUES ('r_xxxx','HMABCDEFG','Hilltop Zushi','2026-08-01','2026-08-03',2,'ja','smith','open','pending',datetime('now'),datetime('now'));"
```
→ ゲストには `https://.../start` を案内（予約番号＋姓で照合→人数申告→各自入力）。

## 技術構成
- **Cloudflare Workers + Hono**（サーバー描画・最小JS＝中国向けに軽量）
- **D1**（名簿DB）／**R2**（パスポート画像・検疫/本番の2バケット）／**KV**（レート制限・将来の進捗キャッシュ）
- 機微情報（住所・旅券番号・電話・画像）は**アプリ層でAES-256-GCMエンベロープ暗号化**して保存

## 実装済み（MVP）
- 入口 `/start`：予約番号＋姓の**二要素マッチ**＋レート制限（設計 E-1）
- グループ入口 `/g/:token`：代表者の**人数申告**→人数分の枠＋個人リンク自動生成（17-1）
- 個人入力 `/p/:token`：多言語フォーム・条件付き必須（外国人かつ国内住所なし＝旅券番号＋画像必須）・
  重要事項の明示（人数厳守／超過3倍／法令協力 17-2）・プライバシー＋越境移転の**必須同意**・
  おまけ「選んだ理由」（代表のみ 17-3）・**任意マーケ同意**＋評価10%OFF案内（17-4）
- 進捗ダッシュボード：**氏名＋済/未のみ**（機微情報はAPIに含めない＝設計の核）
- 画像：クライアント圧縮（長辺2000px/JPEG）→Worker検証（サイズ/マジックナンバー）→暗号化→R2本番
- 管理画面 `/admin`（**複数管理者・メール/パスワード・TOTP 2FA・KVセッション**）：予約一覧／名簿詳細／
  **認証済みプロキシ画像配信**（署名URLを渡さない）／承認／暗証番号の短命リンク発行／CSV出力／
  マスターによる管理者管理（追加・無効化・一覧）。操作者メールを監査ログに記録。
- 監査ログ：**追記専用＋ハッシュチェーン**

## セットアップ
```bash
npm install

# Cloudflare 資源を作成し、出力IDを wrangler.toml に貼る
npx wrangler d1 create hilltop-guest
npx wrangler kv namespace create KV
npx wrangler r2 bucket create hilltop-guest-quarantine
npx wrangler r2 bucket create hilltop-guest-passports

# ローカル用シークレット
cp .dev.vars.example .dev.vars
#  MASTER_KEY を生成:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
#  管理パスワードのハッシュ:
node -e "process.stdout.write(require('crypto').createHash('sha256').update('PASSWORD').digest('hex'))"

# DBスキーマ適用（ローカル）
npm run db:migrate:local

# 起動
npm run dev
```

### 動作確認（ローカル）
1. D1に予約を1件入れる（例）:
   ```sql
   INSERT INTO reservations (id, airbnb_reservation_code, property_name, check_in_date, check_out_date, nights, preferred_lang, match_last_name, status, review_status, created_at, updated_at)
   VALUES ('r_test','HMABCD1234','Hilltop Zushi','2026-07-10','2026-07-12',2,'ja','tanaka','open','pending', datetime('now'), datetime('now'));
   ```
   （`wrangler d1 execute hilltop-guest --local --command "..."`）
2. `http://localhost:8787/start` → 予約番号 `HMABCD1234` ＋ 姓 `tanaka` で確認
3. 人数を申告→個人リンクで入力→`/admin` で確認（.dev.vars の ADMIN_USER/PW）

## デプロイ
```bash
npm run db:migrate                 # 本番D1にスキーマ適用（0001, 0002）
npx wrangler secret put MASTER_KEY # 機微情報の暗号化鍵（base64 32バイト）
npm run deploy
```
最初のマスター管理者を seed（メール＋仮パスワード。初回ログインでパスワード変更＋2FA登録）:
```bash
EMAIL="owner@example.com"; TMP="$(node -e "console.log(require('crypto').randomBytes(9).toString('base64').replace(/[^A-Za-z0-9]/g,'').slice(0,12))")"
read SALT HASH < <(node -e "const c=require('crypto');const s=c.randomBytes(16);const h=c.pbkdf2Sync(process.argv[1],s,100000,32,'sha256');console.log(s.toString('base64'),h.toString('base64'))" "$TMP")
npx wrangler d1 execute hilltop-guest --remote --command \
 "INSERT INTO admins (id,email,email_norm,password_hash,password_salt,password_iter,totp_enabled,is_master,status,must_change_pw,created_at) \
  VALUES ('adm_$(node -e "console.log(require('crypto').randomBytes(12).toString('hex'))")','$EMAIL','$EMAIL','$HASH','$SALT',100000,0,1,'active',1,datetime('now'));"
echo "仮パスワード: $TMP"
```
> ⚠ `MASTER_KEY` を失うと既存の機微データは復号不能になります。**オフライン分散保管**してください。
> ⚠ PBKDF2の反復回数は **100000**（Cloudflare Workersの上限）。seedも必ず同じ値で。
> 以降の管理者追加はマスターが `/admin/admins` から行えます（seed不要）。

## まだ未実装 / 次の段階（設計の拡張1〜2）
- [ ] iCal自動取得→予約とトークンの自動発行（現状は予約をDBに手動投入）
- [ ] 画像の**再エンコード無害化**（Cloudflare Images等。現状はマジックナンバー検証のみ：設計 B-2）
- [ ] **R2を有効化**して画像をR2へ（署名直PUT＋再エンコード無害化）。現状は画像をKVに暗号化保存
- [ ] **画像アップロード成功率テレメトリ**＋失敗時のメール/WeChatフォールバック（設計 D-1）
- [ ] Cron（`scheduled()`）での**自動削除（5年）**と**未提出リマインド**
- [x] 管理者認証＝複数管理者＋メール/パスワード＋TOTP 2FA（実装済み）。さらに堅牢化するなら Cloudflare Access も可
- [ ] CSVの **Shift_JIS** 出力（現状はUTF-8 BOM。WorkersはSJIS非対応のため要変換）
- [ ] ブラックリスト照合（正規化＋完全一致）→Slack承認ボタン
- [ ] 暗証番号の実体管理（keybox_codes）と `/pin` 表示の実装
- [ ] プライバシーポリシー本文（多言語）と利用規約ページ
- [ ] 中国系フォーム保険ルート（金数据/問巻星・越境同意・画像/旅券は通さない）

## 重要な設計判断（決定済み）
- データ保存期間 = **5年**（名簿・画像とも。法定名簿3年以上を満たすオーナー方針）
- 超過料金 = 申告超過1名につき**通常追加料金の3倍**
- Googleマップ評価クーポン = **10%OFF**
