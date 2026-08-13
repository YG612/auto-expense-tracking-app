[CmdletBinding()]
param(
  [ValidateSet('Debug', 'Internal', 'Release')]
  [string]$Variant = 'Debug',
  [switch]$RunUnitTests,
  [switch]$Offline,
  [switch]$StreamingAsr
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  throw 'This short-path build wrapper is only supported on Windows.'
}
if ($StreamingAsr -and $Variant -ne 'Internal') {
  throw 'StreamingAsr is only valid for the Internal Android variant.'
}

$driveName = 'Q'
$driveRoot = "${driveName}:\"
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$androidDirectory = Join-Path $projectRoot 'android'
$gradleWrapper = Join-Path $androidDirectory 'gradlew.bat'
$packageJson = Join-Path $projectRoot 'package.json'
$createdMapping = $false
$gradleExitCode = 1
$previousPhysicalProjectRoot = $env:QINGJI_PHYSICAL_PROJECT_ROOT
$autolinkConfig = Join-Path $androidDirectory 'build\generated\autolinking\autolinking.json'
$buildMutex = $null
$ownsBuildMutex = $false

$dDriveEnvironmentFallbacks = [ordered]@{
  ANDROID_HOME = 'D:\CodexData\Android\Sdk'
  ANDROID_SDK_ROOT = 'D:\CodexData\Android\Sdk'
  GRADLE_USER_HOME = 'D:\CodexData\Caches\gradle'
  PNPM_HOME = 'D:\CodexData\Caches\pnpm'
  NPM_CONFIG_CACHE = 'D:\CodexData\Caches\npm'
  TEMP = 'D:\CodexData\Temp'
  TMP = 'D:\CodexData\Temp'
}

foreach ($entry in $dDriveEnvironmentFallbacks.GetEnumerator()) {
  $name = $entry.Key
  $candidates = @(
    [Environment]::GetEnvironmentVariable($name, 'Process'),
    [Environment]::GetEnvironmentVariable($name, 'User'),
    [Environment]::GetEnvironmentVariable($name, 'Machine'),
    $entry.Value
  )
  $selectedValue =
    $candidates |
      Where-Object {
        -not [string]::IsNullOrWhiteSpace($_) -and
        [IO.Path]::GetPathRoot($_).Equals('D:\', [StringComparison]::OrdinalIgnoreCase)
      } |
      Select-Object -First 1
  if ([string]::IsNullOrWhiteSpace($selectedValue)) {
    throw "No D: drive location is configured for $name."
  }
  Set-Item -Path "Env:$name" -Value $selectedValue
}

foreach ($cacheDirectory in @(
  $env:GRADLE_USER_HOME,
  $env:PNPM_HOME,
  $env:NPM_CONFIG_CACHE,
  $env:TEMP,
  $env:TMP
)) {
  if (-not (Test-Path -LiteralPath $cacheDirectory -PathType Container)) {
    New-Item -ItemType Directory -Path $cacheDirectory -Force | Out-Null
  }
}
if (-not (Test-Path -LiteralPath $env:ANDROID_SDK_ROOT -PathType Container)) {
  $env:ANDROID_SDK_ROOT = $dDriveEnvironmentFallbacks.ANDROID_SDK_ROOT
}
if (-not (Test-Path -LiteralPath $env:ANDROID_SDK_ROOT -PathType Container)) {
  throw "Android SDK is missing from D: drive: $env:ANDROID_SDK_ROOT"
}
$env:ANDROID_HOME = $env:ANDROID_SDK_ROOT

Write-Output "BUILD_ANDROID_SDK=$env:ANDROID_SDK_ROOT"
Write-Output "BUILD_GRADLE_CACHE=$env:GRADLE_USER_HOME"
Write-Output "BUILD_PACKAGE_CACHE=$env:NPM_CONFIG_CACHE"
Write-Output "BUILD_TEMP=$env:TEMP"

if (-not (Test-Path -LiteralPath $gradleWrapper -PathType Leaf)) {
  throw "Gradle wrapper is missing: $gradleWrapper"
}
if (-not (Test-Path -LiteralPath $packageJson -PathType Leaf)) {
  throw "package.json is missing: $packageJson"
}
try {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($null -eq $nodeCommand) {
    throw 'Node.js is required but was not found on PATH.'
  }

  $physicalProjectRoot = & $nodeCommand.Source -e "process.stdout.write(require('fs').realpathSync.native(process.argv[1]))" $projectRoot
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($physicalProjectRoot)) {
    throw "Unable to resolve the physical project path: $projectRoot"
  }
  $physicalProjectRoot = $physicalProjectRoot.TrimEnd('\')
  if (-not (Test-Path -LiteralPath (Join-Path $physicalProjectRoot 'package.json') -PathType Leaf)) {
    throw "Resolved project path is invalid: $physicalProjectRoot"
  }
  $env:QINGJI_PHYSICAL_PROJECT_ROOT = $physicalProjectRoot

  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    $projectPathBytes = [Text.Encoding]::UTF8.GetBytes($physicalProjectRoot.ToUpperInvariant())
    $projectPathHash =
      [BitConverter]::ToString($sha256.ComputeHash($projectPathBytes)).Replace('-', '')
  } finally {
    $sha256.Dispose()
  }
  $mutexName = "Local\QingJiAIAndroidBuild_$($projectPathHash.Substring(0, 24))"
  $buildMutex = [Threading.Mutex]::new($false, $mutexName)
  try {
    $ownsBuildMutex = $buildMutex.WaitOne(0)
  } catch [Threading.AbandonedMutexException] {
    $ownsBuildMutex = $true
  }
  if (-not $ownsBuildMutex) {
    throw 'Another Android build for this project is already running.'
  }

  if (Test-Path -LiteralPath $driveRoot) {
    $mappingPrefix = "${driveName}:\: => "
    $substMapping =
      @(& subst.exe) |
        Where-Object { $_.StartsWith($mappingPrefix, [StringComparison]::OrdinalIgnoreCase) } |
        Select-Object -First 1
    $mappingTarget = if ([string]::IsNullOrWhiteSpace($substMapping)) {
      $null
    } else {
      $substMapping.Substring($mappingPrefix.Length).Trim()
    }
    $existingPhysicalRoot = if ([string]::IsNullOrWhiteSpace($mappingTarget)) {
      $null
    } else {
      & $nodeCommand.Source -e "process.stdout.write(require('fs').realpathSync.native(process.argv[1]))" $mappingTarget
    }
    $isOwnStaleMapping =
      -not [string]::IsNullOrWhiteSpace($substMapping) -and
      $LASTEXITCODE -eq 0 -and
      -not [string]::IsNullOrWhiteSpace($existingPhysicalRoot) -and
      $existingPhysicalRoot.TrimEnd('\').Equals(
        $physicalProjectRoot,
        [StringComparison]::OrdinalIgnoreCase
      )
    if (-not $isOwnStaleMapping) {
      throw "$driveRoot is reserved for reproducible native builds but belongs to another drive, mapping, or project."
    }

    & subst.exe "${driveName}:" '/D'
    if ($LASTEXITCODE -ne 0 -or (Test-Path -LiteralPath $driveRoot)) {
      throw "Unable to remove the stale project mapping at $driveRoot"
    }
  }

  # React Native's generated config contains absolute paths. It must be
  # regenerated inside this subst session and removed before the alias goes away.
  if (Test-Path -LiteralPath $autolinkConfig -PathType Leaf) {
    Remove-Item -LiteralPath $autolinkConfig -Force
  }

  & subst.exe "${driveName}:" $physicalProjectRoot
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath "${driveRoot}package.json")) {
    throw "Unable to map $driveRoot to $physicalProjectRoot"
  }
  $createdMapping = $true

  $gradleArguments = @()
  if ($RunUnitTests) {
    $gradleArguments += ":app:test${Variant}UnitTest"
  }
  $gradleArguments += ":app:assemble$Variant"
  $gradleArguments += '--no-daemon'
  if ($StreamingAsr) {
    $gradleArguments += '-PstreamingAsr=true'
  }
  if ($Offline) {
    $gradleArguments += '--offline'
  }

  Push-Location "${driveRoot}android"
  try {
    & '.\gradlew.bat' @gradleArguments
    $gradleExitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }

  if ($gradleExitCode -ne 0) {
    throw "Android build failed with exit code $gradleExitCode."
  }

  $variantDirectory = $Variant.ToLowerInvariant()
  $apkPath = Join-Path $physicalProjectRoot "android\app\build\outputs\apk\$variantDirectory\app-$variantDirectory.apk"
  if (-not (Test-Path -LiteralPath $apkPath -PathType Leaf)) {
    throw "Android build reported success but the APK is missing: $apkPath"
  }

  $apkHash = (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash
  Write-Output "APK=$apkPath"
  Write-Output "APK_SHA256=$apkHash"
} finally {
  try {
    if ($ownsBuildMutex -and (Test-Path -LiteralPath $autolinkConfig -PathType Leaf)) {
      try {
        Remove-Item -LiteralPath $autolinkConfig -Force
      } catch {
        Write-Warning "Unable to remove the session autolinking cache: $($_.Exception.Message)"
      }
    }
    if ($createdMapping) {
      & subst.exe "${driveName}:" '/D'
      if (Test-Path -LiteralPath $driveRoot) {
        Write-Warning "Unable to remove temporary drive mapping $driveRoot"
      }
    }
  } finally {
    if ($null -eq $previousPhysicalProjectRoot) {
      Remove-Item Env:QINGJI_PHYSICAL_PROJECT_ROOT -ErrorAction SilentlyContinue
    } else {
      $env:QINGJI_PHYSICAL_PROJECT_ROOT = $previousPhysicalProjectRoot
    }
    if ($ownsBuildMutex) {
      $buildMutex.ReleaseMutex()
    }
    if ($null -ne $buildMutex) {
      $buildMutex.Dispose()
    }
  }
}
