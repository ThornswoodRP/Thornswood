<#
.SYNOPSIS
  One Dev or Main command that runs the gamemode deploy and the host feed remirror.

.DESCRIPTION
  Umbrella for the steps that used to be run by hand after a build: put the
  gamemode on the right server, and remirror the host feed so the site serves
  the tip. Ship.ps1 stays the launcher and tip publisher; this script does not
  bump, package mods, or announce. Issue #784. It built the old installer too
  until that went (#4824): the download is Velopack's Setup.exe, which every
  merge release carries.

  ORDER, AND WHAT EACH STEP IS.

      1  gamemode   Channel=dev runs Deploy-DevGamemode.ps1 -Note (sends
                    game\gamemode.js to the VPS dev server, restarts only
                    that one and posts the note to the dev updates channel).
                    Channel=main runs Deploy-Gamemode.ps1 (writes
                    gamemode.js and the load order into the built server)
                    then Deploy-Server.ps1 (sends that build to the live VPS
                    and restarts it). That is the existing Main path in
                    scripts\deploy. -SkipGameMode leaves this step out.

      2  remirror   Always. Publish-PostShip.ps1 -Channel -Only Remirror
                    -NoPause. Same warn-not-fail rule as Ship: a refused
                    remirror is a line naming the put-right command, and this
                    stack still exits 0 for that half. A missing or thrown
                    gamemode step fails the stack.

  The gamemode step is ON unless -SkipGameMode. Channel defaults to dev so a Main
  run is deliberate. Nothing here is a dry run against live servers when you
  only want to parse the script; do not run this against Main until Patrick
  says Main.

    .\scripts\release\Ship-Stack.ps1 -Note "The door answers on the first knock
    - The door no longer needs a second try before it opens."
    .\scripts\release\Ship-Stack.ps1 -Channel main
    .\scripts\release\Ship-Stack.ps1 -SkipGameMode -NoPause

.PARAMETER Channel
  main or dev, and dev when it is left out. Dev deploys the gamemode to the
  VPS Dev server and remirrors this machine's working copy of the dev feed to
  /feed-dev. Main builds the live gamemode into the server dist, pushes it
  with Deploy-Server.ps1, and remirrors the main tip to /feed.

.PARAMETER Note
  What the dev gamemode step posts to the dev updates channel, passed to
  Deploy-DevGamemode.ps1 as its -Note: a title, then "- " lines. Required when
  that step runs (Channel=dev without -SkipGameMode), because
  Deploy-DevGamemode refuses a deploy without one (#594). Until #1955 this
  passed it nothing, so every dev run stopped there. Refused when no step
  would carry it: Main's gamemode deploys post no note. The one parameter
  taken without its name, as in Deploy-DevGamemode (#1929).

.PARAMETER SkipGameMode
  Leaves the Deploy-* gamemode step out. Use when the server already has the
  gamemode you want and you only want the remirror.

.PARAMETER NoPause
  Exits without waiting for Enter, and passes -NoPause to PostShip so a
  caller is not stopped for a keypress. Deploy scripts have no
  -NoPause; their -Now switch is not passed here, because that skips the
  in-world restart warning.

.PARAMETER Root
  The main play install (Where.ps1 Install by default, C:\Thornswood on most
  machines, #3031), handed to Publish-PostShip.ps1 as Ship hands it.

.PARAMETER DistRoot
  Where PostShip looks for the release it remirrors. Default is Where.ps1
  Dist (repo out\dist), matching Ship.
  Resolved after the script directory is known from PSCommandPath /
  MyInvocation / PSScriptRoot, so an empty PSScriptRoot does not fail the default.

.EXAMPLE
  .\scripts\release\Ship-Stack.ps1 -Channel dev -NoPause -Note "The door answers on the first knock
  - The door no longer needs a second try before it opens."

  Deploys the gamemode to the Dev server, remirrors /feed-dev, and exits
  without waiting for Enter.

.NOTES
  Exit 0 when every non-skipped step succeeded, or when only the remirror
  warned (Ship / PostShip policy). Exit 1 when a gamemode step failed. Does not run itself as part of Ship.
#>
[CmdletBinding()]
param(
    [ValidateSet('main', 'dev')][string]$Channel = 'dev',
    [switch]$SkipGameMode,
    [switch]$NoPause,
    # The launcher install, Where.ps1 Install, unless told otherwise (#3031).
    # Empty until after $Here is resolved, like -DistRoot below.
    [string]$Root = '',
    # Empty until after $Here is resolved. $PSScriptRoot can be empty when this
    # script is invoked certain ways (dot-source, some hosts), which made the
    # old Join-Path $PSScriptRoot default fail the first Dev Ship-Stack run.
    [string]$DistRoot = '',
    # Position 0, and the only parameter with one, so a bare string is the
    # note and never binds to -Channel (#1929, #1955).
    [Parameter(Position = 0)][string]$Note = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) {
    Write-Host ''
    Write-Host "STOP. $m" -ForegroundColor Red
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
    exit 1
}

# Prefer $PSCommandPath / $MyInvocation path over $PSScriptRoot so DistRoot and
# sibling script paths still resolve when $PSScriptRoot is empty.
$Here = $null
if ($PSCommandPath) { $Here = Split-Path -Parent $PSCommandPath }
elseif ($MyInvocation.MyCommand.Path) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Path }
elseif ($PSScriptRoot) { $Here = $PSScriptRoot }
elseif ($MyInvocation.MyCommand.Definition) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Here) {
    Die 'Could not resolve the scripts\release folder for Ship-Stack (PSCommandPath, MyInvocation, and PSScriptRoot were all empty).'
}

if ([string]::IsNullOrWhiteSpace($Root)) { $Root = [string](& (Join-Path $Here 'Where.ps1') Install) }
if ([string]::IsNullOrWhiteSpace($DistRoot)) {
    $where = Join-Path $Here 'Where.ps1'
    if (Test-Path -LiteralPath $where) {
        $DistRoot = & $where Dist
    }
    else {
        # Same place Where.ps1 Dist returns when out\ exists: repo out\dist.
        $DistRoot = [System.IO.Path]::GetFullPath((Join-Path $Here '..\..\out\dist'))
    }
}

# The note goes to the dev gamemode step and nowhere else (#1955). Asked for
# here, before any step runs, so a run without one stops before anything is
# sent instead of at Deploy-DevGamemode's own refusal.
$devGamemode = ($Channel -eq 'dev' -and -not $SkipGameMode)
if ($devGamemode -and -not $Note.Trim()) {
    Die ('the dev gamemode step posts a note to the dev updates channel, and none was given. Give it as -Note, a title then "- " lines:' + "`n" +
        '  .\scripts\release\Ship-Stack.ps1 -Note "The door answers on the first knock' + "`n" +
        '  - The door no longer needs a second try before it opens."' + "`n" +
        'or leave the gamemode out with -SkipGameMode.')
}
if (-not $devGamemode -and $Note.Trim()) {
    $why = if ($SkipGameMode) { '-SkipGameMode leaves it out' } else { 'Main''s gamemode deploys post none' }
    Die ("-Note was given and no step would post it: only the dev gamemode step takes a note, and $why. Run it again without -Note.")
}

$Deploy = Join-Path $Here '..\deploy'
$script:RemirrorWarned = $false

function Invoke-Step([string]$what, [string]$path, [hashtable]$withArgs) {
    if (-not (Test-Path -LiteralPath $path)) {
        Die ("$what did not run: $(Split-Path -Leaf $path) is not at $path.")
    }
    $global:LASTEXITCODE = 0
    try { & $path @withArgs }
    catch {
        Die ("$what stopped: $($_.Exception.Message)")
    }
    if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) {
        Die ("$what stopped with exit code $LASTEXITCODE. The lines above say why.")
    }
    Say "  $what done" 'Green'
}

Head ("SHIP STACK  channel=$Channel")
Say ("  Root=$Root") 'DarkGray'
Say ("  DistRoot=$DistRoot") 'DarkGray'
Say ("  SkipGameMode=$SkipGameMode  NoPause=$NoPause") 'DarkGray'

# ------------------------------------------------------------------ gamemode
if (-not $SkipGameMode) {
    if ($Channel -eq 'dev') {
        Head 'Gamemode (dev)'
        Invoke-Step 'Deploy-DevGamemode' (Join-Path $Deploy 'Deploy-DevGamemode.ps1') @{ Note = $Note }
    }
    else {
        Head 'Gamemode (main): build into server dist'
        Invoke-Step 'Deploy-Gamemode' (Join-Path $Deploy 'Deploy-Gamemode.ps1') @{}
        Head 'Gamemode (main): push server to VPS'
        Invoke-Step 'Deploy-Server' (Join-Path $Deploy 'Deploy-Server.ps1') @{}
    }
}
else {
    Head 'Gamemode'
    Say '  skipped (-SkipGameMode)' 'Yellow'
}

# ------------------------------------------------------------------ remirror
Head 'Host feed remirror'
$post = Join-Path $Here 'Publish-PostShip.ps1'
if (-not (Test-Path -LiteralPath $post)) {
    Say '  Publish-PostShip.ps1 is not beside Ship-Stack.ps1, so the site goes on' 'Yellow'
    Say '  serving whatever feed it already has.' 'Yellow'
    Say ("  .\scripts\release\Publish-PostShip.ps1 -Channel $Channel -Only Remirror") 'DarkGray'
    $script:RemirrorWarned = $true
}
else {
    $postArgs = @{ Channel = $Channel; Root = $Root; DistRoot = $DistRoot; Only = 'Remirror'; NoPause = $true }
    $global:LASTEXITCODE = 0
    try { & $post @postArgs }
    catch {
        Say ("  the remirror stopped: $($_.Exception.Message)") 'Red'
        Say ("  .\scripts\release\Publish-PostShip.ps1 -Channel $Channel -Only Remirror") 'Yellow'
        $script:RemirrorWarned = $true
    }
    if (-not $script:RemirrorWarned -and $null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) {
        # Match Ship / PostShip: refused remirror is a line, not a failed stack.
        Say ("  the remirror handed back exit $LASTEXITCODE. The lines above say why.") 'Red'
        Say ("  .\scripts\release\Publish-PostShip.ps1 -Channel $Channel -Only Remirror") 'Yellow'
        $script:RemirrorWarned = $true
    }
    elseif (-not $script:RemirrorWarned) {
        Say '  remirror done' 'Green'
    }
}

Write-Host ''
if ($script:RemirrorWarned) {
    Say 'Stack finished. The gamemode step, when it ran, is done; the remirror needs a put-right.' 'Yellow'
}
else {
    Say 'Stack finished.' 'Green'
}
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
exit 0
