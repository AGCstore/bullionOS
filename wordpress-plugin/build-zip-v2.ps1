# One-off: build a zip whose internal folder is `agc-inventory-v2/`
# instead of `agc-inventory/`. Lets WP install it alongside a stuck
# `agc-inventory/` folder on hosts where the latter can't be deleted
# (wp.com Atomic sometimes restores the folder after a delete).
#
# Same plugin code, same plugin slug seen by WP once activated — but
# the on-disk folder is fresh, so there's no "Destination folder
# already exists" error.

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$src = Join-Path $PSScriptRoot 'agc-inventory'
$zip = Join-Path $PSScriptRoot 'agc-inventory-v2.zip'

if (Test-Path $zip) { Remove-Item $zip -Force }

$fs = [System.IO.File]::Open($zip, [System.IO.FileMode]::Create)
$archive = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)

try {
    Get-ChildItem -Recurse -File $src | ForEach-Object {
        $rel = $_.FullName.Substring($src.Length + 1) -replace '\\', '/'
        $entry = $archive.CreateEntry('agc-inventory-v2/' + $rel, [System.IO.Compression.CompressionLevel]::Optimal)
        $stream = $entry.Open()
        try {
            $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
            $stream.Write($bytes, 0, $bytes.Length)
        } finally {
            $stream.Close()
        }
        Write-Output ("  + agc-inventory-v2/" + $rel)
    }
} finally {
    $archive.Dispose()
    $fs.Close()
}

Write-Output ("Built: " + $zip)
