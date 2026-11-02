<#
.SYNOPSIS
  Says whether every PowerShell script and every game script parses (#5291).

.DESCRIPTION
      pwsh scripts/dev/Check-Parse.ps1                    both kinds
      pwsh scripts/dev/Check-Parse.ps1 -What PowerShell   scripts, tests, installer, <product>/tests *.ps1
      pwsh scripts/dev/Check-Parse.ps1 -What Scripts      the .js the build check parses
      pwsh scripts/dev/Check-Parse.ps1 -Root <folder>     another checkout of the tree

  WHY ONE SCRIPT. The build check parsed both kinds in two steps of its own
  (build.yml, "Parse every PowerShell script" and "Parse every game script"),
  each with its own list of folders. The pre-push hook (.githooks/pre-push,
  scripts/dev/Check-Push.ps1) runs the same parse before a push, so the list
  lives here and both read it: a second copy of it would drift, and a script
  the hook passed would fail on GitHub. The nightly's parse step runs this
  too, for the same reason.

  WHAT IT PARSES.
    PowerShell: every *.ps1 under scripts, tests and installer, and in each
      product's own tests folder (launcher/tests, plan line 42, as
      scripts/dev/Harness-Files.ps1 finds them), with PowerShell's own
      parser, so nothing in them runs.
    Scripts: every *.js under scripts, the *.js at the top of game, in
      game/plugins and game/ui, site/server.js and the site's modules in
      site/lib (#5357), and voice/voice-server.js, each with node --check,
      which compiles and runs nothing.

  Each one that does not parse is named with its line; on GitHub as an
  ::error line, so it is marked on the file. Exits 0 when all of them parse,
  1 when any does not, 2 when it could not start (no such folder, no node).
  tests/test-5291-pre-push.ps1 holds this.
#>
[CmdletBinding()]
param(
    [ValidateSet('All', 'PowerShell', 'Scripts')]
    [string]$What = 'All',
    [string]$Root = ''
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'Harness-Files.ps1')
if (-not $Root) { $Root = Split-Path -Parent (Split-Path -Parent $Here) }
if (-not (Test-Path -LiteralPath $Root -PathType Container)) { Write-Host ("STOP. {0} is not a folder." -f $Root); exit 2 }
$Root = (Resolve-Path -LiteralPath $Root).Path
$OnGitHub = $env:GITHUB_ACTIONS -eq 'true'

function Say-Bad([string]$file, [int]$line, [string]$why) {
    $rel = [IO.Path]::GetRelativePath($Root, $file).Replace('\', '/')
    if ($OnGitHub) {
        if ($line -gt 0) { Write-Host ("::error file={0},line={1}::{2}" -f $rel, $line, $why) }
        else { Write-Host ("::error file={0}::{1}" -f $rel, $why) }
    } elseif ($line -gt 0) { Write-Host ("{0}:{1}: {2}" -f $rel, $line, $why) }
    else { Write-Host ("{0}: {1}" -f $rel, $why) }
}

function Under([string[]]$folders, [string]$filter, [switch]$Deep) {
    foreach ($f in $folders) {
        $p = Join-Path $Root $f
        if (-not (Test-Path -LiteralPath $p -PathType Container)) { continue }
        if ($Deep) { Get-ChildItem -LiteralPath $p -Filter $filter -File -Recurse }
        else { Get-ChildItem -LiteralPath $p -Filter $filter -File }
    }
}

$bad = 0

if ($What -in 'All', 'PowerShell') {
    $beside = @(Get-ProductTestFolders $Root | Where-Object { $_.Product -ne 'installer' } | ForEach-Object { Join-Path $_.Product 'tests' })
    $ps = @(Under -folders (@('scripts', 'tests', 'installer') + $beside) -filter '*.ps1' -Deep)
    foreach ($f in $ps) {
        $tokens = $null; $errors = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$tokens, [ref]$errors)
        foreach ($e in $errors) { $bad++; Say-Bad $f.FullName $e.Extent.StartLineNumber $e.Message }
    }
    Write-Host ("{0} PowerShell script(s) read" -f $ps.Count)
}

if ($What -in 'All', 'Scripts') {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host 'STOP. There is no node here, which parses the game scripts.'; exit 2 }
    # game since the reorganisation's phase 6 (#440): the gamemode, the
    # plugins and the overlays.
    $js = @(Under -folders 'scripts' -filter '*.js' -Deep) + @(Under -folders 'game', (Join-Path 'game' 'plugins'), (Join-Path 'game' 'ui') -filter '*.js') +
          @(Under -folders (Join-Path 'site' 'lib') -filter '*.js')
    foreach ($one in (Join-Path 'site' 'server.js'), (Join-Path 'voice' 'voice-server.js')) {
        $p = Join-Path $Root $one
        if (Test-Path -LiteralPath $p -PathType Leaf) { $js += Get-Item -LiteralPath $p }
        else { $bad++; Say-Bad $p 0 'is not there, and the build check parses it' }
    }
    foreach ($f in $js) {
        $out = & node --check $f.FullName 2>&1
        if ($LASTEXITCODE -ne 0) {
            $bad++
            $line = 0
            $m = [regex]::Match(($out | Out-String), ':(\d+)\r?\n')
            if ($m.Success) { $line = [int]$m.Groups[1].Value }
            Say-Bad $f.FullName $line 'does not parse'
        }
    }
    Write-Host ("{0} game script(s) read" -f $js.Count)
}

if ($bad) { Write-Host ("{0} parse error(s), named above" -f $bad); exit 1 }
Write-Host 'every script parses'
exit 0
