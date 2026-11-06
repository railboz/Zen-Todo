# Génère les PNG du logo Zen Todo (lune + coche) : logo-512, logo-256, logo-120.
# Le 120 sert pour le logo de la Google Auth Platform (minimum 120x120).
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

# Palette (identique au site et a l'extension)
$c1 = [System.Drawing.Color]::FromArgb(109, 90, 230)   # #6D5AE6 (haut)
$c2 = [System.Drawing.Color]::FromArgb(83, 68, 196)    # #5344C4 (bas)

function New-Logo([int]$size) {
  $s = $size / 512.0
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

  # Fond : rectangle arrondi + degrade vertical (meme repere que la lune pour un carve exact)
  $r = [int](110 * $s); $d = 2 * $r
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($size - $d, 0, $d, $d, 270, 90)
  $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
  $path.AddArc(0, $size - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $full = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($full, $c1, $c2, [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
  $g.FillPath($grad, $path)

  # Lune : cercle blanc + cercle decoupe repeint avec le MEME degrade (aligne pixel par pixel)
  $m = { param($x, $y, $w, $h) New-Object System.Drawing.Rectangle([int]($x * $s), [int]($y * $s), [int]($w * $s), [int]($h * $s)) }
  $grad2 = New-Object System.Drawing.Drawing2D.LinearGradientBrush($full, $c1, $c2, [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
  $g.FillEllipse([System.Drawing.Brushes]::White, (& $m 85 70 230 230))
  $g.FillEllipse($grad2, (& $m 120 35 230 230))

  # Coche : trait blanc epais, bouts arrondis
  $pen = New-Object System.Drawing.Pen([System.Drawing.Brushes]::White, [float](40 * $s))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $pts = @(
    (New-Object System.Drawing.PointF([float](250 * $s), [float](330 * $s))),
    (New-Object System.Drawing.PointF([float](325 * $s), [float](400 * $s))),
    (New-Object System.Drawing.PointF([float](440 * $s), [float](240 * $s)))
  )
  $g.DrawLines($pen, $pts)

  $pen.Dispose(); $grad.Dispose(); $grad2.Dispose(); $path.Dispose(); $g.Dispose()
  return $bmp
}

$here = Split-Path $PSCommandPath -Parent
foreach ($sz in 512, 256, 120) {
  $bmp = New-Logo $sz
  $out = Join-Path $here ("logo-{0}.png" -f $sz)
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host ("OK  {0}  ({1} octets)" -f $out, (Get-Item $out).Length)
}
