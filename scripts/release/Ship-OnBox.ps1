<#
  Ship-OnBox.ps1

  The deploy gate's Ship verbs (#2841): a Ship from the feed run on the box
  itself, from main as the gate reads it, so a cloud session ships with no key
  to the box (Patrick, 30 Oct 2026: "we arent doing this on One").

      pwsh scripts/vps/Box-Run.ps1 -Line 'Ship-Dev -Title "Market stalls take your own prices" -Detail "Claim a stall in a town market and sell at your prices"'
      pwsh scripts/vps/Box-Run.ps1 -Line 'Ship-Main -Build <main''s full commit> -Title "..." -Detail "..."'

  Ship-Dev is Ship.ps1 -Channel dev -FromFeed. Ship-Main is Ship.ps1
  -FromFeed, the main release, and the gate runs it only when main is at the
  commit -Build names (the build Patrick gave his word for). Neither sends a
  launcher: since #4825 Ship sends none, and the launcher goes out only
  through Velopack (merge-release.yml, promote-main.yml), so the switch these
  verbs once took to keep the feed's launcher went with it.

  WHAT IS DIFFERENT FROM ONE. Nothing in Ship.ps1. Its box steps
  (Publish-Update, Sync-Client, the feed store,
  announced.json) reach the box the way they do from One, as Administrator
  over ssh, here over loopback with the gate's own key. Two things only this
  script does:

    1. The notes. A gate line is one line of plain text, so the release note
       comes as -Title and up to three -Detail lines, which become the title
       and the "- " lines Ship.ps1 asks for.
    2. GitHub. A Ship from the feed signs its manifest in the engine fork
       (Sign-OnGitHub.ps1), through gh. The box admin App mints a token for this run
       alone (scripts\vps\admin\ShipAccess.ps1 runs ship-access.js;
       Patrick's pick of 30 Oct: Actions write on the fork and Thornswood,
       Contents read on Thornswood), which goes to gh through GH_TOKEN and
       nowhere else, and GitHub ends after an hour. gh is the one
       Install-Gate.ps1 pinned beside the gate (C:\Thornswood-Gate\tools\gh).

  The release tag (release/<channel>/<id>) is pushed with git, and the gate's
  checkout reads GitHub with a read-only key, so Ship prints the tag as a
  line it could not push; the Desk puts it on with Set-Ref.ps1, as a cloud
  Ship's always has (#3314).
#>
[CmdletBinding()]
param(
    [ValidateSet('dev', 'main')]
    [string]$Channel = 'dev',
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string]$Detail,
    [string]$Detail2 = '',
    [string]$Detail3 = '',
    # Where the App's key and id are, for a harness.
    [string]$AdminState = 'C:\Thornswood-Admin\state'
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = (Resolve-Path -LiteralPath (Join-Path $Here '..\..')).ProviderPath
function Die($m) { Write-Host "STOP. $m" -ForegroundColor Red; exit 1 }

# The note, as Ship.ps1 reads it: the title line, then a "- " line for each detail.
$notes = (@($Title.Trim()) + @(@($Detail, $Detail2, $Detail3) | Where-Object { $_ -and $_.Trim() } | ForEach-Object { '- ' + $_.Trim() })) -join "`n"

# A main release ships from the branch main, level with origin/main: the gate
# checks main out detached, at the commit it fetched into origin/main.
if ($Channel -eq 'main') {
    $was = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $o = @(& git -C $repo checkout --quiet -B main refs/remotes/origin/main 2>&1 | ForEach-Object { "$_" })
    $ErrorActionPreference = $was
    if ($LASTEXITCODE -ne 0) { Die ('the checkout could not be put on main at origin/main: ' + ($o -join ' ') + ' Nothing was published.') }
}

# MAIN'S HISTORY AND THE RELEASE TAGS (#5133). The gate's checkout is one
# commit of main with no tags (GateBroker.ps1, Update-Checkout), and Ship
# reads history in two places: the dev feed's DEV marks (Dev-News.ps1) prove
# a note's commit is in main's release through git and the release/dev tags,
# and with neither every note keeps its mark (31 Oct 2026: after main
# 20261031-144725 all 16 dev notes stayed DEV, the journal crash fix main
# carried among them); and Close-ShippedIssues.ps1 stops on a shallow
# checkout. So the Ship deepens the checkout to the whole of main and its
# tags first. The gate's next fetch makes it one commit deep again, so every
# Ship asks. origin/main is put back where the gate checked it, so a merge
# landing meanwhile is not taken: the Ship is of the commit the gate read.
# The tags are fetched as origin has them (+refs/tags/*), because a tag can
# move there: the #5231 rewrite moved every tag it could, and a plain --tags
# refuses each moved one ("would clobber existing tag") and exits 1, which
# --quiet made a stop that said nothing (1 Nov 2026, gate run
# 20261101-203241-0d214a). Without --quiet, a failed fetch says why.
$was = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$head = (@(& git -C $repo rev-parse HEAD 2>&1 | ForEach-Object { "$_" }) -join '').Trim()
$shallow = (@(& git -C $repo rev-parse --is-shallow-repository 2>&1 | ForEach-Object { "$_" }) -join '').Trim()
$o = @()
$deep = 0
if ($head -notmatch '^[0-9a-f]{40}$') { $deep = 1; $o = @('HEAD did not read as a commit: ' + $head) }
else {
    $words = @('-C', $repo, 'fetch', 'origin', '+refs/heads/main:refs/remotes/origin/main', '+refs/tags/*:refs/tags/*')
    if ($shallow -eq 'true') { $words = @('-C', $repo, 'fetch', '--unshallow', 'origin', '+refs/heads/main:refs/remotes/origin/main', '+refs/tags/*:refs/tags/*') }
    $o = @(& git @words 2>&1 | ForEach-Object { "$_" })
    $deep = $LASTEXITCODE
    if ($deep -eq 0) {
        $o = @(& git -C $repo update-ref refs/remotes/origin/main $head 2>&1 | ForEach-Object { "$_" })
        $deep = $LASTEXITCODE
    }
}
$ErrorActionPreference = $was
if ($deep -ne 0) { Die ('main''s history and the release tags could not be fetched, and without them the DEV marks and the shipped issues cannot be worked out: ' + ($o -join ' ') + ' Nothing was published.') }

. (Join-Path $repo 'scripts\vps\admin\ShipAccess.ps1')
try { $token = Get-ThornswoodShipAccess -Repo $repo -AdminState $AdminState }
catch { Die ('the box admin App gave no token for the Ship: ' + $_.Exception.Message + ' Nothing was published.') }

$ship = @{ Notes = $notes; FromFeed = $true; NoPause = $true }
if ($Channel -eq 'dev') { $ship['Channel'] = 'dev' }
$env:GH_TOKEN = $token
$token = $null
try {
    & (Join-Path $Here 'Ship.ps1') @ship
    $code = $LASTEXITCODE
}
finally { Remove-Item -LiteralPath Env:\GH_TOKEN -ErrorAction SilentlyContinue }
exit $code
