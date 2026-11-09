<#
  Rebuild-PullTables.ps1

  Rebuilds the content tables for a pull request on the box and commits them
  back to its branch, in one run, from any session gh is signed in on, a
  cloud thread included (#4322):

      pwsh scripts/mods/Rebuild-PullTables.ps1 -Pull 4835
      pwsh scripts/mods/Rebuild-PullTables.ps1 -Pull 1387 -Stations
      pwsh scripts/mods/Rebuild-PullTables.ps1 -Pull 4835 -Run 1234567890

  WHY. The recipe, ore and other content tables are read out of the whole
  load order (Skyrim.esm, the DLCs and the collection), which is on a game PC
  and on the box and never in this repository. Since 30 Oct the deploy gate's
  Rebuild-ContentTables verb rebuilds them on the box from a pull request's
  data (scripts\mods\Rebuild-OnBox.ps1 says which files), and Box-Run.ps1
  brings the tables back sealed into this machine's temp\box-run\<run>\files.
  Nothing put them on the branch: every recipe change still waited on
  somebody copying them into a checkout and committing them by hand.

  WHAT IT DOES.
    1. Reads the pull request with gh: its head commit and branch. One from
       another repository is refused, since its branch cannot be pushed to
       from here.
    2. Holds this checkout to that head, with nothing uncommitted, so the
       tables are built from the commit they land on and are committed alone.
    3. Starts the verb through scripts\vps\Box-Run.ps1 with that head:
           Rebuild-ContentTables [-Server main] [-Stations] -Pull <n> -Head <sha>
       The gate runs main's builders, never this branch's (Rebuild-OnBox.ps1).
    4. Takes the files only when the run ended 0 and its own output says it
       built this pull request at this head, and only paths the box may send
       back: game, records, docs\systems and the other files a step of
       scripts\mods\content-tables.json writes, the list Run-OnBox.ps1 holds
       the box to. One file outside it and nothing is copied.
    5. Commits what changed and pushes it to the pull request's branch. When
       nothing changed, the branch already has these tables and nothing is
       committed.

  -Run reads a run Box-Run.ps1 already started (when its answer came after
  Box-Run.ps1 stopped waiting) and puts its files on the branch the same way,
  held to the same head.

  -Gh and -BoxRun are what it runs for gh and Box-Run.ps1;
  tests\test-4322-pull-tables.ps1 hands it stand-ins.

  Exit 0 when the tables are on the branch (or already were), 1 when it
  stopped, with a line starting STOP that says why and what was left as it was.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [int]$Pull,
    # Whose plugins the box builds against: the dev server's or live's.
    [ValidateSet('dev', 'main')]
    [string]$Server = 'dev',
    # Measure the stations and write the content plugin before the chain.
    [switch]$Stations,
    # A run Box-Run.ps1 already started, to read again instead of starting one.
    [long]$Run = 0,
    [string]$Gh = 'gh',
    [string]$BoxRun = ''
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = (Resolve-Path -LiteralPath (Join-Path $Here '../..')).ProviderPath
if (-not $BoxRun) { $BoxRun = Join-Path (Join-Path (Join-Path $repo 'scripts') 'vps') 'Box-Run.ps1' }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Stop-Here([string]$m) { Write-Host "STOP. $m" -ForegroundColor Red; exit 1 }
function Invoke-Git([string[]]$Words) {
    $was = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $o = @(& git -C $repo @Words 2>&1 | ForEach-Object { "$_" }) } finally { $ErrorActionPreference = $was }
    return [pscustomobject]@{ Out = $o; Code = $LASTEXITCODE }
}

if ($Pull -le 0) { Stop-Here 'name the pull request by its number. Nothing was run.' }

# ---- 1. the pull request ---------------------------------------------------
$was = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
try { $raw = @(& $Gh pr view "$Pull" --json 'headRefOid,headRefName,state,isCrossRepository' 2>&1 | ForEach-Object { "$_" }) -join "`n"; $ghCode = $LASTEXITCODE }
finally { $ErrorActionPreference = $was }
$pr = $null
if ($ghCode -eq 0) { try { $pr = $raw | ConvertFrom-Json } catch { $pr = $null } }
if (-not $pr -or [string]$pr.headRefOid -cnotmatch '^[0-9a-f]{40}$' -or -not [string]$pr.headRefName) {
    Stop-Here ("gh could not read pull request $Pull (" + ($raw.Trim() -replace '\s+', ' ') + '). Nothing was run.')
}
if ([string]$pr.state -ne 'OPEN') { Stop-Here "pull request $Pull is $($pr.state), not open. Nothing was run." }
if ($pr.isCrossRepository -eq $true) { Stop-Here "pull request $Pull comes from another repository, whose branch cannot be pushed to from here. Nothing was run." }
$head = [string]$pr.headRefOid
$branch = [string]$pr.headRefName

# ---- 2. this checkout ------------------------------------------------------
$at = ((Invoke-Git @('rev-parse', 'HEAD')).Out -join '').Trim()
if ($at -cne $head) {
    Stop-Here "this checkout is at $at, and pull request $Pull's head is $head. Push this branch, or check out that head, then run this again, so the tables are built from the commit they land on. Nothing was run."
}
$dirty = @((Invoke-Git @('status', '--porcelain')).Out | Where-Object { $_ })
if ($dirty.Count) {
    Stop-Here ("this checkout has changes that are not committed (" + (($dirty | Select-Object -First 5) -join '; ') + "). Commit them or set them aside first, so the tables are committed alone. Nothing was run.")
}

# ---- 3. the run ------------------------------------------------------------
if ($Run) {
    Say "  reading run $Run again for pull request $Pull at $head" 'White'
    & $BoxRun -Run $Run 6>&1 | ForEach-Object { Write-Host $_ }
    $code = $LASTEXITCODE
} else {
    $line = 'Rebuild-ContentTables' + $(if ($Server -ne 'dev') { " -Server $Server" } else { '' }) + $(if ($Stations) { ' -Stations' } else { '' }) + " -Pull $Pull -Head $head"
    & $BoxRun -Line $line 6>&1 | ForEach-Object {
        Write-Host $_
        if ("$_" -match '^\s*run ([0-9]+), ') { $script:Run = [long]$Matches[1] }
    }
    $code = $LASTEXITCODE
    if (-not $Run) { Stop-Here "Box-Run.ps1 started no run (it ended $code, and what it said is above). Nothing was committed." }
}
if ($code -ne 0) { Stop-Here "run $Run ended $code, so its tables are not put on the branch. What it said is above. Nothing was committed." }

# ---- 4. what came back -----------------------------------------------------
$scratch = & (Join-Path (Join-Path (Join-Path $repo 'scripts') 'release') 'Get-ScratchDir.ps1') 'box-run'
$dir = Join-Path $scratch "$Run"
$said = Join-Path $dir 'output.txt'
$built = "from pull request $Pull at $head"
if (-not (Test-Path -LiteralPath $said) -or -not ([IO.File]::ReadAllText($said)).Contains($built)) {
    Stop-Here "run $Run's output does not say main's builders read $($built.Substring(5)), so its tables may be another commit's and are not put on the branch. Nothing was committed."
}

# What the box may send back: Run-OnBox.ps1's own list.
$chain = [IO.File]::ReadAllText((Join-Path $Here 'content-tables.json')) | ConvertFrom-Json
$watch = @('game', 'records', 'docs/systems')
foreach ($p in @($chain.steps | ForEach-Object { @($_.writes) } | Where-Object { $_ })) {
    $p = [string]$p
    if (-not @($watch | Where-Object { $p -eq $_ -or $p.StartsWith($_ + '/') }).Count) { $watch += $p }
}
$filesDir = Join-Path $dir 'files'
$files = @(if (Test-Path -LiteralPath $filesDir) { Get-ChildItem -LiteralPath $filesDir -Recurse -File })
$filesRoot = if (Test-Path -LiteralPath $filesDir) { (Get-Item -LiteralPath $filesDir).FullName.TrimEnd('\', '/') } else { '' }
$take = @()
foreach ($f in $files) {
    $rel = $f.FullName.Substring($filesRoot.Length).TrimStart('\', '/').Replace('\', '/')
    if ($rel -match '(^|/)\.\.?(/|$)' -or -not @($watch | Where-Object { $rel -eq $_ -or $rel.StartsWith($_ + '/') }).Count) {
        Stop-Here "run $Run sent back $rel, which is not under $($watch -join ', '). Nothing was copied or committed."
    }
    $take += [pscustomobject]@{ Rel = $rel; From = $f.FullName }
}
foreach ($t in $take) {
    $dest = Join-Path $repo $t.Rel
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
    Copy-Item -LiteralPath $t.From -Destination $dest -Force
}

# ---- 5. the branch ---------------------------------------------------------
$changed = @((Invoke-Git @('status', '--porcelain')).Out | Where-Object { $_ })
if (-not $changed.Count) {
    Say ''
    Say "  the branch already has the tables run $Run built for pull request $Pull at $head. Nothing to commit." 'Green'
    exit 0
}
$add = Invoke-Git (@('add', '--') + @($take | ForEach-Object { $_.Rel }))
if ($add.Code -ne 0) { Stop-Here ('git add refused the tables: ' + ($add.Out -join ' ') + ' They are in this checkout, not committed.') }
$c = Invoke-Git @('commit', '--quiet', '-m', "Rebuild the content tables for pull request #$Pull", '-m', "Built on the box by run $Run with main's builders, from $head (scripts/mods/Rebuild-PullTables.ps1).")
if ($c.Code -ne 0) { Stop-Here ('the tables could not be committed: ' + ($c.Out -join ' ') + ' They are in this checkout, not committed.') }
$new = ((Invoke-Git @('rev-parse', 'HEAD')).Out -join '').Trim()
$p = Invoke-Git @('push', '--quiet', 'origin', "HEAD:refs/heads/$branch")
if ($p.Code -ne 0) { Stop-Here ("the tables are committed here as $new, and the push to $branch was refused: " + ($p.Out -join ' ') + ' Nothing on GitHub changed.') }

Say ''
Say "  $($changed.Count) file(s) committed as $new and pushed to $branch:" 'Green'
foreach ($l in $changed) { Say ('    ' + $l) }
exit 0
