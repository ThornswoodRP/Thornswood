<#
  Reset-History.ps1

  Replaces the repository's git history with one commit, once (issue #567).
  Decided by Patrick on 25 September: "We can delete the repo history anyways
  just as a safe measure I want like nice clean orgaized state", and, asked
  how far, main made fresh and every old branch deleted.

      .\scripts\oneoff\Reset-History.ps1 -DryRun     says what it would do, changes nothing
      .\scripts\oneoff\Reset-History.ps1             does it, after you type RESET

  WHAT IT DOES, IN ORDER. Every check comes before anything is changed.
    1. Stops unless gh is signed in, this checkout is on main and level with
       origin/main, nothing tracked is uncommitted, and no pull request is open.
    2. Writes the whole old history to a bundle file in your user folder,
       outside the repository. That file is the way back: git clone from it
       gives every old commit and branch. It holds exactly what GitHub held,
       so keep it private.
    3. Makes the new commits here with git commit-tree: one for main with
       main's tree exactly as it is, and one for hotfix/1.1.94-downgrade with
       that branch's tree, because live 1.1.94 was built from it and the next
       hotfix starts there. Nothing is merged or rebuilt; the files are the
       same files.
    4. Asks for RESET.
    5. Turns on force pushes for main, pushes the new main, and turns them off
       again whatever happens, then reads the setting back. Everything else in
       branch protection is written back as it was read.
    6. Pushes the new hotfix commit, deletes every other branch on GitHub, and
       turns on "Automatically delete head branches" so merged branches stop
       piling up (docs/guide/how-work-moves.md).
    7. Moves this checkout onto the new main. Your local branches are listed,
       not deleted: some may hold work that was never pushed.

  WHAT IT CANNOT DO. GitHub keeps every pull request's commits for good, and
  nobody can delete them, so the old commits stay reachable from the old pull
  request pages. What anybody clones is clean. The engine fork
  (EvilPatrick06/skymp) and Thornswood-Releases are other repositories and are
  not touched; the engine\skymp pin is part of the tree and stays.

  AFTER IT. Every other clone is on history that no longer exists. Each other
  developer runs, in their checkout, on main:
      git fetch origin --prune
      git reset --hard origin/main
  or clone again. Their engine\skymp submodule is unaffected.
#>
[CmdletBinding()]
param(
    [switch]$DryRun,
    # For the harness: skip the typed RESET.
    [switch]$Yes,
    [string]$Repo = 'EvilPatrick06/Thornswood',
    # Kept, as a fresh single commit, because the live release was built from it.
    [string]$Hotfix = 'hotfix/1.1.94-downgrade',
    [string]$BundleDir = [Environment]::GetFolderPath('UserProfile')
)

$ErrorActionPreference = 'Stop'
function Say([string]$t, [string]$c = 'Gray') { Write-Host $t -ForegroundColor $c }
function Head([string]$t) { Write-Host ''; Write-Host $t -ForegroundColor Cyan; Write-Host ('-' * $t.Length) -ForegroundColor Cyan }
function Die([string]$t) { Write-Host ''; Write-Host ('STOP. ' + $t) -ForegroundColor Red; exit 1 }
# Every git and gh call goes through these. Both write progress to stderr, and
# Windows PowerShell 5.1 with Stop turns the first such line into an error, so
# inside them it is Continue and the exit code alone decides.
function GhRun { $ErrorActionPreference = 'Continue'; if ($MyInvocation.ExpectingInput) { $input | & gh @args 2>$null } else { & gh @args 2>$null } }
function GitTry { $ErrorActionPreference = 'Continue'; & git @args 2>&1 | Out-Null }
function Git1 { $ErrorActionPreference = 'Continue'; $o = & git @args 2>&1; if ($LASTEXITCODE -ne 0) { throw ('git ' + ($args -join ' ') + ' failed: ' + ($o | Out-String).Trim()) }; return $o }

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $root

# ---- 1. checks -------------------------------------------------------------
Head 'Checks'
GhRun auth status | Out-Null
if ($LASTEXITCODE -ne 0) { Die 'gh is not signed in. Run: gh auth login' }
Git1 fetch origin --prune | Out-Null
$branch = (Git1 rev-parse --abbrev-ref HEAD | Out-String).Trim()
if ($branch -ne 'main') { Die "This checkout is on $branch. Run: git checkout main" }
$head = (Git1 rev-parse HEAD | Out-String).Trim()
$oldMain = (Git1 rev-parse origin/main | Out-String).Trim()
if ($head -ne $oldMain) { Die 'This checkout is not level with origin/main. Run: git pull' }
$dirty = @(Git1 status --porcelain --ignore-submodules=all | Where-Object { "$_" -and "$_" -notlike '`?`? *' })
if ($dirty.Count) { Die ('Tracked files have changes that are not committed: ' + (($dirty | ForEach-Object { "$_".Trim() }) -join ', ')) }
$open = (GhRun pr list --repo $Repo --state open --json number --jq 'length' | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { Die 'gh could not list the open pull requests.' }
if ($open -ne '0') { Die "$open pull request(s) are open. Merge or close them first (gh pr list --repo $Repo)." }
Say '  gh signed in, on main at origin/main, nothing uncommitted, no open pull request' 'Green'

$heads = @(Git1 ls-remote --heads origin | ForEach-Object { ("$_" -split "`t")[1] -replace '^refs/heads/', '' } | Where-Object { $_ })
$hasHotfix = $heads -contains $Hotfix
$doomed = @($heads | Where-Object { $_ -ne 'main' -and $_ -ne $Hotfix })
Say ("  branches on GitHub: {0}; kept: main{1}; deleted: {2}" -f $heads.Count, $(if ($hasHotfix) { ", $Hotfix" } else { '' }), $doomed.Count)

# ---- 2. the way back -------------------------------------------------------
Head 'The old history, saved here'
$stamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
$bundle = Join-Path $BundleDir "Thornswood-history-before-reset-$stamp.bundle"
if ($DryRun) { Say "  would write $bundle" 'Yellow' }
else {
    Git1 bundle create $bundle --all | Out-Null
    Git1 bundle verify $bundle | Out-Null
    Say "  $bundle" 'Green'
    Say '  every old commit and branch; git clone that file gets them back. Keep it private.' 'Gray'
}

# ---- 3. the new commits ----------------------------------------------------
Head 'The new commits'
$today = Get-Date -Format 'd MMMM yyyy'
$tree = (Git1 rev-parse 'origin/main^{tree}' | Out-String).Trim()
$msg = "Thornswood as of $today`n`nThe history before this commit was removed on purpose (issue #567).`nThis is main's tree at $($oldMain.Substring(0,8)), unchanged."
$newMain = (Git1 commit-tree $tree -m $msg | Out-String).Trim()
Say "  main: $($newMain.Substring(0,8)), tree $($tree.Substring(0,8)), the same as origin/main" 'Green'
$newHotfix = $null
if ($hasHotfix) {
    $hOld = (Git1 rev-parse "origin/$Hotfix" | Out-String).Trim()
    $hTree = (Git1 rev-parse "origin/$Hotfix^{tree}" | Out-String).Trim()
    $hMsg = "$Hotfix as of $today`n`nThe tree live 1.1.94 was built from, at $($hOld.Substring(0,8)), kept for the next hotfix (issue #567)."
    $newHotfix = (Git1 commit-tree $hTree -m $hMsg | Out-String).Trim()
    Say "  $($Hotfix): $($newHotfix.Substring(0,8)), tree $($hTree.Substring(0,8))" 'Green'
}
if ((Git1 rev-parse "$newMain^{tree}" | Out-String).Trim() -ne $tree) { Die 'The new commit does not have main''s tree. Nothing was pushed.' }

if ($DryRun) {
    Head 'Dry run'
    Say '  would turn force pushes on for main, push the new main, turn them off again' 'Yellow'
    if ($hasHotfix) { Say "  would push the new $Hotfix" 'Yellow' }
    Say ("  would delete {0} branches: {1}" -f $doomed.Count, ($doomed -join ', ')) 'Yellow'
    Say '  would turn on "Automatically delete head branches"' 'Yellow'
    Say '  would move this checkout onto the new main' 'Yellow'
    Say ''
    Say 'Dry run finished. Nothing was changed, here or on GitHub.' 'Yellow'
    exit 0
}

# ---- 4. the one question ---------------------------------------------------
if (-not $Yes) {
    Say ''
    Say 'This replaces main on GitHub and deletes the branches above. It cannot be undone' 'Yellow'
    Say "from GitHub; the bundle above is the way back." 'Yellow'
    $answer = Read-Host 'Type RESET to go on'
    if ($answer -cne 'RESET') { Die 'Not RESET. Nothing on GitHub was changed; the bundle is written.' }
}

# ---- 5. main, with force pushes on for the one push ------------------------
Head 'main'
$protJson = (GhRun api "repos/$Repo/branches/main/protection" | Out-String)
if ($LASTEXITCODE -ne 0) { Die 'gh could not read branch protection on main. Nothing was pushed.' }
$saved = Join-Path $BundleDir "Thornswood-main-protection-$stamp.json"
Set-Content -LiteralPath $saved -Value $protJson -Encoding UTF8
$p = $protJson | ConvertFrom-Json

function Put-Protection([bool]$force) {
    $on = { param($x) [bool]($x -and $x.enabled) }
    $checks = $null
    if ($p.required_status_checks) { $checks = @{ strict = [bool]$p.required_status_checks.strict; contexts = @($p.required_status_checks.contexts) } }
    $reviews = $null
    if ($p.required_pull_request_reviews) {
        $r = $p.required_pull_request_reviews
        $reviews = @{ required_approving_review_count = [int]$r.required_approving_review_count
                      require_code_owner_reviews = [bool]$r.require_code_owner_reviews
                      dismiss_stale_reviews = [bool]$r.dismiss_stale_reviews
                      require_last_push_approval = [bool]$r.require_last_push_approval }
    }
    $body = @{
        required_status_checks = $checks
        enforce_admins = (& $on $p.enforce_admins)
        required_pull_request_reviews = $reviews
        restrictions = $null
        required_linear_history = (& $on $p.required_linear_history)
        allow_force_pushes = $force
        allow_deletions = (& $on $p.allow_deletions)
        block_creations = (& $on $p.block_creations)
        required_conversation_resolution = (& $on $p.required_conversation_resolution)
        lock_branch = (& $on $p.lock_branch)
        allow_fork_syncing = (& $on $p.allow_fork_syncing)
    }
    $json = $body | ConvertTo-Json -Depth 5 -Compress
    $json | GhRun api -X PUT "repos/$Repo/branches/main/protection" --input - | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "gh could not set branch protection (allow_force_pushes $force)" }
}

$pushed = $false
$why = ''
try {
    Put-Protection $true
    Say '  force pushes on, for this push' 'DarkGray'
    Git1 push --force origin "$($newMain):refs/heads/main" | Out-Null
    $pushed = $true
    Say "  main is $($newMain.Substring(0,8)) on GitHub" 'Green'
}
catch { $why = $_.Exception.Message }
finally {
    try { Put-Protection $false } catch { Say ('  COULD NOT TURN FORCE PUSHES OFF AGAIN: ' + $_.Exception.Message) 'Red' }
}
$after = (GhRun api "repos/$Repo/branches/main/protection" --jq '.allow_force_pushes.enabled' | Out-String).Trim()
if ($after -ne 'false') { Say "  force pushes read back as '$after'. Turn them off in Settings, Branches, main. The saved setting is $saved" 'Red' }
else { Say '  force pushes off again, read back from GitHub' 'Green' }
if (-not $pushed) { Die ("main was not replaced: $why`nNothing else was changed on GitHub; the bundle is written.") }

# ---- 6. the other branches -------------------------------------------------
Head 'Branches'
if ($newHotfix) {
    Git1 push --force origin "$($newHotfix):refs/heads/$Hotfix" | Out-Null
    Say "  $Hotfix is $($newHotfix.Substring(0,8))" 'Green'
}
$failed = @()
for ($i = 0; $i -lt $doomed.Count; $i += 20) {
    $chunk = @($doomed[$i..([Math]::Min($i + 19, $doomed.Count - 1))])
    GitTry push origin --delete @chunk
    if ($LASTEXITCODE -ne 0) { $failed += $chunk }
}
$left = @(Git1 ls-remote --heads origin | ForEach-Object { ("$_" -split "`t")[1] -replace '^refs/heads/', '' } | Where-Object { $_ -and $_ -ne 'main' -and $_ -ne $Hotfix })
if ($left.Count) { Say ('  still there: ' + ($left -join ', ')) 'Red' } else { Say ("  {0} deleted; main{1} left" -f $doomed.Count, $(if ($newHotfix) { " and $Hotfix" } else { '' })) 'Green' }
GhRun api -X PATCH "repos/$Repo" -F delete_branch_on_merge=true | Out-Null
if ($LASTEXITCODE -eq 0) { Say '  "Automatically delete head branches" is on' 'Green' } else { Say '  could not turn on "Automatically delete head branches"; it is in Settings, General' 'Red' }

# ---- 7. this checkout ------------------------------------------------------
Head 'This checkout'
Git1 fetch origin --prune | Out-Null
Git1 reset --hard origin/main | Out-Null
Say "  main is $($newMain.Substring(0,8)), the same files as before" 'Green'
$locals = @(Git1 branch --format '%(refname:short)' | Where-Object { $_ -and $_ -ne 'main' })
if ($locals.Count) {
    Say ('  local branches left alone, on the old history: ' + ($locals -join ', ')) 'Yellow'
    Say '  delete each with git branch -D <name> once you know it holds nothing unpushed.' 'Gray'
}
Say ''
Say 'Done. Every other clone: git fetch origin --prune, then git reset --hard origin/main, on main.' 'Cyan'
exit 0
