[CmdletBinding()]
param(
  [string]$CacheRoot = 'D:\CodexData\Caches\QingJiAI\streaming-asr',
  [string]$AndroidSdk = 'D:\CodexData\Android\Sdk'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# This builder is network-free. The three archives must be acquired separately
# from the pinned URLs in streaming-asr-lock.json and must match these hashes.
$sourceArchive = Join-Path $CacheRoot 'sources\sherpa-ncnn-72ea103e9b2f56c052e7c400a8c965c143153f31.zip'
$kaldiArchive = Join-Path $CacheRoot 'dependencies\kaldi-native-fbank-1.18.6.tar.gz'
$ncnnArchive = Join-Path $CacheRoot 'dependencies\ncnn-sherpa-1.1.tar.gz'
$workRoot = Join-Path $CacheRoot 'build-v2.1.7-arm64'
$sourceRoot = Join-Path $workRoot 'source'
$dependencyRoot = Join-Path $workRoot 'dependencies'
$buildRoot = Join-Path $workRoot 'build'
$installRoot = Join-Path $workRoot 'install'
$ndk = Join-Path $AndroidSdk 'ndk\27.1.12297006'
$cmake = Join-Path $AndroidSdk 'cmake\3.22.1\bin\cmake.exe'
$ninja = Join-Path $AndroidSdk 'cmake\3.22.1\bin\ninja.exe'
$readelf = Join-Path $ndk 'toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-readelf.exe'

function Get-Sha256([string]$Path) {
  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Assert-Archive([string]$Path, [string]$Sha256) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing archive: $Path" }
  if ((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw "Archive must not be a reparse point: $Path"
  }
  if ((Get-Sha256 $Path) -ne $Sha256) { throw "Archive SHA-256 mismatch: $Path" }
}
function Remove-Safe([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $full = [IO.Path]::GetFullPath($Path)
  $root = [IO.Path]::GetFullPath($workRoot).TrimEnd('\') + '\'
  if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove outside the runtime build root: $full"
  }
  Remove-Item -LiteralPath $full -Recurse -Force
}
function Expand-Safe([string]$Archive, [string]$Destination, [string[]]$AllowedLinks = @()) {
  $entries = @(& tar.exe -tf $Archive)
  if ($LASTEXITCODE -ne 0 -or $entries.Count -eq 0) { throw "Cannot list $Archive" }
  $unsafe = @($entries | Where-Object {
    $_ -match '(^|/)\.\.(/|$)' -or $_ -match '^[A-Za-z]:' -or $_.StartsWith('/') -or $_.StartsWith('\')
  })
  if ($unsafe.Count -gt 0) { throw "Unsafe archive paths: $($unsafe -join ', ')" }
  $verbose = @(& tar.exe -tvf $Archive)
  $special = @($verbose | Where-Object { -not $_.StartsWith('-') -and -not $_.StartsWith('d') })
  $unexpected = @($special | Where-Object {
    $line = $_
    -not ($AllowedLinks | Where-Object { $line -match $_ })
  })
  if ($unexpected.Count -gt 0) { throw "Archive links/special files are forbidden: $unexpected" }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  if ($AllowedLinks.Count -gt 0) {
    & tar.exe -xf $Archive -C $Destination --exclude '*/.github/*'
  } else {
    & tar.exe -xf $Archive -C $Destination
  }
  if ($LASTEXITCODE -ne 0) { throw "Cannot extract $Archive" }
  $reparse = @(Get-ChildItem -LiteralPath $Destination -Recurse -Force | Where-Object {
    $_.Attributes -band [IO.FileAttributes]::ReparsePoint
  })
  if ($reparse.Count -gt 0) { throw "Extracted reparse points are forbidden: $($reparse.FullName)" }
}

Assert-Archive $sourceArchive '5912022479c7242e796e99800041fdd7115c78777126a6fb8a595078e88c03bb'
Assert-Archive $kaldiArchive '6202a00cd06ba8ff89beb7b6f85cda34e073e94f25fc29e37c519bff0706bf19'
Assert-Archive $ncnnArchive '254aaedf8ad3e6baaa63bcd5d23e9673e3973d7cb2154c18e5c7743d45b4e160'
foreach ($tool in @($cmake, $ninja, $readelf)) {
  if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw "Missing build tool: $tool" }
}
Remove-Safe $sourceRoot
Remove-Safe $dependencyRoot
Remove-Safe $buildRoot
Remove-Safe $installRoot
Expand-Safe $sourceArchive $sourceRoot @(
  '/\.github/scripts/SherpaNcnn\.kt -> \.\./\.\./android/',
  '/\.github/scripts/WaveReader\.kt -> \.\./\.\./android/'
)
Expand-Safe $kaldiArchive (Join-Path $dependencyRoot 'kaldi')
Expand-Safe $ncnnArchive (Join-Path $dependencyRoot 'ncnn')
$source = (Get-ChildItem -LiteralPath $sourceRoot -Directory | Select-Object -First 1).FullName
$kaldi = (Get-ChildItem -LiteralPath (Join-Path $dependencyRoot 'kaldi') -Directory | Select-Object -First 1).FullName
$ncnn = (Get-ChildItem -LiteralPath (Join-Path $dependencyRoot 'ncnn') -Directory | Select-Object -First 1).FullName

$sourceDenylist = @('tts', 'piper', 'espeak', 'sensevoice', 'sense-voice', 'diarization')
$forbiddenPaths = @(Get-ChildItem -LiteralPath $source -Recurse -Force | Where-Object {
  $candidate = $_.FullName.ToLowerInvariant()
  $sourceDenylist | Where-Object { $candidate.Contains($_) }
})
if ($forbiddenPaths.Count -gt 0) { throw "Forbidden source features found: $($forbiddenPaths.FullName)" }

& $cmake -S $source -B $buildRoot -G Ninja `
  "-DCMAKE_MAKE_PROGRAM=$ninja" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON `
  -DSHERPA_NCNN_ENABLE_PORTAUDIO=OFF -DSHERPA_NCNN_ENABLE_BINARY=OFF `
  -DSHERPA_NCNN_ENABLE_TEST=OFF -DSHERPA_NCNN_ENABLE_C_API=OFF `
  -DSHERPA_NCNN_ENABLE_GENERATE_INT8_SCALE_TABLE=OFF -DSHERPA_NCNN_ENABLE_JNI=ON `
  -DNCNN_VULKAN=OFF "-DCMAKE_TOOLCHAIN_FILE=$(Join-Path $ndk 'build\cmake\android.toolchain.cmake')" `
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-24 -DANDROID_STL=c++_shared `
  "-DCMAKE_INSTALL_PREFIX=$installRoot" `
  '-DCMAKE_SHARED_LINKER_FLAGS=-Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384' `
  -DFETCHCONTENT_FULLY_DISCONNECTED=ON `
  "-DFETCHCONTENT_SOURCE_DIR_KALDI_NATIVE_FBANK=$($kaldi.Replace('\','/'))" `
  "-DFETCHCONTENT_SOURCE_DIR_NCNN=$($ncnn.Replace('\','/'))"
if ($LASTEXITCODE -ne 0) { throw 'sherpa-ncnn CMake configuration failed.' }
& $cmake --build $buildRoot --target install --config Release --parallel 4
if ($LASTEXITCODE -ne 0) { throw 'sherpa-ncnn arm64 build failed.' }

$expected = @(
  'libkaldi-native-fbank-core.so', 'libncnn.so',
  'libsherpa-ncnn-core.so', 'libsherpa-ncnn-jni.so'
)
$actual = @(Get-ChildItem -LiteralPath (Join-Path $installRoot 'lib') -Filter '*.so' | ForEach-Object Name)
$libraryDifference = @(Compare-Object $expected $actual)
if ($libraryDifference.Count -ne 0) { throw "Unexpected native library set: $actual" }
$forbiddenMarkers = @('OfflineTts','GeneratedAudio','Piper','espeak','SpeakerDiarization','WebSocket','libcurl','libssl','libcrypto','SenseVoice')
foreach ($name in $expected) {
  $so = Join-Path (Join-Path $installRoot 'lib') $name
  $programHeaders = @(& $readelf -lW $so)
  $alignments = @($programHeaders | Where-Object { $_ -match '^\s*LOAD\s+' } | ForEach-Object {
    if ($_ -notmatch '\s(0x[0-9a-fA-F]+)\s*$') { throw "Cannot parse ELF LOAD alignment: $_" }
    [Convert]::ToInt64($Matches[1], 16)
  })
  if ($alignments.Count -eq 0 -or ($alignments | Measure-Object -Minimum).Minimum -lt 16384) {
    throw "$name is not 16KB page aligned."
  }
  $ascii = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($so))
  $hits = @($forbiddenMarkers | Where-Object { $ascii.Contains($_) })
  if ($hits.Count -gt 0) { throw "$name contains forbidden markers: $hits" }
  Write-Output "$name SIZE=$((Get-Item $so).Length) SHA256=$(Get-Sha256 $so) ALIGN=16384"
}
Write-Output "RUNTIME_INSTALL_ROOT=$installRoot"
