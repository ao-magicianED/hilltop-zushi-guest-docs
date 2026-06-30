// 提出時の必須ルール（設計 ⑤「提出済み」の定義）。版を持ち、出力前再検証にも使う。
export const SUBMIT_RULE_VERSION = "2026-06-29.v1";

export type GuestInput = {
  member_role: string; // representative/companion
  full_name: string;
  has_jp_address: string; // "1"/"0"/""
  address: string;
  nationality: string;
  nationality_other: string;
  passport_no: string;
  has_passport_img: boolean;
  occupation: string;
  age: string;
  gender: string;
  phone: string;
  email: string;
};

export type FieldErrors = Partial<Record<keyof GuestInput, true>>;

/** 外国人かつ国内住所なし＝旅券番号・画像が必須（住宅宿泊事業法の条件付き必須） */
export function isForeignerNeedingPassport(input: GuestInput): boolean {
  return input.has_jp_address === "0" && input.nationality !== "JP";
}

// メール形式の最小チェック（厳密RFCではなく実用十分）
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateGuest(
  input: GuestInput,
  opts: { requireEmail?: boolean } = {}
): { ok: boolean; errors: FieldErrors } {
  const e: FieldErrors = {};
  if (!input.full_name.trim()) e.full_name = true;
  if (input.has_jp_address !== "0" && input.has_jp_address !== "1") e.has_jp_address = true;
  if (!input.address.trim()) e.address = true;
  if (!input.nationality) e.nationality = true;
  if (input.nationality === "OTHER" && !input.nationality_other.trim()) e.nationality_other = true;
  if (!input.occupation) e.occupation = true;

  const ageNum = parseInt(input.age, 10);
  if (!input.age.trim() || Number.isNaN(ageNum) || ageNum < 0 || ageNum > 120) e.age = true;
  if (!input.gender) e.gender = true;

  if (isForeignerNeedingPassport(input)) {
    if (!input.passport_no.trim()) e.passport_no = true;
    if (!input.has_passport_img) e.has_passport_img = true;
  }

  // 代表者は当日連絡先（電話）必須
  if (input.member_role === "representative" && !input.phone.trim()) e.phone = true;

  // OTA経由（予約者情報が無い）の代表者はメール必須。値があれば形式も検証。
  const isRep = input.member_role === "representative";
  if (opts.requireEmail && isRep && !input.email.trim()) e.email = true;
  if (input.email.trim() && !EMAIL_RE.test(input.email.trim())) e.email = true;

  return { ok: Object.keys(e).length === 0, errors: e };
}
