[CmdletBinding()]
param(
  [string[]]$Corpus = @('aishell1', 'thchs30'),
  [string]$DestinationRoot = '',
  [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($DestinationRoot)) {
  $baseDrive = if (Test-Path -LiteralPath 'E:\') { 'E:\' } else { 'D:\' }
  $DestinationRoot = Join-Path $baseDrive 'CodexData\Datasets\QingJiAI'
}

$artifacts = @{
  aishell1 = @{
    Directory = 'openslr-33-aishell1'
    FileName = 'data_aishell.tgz'
    Url = 'https://www.openslr.org/resources/33/data_aishell.tgz'
    Bytes = 15582913665L
    Sha256 = 'a4a0313cde0a933e0e01a451f77de0a23d6c942f4694af5bb7f40b9dc38143fe'
  }
  thchs30 = @{
    Directory = 'openslr-18-thchs30'
    FileName = 'data_thchs30.tgz'
    Url = 'https://www.openslr.org/resources/18/data_thchs30.tgz'
    Bytes = 6453425169L
    Sha256 = '87e9231726af43b8ada6f84d2870fec4ebb23cb730439adbaacdc1dee77dbd1e'
  }
  'thchs30-noise' = @{
    Directory = 'openslr-18-thchs30'
    FileName = 'test-noise.tgz'
    Url = 'https://www.openslr.org/resources/18/test-noise.tgz'
    Bytes = 1971460210L
    Sha256 = 'e1e7a9135754fd691f264e9d4e055a0507ff9ccd9061d45900f93a390138a418'
  }
}

$requestedCorpora = @(
  $Corpus |
    ForEach-Object { $_ -split ',' } |
    ForEach-Object { $_.Trim().ToLowerInvariant() } |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
)
$unknownCorpora = @($requestedCorpora | Where-Object { -not $artifacts.ContainsKey($_) })
if ($unknownCorpora.Count -gt 0) {
  throw "Unknown OpenSLR corpus artifact(s): $($unknownCorpora -join ', ')"
}

$curl = Get-Command curl.exe -ErrorAction Stop

foreach ($name in $requestedCorpora) {
  $artifact = $artifacts[$name]
  $directory = Join-Path $DestinationRoot $artifact.Directory
  $path = Join-Path $directory $artifact.FileName

  if (-not $VerifyOnly) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
  }

  if (-not (Test-Path -LiteralPath $path)) {
    if ($VerifyOnly) {
      throw "Missing OpenSLR speech archive: $path"
    }
  } else {
    $existingBytes = (Get-Item -LiteralPath $path).Length
    if ($existingBytes -gt $artifact.Bytes) {
      throw "Existing file is larger than the locked size: $path ($existingBytes > $($artifact.Bytes))"
    }
  }

  if (-not $VerifyOnly -and ((-not (Test-Path -LiteralPath $path)) -or ((Get-Item -LiteralPath $path).Length -lt $artifact.Bytes))) {
    & $curl.Source -L --fail --retry 8 --retry-delay 3 --retry-all-errors --speed-limit 262144 --speed-time 90 --continue-at - --output $path $artifact.Url
    if ($LASTEXITCODE -ne 0) {
      throw "curl failed for $name with exit code $LASTEXITCODE"
    }
  }

  $actualBytes = (Get-Item -LiteralPath $path).Length
  if ($actualBytes -ne $artifact.Bytes) {
    throw "Size mismatch for ${name}: expected $($artifact.Bytes), got $actualBytes"
  }

  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
  if (-not [string]::IsNullOrWhiteSpace($artifact.Sha256) -and $actualHash -ne $artifact.Sha256) {
    throw "SHA-256 mismatch for ${name}: expected $($artifact.Sha256), got $actualHash"
  }

  Write-Output ("OPENSLR_SPEECH_OK name={0} bytes={1} sha256={2} path={3}" -f $name, $actualBytes, $actualHash, $path)
}
