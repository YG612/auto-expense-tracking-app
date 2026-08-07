[CmdletBinding()]
param(
  # Persist the resolved environment variables at User scope so future shells
  # inherit them. Without this switch the variables only apply to this process.
  [switch]$Persist,

  # Write an init.gradle into the Gradle home that routes google() /
  # mavenCentral() through Aliyun mirrors. Useful for mainland China networks.
  [switch]$UseMirrors,

  # Only resolve and print the environment (JDK / SDK / Gradle home) and verify
  # that already-installed SDK components are complete; do not download.
  [switch]$SkipDownloads,

  # Install the Android NDK and CMake packages. Needed for full APK assemble
  # (new architecture), but not for :app:testDebugUnitTest alone.
  [switch]$SkipNdkCmake,

  # Override the Gradle distribution URL used to seed the wrapper cache.
  [string]$GradleUrl = 'https://services.gradle.org/distributions/gradle-9.3.1-bin.zip',

  # Override the Temurin JDK 17 download URL (used by the RN gradle-plugin
  # Java 17 toolchain). Defaults to the Tsinghua mirror for mainland China.
  [string]$Jdk17Url = 'https://mirrors.tuna.tsinghua.edu.cn/Adoptium/17/jdk/x64/windows/OpenJDK17U-jdk_x64_windows_hotspot_17.0.20_8.zip'
)

$ErrorActionPreference = 'Stop'

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'This provisioning script is only supported on Windows.'
}

function Select-FirstExisting {
  param([string[]]$Candidates)
  foreach ($candidate in $Candidates) {
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate -PathType Container)) {
      return $candidate
    }
  }
  return $null
}

function Set-SessionAndMaybePersist {
  param(
    [string]$Name,
    [string]$Value
  )
  Set-Item -Path "Env:$Name" -Value $Value
  if ($Persist) {
    [Environment]::SetEnvironmentVariable($Name, $Value, 'User')
  }
}

function Write-Verified {
  param([string]$Message)
  Write-Host $Message -ForegroundColor Green
}

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Warn {
  param([string]$Message)
  Write-Host "WARN: $Message" -ForegroundColor Yellow
}

function Test-HttpHead {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -Uri $Url -Method Head -UseBasicParsing -TimeoutSec 20
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Invoke-Download {
  param(
    [string]$Url,
    [string]$Destination
  )
  Write-Step "Downloading $([IO.Path]::GetFileName($Url))"
  Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing
}

function Get-JavaVersion {
  param([string]$JavaExe)
  try {
    $firstLine = & $JavaExe -version 2>&1 | Select-Object -First 1
    if ($firstLine -match 'version "(\d+)') {
      return [int]$Matches[1]
    }
  } catch {
    # Ignore unreadable JDKs and let callers fall through.
  }
  return 0
}

function Expand-Zip {
  param(
    [string]$ZipPath,
    [string]$Destination
  )
  if (-not (Test-Path -LiteralPath $Destination -PathType Container)) {
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  }
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $Destination -Force
}

Write-Step 'Resolving JDK (Gradle 9 requires Java 17+; RN gradle-plugin toolchain needs 17)'
$jdk17Home = $null
$jdk21Home = $null
foreach ($candidate in @($env:JAVA_HOME, 'D:\.jdks\temurin-17', 'D:\.jdks\openjdk-17.0.1', 'D:\.jdks\openjdk-21.0.1')) {
  if ([string]::IsNullOrWhiteSpace($candidate)) {
    continue
  }
  $javaExe = Join-Path $candidate 'bin\java.exe'
  if (-not (Test-Path -LiteralPath $javaExe)) {
    continue
  }
  $version = Get-JavaVersion $javaExe
  if ($version -eq 17 -and $null -eq $jdk17Home) {
    $jdk17Home = $candidate
  } elseif ($version -eq 21 -and $null -eq $jdk21Home) {
    $jdk21Home = $candidate
  }
}
if ($null -eq $jdk17Home) {
  if ($SkipDownloads) {
    throw 'JDK 17 is required for the RN gradle-plugin toolchain. Install Temurin 17 under D:\.jdks\temurin-17.'
  }
  Write-Step 'Installing Temurin JDK 17'
  $zip = Join-Path $env:TEMP 'temurin17.zip'
  Invoke-Download -Url $Jdk17Url -Destination $zip
  New-Item -ItemType Directory -Path 'D:\.jdks' -Force | Out-Null
  Expand-Zip -ZipPath $zip -Destination 'D:\.jdks'
  $extracted = Get-ChildItem 'D:\.jdks' -Directory | Where-Object { $_.Name -like '*17*' } | Select-Object -First 1
  if ($null -eq $extracted) {
    throw 'JDK 17 extraction failed; no extracted directory was found.'
  }
  $jdk17Home = 'D:\.jdks\temurin-17'
  if (Test-Path -LiteralPath $jdk17Home) {
    Remove-Item -LiteralPath $jdk17Home -Recurse -Force
  }
  Move-Item -LiteralPath $extracted.FullName -Destination $jdk17Home
}
if ($null -eq $jdk21Home -and (Test-Path -LiteralPath 'D:\.jdks\openjdk-21.0.1\bin\java.exe')) {
  $jdk21Home = 'D:\.jdks\openjdk-21.0.1'
}
$daemonJdk = if ($null -ne $jdk21Home) { $jdk21Home } else { $jdk17Home }
Set-SessionAndMaybePersist 'JAVA_HOME' $daemonJdk
Write-Verified "JAVA_HOME=$daemonJdk"
Write-Verified "JDK17_TOOLCHAIN=$jdk17Home"

Write-Step 'Resolving Android SDK (must live on D: for the project build wrapper)'
$sdkCandidates = @(
  $env:ANDROID_SDK_ROOT,
  $env:ANDROID_HOME,
  'D:\Android_SDK',
  'D:\CodexData\Android\Sdk'
)
$sdkRoot = Select-FirstExisting $sdkCandidates
if ($null -eq $sdkRoot) {
  throw 'No Android SDK found. Install one under D:\Android_SDK (or D:\CodexData\Android\Sdk).'
}
Set-SessionAndMaybePersist 'ANDROID_SDK_ROOT' $sdkRoot
Set-SessionAndMaybePersist 'ANDROID_HOME' $sdkRoot
Write-Verified "ANDROID_HOME=$sdkRoot"

Write-Step 'Resolving Gradle user home (wrapper distribution + dependency caches)'
$gradleHome = Select-FirstExisting @($env:GRADLE_USER_HOME, 'D:\CodexData\Caches\gradle')
if ($null -eq $gradleHome) {
  $gradleHome = 'D:\CodexData\Caches\gradle'
  New-Item -ItemType Directory -Path $gradleHome -Force | Out-Null
}
Set-SessionAndMaybePersist 'GRADLE_USER_HOME' $gradleHome
Write-Verified "GRADLE_USER_HOME=$gradleHome"

Write-Step 'Registering Java toolchains for the RN gradle-plugin'
$installations = @($jdk17Home, $jdk21Home) | Where-Object { $_ }
$escaped = ($installations | ForEach-Object { $_.Replace('\', '\\') }) -join ','
$propsFile = Join-Path $gradleHome 'gradle.properties'
@(
  '# Registered by scripts/android-env-setup.ps1 for the RN gradle-plugin toolchain.',
  "org.gradle.java.installations.paths=$escaped"
) | Set-Content -LiteralPath $propsFile -Encoding UTF8
Write-Verified "Toolchain registration: $propsFile"

if ($UseMirrors) {
  $initScript = Join-Path $gradleHome 'init.gradle'
  @'
allprojects {
  buildscript {
    repositories {
      maven { url 'https://maven.aliyun.com/repository/google' }
      maven { url 'https://maven.aliyun.com/repository/central' }
      maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }
      google()
      mavenCentral()
    }
  }
  repositories {
    maven { url 'https://maven.aliyun.com/repository/google' }
    maven { url 'https://maven.aliyun.com/repository/central' }
    google()
    mavenCentral()
  }
}
'@ | Set-Content -LiteralPath $initScript -Encoding UTF8
  Write-Verified "Wrote mirror init script: $initScript"
}

if ($SkipDownloads) {
  Write-Step 'SkipDownloads set - only verifying the environment'
} else {
  $cmdlineToolsRoot = Join-Path $sdkRoot 'cmdline-tools\latest'
  if (-not (Test-Path -LiteralPath (Join-Path $cmdlineToolsRoot 'bin\sdkmanager.bat'))) {
    Write-Step 'Installing Android command-line tools'
    $toolUrls = @(
      'https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip',
      'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip'
    )
    $toolUrl = $toolUrls | Where-Object { Test-HttpHead $_ } | Select-Object -First 1
    if ($null -eq $toolUrl) {
      throw 'Could not reach any command-line tools download URL (network or mirror blocked).'
    }
    $zip = Join-Path $env:TEMP 'commandlinetools-win.zip'
    Invoke-Download -Url $toolUrl -Destination $zip
    $extractRoot = Join-Path $sdkRoot 'cmdline-tools'
    Expand-Zip -ZipPath $zip -Destination $extractRoot
    if (Test-Path -LiteralPath (Join-Path $extractRoot 'cmdline-tools\bin\sdkmanager.bat')) {
      # A previous interrupted run may have left an empty/partial 'latest' dir.
      # It only contains this script's own incomplete install, so replacing it
      # is safe and recoverable by re-running the script.
      if (Test-Path -LiteralPath $cmdlineToolsRoot) {
        Remove-Item -LiteralPath $cmdlineToolsRoot -Recurse -Force
      }
      Move-Item -LiteralPath (Join-Path $extractRoot 'cmdline-tools') -Destination $cmdlineToolsRoot
    }
  } else {
    Write-Verified 'Command-line tools already installed'
  }

  $sdkManager = Join-Path $cmdlineToolsRoot 'bin\sdkmanager.bat'
  $yes = @('y') * 20
  Write-Step 'Accepting SDK licenses'
  $yes | & $sdkManager --licenses 2>&1 | Out-Null

  $packages = @('platforms;android-36', 'build-tools;36.0.0')
  if (-not $SkipNdkCmake) {
    $packages += @(
      'ndk;27.0.12077973', # op-sqlite native dependency
      'ndk;27.1.12297006', # app ndkVersion
      'cmake;3.22.1'
    )
  }
  foreach ($package in $packages) {
    Write-Step "Installing $package"
    $yes | & $sdkManager $package 2>&1 | Out-Null
  }
  Write-Verified 'SDK components ready'

  $wrapperDists = Join-Path $gradleHome 'wrapper\dists'
  $gradleDirName = 'gradle-9.3.1-bin'
  $hashDir = '23ovyewtku6u96viwx3xl3oks'
  $targetDir = Join-Path $wrapperDists (Join-Path $gradleDirName $hashDir)
  $marker = Join-Path $targetDir '.ok'
  $gradleBin = Join-Path $targetDir 'gradle-9.3.1\bin\gradle.bat'
  if (-not (Test-Path -LiteralPath $gradleBin)) {
    Write-Step 'Seeding Gradle 9.3.1 distribution into the wrapper cache'
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    $gradleZip = Join-Path $targetDir "$gradleDirName.zip"
    if (-not (Test-Path -LiteralPath $gradleZip)) {
      Invoke-Download -Url $GradleUrl -Destination $gradleZip
    }
    Expand-Zip -ZipPath $gradleZip -Destination $targetDir
    New-Item -ItemType File -Path $marker -Force | Out-Null
  } else {
    Write-Verified 'Gradle distribution already cached'
  }
}

Write-Step 'Verifying Gradle wrapper'
$gradlew = Join-Path $PSScriptRoot '..\android\gradlew.bat'
if ($SkipDownloads) {
  Write-Warn 'SkipDownloads set - skipping gradlew --version (it would need to download the distribution)'
} else {
  & $gradlew --version 2>&1 | Select-Object -First 12
}

Write-Step 'Environment summary'
Write-Verified "JAVA_HOME=$env:JAVA_HOME"
Write-Verified "ANDROID_HOME=$env:ANDROID_HOME"
Write-Verified "GRADLE_USER_HOME=$env:GRADLE_USER_HOME"
Write-Verified 'Next: run  scripts\android-build-windows.ps1 -Variant Debug -RunUnitTests  (first run online), then repeat with -Offline.'
