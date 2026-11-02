# SiteFiles.ps1: the site's program as the PowerShell harnesses read and copy
# it (#5357), the twin of site-files.js. Dot-source it:
#
#   . (Join-Path $PSScriptRoot 'SiteFiles.ps1')
#   Get-SiteSource                     the whole program as one text
#   Get-SiteFiles                      server.js, lib\base.js, ... in order
#   Copy-SiteProgram -To $dir          server.js and lib\ into $dir
#
# The site was one file, site\server.js. Now server.js is the start and the
# site is the modules in site\lib, one per area, which server.js names in the
# order it loads them. Get-SiteSource joins the modules in that order and then
# server.js, the order the code had in the one file, so a harness that looks
# for a piece of the site by text finds it in whichever module holds it. Its
# lines end in a bare line feed whatever the checkout, so a harness reads the
# same text on Windows, where git may hand the files out with CRLF, as on
# Linux.
# -App names another copy's site folder.

$SiteFilesApp = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\site'))

function Get-SiteFiles([string]$App = $SiteFilesApp) {
  $out = [Collections.Generic.List[string]]::new()
  $out.Add('server.js')
  foreach ($l in [IO.File]::ReadAllLines((Join-Path $App 'server.js'))) {
    # The --strip-metadata line asks for one module early, and is not the order.
    if ($l.Contains('--strip-metadata')) { continue }
    foreach ($m in [regex]::Matches($l, "require\('\./lib/([a-z0-9-]+)'\)")) {
      $rel = 'lib/' + $m.Groups[1].Value + '.js'
      if (-not $out.Contains($rel)) { $out.Add($rel) }
    }
  }
  return , $out.ToArray()
}

function Get-SiteSource([string]$App = $SiteFilesApp) {
  $all = Get-SiteFiles $App
  $order = @($all | Select-Object -Skip 1) + @($all[0])
  return (($order | ForEach-Object { [IO.File]::ReadAllText((Join-Path $App $_)).Replace("`r`n", "`n") }) -join "`n")
}

function Copy-SiteProgram([string]$To, [string]$App = $SiteFilesApp) {
  foreach ($rel in (Get-SiteFiles $App)) {
    $dest = Join-Path $To $rel
    $dir = Split-Path -Parent $dest
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Copy-Item -LiteralPath (Join-Path $App $rel) -Destination $dest -Force
  }
}
