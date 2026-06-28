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
  try {
    const p = (e && e.parameter) ? e.parameter : {};
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];

    // 初回: ヘッダー行を用意
    if (sh.getLastRow() === 0) {
      sh.appendRow(['受信日時','チェックイン','チェックアウト','人数','お名前','メール','電話','言語','ご質問・ご要望']);
    }

    const row = [
      new Date(),
      p.checkin || '', p.checkout || '', p.guests || '',
      p.name || '', p.email || '', p.phone || '',
      p.lang || '', p.message || ''
    ];
    sh.appendRow(row);

    // オーナーへ通知メール
    const body =
      '新しい予約リクエストが届きました。\n\n' +
      'チェックイン: ' + (p.checkin || '-') + '\n' +
      'チェックアウト: ' + (p.checkout || '-') + '\n' +
      '人数: ' + (p.guests || '-') + '\n' +
      'お名前: ' + (p.name || '-') + '\n' +
      'メール: ' + (p.email || '-') + '\n' +
      '電話: ' + (p.phone || '-') + '\n' +
      '言語: ' + (p.lang || '-') + '\n' +
      'ご質問・ご要望:\n' + (p.message || '-') + '\n';
    MailApp.sendEmail(NOTIFY_EMAIL, '【Hilltop Zushi】予約リクエスト: ' + (p.name || '名前なし'), body);

    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService.createTextOutput('Hilltop Zushi form endpoint is alive.');
}
```

## 仕組みメモ
- サイト側は `fetch(URL, {method:'POST', mode:'no-cors', body: フォームデータ})` で送信（CORS回避のため
  応答は読まず、送信できたら成功表示）。データはスプレッドシートとメールに確実に届く。
- 送信項目: checkin / checkout / guests / name / email / phone / lang / message
