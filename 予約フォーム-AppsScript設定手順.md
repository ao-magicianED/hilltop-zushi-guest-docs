# 予約リクエストフォーム — Google Apps Script 設定手順

サイトの「予約リクエスト」フォームの送信先を作ります。送信内容が**スプレッドシートに自動で貯まり**、
あなたに**メール通知**が届きます。1回設定すれば終わりです。

## 手順（10分・コピペでOK）

1. Googleドライブで新しい**スプレッドシート**を作る（名前: 例「Hilltop Zushi 予約リクエスト」）。
2. 上部メニュー **拡張機能 → Apps Script** を開く。
3. 出てきたエディタの中身を全部消して、下の `コード.gs` を丸ごと貼り付ける。
4. コード内の `NOTIFY_EMAIL` を**あなたの受信したいメール**に書き換える。
5. 右上 **デプロイ → 新しいデプロイ** → 種類「**ウェブアプリ**」を選択。
   - 説明: 任意（例: form v1）
   - 次のユーザーとして実行: **自分**
   - アクセスできるユーザー: **全員**
6. 「デプロイ」→ 初回は権限許可を求められるので承認。
7. 表示される **ウェブアプリのURL**（`https://script.google.com/macros/s/..../exec`）をコピー。
8. その**URLを私（Claude）に貼って**ください。サイトのフォーム送信先に設定します。

> 既存のGoogleフォームではなく、サイト内フォーム→このGAS、にする理由：見た目を統一でき、
> 多言語のまま送れて、データが自分のスプレッドシートに残るため（Codex推奨構成）。

---

## コード.gs（丸ごと貼り付け）

```javascript
// 予約リクエスト受信 — Hilltop Zushi
const NOTIFY_EMAIL = 'ao.magician@gmail.com'; // ←受信したいメールに変更

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const p = (e && e.parameter) ? e.parameter : {};

    // 1) ハニーポット: bot が隠し項目(company)を埋めていたら静かに破棄
    if (p.company) return ok_();

    // 2) 必須・形式チェック（不正は破棄して攻撃者に情報を返さない）
    const name = String(p.name || '').trim();
    const email = String(p.email || '').trim();
    const checkin = String(p.checkin || '').trim();
    const checkout = String(p.checkout || '').trim();
    const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
    const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(checkin) && /^\d{4}-\d{2}-\d{2}$/.test(checkout) && checkin < checkout;
    if (!name || !emailOk || !dateOk) return ok_();

    // 3) 簡易レート制限: 同一メールの連投を60秒ブロック
    const cache = CacheService.getScriptCache();
    if (cache.get('rl_' + email)) return ok_();
    cache.put('rl_' + email, '1', 60);

    // 4) 長さ制限 + 式注入対策(=,+,-,@ 始まりは先頭に ' を付与)
    const clip = function (s, n) { return String(s == null ? '' : s).slice(0, n); };
    const safe = function (s, n) { s = clip(s, n); return /^[=+\-@]/.test(s) ? "'" + s : s; };

    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    if (sh.getLastRow() === 0) {
      sh.appendRow(['受信日時','チェックイン','チェックアウト','人数','お名前','メール','電話','言語','ご質問・ご要望']);
    }
    sh.appendRow([
      new Date(), safe(checkin, 12), safe(checkout, 12), safe(p.guests, 4),
      safe(name, 100), safe(email, 200), safe(p.phone, 40),
      safe(p.lang, 8), safe(p.message, 2000)
    ]);

    MailApp.sendEmail(NOTIFY_EMAIL, '【Hilltop Zushi】予約リクエスト: ' + clip(name, 80),
      'チェックイン: ' + checkin + '\nチェックアウト: ' + checkout +
      '\n人数: ' + clip(p.guests, 4) + '\nお名前: ' + name + '\nメール: ' + email +
      '\n電話: ' + clip(p.phone, 40) + '\n言語: ' + clip(p.lang, 8) +
      '\nご質問・ご要望:\n' + clip(p.message, 2000));

    return ok_();
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function ok_() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput('Hilltop Zushi form endpoint is alive.');
}
```

## 仕組みメモ
- サイト側は `fetch(URL, {method:'POST', mode:'no-cors', body: フォームデータ})` で送信（CORS回避のため
  応答は読まず、送信できたら成功表示）。データはスプレッドシートとメールに届く。
- 送信項目: checkin / checkout / guests / name / email / phone / lang / message / company(ハニーポット)
- 上記コードはスパム対策込み: ①ハニーポット ②必須/メール/日付の形式チェック ③同一メール60秒レート制限
  ④式注入対策(=+-@始まりを無害化) ⑤LockServiceで競合防止。不正な送信は黙って破棄。
- 注意: `mode:'no-cors'` は応答を読めないため、サイトは「送信失敗」を検知できない。将来より厳密にするなら
  Cloudflare Pages Function `POST /request` を作り、GAS URLをSecretにしてサーバー側中継→同一オリジンで応答を読む構成にできる（任意）。
