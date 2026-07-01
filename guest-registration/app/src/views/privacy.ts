// プライバシーポリシー（個人情報保護法・住宅宿泊事業法対応）多言語ページ
import { html, raw } from "hono/html";
import type { Lang } from "../types";
import type { HE } from "./layout";

type Section = { h: string; p: string[] };
type Content = { title: string; updated: string; sections: Section[] };

const CONTENT: Record<Lang, Content> = {
  ja: {
    title: "プライバシーポリシー（宿泊者情報の取り扱いについて）",
    updated: "最終更新日：2026年7月1日",
    sections: [
      {
        h: "事業者・運営施設",
        p: [
          "本サービスは、Hilltop Zushi（神奈川県逗子市・住宅宿泊事業）の宿泊者名簿収集のために、ブルーステージ合同会社が運営します。",
          "お問い合わせ窓口：hilltop.zushi@gmail.com",
        ],
      },
      {
        h: "①取得する情報",
        p: [
          "氏名、住所、職業、国籍、旅券番号、旅券画像（該当者のみ）、電話番号、年齢、性別、前泊地・後泊地、メールアドレス、宿泊日程。",
          "任意でお伺いする情報：当施設を選んだ理由、マーケティング配信の希望有無。",
        ],
      },
      {
        h: "②利用目的",
        p: [
          "住宅宿泊事業法に基づく宿泊者名簿の作成・保管のため。",
          "本人確認、緊急時のご連絡のため。",
          "行政機関（保健所・警察・観光庁等）から法令に基づく開示要請があった場合の提出のため。",
          "上記以外の目的（勧誘等）には利用しません。ただし、マーケティング配信への同意をいただいた方に限り、当施設からのお得な情報のご案内に利用します（いつでも配信停止できます）。",
        ],
      },
      {
        h: "③保存期間",
        p: [
          "宿泊者名簿・旅券画像とも、作成日とチェックアウト日の遅い方から5年間保存します（住宅宿泊事業法が定める3年以上の保存義務を満たす期間として設定）。",
          "保存期間を過ぎたデータは自動的に削除されます。",
        ],
      },
      {
        h: "④第三者提供",
        p: ["法令に基づく行政機関からの開示要請があった場合を除き、第三者に提供することはありません。"],
      },
      {
        h: "⑤委託先・保管場所（越境移転について）",
        p: [
          "本サービスのデータ保管・配信には Cloudflare, Inc.（米国法人）のサーバーを利用しています。取得した情報は日本国外（米国等）のサーバーで処理・保管される場合があります。",
          "Cloudflareは業務委託先であり、個人情報保護法上の「第三者提供」には該当しません（委託の範囲内での取り扱いです）。",
        ],
      },
      {
        h: "⑥安全管理措置",
        p: [
          "住所・旅券番号・電話番号・旅券画像は暗号化して保存します。",
          "管理画面へのアクセスは、認証されたスタッフのみに制限し、二段階認証を必須にしています。",
          "旅券画像の閲覧・データの出力等の操作は、すべて記録（監査ログ）に残しています。",
        ],
      },
      {
        h: "⑦保有個人データの開示・訂正・削除等の請求",
        p: [
          "ご自身の情報の開示・訂正・削除・利用停止をご希望の場合は、上記お問い合わせ窓口までご連絡ください。",
          "ただし、住宅宿泊事業法に基づく保存義務（保存期間中の削除不可）がある場合は、これを優先させていただきます。",
        ],
      },
      {
        h: "⑧お問い合わせ・苦情の窓口",
        p: ["本ポリシーおよび個人情報の取り扱いに関するお問い合わせ・苦情は、hilltop.zushi@gmail.com までご連絡ください。"],
      },
    ],
  },
  en: {
    title: "Privacy Policy (Handling of Guest Information)",
    updated: "Last updated: July 1, 2026",
    sections: [
      {
        h: "Operator & Property",
        p: [
          "This service is operated by BLUE STAGE LLC for collecting the legally required guest registry for Hilltop Zushi (a licensed home-sharing property in Zushi, Kanagawa, Japan).",
          "Contact: hilltop.zushi@gmail.com",
        ],
      },
      {
        h: "1. Information Collected",
        p: [
          "Full name, address, occupation, nationality, passport number, passport photo (where applicable), phone number, age, gender, previous/next place of stay, email address, and stay dates.",
          "Optional: reason for choosing this property, marketing opt-in preference.",
        ],
      },
      {
        h: "2. Purpose of Use",
        p: [
          "To create and maintain the guest registry required under Japan's Housing Accommodation Business Act.",
          "For identity verification and emergency contact.",
          "To provide information to government authorities (health center, police, tourism agency, etc.) upon lawful request.",
          "We do not use your data for any other purpose. If you opt in to marketing, we may send you offers from this property (you can unsubscribe anytime).",
        ],
      },
      {
        h: "3. Retention Period",
        p: [
          "Both the guest registry and passport photos are retained for 5 years from the later of the record's creation date or your checkout date (exceeding the legally required minimum of 3 years).",
          "Data is automatically deleted after this period.",
        ],
      },
      {
        h: "4. Third-Party Disclosure",
        p: ["We do not share your data with third parties, except when legally required by government authorities."],
      },
      {
        h: "5. Subcontractor & Cross-Border Transfer",
        p: [
          "Data is stored and delivered using servers operated by Cloudflare, Inc. (a U.S. company). Your information may be processed and stored on servers located outside Japan (e.g., the United States).",
          "Cloudflare acts as our data processor; this is not considered a \"third-party disclosure\" under Japanese privacy law.",
        ],
      },
      {
        h: "6. Security Measures",
        p: [
          "Address, passport number, phone number, and passport photos are encrypted at rest.",
          "Access to the admin dashboard is restricted to authenticated staff with mandatory two-factor authentication.",
          "All access to passport photos and data exports is logged in an audit trail.",
        ],
      },
      {
        h: "7. Access, Correction, and Deletion Requests",
        p: [
          "To request access to, correction of, or deletion of your information, please contact us at the address below.",
          "Requests may be limited where retention is legally mandated during the required retention period.",
        ],
      },
      {
        h: "8. Inquiries and Complaints",
        p: ["For questions or complaints regarding this policy or your personal data, please contact hilltop.zushi@gmail.com."],
      },
    ],
  },
  "zh-CN": {
    title: "隐私政策（住客信息处理说明）",
    updated: "最后更新：2026年7月1日",
    sections: [
      {
        h: "运营主体与设施",
        p: [
          "本服务由 BLUE STAGE LLC（蓝阶合同会社）运营，用于收集 Hilltop Zushi（神奈川县逗子市・住宅住宿事业）的法定住客名簿信息。",
          "咨询窗口：hilltop.zushi@gmail.com",
        ],
      },
      {
        h: "①收集的信息",
        p: [
          "姓名、住址、职业、国籍、护照号码、护照照片（如适用）、电话号码、年龄、性别、前一晚/下一晚住宿地、电子邮箱、入住日期。",
          "选填信息：选择本住宿的理由、是否愿意接收营销信息。",
        ],
      },
      {
        h: "②使用目的",
        p: [
          "用于制作和保管日本《住宅住宿事业法》规定的住客名簿。",
          "用于身份确认及紧急联系。",
          "根据法律要求向行政机关（保健所、警察、观光厅等）提供信息。",
          "不会用于上述以外的目的。仅在您同意接收营销信息的情况下，用于向您发送本住宿的优惠信息（可随时取消订阅）。",
        ],
      },
      {
        h: "③保存期限",
        p: [
          "住客名簿及护照照片均自记录创建日与退房日期中较晚者起保存5年（超过法定最低3年的保存义务）。",
          "超过保存期限的数据将自动删除。",
        ],
      },
      { h: "④第三方提供", p: ["除法律要求向行政机关提供外，不会向第三方提供您的信息。"] },
      {
        h: "⑤委托方与跨境传输",
        p: [
          "本服务的数据存储与分发使用 Cloudflare, Inc.（美国公司）的服务器。您的信息可能在日本境外（如美国）的服务器上处理和存储。",
          "Cloudflare 为我们的数据处理受托方，不属于日本个人信息保护法上的「第三方提供」。",
        ],
      },
      {
        h: "⑥安全管理措施",
        p: [
          "住址、护照号码、电话号码、护照照片均加密保存。",
          "管理后台的访问仅限已认证的工作人员，并强制要求双重认证。",
          "护照照片的查看及数据导出等操作均会记录在审计日志中。",
        ],
      },
      {
        h: "⑦查询、更正、删除等请求",
        p: [
          "如需查询、更正、删除或停止使用您的信息，请通过下方窗口联系我们。",
          "但在法定保存期限内，出于法律义务将优先保留相关数据。",
        ],
      },
      { h: "⑧咨询与投诉窗口", p: ["有关本政策或个人信息处理的咨询与投诉，请联系 hilltop.zushi@gmail.com。"] },
    ],
  },
  "zh-TW": {
    title: "隱私政策（住客資訊處理說明）",
    updated: "最後更新：2026年7月1日",
    sections: [
      {
        h: "營運主體與設施",
        p: [
          "本服務由 BLUE STAGE LLC（藍階合同會社）營運，用於收集 Hilltop Zushi（神奈川縣逗子市・住宅住宿事業）的法定住客名簿資訊。",
          "諮詢窗口：hilltop.zushi@gmail.com",
        ],
      },
      {
        h: "①收集的資訊",
        p: [
          "姓名、住址、職業、國籍、護照號碼、護照照片（如適用）、電話號碼、年齡、性別、前一晚/下一晚住宿地、電子郵件、入住日期。",
          "選填資訊：選擇本住宿的理由、是否願意接收行銷資訊。",
        ],
      },
      {
        h: "①使用目的",
        p: [
          "用於製作與保管日本《住宅住宿事業法》規定的住客名簿。",
          "用於身分確認及緊急聯絡。",
          "依法向行政機關（保健所、警察、觀光廳等）提供資訊。",
          "不會用於上述以外的目的。僅在您同意接收行銷資訊的情況下，用於向您傳送本住宿的優惠資訊（可隨時取消訂閱）。",
        ],
      },
      {
        h: "③保存期限",
        p: [
          "住客名簿及護照照片均自紀錄建立日與退房日期中較晚者起保存5年（超過法定最低3年的保存義務）。",
          "超過保存期限的資料將自動刪除。",
        ],
      },
      { h: "④第三方提供", p: ["除法律要求向行政機關提供外，不會向第三方提供您的資訊。"] },
      {
        h: "⑤委託方與跨境傳輸",
        p: [
          "本服務的資料儲存與分發使用 Cloudflare, Inc.（美國公司）的伺服器。您的資訊可能在日本境外（如美國）的伺服器上處理與儲存。",
          "Cloudflare 為我們的資料處理受託方，不屬於日本個人資訊保護法上的「第三方提供」。",
        ],
      },
      {
        h: "⑥安全管理措施",
        p: [
          "住址、護照號碼、電話號碼、護照照片均加密儲存。",
          "管理後台的存取僅限已認證的工作人員，並強制要求雙重認證。",
          "護照照片的查看及資料匯出等操作均會記錄於稽核日誌中。",
        ],
      },
      {
        h: "⑦查詢、更正、刪除等請求",
        p: [
          "如需查詢、更正、刪除或停止使用您的資訊，請透過下方窗口聯絡我們。",
          "但在法定保存期限內，基於法律義務將優先保留相關資料。",
        ],
      },
      { h: "⑧諮詢與投訴窗口", p: ["有關本政策或個人資訊處理之諮詢與投訴，請聯絡 hilltop.zushi@gmail.com。"] },
    ],
  },
};

export function privacyPolicyPage(lang: Lang): HE {
  const c = CONTENT[lang] ?? CONTENT.ja;
  const sections = c.sections
    .map(
      (s) =>
        `<h2>${s.h}</h2>${s.p.map((line) => `<p>${line}</p>`).join("")}`
    )
    .join("");
  return html`
  <div class="card">
    <h1>${c.title}</h1>
    <p class="muted">${c.updated}</p>
    ${raw(sections)}
  </div>`;
}
