# Fresh-Checkout.ps1
#
# Deploy and ship scripts refuse a stale or dirty checkout (#2118).
#
# WHY. Two machines and several worktrees deploy from this repo. A deploy from
# a clone that is behind main sends yesterday's code to the VPS, and quietly
# takes back whatever the last push fixed. A deploy from a clone with changes
# nobody committed sends code that exists on one disk only. Both have happened.
#
# WHAT. Assert-FreshCheckout fetches origin, then refuses unless HEAD is
# exactly origin/main (or origin/<branch> with -AnyBranch, for the dev paths
# that may run off a branch) and nothing tracked is changed. Each refusal says
# which of the four it is: behind, ahead, diverged or dirty, and what to run.
#
# A SUBMODULE BEHIND ITS PIN (#2981). engine\skymp at another commit than the
# one HEAD pins is a tracked change to git, and a refusal like any other. It
# is named apart because nobody made it: a checkout moved with a bare git
# checkout or git pull leaves the submodule where it was, so each time main's
# pin moved the shared clone on One fell one more behind, through three pins.
# The refusal says which submodule, at what and pinned to what, and Fix names
# scripts\release\Update-Checkout.ps1, which moves the checkout with it.
#
# FIX is the one line that closes the refusal, so Check-ShipReady.ps1 can
# print what Ship would have said and what to run, from the same answer.
#
# THE ONE WAY PAST IT is -AllowStale, which each caller exposes as
# -AllowStaleCheckout. It prints a banner nobody can miss and carries on.
#
# LOADED UNDER STOP (#3006). Every caller sets $ErrorActionPreference to
# Stop before it dot-sources this file. Under Continue a missing or broken
# copy is an error PowerShell prints and walks past, Assert-FreshCheckout is
# then "not recognized", and the deploy or Ship goes on unchecked: Ship did
# exactly that until #3006. tests\test-3006-loads-under-stop.ps1 holds every
# script to it.
#
# ONCE PER RUN. A script that calls another (Ship calling Publish-Server)
# would fetch twice. The first pass writes the commit it passed in
# THORNSWOOD_FRESH_CHECKED, and a later call at the same commit in the same
# process skips the fetch.
#
# GIT IS JUDGED BY ITS EXIT CODE. Under Stop, Windows PowerShell 5.1 turns a
# line git writes to stderr into a NativeCommandError even through 2>$null,
# so every git call here runs under Continue for itself only.
#
# THE HARNESS STAND-IN, and nothing else, is let through without a check:
# the tests run these scripts whole against stand-in ssh and scp and a
# pretend box on this machine, from a checkout that is a pull request's head
# and so never origin/main. A run counts as the stand-in only when BOTH are
# true: THORNSWOOD_HARNESS is 1, AND the box it would send to (the -Vps it
# was handed, or THORNSWOOD_VPS when it takes none) is one that can never be
# a real server: harness.invalid (.invalid is reserved by RFC 2606 and never
# resolves) or this machine's own loopback, 127.0.0.1, ::1 or localhost,
# which the harnesses' pretend boxes listen on. tests\test-fresh-checkout.ps1
# fails if the live or dev host, or any host a script names, is ever one.
$script:FreshHarnessHosts = @('harness.invalid', '127.0.0.1', '::1', 'localhost')

function Test-FreshHarnessStandIn {
    param([string]$Target)
    if ($env:THORNSWOOD_HARNESS -ne '1') { return $false }
    $t = if ($Target) { $Target } else { [string]$env:THORNSWOOD_VPS }
    return ($script:FreshHarnessHosts -contains $t.Trim().ToLowerInvariant())
}
# Not a git clone at all (a copy of the scripts on some other box): refused
# too, since there is nothing to say what it was built from, unless
# -AllowStale.

function Invoke-FreshGit {
    param([string]$RepoDir, [string[]]$GitArgs)
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & git -C $RepoDir @GitArgs 2>$null
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $old }
    return [pscustomobject]@{ Code = $code; Out = @($out | Where-Object { $null -ne $_ } | ForEach-Object { "$_" }) }
}

# Which of the changed paths git status gave are a submodule at another
# commit than HEAD pins: one object each with its path, the pin and the commit
# it is at. A path git keeps as a gitlink (mode 160000) is a submodule.
function Get-FreshSubmoduleDrift {
    param([Parameter(Mandatory)][string]$RepoDir, [string[]]$Lines)
    $out = @()
    foreach ($l in @($Lines)) {
        if (-not $l -or $l.Length -lt 4) { continue }
        $path = $l.Substring(3).Trim().Trim('"')
        $st = Invoke-FreshGit $RepoDir @('ls-files', '--stage', '--', $path)
        if ($st.Code -ne 0 -or -not $st.Out.Count -or -not $st.Out[0].StartsWith('160000 ')) { continue }
        $pin = Invoke-FreshGit $RepoDir @('rev-parse', "HEAD:$path")
        $have = Invoke-FreshGit (Join-Path $RepoDir $path) @('rev-parse', 'HEAD')
        $out += [pscustomobject]@{
            Path = $path
            Pin  = $(if ($pin.Code -eq 0 -and $pin.Out.Count) { $pin.Out[0].Trim() } else { '' })
            Have = $(if ($have.Code -eq 0 -and $have.Out.Count) { $have.Out[0].Trim() } else { '' })
        }
    }
    return $out
}

function Get-FreshShort([string]$Sha) { return $Sha.Substring(0, [Math]::Min(8, $Sha.Length)) }

function Get-FreshCheckoutState {
    param([Parameter(Mandatory)][string]$RepoDir, [switch]$AnyBranch, [switch]$NoFetch)
    $r = [ordered]@{ Ok = $false; Problem = ''; Message = ''; Fix = ''; Branch = ''; Target = ''; Ahead = 0; Behind = 0; Dirty = 0; Submodules = @(); Head = '' }
    $update = '.\scripts\release\Update-Checkout.ps1'
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { $r.Problem = 'nogit'; $r.Message = 'git is not on this machine, so the checkout cannot be checked'; $r.Fix = 'winget install --id Git.Git -e'; return [pscustomobject]$r }
    # The top, the commit and the branch in one git (#3835: every git started
    # on the box is a process and a Defender scan). It fails as a whole in a
    # clone with no commit yet, so only then is the top asked alone.
    $at = Invoke-FreshGit $RepoDir @('rev-parse', '--show-toplevel', 'HEAD', '--abbrev-ref', 'HEAD')
    if ($at.Code -eq 0 -and $at.Out.Count -eq 3) {
        $r.Head = $at.Out[1].Trim()
        $r.Branch = $at.Out[2].Trim()
    } else {
        $top = Invoke-FreshGit $RepoDir @('rev-parse', '--show-toplevel')
        if ($top.Code -ne 0) { $r.Problem = 'notrepo'; $r.Message = "$RepoDir is not a git checkout, so nothing says what it was built from"; $r.Fix = 'git clone https://github.com/ThornswoodRP/Thornswood.git'; return [pscustomobject]$r }
    }
    $want = 'main'
    if ($AnyBranch -and $r.Branch -and $r.Branch -ne 'HEAD') { $want = $r.Branch }
    $r.Target = "origin/$want"
    if (-not $NoFetch) {
        $f = Invoke-FreshGit $RepoDir @('fetch', '--quiet', 'origin', $want)
        if ($f.Code -ne 0) {
            # A branch GitHub has never heard of fails the fetch too; ls-remote exits 2 for that one.
            $lr = Invoke-FreshGit $RepoDir @('ls-remote', '--exit-code', '--heads', 'origin', $want)
            if ($lr.Code -eq 2) { $r.Problem = 'noremote'; $r.Message = "$($r.Target) does not exist. Push the branch first: git push -u origin $want"; $r.Fix = "git push -u origin $want"; return [pscustomobject]$r }
        }
        if ($f.Code -ne 0) { $r.Problem = 'nofetch'; $r.Message = "could not fetch $($r.Target) (git exited $($f.Code)), so there is no telling whether this checkout is current"; $r.Fix = "git fetch origin $want, which says why it cannot"; return [pscustomobject]$r }
    }
    $v = Invoke-FreshGit $RepoDir @('rev-parse', '--verify', '--quiet', "refs/remotes/origin/$want")
    if ($v.Code -ne 0) { $r.Problem = 'noremote'; $r.Message = "$($r.Target) does not exist. Push the branch first: git push -u origin $want"; $r.Fix = "git push -u origin $want"; return [pscustomobject]$r }
    $c = Invoke-FreshGit $RepoDir @('rev-list', '--left-right', '--count', "HEAD...$($r.Target)")
    if ($c.Code -ne 0 -or -not $c.Out.Count) { $r.Problem = 'nocount'; $r.Message = "could not compare HEAD with $($r.Target) (git exited $($c.Code))"; $r.Fix = "git rev-list --left-right --count HEAD...$($r.Target), which says why it cannot"; return [pscustomobject]$r }
    $bits = ($c.Out[0].Trim() -split '\s+')
    $r.Ahead = [int]$bits[0]; $r.Behind = [int]$bits[1]
    $s = Invoke-FreshGit $RepoDir @('status', '--porcelain', '--untracked-files=no')
    if ($s.Code -ne 0) { $r.Problem = 'nostatus'; $r.Message = "git status failed (exited $($s.Code))"; $r.Fix = 'git status, which says why it cannot'; return [pscustomobject]$r }
    $changed = @($s.Out | Where-Object { $_.Trim() })
    $r.Dirty = $changed.Count
    $detached = ($r.Branch -eq 'HEAD')
    if ($r.Ahead -gt 0 -and $r.Behind -gt 0) {
        $r.Problem = 'diverged'; $r.Message = "checkout has diverged from $($r.Target): $($r.Ahead) commit(s) only here and $($r.Behind) only there. Rebase onto $($r.Target) and push, or start from a fresh worktree"
        $r.Fix = "git rebase $($r.Target), then push and land it through a pull request"
    } elseif ($r.Behind -gt 0) {
        # A detached checkout, the shared clone on One, has no branch for git
        # pull to move; Update-Checkout moves it, and its submodule with it.
        $how = $(if ($detached) { $update } else { 'git pull' })
        $r.Problem = 'behind'; $r.Message = "checkout is behind $want by $($r.Behind) commit(s), run $how"
        $r.Fix = $how
    } elseif ($r.Ahead -gt 0) {
        $r.Problem = 'ahead'; $r.Message = "checkout is ahead of $want by $($r.Ahead) commit(s) that are not on GitHub. Land them through a pull request first, so what is deployed is what is on $($r.Target)"
        $r.Fix = 'Move them to a branch, push it and merge its pull request'
    }
    if ($r.Dirty -gt 0) {
        $r.Submodules = @(Get-FreshSubmoduleDrift -RepoDir $RepoDir -Lines $changed)
        $d = "checkout has $($r.Dirty) uncommitted change(s) to tracked files"
        $subs = @($r.Submodules | ForEach-Object {
            "$($_.Path) is at $(if ($_.Have) { Get-FreshShort $_.Have } else { 'no commit' }), not the $(Get-FreshShort $_.Pin) this commit pins"
        })
        if ($subs.Count) {
            $d = $d + ': ' + ($subs -join ', ') + '. Nobody made that change: the checkout moved and the submodule did not. ' + $update + ' brings it to the pin'
        }
        $rest = $r.Dirty - $r.Submodules.Count
        $put = 'through a pull request or put them back (git status shows which)'
        if ($rest -gt 0) {
            $d = $d + $(if ($subs.Count) { ". Commit the other $rest " } else { '. Commit them ' }) + $put
        }
        $dfix = @()
        if ($subs.Count) { $dfix += $update }
        if ($rest -gt 0) { $dfix += ('Commit ' + $(if ($subs.Count) { 'the other changes' } else { 'them' }) + ' ' + $put) }
        $dfix = $dfix -join '; and '
        if ($r.Problem) { $r.Message = $r.Message + '; and ' + $d; $r.Fix = $r.Fix + '; and ' + $dfix }
        else { $r.Problem = 'dirty'; $r.Message = $d; $r.Fix = $dfix }
    }
    if (-not $r.Problem) { $r.Ok = $true; $r.Message = "checkout is $($r.Target) at $(Get-FreshShort $r.Head), clean" }
    return [pscustomobject]$r
}

# WHICH BRANCH A RELEASE MAY COME FROM, ONE ANSWER FOR SHIP AND PUBLISH-UPDATE
# (#2235). A dev release may ship any pushed branch; a live (main) release
# ships from main, or from a hotfix/ branch (Ship's git gate holds the rest).
# Until 11 October Ship asked with -AnyBranch and Publish-Update, which Ship
# calls after building, signing and installing the launcher, asked without
# it, so a dev Ship from a branch got halfway and then Publish-Update refused
# it as "diverged from origin/main". Both now ask this, with their -Channel.
function Test-FreshAnyBranch {
    param([Parameter(Mandatory)][string]$RepoDir, [string]$Channel = 'main')
    if ($Channel -eq 'dev') { return $true }
    $br = Invoke-FreshGit $RepoDir @('rev-parse', '--abbrev-ref', 'HEAD')
    $b = if ($br.Code -eq 0 -and $br.Out.Count) { $br.Out[0].Trim() } else { '' }
    return ($b -like 'hotfix/*')
}

function Assert-FreshCheckout {
    param(
        [Parameter(Mandatory)][string]$RepoDir,
        [string]$What = 'This',
        [switch]$AnyBranch,
        [switch]$AllowStale,
        [string]$Target = ''
    )
    if (Test-FreshHarnessStandIn $Target) { Write-Host '  freshness: the harness stand-in box, not checked' -ForegroundColor DarkGray; return }
    $headNow = Invoke-FreshGit $RepoDir @('rev-parse', 'HEAD')
    $key = if ($headNow.Code -eq 0 -and $headNow.Out.Count) { $headNow.Out[0].Trim() + '|' + [bool]$AnyBranch } else { '' }
    if ($key -and $env:THORNSWOOD_FRESH_CHECKED -eq $key) { return }
    $st = Get-FreshCheckoutState -RepoDir $RepoDir -AnyBranch:$AnyBranch
    if ($st.Ok) {
        Write-Host ("  " + $st.Message) -ForegroundColor DarkGray
        if ($key) { $env:THORNSWOOD_FRESH_CHECKED = $key }
        return
    }
    if ($AllowStale) {
        $bar = '!' * 78
        Write-Host $bar -ForegroundColor Red
        Write-Host '!!  -AllowStaleCheckout: GOING AHEAD FROM A CHECKOUT THAT IS NOT CURRENT' -ForegroundColor Red
        Write-Host ('!!  ' + $st.Message) -ForegroundColor Yellow
        Write-Host '!!  What goes out may undo work already on GitHub. Say so in the dev channel.' -ForegroundColor Yellow
        Write-Host $bar -ForegroundColor Red
        return
    }
    throw ("$What refused: " + $st.Message + '. Nothing was sent. (-AllowStaleCheckout overrides this, loudly.)')
}