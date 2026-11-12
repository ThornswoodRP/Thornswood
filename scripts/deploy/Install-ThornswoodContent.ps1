<#
  Install-ThornswoodContent.ps1

  Copies Thornswood-Content.esp into the game folder's Data and puts it into
  the install's plugin lists, in front of the plugin -Before names. Where that
  plugin is not in a list, it goes at the end of that list, and the line says
  so. Install-Thornswood.ps1 runs this as its content step.

  A COPY THAT FAILS STOPS HERE (#4192). The usual cause is a program holding
  the file in Data open, an editor or the game. Until #4192 the copy's error
  did not stop the script: it went on to rewrite the plugin lists, said the
  plugin was installed and exited 0, so Install-Thornswood.ps1 counted the
  step as passed with the old plugin still in Data. Now the copy is the first
  thing written, and when it fails nothing else is touched, the script says
  what was in the way and exits 1, and Install-Thornswood.ps1 stops on it.

  WHAT IT SAYS IT INSTALLED is the plugin's own description, read from the
  copy in Data (the SNAM in its header, which Add-ContentRecords.py builds
  from the records the plugin holds, #2993), and the plugin each list now
  has after it, read from that list. Nothing about the plugin is typed in
  here, so this cannot fall behind it.
#>
param(
    [string]$Esp,
    [string]$Data     = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Game\Data'),
    [string]$Profile  = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Profile'),
    [string]$Before   = 'The Great Cities - Minor Cities and Towns.esp'
)

# Every failure below stops the script rather than being written to the
# screen and stepped past (#4192).
$ErrorActionPreference = 'Stop'

# Resolved from where this script is rather than from a fixed path under
# Downloads. The repo folder gets renamed and moved, and a default that names it
# turns every one of these into a broken command the first time it does.
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Esp) { $Esp = Join-Path $Here '..\..\game\content\Thornswood-Content.esp' }

$name = 'Thornswood-Content.esp'
$target = Join-Path $Data $name

function Stop-Install([string]$why) {
    Write-Host ''
    Write-Host ("STOP. $name was not installed. $why") -ForegroundColor Red
    Write-Host 'Nothing else was changed: the plugin lists are as they were.' -ForegroundColor Red
    exit 1
}

# The description in a plugin's header: the SNAM subrecord of its TES4
# record, which is never compressed. '' when it carries none, $null when the
# file does not start with a plugin header.
function Get-PluginDescription([string]$path) {
    $b = [IO.File]::ReadAllBytes($path)
    if ($b.Length -lt 24 -or [Text.Encoding]::ASCII.GetString($b, 0, 4) -ne 'TES4') { return $null }
    $end = 24 + [BitConverter]::ToUInt32($b, 4)
    if ($end -gt $b.Length) { return $null }
    $p = 24
    while ($p + 6 -le $end) {
        $tag = [Text.Encoding]::ASCII.GetString($b, $p, 4)
        $size = [BitConverter]::ToUInt16($b, $p + 4)
        if ($tag -eq 'SNAM') {
            return [Text.Encoding]::GetEncoding(28591).GetString($b, $p + 6, $size).TrimEnd([char]0).Trim()
        }
        $p += 6 + $size
    }
    return ''
}

if (-not (Test-Path -LiteralPath $Esp)) { Stop-Install "The plugin to copy is not at $Esp." }
if (-not (Test-Path -LiteralPath $Data -PathType Container)) { Stop-Install "There is no game Data folder at $Data." }

try {
    Copy-Item -LiteralPath $Esp -Destination $target -Force
}
catch {
    Stop-Install ("Copying it to $target failed: " + $_.Exception.Message +
                  " If a program has that file open (an editor, xEdit, the game), close it and run this again.")
}
Write-Host "copied $name -> $Data" -ForegroundColor Cyan

$targets = @(
    @{ Path = (Join-Path (Join-Path $Profile 'Default') 'plugins.txt');        Star = $true  }
    @{ Path = (Join-Path (Join-Path $Profile 'Default') 'loadorder.txt');      Star = $false }
    @{ Path = (Join-Path (Join-Path $Profile 'LocalAppData') 'Plugins.txt');   Star = $true  }
    @{ Path = (Join-Path (Join-Path $Profile 'LocalAppData') 'loadorder.txt'); Star = $false }
)

foreach ($t in $targets) {
    if (-not (Test-Path -LiteralPath $t.Path)) { Write-Host "  skip (absent) $($t.Path)" -ForegroundColor DarkGray; continue }

    $lines = [Collections.Generic.List[string]](Get-Content -LiteralPath $t.Path)
    $entry = if ($t.Star) { "*$name" } else { $name }

    # already there? take it out first so a re-run repositions instead of duplicating
    for ($i = $lines.Count - 1; $i -ge 0; $i--) {
        if ($lines[$i].TrimStart('*').Trim() -ieq $name) { $lines.RemoveAt($i) }
    }

    $at = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i].TrimStart('*').Trim() -ieq $Before) { $at = $i; break }
    }
    if ($at -lt 0) { $at = $lines.Count }        # anchor missing: append
    $lines.Insert($at, $entry)

    # WriteAllLines, not Set-Content -Encoding UTF8: that adds a byte order mark
    # under Windows PowerShell 5.1 and not under 7, so the same line produces a
    # different file depending on who runs it. The game and SkyrimPlatform both
    # stop on a BOM, and the .cmd wrappers use 5.1.
    [IO.File]::WriteAllLines($t.Path, $lines, (New-Object Text.UTF8Encoding($false)))
    $n = ($lines | Where-Object { $_ -match '^\*' }).Count
    $where = if ($at + 1 -lt $lines.Count) { 'before ' + $lines[$at + 1].TrimStart('*').Trim() }
             else { "at the end, because $Before is not in it" }
    Write-Host ("  {0,-46} line {1}, {2}{3}" -f (Split-Path $t.Path -Leaf), ($at + 1), $where,
                $(if ($t.Star) { ", $n enabled" } else { '' })) -ForegroundColor DarkGray
}

$said = Get-PluginDescription $target
Write-Host ''
Write-Host ("done. $name is installed, {0:N0} bytes." -f (Get-Item -LiteralPath $target).Length) -ForegroundColor Green
if ($null -eq $said) { Write-Host '  It does not start with a plugin header, so what it holds cannot be read from it.' -ForegroundColor Yellow }
elseif (-not $said) { Write-Host '  Its header carries no description.' -ForegroundColor DarkGray }
else { foreach ($l in ($said -split "`r?`n")) { if ($l.Trim()) { Write-Host ('  ' + $l.Trim()) -ForegroundColor DarkGray } } }
exit 0
