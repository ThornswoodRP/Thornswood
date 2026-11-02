<#
.SYNOPSIS
  The pre-push hook's checks (#5291): every script parses and the writing
  rules hold, in the commit being pushed, before it leaves the machine.

.DESCRIPTION
  Git runs .githooks/pre-push, which runs this, when a clone has

      git config core.hooksPath .githooks

  (docs/guide/set-up-a-machine.md, "Clone the repository"; a cloud session sets it by
  itself, scripts/dev/Setup-CloudSession.sh). By hand, for HEAD:

      pwsh scripts/dev/Check-Push.ps1 -Commit HEAD

  WHY. The PowerShell parse and the writing rules are the cheapest checks the
  build check makes, and before this a push was the first place either ran:
  a script that did not parse, or a banned word in a README, cost a round of
  pull request checks (six jobs, about six minutes) to find. Here they take
  about twenty seconds.

  WHAT IT CHECKS. For each commit the push sends (git gives the hook one line
  per ref on its standard input: local ref, local commit, remote ref, remote
  commit), the two checks the build check's "Launcher builds" job makes, run
  from that commit's own copy of them so they are the ones GitHub will run:
      scripts/dev/Check-Parse.ps1   every PowerShell and game script parses
      scripts/dev/Check-Words.ps1   the Words section of docs/guide/rules.md
  side by side. A deleted ref sends nothing and is not checked. A commit the
  same as the checkout's HEAD, with no tracked file changed since, is checked
  in place; any other gets a detached worktree in the repository's temp
  folder (scripts/release/Get-ScratchDir.ps1), removed again afterwards
  whatever happened, because what is pushed is the commit, not the edits
  beside it.

  A commit from before #5291 has no Check-Parse.ps1, and its parse is said to
  be unchecked here rather than checked by a copy that is not its own.

  Exits 0 when everything passed, so git pushes; 1 when a check failed, so
  git does not push, and the lines above say which file and why; 2 when it
  could not check (not a git checkout, a commit git does not have).
  tests/test-5291-pre-push.ps1 holds all of this.
#>
[CmdletBinding()]
param(
    # Check this commit instead of reading git's lines from standard input.
    [string]$Commit = ''
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
function Say([string]$m) { Write-Host ('pre-push: ' + $m) }
function Stop-Here([string]$m) { Say ('STOP. ' + $m); exit 2 }

$shas = [System.Collections.Generic.List[string]]::new()
if ($Commit) {
    $s = (& git -C $Repo rev-parse --verify --quiet ($Commit + '^{commit}') 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $s) { Stop-Here ("git has no commit {0} here." -f $Commit) }
    $shas.Add($s.Trim())
} else {
    $lines = @()
    if ([Console]::IsInputRedirected) { $lines = @([Console]::In.ReadToEnd() -split "`r?`n" | Where-Object { $_.Trim() }) }
    foreach ($line in $lines) {
        $parts = $line.Trim() -split '\s+'
        if ($parts.Count -lt 4) { Stop-Here ("git gave the hook a line it does not understand: {0}" -f $line) }
        $local = $parts[1]
        if ($local -match '^0+$') { continue }   # a deleted ref
        $s = (& git -C $Repo rev-parse --verify --quiet ($local + '^{commit}') 2>$null)
        if ($LASTEXITCODE -ne 0 -or -not $s) {
            # A tag of something that is not a commit: nothing here to parse.
            Say ("{0} is not a commit, so there is nothing to check in it" -f $parts[0])
            continue
        }
        $s = $s.Trim()
        if (-not $shas.Contains($s)) { $shas.Add($s) }
    }
}
if (-not $shas.Count) { exit 0 }

$head = (& git -C $Repo rev-parse --verify --quiet HEAD 2>$null)
$dirty = @(& git -C $Repo status --porcelain --untracked-files=no 2>$null)
$failed = 0

foreach ($sha in $shas) {
    $short = $sha.Substring(0, 12)
    $tree = $Repo
    $made = ''
    if (-not ($head -and $head.Trim() -eq $sha -and -not $dirty.Count)) {
        $made = & (Join-Path $Repo 'scripts/release/Get-ScratchDir.ps1') ('pre-push-' + $short + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
        $null = & git -C $Repo worktree add --detach --quiet $made $sha 2>&1
        if ($LASTEXITCODE -ne 0) { Stop-Here ("git could not check out {0} to check it, in {1}." -f $short, $made) }
        $tree = $made
    }
    try {
        $checks = @(
            @{ Name = 'parse'; File = 'scripts/dev/Check-Parse.ps1' },
            @{ Name = 'writing rules'; File = 'scripts/dev/Check-Words.ps1' }
        )
        $runs = $checks | ForEach-Object -ThrottleLimit 2 -Parallel {
            $c = $_
            $tree = $using:tree
            $file = Join-Path $tree $c.File
            if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
                return [pscustomobject]@{ Name = $c.Name; Code = -1; Out = '' }
            }
            $out = & pwsh -NoProfile -File $file -Root $tree 2>&1 | Out-String
            [pscustomobject]@{ Name = $c.Name; Code = $LASTEXITCODE; Out = $out }
        }
        foreach ($c in $checks) {
            $r = $runs | Where-Object { $_.Name -eq $c.Name } | Select-Object -First 1
            if ($r.Code -eq -1) { Say ("{0}: this commit has no {1}, so its {2} is not checked here" -f $short, $c.File, $c.Name); continue }
            if ($r.Code -eq 0) { Say ("{0}: {1} passed" -f $short, $c.Name); continue }
            $failed++
            Write-Host $r.Out.TrimEnd()
            Say ("{0}: {1} FAILED (exit {2}), so this push stops here. The lines above say which file and why; fix it, commit, and push again." -f $short, $c.Name, $r.Code)
        }
    } finally {
        if ($made) {
            $null = & git -C $Repo worktree remove --force $made 2>&1
            if ($LASTEXITCODE -ne 0) { Say ("git could not remove the worktree {0}; git worktree remove --force on it takes it away." -f $made) }
        }
    }
}

if ($failed) { exit 1 }
exit 0
