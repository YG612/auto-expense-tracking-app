[CmdletBinding()]
param(
  [ValidateSet('Debug', 'Internal', 'Release')]
  [string]$Variant = 'Debug',
  [switch]$RunUnitTests,
  [switch]$Offline,
  [ValidateSet('armeabi-v7a', 'arm64-v8a', 'armeabi-v7a,arm64-v8a')]
  [string]$ReactNativeArchitectures,
  [switch]$StreamingAsr,
  [ValidateSet('ncnn', 'onnx', 'onnx-ctc-small', 'onnx-paraformer-small', 'onnx-paraformer-compact')]
  [string]$StreamingAsrEngine = 'ncnn',
  [ValidateSet('', 'baseline-int8', 'rtn-safe', 'hqq-safe', 'asym-ffn', 'asym-ffn-decoder', 'asym-full')]
  [string]$CompactModelId = '',
  [switch]$OptimizeInternalSize,
  [string]$BillClassifierAssetsRoot,
  [string]$BuildReceipt
)

$ErrorActionPreference = 'Stop'

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'This short-path build wrapper is only supported on Windows.'
}
if ($StreamingAsr -and $Variant -ne 'Internal') {
  throw 'StreamingAsr is only valid for the Internal Android variant.'
}
if (-not [string]::IsNullOrWhiteSpace($CompactModelId) -and
    (-not $StreamingAsr -or $StreamingAsrEngine -ne 'onnx-paraformer-compact')) {
  throw 'CompactModelId is only valid with the compact Paraformer streaming track.'
}
if ($OptimizeInternalSize -and [string]::IsNullOrWhiteSpace($CompactModelId)) {
  throw 'OptimizeInternalSize requires one explicit CompactModelId.'
}
if ([string]::IsNullOrWhiteSpace($ReactNativeArchitectures) -and $Variant -eq 'Internal') {
  $ReactNativeArchitectures = 'arm64-v8a'
}
if (-not [string]::IsNullOrWhiteSpace($ReactNativeArchitectures) -and
    $Variant -notin @('Internal', 'Release')) {
  throw 'ReactNativeArchitectures is only valid for Internal or production Release variants.'
}
if ($Variant -eq 'Internal' -and $ReactNativeArchitectures -ne 'arm64-v8a') {
  throw 'Internal Android artifacts must use the arm64-v8a architecture.'
}
if (-not [string]::IsNullOrWhiteSpace($BillClassifierAssetsRoot) -and $Variant -ne 'Internal') {
  throw 'BillClassifierAssetsRoot is only valid for the Internal shadow variant.'
}
if (-not [string]::IsNullOrWhiteSpace($BillClassifierAssetsRoot) -and
    [string]::IsNullOrWhiteSpace($BuildReceipt)) {
  throw 'BuildReceipt is required for an Internal shadow classifier build.'
}
if ([string]::IsNullOrWhiteSpace($BillClassifierAssetsRoot) -and
    -not [string]::IsNullOrWhiteSpace($BuildReceipt)) {
  throw 'BuildReceipt is only valid with BillClassifierAssetsRoot.'
}

function Get-InternalArtifactFileName {
  if (-not $StreamingAsr) {
    return 'app-internal-standard.apk'
  }
  switch ($StreamingAsrEngine) {
    'onnx-ctc-small' { return 'app-internal-offline-ctc-small.apk' }
    'onnx-paraformer-small' { return 'app-internal-offline-paraformer-small.apk' }
    'onnx-paraformer-compact' {
      if ([string]::IsNullOrWhiteSpace($CompactModelId)) {
        return 'app-internal-offline-paraformer-compact-model-lab.apk'
      }
      $optimizationSuffix = if ($OptimizeInternalSize) { '-optimized' } else { '' }
      return "app-internal-offline-paraformer-compact-$CompactModelId$optimizationSuffix.apk"
    }
    default { return "app-internal-offline-$StreamingAsrEngine.apk" }
  }
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

if (-not [string]::IsNullOrWhiteSpace($BillClassifierAssetsRoot)) {
  $shadowAssetsInput = $BillClassifierAssetsRoot
  if (-not [IO.Path]::IsPathRooted($shadowAssetsInput)) {
    $shadowAssetsInput = Join-Path $projectRoot $shadowAssetsInput
  }
  $BillClassifierAssetsRoot = [IO.Path]::GetFullPath(
    $shadowAssetsInput
  )
  $expectedShadowManifest = Join-Path $BillClassifierAssetsRoot 'bill-classifier\manifest.json'
  if (-not (Test-Path -LiteralPath $expectedShadowManifest -PathType Leaf)) {
    throw "Shadow classifier manifest is missing: $expectedShadowManifest"
  }
  $receiptInput = $BuildReceipt
  if (-not [IO.Path]::IsPathRooted($receiptInput)) {
    $receiptInput = Join-Path $projectRoot $receiptInput
  }
  $BuildReceipt = [IO.Path]::GetFullPath($receiptInput)
  if (Test-Path -LiteralPath $BuildReceipt) {
    throw "Build receipt already exists: $BuildReceipt"
  }
}

$dDriveEnvironmentFallbacks = [ordered]@{
  JAVA_HOME = 'D:\.jdks\temurin-17'
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
$javaExecutable = Join-Path $env:JAVA_HOME 'bin\java.exe'
if (-not (Test-Path -LiteralPath $javaExecutable -PathType Leaf)) {
  throw "Java 17 or newer is missing from D: drive: $env:JAVA_HOME"
}
$javaReleaseFile = Join-Path $env:JAVA_HOME 'release'
if (-not (Test-Path -LiteralPath $javaReleaseFile -PathType Leaf)) {
  throw "Java release metadata is missing: $javaReleaseFile"
}
$javaRelease = Get-Content -LiteralPath $javaReleaseFile -Raw -Encoding UTF8
if ($javaRelease -notmatch '(?m)^JAVA_VERSION="(?:1\.)?(?<major>\d+)') {
  throw "Unable to determine Java version: $javaReleaseFile"
}
if ([int]$Matches.major -lt 17) {
  throw "Gradle requires Java 17 or newer; selected Java $($Matches.major): $javaExecutable"
}
$env:PATH = "$(Join-Path $env:JAVA_HOME 'bin');$env:PATH"

Write-Output "BUILD_JAVA_HOME=$env:JAVA_HOME"
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
  if ($Variant -eq 'Internal') {
    # Different ASR engines share the same Gradle variant/output paths. Always
    # clear Internal intermediates so assets or JNI libraries from a preceding
    # engine can never leak into the next candidate APK.
    $gradleArguments += ":app:clean"
  }
  if ($RunUnitTests) {
    $gradleArguments += ":app:test${Variant}UnitTest"
  }
  $gradleArguments += ":app:assemble$Variant"
  $gradleArguments += '--no-daemon'
  if ($StreamingAsr) {
    $gradleArguments += '-PstreamingAsr=true'
    $gradleArguments += "-PstreamingAsrEngine=$StreamingAsrEngine"
  }
  if (-not [string]::IsNullOrWhiteSpace($CompactModelId)) {
    $gradleArguments += "-PparaformerCompactModelId=$CompactModelId"
  }
  if ($OptimizeInternalSize) {
    $gradleArguments += '-PoptimizeInternalSize=true'
  }
  if (-not [string]::IsNullOrWhiteSpace($ReactNativeArchitectures)) {
    $gradleArguments += "-PreactNativeArchitectures=$ReactNativeArchitectures"
  }
  if (-not [string]::IsNullOrWhiteSpace($BillClassifierAssetsRoot)) {
    $gradleArguments += "-PbillClassifierAssetsRoot=$BillClassifierAssetsRoot"
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
  $apkFileName = if ($Variant -eq 'Internal') {
    Get-InternalArtifactFileName
  } else {
    "app-$variantDirectory.apk"
  }
  $generatedApkPath = Join-Path $physicalProjectRoot "android\app\build\outputs\apk\$variantDirectory\$apkFileName"
  if (-not (Test-Path -LiteralPath $generatedApkPath -PathType Leaf)) {
    throw "Android build reported success but the APK is missing: $generatedApkPath"
  }

  $apkPath = $generatedApkPath
  if ($Variant -eq 'Internal') {
    # :app:clean is mandatory between Internal speech tracks to prevent stale JNI
    # or model leakage. Preserve each verified transport artifact outside app/build
    # so a later track cannot delete or overwrite it.
    $artifactDirectory = Join-Path $physicalProjectRoot 'artifacts\android\internal'
    if (-not (Test-Path -LiteralPath $artifactDirectory -PathType Container)) {
      New-Item -ItemType Directory -Path $artifactDirectory -Force | Out-Null
    }
    $apkPath = Join-Path $artifactDirectory $apkFileName
    Copy-Item -LiteralPath $generatedApkPath -Destination $apkPath -Force
  }

  $apkHashAlgorithm = [Security.Cryptography.SHA256]::Create()
  $apkStream = [IO.File]::OpenRead($apkPath)
  try {
    $apkHash =
      [BitConverter]::ToString($apkHashAlgorithm.ComputeHash($apkStream)).Replace('-', '')
  } finally {
    $apkStream.Dispose()
    $apkHashAlgorithm.Dispose()
  }
  Write-Output "APK=$apkPath"
  Write-Output "APK_BUILD_OUTPUT=$generatedApkPath"
  Write-Output "APK_SHA256=$apkHash"
  if (-not [string]::IsNullOrWhiteSpace($BuildReceipt)) {
    $manifestHash = (Get-FileHash -LiteralPath $expectedShadowManifest -Algorithm SHA256).Hash.ToLowerInvariant()
    $classifierManifest = Get-Content -LiteralPath $expectedShadowManifest -Raw | ConvertFrom-Json
    $deploymentMode = $classifierManifest.deployment.mode
    if ($deploymentMode -notin @('SHADOW', 'BENCHMARK_ONLY')) {
      throw "Unsupported classifier deployment mode in build receipt: $deploymentMode"
    }
    $receiptDirectory = Split-Path -Parent $BuildReceipt
    if (-not (Test-Path -LiteralPath $receiptDirectory -PathType Container)) {
      New-Item -ItemType Directory -Path $receiptDirectory -Force | Out-Null
    }
    $receipt = [ordered]@{
      schemaVersion = 1
      status = if ($deploymentMode -eq 'BENCHMARK_ONLY') {
        'ANDROID_BENCHMARK_BUILD_COMPLETE'
      } else {
        'ANDROID_SHADOW_BUILD_COMPLETE'
      }
      deploymentMode = $deploymentMode
      variant = $Variant
      allowAutoCommit = $false
      apkPath = $apkPath
      apkSha256 = $apkHash.ToLowerInvariant()
      billClassifierAssetsRoot = $BillClassifierAssetsRoot
      billClassifierManifestSha256 = $manifestHash
      generatedAt = [DateTime]::UtcNow.ToString('o')
    }
    $temporaryReceipt = "$BuildReceipt.tmp-$PID"
    $receiptJson = $receipt | ConvertTo-Json -Depth 4
    $utf8NoBom = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($temporaryReceipt, $receiptJson, $utf8NoBom)
    Move-Item -LiteralPath $temporaryReceipt -Destination $BuildReceipt
    Write-Output "BUILD_RECEIPT=$BuildReceipt"
  }
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
