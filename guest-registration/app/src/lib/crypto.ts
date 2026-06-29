// 機微情報のエンベロープ暗号化（設計 ⑧）
// レコードごとに使い捨てDEKでAES-256-GCM暗号化 → DEKをKEK(MASTER_KEY)で暗号化して同梱。
// 文字列1本（JSON→base64）に直列化してD1のTEXTへ保存する。

const KEK_VERSION = 1;

function b64encode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKek(masterKeyB64: string): Promise<CryptoKey> {
  const raw = b64decode(masterKeyB64);
  if (raw.length !== 32) {
    throw new Error("MASTER_KEY は base64 の 32 バイトである必要があります");
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

type Envelope = {
  v: number;
  kekv: number;
  iv: string; // 本文IV
  ct: string; // 本文暗号文
  dekIv: string; // DEK暗号化IV
  dek: string; // KEKで暗号化したDEK
};

/** 平文を暗号化し、保存用の1本の文字列を返す。空文字/undefined はそのまま null を返す。 */
export async function encryptField(
  masterKeyB64: string,
  plaintext: string | null | undefined
): Promise<string | null> {
  if (plaintext == null || plaintext === "") return null;
  const kek = await importKek(masterKeyB64);

  // 使い捨てDEKを生成
  const dekRaw = crypto.getRandomValues(new Uint8Array(32));
  const dek = await crypto.subtle.importKey("raw", dekRaw, { name: "AES-GCM" }, false, ["encrypt"]);

  // 本文をDEKで暗号化
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dek, new TextEncoder().encode(plaintext))
  );

  // DEKをKEKで暗号化
  const dekIv = crypto.getRandomValues(new Uint8Array(12));
  const dekWrapped = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: dekIv }, kek, dekRaw)
  );

  const env: Envelope = {
    v: 1,
    kekv: KEK_VERSION,
    iv: b64encode(iv),
    ct: b64encode(ct),
    dekIv: b64encode(dekIv),
    dek: b64encode(dekWrapped),
  };
  return JSON.stringify(env);
}

/** encryptField で作った文字列を復号する。 */
export async function decryptField(
  masterKeyB64: string,
  blob: string | null | undefined
): Promise<string | null> {
  if (blob == null || blob === "") return null;
  const kek = await importKek(masterKeyB64);
  const env = JSON.parse(blob) as Envelope;

  // DEKをKEKで復号
  const dekRaw = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64decode(env.dekIv) }, kek, b64decode(env.dek))
  );
  const dek = await crypto.subtle.importKey("raw", dekRaw, { name: "AES-GCM" }, false, ["decrypt"]);

  // 本文をDEKで復号
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64decode(env.iv) }, dek, b64decode(env.ct));
  return new TextDecoder().decode(pt);
}

/** バイト列（画像など）を暗号化して Uint8Array で返す（R2保存用） */
export async function encryptBytes(
  masterKeyB64: string,
  data: Uint8Array
): Promise<Uint8Array> {
  const kek = await importKek(masterKeyB64);
  const dekRaw = crypto.getRandomValues(new Uint8Array(32));
  const dek = await crypto.subtle.importKey("raw", dekRaw, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dek, data));
  const dekIv = crypto.getRandomValues(new Uint8Array(12));
  const dekWrapped = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: dekIv }, kek, dekRaw));

  // フォーマット: [magic 'HZ1'][kekv:1][dekIv:12][dekLen:2][dek][iv:12][ct...]
  const header = new Uint8Array(3 + 1 + 12 + 2 + dekWrapped.length + 12);
  let o = 0;
  header.set([0x48, 0x5a, 0x31], o); o += 3; // 'HZ1'
  header[o++] = KEK_VERSION;
  header.set(dekIv, o); o += 12;
  header[o++] = (dekWrapped.length >> 8) & 0xff;
  header[o++] = dekWrapped.length & 0xff;
  header.set(dekWrapped, o); o += dekWrapped.length;
  header.set(iv, o); o += 12;

  const out = new Uint8Array(header.length + ct.length);
  out.set(header, 0);
  out.set(ct, header.length);
  return out;
}

/** encryptBytes で作ったバイト列を復号する */
export async function decryptBytes(masterKeyB64: string, blob: Uint8Array): Promise<Uint8Array> {
  const kek = await importKek(masterKeyB64);
  let o = 0;
  if (!(blob[0] === 0x48 && blob[1] === 0x5a && blob[2] === 0x31)) {
    throw new Error("暗号化画像のヘッダが不正です");
  }
  o += 3;
  o += 1; // kekv
  const dekIv = blob.slice(o, o + 12); o += 12;
  const dekLen = (blob[o]! << 8) | blob[o + 1]!; o += 2;
  const dekWrapped = blob.slice(o, o + dekLen); o += dekLen;
  const iv = blob.slice(o, o + 12); o += 12;
  const ct = blob.slice(o);

  const dekRaw = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: dekIv }, kek, dekWrapped));
  const dek = await crypto.subtle.importKey("raw", dekRaw, { name: "AES-GCM" }, false, ["decrypt"]);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, dek, ct));
}
