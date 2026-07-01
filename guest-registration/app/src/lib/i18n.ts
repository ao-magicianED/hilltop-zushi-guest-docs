// 多言語辞書（ja / en / zh-CN / zh-TW）設計 ⑪・17-3
import type { Lang } from "../types";

type Dict = Record<string, Record<Lang, string>>;

export const T: Dict = {
  app_title: { ja: "宿泊者情報のご登録", en: "Guest Registration", "zh-CN": "住客信息登记", "zh-TW": "住客資訊登記" },
  property: { ja: "Hilltop Zushi", en: "Hilltop Zushi", "zh-CN": "Hilltop Zushi", "zh-TW": "Hilltop Zushi" },

  // 入口
  start_title: { ja: "予約の確認", en: "Verify your booking", "zh-CN": "确认您的预订", "zh-TW": "確認您的預訂" },
  start_desc: {
    ja: "ご予約を確認します。予約番号と、確認のためもう1点をご入力ください。",
    en: "Please enter your reservation code and one more detail to verify.",
    "zh-CN": "请输入您的预订号和另一项信息以确认。",
    "zh-TW": "請輸入您的預訂號碼與另一項資訊以確認。",
  },
  reservation_code: { ja: "予約番号", en: "Reservation code", "zh-CN": "预订号", "zh-TW": "預訂號碼" },
  last_name: { ja: "代表者の姓（ローマ字）", en: "Lead guest last name", "zh-CN": "预订人姓氏（拼音）", "zh-TW": "預訂人姓氏（拼音）" },
  verify: { ja: "確認する", en: "Verify", "zh-CN": "确认", "zh-TW": "確認" },
  verify_failed: { ja: "予約が見つかりませんでした。入力をご確認ください。", en: "Booking not found. Please check your input.", "zh-CN": "未找到预订，请检查输入。", "zh-TW": "找不到預訂，請檢查輸入。" },
  too_many: { ja: "試行回数が多すぎます。しばらくしてからお試しください。", en: "Too many attempts. Please try again later.", "zh-CN": "尝试次数过多，请稍后再试。", "zh-TW": "嘗試次數過多，請稍後再試。" },

  // 予約元の選択（直予約 / OTA）
  choose_channel_title: { ja: "ご予約はどちらからですか？", en: "Where did you book?", "zh-CN": "您从哪里预订的？", "zh-TW": "您從哪裡預訂的？" },
  choose_channel_desc: {
    ja: "ご予約の経路を選んでください。経路に合わせてご案内します。",
    en: "Please choose how you booked. The next step depends on it.",
    "zh-CN": "请选择您的预订渠道，后续步骤会据此调整。",
    "zh-TW": "請選擇您的預訂管道，後續步驟會據此調整。",
  },
  channel_direct: { ja: "直接予約（公式サイト・電話など）", en: "Direct (official site / phone)", "zh-CN": "直接预订（官网 / 电话）", "zh-TW": "直接預訂（官網 / 電話）" },
  channel_airbnb: { ja: "Airbnb で予約", en: "Booked on Airbnb", "zh-CN": "通过 Airbnb（爱彼迎）预订", "zh-TW": "透過 Airbnb 預訂" },
  channel_booking: { ja: "Booking.com で予約", en: "Booked on Booking.com", "zh-CN": "通过 Booking.com（缤客）预订", "zh-TW": "透過 Booking.com 預訂" },
  back: { ja: "戻る", en: "Back", "zh-CN": "返回", "zh-TW": "返回" },
  continue: { ja: "この内容で進む", en: "Continue", "zh-CN": "继续", "zh-TW": "繼續" },

  // OTA（Airbnb / Booking.com）入口
  ota_title: { ja: "予約コードの確認", en: "Confirm your reservation code", "zh-CN": "确认您的预订号", "zh-TW": "確認您的預訂號碼" },
  ota_desc: {
    ja: "予約コードは、予約サイトから届いた確認メール／メッセージに記載されています（例: HMAPDB2SSB）。ご確認のうえご入力ください。",
    en: "Your reservation code is in the confirmation email/message from the booking site (e.g. HMAPDB2SSB). Please enter it below.",
    "zh-CN": "预订号显示在预订网站发来的确认邮件/消息中（例如 HMAPDB2SSB）。请确认后输入。",
    "zh-TW": "預訂號顯示在預訂網站寄來的確認郵件/訊息中（例如 HMAPDB2SSB）。請確認後輸入。",
  },
  check_in: { ja: "チェックイン日", en: "Check-in date", "zh-CN": "入住日期", "zh-TW": "入住日期" },
  check_out: { ja: "チェックアウト日", en: "Check-out date", "zh-CN": "退房日期", "zh-TW": "退房日期" },
  ota_next_note: {
    ja: "次の画面で人数を入力し、代表者のメールアドレス（連絡先）をお伺いします。",
    en: "Next, you'll enter the number of guests and the lead guest's email (contact).",
    "zh-CN": "下一步将填写人数，并询问代表的电子邮箱（联系方式）。",
    "zh-TW": "下一步將填寫人數，並詢問代表的電子郵件（聯絡方式）。",
  },
  email_rep_req_note: {
    ja: "連絡先確保のため、代表者のメールアドレスは必須です。",
    en: "The lead guest's email is required so we can reach you.",
    "zh-CN": "为确保能与您联系，代表的电子邮箱为必填项。",
    "zh-TW": "為確保能與您聯絡，代表的電子郵件為必填項。",
  },
  email_coupon_req_note: {
    ja: "「割引・クーポン情報を受け取る」にチェックした場合、メールアドレスが必須になります。",
    en: "If you check \"receive discount/coupon info\", an email address is required.",
    "zh-CN": "如勾选「接收优惠・优惠券信息」，则电子邮箱为必填项。",
    "zh-TW": "如勾選「接收優惠・優惠券資訊」，則電子郵件為必填項。",
  },
  err_code_format: {
    ja: "予約コードの形式が正しくありません（英数字とハイフン・6〜20文字）。",
    en: "Invalid reservation code (letters, digits, hyphen; 6–20 characters).",
    "zh-CN": "预订号格式不正确（字母、数字、连字符；6–20位）。",
    "zh-TW": "預訂號格式不正確（字母、數字、連字號；6–20位）。",
  },
  err_dates: {
    ja: "宿泊日が正しくありません（泊数1〜30・直近の日程でご入力ください）。",
    en: "Invalid stay dates (1–30 nights, near-term dates only).",
    "zh-CN": "住宿日期不正确（1–30晚，且需为近期日期）。",
    "zh-TW": "住宿日期不正確（1–30晚，且需為近期日期）。",
  },
  representative_label: { ja: "代表者", en: "Representative", "zh-CN": "代表", "zh-TW": "代表" },

  // 人数申告
  declare_title: { ja: "宿泊人数の申告（代表者）", en: "Number of guests (lead)", "zh-CN": "住宿人数（代表）", "zh-TW": "住宿人數（代表）" },
  declare_desc: {
    ja: "今回ご宿泊になる人数をご入力ください。人数分の入力欄をご用意します。",
    en: "Enter the number of guests staying this time. We will prepare a slot for each.",
    "zh-CN": "请输入本次入住人数，我们将为每位准备登记。",
    "zh-TW": "請輸入本次入住人數，我們將為每位準備登記。",
  },
  num_guests: { ja: "宿泊人数", en: "Number of guests", "zh-CN": "住宿人数", "zh-TW": "住宿人數" },
  declare_submit: { ja: "この人数で進む", en: "Continue", "zh-CN": "继续", "zh-TW": "繼續" },

  // 進捗
  progress_title: { ja: "登録の進捗", en: "Registration progress", "zh-CN": "登记进度", "zh-TW": "登記進度" },
  progress_count: { ja: "{done} / {total} 名が登録済み", en: "{done} / {total} registered", "zh-CN": "{done} / {total} 人已登记", "zh-TW": "{done} / {total} 人已登記" },
  status_done: { ja: "登録済み", en: "Done", "zh-CN": "已登记", "zh-TW": "已登記" },
  status_pending: { ja: "未登録", en: "Pending", "zh-CN": "未登记", "zh-TW": "未登記" },
  enter_mine: { ja: "自分の情報を入力する", en: "Enter my information", "zh-CN": "填写我的信息", "zh-TW": "填寫我的資訊" },
  edit_link: { ja: "入力/修正", en: "Edit", "zh-CN": "填写/修改", "zh-TW": "填寫/修改" },
  all_done: { ja: "全員の登録が完了しました。ありがとうございました。", en: "Everyone is registered. Thank you!", "zh-CN": "所有人已登记完成，谢谢！", "zh-TW": "所有人已登記完成，謝謝！" },

  // 宿泊情報入力ページ（進捗＋個人リンク共有を統合）
  guest_info_title: { ja: "宿泊情報入力ページ", en: "Guest Information", "zh-CN": "住客信息登记页面", "zh-TW": "住客資訊登記頁面" },
  guest_info_intro: {
    ja: "必ず参加者全員の情報を入力してください。",
    en: "Please make sure information is entered for all participants.",
    "zh-CN": "请务必填写所有同住人员的信息。",
    "zh-TW": "請務必填寫所有同住人員的資訊。",
  },
  guest_info_share_note: {
    ja: "代表者がまとめて入力いただくか、リンク横の「コピー」を押してリンクをコピーし、参加者ご本人に送ってご入力いただいてください。",
    en: "The representative can enter everyone's information directly, or press \"Copy\" next to a link to copy it and send it to that participant so they can fill it in themselves.",
    "zh-CN": "可由代表人统一填写，或点击链接旁的“复制”按钮复制链接，发送给该住客本人自行填写。",
    "zh-TW": "可由代表人統一填寫，或點擊連結旁的「複製」按鈕複製連結，傳送給該住客本人自行填寫。",
  },
  add_guests_label: { ja: "参加人数が増えましたか？", en: "Did your group size increase?", "zh-CN": "同住人数增加了吗？", "zh-TW": "同住人數增加了嗎？" },
  add_guests_count_label: { ja: "追加する人数", en: "Number of additional guests", "zh-CN": "增加的人数", "zh-TW": "增加的人數" },
  add_guests_button: { ja: "人数を追加する", en: "Add guests", "zh-CN": "增加人数", "zh-TW": "增加人數" },
  add_guests_note: {
    ja: "人数が増える場合は必ずこちらから追加してください。ただし、ここで追加するだけでは正式な人数変更にはなりません。追加された際は、必ずAirbnb等のメッセージでも人数が増えた旨をご連絡ください。",
    en: "If your group size increases, please always add the extra guests here. However, adding guests here alone does not count as an official change of headcount — please also make sure to notify us via your Airbnb (or other platform) message that the number of guests has increased.",
    "zh-CN": "如同住人数增加，请务必通过此处添加。但仅在此处添加并不构成正式的人数变更，请务必同时通过Airbnb等平台的消息告知我们人数已增加。",
    "zh-TW": "如同住人數增加，請務必透過此處新增。但僅在此處新增並不構成正式的人數變更，請務必同時透過Airbnb等平台的訊息告知我們人數已增加。",
  },
  add_guests_error: {
    ja: "追加できる人数の上限を超えています。ホストへ直接ご連絡ください。",
    en: "This would exceed the maximum number of guests. Please contact the host directly.",
    "zh-CN": "已超过可增加的人数上限，请直接联系房东。",
    "zh-TW": "已超過可新增的人數上限，請直接聯絡房東。",
  },

  // フォーム見出し・項目
  form_title: { ja: "宿泊者情報の入力", en: "Guest information", "zh-CN": "住客信息", "zh-TW": "住客資訊" },
  role: { ja: "区分", en: "Role", "zh-CN": "身份", "zh-TW": "身分" },
  full_name: { ja: "氏名（パスポートのつづり）", en: "Full name (as in passport)", "zh-CN": "姓名（与护照一致）", "zh-TW": "姓名（與護照一致）" },
  has_jp_address: { ja: "日本国内に住所がありますか？", en: "Do you have an address in Japan?", "zh-CN": "您在日本有住址吗？", "zh-TW": "您在日本有住址嗎？" },
  yes: { ja: "はい", en: "Yes", "zh-CN": "是", "zh-TW": "是" },
  no: { ja: "いいえ", en: "No", "zh-CN": "否", "zh-TW": "否" },
  address: { ja: "住所", en: "Address", "zh-CN": "住址", "zh-TW": "住址" },
  nationality: { ja: "国籍", en: "Nationality", "zh-CN": "国籍", "zh-TW": "國籍" },
  nationality_other: { ja: "国籍（その他・直接入力）", en: "Nationality (other)", "zh-CN": "国籍（其他）", "zh-TW": "國籍（其他）" },
  passport_no: { ja: "旅券番号", en: "Passport number", "zh-CN": "护照号码", "zh-TW": "護照號碼" },
  passport_img: { ja: "パスポート画像（顔写真のページ）", en: "Passport photo page", "zh-CN": "护照照片页", "zh-TW": "護照照片頁" },
  occupation: { ja: "職業", en: "Occupation", "zh-CN": "职业", "zh-TW": "職業" },
  age: { ja: "年齢", en: "Age", "zh-CN": "年龄", "zh-TW": "年齡" },
  gender: { ja: "性別", en: "Gender", "zh-CN": "性别", "zh-TW": "性別" },
  phone: { ja: "電話番号（当日連絡可）", en: "Phone (reachable during stay)", "zh-CN": "电话（入住期间可联系）", "zh-TW": "電話（入住期間可聯絡）" },
  phone_rep_req: { ja: "代表者は必須です", en: "Required for the lead guest", "zh-CN": "代表必填", "zh-TW": "代表必填" },
  prev_stay: { ja: "前泊地（自宅からなら「自宅」）", en: "Previous place of stay", "zh-CN": "前一晚住宿地", "zh-TW": "前一晚住宿地" },
  next_stay: { ja: "後泊地（自宅へ直帰なら「自宅」）", en: "Next place of stay", "zh-CN": "离开后的住宿地", "zh-TW": "離開後的住宿地" },
  email: { ja: "メールアドレス", en: "Email", "zh-CN": "电子邮箱", "zh-TW": "電子郵件" },
  optional: { ja: "（任意）", en: "(optional)", "zh-CN": "（选填）", "zh-TW": "（選填）" },
  required: { ja: "（必須）", en: "(required)", "zh-CN": "（必填）", "zh-TW": "（必填）" },

  // おまけ（代表者のみ）
  choose_reason: { ja: "当施設を選んだ理由（任意・参考まで）", en: "Why did you choose us? (optional)", "zh-CN": "选择本住宿的理由（选填）", "zh-TW": "選擇本住宿的理由（選填）" },
  choose_reason_other_label: { ja: "その他（自由記入）", en: "Other (free text)", "zh-CN": "其他（自由填写）", "zh-TW": "其他（自由填寫）" },
  stay_purpose: { ja: "今回のご利用用途", en: "Purpose of this stay", "zh-CN": "本次入住用途", "zh-TW": "本次入住用途" },
  stay_purpose_other_label: { ja: "その他（自由記入）", en: "Other (free text)", "zh-CN": "其他（自由填写）", "zh-TW": "其他（自由填寫）" },
  passport_photo_note: {
    ja: "旅券の顔写真ページの画像をお願いします。",
    en: "Please upload a photo of your passport's photo page.",
    "zh-CN": "请上传护照照片页的图片。",
    "zh-TW": "請上傳護照照片頁的圖片。",
  },

  // マーケ同意
  marketing_optin: {
    ja: "今後 Hilltop Zushi の直販サイト・割引クーポンなどのご案内をメールで受け取る（任意）",
    en: "I'd like to receive offers and discount coupons from Hilltop Zushi by email (optional)",
    "zh-CN": "愿意通过邮件接收 Hilltop Zushi 的优惠及优惠券信息（选填）",
    "zh-TW": "願意透過電子郵件接收 Hilltop Zushi 的優惠及優惠券資訊（選填）",
  },
  review_promo: {
    ja: "チェックアウト後、Googleマップにクチコミをご投稿いただいた方へ、お礼として次回10%OFFクーポンをお送りします。",
    en: "After checkout, guests who post a Google Maps review get a 10% off coupon for next time as a thank-you.",
    "zh-CN": "退房后，在Google地图发表评价的住客可获得下次10%折扣券作为感谢。",
    "zh-TW": "退房後，於Google地圖發表評論的住客可獲得下次10%折扣券作為感謝。",
  },

  // 重要事項・同意
  terms_title: { ja: "重要事項（必ずお読みください）", en: "Important — please read", "zh-CN": "重要事项（请务必阅读）", "zh-TW": "重要事項（請務必閱讀）" },
  terms_headcount: {
    ja: "ご予約時に申告された人数でのご利用をお願いします。",
    en: "Please stay with exactly the number of guests declared at booking.",
    "zh-CN": "请按预订时申报的人数入住。",
    "zh-TW": "請依預訂時申報的人數入住。",
  },
  terms_extra_fee: {
    ja: "申告人数を超えてご宿泊の場合、超過1名につき通常の追加料金（約4,000〜5,000円）の3倍の追加料金が発生します。",
    en: "If more guests stay than declared, an extra fee of 3× the normal per-person charge (approx. JPY 4,000–5,000) applies per extra guest.",
    "zh-CN": "若超过申报人数入住，每超出1人将收取通常追加费用（约4,000〜5,000日元）的3倍。",
    "zh-TW": "若超過申報人數入住，每超出1人將收取通常追加費用（約4,000〜5,000日圓）的3倍。",
  },
  terms_legal: {
    ja: "宿泊者名簿の記入は日本の住宅宿泊事業法で定められた義務であり、情報のご提供は必須です。必ず全員ぶんご協力ください。",
    en: "Providing this information is a legal requirement under Japan's Housing Accommodation Business Act. Cooperation from all guests is mandatory.",
    "zh-CN": "填写住客名簿是日本住宅住宿事业法规定的义务，必须提供。请全体住客务必配合。",
    "zh-TW": "填寫住客名簿是日本住宅住宿事業法規定的義務，必須提供。請全體住客務必配合。",
  },
  privacy_title: { ja: "プライバシーポリシー", en: "Privacy Policy", "zh-CN": "隐私政策", "zh-TW": "隱私政策" },
  privacy_link_label: { ja: "内容を見る", en: "View policy", "zh-CN": "查看内容", "zh-TW": "查看內容" },
  consent_privacy: {
    ja: "プライバシーポリシーに同意します（必須）",
    en: "I agree to the Privacy Policy (required)",
    "zh-CN": "我同意隐私政策（必填）",
    "zh-TW": "我同意隱私政策（必填）",
  },
  consent_cross_border: {
    ja: "情報が日本国外のサーバー（米国等）で処理・保管されることに同意します（必須）",
    en: "I consent to my data being processed/stored on servers outside Japan, e.g. the US (required)",
    "zh-CN": "我同意我的信息在日本境外（如美国）的服务器上处理和存储（必填）",
    "zh-TW": "我同意我的資訊在日本境外（如美國）的伺服器上處理與儲存（必填）",
  },
  consent_required: { ja: "必須の同意にチェックしてください。", en: "Please check the required consents.", "zh-CN": "请勾选必填的同意项。", "zh-TW": "請勾選必填的同意項。" },

  save_draft: { ja: "一時保存", en: "Save draft", "zh-CN": "暂存", "zh-TW": "暫存" },
  save_draft_note: {
    ja: "未入力の項目があっても保存できます。続きは同じリンクから入力できます。",
    en: "You can save even with fields left blank. Continue anytime from the same link.",
    "zh-CN": "即使有未填写的项目也可以保存。可通过同一链接继续填写。",
    "zh-TW": "即使有未填寫的項目也可以儲存。可透過同一連結繼續填寫。",
  },
  draft_img_warn: {
    ja: "画像の保存に失敗しました。他の項目は保存済みです。お手数ですが画像だけ再度お試しください。",
    en: "The photo couldn't be saved, but the rest was saved. Please try uploading the photo again.",
    "zh-CN": "照片保存失败，其他内容已保存。请重新上传照片。",
    "zh-TW": "照片儲存失敗，其他內容已儲存。請重新上傳照片。",
  },
  submit: { ja: "登録する", en: "Submit", "zh-CN": "提交", "zh-TW": "提交" },
  saved: { ja: "保存しました。", en: "Saved.", "zh-CN": "已保存。", "zh-TW": "已儲存。" },
  submitted_ok: { ja: "登録が完了しました。ご協力ありがとうございました。", en: "Registration complete. Thank you!", "zh-CN": "登记完成，谢谢您的配合！", "zh-TW": "登記完成，謝謝您的配合！" },
  back_to_progress: { ja: "進捗一覧へ戻る", en: "Back to progress", "zh-CN": "返回进度", "zh-TW": "返回進度" },
  fix_errors: { ja: "未入力・誤りの項目があります。赤い箇所をご確認ください。", en: "Some fields are missing or invalid. Please check the highlighted items.", "zh-CN": "有未填写或错误的项目，请检查标红处。", "zh-TW": "有未填寫或錯誤的項目，請檢查標紅處。" },
  expired: { ja: "このリンクは有効期限が切れています。ホストにご連絡ください。", en: "This link has expired. Please contact the host.", "zh-CN": "此链接已过期，请联系房东。", "zh-TW": "此連結已過期，請聯絡房東。" },
  pin_title: { ja: "チェックイン情報", en: "Check-in information", "zh-CN": "入住信息", "zh-TW": "入住資訊" },
  pin_not_set: {
    ja: "暗証番号がまだ設定されていません。ホストにご連絡ください。",
    en: "The door code hasn't been set yet. Please contact the host.",
    "zh-CN": "门锁密码尚未设置，请联系房东。",
    "zh-TW": "門鎖密碼尚未設定，請聯絡房東。",
  },
  pin_confirm_body: {
    ja: "このリンクは一度だけ開くことができます。ボタンを押すと暗証番号が表示されます。",
    en: "This link can only be opened once. Press the button below to reveal your door code.",
    "zh-CN": "此链接仅可打开一次。点击下方按钮查看门锁密码。",
    "zh-TW": "此連結僅可開啟一次。點擊下方按鈕查看門鎖密碼。",
  },
  pin_confirm_btn: { ja: "暗証番号を表示する", en: "Reveal door code", "zh-CN": "查看密码", "zh-TW": "查看密碼" },
  copy_link: { ja: "コピー", en: "Copy", "zh-CN": "复制", "zh-TW": "複製" },
  copied: { ja: "コピーしました", en: "Copied", "zh-CN": "已复制", "zh-TW": "已複製" },
};

export function t(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const entry = T[key];
  let s = entry ? entry[lang] ?? entry.ja : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

// ---- 選択肢（コード→多言語ラベル）----
type Opt = { code: string; label: Record<Lang, string> };

export const OCCUPATIONS: Opt[] = [
  { code: "public_servant", label: { ja: "公務員", en: "Public servant", "zh-CN": "公务员", "zh-TW": "公務員" } },
  { code: "company_mgmt", label: { ja: "会社経営", en: "Company management", "zh-CN": "公司经营", "zh-TW": "公司經營" } },
  { code: "self_employed", label: { ja: "自営業", en: "Self-employed", "zh-CN": "个体经营", "zh-TW": "自營業" } },
  { code: "part_time", label: { ja: "パート・アルバイト", en: "Part-time", "zh-CN": "兼职", "zh-TW": "兼職" } },
  { code: "homemaker", label: { ja: "専業主婦・主夫", en: "Homemaker", "zh-CN": "家庭主妇/夫", "zh-TW": "家庭主婦/夫" } },
  { code: "unemployed", label: { ja: "無職", en: "Unemployed", "zh-CN": "无业", "zh-TW": "無業" } },
  { code: "student", label: { ja: "学生", en: "Student", "zh-CN": "学生", "zh-TW": "學生" } },
  { code: "other", label: { ja: "その他", en: "Other", "zh-CN": "其他", "zh-TW": "其他" } },
];

// よく来る国を上位に固定（設計 ④）
export const NATIONALITIES: Opt[] = [
  { code: "JP", label: { ja: "日本", en: "Japan", "zh-CN": "日本", "zh-TW": "日本" } },
  { code: "CN", label: { ja: "中国", en: "China", "zh-CN": "中国", "zh-TW": "中國" } },
  { code: "TW", label: { ja: "台湾", en: "Taiwan", "zh-CN": "台湾", "zh-TW": "台灣" } },
  { code: "HK", label: { ja: "香港", en: "Hong Kong", "zh-CN": "香港", "zh-TW": "香港" } },
  { code: "KR", label: { ja: "韓国", en: "Korea", "zh-CN": "韩国", "zh-TW": "韓國" } },
  { code: "US", label: { ja: "アメリカ", en: "U.S.A.", "zh-CN": "美国", "zh-TW": "美國" } },
  { code: "AU", label: { ja: "オーストラリア", en: "Australia", "zh-CN": "澳大利亚", "zh-TW": "澳洲" } },
  { code: "TH", label: { ja: "タイ", en: "Thailand", "zh-CN": "泰国", "zh-TW": "泰國" } },
  { code: "SG", label: { ja: "シンガポール", en: "Singapore", "zh-CN": "新加坡", "zh-TW": "新加坡" } },
  { code: "MY", label: { ja: "マレーシア", en: "Malaysia", "zh-CN": "马来西亚", "zh-TW": "馬來西亞" } },
  { code: "ID", label: { ja: "インドネシア", en: "Indonesia", "zh-CN": "印度尼西亚", "zh-TW": "印尼" } },
  { code: "PH", label: { ja: "フィリピン", en: "Philippines", "zh-CN": "菲律宾", "zh-TW": "菲律賓" } },
  { code: "VN", label: { ja: "ベトナム", en: "Vietnam", "zh-CN": "越南", "zh-TW": "越南" } },
  { code: "IN", label: { ja: "インド", en: "India", "zh-CN": "印度", "zh-TW": "印度" } },
  { code: "CA", label: { ja: "カナダ", en: "Canada", "zh-CN": "加拿大", "zh-TW": "加拿大" } },
  { code: "GB", label: { ja: "イギリス", en: "U.K.", "zh-CN": "英国", "zh-TW": "英國" } },
  { code: "DE", label: { ja: "ドイツ", en: "Germany", "zh-CN": "德国", "zh-TW": "德國" } },
  { code: "FR", label: { ja: "フランス", en: "France", "zh-CN": "法国", "zh-TW": "法國" } },
  { code: "IT", label: { ja: "イタリア", en: "Italy", "zh-CN": "意大利", "zh-TW": "義大利" } },
  { code: "ES", label: { ja: "スペイン", en: "Spain", "zh-CN": "西班牙", "zh-TW": "西班牙" } },
  { code: "RU", label: { ja: "ロシア", en: "Russia", "zh-CN": "俄罗斯", "zh-TW": "俄羅斯" } },
  { code: "OTHER", label: { ja: "その他", en: "Other", "zh-CN": "其他", "zh-TW": "其他" } },
];

export const GENDERS: Opt[] = [
  { code: "MALE", label: { ja: "男性", en: "Male", "zh-CN": "男", "zh-TW": "男" } },
  { code: "FEMALE", label: { ja: "女性", en: "Female", "zh-CN": "女", "zh-TW": "女" } },
  { code: "X", label: { ja: "その他/X", en: "X", "zh-CN": "其他/X", "zh-TW": "其他/X" } },
];

export const CHOOSE_REASONS: Opt[] = [
  { code: "errand_nearby", label: { ja: "この近くで用事がある", en: "Errands nearby", "zh-CN": "附近有事", "zh-TW": "附近有事" } },
  { code: "quiet_nature", label: { ja: "静かで自然あふれる場所で落ち着いて過ごしたい", en: "Quiet, nature, relaxation", "zh-CN": "想在安静自然的地方放松", "zh-TW": "想在安靜自然的地方放鬆" } },
  { code: "bbq", label: { ja: "バーベキューをやりたい", en: "Want to BBQ", "zh-CN": "想烧烤", "zh-TW": "想烤肉" } },
  { code: "other", label: { ja: "その他", en: "Other", "zh-CN": "其他", "zh-TW": "其他" } },
];

// 今回のご利用用途（独自ルール：日本国籍・国内住所ありの代表者のみ必須）
export const STAY_PURPOSES: Opt[] = [
  { code: "family", label: { ja: "家族", en: "Family", "zh-CN": "家人", "zh-TW": "家人" } },
  { code: "friends_family", label: { ja: "友人家族", en: "Friends & family", "zh-CN": "朋友及家人", "zh-TW": "朋友及家人" } },
  { code: "company", label: { ja: "会社関係", en: "Company/work related", "zh-CN": "公司相关", "zh-TW": "公司相關" } },
  { code: "friends", label: { ja: "友人", en: "Friends", "zh-CN": "朋友", "zh-TW": "朋友" } },
  { code: "couple", label: { ja: "カップル", en: "Couple", "zh-CN": "情侣", "zh-TW": "情侶" } },
  { code: "other", label: { ja: "その他", en: "Other", "zh-CN": "其他", "zh-TW": "其他" } },
];

export function optLabel(opts: Opt[], code: string | null | undefined, lang: Lang): string {
  if (!code) return "";
  const o = opts.find((x) => x.code === code);
  return o ? o.label[lang] ?? o.label.ja : code;
}
