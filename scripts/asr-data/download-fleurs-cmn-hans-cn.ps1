[CmdletBinding()]
param(
  [string[]]$Split = @('validation'),
  [string]$DestinationRoot = '',
  [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($DestinationRoot)) {
  $baseDrive = if (Test-Path -LiteralPath 'E:\') { 'E:\' } else { 'D:\' }
  $DestinationRoot = Join-Path $baseDrive 'CodexData\Datasets\QingJiAI\fleurs-cmn-hans-cn\parquet'
}

$artifacts = @{
  validation = @{
    Bytes = 287985961L
    Sha256 = '18698ffdd46c36c54af641821684d3f0313a7b64e0a49615597ec61a98f2b57e'
  }
  test = @{
    Bytes = 695674033L
    Sha256 = '87c0aebbe183f3a36ac87b5c3421b6ab57036824744ff695029a3f858e7622fd'
  }
  train = @{
    Bytes = 2214262858L
    Sha256 = 'b7310d1e78afe209a1cbc40412d0de18a218ac614bbff0d2d1b87aba2c066b3d'
  }
}

$baseUrl = 'https://huggingface.co/datasets/google/fleurs/resolve/refs%2Fconvert%2Fparquet/cmn_hans_cn'
$requestedSplits = @(
  $Split |
    ForEach-Object { $_ -split ',' } |
    ForEach-Object { $_.Trim().ToLowerInvariant() } |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
)
$unknownSplits = @($requestedSplits | Where-Object { $_ -notin @('validation', 'test', 'train') })
if ($unknownSplits.Count -gt 0) {
  throw "Unknown FLEURS split(s): $($unknownSplits -join ', ')"
}

if (-not $VerifyOnly) {
  New-Item -ItemType Directory -Force -Path $DestinationRoot | Out-Null
}

$curl = Get-Command curl.exe -ErrorAction Stop

foreach ($name in $requestedSplits) {
  $artifact = $artifacts[$name]
  $path = Join-Path $DestinationRoot "$name-0000.parquet"
  $url = "$baseUrl/$name/0000.parquet"

  if (-not (Test-Path -LiteralPath $path)) {
    if ($VerifyOnly) {
      throw "Missing FLEURS split: $path"
    }
  } else {
    $existingBytes = (Get-Item -LiteralPath $path).Length
    if ($existingBytes -gt $artifact.Bytes) {
      throw "Existing file is larger than the locked size: $path ($existingBytes > $($artifact.Bytes))"
    }
  }

  if (-not $VerifyOnly -and ((-not (Test-Path -LiteralPath $path)) -or ((Get-Item -LiteralPath $path).Length -lt $artifact.Bytes))) {
    & $curl.Source -L --fail --retry 8 --retry-delay 3 --retry-all-errors --speed-limit 262144 --speed-time 90 --continue-at - --output $path $url
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

  Write-Output ("FLEURS_SPLIT_OK name={0} bytes={1} sha256={2} path={3}" -f $name, $actualBytes, $actualHash, $path)
}
