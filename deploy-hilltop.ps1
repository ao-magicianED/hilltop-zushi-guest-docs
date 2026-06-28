# =====================================================================
#  Hilltop Zushi 本番デプロイスクリプト（Cloudflare Pages / Direct Upload）
# ---------------------------------------------------------------------
#  使い方:  PowerShell でこのフォルダに移動して  .\deploy-hilltop.ps1
#  これ以外の方法（生の wrangler コマンド直打ち）で本番に上げないこと。
#
#  なぜスクリプトか:
#   Direct Upload は「渡したフォルダで本番を丸ごと置き換える」仕様。
#   不完全なフォルダを上げると前にあった画像などが消える（過去2回事故）。
#   → デプロイ前に「完全なフォルダか」を機械的にチェックし、欠けてたら止める。
# =====================================================================

$ErrorActionPreference = "Stop"

# --- 設定（ここだけ案件ごとに変える） ---------------------------------
$ProjectName = "hilltop-zushi"               # ← 公開ドメインと違うので注意（dash で確認済）
$Branch      = "main"                          # 本番ブランチ
$Domain      = "hilltop-zushi-arh.pages.dev"   # 公開ドメイン
$SiteDir     = Join-Path $PSScriptRoot "hilltop-zushi-site"   # デプロイ元（正本）
# 360 パノラマで必須の画像（チップUIが参照する10枚）
$PanoFiles = @("R0011156","R0011157","R0011158","R0011159","R0011160",
               "R0011161","R0011162","R0011163","R0011164","R0011165")
$MinImages   = 50         # images/ の最低枚数
$MinJpgBytes = 200000     # 360画像1枚の最低サイズ(約0.2MB)。これ未満は壊れ/HTML混入を疑う
# ---------------------------------------------------------------------

function Fail($msg) { Write-Host "  [NG] $msg" -ForegroundColor Red; $script:ok = $false }
function Pass($msg) { Write-Host "  [OK] $msg" -ForegroundColor Green }

Write-Host "`n===== デプロイ前チェック: $SiteDir =====" -ForegroundColor Cyan
$script:ok = $true

# 1. 必須HTML
foreach ($f in @("index.html","404.html","360\index.html")) {
  $p = Join-Path $SiteDir $f
  if (Test-Path $p) { Pass "$f あり" } else { Fail "$f が無い" }
}

# 2. 360画像10枚そろっているか + サイズ + JPEGマジックバイト(FFD8)
foreach ($name in $PanoFiles) {
  $p = Join-Path $SiteDir "360\$name.JPG"
  if (-not (Test-Path $p)) { Fail "360/$name.JPG が無い"; continue }
  $len = (Get-Item $p).Length
  if ($len -lt $MinJpgBytes) { Fail "360/$name.JPG が小さすぎ($len bytes) ← 壊れ/HTML混入の疑い"; continue }
  $fs = [System.IO.File]::OpenRead($p); $b = New-Object byte[] 2
  [void]$fs.Read($b,0,2); $fs.Close()
  if ($b[0] -ne 0xFF -or $b[1] -ne 0xD8) { Fail "360/$name.JPG がJPEGでない(先頭=$($b[0].ToString('X2'))$($b[1].ToString('X2')))" }
  else { Pass "360/$name.JPG OK ($([math]::Round($len/1MB,2))MB)" }
}

# 3. images/ 枚数
$imgCount = (Get-ChildItem (Join-Path $SiteDir "images") -File -ErrorAction SilentlyContinue).Count
if ($imgCount -ge $MinImages) { Pass "images/ $imgCount 枚" } else { Fail "images/ が $imgCount 枚（$MinImages 枚以上必要）" }

if (-not $script:ok) {
  Write-Host "`n チェックに失敗しました。デプロイを中止します（本番は変更されません）。`n" -ForegroundColor Red
  exit 1
}

Write-Host "`n 全チェック通過。本番へデプロイします..." -ForegroundColor Cyan
npx wrangler pages deploy "$SiteDir" --project-name=$ProjectName --branch=$Branch --commit-dirty=true --commit-message="Deploy hilltop-zushi site"
if ($LASTEXITCODE -ne 0) { Write-Host "`n wrangler デプロイが失敗しました。" -ForegroundColor Red; exit 1 }

# 4. デプロイ後、本番ドメインで全360画像を検証
Write-Host "`n===== デプロイ後の本番検証: https://$Domain/360/ =====" -ForegroundColor Cyan
$verifyOk = $true
foreach ($name in $PanoFiles) {
  try {
    $r = Invoke-WebRequest -Uri "https://$Domain/360/$name.JPG" -Method Head -UseBasicParsing
    $ct = [string]$r.Headers['Content-Type']
    if ($ct -like "image/*") { Write-Host "  [OK] $name.JPG -> $ct" -ForegroundColor Green }
    else { Write-Host "  [NG] $name.JPG -> $ct（image/* でない＝未反映）" -ForegroundColor Red; $verifyOk = $false }
  } catch { Write-Host "  [NG] $name.JPG 取得失敗: $_" -ForegroundColor Red; $verifyOk = $false }
}

if ($verifyOk) { Write-Host "`n 完了: 全画像が image/* で配信されています。`n" -ForegroundColor Green }
else { Write-Host "`n 注意: 一部画像が未反映。エッジキャッシュの場合は数分後に再確認、または ?v=2 で確認。`n" -ForegroundColor Yellow }
