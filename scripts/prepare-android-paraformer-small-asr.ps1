[CmdletBinding()]
param(
  [switch]$VerifyOnly,
  [string]$ModelArchivePath,
  [string]$RuntimeArtifactPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$lockPath = Join-Path $projectRoot 'android\app\src\internal\streaming-paraformer-small-asr-lock.json'
$lock = Get-Content -LiteralPath $lockPath -Raw -Encoding UTF8 | ConvertFrom-Json
$assetDir = Join-Path $projectRoot "android\app\src\streamingOnnxParaformerSmall\assets\$($lock.assetDirectory)"
$runtimeDir = Join-Path $projectRoot 'android\app\src\streamingOnnxParaformerSmall\libs'
$runtimeDestination = Join-Path $runtimeDir $lock.runtime.name
$manifestPath = Join-Path $assetDir 'prepared-assets.json'
$runtimeLicenseDestination = Join-Path $assetDir $lock.licenses.runtime.fileName
$modelNoticeSource = Join-Path $projectRoot $lock.licenses.model.noticeSource
$modelNoticeDestination = Join-Path $assetDir $lock.licenses.model.noticeName
$sbomDestination = Join-Path $assetDir 'paraformer-small-sbom.json'
$sampleDir = Join-Path $lock.cacheRoot 'official-samples'

if ($lock.schemaVersion -ne 1 -or $lock.engine -ne 'onnx-paraformer-small' -or
    $lock.accuracyStatus -ne 'WAITING_FOR_AUTHORIZED_WAV' -or
    -not $lock.licenses.model.distributionReviewRequired) {
  throw 'Unsupported or unsafe Paraformer lock.'
}
if ([string]::IsNullOrWhiteSpace($ModelArchivePath)) {
  $ModelArchivePath = Join-Path $lock.cacheRoot $lock.model.archiveName
}
if ([string]::IsNullOrWhiteSpace($RuntimeArtifactPath)) {
  $RuntimeArtifactPath = Join-Path (Join-Path $lock.cacheRoot 'artifacts') $lock.runtime.name
}
$runtimeLicenseSource = Join-Path $lock.cacheRoot $lock.licenses.runtime.fileName

function Get-Sha256([string]$Path) {
  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-FileSpec(
  [string]$Path,
  [Int64]$ExpectedSize,
  [string]$ExpectedHash
) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Required file is missing: $Path"
  }
  if ((Get-Item -LiteralPath $Path).Length -ne $ExpectedSize -or
      (Get-Sha256 $Path) -ne $ExpectedHash) {
    throw "Locked file mismatch: $Path"
  }
}

function Assert-PreparedAssets {
  Assert-FileSpec $runtimeDestination ([Int64]$lock.runtime.sizeBytes) ([string]$lock.runtime.sha256)
  foreach ($fileSpec in $lock.model.requiredFiles) {
    Assert-FileSpec `
      (Join-Path $assetDir $fileSpec.name) `
      ([Int64]$fileSpec.sizeBytes) `
      ([string]$fileSpec.sha256)
  }
  Assert-FileSpec `
    $runtimeLicenseDestination `
    ([Int64]$lock.licenses.runtime.sizeBytes) `
    ([string]$lock.licenses.runtime.sha256)
  Assert-FileSpec `
    $modelNoticeDestination `
    ([Int64]$lock.licenses.model.noticeSizeBytes) `
    ([string]$lock.licenses.model.noticeSha256)
  foreach ($sampleSpec in $lock.model.officialSampleFiles) {
    Assert-FileSpec `
      (Join-Path $sampleDir ([IO.Path]::GetFileName([string]$sampleSpec.path))) `
      ([Int64]$sampleSpec.sizeBytes) `
      ([string]$sampleSpec.sha256)
  }
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf) -or
      -not (Test-Path -LiteralPath $sbomDestination -PathType Leaf)) {
    throw 'Prepared Paraformer provenance or SBOM is missing.'
  }
  $prepared = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($prepared.schemaVersion -ne 1 -or
      $prepared.lockSha256 -ne (Get-Sha256 $lockPath) -or
      $prepared.accuracyStatus -ne 'WAITING_FOR_AUTHORIZED_WAV' -or
      $prepared.modelLicenseStatus -ne $lock.licenses.model.status) {
    throw 'Prepared Paraformer assets do not match the current lock.'
  }
}

if ($VerifyOnly) {
  Assert-PreparedAssets
  Write-Output 'PARAFORMER_SMALL_SUPPLY_CHAIN=VERIFIED'
  exit 0
}

Assert-FileSpec `
  $ModelArchivePath `
  ([Int64]$lock.model.archiveSizeBytes) `
  ([string]$lock.model.archiveSha256)
Assert-FileSpec `
  $RuntimeArtifactPath `
  ([Int64]$lock.runtime.sizeBytes) `
  ([string]$lock.runtime.sha256)
Assert-FileSpec `
  $runtimeLicenseSource `
  ([Int64]$lock.licenses.runtime.sizeBytes) `
  ([string]$lock.licenses.runtime.sha256)
Assert-FileSpec `
  $modelNoticeSource `
  ([Int64]$lock.licenses.model.noticeSizeBytes) `
  ([string]$lock.licenses.model.noticeSha256)

$stagingRoot = [IO.Path]::GetFullPath((Join-Path $lock.cacheRoot 'staging'))
$staging = [IO.Path]::GetFullPath((Join-Path $stagingRoot ([Guid]::NewGuid().ToString('N'))))
if (-not $staging.StartsWith("$($stagingRoot.TrimEnd('\'))\", [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Unsafe Paraformer staging path.'
}
New-Item -ItemType Directory -Force -Path $staging | Out-Null
try {
  tar.exe -xjf $ModelArchivePath -C $staging
  if ($LASTEXITCODE -ne 0) {
    throw 'Unable to extract the locked Paraformer model archive.'
  }
  $modelRoot = Join-Path $staging $lock.model.id
  if (-not (Test-Path -LiteralPath $modelRoot -PathType Container)) {
    throw 'The model archive root does not match the locked model ID.'
  }

  New-Item -ItemType Directory -Force -Path $assetDir, $runtimeDir, $sampleDir | Out-Null
  foreach ($fileSpec in $lock.model.requiredFiles) {
    $source = Join-Path $modelRoot $fileSpec.name
    Assert-FileSpec $source ([Int64]$fileSpec.sizeBytes) ([string]$fileSpec.sha256)
    Copy-Item -LiteralPath $source -Destination (Join-Path $assetDir $fileSpec.name) -Force
  }
  foreach ($sampleSpec in $lock.model.officialSampleFiles) {
    $source = Join-Path $modelRoot ([string]$sampleSpec.path)
    Assert-FileSpec $source ([Int64]$sampleSpec.sizeBytes) ([string]$sampleSpec.sha256)
    Copy-Item `
      -LiteralPath $source `
      -Destination (Join-Path $sampleDir ([IO.Path]::GetFileName([string]$sampleSpec.path))) `
      -Force
  }
  Copy-Item -LiteralPath $RuntimeArtifactPath -Destination $runtimeDestination -Force
  Copy-Item -LiteralPath $runtimeLicenseSource -Destination $runtimeLicenseDestination -Force
  Copy-Item -LiteralPath $modelNoticeSource -Destination $modelNoticeDestination -Force

  $sbom = [ordered]@{
    schemaVersion = 1
    track = [string]$lock.track
    distributionReviewRequired = $true
    components = @(
      [ordered]@{
        name = 'sherpa-onnx'
        version = '1.13.2'
        license = 'Apache-2.0'
        runtimeSha256 = [string]$lock.runtime.sha256
      },
      [ordered]@{
        name = [string]$lock.model.id
        version = '2024-03-09'
        licenseStatus = [string]$lock.licenses.model.status
        originalModelLicense = [string]$lock.licenses.model.originalModelLicense
        originalModelUrl = [string]$lock.licenses.model.originalModelUrl
        exportModelUrl = [string]$lock.licenses.model.exportModelUrl
        archiveSha256 = [string]$lock.model.archiveSha256
      }
    )
  }
  $sbom | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $sbomDestination -Encoding UTF8

  $prepared = [ordered]@{
    schemaVersion = 1
    engine = 'onnx-paraformer-small'
    engineType = [string]$lock.model.engineType
    lockSha256 = Get-Sha256 $lockPath
    runtimeSha256 = [string]$lock.runtime.sha256
    modelArchiveSha256 = [string]$lock.model.archiveSha256
    modelLicenseStatus = [string]$lock.licenses.model.status
    accuracyStatus = 'WAITING_FOR_AUTHORIZED_WAV'
  }
  $prepared | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding UTF8
} finally {
  if (Test-Path -LiteralPath $staging) {
    $resolvedStaging = [IO.Path]::GetFullPath($staging)
    if (-not $resolvedStaging.StartsWith("$($stagingRoot.TrimEnd('\'))\", [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Refusing to remove an unsafe Paraformer staging path.'
    }
    Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
  }
}

Assert-PreparedAssets
Write-Output 'PARAFORMER_SMALL_PREPARE=COMPLETE'
