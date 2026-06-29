// 売上・稼働の指標計算（ADR / 稼働率 / RevPAR など）
// 1棟貸し（在庫1ユニット）前提。月をまたぐ滞在は泊数で按分する（stay-based）。

export type ResForMetrics = {
  check_in_date: string; // YYYY-MM-DD
  check_out_date: string;
  total_amount: number | null;
  cleaning_fee: number | null;
  channel: string;
  status: string;
};

function days(dateStr: string): number {
  return Math.floor(Date.parse(dateStr + "T00:00:00Z") / 86400000);
}

/** [aStart,aEnd) と [bStart,bEnd) の重なり泊数 */
function overlapNights(aStart: string, aEnd: string, bStart: number, bEnd: number): number {
  const s = Math.max(days(aStart), bStart);
  const e = Math.min(days(aEnd), bEnd);
  return Math.max(0, e - s);
}

export function daysInMonth(year: number, month1to12: number): number {
  return (Date.UTC(year, month1to12, 1) - Date.UTC(year, month1to12 - 1, 1)) / 86400000;
}

export type MonthlyMetrics = {
  year: number;
  month: number;
  availableNights: number;
  bookedNights: number;
  occupancy: number; // 0..1
  roomRevenue: number; // 室料（清掃料を除く）按分後の合計
  grossRevenue: number; // 総額の按分後合計（清掃料込み）
  adr: number; // 室料 / 販売泊数
  revpar: number; // 室料 / 在庫泊数
  bookings: number; // 当月チェックインの予約数
  avgLos: number; // 当月チェックインの平均泊数
  byChannel: { channel: string; nights: number; roomRevenue: number }[];
};

export function computeMonthly(reservations: ResForMetrics[], year: number, month1to12: number): MonthlyMetrics {
  const mStart = days(`${year}-${String(month1to12).padStart(2, "0")}-01`);
  const mEnd = mStart + daysInMonth(year, month1to12);
  const available = daysInMonth(year, month1to12);

  let bookedNights = 0;
  let roomRevenue = 0;
  let grossRevenue = 0;
  let bookings = 0;
  let losSum = 0;
  const ch = new Map<string, { nights: number; roomRevenue: number }>();

  for (const r of reservations) {
    if (r.status === "cancelled") continue;
    const totalNights = days(r.check_out_date) - days(r.check_in_date);
    if (totalNights <= 0) continue;
    const nin = overlapNights(r.check_in_date, r.check_out_date, mStart, mEnd);

    // 当月チェックインの件数・平均泊数
    const ci = days(r.check_in_date);
    if (ci >= mStart && ci < mEnd) {
      bookings += 1;
      losSum += totalNights;
    }
    if (nin <= 0) continue;

    const gross = r.total_amount ?? 0;
    const room = Math.max(0, gross - (r.cleaning_fee ?? 0));
    const ratio = nin / totalNights;
    const allocRoom = room * ratio;
    const allocGross = gross * ratio;

    bookedNights += nin;
    roomRevenue += allocRoom;
    grossRevenue += allocGross;

    const cur = ch.get(r.channel) ?? { nights: 0, roomRevenue: 0 };
    cur.nights += nin;
    cur.roomRevenue += allocRoom;
    ch.set(r.channel, cur);
  }

  const round = (n: number) => Math.round(n);
  return {
    year,
    month: month1to12,
    availableNights: available,
    bookedNights,
    occupancy: available > 0 ? bookedNights / available : 0,
    roomRevenue: round(roomRevenue),
    grossRevenue: round(grossRevenue),
    adr: bookedNights > 0 ? round(roomRevenue / bookedNights) : 0,
    revpar: available > 0 ? round(roomRevenue / available) : 0,
    bookings,
    avgLos: bookings > 0 ? Math.round((losSum / bookings) * 10) / 10 : 0,
    byChannel: [...ch.entries()].map(([channel, v]) => ({ channel, nights: v.nights, roomRevenue: round(v.roomRevenue) })),
  };
}
