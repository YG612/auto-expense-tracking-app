[CmdletBinding()]
param(
  [switch]$VerifyOnly,
  [string]$CandidateModel = 'E:\CodexData\Models\QingJiAI\paraformer-compact-work\combined-safe\smallest-sensitivity-safe\model.int4.onnx',
  [string[]]$AdditionalModels = @(
    'D:\CodexData\Caches\QingJiAI\sherpa-onnx-paraformer-small\sherpa-onnx-paraformer-zh-small-2024-03-09\model.int8.onnx',
    'E:\CodexData\Models\QingJiAI\paraformer-compact-work\hqq-safe\model.hqq-int4.onnx',
    'E:\CodexData\Models\QingJiAI\paraformer-compact-work\asym-candidates\model.candidate1_ffn.int4.onnx',
    'E:\CodexData\Models\QingJiAI\paraformer-compact-work\asym-candidates\model.candidate2_ffn_decoder.int4.onnx',
    'E:\CodexData\Models\QingJiAI\paraformer-compact-work\asym-candidates\model.candidate3_ffn_decoder_attention.int4.onnx'
  ),
  [string]$SherpaSource = 'E:\CodexData\Sources\QingJiAI\sherpa-onnx-1.13.2',
  [string]$OnnxRuntimeSource = 'E:\CodexData\Sources\QingJiAI\onnxruntime-1.24.4',
  [string]$WorkDirectory = 'E:\CodexData\Models\QingJiAI\paraformer-compact-work\runtime',
  [string]$AndroidSdk = 'D:\Android_SDK',
  [string]$AndroidNdk = 'D:\Android_SDK\ndk\27.1.12297006',
  [string]$Python = 'E:\CodexData\Envs\QingJiAI\paraformer-compact\python.exe',
  [string]$BaselineAar = 'D:\CodexData\Caches\QingJiAI\sherpa-onnx-paraformer-small\artifacts\qingji-sherpa-onnx-arm64-1.13.2.aar'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$destination = Join-Path $projectRoot 'android\app\src\streamingOnnxParaformerCompact\libs\qingji-sherpa-onnx-arm64-compact.aar'
$operatorConfig = Join-Path $WorkDirectory 'required_operators.config'
$runtimeLicense = Join-Path $WorkDirectory 'runtime-LICENSE.txt'
$safeJniPatch = Join-Path $projectRoot 'scripts\patches\sherpa-onnx-1.13.2-offline-recognizer-safe-jni.patch'
$maximumAarBytes = 9MB
$readelf = Join-Path $AndroidNdk 'toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-readelf.exe'
$strip = Join-Path $AndroidNdk 'toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-strip.exe'

function Assert-File([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Label is missing: $Path" }
}

function Assert-ElfAlignment([string]$Path) {
  Assert-File $readelf 'Android NDK llvm-readelf'
  $headers = @(& $readelf -lW $Path)
  if ($LASTEXITCODE -ne 0) { throw "Unable to inspect ELF program headers: $Path" }
  $loads = @($headers | Where-Object { $_ -match '^\s*LOAD\s' })
  if ($loads.Count -eq 0) { throw "ELF has no LOAD segments: $Path" }
  foreach ($line in $loads) {
    if ($line -notmatch '\s(0x[0-9a-fA-F]+)\s*$') { throw "Cannot parse ELF LOAD alignment: $line" }
    if ([Convert]::ToInt64($Matches[1].Substring(2), 16) -lt 0x4000) {
      throw "ELF LOAD segment is not 16 KiB aligned: $Path :: $line"
    }
  }
}

function Inspect-Aar([string]$Path) {
  Assert-File $Path 'Compact runtime AAR'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($Path)
  try {
    $names = @($archive.Entries | ForEach-Object FullName)
    foreach ($required in @(
      'classes.jar',
      'jni/arm64-v8a/libonnxruntime.so',
      'jni/arm64-v8a/libsherpa-onnx-jni.so'
    )) {
      if ($required -notin $names) { throw "Compact AAR is missing $required." }
    }
    $forbidden = @($names | Where-Object {
      $_ -match '^jni/(armeabi-v7a|x86|x86_64)/' -or
      $_ -match 'libsherpa-onnx-(c-api|cxx-api)\.so$'
    })
    if ($forbidden.Count -gt 0) { throw "Compact AAR contains forbidden payload: $($forbidden -join ', ')" }
    $inspectionRoot = Join-Path $WorkDirectory ("alignment-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $inspectionRoot | Out-Null
    try {
      foreach ($libraryName in @('libonnxruntime.so', 'libsherpa-onnx-jni.so')) {
        $entry = $archive.GetEntry("jni/arm64-v8a/$libraryName")
        $extracted = Join-Path $inspectionRoot $libraryName
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $extracted, $true)
        Assert-ElfAlignment $extracted
      }
    } finally {
      [IO.Directory]::Delete($inspectionRoot, $true)
    }
  } finally {
    $archive.Dispose()
  }
  $size = (Get-Item -LiteralPath $Path).Length
  if ($size -gt $maximumAarBytes) { throw "Compact AAR exceeds 9 MiB: $size bytes." }
  [ordered]@{
    sizeBytes = $size
    sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

if ($VerifyOnly) {
  $inspection = Inspect-Aar $destination
  Write-Output 'PARAFORMER_COMPACT_RUNTIME=VERIFIED'
  Write-Output "PARAFORMER_COMPACT_RUNTIME_SIZE=$($inspection.sizeBytes)"
  Write-Output "PARAFORMER_COMPACT_RUNTIME_SHA256=$($inspection.sha256)"
  exit 0
}

Assert-File $CandidateModel 'Promoted compact model'
foreach ($model in $AdditionalModels) { Assert-File $model 'Additional model-lab model' }
Assert-File $Python 'Pinned Python'
Assert-File $BaselineAar 'Baseline Java-wrapper AAR'
Assert-File (Join-Path $OnnxRuntimeSource 'tools\ci_build\build.py') 'ONNX Runtime build driver'
Assert-File (Join-Path $OnnxRuntimeSource 'tools\python\create_reduced_build_config.py') 'Operator-config generator'
Assert-File (Join-Path $SherpaSource 'CMakeLists.txt') 'sherpa-onnx source'
Assert-File $safeJniPatch 'sherpa-onnx safe JNI patch'
$toolchain = Join-Path $AndroidNdk 'build\cmake\android.toolchain.cmake'
Assert-File $toolchain 'Android NDK toolchain'
Assert-File $readelf 'Android NDK llvm-readelf'
Assert-File $strip 'Android NDK llvm-strip'

$offlineRecognizerJni = Join-Path $SherpaSource 'sherpa-onnx\jni\offline-recognizer.cc'
Assert-File $offlineRecognizerJni 'sherpa-onnx offline recognizer JNI source'
if (-not (Select-String -LiteralPath $offlineRecognizerJni -SimpleMatch 'env, "OfflineRecognizer_newFromFile"' -Quiet)) {
  & git.exe -C $SherpaSource apply --check $safeJniPatch
  if ($LASTEXITCODE -ne 0) { throw 'Pinned sherpa-onnx safe JNI patch no longer applies.' }
  & git.exe -C $SherpaSource apply $safeJniPatch
  if ($LASTEXITCODE -ne 0) { throw 'Unable to apply sherpa-onnx safe JNI patch.' }
}
if (-not (Select-String -LiteralPath $offlineRecognizerJni -SimpleMatch 'env, "OfflineRecognizer_newFromFile"' -Quiet)) {
  throw 'sherpa-onnx OfflineRecognizer JNI constructor is not exception-safe.'
}

$toolScripts = Join-Path (Split-Path -Parent $Python) 'Scripts'
$cmake = Join-Path $toolScripts 'cmake.exe'
$ninja = Join-Path $toolScripts 'ninja.exe'
Assert-File $cmake 'Pinned CMake 3.28 or newer'
Assert-File $ninja 'Pinned Ninja'
New-Item -ItemType Directory -Force -Path $WorkDirectory | Out-Null
if ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq [Runtime.InteropServices.Architecture]::X64) {
  # This Codex host starts without Windows' usual PROCESSOR_ARCHITECTURE
  # variable. Python and CMake otherwise report an empty host architecture
  # and select the nonexistent NDK prebuilt/windows directory.
  $env:PROCESSOR_ARCHITECTURE = 'AMD64'
}

$operatorModelDirectory = Join-Path $WorkDirectory 'operator-model-inputs'
New-Item -ItemType Directory -Force -Path $operatorModelDirectory | Out-Null
Get-ChildItem -LiteralPath $operatorModelDirectory -File -ErrorAction SilentlyContinue | Remove-Item -Force
$operatorModels = @($CandidateModel) + @($AdditionalModels)
for ($modelIndex = 0; $modelIndex -lt $operatorModels.Count; $modelIndex++) {
  Copy-Item -LiteralPath $operatorModels[$modelIndex] -Destination (Join-Path $operatorModelDirectory ("model-{0}.onnx" -f $modelIndex)) -Force
}
try {
  & $Python (Join-Path $OnnxRuntimeSource 'tools\python\create_reduced_build_config.py') $operatorModelDirectory $operatorConfig
  if ($LASTEXITCODE -ne 0) { throw 'Unable to generate model-lab required-operator config.' }
} finally {
  $resolvedOperatorModels = [IO.Path]::GetFullPath($operatorModelDirectory)
  $resolvedWorkDirectory = [IO.Path]::GetFullPath($WorkDirectory).TrimEnd('\') + '\'
  if (-not $resolvedOperatorModels.StartsWith($resolvedWorkDirectory, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to remove an unsafe operator-model staging path.'
  }
  [IO.Directory]::Delete($resolvedOperatorModels, $true)
}

# create_reduced_build_config.py inspects the source graph only. ONNX Runtime
# can resolve standard operators through ONNX function bodies and can introduce
# helper nodes while optimizing Paraformer's control-flow subgraphs. Those
# nodes are absent from the input file, but their kernels must still exist while
# the session is being initialized. Keep this closure explicit and auditable so
# regenerating the config cannot silently remove it.
$runtimeHelperOperators = @(
  'CastLike',
  'Ceil',
  'Clip',
  'Flatten',
  'Greater',
  'Max',
  'Min',
  'Or',
  'QuantizeLinear',
  'ReduceMin',
  'Round',
  'Size'
)
$runtimeHelperContribOperators = @(
  'DynamicQuantizeMatMul',
  'FusedConv',
  'FusedMatMul',
  'MatMulIntegerToFloat',
  'SkipLayerNormalization'
)
$operatorConfigLines = @([IO.File]::ReadAllLines($operatorConfig, [Text.Encoding]::UTF8))
$onnxOperatorLineIndexes = @()
for ($lineIndex = 0; $lineIndex -lt $operatorConfigLines.Count; $lineIndex++) {
  if ($operatorConfigLines[$lineIndex].StartsWith('ai.onnx;', [StringComparison]::Ordinal)) {
    $onnxOperatorLineIndexes += $lineIndex
  }
}
if ($onnxOperatorLineIndexes.Count -eq 0) {
  throw 'Required-operator config is missing ai.onnx entries.'
}
foreach ($onnxOperatorLineIndex in $onnxOperatorLineIndexes) {
  $onnxOperatorParts = $operatorConfigLines[$onnxOperatorLineIndex].Split(';', 3)
  $onnxOperators = @($onnxOperatorParts[2].Split(',') + $runtimeHelperOperators | Sort-Object -Unique)
  $operatorConfigLines[$onnxOperatorLineIndex] = "$($onnxOperatorParts[0]);$($onnxOperatorParts[1]);$($onnxOperators -join ',')"
}
$contribOperatorLineIndex = -1
for ($lineIndex = 0; $lineIndex -lt $operatorConfigLines.Count; $lineIndex++) {
  if ($operatorConfigLines[$lineIndex].StartsWith('com.microsoft;1;', [StringComparison]::Ordinal)) {
    $contribOperatorLineIndex = $lineIndex
    break
  }
}
if ($contribOperatorLineIndex -lt 0) { throw 'Required-operator config is missing com.microsoft opset 1.' }
$contribOperatorParts = $operatorConfigLines[$contribOperatorLineIndex].Split(';', 3)
$contribOperators = @($contribOperatorParts[2].Split(',') + $runtimeHelperContribOperators | Sort-Object -Unique)
$operatorConfigLines[$contribOperatorLineIndex] = "com.microsoft;1;$($contribOperators -join ',')"
$operatorConfigLines += 'ai.onnx;17;LayerNormalization'
[IO.File]::WriteAllLines($operatorConfig, $operatorConfigLines, [Text.UTF8Encoding]::new($false))

foreach ($helperOperator in $runtimeHelperOperators) {
  if (-not ($onnxOperatorLineIndexes | Where-Object { $operatorConfigLines[$_].Split(';', 3)[2].Split(',') -contains $helperOperator })) {
    throw "Required-operator config is missing runtime helper $helperOperator."
  }
}
foreach ($contribOperator in @('MatMulNBits') + $runtimeHelperContribOperators) {
  if (-not ($contribOperators -contains $contribOperator)) {
    throw "Required-operator config is missing contrib operator $contribOperator."
  }
}
if (-not ($operatorConfigLines -contains 'ai.onnx;17;LayerNormalization')) {
  throw 'Required-operator config is missing optimizer-generated LayerNormalization.'
}

$ortBuild = Join-Path $WorkDirectory 'onnxruntime-build-x64host'
$env:PATH = "$(Split-Path -Parent $cmake);$env:PATH"
& $Python (Join-Path $OnnxRuntimeSource 'tools\ci_build\build.py') `
  --config MinSizeRel `
  --build_dir $ortBuild `
  --cmake_generator Ninja `
  --cmake_path $cmake `
  --cmake_extra_defines CMAKE_HOST_SYSTEM_PROCESSOR=AMD64 `
  --update --build --parallel 4 --targets onnxruntime --skip_tests --skip_submodule_sync `
  --android --android_abi arm64-v8a --android_api 24 `
  --android_sdk_path $AndroidSdk --android_ndk_path $AndroidNdk `
  --build_shared_lib --include_ops_by_config $operatorConfig `
  --disable_ml_ops --disable_types float4 float8 optional sparsetensor
if ($LASTEXITCODE -ne 0) { throw 'Custom ONNX Runtime Android build failed.' }

$ortLibrary = Get-ChildItem -LiteralPath $ortBuild -Filter libonnxruntime.so -Recurse |
  Where-Object { $_.FullName -match 'MinSizeRel' } |
  Sort-Object Length |
  Select-Object -First 1
if ($null -eq $ortLibrary) { throw 'Custom ONNX Runtime shared library was not produced.' }

$sherpaBuild = Join-Path $WorkDirectory 'sherpa-build'
$sherpaInstall = Join-Path $sherpaBuild 'install'
$env:SHERPA_ONNXRUNTIME_LIB_DIR = $ortLibrary.DirectoryName
$env:SHERPA_ONNXRUNTIME_INCLUDE_DIR = Join-Path $OnnxRuntimeSource 'include\onnxruntime\core\session'
& $cmake -S $SherpaSource -B $sherpaBuild -G Ninja `
  "-DCMAKE_MAKE_PROGRAM=$ninja" `
  "-DCMAKE_TOOLCHAIN_FILE=$toolchain" `
  '-DCMAKE_BUILD_TYPE=MinSizeRel' "-DCMAKE_INSTALL_PREFIX=$sherpaInstall" `
  '-DANDROID_ABI=arm64-v8a' '-DANDROID_PLATFORM=android-24' `
  '-DBUILD_SHARED_LIBS=ON' `
  '-DSHERPA_ONNX_USE_PRE_INSTALLED_ONNXRUNTIME_IF_AVAILABLE=ON' `
  '-DSHERPA_ONNX_ENABLE_JNI=ON' '-DSHERPA_ONNX_ENABLE_C_API=OFF' `
  '-DSHERPA_ONNX_ENABLE_TTS=OFF' '-DSHERPA_ONNX_ENABLE_SPEAKER_DIARIZATION=OFF' `
  '-DSHERPA_ONNX_ENABLE_BINARY=OFF' '-DSHERPA_ONNX_ENABLE_TESTS=OFF' `
  '-DSHERPA_ONNX_ENABLE_CHECK=OFF' '-DSHERPA_ONNX_ENABLE_PORTAUDIO=OFF' `
  '-DSHERPA_ONNX_ENABLE_WEBSOCKET=OFF' '-DSHERPA_ONNX_ENABLE_PYTHON=OFF' `
  '-DSHERPA_ONNX_ENABLE_RKNN=OFF' '-DSHERPA_ONNX_ENABLE_QNN=OFF'
if ($LASTEXITCODE -ne 0) { throw 'sherpa-onnx Android configuration failed.' }
& $cmake --build $sherpaBuild --target install --parallel 4
if ($LASTEXITCODE -ne 0) { throw 'sherpa-onnx Android build failed.' }

$jniLibrary = Get-ChildItem -LiteralPath $sherpaBuild -Filter libsherpa-onnx-jni.so -Recurse |
  Sort-Object Length |
  Select-Object -First 1
if ($null -eq $jniLibrary) { throw 'sherpa-onnx JNI library was not produced.' }

$packagingLibraryRoot = Join-Path $WorkDirectory 'packaging-libs'
New-Item -ItemType Directory -Force -Path $packagingLibraryRoot | Out-Null
$packagedOrtLibrary = Join-Path $packagingLibraryRoot 'libonnxruntime.so'
$packagedJniLibrary = Join-Path $packagingLibraryRoot 'libsherpa-onnx-jni.so'
[IO.File]::Copy($ortLibrary.FullName, $packagedOrtLibrary, $true)
[IO.File]::Copy($jniLibrary.FullName, $packagedJniLibrary, $true)
foreach ($library in @($packagedOrtLibrary, $packagedJniLibrary)) {
  & $strip --strip-unneeded $library
  if ($LASTEXITCODE -ne 0) { throw "Unable to strip release symbols: $library" }
  Assert-ElfAlignment $library
}

$licenseParts = @(
  (Join-Path $OnnxRuntimeSource 'LICENSE')
  (Join-Path $SherpaSource 'LICENSE')
)
foreach ($license in $licenseParts) { Assert-File $license 'Runtime license' }
$licenseText = @(
  'ONNX Runtime v1.24.4',
  (Get-Content -LiteralPath $licenseParts[0] -Raw -Encoding UTF8),
  'sherpa-onnx v1.13.2',
  (Get-Content -LiteralPath $licenseParts[1] -Raw -Encoding UTF8)
) -join "`r`n`r`n"
[IO.File]::WriteAllText($runtimeLicense, $licenseText, [Text.UTF8Encoding]::new($false))

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$baselineArchive = [IO.Compression.ZipFile]::OpenRead($BaselineAar)
$classesEntry = $baselineArchive.GetEntry('classes.jar')
if ($null -eq $classesEntry) { $baselineArchive.Dispose(); throw 'Baseline AAR is missing classes.jar.' }
$staging = Join-Path $WorkDirectory ("aar-staging-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $staging | Out-Null
try {
  $classesPath = Join-Path $staging 'classes.jar'
  [IO.Compression.ZipFileExtensions]::ExtractToFile($classesEntry, $classesPath, $true)
  $baselineArchive.Dispose()
  $manifestPath = Join-Path $staging 'AndroidManifest.xml'
  [IO.File]::WriteAllText(
    $manifestPath,
    '<?xml version="1.0" encoding="utf-8"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.k2fsa.sherpa.onnx"><uses-sdk android:minSdkVersion="24" /></manifest>',
    [Text.UTF8Encoding]::new($false)
  )
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
  $temporaryAar = Join-Path $WorkDirectory 'qingji-sherpa-onnx-arm64-compact.aar.tmp'
  if (Test-Path -LiteralPath $temporaryAar) { [IO.File]::Delete($temporaryAar) }
  $stream = [IO.File]::Open($temporaryAar, [IO.FileMode]::CreateNew)
  $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
  try {
    foreach ($item in @(
      @($manifestPath, 'AndroidManifest.xml'),
      @($classesPath, 'classes.jar'),
      @($packagedOrtLibrary, 'jni/arm64-v8a/libonnxruntime.so'),
      @($packagedJniLibrary, 'jni/arm64-v8a/libsherpa-onnx-jni.so')
    )) {
      $entry = $archive.CreateEntry($item[1], [IO.Compression.CompressionLevel]::Optimal)
      $entry.LastWriteTime = [DateTimeOffset]::new(2024, 3, 9, 0, 0, 0, [TimeSpan]::Zero)
      $input = [IO.File]::OpenRead($item[0])
      $output = $entry.Open()
      try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
    }
  } finally { $archive.Dispose(); $stream.Dispose() }
  [IO.File]::Copy($temporaryAar, $destination, $true)
} finally {
  if ($baselineArchive) { $baselineArchive.Dispose() }
  if (Test-Path -LiteralPath $staging) {
    $resolved = [IO.Path]::GetFullPath($staging)
    if (-not $resolved.StartsWith("$([IO.Path]::GetFullPath($WorkDirectory).TrimEnd('\'))\", [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Refusing to remove an unsafe runtime staging path.'
    }
    [IO.Directory]::Delete($resolved, $true)
  }
}

$inspection = Inspect-Aar $destination
Write-Output 'PARAFORMER_COMPACT_RUNTIME=BUILT'
Write-Output "PARAFORMER_COMPACT_RUNTIME_SIZE=$($inspection.sizeBytes)"
Write-Output "PARAFORMER_COMPACT_RUNTIME_SHA256=$($inspection.sha256)"
Write-Output "PARAFORMER_COMPACT_REQUIRED_OPERATORS_SHA256=$((Get-FileHash -LiteralPath $operatorConfig -Algorithm SHA256).Hash.ToLowerInvariant())"
