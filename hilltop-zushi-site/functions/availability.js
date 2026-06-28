// Cloudflare Pages Function:  GET /availability
// AirbnbのiCal(秘匿URL)をサーバー側で取得し、予約済み(ブロック)日付だけをJSONで返す。
// iCal URL本体はブラウザに出さない(env.AIRBNB_ICAL_URL = Cloudflare Secret)。
//
// レスポンス例:
//   { configured:true, updated:"2026-06-29T...", blocked:[{start:"2026-07-01",end:"2026-07-05"}] }
//   未設定時: { configured:false }

export async function onRequestGet(context) {
  const { env } = context;
  const icalUrl = env.AIRBNB_ICAL_URL;

  const json = (obj, maxAge) =>
    new Response(JSON.stringify(obj), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        // エッジで最大1時間キャッシュ(Airbnb iCalは最大3時間間隔更新なので十分)
        "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store",
      },
    });

  // iCal URL未設定 → 「準備中」をフロントに伝える(サイトは壊さない)
  if (!icalUrl) return json({ configured: false }, 0);

  try {
    const res = await fetch(icalUrl, {
      headers: { "user-agent": "HilltopZushi-Availability/1.0" },
      cf: { cacheTtl: 1800, cacheEverything: true },
    });
    // 失敗時は configured:false を返す = フロントは「空き状況を表示しない」。
    // 絶対に「全日空き」に見せない(ダブルブッキング防止のフェイルセーフ)。
    if (!res.ok) return json({ configured: false, error: true }, 120);

    const text = await res.text();
    const blocked = parseIcalBlocked(text);
    return json({ configured: true, updated: new Date().toISOString(), blocked }, 1800);
  } catch (e) {
    return json({ configured: false, error: true }, 60);
  }
}

// iCalのVEVENTから DTSTART/DTEND を取り出してブロック期間を返す。
// DTEND は排他(チェックアウト当日)なので、その日は空きとして扱う。
function parseIcalBlocked(ical) {
  // 折り返し行(行頭が空白/タブ)を結合
  const lines = ical.replace(/\r\n[ \t]/g, "").split(/\r?\n/);
  const ranges = [];
  let cur = null;
  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) cur = {};
    else if (line.startsWith("END:VEVENT")) {
      if (cur && cur.start && cur.end) ranges.push({ start: cur.start, end: cur.end });
      cur = null;
    } else if (cur) {
      if (line.startsWith("DTSTART")) cur.start = extractDate(line);
      else if (line.startsWith("DTEND")) cur.end = extractDate(line);
    }
  }
  return ranges.filter((r) => r.start && r.end);
}

// "DTSTART;VALUE=DATE:20260701" / "DTSTART:20260701T150000Z" → "2026-07-01"
function extractDate(line) {
  const v = line.slice(line.indexOf(":") + 1).trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
