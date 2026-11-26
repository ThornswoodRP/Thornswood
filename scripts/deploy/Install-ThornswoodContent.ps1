<#
  Install-ThornswoodContent.ps1

  Copies Thornswood-Content.esp into the requested game Data folder.

  Install-Thornswood.ps1 passes Data from its selected root. This step does
  not write plugin lists: Deploy-Gamemode owns the server order, and the
  launcher aligns the local list on Play (#4688).

  A COPY THAT FAILS STOPS HERE (#4192). The script names what was in the way
  and exits 1, so Install-Thornswood.ps1 does not count the step as passed.
  On success it reads the description from the installed plugin's header.
#>
#Requires -Version 7
param(
    [string]$Esp,
    [string]$Data = (Join-Path (& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) 'Game\Data')
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

if (-not (Test-Path -LiteralPath $Esp)) { Stop-Install "The plugin to copy is not at $Esp. It is the box's content build and is never committed (#5191): pwsh scripts\release\Get-ContentBuild.ps1 -Newest lays it." }
if (-not (Test-Path -LiteralPath $Data -PathType Container)) { Stop-Install "There is no game Data folder at $Data." }

try {
    Copy-Item -LiteralPath $Esp -Destination $target -Force
}
catch {
    Stop-Install ("Copying it to $target failed: " + $_.Exception.Message +
                  " If a program has that file open (an editor, xEdit, the game), close it and run this again.")
}
Write-Host "copied $name -> $Data" -ForegroundColor Cyan

$said = Get-PluginDescription $target
Write-Host ''
Write-Host ("done. $name is installed, {0:N0} bytes." -f (Get-Item -LiteralPath $target).Length) -ForegroundColor Green
if ($null -eq $said) { Write-Host '  It does not start with a plugin header, so what it holds cannot be read from it.' -ForegroundColor Yellow }
elseif (-not $said) { Write-Host '  Its header carries no description.' -ForegroundColor DarkGray }
else { foreach ($l in ($said -split "`r?`n")) { if ($l.Trim()) { Write-Host ('  ' + $l.Trim()) -ForegroundColor DarkGray } } }
exit 0
