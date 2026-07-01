// iCal(VEVENT)の簡易パーサ。Airbnbのエクスポートカレンダーから予約日程を取り込む。
// Airbnbの予約は SUMMARY が "Reserved"、ブロックは "Airbnb (Not available)" 等。

export type IcalEvent = {
  uid: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD（排他＝チェックアウト日）
  summary: string;
  code?: string; // Airbnb確認コード（DESCRIPTIONから抽出）
};

function unfold(text: string): string[] {
  // RFC5545: 行頭が空白/タブの行は前行の継続
  const raw = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function toDate(val: string): string | null {
  // "20260801" or "2026-08-01" or "20260801T000000Z" → YYYY-MM-DD
  const m = val.match(/(\d{4})-?(\d{2})-?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function parseIcal(text: string): IcalEvent[] {
  const lines = unfold(text);
  const events: IcalEvent[] = [];
  let cur: Partial<IcalEvent> | null = null;
  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) {
      cur = {};
    } else if (line.startsWith("END:VEVENT")) {
      if (cur && cur.uid && cur.start && cur.end) {
        // code（DESCRIPTION由来の予約番号）も保持する。欠落すると予約番号取込・自己申告の統合が機能しない。
        events.push({ uid: cur.uid, start: cur.start, end: cur.end, summary: cur.summary ?? "", code: cur.code });
      }
      cur = null;
    } else if (cur) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const keyPart = line.slice(0, idx); // 例: DTSTART;VALUE=DATE
      const value = line.slice(idx + 1).trim();
      const key = keyPart.split(";")[0]!.toUpperCase();
      if (key === "UID") cur.uid = value;
      else if (key === "DTSTART") cur.start = toDate(value) ?? cur.start;
      else if (key === "DTEND") cur.end = toDate(value) ?? cur.end;
      else if (key === "SUMMARY") cur.summary = value;
      else if (key === "DESCRIPTION") {
        const m = value.match(/reservations\/details\/([A-Z0-9]+)/i);
        if (m) cur.code = m[1];
      }
    }
  }
  return events;
}

/** 予約（=宿泊）とみなすイベントだけ抽出。Airbnbは "Reserved"。 */
export function reservedEvents(events: IcalEvent[]): IcalEvent[] {
  const reserved = events.filter((e) => /reserv/i.test(e.summary));
  // SUMMARYが取れないカレンダーもあるため、"reserved"が皆無なら全件返す（ブロックも含む点は運用で削除）
  return reserved.length ? reserved : events;
}
