// 提出時の必須ルール（設計 ⑤「提出済み」の定義）。版を持ち、出力前再検証にも使う。
export const SUBMIT_RULE_VERSION = "2026-07-01.v2";

export type GuestInput = {
  member_role: string; // representative/companion
  full_name: string;
  has_jp_address: string; // "1"/"0"/""
  address: string;
  nationality: string;
  nationality_other: string;
  has_passport_img: boolean;
  occupation: string;
  age: string;
  gender: string;
  phone: string;
  email: string;
  prev_stay: string;
  stay_purpose: string;
  stay_purpose_other: string;
};

export type FieldErrors = Partial<Record<keyof GuestInput, true>>;

/** 「日本国籍かつ国内に現住所あり」＝オーナー独自ルールの簡易記入対象 */
export function isDomesticJapanese(input: Pick<GuestInput, "nationality" | "has_jp_address">): boolean {
  return input.nationality === "JP" && input.has_jp_address === "1";
}

/** 旅券写真が必要な人（独自ルール：法定の「外国籍かつ国内住所なし」より広く、
 * 「日本国籍かつ国内住所あり」以外は全員に旅券写真を求める）。旅券番号は法定でも求めておらず廃止済み。 */
export function needsPassportPhoto(input: Pick<GuestInput, "nationality" | "has_jp_address">): boolean {
  return !isDomesticJapanese(input);
}

// メール形式の最小チェック（厳密RFCではなく実用十分）
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateGuest(
  input: GuestInput,
  opts: { requireEmail?: boolean } = {}
): { ok: boolean; errors: FieldErrors } {
  const e: FieldErrors = {};
  const isRep = input.member_role === "representative";
  const domestic = isDomesticJapanese(input);

  if (!input.full_name.trim()) e.full_name = true;
  if (input.has_jp_address !== "0" && input.has_jp_address !== "1") e.has_jp_address = true;
  if (!input.address.trim()) e.address = true;
  if (!input.nationality) e.nationality = true;
  if (input.nationality === "OTHER" && !input.nationality_other.trim()) e.nationality_other = true;
  if (!input.occupation) e.occupation = true;

  // 年齢・性別は独自ルールでは必須項目に含めない（任意）。入力があれば範囲だけ検証する。
  if (input.age.trim()) {
    const ageNum = parseInt(input.age, 10);
    if (Number.isNaN(ageNum) || ageNum < 0 || ageNum > 120) e.age = true;
  }

  if (needsPassportPhoto(input) && !input.has_passport_img) e.has_passport_img = true;

  // 前泊地：日本国籍かつ国内住所ありの人は任意。それ以外（非居住日本人・外国籍）は必須（独自ルール）。
  if (!domestic && !input.prev_stay.trim()) e.prev_stay = true;

  // 利用用途：代表者かつ日本国籍・国内住所ありの場合のみ必須（独自ルール、グループ単位の設問）。
  if (isRep && domestic) {
    if (!input.stay_purpose) e.stay_purpose = true;
    if (input.stay_purpose === "other" && !input.stay_purpose_other.trim()) e.stay_purpose_other = true;
  }

  // 代表者は当日連絡先（電話）必須
  if (isRep && !input.phone.trim()) e.phone = true;

  // OTA経由（予約者情報が無い）の代表者はメール必須。値があれば形式も検証。
  if (opts.requireEmail && isRep && !input.email.trim()) e.email = true;
  if (input.email.trim() && !EMAIL_RE.test(input.email.trim())) e.email = true;

  return { ok: Object.keys(e).length === 0, errors: e };
}
