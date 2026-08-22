[CmdletBinding()]
param(
  [string]$BaselineApk,
  [string]$CandidateApk,
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$lockPath = Join-Path $projectRoot 'android\app\src\internal\streaming-ctc-small-asr-lock.json'
$lock = Get-Content -LiteralPath $lockPath -Raw -Encoding UTF8 | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $projectRoot 'android\app\build\reports\streaming-ctc-small-artifact-budget.json'
}
if ([string]::IsNullOrWhiteSpace($BaselineApk)) {
  $BaselineApk = Join-Path $projectRoot 'android\app\build\outputs\asr-comparison\app-internal-ordinary.apk'
}
if ([string]::IsNullOrWhiteSpace($CandidateApk)) {
  $CandidateApk = Join-Path $projectRoot 'android\app\build\outputs\asr-comparison\app-internal-ctc-small.apk'
}

function Resolve-ExistingFile([string]$Path) {
  $resolved = if ([IO.Path]::IsPathRooted($Path)) {
    [IO.Path]::GetFullPath($Path)
  } else {
    [IO.Path]::GetFullPath((Join-Path $projectRoot $Path))
  }
  if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
    throw "APK is missing: $resolved"
  }
  $resolved
}

function Get-Sha256([string]$Path) {
  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

$BaselineApk = Resolve-ExistingFile $BaselineApk
$CandidateApk = Resolve-ExistingFile $CandidateApk
$baselineBytes = (Get-Item -LiteralPath $BaselineApk).Length
$candidateBytes = (Get-Item -LiteralPath $CandidateApk).Length
$deltaBytes = $candidateBytes - $baselineBytes

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($CandidateApk)
try {
  $payloadEntries = @()
  $nativeCompressedBytes = [Int64]0
  $nativeUncompressedBytes = [Int64]0
  foreach ($entry in $archive.Entries) {
    if ($entry.FullName.StartsWith('lib/')) {
      $nativeCompressedBytes += [Int64]$entry.CompressedLength
      $nativeUncompressedBytes += [Int64]$entry.Length
    }
  }
  foreach ($spec in $lock.model.requiredFiles) {
    $name = "assets/$($lock.assetDirectory)/$($spec.name)"
    $entry = $archive.GetEntry($name)
    if ($null -eq $entry) { throw "Candidate APK is missing $name" }
    $payloadEntries += [ordered]@{
      name = $name
      kind = 'model'
      uncompressedBytes = $entry.Length
      compressedBytes = $entry.CompressedLength
    }
  }
  foreach ($name in $lock.runtime.requiredArm64Libraries) {
    $entryName = "lib/arm64-v8a/$name"
    $entry = $archive.GetEntry($entryName)
    if ($null -eq $entry) { throw "Candidate APK is missing $entryName" }
    $payloadEntries += [ordered]@{
      name = $entryName
      kind = 'runtime'
      uncompressedBytes = $entry.Length
      compressedBytes = $entry.CompressedLength
    }
  }
} finally {
  $archive.Dispose()
}

$report = [ordered]@{
  schemaVersion = 1
  engine = 'onnx-ctc-small'
  accuracyStatus = 'WAITING_FOR_AUTHORIZED_WAV'
  baseline = [ordered]@{
    path = $BaselineApk
    bytes = $baselineBytes
    sha256 = Get-Sha256 $BaselineApk
  }
  candidate = [ordered]@{
    path = $CandidateApk
    bytes = $candidateBytes
    sha256 = Get-Sha256 $CandidateApk
  }
  deltaBytes = $deltaBytes
  budgets = [ordered]@{
    targetDeltaBytes = [Int64]$lock.budgets.targetAsrApkDeltaBytes
    maximumDeltaBytes = [Int64]$lock.budgets.maximumAsrApkDeltaBytes
    maximumCandidateApkBytes = [Int64]$lock.budgets.maximumCandidateApkBytes
  }
  payloadEntries = $payloadEntries
  payloadCompressedBytes = [Int64](
    ($payloadEntries | ForEach-Object { [Int64]$_['compressedBytes'] } | Measure-Object -Sum).Sum
  )
  payloadUncompressedBytes = [Int64](
    ($payloadEntries | ForEach-Object { [Int64]$_['uncompressedBytes'] } | Measure-Object -Sum).Sum
  )
  candidateNativeCompressedBytes = $nativeCompressedBytes
  candidateNativeUncompressedBytes = $nativeUncompressedBytes
  estimatedInstalledFootprintBytes = $candidateBytes + $nativeUncompressedBytes
  installedFootprintNote = 'Static estimate: APK plus extracted native libraries; excludes ART output and user data.'
  gates = [ordered]@{
    targetDelta = $deltaBytes -le [Int64]$lock.budgets.targetAsrApkDeltaBytes
    maximumDelta = $deltaBytes -le [Int64]$lock.budgets.maximumAsrApkDeltaBytes
    maximumCandidateApk = $candidateBytes -le [Int64]$lock.budgets.maximumCandidateApkBytes
  }
}

$outputDirectory = Split-Path -Parent ([IO.Path]::GetFullPath($OutputPath))
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding UTF8

Write-Output "ASR_BASELINE_BYTES=$baselineBytes"
Write-Output "ASR_CANDIDATE_BYTES=$candidateBytes"
Write-Output "ASR_DELTA_BYTES=$deltaBytes"
Write-Output "ASR_TARGET_DELTA=$($report.gates.targetDelta)"
Write-Output "ASR_MAXIMUM_DELTA=$($report.gates.maximumDelta)"
Write-Output "ASR_MAXIMUM_APK=$($report.gates.maximumCandidateApk)"
Write-Output "ASR_BUDGET_REPORT=$([IO.Path]::GetFullPath($OutputPath))"

if (-not $report.gates.maximumDelta -or -not $report.gates.maximumCandidateApk) {
  throw 'Small CTC APK exceeds a hard artifact budget.'
}
