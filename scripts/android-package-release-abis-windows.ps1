[CmdletBinding()]
param(
  [string]$OutputRoot,
  [switch]$Offline
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  throw 'This release packaging script is only supported on Windows.'
}

$requiredSigningVariables = @(
  'QINGJI_ANDROID_RELEASE_STORE_FILE',
  'QINGJI_ANDROID_RELEASE_STORE_PASSWORD',
  'QINGJI_ANDROID_RELEASE_KEY_ALIAS',
  'QINGJI_ANDROID_RELEASE_KEY_PASSWORD'
)
$missingSigningVariables = @($requiredSigningVariables | Where-Object {
    [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_, 'Process'))
  })
if ($missingSigningVariables.Count -gt 0) {
  throw "Production Release signing is not configured. Missing: $($missingSigningVariables -join ', ')."
}

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$identity = Get-Content -LiteralPath (Join-Path $projectRoot 'config\release-identity.json') -Raw |
  ConvertFrom-Json
$versionName = [string]$identity.marketingVersion
$versionCode = [int]$identity.buildNumber
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  $OutputRoot = Join-Path $projectRoot "artifacts\android\release-$versionName-$versionCode-$timestamp"
} elseif (-not [IO.Path]::IsPathRooted($OutputRoot)) {
  $OutputRoot = Join-Path $projectRoot $OutputRoot
}
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
if (Test-Path -LiteralPath $OutputRoot) {
  throw "Release output directory already exists: $OutputRoot"
}
New-Item -ItemType Directory -Path $OutputRoot | Out-Null

$sdkRoot = @(
  $env:ANDROID_SDK_ROOT,
  $env:ANDROID_HOME,
  'D:\Android_SDK',
  'D:\CodexData\Android\Sdk'
) | Where-Object {
  -not [string]::IsNullOrWhiteSpace($_) -and
  (Test-Path -LiteralPath $_ -PathType Container)
} | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($sdkRoot)) {
  throw 'Android SDK was not found.'
}
$buildToolsDirectory = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'build-tools') -Directory |
  Sort-Object { try { [version]$_.Name } catch { [version]'0.0' } } -Descending |
  Select-Object -First 1
$apksigner = Join-Path $buildToolsDirectory.FullName 'apksigner.bat'
$zipalign = Join-Path $buildToolsDirectory.FullName 'zipalign.exe'
if (-not (Test-Path -LiteralPath $apksigner -PathType Leaf) -or
    -not (Test-Path -LiteralPath $zipalign -PathType Leaf)) {
  throw 'apksigner or zipalign is missing from the Android SDK build-tools.'
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-ApkAbis {
  param([Parameter(Mandatory = $true)][string]$ApkPath)

  $archive = [IO.Compression.ZipFile]::OpenRead($ApkPath)
  try {
    return @($archive.Entries |
      ForEach-Object {
        if ($_.FullName -match '^lib/([^/]+)/[^/]+\.so$') { $Matches[1] }
      } |
      Sort-Object -Unique)
  } finally {
    $archive.Dispose()
  }
}

$buildScript = Join-Path $PSScriptRoot 'android-build-windows.ps1'
$sourceApk = Join-Path $projectRoot 'android\app\build\outputs\apk\release\app-release.apk'
$targets = @(
  [pscustomobject]@{
    Name = 'armeabi-v7a'
    Architectures = 'armeabi-v7a'
    ExpectedAbis = @('armeabi-v7a')
  },
  [pscustomobject]@{
    Name = 'arm64-v8a'
    Architectures = 'arm64-v8a'
    ExpectedAbis = @('arm64-v8a')
  },
  [pscustomobject]@{
    Name = 'universal'
    Architectures = 'armeabi-v7a,arm64-v8a'
    ExpectedAbis = @('arm64-v8a', 'armeabi-v7a')
  }
)
$artifacts = @()
foreach ($target in $targets) {
  Write-Output "BUILD_RELEASE_ABI=$($target.Name)"
  $buildArguments = @(
    '-Variant', 'Release',
    '-ReactNativeArchitectures', $target.Architectures
  )
  if ($Offline) { $buildArguments += '-Offline' }
  & $buildScript @buildArguments
  if ($LASTEXITCODE -ne 0 -or
      -not (Test-Path -LiteralPath $sourceApk -PathType Leaf)) {
    throw "Release build failed for $($target.Name)."
  }
  $destination = Join-Path $OutputRoot "QingJiAI-$versionName-$($target.Name)-release.apk"
  Copy-Item -LiteralPath $sourceApk -Destination $destination
  $actualAbis = @(Get-ApkAbis -ApkPath $destination)
  if (($actualAbis -join ',') -ne ($target.ExpectedAbis -join ',')) {
    throw "Unexpected ABIs in $($target.Name): $($actualAbis -join ',')."
  }
  & $zipalign -c -P 16 4 $destination | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "zipalign verification failed for $destination" }
  & $apksigner verify --verbose --print-certs $destination | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "APK signature verification failed for $destination" }
  $artifacts += [ordered]@{
    name = $target.Name
    file = [IO.Path]::GetFileName($destination)
    abis = $actualAbis
    sizeBytes = (Get-Item -LiteralPath $destination).Length
    sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$manifest = [ordered]@{
  schemaVersion = 1
  status = 'ANDROID_RELEASE_APKS_PACKAGED'
  applicationId = 'com.qingjiai'
  versionName = $versionName
  versionCode = $versionCode
  generatedAt = [DateTime]::UtcNow.ToString('o')
  signing = 'PRODUCTION_RELEASE_EXTERNAL_KEY'
  artifacts = $artifacts
}
$manifestPath = Join-Path $OutputRoot 'release-apks.json'
$utf8NoBom = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText(
  $manifestPath,
  (($manifest | ConvertTo-Json -Depth 6) + "`n"),
  $utf8NoBom
)
Write-Output "RELEASE_OUTPUT=$OutputRoot"
Write-Output "RELEASE_MANIFEST=$manifestPath"
foreach ($artifact in $artifacts) {
  Write-Output "APK_$($artifact.name.ToUpperInvariant().Replace('-', '_'))=$($artifact.file)"
  Write-Output "APK_$($artifact.name.ToUpperInvariant().Replace('-', '_'))_SHA256=$($artifact.sha256)"
}
