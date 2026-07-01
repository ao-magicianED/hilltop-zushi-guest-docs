// 通知メールの本文テンプレート（多言語）。純粋な文字列生成のみ（DB操作・送信処理はindex.ts側）。
import type { Lang } from "../types";

const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const wrap = (bodyHtml: string) =>
  `<div style="font-family:-apple-system,'Hiragino Sans','Yu Gothic UI',sans-serif;font-size:15px;line-height:1.7;color:#1f2937;max-width:520px">${bodyHtml}</div>`;

const button = (url: string, label: string) =>
  `<p><a href="${url}" style="display:inline-block;background:#1a3a6c;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">${label}</a></p>`;

const dateRange = (checkIn: string, checkOut: string) =>
  `<p style="color:#6b7280;font-size:13px">${esc(checkIn)} 〜 ${esc(checkOut)}</p>`;

export type MailContent = { subject: string; html: string };

// ① 暗証番号の案内（承認後・ゲスト代表者宛・多言語）
export function pinNotificationEmail(
  lang: Lang,
  opts: { code: string; checkIn: string; checkOut: string; pinUrl: string }
): MailContent {
  const T: Record<Lang, { subject: string; greeting: string; body: string; note: string; btn: string }> = {
    ja: {
      subject: `【Hilltop Zushi】チェックイン情報のご案内（${opts.code}）`,
      greeting: "この度はHilltop Zushiにご予約いただきありがとうございます。",
      body: "宿泊者情報のご提出、ありがとうございました。下記リンクより、チェックインに必要な暗証番号をご確認ください。",
      note: "このリンクは一度だけ開けます。開く前にメモのご準備をお願いします。",
      btn: "暗証番号を確認する",
    },
    en: {
      subject: `[Hilltop Zushi] Check-in information (${opts.code})`,
      greeting: "Thank you for booking Hilltop Zushi.",
      body: "Thank you for submitting your guest information. Please use the link below to view your check-in door code.",
      note: "This link can only be opened once. Please be ready to note it down.",
      btn: "View door code",
    },
    "zh-CN": {
      subject: `【Hilltop Zushi】入住信息通知（${opts.code}）`,
      greeting: "感谢您预订 Hilltop Zushi。",
      body: "感谢您提交住客信息。请通过以下链接查看入住所需的门锁密码。",
      note: "此链接仅可打开一次，请提前准备好记录。",
      btn: "查看门锁密码",
    },
    "zh-TW": {
      subject: `【Hilltop Zushi】入住資訊通知（${opts.code}）`,
      greeting: "感謝您預訂 Hilltop Zushi。",
      body: "感謝您提交住客資訊。請透過以下連結查看入住所需的門鎖密碼。",
      note: "此連結僅可開啟一次，請提前準備好記錄。",
      btn: "查看門鎖密碼",
    },
  };
  const c = T[lang] ?? T.ja;
  const html = wrap(`
    <p>${c.greeting}</p>
    <p>${c.body}</p>
    ${button(opts.pinUrl, c.btn)}
    <p style="color:#6b7280;font-size:13px">${c.note}</p>
    ${dateRange(opts.checkIn, opts.checkOut)}
  `);
  return { subject: c.subject, html };
}

// ② 未完了ゲストへの督促リマインド（毎日・代表者宛・多言語）
export function reminderEmail(
  lang: Lang,
  opts: { code: string; checkIn: string; checkOut: string; done: number; total: number; daysLeft: number; started: boolean; groupUrl: string }
): MailContent {
  const T: Record<
    Lang,
    { subject: string; greeting: string; notStarted: string; progress: (d: number, t: number) => string; body: string; btn: string }
  > = {
    ja: {
      subject: `【Hilltop Zushi】宿泊者情報のご登録のお願い（あと${opts.daysLeft}日）`,
      greeting: "チェックインが近づいてまいりました。",
      notStarted: "宿泊者情報のご登録がまだのようです。",
      progress: (d, t) => `現在の登録状況：${d} / ${t} 名 完了`,
      body: "下記リンクより、宿泊者全員分のご登録をお願いいたします。",
      btn: "登録ページを開く",
    },
    en: {
      subject: `[Hilltop Zushi] Please complete guest registration (${opts.daysLeft} days left)`,
      greeting: "Your check-in date is approaching.",
      notStarted: "It looks like guest registration hasn't started yet.",
      progress: (d, t) => `Current progress: ${d} / ${t} guests completed`,
      body: "Please use the link below to register all guests staying with you.",
      btn: "Open registration page",
    },
    "zh-CN": {
      subject: `【Hilltop Zushi】请尽快完成住客信息登记（还剩${opts.daysLeft}天）`,
      greeting: "入住日期即将到来。",
      notStarted: "您似乎尚未开始住客信息登记。",
      progress: (d, t) => `当前进度：${d} / ${t} 人已完成`,
      body: "请通过以下链接为所有住客完成登记。",
      btn: "打开登记页面",
    },
    "zh-TW": {
      subject: `【Hilltop Zushi】請儘快完成住客資訊登記（還剩${opts.daysLeft}天）`,
      greeting: "入住日期即將到來。",
      notStarted: "您似乎尚未開始住客資訊登記。",
      progress: (d, t) => `目前進度：${d} / ${t} 人已完成`,
      body: "請透過以下連結為所有住客完成登記。",
      btn: "開啟登記頁面",
    },
  };
  const c = T[lang] ?? T.ja;
  const statusLine = opts.started ? c.progress(opts.done, opts.total || opts.done) : c.notStarted;
  const html = wrap(`
    <p>${c.greeting}</p>
    <p>${statusLine}</p>
    <p>${c.body}</p>
    ${button(opts.groupUrl, c.btn)}
    ${dateRange(opts.checkIn, opts.checkOut)}
  `);
  return { subject: c.subject, html };
}

// ③ 全員完了通知（オーナー宛・日本語固定）
export function completionNotificationEmail(opts: {
  code: string;
  checkIn: string;
  checkOut: string;
  guestCount: number;
  adminUrl: string;
}): MailContent {
  const subject = `【Hilltop Zushi】宿泊者情報が全員分完了しました（${opts.code}）`;
  const html = wrap(`
    <p>予約 <strong>${esc(opts.code)}</strong> の宿泊者情報が、全${opts.guestCount}名分そろいました。</p>
    <p>内容をご確認のうえ、承認をお願いします。</p>
    ${button(opts.adminUrl, "管理画面で確認する")}
    ${dateRange(opts.checkIn, opts.checkOut)}
  `);
  return { subject, html };
}

// ④ 当日0件アラート（オーナー宛・日本語固定・緊急）
export function zeroSubmissionAlertEmail(opts: { code: string; checkIn: string; checkOut: string; adminUrl: string }): MailContent {
  const subject = `【緊急】Hilltop Zushi 本日チェックインなのに宿泊者情報が未提出です（${opts.code}）`;
  const html = wrap(`
    <p style="color:#b91c1c;font-weight:600">本日チェックインの予約 <strong>${esc(opts.code)}</strong> で、宿泊者情報が1件も提出されていません。</p>
    <p>代表者への電話連絡や、当日のICT/対面確認をご検討ください。</p>
    ${button(opts.adminUrl, "管理画面で確認する")}
    ${dateRange(opts.checkIn, opts.checkOut)}
  `);
  return { subject, html };
}

// ⑤ グループリンクの案内（予約作成時・代表者宛・多言語）
export function groupLinkEmail(
  lang: Lang,
  opts: { code: string; checkIn: string; checkOut: string; groupUrl: string }
): MailContent {
  const T: Record<Lang, { subject: string; greeting: string; body: string; note: string; btn: string }> = {
    ja: {
      subject: `【Hilltop Zushi】宿泊者情報のご登録のお願い（${opts.code}）`,
      greeting: "この度はHilltop Zushiにご予約いただきありがとうございます。",
      body: "下記リンクより、ご一緒に宿泊される方全員分の情報登録をお願いいたします。まず人数をご入力いただくと、お一人ずつの入力ページが表示されます。",
      note: "正確な情報のご入力をお願いいたします（虚偽・不正確な内容でのご入力はご遠慮ください）。",
      btn: "宿泊者情報を登録する",
    },
    en: {
      subject: `[Hilltop Zushi] Please register your guest information (${opts.code})`,
      greeting: "Thank you for booking Hilltop Zushi.",
      body: "Please use the link below to register information for everyone staying with you. After entering the number of guests, a personal form will appear for each guest.",
      note: "Please make sure all information entered is accurate and truthful.",
      btn: "Register guest information",
    },
    "zh-CN": {
      subject: `【Hilltop Zushi】请登记住客信息（${opts.code}）`,
      greeting: "感谢您预订 Hilltop Zushi。",
      body: "请通过以下链接为所有同住的住客登记信息。填写人数后，将显示每位住客各自的登记页面。",
      note: "请确保填写的信息真实准确（请勿填写虚假或不准确的内容）。",
      btn: "登记住客信息",
    },
    "zh-TW": {
      subject: `【Hilltop Zushi】請登記住客資訊（${opts.code}）`,
      greeting: "感謝您預訂 Hilltop Zushi。",
      body: "請透過以下連結為所有同住的住客登記資訊。填寫人數後，將顯示每位住客各自的登記頁面。",
      note: "請確保填寫的資訊真實準確（請勿填寫虛假或不準確的內容）。",
      btn: "登記住客資訊",
    },
  };
  const c = T[lang] ?? T.ja;
  const html = wrap(`
    <p>${c.greeting}</p>
    <p>${c.body}</p>
    ${button(opts.groupUrl, c.btn)}
    <p style="color:#6b7280;font-size:13px">${c.note}</p>
    ${dateRange(opts.checkIn, opts.checkOut)}
  `);
  return { subject: c.subject, html };
}

// ⑥ 全員完了の確認（代表者宛・多言語）。オーナー宛の completionNotificationEmail とは別物。
export function completionConfirmEmail(
  lang: Lang,
  opts: { code: string; checkIn: string; checkOut: string }
): MailContent {
  const T: Record<Lang, { subject: string; body: string }> = {
    ja: {
      subject: `【Hilltop Zushi】宿泊者情報のご登録ありがとうございました（${opts.code}）`,
      body: "ご一緒に宿泊される方全員分の情報登録が完了しました。ご協力ありがとうございました。チェックインに必要な暗証番号は、内容確認後に別途メールでお送りします。",
    },
    en: {
      subject: `[Hilltop Zushi] Registration complete — thank you (${opts.code})`,
      body: "Registration is now complete for everyone staying with you. Thank you for your cooperation. Your check-in door code will be sent in a separate email once we've reviewed your information.",
    },
    "zh-CN": {
      subject: `【Hilltop Zushi】住客信息登记已完成，谢谢您（${opts.code}）`,
      body: "所有同住住客的信息登记已全部完成，感谢您的配合。入住所需的门锁密码将在我们确认信息后另行邮件通知。",
    },
    "zh-TW": {
      subject: `【Hilltop Zushi】住客資訊登記已完成，謝謝您（${opts.code}）`,
      body: "所有同住住客的資訊登記已全部完成，感謝您的配合。入住所需的門鎖密碼將在我們確認資訊後另行郵件通知。",
    },
  };
  const c = T[lang] ?? T.ja;
  const html = wrap(`
    <p>${c.body}</p>
    ${dateRange(opts.checkIn, opts.checkOut)}
  `);
  return { subject: c.subject, html };
}

// ⑦ チャット貼付用の案内文案（プレーンテキスト・多言語）。Airbnbメッセージ/LINE等、メール以外の
// 経路で手動送付する場合に管理画面からコピーして使う。HTMLメールとは別に用意する。
export function guestLinkMessageText(lang: Lang, opts: { checkIn: string; checkOut: string; groupUrl: string }): string {
  const T: Record<Lang, (u: string, ci: string, co: string) => string> = {
    ja: (u, ci, co) =>
      `Hilltop Zushiにご予約いただきありがとうございます（${ci}〜${co}）。\n` +
      `下記リンクより、ご一緒に宿泊される方全員分の情報登録をお願いいたします。\n` +
      `正確な情報のご入力をお願いいたします（虚偽・不正確な内容でのご入力はご遠慮ください）。\n\n${u}`,
    en: (u, ci, co) =>
      `Thank you for booking Hilltop Zushi (${ci} - ${co}).\n` +
      `Please use the link below to register information for everyone staying with you.\n` +
      `Please make sure all information entered is accurate and truthful.\n\n${u}`,
    "zh-CN": (u, ci, co) =>
      `感谢您预订 Hilltop Zushi（${ci} 至 ${co}）。\n` +
      `请通过以下链接为所有同住的住客登记信息。\n` +
      `请确保填写的信息真实准确（请勿填写虚假或不准确的内容）。\n\n${u}`,
    "zh-TW": (u, ci, co) =>
      `感謝您預訂 Hilltop Zushi（${ci} 至 ${co}）。\n` +
      `請透過以下連結為所有同住的住客登記資訊。\n` +
      `請確保填寫的資訊真實準確（請勿填寫虛假或不準確的內容）。\n\n${u}`,
  };
  const f = T[lang] ?? T.ja;
  return f(opts.groupUrl, opts.checkIn, opts.checkOut);
}
