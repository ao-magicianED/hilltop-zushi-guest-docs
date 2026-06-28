# Hilltop Zushi サイト デプロイ手順（必読）

公開URL: https://hilltop-zushi-arh.pages.dev/

## 鉄則（過去2回、360画像が消えた事故の再発防止）

1. **正本はこの1フォルダだけ**: `hilltop-zushi-site/`
   - ここに index.html / 404.html / 360/(index.html + JPG10枚) / images/ が全部入っている。
   - 他のworktreeのコピーや古い `guest-site.html` 版を本番に上げない。
2. **デプロイは必ず `deploy-hilltop.ps1` で行う**（生の wrangler 直打ち禁止）。
   - Cloudflare の Direct Upload は「渡したフォルダで本番を丸ごと置き換える」。
   - 不完全なフォルダを上げると、前にあった画像などが消える。
   - スクリプトが「画像10枚そろってる？JPEGとして壊れてない？」を事前チェックし、欠けてたら止める。
3. **GitHub に push しても本番は変わらない**（GitHub連携なし）。本番が変わるのは deploy した時だけ。

## やり方

PowerShell でこのフォルダを開いて:

```powershell
.\deploy-hilltop.ps1
```

これだけ。チェック通過→デプロイ→本番で全画像を自動検証、まで一気にやる。

## 困ったとき

- ビューワーが「Loading…」で固まる → 画像が消えている可能性大。
  `curl -I https://hilltop-zushi-arh.pages.dev/360/R0011162.JPG` で
  `Content-Type: image/jpeg` か確認。`text/html` なら画像未アップ → 上の手順で再デプロイ。
- プロジェクト名は `hilltop-zushi`（公開ドメインの `-arh` とは違う）。
- 本番ブランチは `main`。

## メモ
- `hilltop-zushi-legacy/` … 旧 guest-site.html を保管（本番では使っていない）。
- 360チップUIが参照する画像: R0011156〜R0011165.JPG の10枚（`360/index.html` の photos 配列）。
