// 提出時の必須ルール（設計 ⑤「提出済み」の定義）。版を持ち、出力前再検証にも使う。
export const SUBMIT_RULE_VERSION = "2026-07-01.v3";

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
  marketing_optin: boolean;
};

export type FieldErrors = Partial<Record<keyof GuestInput, true>>;

/** 日本国籍か */
export function isJapanese(input: Pick<GuestInput, "nationality">): boolean {
  return input.nationality === "JP";
}

/** 「日本国籍かつ国内に現住所あり」＝オーナー独自ルールの簡易記入対象（利用用途の要否のみに使用） */
export function isDomesticJapanese(input: Pick<GuestInput, "nationality" | "has_jp_address">): boolean {
  return isJapanese(input) && input.has_jp_address === "1";
}

/** 旅券写真・前泊地/後泊地が必要な人（独自ルール：日本国籍以外は全員対象。国内住所の有無は問わない）。
 * 旅券番号は法定でも求めておらず廃止済み。 */
export function needsPassportPhoto(input: Pick<GuestInput, "nationality">): boolean {
  return !isJapanese(input);
}

// メール形式の最小チェック（厳密RFCではなく実用十分）
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateGuest(input: GuestInput): { ok: boolean; errors: FieldErrors } {
  const e: FieldErrors = {};
  const isRep = input.member_role === "representative";
  const domestic = isDomesticJapanese(input);
  const foreignBucket = needsPassportPhoto(input); // 旅券写真・前泊地の要否と共通（=日本国籍以外）

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

  if (foreignBucket && !input.has_passport_img) e.has_passport_img = true;
  // 前泊地：日本国籍以外の人のみ必須（独自ルール）。日本国籍は前泊地・後泊地とも項目自体を出さない。
  if (foreignBucket && !input.prev_stay.trim()) e.prev_stay = true;

  // 利用用途：代表者かつ日本国籍・国内住所ありの場合のみ必須（独自ルール、グループ単位の設問）。
  if (isRep && domestic) {
    if (!input.stay_purpose) e.stay_purpose = true;
    if (input.stay_purpose === "other" && !input.stay_purpose_other.trim()) e.stay_purpose_other = true;
  }

  // 電話番号は必須要件から除外（独自ルール）

  // メール：代表者は常に必須。同行者は「この宿のクーポン希望（marketing_optin）」にチェックした場合のみ必須。
  if (isRep) {
    if (!input.email.trim()) e.email = true;
  } else if (input.marketing_optin && !input.email.trim()) {
    e.email = true;
  }
  if (input.email.trim() && !EMAIL_RE.test(input.email.trim())) e.email = true;

  return { ok: Object.keys(e).length === 0, errors: e };
}
