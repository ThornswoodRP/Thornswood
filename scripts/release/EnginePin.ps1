<#
  EnginePin.ps1

  What moves the engine pin by itself (#5148), dot-sourced by
  Update-EnginePin.ps1, Write-EnginePinText.ps1 and .github\workflows\engine-pin.yml.

  WHY. Until #5148 every fork merge waited on six hand steps before it reached
  a release: wait for the fork's push build, run engine.yml, take its records
  (Get-EngineRecords.ps1), build the front again (Build-Front.ps1 -Record),
  type the new commit, the server's SHA256 and its build time into four places
  in THIRD-PARTY.md and one in site\data\site\credits.md, and open the pin pull
  request. Fixes sat merged in the fork for hours or days while nobody was
  there to do it, and the hand-typed lines went stale: on 31 Oct THIRD-PARTY.md
  still named an engine.yml run three pins old.

  WHAT IS HERE.
    Get-EnginePinFacts      what the records in a checkout say the pin is
    Get-EnginePinBlocks     the text each marked block of the two pages holds
    Update-EnginePinText    writes those blocks, or with -Check names the ones
                            that differ, so a hand edit inside one is caught
    Get-EnginePinStep       what engine-pin.yml does next, from GitHub's answers
    Get-EnginePinNotes      the fork pull requests a pin brings in, the
                            Thornswood issues they name, their Test tasks
                            and their Release note lines

  THE MARKED BLOCKS. A block is the lines between
      <!-- engine-pin:<name> -->   and   <!-- /engine-pin:<name> -->
  (each marker on its own line, spaces in front allowed). Everything between
  the two is written from the records and never by hand; everything outside
  is the page's own text. The site leaves the marker lines out of what it
  serves (forMode in site\server.js).

  Reads only what it is given: GitHub through the $Get script block the caller
  passes (a path in, the answer as objects out), files through the checkout.
#>

# The release note rules a pull request's "Release note:" line is held to
# (#5179); a fork pull request carries one too (plan part 8).
. (Join-Path $PSScriptRoot 'Note-Rules.ps1')

$EnginePinBranch = 'engine-pin/next'
$EnginePinThornswood = 'ThornswoodRP/Thornswood'
$EnginePinPages = @('THIRD-PARTY.md', 'site/data/site/credits.md')
$EnginePinBlockNames = [ordered]@{
    'THIRD-PARTY.md'            = @('fork', 'front', 'servers', 'source')
    'site/data/site/credits.md' = @('credits')
}

function Read-EnginePinJson([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "there is no $Path" }
    return ([IO.File]::ReadAllText($Path) | ConvertFrom-Json)
}

# What the records in the checkout at $Repo say the pin is. Throws when they
# do not name one commit, the same way Check-Records.ps1 and
# tests\test-one-engine.js would.
function Get-EnginePinFacts([string]$Repo) {
    $rec = Join-Path $Repo 'records'
    $s = Read-EnginePinJson (Join-Path $rec 'server-build.json')
    $c = Read-EnginePinJson (Join-Path $rec 'client-build.json')
    $f = Read-EnginePinJson (Join-Path $rec 'front-build.json')
    $commit = ([string]$s.source.commit).ToLowerInvariant()
    if ($commit -notmatch '^[0-9a-f]{40}$') { throw 'records\server-build.json names no fork commit (source.commit)' }
    if (-not $commit.StartsWith(([string]$c.forkCommit).ToLowerInvariant()) -or -not [string]$c.forkCommit) { throw "records\client-build.json names $($c.forkCommit), not $commit" }
    if (([string]$f.forkCommit).ToLowerInvariant() -ne $commit) { throw "records\front-build.json is the build of $($f.forkCommit), not ${commit}: run Build-Front.ps1 -Record" }
    $base = ([string]$s.source.upstreamBase).ToLowerInvariant()
    if ($base -notmatch '^[0-9a-f]{40}$') { throw 'records\server-build.json names no upstream base (source.upstreamBase)' }
    $sha = ([string]$s.sha256).ToLowerInvariant()
    if ($sha -notmatch '^[0-9a-f]{64}$') { throw 'records\server-build.json gives no SHA256 of the server module' }
    $built = $s.builtUtc
    if ($built -is [DateTime]) { $built = $built.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }
    $repoUrl = ([string]$s.source.repo) -replace '\.git$', ''
    if ($repoUrl -notmatch '^https://github\.com/[^/]+/[^/]+$') { throw "records\server-build.json names the fork as '$($s.source.repo)'" }
    $files = @($f.files.PSObject.Properties)
    $bytes = [long]0
    foreach ($p in $files) { $bytes += [long]$p.Value.bytes }
    return [pscustomobject]@{
        Commit = $commit; Short = $commit.Substring(0, 8)
        Base = $base; BaseShort = $base.Substring(0, 8)
        ServerSha256 = $sha; ServerBuilt = [string]$built
        Fork = $repoUrl; Branch = [string]$s.source.branch
        FrontFiles = $files.Count; FrontBytes = $bytes
    }
}

# The commit "On our servers" says main still runs, read out of the page as
# it is. A main Ship of this pin, or a hand edit, changes it; a pin move never
# does, since main runs what its last release carried.
function Get-EnginePinMain([string]$Repo) {
    $p = Join-Path $Repo 'THIRD-PARTY.md'
    $t = [IO.File]::ReadAllText($p)
    $m = [regex]::Match($t, 'Main remains on `([0-9a-f]{40})`')
    if ($m.Success) { return $m.Groups[1].Value }
    $m = [regex]::Match($t, 'Main runs `([0-9a-f]{40})` as well')
    if ($m.Success) { return $m.Groups[1].Value }
    throw 'THIRD-PARTY.md "On our servers" says neither "Main remains on" nor "Main runs ... as well", so which engine main runs is not known'
}

# The text of each block, by name, as lines (no line ends).
function Get-EnginePinBlocks($Facts, [string]$Main) {
    $F = $Facts.Commit; $S = $Facts.Short; $B = $Facts.BaseShort; $u = $Facts.Fork
    $compare = "$u/compare/$B...$S"
    $mainLine = if ($Main -eq $F) { @("  claim. Main runs ``$F`` as well.") } else { @("  claim. Main remains on ``$Main`` until this goes", '  out.') }
    $source = @("$u/tree/$F")
    if ($Main -ne $F) { $source += @('', 'For the engine Main runs until then:', '', "$u/tree/$Main") }
    return [ordered]@{
        fork = @(
            'The six files recorded in `records\client-build.json` correspond to',
            "$u, branch ``$($Facts.Branch)``,",
            "commit ``$S`` (in full, ``$F``). That",
            "is upstream skyrim-multiplayer/skymp at ``$B`` with Thornswood's changes on",
            'top, and every one of those changes is in',
            "$compare.")
        front = @(
            ('{0} files, {1} bytes, from commit' -f $Facts.FrontFiles, $Facts.FrontBytes.ToString('N0', [Globalization.CultureInfo]::InvariantCulture)),
            "``$S``, the commit the client record names.")
        servers = @(
            '- The game server''s native module, `scam_native.node`, recorded in',
            '  `records\server-build.json`, is AGPL-3.0. That record and the client record',
            "  name ``$F`` on the public fork. The",
            '  server module and the six client files were built from that commit, which',
            "  is upstream at ``$B`` with every change in",
            "  $compare. Each change",
            '  is a merged pull request of the fork, and the pull request here that moved',
            '  the pin lists the ones it brought in.',
            '  The server module''s SHA256',
            "  is ``$($Facts.ServerSha256)``, built",
            "  $($Facts.ServerBuilt). This is the recorded next release, not a deployment") + $mainLine
        source = $source
        credits = @(
            'The server''s engine recorded for the next release, `scam_native.node`, is',
            'built from one commit,',
            "[``$S``]($u/tree/$F).",
            'That commit starts from',
            "[SkyMP](https://github.com/skyrim-multiplayer/skymp) at ``$B``, and",
            "[every change Thornswood made]($compare)",
            'is the difference between the two.')
    }
}

# Writes every marked block of the two pages from the records, keeping each
# page's own line ends. With -Check it writes nothing and returns the blocks
# that differ (or are missing) as "<page> <block>" lines; without, it returns
# the pages it changed.
function Update-EnginePinText([string]$Repo, [string]$Main, [switch]$Check) {
    $facts = Get-EnginePinFacts $Repo
    if (-not $Main) { $Main = Get-EnginePinMain $Repo }
    if ($Main -notmatch '^[0-9a-f]{40}$') { throw "'$Main' is not a full commit for the engine main runs" }
    $blocks = Get-EnginePinBlocks $facts $Main
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($page in $EnginePinBlockNames.Keys) {
        $path = Join-Path $Repo $page
        $text = [IO.File]::ReadAllText($path)
        $nl = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
        $new = $text
        foreach ($name in $EnginePinBlockNames[$page]) {
            $re = [regex]('(?m)(^[ ]*<!-- engine-pin:' + $name + ' -->\r?\n)([\s\S]*?)(^[ ]*<!-- /engine-pin:' + $name + ' -->)')
            $ms = $re.Matches($new)
            if ($ms.Count -ne 1) {
                if ($Check) { $out.Add("$page $name (the page has $($ms.Count) of this block, not one)"); continue }
                throw "$page has $($ms.Count) blocks named engine-pin:$name, not one"
            }
            $want = (($blocks[$name] -join $nl) + $nl)
            if ($ms[0].Groups[2].Value -ne $want) {
                if ($Check) { $out.Add("$page $name") }
                $new = $new.Substring(0, $ms[0].Groups[2].Index) + $want + $new.Substring($ms[0].Groups[2].Index + $ms[0].Groups[2].Length)
            }
        }
        if (-not $Check -and $new -ne $text) {
            [IO.File]::WriteAllText($path, $new, (New-Object Text.UTF8Encoding($false)))
            $out.Add($page)
        }
    }
    return $out.ToArray()
}

function Get-EnginePinValue($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $p = $Object.PSObject.Properties[$Name]
    if ($p) { return $p.Value }
    return $null
}

# What engine-pin.yml does on this tick, from GitHub's answers through $Get
# and the commit main pins ($Pin). One of:
#   pinned     main pins the fork's head: nothing to do
#   aside      another open pull request moves engine/skymp: it goes first
#   ready      engine-pin/next already pins the head (Pr says whether a pull
#              request is open from it)
#   building   the fork is still building the head, and no earlier head
#              since the pin is built either
#   no-build   the fork has no build of the head to record, or it ended red
#   record     the head is built and nothing recorded it: start engine.yml
#   recording  engine.yml is recording the head
#   pin        engine.yml recorded the head green: move the pin (Run)
#   red        engine.yml's newest run for the head ended red
# Why says it in a sentence. A red is never started again by this: that run
# is a failure to fix at its cause, and the next fork head starts afresh.
#
# Head is the commit the step is about, and ForkHead the fork's head. They
# differ only while the head is still building. The fork's push build takes
# 20 to 45 minutes, so a fork merge inside that time would leave the pin
# waiting until merges stopped. On 1 Nov 2026 d566413 was built at 1:59 AM
# UTC and was the head until 561ca60 merged at 2:18 AM: no tick looked in
# between, and the pin waited again. So while the head builds, the newest
# earlier head since the pin that the fork built green
# (Find-EnginePinBuiltBefore) is recorded and pinned, and the head follows
# when its build ends.
function Find-EnginePinBuiltBefore([string]$Pin, [string]$ForkHead, [scriptblock]$Get) {
    $list = & $Get ("repos/{0}/actions/workflows/{1}/runs?event=push&branch={2}&status=success&per_page=10" -f $ForkEngineRepo, $ForkEngineWorkflow, [Uri]::EscapeDataString($ForkEngineBranch))
    $seen = @{}
    foreach ($run in @(@(Get-EnginePinValue $list 'workflow_runs') | Where-Object {
                $_ -and [string]$_.event -eq 'push' -and [string]$_.head_branch -eq $ForkEngineBranch -and [string]$_.conclusion -eq 'success' -and
                [string](Get-EnginePinValue (Get-EnginePinValue $_ 'repository') 'id') -eq [string]$ForkEngineRepoId
            } | Sort-Object { [long]$_.id } -Descending)) {
        $sha = ([string]$run.head_sha).ToLowerInvariant()
        if ($sha -notmatch '^[0-9a-f]{40}$' -or $sha -eq $ForkHead -or $sha -eq $Pin -or $seen[$sha]) { continue }
        $seen[$sha] = $true
        # On the branch's line from the pin to the head: the head is ahead
        # of it, and it is ahead of the pin. An older build, or one of a
        # commit the branch lost to a force push, is never the target.
        $toHead = & $Get ("repos/{0}/compare/{1}...{2}" -f $ForkEngineRepo, $sha, $ForkHead)
        if ([string](Get-EnginePinValue $toHead 'status') -ne 'ahead') { continue }
        $fromPin = & $Get ("repos/{0}/compare/{1}...{2}" -f $ForkEngineRepo, $Pin, $sha)
        # Not ahead of the pin, on the head's line: it and every older build
        # are the pin or behind it.
        if ([string](Get-EnginePinValue $fromPin 'status') -ne 'ahead') { break }
        $b = Find-ForkEngineBuild $sha $Get
        if ($b.State -eq 'found') { return [pscustomobject]@{ Commit = $sha; Build = $b } }
    }
    return $null
}

function Get-EnginePinStep([string]$Pin, [scriptblock]$Get) {
    $fork = $ForkEngineRepo
    $branch = & $Get ("repos/{0}/branches/{1}" -f $fork, [uri]::EscapeDataString($ForkEngineBranch))
    $head = ([string](Get-EnginePinValue (Get-EnginePinValue $branch 'commit') 'sha')).ToLowerInvariant()
    if ($head -notmatch '^[0-9a-f]{40}$') { throw "GitHub gave no head for $fork $ForkEngineBranch" }
    $r = [ordered]@{ Step = ''; Head = $head; ForkHead = $head; Pin = $Pin; Run = $null; Pr = $null; Why = '' }
    $also = ''
    function Done($step, $why) { $r.Step = $step; $r.Why = $(if ($also) { $why.TrimEnd('.') + '.' + $also } else { $why }); return [pscustomobject]$r }
    if ($head -eq $Pin) { return (Done 'pinned' "main pins the fork's head $($head.Substring(0, 12)) already") }

    $ours = $null
    foreach ($p in @(& $Get ("repos/{0}/pulls?state=open&per_page=100" -f $EnginePinThornswood) | ForEach-Object { $_ })) {
        if (-not $p) { continue }
        $ref = [string](Get-EnginePinValue (Get-EnginePinValue $p 'head') 'ref')
        if ($ref -eq $EnginePinBranch) { $ours = $p; continue }
        $files = @(& $Get ("repos/{0}/pulls/{1}/files?per_page=100" -f $EnginePinThornswood, $p.number) | ForEach-Object { $_ })
        if (@($files | Where-Object { $_ -and [string]$_.filename -eq 'engine/skymp' }).Count) {
            $r.Pr = [int]$p.number
            return (Done 'aside' ("pull request #{0} ({1}) moves engine/skymp, so it goes first and this waits until it is merged or closed" -f $p.number, $p.html_url))
        }
    }
    $r.Pr = if ($ours) { [int]$ours.number } else { $null }
    $at = $null
    try { $at = & $Get ("repos/{0}/contents/engine/skymp?ref={1}" -f $EnginePinThornswood, [uri]::EscapeDataString($EnginePinBranch)) } catch { $at = $null }
    if ($at -and ([string](Get-EnginePinValue $at 'sha')).ToLowerInvariant() -eq $head) {
        return (Done 'ready' ("$EnginePinBranch already pins $($head.Substring(0, 12))" + $(if ($ours) { ", in pull request #$($ours.number)" } else { ', and no pull request is open from it' })))
    }

    $b = Find-ForkEngineBuild $head $Get
    if ($b.State -ne 'found') {
        $going = $b.Run -and [string]$b.Run.status -ne 'completed'
        if (-not $going) { return (Done 'no-build' $b.Why) }
        $before = Find-EnginePinBuiltBefore $Pin $head $Get
        if (-not $before) { return (Done 'building' $b.Why) }
        $also = (" The fork's head {0} is still building and follows once it is built: {1}" -f $head.Substring(0, 12), $b.Run.html_url)
        $head = $before.Commit; $b = $before.Build; $r.Head = $head
        if ($at -and ([string](Get-EnginePinValue $at 'sha')).ToLowerInvariant() -eq $head) {
            return (Done 'ready' ("$EnginePinBranch already pins $($head.Substring(0, 12)), the newest head the fork built" + $(if ($ours) { ", in pull request #$($ours.number)" } else { ', and no pull request is open from it' }) + '.'))
        }
    }
    $title = "Engine build of $head"
    $runs = @(@(Get-EnginePinValue (& $Get ("repos/{0}/actions/workflows/engine.yml/runs?branch=main&per_page=50" -f $EnginePinThornswood)) 'workflow_runs') |
        Where-Object { $_ -and [string]$_.display_title -eq $title } | Sort-Object { [long]$_.id } -Descending)
    if (-not $runs.Count) { return (Done 'record' ("the fork built $($head.Substring(0, 12)) in run $($b.Run.id) and nothing recorded it yet")) }
    $n = $runs[0]; $r.Run = [long]$n.id
    if ([string]$n.status -ne 'completed') { return (Done 'recording' ("engine.yml run $($n.id) ($($n.html_url)) is recording it")) }
    if ([string]$n.conclusion -eq 'success') { return (Done 'pin' ("engine.yml run $($n.id) ($($n.html_url)) recorded it")) }
    return (Done 'red' ("engine.yml run $($n.id) ($($n.html_url)) for $($head.Substring(0, 12)) ended $($n.conclusion). It is not started again: fix what it says, then start it by hand for this commit"))
}

# The fork pull requests between the commit main pins ($Old) and the new pin
# ($New), the Thornswood issues they name ("Thornswood #N"), and the Test
# task blocks in their bodies ("Test task for Thornswood #N: <title>" and the
# steps under it, ending where done-on-merge.yml ends one), turned into the
# shape done-on-merge.yml reads in a pull request here. And the release note
# the pin carries (plan part 8): each fork pull request has its own
# "Release note:" line, held to Note-Rules.ps1 by the fork's own check, and
# the pin's is those joined (Join-PrReleaseNotes), so Collect-ReleaseNotes.ps1
# reads an engine fix in a release the way it reads any other change.
# ReleaseNote is that joined note, '' when every one says none; NoNote names
# the fork pull requests with no line, which the pin's body says so a person
# writes the line there, rather than any being taken as none.
function Get-EnginePinNotes([string]$Old, [string]$New, [scriptblock]$Get) {
    $c = & $Get ("repos/{0}/compare/{1}...{2}" -f $ForkEngineRepo, $Old, $New)
    $prs = New-Object System.Collections.Generic.List[object]
    $seen = @{}
    foreach ($k in @(Get-EnginePinValue $c 'commits')) {
        if (-not $k) { continue }
        $msg = [string](Get-EnginePinValue (Get-EnginePinValue $k 'commit') 'message')
        $m = [regex]::Match($msg, '^Merge pull request #(\d+) from ')
        if (-not $m.Success) { continue }
        $n = [int]$m.Groups[1].Value
        if ($seen.ContainsKey($n)) { continue }
        $seen[$n] = $true
        $prs.Add((& $Get ("repos/{0}/pulls/{1}" -f $ForkEngineRepo, $n)))
    }
    $issues = New-Object System.Collections.Generic.SortedSet[int]
    $tasks = New-Object System.Collections.Generic.List[string]
    $lines = New-Object System.Collections.Generic.List[string]
    $noted = New-Object System.Collections.Generic.List[object]
    $noNote = New-Object System.Collections.Generic.List[int]
    foreach ($p in $prs) {
        if ((Get-PrReleaseNote ([string]$p.body)).Found) { $noted.Add([pscustomobject]@{ Number = [int]$p.number; Body = [string]$p.body }) }
        else { $noNote.Add([int]$p.number) }
        $text = (([string]$p.title) + "`n" + ([string]$p.body)) -replace "`r`n", "`n"
        $named = @([regex]::Matches($text, '(?i)\bThornswood\s+#(\d+)') | ForEach-Object { [int]$_.Groups[1].Value })
        foreach ($i in $named) { [void]$issues.Add($i) }
        $lines.Add(('- fork #{0}: {1}' -f $p.number, ([string]$p.title).Trim()))
        $cur = $null
        foreach ($l in @(([string]$p.body -replace "`r`n", "`n") -split "`n")) {
            $t = [regex]::Match($l, '^\s*Test task for Thornswood #(\d+)\s*:\s*(.+?)\s*$')
            if ($t.Success) {
                if ($cur) { $tasks.Add(($cur -join "`n").TrimEnd()) }
                $cur = New-Object System.Collections.Generic.List[string]
                $cur.Add(('Test task for #{0}: {1}' -f $t.Groups[1].Value, $t.Groups[2].Value))
                [void]$issues.Add([int]$t.Groups[1].Value)
                continue
            }
            if ($cur -and ($l -match '^\s*#{1,6}\s' -or $l -match '^\s*---\s*$' -or $l -match '^\s*[\uD800-\uDBFF]')) { $tasks.Add(($cur -join "`n").TrimEnd()); $cur = $null; continue }
            if ($cur) { $cur.Add($l) }
        }
        if ($cur) { $tasks.Add(($cur -join "`n").TrimEnd()) }
    }
    return [pscustomobject]@{ PullRequests = $lines.ToArray(); Issues = @($issues); TestTasks = $tasks.ToArray(); Count = $prs.Count
                              ReleaseNote = (Join-PrReleaseNotes $noted.ToArray()); NoNote = $noNote.ToArray() }
}
