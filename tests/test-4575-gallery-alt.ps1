<#
  test-4575-gallery-alt.ps1

      pwsh -NoProfile -File .\tests\test-4575-gallery-alt.ps1

  #4575: the launcher's Gallery page sends a picture with a short
  description of what it shows, one for each picture, and does not send one
  without it. The site keeps it as the picture's alt text (`alt` on
  /api/gallery/submit, agreed with the site's side: required, 1 to 200
  characters once each control character or line break is a space and the
  ends are trimmed, plain text).

  WHY. Nothing ever asked for one. Gallery.Submit sent the picture with
  name, by and note and no description, so the site had nothing to put in
  the picture's alt, and every picture told a screen reader only "Skyrim
  scene shared by" and a name.

  WHAT IT CHECKS:
    1. Compiled with the .NET SDK the launcher builds with (Add-LauncherType,
       tests\Launcher-Csc.ps1) and asked: GalleryAlt.Clean refuses no
       description, a blank one and one over 200 characters, each with a
       sentence saying why, and turns control characters and line breaks into
       spaces and trims the ends before it counts.
    2. In Gallery.cs (text): Submit takes the description, refuses before
       anything is read or sent when GalleryAlt.Clean refuses it, and sends
       the cleaned description as alt.
    3. In Shell.cs (text): every picture chosen on the Gallery page has its
       own description box, the send passes each picture its own, and a
       picture with none stops the send before anything goes.

  Read only. It runs on any machine with the SDK; without it, part 1 fails.
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root 'launcher\app'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Body([string]$text, [string]$sig) {
    $at = $text.IndexOf($sig)
    if ($at -lt 0) { return '' }
    $open = $text.IndexOf('{', $at)
    if ($open -lt 0) { return '' }
    $depth = 0
    for ($i = $open; $i -lt $text.Length; $i++) {
        if ($text[$i] -eq '{') { $depth++ }
        elseif ($text[$i] -eq '}') { $depth--; if ($depth -eq 0) { return $text.Substring($at, $i - $at + 1) } }
    }
    return ''
}

# ------------------------------------------------- 1. the rule, compiled
$altFile = Join-Path $app 'GalleryAlt.cs'
Yes '1. launcher\app\GalleryAlt.cs holds the description rule' (Test-Path -LiteralPath $altFile)
Yes '1. the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if ((Test-Path -LiteralPath $altFile) -and (Test-Path -LiteralPath $LauncherDotnet)) {
    $T = (Add-LauncherType -File $altFile).GetType('Thornswood.GalleryAlt', $true)
    function Ask([string]$raw) { $why = $null; $got = $T::Clean($raw, [ref]$why); return [pscustomobject]@{ Got = $got; Why = $why } }

    Yes '1. the most is 200 characters' ($T::Most -eq 200)
    foreach ($case in @(@{ In = $null; Say = 'no description' }, @{ In = ''; Say = 'an empty one' }, @{ In = "  `r`n`t "; Say = 'one of only spaces and line breaks' })) {
        $r = Ask $case.In
        Yes ("1. $($case.Say) is refused, with a sentence") ($null -eq $r.Got -and $r.Why -and $r.Why.Length -gt 10)
    }
    $r = Ask ("  A view of Whiterun`r`nfrom the walls`t ")
    Yes '1. line breaks and tabs become spaces, and the ends are trimmed' ($r.Got -ceq 'A view of Whiterun  from the walls' -and -not $r.Why)
    $r = Ask ('x' * 200)
    Yes '1. 200 characters are taken' ($r.Got -ceq ('x' * 200))
    $r = Ask ('   ' + ('x' * 200) + "`r`n")
    Yes '1. counted after trimming, so 200 with spaces round them are taken' ($r.Got -ceq ('x' * 200))
    $r = Ask ('x' * 201)
    Yes '1. 201 are refused, with a sentence that names the most' ($null -eq $r.Got -and $r.Why -match '200')
}

# ------------------------------------------------- 2. Gallery.Submit
$gallery = [IO.File]::ReadAllText((Join-Path $app 'Gallery.cs'))
$submit = Body $gallery 'public static string Submit('
Yes '2. Gallery.Submit is found' ($submit.Length -gt 0)
$sig = [regex]::Match($submit, 'public static string Submit\(([^)]*)\)').Groups[1].Value
Yes '2. Submit takes a description' ($sig -match 'string alt\b')
$clean = $submit.IndexOf('GalleryAlt.Clean(alt')
$read = $submit.IndexOf('File.ReadAllBytes(')
$post = $submit.IndexOf('Discord.PostBytes(')
Yes '2. it asks GalleryAlt.Clean before it reads the file or sends anything' ($clean -ge 0 -and $read -gt $clean -and $post -gt $clean)
Yes '2. and returns its sentence when the description is refused' ($submit -match 'GalleryAlt\.Clean\(alt, out \w+\);\s*if \(\w+ == null\) return \w+;')
Yes '2. the cleaned description goes to the site as alt' ($submit -match '"&alt=" \+ Uri\.EscapeDataString\(')
Yes '2. no other Submit sends a picture without one' (([regex]::Matches($gallery, 'public static string Submit\(')).Count -eq 1)

# ------------------------------------------------- 3. the Gallery page
$shell = [IO.File]::ReadAllText((Join-Path $app 'Shell.cs'))
$send = Body $shell 'static void GallerySendChosen()'
$paint = Body $shell 'static void PaintGalleryChosen()'
Yes '3. each chosen picture gets its own description box' ($paint -match 'new TextBox\(' -and $paint -match 'MaxLength = GalleryAlt\.Most')
Yes '3. the send passes each picture its own description' ($send -match 'Gallery\.Submit\(paths\[i\], \w+, \w+, \w+\[i\], out')
Yes '3. a picture with no description stops the send before anything goes' ($send -match 'GalleryAlt\.Clean\(' -and $send.IndexOf('GalleryAlt.Clean(') -lt $send.IndexOf('ThreadPool.QueueUserWorkItem'))

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
