// 共通レイアウト（中国対応：外部リソース0・システムフォント・最小JS）設計 ⑩
import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { Lang } from "../types";

// hono の html`` は内容により Promise を返し得る
export type HE = HtmlEscapedString | Promise<HtmlEscapedString>;

// システムフォントのみ（簡体=PingFang SC/YaHei、繁体=PingFang TC/Microsoft JhengHei）F-4
const CSS = `
:root{--bg:#f7f7f5;--card:#fff;--ink:#1f2937;--muted:#6b7280;--line:#e5e7eb;
--accent:#1a3a6c;--accent2:#1e4d8c;--ok:#15803d;--okbg:#dcfce7;--warn:#b45309;--warnbg:#fef3c7;
--err:#b91c1c;--errbg:#fee2e2;--radius:12px;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Sans","Yu Gothic UI",
"Microsoft YaHei","PingFang SC","Noto Sans CJK SC","PingFang TC","Microsoft JhengHei","Noto Sans CJK TC",sans-serif;
line-height:1.6;-webkit-text-size-adjust:100%}
.wrap{max-width:560px;margin:0 auto;padding:16px}
.brand{font-weight:700;color:var(--accent);font-size:15px;letter-spacing:.02em}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:18px;margin:14px 0}
h1{font-size:20px;margin:.2em 0 .4em}
h2{font-size:16px;margin:1.2em 0 .4em}
p{margin:.5em 0}
.muted{color:var(--muted);font-size:13px}
label{display:block;font-weight:600;margin:14px 0 4px;font-size:14px}
.req{color:var(--err);font-weight:700}
.opt{color:var(--muted);font-weight:400}
input[type=text],input[type=email],input[type=tel],input[type=number],select,textarea{
width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px;font-size:16px;background:#fff;color:var(--ink)}
input.err,select.err{border-color:var(--err);background:var(--errbg)}
.row-radio{display:flex;gap:10px;flex-wrap:wrap}
.row-radio label{font-weight:500;display:flex;align-items:center;gap:6px;margin:6px 0;
border:1px solid var(--line);border-radius:10px;padding:8px 12px;cursor:pointer}
.btn{display:inline-block;width:100%;text-align:center;background:var(--accent);color:#fff;border:0;
border-radius:10px;padding:13px 16px;font-size:16px;font-weight:700;cursor:pointer;text-decoration:none;margin-top:8px}
.btn.secondary{background:#fff;color:var(--accent);border:1px solid var(--accent)}
.notice{border-radius:10px;padding:12px 14px;font-size:14px;margin:10px 0}
.notice.warn{background:var(--warnbg);border:1px solid #fcd34d;color:#7c2d12}
.notice.err{background:var(--errbg);border:1px solid #fca5a5;color:#7f1d1d}
.notice.ok{background:var(--okbg);border:1px solid #86efac;color:#14532d}
.bar{height:10px;background:var(--line);border-radius:999px;overflow:hidden;margin:8px 0}
.bar>span{display:block;height:100%;background:var(--ok)}
.list{list-style:none;padding:0;margin:8px 0}
.list li{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
.badge{font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px}
.badge.ok{background:var(--okbg);color:var(--ok)}
.badge.pending{background:var(--warnbg);color:var(--warn)}
.langs{display:flex;gap:8px;justify-content:flex-end;font-size:13px}
.langs a{color:var(--muted);text-decoration:none}
.langs a.active{color:var(--accent);font-weight:700}
.checkrow{display:flex;gap:10px;align-items:flex-start;margin:12px 0;font-size:14px}
.checkrow input{margin-top:3px;width:18px;height:18px;flex:0 0 auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
`;

export function langSwitcher(current: Lang, path: string): HE {
  const langs: [Lang, string][] = [["ja", "日本語"], ["en", "EN"], ["zh-CN", "简体"], ["zh-TW", "繁體"]];
  const sep = path.includes("?") ? "&" : "?";
  return html`<div class="langs">${raw(
    langs
      .map(([code, name]) =>
        `<a class="${code === current ? "active" : ""}" href="${path}${sep}lang=${code}">${name}</a>`
      )
      .join(" ")
  )}</div>`;
}

export function layout(opts: {
  title: string;
  lang: Lang;
  path: string;
  body: HE | HE[];
  brand?: string;
  showLangs?: boolean;
}): HE {
  const htmlLang = opts.lang === "zh-CN" ? "zh-Hans" : opts.lang === "zh-TW" ? "zh-Hant" : opts.lang;
  return html`<!doctype html>
<html lang="${htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${opts.title}</title>
<style>${raw(CSS)}</style>
</head>
<body>
<div class="wrap">
  <div class="brand">${opts.brand ?? "Hilltop Zushi"}</div>
  ${opts.showLangs === false ? "" : langSwitcher(opts.lang, opts.path)}
  ${opts.body}
</div>
</body>
</html>`;
}
