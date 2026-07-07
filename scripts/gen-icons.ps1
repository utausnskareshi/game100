# Regenerates the smaller PWA icons from the master icon (public/icons/icon-512.png).
# The app icon is a provided image; icon-512.png (512x512) is the committed master.
# To change the icon: replace icon-512.png with the new 512x512 design and re-run:
#   powershell -ExecutionPolicy Bypass -File scripts/gen-icons.ps1
# NOTE: keep this file ASCII-only (PowerShell 5.1 misreads UTF-8 without BOM).
Add-Type -AssemblyName System.Drawing

$dir = Join-Path $PSScriptRoot '..\public\icons'
$masterPath = Join-Path $dir 'icon-512.png'
$bg = [System.Drawing.Color]::FromArgb(255, 18, 20, 43)  # #12142b app background/theme

$master = [System.Drawing.Bitmap]::FromFile($masterPath)
$srcRect = New-Object System.Drawing.Rectangle(0, 0, $master.Width, $master.Height)

function Save-Icon {
    param([int]$Size, [string]$Name, [double]$ContentScale)
    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear($bg)
    $draw = [int][Math]::Round($Size * $ContentScale)
    $off = [int][Math]::Round(($Size - $draw) / 2.0)
    $dest = New-Object System.Drawing.Rectangle($off, $off, $draw, $draw)
    $g.DrawImage($master, $dest, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    $bmp.Save((Join-Path $dir $Name), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "generated $Name"
}

# maskable is inset (0.82) so key content stays within the mask safe zone; others full-bleed.
Save-Icon -Size 192 -Name 'icon-192.png'         -ContentScale 1.0
Save-Icon -Size 180 -Name 'apple-touch-icon.png' -ContentScale 1.0
Save-Icon -Size 32  -Name 'favicon-32.png'       -ContentScale 1.0
Save-Icon -Size 512 -Name 'maskable-512.png'     -ContentScale 0.82

$master.Dispose()
Write-Output "done (icon-512.png is the master; not regenerated here)"
