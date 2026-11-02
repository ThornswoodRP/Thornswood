<#
  test-3648-launcher-strip.ps1

      pwsh -NoProfile -File .\tests\test-3648-launcher-strip.ps1

  #3648: the launcher's Gallery page sent a picture as it was on disk, so a
  phone or camera picture left this machine with its Exif, GPS position
  included, and the site served it to anyone. Gallery.Submit now runs
  MediaStrip.Clean on the bytes before it sends them, by the site's own rules
  (stripMedia in site\server.js).

  WHAT IT CHECKS:
    1. Compiled with the .NET SDK the launcher builds with (Add-LauncherType,
       tests\Launcher-Csc.ps1, #2821, #4823) and asked: for every picture and
       recording in tests\fixtures\media-3648.js, MediaStrip.Clean gives
       exactly the bytes the site keeps (the same fixture's clean bytes,
       which site\tests\test-3648-media-metadata.js holds the site to), so what the
       launcher sends and what the site keeps cannot drift apart; none of
       them holds a GPS block or XMP; a clean file comes back as the same
       array; one whose blocks cannot be walked comes back null; and the
       bytes it was given are never changed.
    2. In Gallery.cs (text): Submit cleans the bytes after reading them and
       before PostBytes sends them, sends the cleaned bytes, and refuses to
       send a file that cannot be cleaned, saying why.
    3. The two copies of the rules name each other.

  Read only. node writes the fixtures under the temp folder, and they are
  removed at the end. It runs on any machine.
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root 'launcher\app'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the build's compiler and C# version (#2821)

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Same([byte[]]$a, [byte[]]$b) {
    if ($null -eq $a -or $null -eq $b -or $a.Length -ne $b.Length) { return $false }
    for ($i = 0; $i -lt $a.Length; $i++) { if ($a[$i] -ne $b[$i]) { return $false } }
    return $true
}
$latin = [Text.Encoding]::GetEncoding(28591)

# ------------------------------------------------- 1. compiled and asked
Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if (Test-Path -LiteralPath $LauncherDotnet) {
    $node = Get-Command node -ErrorAction SilentlyContinue
    Yes 'node is here to write the fixtures' ($null -ne $node)
    $work = Join-Path ([IO.Path]::GetTempPath()) ('ts-3648-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    try {
        if ($node) {
            & $node.Source (Join-Path $PSScriptRoot 'fixtures\media-3648.js') $work
            Yes 'the fixtures are written' ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath (Join-Path $work 'in')))

            # The type from the assembly this build returns, so another copy
            # loaded in the same session cannot answer for it.
            $T = (Add-LauncherType -File (Join-Path $app 'MediaStrip.cs')).GetType('Thornswood.MediaStrip', $true)

            foreach ($f in @(Get-ChildItem -LiteralPath (Join-Path $work 'in') -File | Sort-Object Name)) {
                $dirty = [IO.File]::ReadAllBytes($f.FullName)
                $copy = [byte[]]$dirty.Clone()
                $want = Join-Path (Join-Path $work 'out') $f.Name
                $failed = $null
                $got = $T::Clean($dirty, $f.Extension, [ref]$failed)
                Yes ("$($f.Name): the bytes it was given are not changed") (Same $dirty $copy)
                if (-not (Test-Path -LiteralPath $want)) {
                    Yes ("$($f.Name), whose blocks cannot be walked, comes back null, so Submit refuses it") ($null -eq $got)
                    continue
                }
                $clean = [IO.File]::ReadAllBytes($want)
                Yes ("$($f.Name): Clean gives exactly the bytes the site keeps ($($clean.Length) of $($dirty.Length))") (Same $got $clean)
                $text = if ($got) { $latin.GetString($got) } else { '' }
                Yes ("$($f.Name): and they hold no GPS block, XMP or position") (
                    $got -and $text.IndexOf('GPS') -lt 0 -and $text.IndexOf('xmpmeta') -lt 0 -and $text.IndexOf('+40.7123') -lt 0)
                if (Same $dirty $clean) {
                    Yes ("$($f.Name): already clean, it comes back as the same array") ([object]::ReferenceEquals($got, $dirty))
                }
            }
        }
    }
    finally {
        if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
    }
}

# ------------------------------------------------- 2. Submit uses it
$gallery = [IO.File]::ReadAllText((Join-Path $app 'Gallery.cs'))
$at = $gallery.IndexOf('public static string Submit(')
$submit = if ($at -ge 0) { $gallery.Substring($at, $gallery.IndexOf('static readonly string[] AllowExt', $at) - $at) } else { '' }
$read = $submit.IndexOf('File.ReadAllBytes(path)')
$clean = $submit.IndexOf('MediaStrip.Clean(data, ext, out unwalked)')
$post = $submit.IndexOf('Discord.PostBytes(url, data,')
Yes 'Submit cleans the bytes after reading them and before sending them' ($read -ge 0 -and $clean -gt $read -and $post -gt $clean)
Yes 'and sends the cleaned bytes' ($submit -match 'data = clean;' -and $submit.IndexOf('data = clean;') -lt $post)
Yes 'and refuses a file that cannot be cleaned, saying why, with what stopped it in the log' (
    $submit -match 'if \(clean == null\)' -and
    $submit.Contains('That file could not be read to take out where and when it was made, so it was not sent.') -and
    $submit.Contains('Swallow.Note("Gallery.Submit clean", unwalked)'))

# ------------------------------------------------- 3. one set of rules, two copies
# The site is server.js over its modules in site\lib since #5357.
. (Join-Path $PSScriptRoot 'SiteFiles.ps1')
$site = Get-SiteSource (Join-Path $root 'site')
$strip = [IO.File]::ReadAllText((Join-Path $app 'MediaStrip.cs'))
Yes 'the site''s stripMedia names the launcher''s copy' ($site.Contains('launcher/app/MediaStrip.cs'))
Yes 'and the launcher''s names the site''s' ($strip.Contains('stripMedia in site/lib/media.js'))

Write-Host ''
Write-Host "$script:pass passed, $script:fail failed"
exit $(if ($script:fail) { 1 } else { 0 })
