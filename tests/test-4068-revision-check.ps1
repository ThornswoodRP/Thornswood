<#
  test-4068-revision-check.ps1

      pwsh -NoProfile -File .\tests\test-4068-revision-check.ps1
      powershell -NoProfile -File .\tests\test-4068-revision-check.ps1

  Every release and every launcher on the newest published collection
  revision (#4068). Revision 5 was published on 21 Oct and both feeds named
  revision 2 until 27 Oct; Patrick: the launcher is always on the newest
  revision, every update is built on it, and the launcher refuses Play on any
  other.

  What this proves:
    1. NexusPublished.ps1 asks a stand-in Nexus (tests\fixtures\nexus-standin.js)
       for the newest published revision with no key and with Application-Name
       and Application-Version, follows it when a newer one is published, and
       throws, never answers a number, for a collection that is not there or
       a Nexus that does not answer.
    2. Get-ShipNewestRevisionProblem (CollectionRevision.ps1) passes a record
       on the newest published revision and refuses one behind it, one ahead
       of it and one Nexus cannot be asked about, asking Nexus itself when no
       number is given.
    3. Check-CollectionRevisions.ps1, against stand-ins for the four numbers
       and for GitHub: nothing opened while all four agree; one issue opened
       for the newest revision while a feed or the record is behind, never a
       second; one for an older revision closed when a newer one is
       published; every one closed once all four agree; none touched while a
       number cannot be read; and the exit codes 0, 1 and 2 from the command
       line.
    4. Ship.ps1 and Publish-Update.ps1 ask before anything is built, and
       collection-revision.yml runs the check every hour with -Issue on the
       VPS runners, with a token that can edit issues and nothing more.

  Scratch folders and a loopback stand-in only.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$rel = Join-Path (Join-Path $Repo 'scripts') 'release'
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
$script:standin = $null
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-4068-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$saved = @{ STANDIN = $env:THORNSWOOD_NEXUS_STANDIN; KEY = $env:THORNSWOOD_NEXUS_STANDIN_KEY }
function Done {
    if ($script:standin -and -not $script:standin.HasExited) { $script:standin.Kill() }
    $env:THORNSWOOD_NEXUS_STANDIN = $saved.STANDIN
    $env:THORNSWOOD_NEXUS_STANDIN_KEY = $saved.KEY
    if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force }
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}
trap { $script:fail++; Write-Host ('FAIL  the harness itself stopped: ' + $_.Exception.Message) -ForegroundColor Red; Done }
function Q([string]$s) { return '"' + (($s -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"' }
New-Item -ItemType Directory -Force -Path (Join-Path $T 'records') | Out-Null
$rec = Join-Path (Join-Path $T 'records') 'collection-plugins.json'
function Rec([int]$n) { [IO.File]::WriteAllText($rec, ('{ "collection": "7essxf", "revision": ' + $n + ', "plugins": [] }'), (New-Object Text.UTF8Encoding($false))) }

# ---- 1. NexusPublished.ps1 against the stand-in -------------------------------------
Write-Host 'NexusPublished.ps1'
$node = Get-Command node -ErrorAction SilentlyContinue
Yes 'node is on PATH, for the stand-in Nexus' ($null -ne $node)
if ($null -eq $node) { Done }
$KEY = 'standin-' + [Guid]::NewGuid().ToString('N')
$psi = New-Object Diagnostics.ProcessStartInfo
$psi.FileName = $node.Source; $psi.Arguments = Q (Join-Path $Repo 'tests\fixtures\nexus-standin.js')
$psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
$psi.EnvironmentVariables['NEXUS_STANDIN_KEY'] = $KEY
$psi.EnvironmentVariables['NEXUS_STANDIN_SAVE'] = $T
$script:standin = [Diagnostics.Process]::Start($psi)
$first = $script:standin.StandardOutput.ReadLineAsync()
$heard = if ($first.Wait(15000)) { [string]$first.Result } else { '' }
$pm = [regex]::Match($heard, '^\[nexus\] listening on 127\.0\.0\.1:(\d+)$')
$port = if ($pm.Success) { [int]$pm.Groups[1].Value } else { 0 }
Yes "the stand-in Nexus listens on its own port ($port)" ($port -gt 0)
if (-not $port) { Done }
$null = $script:standin.StandardOutput.ReadToEndAsync()
$null = $script:standin.StandardError.ReadToEndAsync()
$base = 'http://127.0.0.1:' + $port
function Requests { return @((Invoke-RestMethod -Uri ($base + '/_requests')).requests) }
function Control($h) { [void](Invoke-RestMethod -Method Post -Uri ($base + '/_control') -ContentType 'application/json' -Body ($h | ConvertTo-Json -Compress -Depth 5)) }
$env:THORNSWOOD_NEXUS_STANDIN = $base
# The key a keyed script would send; this one must send none.
$env:THORNSWOOD_NEXUS_STANDIN_KEY = $KEY

$n = & (Join-Path $rel 'NexusPublished.ps1') -Slug 7essxf
Yes "it reads the newest published revision, 2 at the stand-in's start ($n)" ($n -eq 2)
$last = @(Requests)[-1]
Yes '  with no key' ($last.key -eq 'none')
Yes '  and with Application-Name and Application-Version' ($last.appName -eq 'Thornswood' -and $last.appVersion -match '^\d')
Control @{ addRevision = @{ n = 5; id = 805005; status = 'published' } }
Control @{ setLatest = 5 }
$n = & (Join-Path $rel 'NexusPublished.ps1') -Slug 7essxf
Yes "a revision published since is the one it reads ($n)" ($n -eq 5)
$stop = ''; try { $null = & (Join-Path $rel 'NexusPublished.ps1') -Slug abc123 } catch { $stop = $_.Exception.Message }
Yes 'a collection Nexus does not have throws, never a number' ($stop -match 'refused|named no published revision')
$stop = ''; try { $null = & (Join-Path $rel 'NexusPublished.ps1') -Slug 'no slug' } catch { $stop = $_.Exception.Message }
Yes 'a slug that is not one is refused before anything is sent' ($stop -match 'is not a collection slug')

# ---- 2. Get-ShipNewestRevisionProblem -------------------------------------------------
Write-Host ''; Write-Host 'Get-ShipNewestRevisionProblem'
. (Join-Path $rel 'CollectionRevision.ps1')
Rec 5
Yes 'a record on the newest published revision passes' ((Get-ShipNewestRevisionProblem -RepoDir $T -Published 5) -eq '')
$p = Get-ShipNewestRevisionProblem -RepoDir $T -Published 6
Yes 'a record behind it is refused, naming both and the rebuild' ($p -match 'Collection revision 6 is published on Nexus' -and $p -match 'still on 5' -and $p -match 'rebuild dev on it, then main' -and $p -match 'Nothing was built or published')
$p = Get-ShipNewestRevisionProblem -RepoDir $T -Published 4
Yes 'a record ahead of it is refused: nobody can install it' ($p -match 'newest revision published on Nexus is 4' -and $p -match 'New-NexusRevision\.ps1 -Publish 5')
Yes 'with no number it asks Nexus, and passes a record on what Nexus says' ((Get-ShipNewestRevisionProblem -RepoDir $T) -eq '')
Rec 4
$p = Get-ShipNewestRevisionProblem -RepoDir $T
Yes '  and refuses a record behind what Nexus says' ($p -match 'Collection revision 5 is published on Nexus' -and $p -match 'still on 4')
$env:THORNSWOOD_NEXUS_STANDIN = 'http://127.0.0.1:1'
$p = Get-ShipNewestRevisionProblem -RepoDir $T
Yes 'a Nexus that does not answer is a refusal, never a pass' ($p -match 'Nexus did not say which revision' -and $p -match 'Nothing was built or published')
$env:THORNSWOOD_NEXUS_STANDIN = $base
Remove-Item -LiteralPath $rec -Force
Yes 'with no record it is refused' ((Get-ShipNewestRevisionProblem -RepoDir $T -Published 5) -match 'There is no')

# ---- 3. Check-CollectionRevisions.ps1 -------------------------------------------------
Write-Host ''; Write-Host 'Check-CollectionRevisions.ps1'
. (Join-Path $rel 'Check-CollectionRevisions.ps1')
$script:Have = @{ Nexus = 5; Main = 5; Dev = 5 }
$script:Unreadable = ''
function Read-RevisionNexus([string]$Slug) { if ($script:Unreadable -eq 'nexus') { throw 'the stand-in did not answer' }; return $script:Have.Nexus }
function Read-RevisionFeed([string]$Channel) { if ($script:Unreadable -eq $Channel) { throw "the $Channel feed did not answer" }; if ($Channel -eq 'main') { return $script:Have.Main }; return $script:Have.Dev }
$script:Issues = New-Object System.Collections.Generic.List[object]
$script:Calls = New-Object System.Collections.Generic.List[string]
$script:Next = 4100
# 120 other open issues and a pull request with a rebuild title, so the
# reader has to page and has to pass pull requests over.
for ($i = 1; $i -le 120; $i++) { $script:Issues.Add([pscustomobject]@{ number = $i; title = "Something else $i"; state = 'open'; body = ''; labels = @(); state_reason = $null; comments = @() }) }
$script:Issues.Add([pscustomobject]@{ number = 121; title = 'Collection revision 5 is published: rebuild dev, then main, on it'; state = 'open'; body = ''; labels = @(); pull_request = @{ url = 'x' }; state_reason = $null; comments = @() })
function Invoke-RevisionApi {
    param([string]$Method, [string]$Path, $Body = $null)
    $script:Calls.Add("$Method $Path")
    if ($Method -eq 'GET' -and $Path -match '^issues\?state=open.*&page=(\d+)$') {
        $page = [int]$Matches[1]
        $open = @($script:Issues | Where-Object { $_.state -eq 'open' } | Sort-Object number)
        return @($open | Select-Object -Skip (($page - 1) * 100) -First 100)
    }
    if ($Method -eq 'POST' -and $Path -eq 'issues') {
        $script:Next++
        $o = [pscustomobject]@{ number = $script:Next; title = $Body.title; state = 'open'; body = $Body.body; labels = @($Body.labels); state_reason = $null; comments = @() }
        $script:Issues.Add($o); return $o
    }
    if ($Method -eq 'POST' -and $Path -match '^issues/(\d+)/comments$') {
        $o = @($script:Issues | Where-Object { $_.number -eq [int]$Matches[1] })[0]; $o.comments += [string]$Body.body; return $o
    }
    if ($Method -eq 'PATCH' -and $Path -match '^issues/(\d+)$') {
        $o = @($script:Issues | Where-Object { $_.number -eq [int]$Matches[1] })[0]; $o.state = $Body.state; $o.state_reason = $Body.state_reason; return $o
    }
    throw "the stand-in GitHub does not know $Method $Path"
}
function Rebuilds([string]$state = 'open') { return @($script:Issues | Where-Object { $_.state -eq $state -and -not $_.PSObject.Properties['pull_request'] -and $_.title -match '^Collection revision \d+ is published' }) }

Rec 5
$s = Get-RevisionState $T
Yes 'all four on one revision: nothing behind, nothing unread' ($s.Nexus -eq 5 -and $s.Record -eq 5 -and $s.Behind.Count -eq 0 -and $s.Unread.Count -eq 0)
$said = Sync-RevisionIssue $s
Yes '  and no issue is opened' ((Rebuilds).Count -eq 0 -and $said -match 'nothing open')
Yes '  having read every page of open issues' (@($script:Calls | Where-Object { $_ -match 'page=2$' }).Count -ge 1)

$script:Have = @{ Nexus = 5; Main = 2; Dev = 2 }
$s = Get-RevisionState $T
Yes 'both feeds on 2 with Nexus on 5: each feed is behind' ($s.Behind.Count -eq 2 -and ($s.Behind -join ' ') -match 'dev feed names revision 2' -and ($s.Behind -join ' ') -match 'main feed names revision 2')
$said = Sync-RevisionIssue $s
$open = @(Rebuilds)
Yes "  one issue is opened for revision 5 ($said)" ($open.Count -eq 1 -and $open[0].title -eq 'Collection revision 5 is published: rebuild dev, then main, on it')
Yes '  saying what is behind, what the Desk does and when it is done' ($open[0].body -match 'the dev feed names revision 2' -and $open[0].body -match 'Deploy-Gamemode\.ps1 -OrderOnly' -and $open[0].body -match 'Done when Nexus, the record and both feeds name revision 5')
Yes '  in the plain shape: no footer, no byline' ($open[0].body -notmatch '(?m)^---' -and $open[0].body -notmatch 'Generated by' -and $open[0].body -notmatch 'Claude')
Yes '  with the Release area label' (@($open[0].labels) -contains 'area: Release')
$said = Sync-RevisionIssue (Get-RevisionState $T)
Yes "  and the next hour opens no second one ($said)" ((Rebuilds).Count -eq 1 -and $said -match ('#' + $open[0].number + ' is open'))
Yes '  and the pull request with the same title is never touched' (@($script:Issues | Where-Object { $_.number -eq 121 })[0].state -eq 'open')

$script:Have = @{ Nexus = 6; Main = 5; Dev = 5 }
$s = Get-RevisionState $T
Yes 'Nexus on 6 with the record on 5: the record is behind too' (($s.Behind -join ' ') -match 'collection-plugins\.json names revision 5')
$said = Sync-RevisionIssue $s
$open = @(Rebuilds)
$closed = @(Rebuilds 'closed')
Yes "  the issue for 5 is closed as overtaken and one for 6 opened ($said)" ($open.Count -eq 1 -and $open[0].title -match '^Collection revision 6 ' -and $closed.Count -eq 1 -and $closed[0].state_reason -eq 'not_planned' -and ($closed[0].comments -join ' ') -match 'revision 6 is published since')

$script:Unreadable = 'dev'
$s = Get-RevisionState $T
$before = (Rebuilds).Count
$said = Sync-RevisionIssue $s
Yes 'a feed that cannot be read: unread, and no issue changed' ($s.Unread.Count -eq 1 -and $s.Behind.Count -eq 0 -and (Rebuilds).Count -eq $before -and $said -match 'could not be read')
$script:Unreadable = 'nexus'
Yes '  and the same for Nexus' ((Get-RevisionState $T).Unread.Count -eq 1)
$script:Unreadable = ''

Rec 6
$script:Have = @{ Nexus = 6; Main = 6; Dev = 6 }
$said = Sync-RevisionIssue (Get-RevisionState $T)
$done = @($script:Issues | Where-Object { $_.title -match '^Collection revision 6 ' })[0]
Yes "all four on 6: the issue is closed as done, saying so ($said)" ((Rebuilds).Count -eq 0 -and $done.state -eq 'closed' -and $done.state_reason -eq 'completed' -and ($done.comments -join ' ') -match 'all name collection revision 6')

# From the command line, against a copy whose NexusPublished.ps1 says 7 and a
# record on 7: the feeds on the site are read for real only on the box, so
# the copy's Feed-Store.ps1 says what each feed names.
$copy = Join-Path $T 'copy'
$crel = Join-Path (Join-Path $copy 'scripts') 'release'
New-Item -ItemType Directory -Force -Path $crel, (Join-Path $copy 'records') | Out-Null
foreach ($f in 'Check-CollectionRevisions.ps1', 'CollectionRevision.ps1') { Copy-Item -LiteralPath (Join-Path $rel $f) -Destination $crel }
[IO.File]::WriteAllText((Join-Path $crel 'NexusPublished.ps1'), "param([string]`$Slug, [string]`$Game)`r`nif (`$env:TS_4068_NEXUS -eq 'none') { throw 'no answer' }`r`nreturn [int]`$env:TS_4068_NEXUS`r`n")
[IO.File]::WriteAllText((Join-Path $crel 'Feed-Store.ps1'), "function Read-SiteFeed([string]`$Channel) { return [pscustomobject]@{ collectionRevision = [int]`$env:TS_4068_FEEDS } }`r`n")
[IO.File]::WriteAllText((Join-Path (Join-Path $copy 'records') 'collection-plugins.json'), '{ "collection": "7essxf", "revision": 7, "plugins": [] }')
$shell = (Get-Process -Id $PID).Path
function Invoke-Check([string]$nexus, [string]$feeds) {
    $env:TS_4068_NEXUS = $nexus; $env:TS_4068_FEEDS = $feeds
    $out = @(& $shell -NoProfile -File (Join-Path $crel 'Check-CollectionRevisions.ps1') 2>&1 | ForEach-Object { [string]$_ })
    return [pscustomobject]@{ Code = $LASTEXITCODE; Text = ($out -join "`n") }
}
$c = Invoke-Check '7' '7'
Yes "the command line says 0 when all four agree ($($c.Code))" ($c.Code -eq 0 -and $c.Text -match 'all on collection revision 7')
$c = Invoke-Check '7' '2'
Yes "  1 when a feed is behind, naming it ($($c.Code))" ($c.Code -eq 1 -and $c.Text -match 'the main feed names revision 2')
$c = Invoke-Check 'none' '7'
Yes "  2 when Nexus cannot be read, never 0 ($($c.Code))" ($c.Code -eq 2 -and $c.Text -match 'could not read Nexus')
$env:TS_4068_NEXUS = $null; $env:TS_4068_FEEDS = $null

# ---- 4. where it is wired -------------------------------------------------------------
Write-Host ''; Write-Host 'where it is wired'
$ship = [IO.File]::ReadAllText((Join-Path $rel 'Ship.ps1')).Replace("`r`n", "`n")
$at = $ship.IndexOf('$newestWhy = Get-ShipNewestRevisionProblem -RepoDir $RepoDir')
$bump = $ship.IndexOf("Head 'Animation and body files'")
Yes 'Ship.ps1 asks, and stops on the answer, before anything is built' ($at -gt 0 -and $bump -gt $at -and $ship.Contains('if ($newestWhy) { Die $newestWhy }'))
$pu = [IO.File]::ReadAllText((Join-Path $rel 'Publish-Update.ps1')).Replace("`r`n", "`n")
$at = $pu.IndexOf('$newestWhy = Get-ShipNewestRevisionProblem -RepoDir $RepoDir')
$held = $pu.IndexOf('loose files held for the collection until then still ship')
Yes 'Publish-Update.ps1 asks, and stops on the answer, before anything is packed' ($at -gt 0 -and $held -gt $at -and $pu.Contains('if ($newestWhy) { Die $newestWhy }'))
$wf = [IO.File]::ReadAllText((Join-Path $Repo '.github\workflows\collection-revision.yml')).Replace("`r`n", "`n")
Yes 'collection-revision.yml runs every hour and by hand' ($wf -match "(?m)^\s+- cron: '\d{1,2} \* \* \* \*'" -and $wf -match '(?m)^\s+workflow_dispatch:')
Yes '  on GitHub''s Windows runner, main only (#4983)' ($wf -match '(?m)^    runs-on: windows-latest$' -and $wf -match "(?m)^    if: github\.ref == 'refs/heads/main'$" -and $wf -notmatch 'self-hosted')
Yes '  with -Issue, the run''s own token and the repository' ($wf -match 'Check-CollectionRevisions\.ps1 -Issue' -and $wf -match 'GH_TOKEN: \$\{\{ github\.token \}\}' -and $wf -match 'REPO: \$\{\{ github\.repository \}\}')
Yes '  and a token that can read the code and edit issues, nothing more' ($wf -match "(?ms)^permissions:\n  contents: read\n  issues: write\n(?!  )")
Done
