[CmdletBinding()]
param(
  [switch]$VerifyOnly,
  [string]$ModelArchivePath,
  [string]$RuntimeArtifactPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$lockPath = Join-Path $projectRoot 'android\app\src\internal\streaming-asr-lock.json'
$assetDir = Join-Path $projectRoot 'android\app\src\streamingAsr\assets\speech\zipformer-zh-14m'
$runtimeDir = Join-Path $projectRoot 'android\app\src\streamingAsr\libs'
$manifestPath = Join-Path $assetDir 'prepared-assets.json'
$licenseSource = Join-Path $projectRoot 'scripts\streaming-asr\SHERPA_NCNN_APACHE-2.0.txt'
$licenseDestination = Join-Path $assetDir 'SHERPA_NCNN_APACHE-2.0.txt'
$ncnnLicenseDestination = Join-Path $assetDir 'ncnn-LICENSE.txt'
$sbomDestination = Join-Path $assetDir 'streaming-asr-sbom.json'

if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) {
  throw "Streaming ASR lock is missing: $lockPath"
}
$lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
if ($lock.schemaVersion -ne 1 -or $lock.gradleProperty -ne 'streamingAsr') {
  throw 'Unsupported or invalid streaming-asr-lock.json.'
}

$cacheRoot = $lock.cacheRoot
if ([string]::IsNullOrWhiteSpace($ModelArchivePath)) {
  $ModelArchivePath = Join-Path (Join-Path $cacheRoot 'archives') $lock.model.archiveName
}
if ([string]::IsNullOrWhiteSpace($RuntimeArtifactPath)) {
  $RuntimeArtifactPath = Join-Path (Join-Path $cacheRoot 'artifacts') $lock.runtime.name
}
$runtimeDestination = Join-Path $runtimeDir $lock.runtime.name

function Get-Sha256([string]$Path) {
  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-FileSpec([string]$Path, [Int64]$ExpectedSize, [string]$ExpectedHash) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Required file is missing: $Path"
  }
  if ((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw "Reparse points are forbidden in the streaming ASR supply chain: $Path"
  }
  $actualSize = (Get-Item -LiteralPath $Path).Length
  if ($actualSize -ne $ExpectedSize) {
    throw "Size mismatch for $Path (expected $ExpectedSize, actual $actualSize)."
  }
  $actualHash = Get-Sha256 $Path
  if ($actualHash -ne $ExpectedHash) {
    throw "SHA-256 mismatch for $Path (expected $ExpectedHash, actual $actualHash)."
  }
}

function Assert-RuntimeLockPrepared {
  if ($lock.runtime.status -ne 'prepared' -or
      $lock.runtime.sizeBytes -le 0 -or
      [string]::IsNullOrWhiteSpace($lock.runtime.sha256)) {
    throw @"
Streaming runtime is intentionally fail-closed: the lock is SOURCE_FROZEN_RUNTIME_UNPREPARED.
Build and audit the arm64 AAR from the pinned sherpa-ncnn source, then record its exact size,
SHA-256, classes.jar/native-library hashes and set runtime.status to prepared.
"@
  }
  foreach ($nativeSpec in $lock.runtime.nativeLibraries) {
    if ([Int64]$nativeSpec.sizeBytes -le 0 -or
        [string]::IsNullOrWhiteSpace([string]$nativeSpec.sourceSha256) -or
        [Int64]$nativeSpec.packagedSizeBytes -le 0 -or
        [string]::IsNullOrWhiteSpace([string]$nativeSpec.packagedSha256)) {
      throw "Streaming runtime native lock is incomplete: $($nativeSpec.name)"
    }
  }
}

function Assert-Aar([string]$Path) {
  Assert-FileSpec $Path ([Int64]$lock.runtime.sizeBytes) ([string]$lock.runtime.sha256)
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($Path)
  try {
    $entries = @($archive.Entries | ForEach-Object FullName)
    foreach ($required in $lock.runtime.requiredAarEntries) {
      if ($entries -notcontains [string]$required) {
        throw "Runtime AAR is missing required entry: $required"
      }
    }
    foreach ($prefix in $lock.runtime.forbiddenAarEntryPrefixes) {
      if ($entries | Where-Object { $_.StartsWith([string]$prefix) }) {
        throw "Runtime AAR contains forbidden ABI prefix: $prefix"
      }
    }
    $manifestSpec = $lock.runtime.manifest
    $manifestEntry = $archive.GetEntry([string]$manifestSpec.entry)
    if ($null -eq $manifestEntry) {
      throw "Runtime AAR manifest is missing: $($manifestSpec.entry)"
    }
    $manifestStream = $manifestEntry.Open()
    try {
      $manifestReader = [IO.StreamReader]::new($manifestStream, [Text.Encoding]::UTF8, $true)
      try { $manifestText = $manifestReader.ReadToEnd() }
      finally { $manifestReader.Dispose() }
    } finally {
      $manifestStream.Dispose()
    }
    $manifestXml = [Xml.XmlDocument]::new()
    try { $manifestXml.LoadXml($manifestText) }
    catch { throw "Runtime AAR manifest is not valid XML: $($_.Exception.Message)" }
    $namespace = [Xml.XmlNamespaceManager]::new($manifestXml.NameTable)
    $androidNamespace = 'http://schemas.android.com/apk/res/android'
    $namespace.AddNamespace('android', $androidNamespace)
    $usesSdk = $manifestXml.SelectSingleNode('/manifest/uses-sdk', $namespace)
    if ($null -eq $usesSdk -or
        $usesSdk.GetAttribute('minSdkVersion', $androidNamespace) -ne [string]$manifestSpec.minSdk -or
        $usesSdk.GetAttribute('targetSdkVersion', $androidNamespace) -ne [string]$manifestSpec.targetSdk) {
      throw "Runtime AAR manifest must declare minSdk=$($manifestSpec.minSdk) and targetSdk=$($manifestSpec.targetSdk)."
    }
    $entryHash = @{}
    foreach ($noticeSpec in $lock.runtime.embeddedNotices) {
      $entry = $archive.GetEntry([string]$noticeSpec.entry)
      if ($null -eq $entry -or $entry.Length -ne [Int64]$noticeSpec.sizeBytes) {
        throw "Runtime AAR notice is missing or has wrong size: $($noticeSpec.entry)"
      }
      $sha = [Security.Cryptography.SHA256]::Create()
      try {
        $stream = $entry.Open()
        try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
        finally { $stream.Dispose() }
      } finally { $sha.Dispose() }
      if ($hash -ne [string]$noticeSpec.sha256) { throw "Runtime AAR notice hash mismatch: $($noticeSpec.entry)" }
      $entryHash[[string]$noticeSpec.entry] = $hash
    }
    $sbomEntry = $archive.GetEntry([string]$lock.runtime.sbom.entry)
    if ($null -eq $sbomEntry -or $sbomEntry.Length -ne [Int64]$lock.runtime.sbom.sizeBytes) {
      throw 'Runtime AAR SBOM is missing or has wrong size.'
    }
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
      $stream = $sbomEntry.Open()
      try { $sbomHash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
      finally { $stream.Dispose() }
    } finally { $sha.Dispose() }
    if ($sbomHash -ne [string]$lock.runtime.sbom.sha256) { throw 'Runtime AAR SBOM hash mismatch.' }
  } finally {
    $archive.Dispose()
  }
}

if ($VerifyOnly) {
  Assert-RuntimeLockPrepared
  Assert-Aar $runtimeDestination
  foreach ($fileSpec in $lock.model.requiredFiles) {
    Assert-FileSpec (Join-Path $assetDir $fileSpec.name) ([Int64]$fileSpec.sizeBytes) ([string]$fileSpec.sha256)
  }
  Assert-FileSpec $licenseDestination ([Int64]$lock.runtime.licenseSizeBytes) ([string]$lock.runtime.licenseSha256)
  $ncnnNotice = $lock.runtime.embeddedNotices | Where-Object { $_.entry -eq 'META-INF/licenses/ncnn-LICENSE.txt' }
  Assert-FileSpec $ncnnLicenseDestination ([Int64]$ncnnNotice.sizeBytes) ([string]$ncnnNotice.sha256)
  Assert-FileSpec $sbomDestination ([Int64]$lock.runtime.sbom.sizeBytes) ([string]$lock.runtime.sbom.sha256)
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Prepared manifest is missing: $manifestPath"
  }
  $prepared = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $lockHash = Get-Sha256 $lockPath
  if ($prepared.schemaVersion -ne 1 -or $prepared.lockSha256 -ne $lockHash) {
    throw 'Prepared streaming ASR manifest does not match the current lock.'
  }
  Write-Output 'STREAMING_ASR_SUPPLY_CHAIN=VERIFIED'
  exit 0
}

Assert-FileSpec $ModelArchivePath ([Int64]$lock.model.archiveSizeBytes) ([string]$lock.model.archiveSha256)
Assert-FileSpec $licenseSource ([Int64]$lock.runtime.licenseSizeBytes) ([string]$lock.runtime.licenseSha256)
Assert-RuntimeLockPrepared
Assert-Aar $RuntimeArtifactPath

$tar = Get-Command tar.exe -ErrorAction Stop
$entries = @(& $tar.Source -tf $ModelArchivePath)
if ($LASTEXITCODE -ne 0 -or $entries.Count -eq 0) {
  throw 'Unable to enumerate the model archive.'
}
$unsafe = @($entries | Where-Object {
  $_ -match '(^|/)\.\.(/|$)' -or $_ -match '^[A-Za-z]:' -or $_.StartsWith('/') -or $_.StartsWith('\')
})
if ($unsafe.Count -gt 0) {
  throw "Unsafe model archive entries: $($unsafe -join ', ')"
}
$verboseEntries = @(& $tar.Source -tvf $ModelArchivePath)
if ($LASTEXITCODE -ne 0 -or $verboseEntries.Count -eq 0) {
  throw 'Unable to inspect model archive entry types.'
}
$specialEntries = @($verboseEntries | Where-Object {
  -not ([string]$_).StartsWith('-') -and -not ([string]$_).StartsWith('d')
})
if ($specialEntries.Count -gt 0) {
  throw "Links and special files are forbidden in the model archive: $($specialEntries -join '; ')"
}

$stagingRoot = Join-Path $cacheRoot 'staging'
$staging = Join-Path $stagingRoot ([Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $staging | Out-Null
try {
  & $tar.Source -xf $ModelArchivePath -C $staging
  if ($LASTEXITCODE -ne 0) {
    throw 'Unable to extract the model archive.'
  }
  $stagingFull = [IO.Path]::GetFullPath($staging).TrimEnd('\') + '\'
  $reparseEntries = @(Get-ChildItem -LiteralPath $staging -Recurse -Force | Where-Object {
    $_.Attributes -band [IO.FileAttributes]::ReparsePoint
  })
  if ($reparseEntries.Count -gt 0) {
    throw "Extracted model contains reparse points: $($reparseEntries.FullName -join ', ')"
  }
  $resolved = @{}
  foreach ($fileSpec in $lock.model.requiredFiles) {
    $matches = @(Get-ChildItem -LiteralPath $staging -Recurse -File | Where-Object { $_.Name -eq $fileSpec.name })
    if ($matches.Count -ne 1) {
      throw "Expected exactly one archive member named $($fileSpec.name); found $($matches.Count)."
    }
    $resolvedPath = [IO.Path]::GetFullPath($matches[0].FullName)
    if (-not $resolvedPath.StartsWith($stagingFull, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Extracted model path escaped staging: $resolvedPath"
    }
    Assert-FileSpec $matches[0].FullName ([Int64]$fileSpec.sizeBytes) ([string]$fileSpec.sha256)
    $resolved[$fileSpec.name] = $matches[0].FullName
  }

  New-Item -ItemType Directory -Force -Path $assetDir,$runtimeDir | Out-Null
  foreach ($fileSpec in $lock.model.requiredFiles) {
    Copy-Item -LiteralPath $resolved[$fileSpec.name] -Destination (Join-Path $assetDir $fileSpec.name) -Force
  }
  Copy-Item -LiteralPath $RuntimeArtifactPath -Destination $runtimeDestination -Force
  Copy-Item -LiteralPath $licenseSource -Destination $licenseDestination -Force
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $runtimeArchive = [IO.Compression.ZipFile]::OpenRead($RuntimeArtifactPath)
  try {
    $ncnnEntry = $runtimeArchive.GetEntry('META-INF/licenses/ncnn-LICENSE.txt')
    $sbomEntry = $runtimeArchive.GetEntry([string]$lock.runtime.sbom.entry)
    [IO.Compression.ZipFileExtensions]::ExtractToFile($ncnnEntry, $ncnnLicenseDestination, $true)
    [IO.Compression.ZipFileExtensions]::ExtractToFile($sbomEntry, $sbomDestination, $true)
  } finally {
    $runtimeArchive.Dispose()
  }

  $prepared = [ordered]@{
    schemaVersion = 1
    lockSha256 = Get-Sha256 $lockPath
    modelArchiveSha256 = [string]$lock.model.archiveSha256
    runtimeSha256 = [string]$lock.runtime.sha256
    generatedAtUtc = [DateTime]::UtcNow.ToString('o')
  }
  $prepared | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding UTF8
} finally {
  if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
  }
}

& $PSCommandPath -VerifyOnly
