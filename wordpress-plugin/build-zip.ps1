# Build a POSIX-compatible zip of the agc-inventory plugin folder.
#
# PowerShell's Compress-Archive cmdlet writes zip entries using backslash
# path separators, which Linux PHP (WordPress, Playground, wp.com) treats
# as literal filename characters rather than directory separators. Result:
# WP sees a flat file `agc-inventory\agc-inventory.php` instead of a
# folder, and plugin activation fails with "plugin file does not exist".
#
# This script uses the .NET ZipArchive API directly to force forward
# slashes in entry names, producing a zip that unpacks correctly on any
# platform.

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$src = Join-Path $PSScriptRoot 'agc-inventory'
$zip = Join-Path $PSScriptRoot 'agc-inventory.zip'

if (Test-Path $zip) { Remove-Item $zip -Force }

$fs = [System.IO.File]::Open($zip, [System.IO.FileMode]::Create)
$archive = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)

try {
    Get-ChildItem -Recurse -File $src | ForEach-Object {
        $rel = $_.FullName.Substring($src.Length + 1) -replace '\\', '/'
        $entryName = 'agc-inventory/' + $rel
        $entry = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
        $stream = $entry.Open()
        try {
            $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
            $stream.Write($bytes, 0, $bytes.Length)
        } finally {
            $stream.Close()
        }
        Write-Output ("  + " + $entryName)
    }
} finally {
    $archive.Dispose()
    $fs.Close()
}

Write-Output ("Built: " + $zip)
