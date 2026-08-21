[CmdletBinding()]
param(
  [string]$UpstreamAar = 'D:\CodexData\Caches\QingJiAI\sherpa-onnx\sherpa-onnx-1.13.2.aar',
  [string]$PythonRuntimeRoot = 'D:\CodexData\Caches\QingJiAI\sherpa-onnx-ctc-small\python-runtime',
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$lockPath = Join-Path $projectRoot 'android\app\src\internal\streaming-ctc-small-asr-lock.json'
$lock = Get-Content -LiteralPath $lockPath -Raw -Encoding UTF8 | ConvertFrom-Json
$preparedAar = Join-Path $projectRoot "android\app\src\streamingOnnxCtcSmall\libs\$($lock.runtime.name)"
$modelRoot = Join-Path $projectRoot "android\app\src\streamingOnnxCtcSmall\assets\$($lock.assetDirectory)"
$sampleRoot = Join-Path ([string]$lock.cacheRoot) 'official-samples'
$runner = Join-Path $PSScriptRoot 'asr-benchmark\verify-small-ctc-official-samples.py'
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $projectRoot 'android\app\build\reports\streaming-ctc-small-sample-equivalence.json'
}

foreach ($path in @($UpstreamAar, $preparedAar, $modelRoot, $sampleRoot, $runner, $PythonRuntimeRoot)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Required equivalence input is missing: $path" }
}

function Get-StreamSha256([IO.Stream]$Stream) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    ([BitConverter]::ToString($sha.ComputeHash($Stream))).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$upstreamZip = [IO.Compression.ZipFile]::OpenRead($UpstreamAar)
$preparedZip = [IO.Compression.ZipFile]::OpenRead($preparedAar)
$libraryEvidence = @()
try {
  foreach ($library in $lock.runtime.requiredArm64Libraries) {
    $entryPath = "jni/arm64-v8a/$library"
    $upstreamEntry = $upstreamZip.GetEntry($entryPath)
    $preparedEntry = $preparedZip.GetEntry($entryPath)
    if ($null -eq $upstreamEntry -or $null -eq $preparedEntry) {
      throw "Runtime equivalence entry is missing: $entryPath"
    }
    $upstreamStream = $upstreamEntry.Open()
    $preparedStream = $preparedEntry.Open()
    try {
      $upstreamHash = Get-StreamSha256 $upstreamStream
      $preparedHash = Get-StreamSha256 $preparedStream
    } finally {
      $upstreamStream.Dispose()
      $preparedStream.Dispose()
    }
    if ($upstreamHash -ne $preparedHash) {
      throw "Prepared runtime changed the arm64 payload: $library"
    }
    $libraryEvidence += [ordered]@{
      name = $library
      bytes = $preparedEntry.Length
      sha256 = $preparedHash
    }
  }
} finally {
  $upstreamZip.Dispose()
  $preparedZip.Dispose()
}

foreach ($sample in $lock.model.officialSampleFiles) {
  $samplePath = Join-Path $sampleRoot ([IO.Path]::GetFileName([string]$sample.path))
  if ((Get-Item -LiteralPath $samplePath).Length -ne [Int64]$sample.sizeBytes) {
    throw "Official sample size mismatch: $samplePath"
  }
  $sampleHash = (Get-FileHash -LiteralPath $samplePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sampleHash -ne [string]$sample.sha256) {
    throw "Official sample hash mismatch: $samplePath"
  }
}

$stderrPath = Join-Path ([IO.Path]::GetTempPath()) "qingji-small-ctc-python-stderr-$PID.txt"
$stdoutPath = Join-Path ([IO.Path]::GetTempPath()) "qingji-small-ctc-python-stdout-$PID.txt"
try {
  $pythonProcess = Start-Process -FilePath 'python.exe' -ArgumentList @(
    $runner,
    '--python-runtime', $PythonRuntimeRoot,
    '--model-root', $modelRoot,
    '--sample-root', $sampleRoot
  ) -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath
  if ($pythonProcess.ExitCode -ne 0) {
    $details = if (Test-Path -LiteralPath $stderrPath) {
      Get-Content -LiteralPath $stderrPath -Raw -Encoding UTF8
    } else { '' }
    throw "Official sample decoding failed: $details"
  }
  $transcriptJson = Get-Content -LiteralPath $stdoutPath -Raw -Encoding UTF8
} finally {
  if (Test-Path -LiteralPath $stderrPath) { Remove-Item -LiteralPath $stderrPath -Force }
  if (Test-Path -LiteralPath $stdoutPath) { Remove-Item -LiteralPath $stdoutPath -Force }
}
$decoded = $transcriptJson | ConvertFrom-Json
$sampleEvidence = @()
foreach ($sample in $lock.model.officialSampleFiles) {
  $name = [IO.Path]::GetFileName([string]$sample.path)
  $actual = $decoded.$name
  if ($null -eq $actual -or
      [Int64]$actual.sampleRateHz -ne [Int64]$sample.sampleRateHz -or
      [string]$actual.transcript -cne [string]$sample.expectedTranscript) {
    throw "Official transcript mismatch: $name"
  }
  $sampleEvidence += [ordered]@{
    name = $name
    sampleRateHz = [Int64]$actual.sampleRateHz
    transcript = [string]$actual.transcript
  }
}

$report = [ordered]@{
  schemaVersion = 1
  engine = 'onnx-ctc-small'
  sherpaOnnxVersion = '1.13.2'
  runtimeEquivalence = 'PASS'
  equivalenceBasis = 'byte-identical-arm64-libraries-in-upstream-and-prepared-aar'
  libraries = $libraryEvidence
  officialSamples = $sampleEvidence
  accuracyStatus = 'WAITING_FOR_AUTHORIZED_WAV'
}
$outputDirectory = Split-Path -Parent ([IO.Path]::GetFullPath($OutputPath))
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
Write-Output 'STREAMING_CTC_SMALL_SAMPLE_EQUIVALENCE=PASS'
Write-Output 'STREAMING_CTC_SMALL_ACCURACY=WAITING_FOR_AUTHORIZED_WAV'
Write-Output "STREAMING_CTC_SMALL_SAMPLE_REPORT=$([IO.Path]::GetFullPath($OutputPath))"
