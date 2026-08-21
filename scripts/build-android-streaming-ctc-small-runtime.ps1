[CmdletBinding()]
param(
  [switch]$VerifyOnly,
  [string]$UpstreamAarPath,
  [string]$OutputAarPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$lockPath = Join-Path $projectRoot 'android\app\src\internal\streaming-ctc-small-asr-lock.json'
$lock = Get-Content -LiteralPath $lockPath -Raw -Encoding UTF8 | ConvertFrom-Json

if ($lock.schemaVersion -ne 1 -or $lock.engine -ne 'onnx-ctc-small') {
  throw 'Unsupported streaming CTC runtime lock.'
}

if ([string]::IsNullOrWhiteSpace($UpstreamAarPath)) {
  $UpstreamAarPath = Join-Path 'D:\CodexData\Caches\QingJiAI\sherpa-onnx' $lock.runtime.upstream.name
}
if ([string]::IsNullOrWhiteSpace($OutputAarPath)) {
  $OutputAarPath = Join-Path (Join-Path $lock.cacheRoot 'artifacts') $lock.runtime.name
}

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
  $actualSize = (Get-Item -LiteralPath $Path).Length
  $actualHash = Get-Sha256 $Path
  if ($actualSize -ne $ExpectedSize -or $actualHash -ne $ExpectedHash) {
    throw "Locked file mismatch: $Path"
  }
}

function Assert-Arm64Aar([string]$Path, [bool]$CheckLockedOutput) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Runtime AAR is missing: $Path"
  }
  if ($CheckLockedOutput) {
    if ($lock.runtime.status -ne 'prepared' -or
        [Int64]$lock.runtime.sizeBytes -le 0 -or
        [string]::IsNullOrWhiteSpace([string]$lock.runtime.sha256)) {
      throw 'Runtime lock is not prepared.'
    }
    Assert-FileSpec $Path ([Int64]$lock.runtime.sizeBytes) ([string]$lock.runtime.sha256)
  }
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($Path)
  $verificationRoot = Join-Path $lock.cacheRoot "runtime-verify-$PID"
  try {
    $entries = @($archive.Entries | ForEach-Object FullName)
    if ($entries -notcontains 'classes.jar') {
      throw 'Runtime AAR is missing classes.jar.'
    }
    foreach ($name in $lock.runtime.requiredArm64Libraries) {
      if ($entries -notcontains "jni/arm64-v8a/$name") {
        throw "Runtime AAR is missing arm64 library: $name"
      }
    }
    foreach ($prefix in $lock.runtime.forbiddenAbiPrefixes) {
      if ($entries | Where-Object { $_.StartsWith([string]$prefix) }) {
        throw "Runtime AAR contains forbidden ABI: $prefix"
      }
    }
    $sdkRoots = @(
      $env:ANDROID_SDK_ROOT,
      $env:ANDROID_HOME,
      'D:\Android_SDK',
      'D:\CodexData\Android\Sdk'
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath $_) }
    $readelf = $null
    foreach ($sdkRoot in $sdkRoots) {
      $ndkRoot = Join-Path $sdkRoot 'ndk'
      if (-not (Test-Path -LiteralPath $ndkRoot -PathType Container)) { continue }
      $candidate = Get-ChildItem -LiteralPath $ndkRoot -Directory |
        Sort-Object Name -Descending |
        ForEach-Object {
          Join-Path $_.FullName 'toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-readelf.exe'
        } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1
      if ($null -ne $candidate) { $readelf = $candidate; break }
    }
    if ($null -eq $readelf) {
      throw 'llvm-readelf.exe is required to verify 16 KiB ELF alignment.'
    }
    New-Item -ItemType Directory -Force -Path $verificationRoot | Out-Null
    foreach ($name in $lock.runtime.requiredArm64Libraries) {
      $entry = $archive.GetEntry("jni/arm64-v8a/$name")
      $destination = Join-Path $verificationRoot $name
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
      $programHeaders = @(& $readelf -lW $destination)
      if ($LASTEXITCODE -ne 0) {
        throw "Unable to inspect ELF alignment: $name"
      }
      $alignments = @($programHeaders | Where-Object { $_ -match '^\s*LOAD\s+' } | ForEach-Object {
        $columns = ($_ -split '\s+') | Where-Object { $_ }
        [Convert]::ToInt64($columns[-1].Substring(2), 16)
      })
      if ($alignments.Count -eq 0 -or ($alignments | Measure-Object -Minimum).Minimum -lt 16384) {
        throw "$name does not satisfy 16 KiB ELF alignment."
      }
    }
  } finally {
    $archive.Dispose()
    if (Test-Path -LiteralPath $verificationRoot) {
      Remove-Item -LiteralPath $verificationRoot -Recurse -Force
    }
  }
}

if ($VerifyOnly) {
  Assert-Arm64Aar $OutputAarPath $true
  Write-Output 'STREAMING_CTC_SMALL_RUNTIME=VERIFIED'
  exit 0
}

Assert-FileSpec `
  $UpstreamAarPath `
  ([Int64]$lock.runtime.upstream.sizeBytes) `
  ([string]$lock.runtime.upstream.sha256)

$outputDirectory = Split-Path -Parent $OutputAarPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$temporaryAar = "$OutputAarPath.tmp"
if (Test-Path -LiteralPath $temporaryAar) {
  Remove-Item -LiteralPath $temporaryAar -Force
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$source = [IO.Compression.ZipFile]::OpenRead($UpstreamAarPath)
$targetStream = [IO.File]::Open(
  $temporaryAar,
  [IO.FileMode]::CreateNew,
  [IO.FileAccess]::ReadWrite,
  [IO.FileShare]::None
)
$target = [IO.Compression.ZipArchive]::new(
  $targetStream,
  [IO.Compression.ZipArchiveMode]::Create,
  $true
)
$fixedTimestamp = [DateTimeOffset]::new(2025, 4, 1, 0, 0, 0, [TimeSpan]::Zero)
try {
  $selected = @($source.Entries | Where-Object {
    -not $_.FullName.StartsWith('jni/') -or
    $_.FullName.StartsWith('jni/arm64-v8a/') -or
    $_.FullName -eq 'jni/'
  } | Sort-Object FullName)
  foreach ($entry in $selected) {
    $created = $target.CreateEntry(
      $entry.FullName,
      [IO.Compression.CompressionLevel]::Optimal
    )
    $created.LastWriteTime = $fixedTimestamp
    if ($entry.FullName.EndsWith('/')) {
      continue
    }
    $input = $entry.Open()
    $output = $created.Open()
    try {
      $input.CopyTo($output)
    } finally {
      $output.Dispose()
      $input.Dispose()
    }
  }
} finally {
  $target.Dispose()
  $targetStream.Dispose()
  $source.Dispose()
}

Assert-Arm64Aar $temporaryAar $false
Move-Item -LiteralPath $temporaryAar -Destination $OutputAarPath -Force

$output = Get-Item -LiteralPath $OutputAarPath
Write-Output "RUNTIME_PATH=$($output.FullName)"
Write-Output "RUNTIME_SIZE=$($output.Length)"
Write-Output "RUNTIME_SHA256=$(Get-Sha256 $OutputAarPath)"
Write-Output 'RUNTIME_DERIVATION=DETERMINISTIC_ARM64_PRUNE'
