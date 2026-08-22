[CmdletBinding()]
param(
  [string]$CacheRoot = 'D:\CodexData\Caches\QingJiAI\streaming-asr',
  [string]$AndroidSdk = 'D:\CodexData\Android\Sdk'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceRoot = Join-Path $CacheRoot 'build-v2.1.7-arm64\source\sherpa-ncnn-72ea103e9b2f56c052e7c400a8c965c143153f31'
$installRoot = Join-Path $CacheRoot 'build-v2.1.7-arm64\install\lib'
$stage = Join-Path $CacheRoot 'build-v2.1.7-arm64\aar-stage'
$artifact = Join-Path $CacheRoot 'artifacts\qingji-sherpa-ncnn-arm64-2.1.7-qingji.1.aar'
$wrapper = Join-Path $sourceRoot 'android\SherpaNcnn\app\src\main\java\com\k2fsa\sherpa\ncnn\SherpaNcnn.kt'
$patch = Join-Path $projectRoot 'scripts\streaming-asr\SherpaNcnn-release.patch'
$license = Join-Path $projectRoot 'scripts\streaming-asr\SHERPA_NCNN_APACHE-2.0.txt'
$ncnnLicense = Join-Path $CacheRoot 'build-v2.1.7-arm64\dependencies\ncnn\ncnn-sherpa-1.1\LICENSE.txt'
$androidJar = Join-Path $AndroidSdk 'platforms\android-36\android.jar'
$archiveDate = '2023-02-23T00:00:00Z'
$git = (Get-Command git.exe -ErrorAction Stop).Source

function Get-Sha256([string]$Path) {
  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Get-NormalizedTextSha256([string]$Path) {
  $text = [IO.File]::ReadAllText($Path).Replace("`r`n", "`n")
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes($text)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}
if ((Get-NormalizedTextSha256 $patch) -ne 'ab711c3cf9a238cbf34c78c92d9ac234f784370ae5aedc8b98dac026a834804d') {
  throw 'The audited wrapper patch changed.'
}
if ((Get-Sha256 $wrapper) -eq 'f3e47aedf2d668003a490073e455ae66d2d6b946ab318c6920c8df7b2d7a95d2') {
  $normalizedPatch = Join-Path $CacheRoot "normalized-sherpa-ncnn-release-$PID.patch"
  try {
    $patchText = [IO.File]::ReadAllText($patch).Replace("`r`n", "`n")
    [IO.File]::WriteAllText($normalizedPatch, $patchText, [Text.UTF8Encoding]::new($false))
    & $git -C $sourceRoot apply $normalizedPatch
    if ($LASTEXITCODE -ne 0) { throw 'Unable to apply the wrapper release patch.' }
  } finally {
    if (Test-Path -LiteralPath $normalizedPatch) {
      Remove-Item -LiteralPath $normalizedPatch -Force
    }
  }
}
if ((Get-Sha256 $wrapper) -ne '254cb6450e71108207bacdd4beb1f7a294c931bbf21f1ed0bb2fb81b25ce6ca5') {
  throw 'Patched wrapper SHA-256 mismatch.'
}

$gradleCache = 'D:\CodexData\Caches\gradle\caches\modules-2\files-2.1'
$compilerClasspath = @(
  "$gradleCache\org.jetbrains.kotlin\kotlin-compiler-embeddable\2.1.20\4ef56b3316798316bfac7a0ae443391c9e900ea1\kotlin-compiler-embeddable-2.1.20.jar",
  "$gradleCache\org.jetbrains.kotlin\kotlin-stdlib\2.1.20\aa8ca79cd50578314f6d1180c47cbe14c0fee567\kotlin-stdlib-2.1.20.jar",
  "$gradleCache\org.jetbrains.kotlin\kotlin-script-runtime\2.1.20\f7c623d7f7bdb01f5ccd6b437bc0a937fcd7c57e\kotlin-script-runtime-2.1.20.jar",
  "$gradleCache\org.jetbrains.kotlin\kotlin-reflect\2.1.20\3c1003045c4f2a72f987a147abac8e7058be1183\kotlin-reflect-2.1.20.jar",
  "$gradleCache\org.jetbrains.kotlin\kotlin-daemon-embeddable\2.1.20\95670fce77befd02a70a0bc3abe8ee4533521334\kotlin-daemon-embeddable-2.1.20.jar",
  "$gradleCache\org.jetbrains.intellij.deps\trove4j\1.0.20200330\3afb14d5f9ceb459d724e907a21145e8ff394f02\trove4j-1.0.20200330.jar",
  "$gradleCache\org.jetbrains\annotations\23.0.0\8cc20c07506ec18e0834947b84a864bfc094484e\annotations-23.0.0.jar",
  "$gradleCache\org.jetbrains.kotlinx\kotlinx-coroutines-core-jvm\1.9.0\9beade4c1c1569e4f36cbd2c37e02e3e41502601\kotlinx-coroutines-core-jvm-1.9.0.jar"
)
foreach ($jar in $compilerClasspath) {
  if (-not (Test-Path -LiteralPath $jar -PathType Leaf)) { throw "Missing local Kotlin compiler component: $jar" }
}
$stdlib = $compilerClasspath[1]
if (Test-Path -LiteralPath $stage) {
  $full = [IO.Path]::GetFullPath($stage)
  $allowed = [IO.Path]::GetFullPath((Join-Path $CacheRoot 'build-v2.1.7-arm64')).TrimEnd('\') + '\'
  if (-not $full.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe stage path: $full" }
  Remove-Item -LiteralPath $stage -Recurse -Force
}
$classes = Join-Path $stage 'classes'
$jni = Join-Path $stage 'aar\jni\arm64-v8a'
$meta = Join-Path $stage 'aar\META-INF\licenses'
New-Item -ItemType Directory -Force -Path $classes,$jni,$meta,(Split-Path -Parent $artifact) | Out-Null
& java.exe -cp ($compilerClasspath -join ';') org.jetbrains.kotlin.cli.jvm.K2JVMCompiler `
  -no-stdlib -no-reflect -jvm-target 1.8 -classpath "$stdlib;$androidJar" -d $classes $wrapper
if ($LASTEXITCODE -ne 0) { throw 'Offline Kotlin wrapper compilation failed.' }
$classesJar = Join-Path $stage 'aar\classes.jar'
Push-Location $classes
try { & jar.exe --create --file $classesJar --date $archiveDate . } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw 'classes.jar packaging failed.' }

$nativeNames = @('libkaldi-native-fbank-core.so','libncnn.so','libsherpa-ncnn-core.so','libsherpa-ncnn-jni.so')
foreach ($name in $nativeNames) {
  Copy-Item -LiteralPath (Join-Path $installRoot $name) -Destination (Join-Path $jni $name)
}
$normalizedLicenseBytes = [Text.UTF8Encoding]::new($false).GetBytes(
  [IO.File]::ReadAllText($license).Replace("`r`n", "`n")
)
[IO.File]::WriteAllBytes(
  (Join-Path $meta 'sherpa-ncnn-APACHE-2.0.txt'),
  $normalizedLicenseBytes
)
if ((Get-Sha256 $ncnnLicense) -ne '6495f972a09ad7f64ccd953e79adba91a93d862edc7135e6d95210bbf4002a01') {
  throw 'ncnn license text does not match the pinned dependency archive.'
}
Copy-Item -LiteralPath $ncnnLicense -Destination (Join-Path $meta 'ncnn-LICENSE.txt')
$manifest = '<?xml version="1.0" encoding="utf-8"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.k2fsa.sherpa.ncnn"><uses-sdk android:minSdkVersion="24" android:targetSdkVersion="36" /></manifest>'
[IO.File]::WriteAllText((Join-Path $stage 'aar\AndroidManifest.xml'), $manifest, [Text.UTF8Encoding]::new($false))
$sbom = [ordered]@{
  schemaVersion = 1
  source = [ordered]@{repository='https://github.com/k2-fsa/sherpa-ncnn'; commit='72ea103e9b2f56c052e7c400a8c965c143153f31'; archiveSha256='5912022479c7242e796e99800041fdd7115c78777126a6fb8a595078e88c03bb'}
  dependencies = @(
    [ordered]@{name='kaldi-native-fbank'; version='1.18.6'; sha256='6202a00cd06ba8ff89beb7b6f85cda34e073e94f25fc29e37c519bff0706bf19'; license='Apache-2.0'},
    [ordered]@{name='ncnn'; version='sherpa-1.1'; sha256='254aaedf8ad3e6baaa63bcd5d23e9673e3973d7cb2154c18e5c7743d45b4e160'; license='BSD-3-Clause AND BSD-2-Clause AND Zlib'}
  )
  target = [ordered]@{abi='arm64-v8a'; api=24; ndk='27.1.12297006'; cmake='3.22.1'; pageAlignment=16384; vulkan=$false}
  wrapper = [ordered]@{upstreamSha256='f3e47aedf2d668003a490073e455ae66d2d6b946ab318c6920c8df7b2d7a95d2'; patchSha256='ab711c3cf9a238cbf34c78c92d9ac234f784370ae5aedc8b98dac026a834804d'; patchedSha256='254cb6450e71108207bacdd4beb1f7a294c931bbf21f1ed0bb2fb81b25ce6ca5'}
}
$sbom | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $stage 'aar\META-INF\streaming-asr-sbom.json') -Encoding UTF8
if (Test-Path -LiteralPath $artifact) { Remove-Item -LiteralPath $artifact -Force }
Push-Location (Join-Path $stage 'aar')
try { & jar.exe --create --file $artifact --date $archiveDate AndroidManifest.xml classes.jar META-INF jni } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw 'AAR packaging failed.' }
Write-Output "AAR=$artifact"
Write-Output "AAR_SIZE=$((Get-Item $artifact).Length)"
Write-Output "AAR_SHA256=$(Get-Sha256 $artifact)"
Write-Output "CLASSES_JAR_SIZE=$((Get-Item $classesJar).Length)"
Write-Output "CLASSES_JAR_SHA256=$(Get-Sha256 $classesJar)"
