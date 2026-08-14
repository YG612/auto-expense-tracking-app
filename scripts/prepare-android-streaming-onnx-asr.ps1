param([switch]$VerifyOnly)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$lockPath = Join-Path $projectRoot 'android\app\src\internal\streaming-onnx-asr-lock.json'
$lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
$cacheRoot = $lock.cacheRoot
$runtimeSource = Join-Path $cacheRoot $lock.runtime.name
$archiveSource = Join-Path $cacheRoot ([IO.Path]::GetFileName([Uri]$lock.model.url))
$runtimeTarget = Join-Path $projectRoot "android\app\src\streamingOnnx\libs\$($lock.runtime.name)"
$assetsRoot = Join-Path $projectRoot "android\app\src\streamingOnnx\assets\$($lock.assetDirectory)"

function Assert-LockedFile([string]$Path, [long]$Size, [string]$Hash) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing locked file: $Path" }
  $item = Get-Item -LiteralPath $Path
  $actualHash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($item.Length -ne $Size -or $actualHash -ne $Hash) { throw "Locked file mismatch: $Path" }
}

Assert-LockedFile $runtimeSource $lock.runtime.sizeBytes $lock.runtime.sha256
Assert-LockedFile $archiveSource $lock.model.archiveSizeBytes $lock.model.archiveSha256
if (-not $VerifyOnly) {
  New-Item -ItemType Directory -Force -Path (Split-Path $runtimeTarget), $assetsRoot | Out-Null
  Copy-Item -LiteralPath $runtimeSource -Destination $runtimeTarget -Force
  $extractRoot = Join-Path $env:TEMP "qingji-sherpa-onnx-$PID"
  New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
  try {
    tar -xjf $archiveSource -C $extractRoot
    $modelRoot = Join-Path $extractRoot $lock.model.id
    foreach ($name in $lock.model.requiredFiles) {
      Copy-Item -LiteralPath (Join-Path $modelRoot $name) -Destination (Join-Path $assetsRoot $name) -Force
    }
  } finally {
    Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  [ordered]@{ schemaVersion = 1; engine = 'onnx'; runtimeSha256 = $lock.runtime.sha256; modelArchiveSha256 = $lock.model.archiveSha256 } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $assetsRoot 'prepared-assets.json') -Encoding utf8
}
Assert-LockedFile $runtimeTarget $lock.runtime.sizeBytes $lock.runtime.sha256
foreach ($name in $lock.model.requiredFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $assetsRoot $name) -PathType Leaf)) { throw "Missing prepared model file: $name" }
}
Write-Host 'sherpa-onnx streaming ASR assets verified.'
