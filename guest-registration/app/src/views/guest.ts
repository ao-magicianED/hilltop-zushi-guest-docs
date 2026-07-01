// ゲスト向け画面（入口・人数申告・進捗・入力フォーム・メッセージ）
import { html, raw } from "hono/html";
import type { Lang } from "../types";
import type { HE } from "./layout";
import { t, OCCUPATIONS, NATIONALITIES, GENDERS, CHOOSE_REASONS, optLabel } from "../lib/i18n";
import type { Guest, Reservation } from "../lib/db";
import type { FieldErrors } from "../lib/validation";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function errCls(errors: FieldErrors | undefined, key: string): string {
  return errors && (errors as Record<string, true>)[key] ? "err" : "";
}

export type StartChannel = "direct" | "airbnb" | "booking";
const OTA_CHANNELS: StartChannel[] = ["airbnb", "booking"];

// 見えないハニーポット（botがURL/フォーム解析で埋めがちな罠欄。中国でも動く軽量bot対策）
const HONEYPOT = `<input type="text" name="hp_extra" tabindex="-1" autocomplete="off" aria-hidden="true"
  style="position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0">`;

// 言語切替リンク(.langs a)に現在のOTA入力値(code/日付)を反映し、切替で入力が消えないようにする。
// 外部リソース不要・失敗してもフォームは通常動作（中国対応の最小JS）。
const OTA_LANG_SYNC_JS = `<script>
(function(){
  var form=document.getElementById('otaform'); if(!form) return;
  function g(n){var e=form.querySelector('[name="'+n+'"]');return e?e.value:'';}
  function sync(){
    var c=g('code'),i=g('check_in'),o=g('check_out');
    var as=document.querySelectorAll('.langs a');
    for(var k=0;k<as.length;k++){
      try{
        var u=new URL(as[k].href, location.origin);
        c?u.searchParams.set('code',c):u.searchParams.delete('code');
        i?u.searchParams.set('check_in',i):u.searchParams.delete('check_in');
        o?u.searchParams.set('check_out',o):u.searchParams.delete('check_out');
        as[k].setAttribute('href', u.pathname+u.search);
      }catch(_){}
    }
  }
  form.addEventListener('input', sync); sync();
})();
</script>`;

// 入口（予約元の選択）
export function channelChooserPage(lang: Lang): HE {
  const item = (ch: StartChannel, key: string) =>
    `<a class="btn secondary" style="margin-top:10px" href="/start?channel=${ch}&lang=${lang}">${t(lang, key)}</a>`;
  return html`
  <div class="card">
    <h1>${t(lang, "choose_channel_title")}</h1>
    <p class="muted">${t(lang, "choose_channel_desc")}</p>
    ${raw(item("direct", "channel_direct"))}
    ${raw(item("airbnb", "channel_airbnb"))}
    ${raw(item("booking", "channel_booking"))}
  </div>`;
}

// 入口（予約確認）。channelで直予約=突合 / OTA=突合なし を出し分け。
export function startPage(
  lang: Lang,
  opts: { channel: StartChannel; error?: string; code?: string; checkIn?: string; checkOut?: string }
): HE {
  const isOta = OTA_CHANNELS.includes(opts.channel);
  const backLink = html`<a class="muted" href="/start?lang=${lang}">← ${t(lang, "back")}</a>`;
  if (isOta) {
    const chLabel = opts.channel === "airbnb" ? t(lang, "channel_airbnb") : t(lang, "channel_booking");
    return html`
    <div class="card">
      ${backLink}
      <h1>${t(lang, "ota_title")}</h1>
      <p class="muted">${chLabel}</p>
      <p class="muted">${t(lang, "ota_desc")}</p>
      ${opts.error ? html`<div class="notice err">${opts.error}</div>` : ""}
      <form method="post" action="/start?lang=${lang}" id="otaform">
        <input type="hidden" name="channel" value="${esc(opts.channel)}">
        ${raw(HONEYPOT)}
        <label>${t(lang, "reservation_code")} <span class="req">*</span></label>
        <input type="text" name="code" value="${esc(opts.code ?? "")}" required autocomplete="off" autocapitalize="characters" placeholder="HMAPDB2SSB">
        <label>${t(lang, "check_in")} <span class="req">*</span></label>
        <input type="date" name="check_in" value="${esc(opts.checkIn ?? "")}" required>
        <label>${t(lang, "check_out")} <span class="req">*</span></label>
        <input type="date" name="check_out" value="${esc(opts.checkOut ?? "")}" required>
        <p class="muted">${t(lang, "ota_next_note")}</p>
        <button class="btn" type="submit">${t(lang, "continue")}</button>
      </form>
    </div>
    ${raw(OTA_LANG_SYNC_JS)}`;
  }
  // 直予約：従来どおり 予約番号＋姓で突合
  return html`
  <div class="card">
    ${backLink}
    <h1>${t(lang, "start_title")}</h1>
    <p class="muted">${t(lang, "start_desc")}</p>
    ${opts.error ? html`<div class="notice err">${opts.error}</div>` : ""}
    <form method="post" action="/start?lang=${lang}">
      <input type="hidden" name="channel" value="direct">
      ${raw(HONEYPOT)}
      <label>${t(lang, "reservation_code")} <span class="req">*</span></label>
      <input type="text" name="code" value="${esc(opts.code ?? "")}" required autocomplete="off">
      <label>${t(lang, "last_name")} <span class="req">*</span></label>
      <input type="text" name="last_name" required autocomplete="off">
      <button class="btn" type="submit">${t(lang, "verify")}</button>
    </form>
  </div>`;
}

// 人数申告（代表者）
export function declarePage(lang: Lang, opts: { token: string; max?: number; error?: string }): HE {
  const max = opts.max ?? 12;
  const options = Array.from({ length: max }, (_, i) => i + 1)
    .map((n) => `<option value="${n}">${n}</option>`)
    .join("");
  return html`
  <div class="card">
    <h1>${t(lang, "declare_title")}</h1>
    <p class="muted">${t(lang, "declare_desc")}</p>
    ${opts.error ? html`<div class="notice err">${opts.error}</div>` : ""}
    <form method="post" action="/g/${opts.token}/declare?lang=${lang}">
      <label>${t(lang, "num_guests")} <span class="req">*</span></label>
      <select name="count" required>${raw(options)}</select>
      <button class="btn" type="submit">${t(lang, "declare_submit")}</button>
    </form>
  </div>`;
}

// 進捗ダッシュボード（氏名＋済/未のみ。機微情報は出さない）
export function progressPage(
  lang: Lang,
  opts: {
    groupToken: string;
    guests: { slot_no: number; full_name: string | null; submit_status: string; editToken?: string }[];
    done: number;
    total: number;
  }
): HE {
  const pct = opts.total > 0 ? Math.round((opts.done / opts.total) * 100) : 0;
  const rows = opts.guests
    .map((g) => {
      const name = g.full_name ? esc(g.full_name) : `#${g.slot_no}`;
      const done = g.submit_status === "submitted";
      const badge = done
        ? `<span class="badge ok">${t(lang, "status_done")}</span>`
        : `<span class="badge pending">${t(lang, "status_pending")}</span>`;
      const link = g.editToken
        ? `<a class="muted" href="/p/${g.editToken}?lang=${lang}">${t(lang, "edit_link")}</a>`
        : "";
      return `<li><span>${name}</span><span style="display:flex;gap:10px;align-items:center">${link} ${badge}</span></li>`;
    })
    .join("");
  const allDone = opts.done >= opts.total && opts.total > 0;
  return html`
  <div class="card">
    <h1>${t(lang, "progress_title")}</h1>
    <p>${t(lang, "progress_count", { done: opts.done, total: opts.total })}</p>
    <div class="bar"><span style="width:${pct}%"></span></div>
    ${allDone ? html`<div class="notice ok">${t(lang, "all_done")}</div>` : ""}
    <ul class="list">${raw(rows)}</ul>
    <p class="muted">${t(lang, "share_links")}</p>
  </div>`;
}

function optionTags(opts: { code: string; label: Record<Lang, string> }[], lang: Lang, selected: string): string {
  return (
    `<option value=""></option>` +
    opts
      .map(
        (o) =>
          `<option value="${o.code}" ${o.code === selected ? "selected" : ""}>${esc(o.label[lang] ?? o.label.ja)}</option>`
      )
      .join("")
  );
}

// 入力フォーム
export function formPage(
  lang: Lang,
  opts: {
    token: string;
    guest: Guest;
    isRep: boolean;
    errors?: FieldErrors;
    values?: Record<string, string>;
    showErrorBanner?: boolean;
    requireEmail?: boolean;
  }
): HE {
  const v = opts.values ?? {};
  const e = opts.errors;
  const reqMark = `<span class="req">*</span>`;
  const optMark = `<span class="opt">${t(lang, "optional")}</span>`;

  const reasonChecks = CHOOSE_REASONS.map(
    (r) =>
      `<label class="checkrow"><input type="checkbox" name="choose_reason" value="${r.code}"> <span>${esc(
        r.label[lang] ?? r.label.ja
      )}</span></label>`
  ).join("");

  return html`
  <div class="card">
    <h1>${t(lang, "form_title")} ${opts.isRep ? "👑" : ""}</h1>
    ${opts.showErrorBanner ? html`<div class="notice err">${t(lang, "fix_errors")}</div>` : ""}

    <div class="notice warn">
      <strong>${t(lang, "terms_title")}</strong>
      <p>① ${t(lang, "terms_headcount")}</p>
      <p>② ${t(lang, "terms_extra_fee")}</p>
      <p>③ ${t(lang, "terms_legal")}</p>
    </div>

    <form method="post" action="/p/${opts.token}?lang=${lang}" enctype="multipart/form-data" id="gform">
      <input type="hidden" name="member_role" value="${opts.guest.member_role}">

      <label>${t(lang, "full_name")} ${raw(reqMark)}</label>
      <input class="${errCls(e, "full_name")}" type="text" name="full_name" value="${esc(v.full_name ?? "")}">

      <label>${t(lang, "has_jp_address")} ${raw(reqMark)}</label>
      <div class="row-radio ${errCls(e, "has_jp_address")}">
        <label><input type="radio" name="has_jp_address" value="1" ${v.has_jp_address === "1" ? "checked" : ""}> ${t(lang, "yes")}</label>
        <label><input type="radio" name="has_jp_address" value="0" ${v.has_jp_address === "0" ? "checked" : ""}> ${t(lang, "no")}</label>
      </div>

      <label>${t(lang, "address")} ${raw(reqMark)}</label>
      <input class="${errCls(e, "address")}" type="text" name="address" value="${esc(v.address ?? "")}">

      <label>${t(lang, "nationality")} ${raw(reqMark)}</label>
      <select class="${errCls(e, "nationality")}" name="nationality">${raw(optionTags(NATIONALITIES, lang, v.nationality ?? ""))}</select>

      <label>${t(lang, "nationality_other")} ${raw(optMark)}</label>
      <input class="${errCls(e, "nationality_other")}" type="text" name="nationality_other" value="${esc(v.nationality_other ?? "")}">

      <label>${t(lang, "passport_no")}</label>
      <input class="${errCls(e, "passport_no")}" type="text" name="passport_no" value="${esc(v.passport_no ?? "")}" autocapitalize="characters">

      <label>${t(lang, "passport_img")}</label>
      <input class="${errCls(e, "has_passport_img")}" type="file" name="passport_img" accept="image/*" id="imgfile">
      ${opts.guest.passport_img_key ? html`<p class="muted">✓ 画像アップロード済み / uploaded</p>` : ""}

      <label>${t(lang, "occupation")} ${raw(reqMark)}</label>
      <select class="${errCls(e, "occupation")}" name="occupation">${raw(optionTags(OCCUPATIONS, lang, v.occupation ?? ""))}</select>

      <label>${t(lang, "age")} ${raw(reqMark)}</label>
      <input class="${errCls(e, "age")}" type="number" name="age" inputmode="numeric" min="0" max="120" value="${esc(v.age ?? "")}">

      <label>${t(lang, "gender")} ${raw(reqMark)}</label>
      <select class="${errCls(e, "gender")}" name="gender">${raw(optionTags(GENDERS, lang, v.gender ?? ""))}</select>

      <label>${t(lang, "phone")} ${opts.isRep ? raw(reqMark) : raw(optMark)}</label>
      <input class="${errCls(e, "phone")}" type="tel" name="phone" value="${esc(v.phone ?? "")}">

      <label>${t(lang, "prev_stay")} ${raw(optMark)}</label>
      <input type="text" name="prev_stay" value="${esc(v.prev_stay ?? "")}">

      <label>${t(lang, "next_stay")} ${raw(optMark)}</label>
      <input type="text" name="next_stay" value="${esc(v.next_stay ?? "")}">

      <label>${t(lang, "email")} ${opts.requireEmail && opts.isRep ? raw(reqMark) : raw(optMark)}</label>
      <input class="${errCls(e, "email")}" type="email" name="email" value="${esc(v.email ?? "")}" autocomplete="email">
      ${opts.requireEmail && opts.isRep ? html`<p class="muted">${t(lang, "email_rep_req_note")}</p>` : ""}

      ${opts.isRep
        ? html`
      <h2>${t(lang, "choose_reason")}</h2>
      ${raw(reasonChecks)}
      <input type="text" name="choose_reason_other" placeholder="${t(lang, "choose_reason_other_label")}" value="${esc(v.choose_reason_other ?? "")}">
      `
        : ""}

      <div class="checkrow">
        <input type="checkbox" name="marketing_optin" value="1" id="mk">
        <label for="mk" style="font-weight:400;margin:0">${t(lang, "marketing_optin")}</label>
      </div>
      <p class="muted">${t(lang, "review_promo")}</p>

      <div class="checkrow">
        <input type="checkbox" name="consent_privacy" value="1" id="cp" required>
        <label for="cp" style="font-weight:400;margin:0">${t(lang, "consent_privacy")}</label>
      </div>
      <div class="checkrow">
        <input type="checkbox" name="consent_cross_border" value="1" id="cc" required>
        <label for="cc" style="font-weight:400;margin:0">${t(lang, "consent_cross_border")}</label>
      </div>

      <button class="btn" type="submit">${t(lang, "submit")}</button>
    </form>
  </div>
  ${raw(IMG_COMPRESS_JS)}`;
}

// 画像をクライアントで圧縮（長辺2000px/JPEG）。中国回線対策。失敗時は原本のまま送る。
const IMG_COMPRESS_JS = `<script>
(function(){
  var f=document.getElementById('imgfile'); if(!f) return;
  f.addEventListener('change', function(){
    var file=f.files&&f.files[0]; if(!file||!/^image\\//.test(file.type)) return;
    var img=new Image(), url=URL.createObjectURL(file);
    img.onload=function(){
      try{
        var max=2000, w=img.width, h=img.height, s=Math.min(1, max/Math.max(w,h));
        var c=document.createElement('canvas'); c.width=Math.round(w*s); c.height=Math.round(h*s);
        c.getContext('2d').drawImage(img,0,0,c.width,c.height);
        c.toBlob(function(b){
          URL.revokeObjectURL(url);
          if(!b||b.size>=file.size) return;
          try{ var dt=new DataTransfer(); dt.items.add(new File([b], 'passport.jpg', {type:'image/jpeg'})); f.files=dt.files; }catch(_){}
        }, 'image/jpeg', 0.82);
      }catch(_){ URL.revokeObjectURL(url); }
    };
    img.onerror=function(){ URL.revokeObjectURL(url); };
    img.src=url;
  });
})();
</script>`;

export function messagePage(
  lang: Lang,
  opts: { title: string; message: string; kind: "ok" | "warn" | "err"; backHref?: string; backLabel?: string }
): HE {
  return html`
  <div class="card">
    <h1>${opts.title}</h1>
    <div class="notice ${opts.kind}">${opts.message}</div>
    ${opts.backHref ? html`<a class="btn secondary" href="${opts.backHref}">${opts.backLabel ?? t(lang, "back_to_progress")}</a>` : ""}
  </div>`;
}

// 管理画面で氏名表示に使う（言語非依存の補助）
export function natLabel(code: string | null, lang: Lang): string {
  return optLabel(NATIONALITIES, code, lang);
}
