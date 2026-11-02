<#
  test-3399-engine-records.ps1

      pwsh -NoProfile -File .\tests\test-3399-engine-records.ps1

  Issue #3399. engine.yml hands the records it makes back in its job's log,
  not as an artifact of this repository, whose storage was used up on 25 Oct
  (#3410), and Get-EngineRecords.ps1 writes them into a checkout for the pin
  pull request.

  WHAT IT HOLDS, with records made here and a stand-in GitHub, nothing sent
  anywhere:
    1. LogHandBack.ps1: a file printed by Get-LogHandBackLines comes back
       whole from Read-LogHandBack, with GitHub's timestamps in front of each
       line and other lines between; a log with no begin line, no end line,
       two begin lines, a line that is not base64, or a chunk changed is
       refused, saying which.
    2. EngineRecords.ps1: the bundle carries the three records and every
       licence text, and nothing else; a bundle with another name in it, or
       one record missing, is refused; Get-EngineRecordsCommit gives the one
       fork commit and refuses two records of different commits;
       Save-EngineRecords writes the records and replaces
       records\client-licences\ whole, so a text the new build has not is
       gone.
    3. Get-EngineRecords.ps1 whole, in a scratch git checkout: a run that is
       not engine.yml's, or not green, stops (exit 1) writing nothing; a log
       with no records stops saying so; records of another commit than the
       index pins stop, naming the update-index line; with the pin moved, the
       records are written (exit 0), the old licence text is gone, and the
       log was read from the job that succeeded; a gh of 2.92 or newer, which
       refuses a log's escape sequences unless told, is told (#5202), and an
       older one is not.

  Writes only in its own scratch folder, which it removes. Needs git.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$env:THORNSWOOD_HARNESS = '1'
$Here = Split-Path -Parent $PSScriptRoot
$utf8 = New-Object Text.UTF8Encoding($false)

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Threw([scriptblock]$b) { try { & $b | Out-Null; return '' } catch { return $_.Exception.Message } }
function Put([string]$p, [string]$text) {
    $null = [IO.Directory]::CreateDirectory((Split-Path -Parent $p))
    [IO.File]::WriteAllText($p, $text, $utf8)
}

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-3399-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
try {
    $repo = Join-Path $T 'repo'
    $null = New-Item -ItemType Directory -Force -Path $repo
    Copy-Item -LiteralPath (Join-Path $Here 'scripts') -Destination (Join-Path $repo 'scripts') -Recurse
    . (Join-Path $repo 'scripts/release/EngineRecords.ps1')

    # ================================================== 1. LogHandBack.ps1 ==
    Write-Host ''; Write-Host '1. LogHandBack.ps1'
    $mark = 'TEST' + '-MARK'
    $rnd = New-Object Random 3399
    [byte[]]$data = New-Object byte[] 20000
    $rnd.NextBytes($data)
    $lines = @(Get-LogHandBackLines $mark $data)
    Yes '1. a begin line with the length and sha256, chunks of at most 4000, an end line' ($lines[0] -match "^$mark begin 20000 [0-9a-f]{64}$" -and $lines[-1] -eq "$mark end" -and
        @($lines[1..($lines.Count - 2)] | Where-Object { $_.Length -gt (4000 + $mark.Length + 1) }).Count -eq 0 -and $lines.Count -gt 3)
    $log = @('2026-10-26T17:00:00.0000000Z ##[group]Run something', 'unrelated line') + @($lines | ForEach-Object { '2026-10-26T17:00:01.1234567Z ' + $_ }) + @('2026-10-26T17:00:02.0000000Z after')
    $back = Read-LogHandBack $log $mark
    Yes '1. it comes back whole, with GitHub''s timestamps in front and other lines between' ($back.Length -eq $data.Length -and [Convert]::ToBase64String($back) -eq [Convert]::ToBase64String($data))
    Yes '1.   and from one text with line breaks, as gh api prints a log' ((Read-LogHandBack @($log -join "`r`n") $mark).Length -eq $data.Length)
    $e = Threw { Read-LogHandBack @('nothing here') $mark }
    Yes '1. no begin line: refused' ($e -match "no $mark begin line")
    $e = Threw { Read-LogHandBack @($lines[0..($lines.Count - 2)]) $mark }
    Yes '1. no end line: refused' ($e -match "no $mark end line")
    $e = Threw { Read-LogHandBack (@($lines[0]) + $lines) $mark }
    Yes '1. two begin lines: refused' ($e -match "two $mark begin lines")
    $bad = @($lines); $bad[1] = "$mark this is not base64!"
    $e = Threw { Read-LogHandBack $bad $mark }
    Yes '1. a line that is not base64: refused' ($e -match 'is not base64')
    # The same length of chunk, other bytes: a file of the same length that
    # is not this one.
    $other = [byte[]]$data.Clone(); $other[100] = [byte](($other[100] + 1) % 256)
    $swapped = @($lines[0]) + @(Get-LogHandBackLines $mark $other)[1..((@(Get-LogHandBackLines $mark $other)).Count - 1)]
    $e = Threw { Read-LogHandBack $swapped $mark }
    Yes '1. other bytes under the begin line: refused, naming the sha256' ($e -match 'its sha256 is')

    # ================================================= 2. EngineRecords.ps1 ==
    Write-Host ''; Write-Host '2. EngineRecords.ps1'
    $commit = 'c1f2e448e9b96f5818b7b03674ddf48b39ced98a'
    function Server-Record([string]$c) { return ('{"binary":"scam_native.node","source":{"repo":"https://github.com/ThornswoodRP/skymp.git","commit":"' + $c + '"}}') }
    function Client-Record([string]$c) { return ('{"forkCommit":"' + $c.Substring(0, 8) + '","files":{}}') }
    $made = Join-Path $T 'made'
    Put (Join-Path $made 'records/server-build.json') (Server-Record $commit)
    Put (Join-Path $made 'records/client-build.json') (Client-Record $commit)
    Put (Join-Path $made 'records/client-licences.json') '{"ports":{"fmt":{}}}'
    Put (Join-Path $made 'records/client-licences/fmt.txt') 'fmt licence'
    Put (Join-Path $made 'records/client-licences/zlib.txt') 'zlib licence'
    Put (Join-Path $made 'records/upstream-not-taken.json') '{}'
    $bundle = New-EngineRecordsBundle $made
    $files = Read-EngineRecordsBundle $bundle
    Yes '2. the bundle carries the three records and every licence text, and nothing else' ((@($files.Keys) -join ',') -eq 'records/client-build.json,records/client-licences.json,records/client-licences/fmt.txt,records/client-licences/zlib.txt,records/server-build.json')
    Yes '2.   byte for byte' ([Text.Encoding]::UTF8.GetString($files['records/client-licences/zlib.txt']) -eq 'zlib licence')
    Yes '2. Get-EngineRecordsCommit gives the fork commit' ((Get-EngineRecordsCommit $files) -eq $commit)
    function Zip-Of([hashtable]$entries) {
        $ms = New-Object IO.MemoryStream
        $za = New-Object IO.Compression.ZipArchive($ms, [IO.Compression.ZipArchiveMode]::Create, $true)
        foreach ($n in $entries.Keys) { $s = $za.CreateEntry($n).Open(); $b = $utf8.GetBytes($entries[$n]); $s.Write($b, 0, $b.Length); $s.Dispose() }
        $za.Dispose()
        return , $ms.ToArray()
    }
    $three = @{ 'records/server-build.json' = (Server-Record $commit); 'records/client-build.json' = (Client-Record $commit); 'records/client-licences.json' = '{}' }
    $e = Threw { Read-EngineRecordsBundle (Zip-Of ($three + @{ 'scripts/release/Ship.ps1' = 'x' })) }
    Yes '2. a bundle with another file in it is refused' ($e -match 'scripts/release/Ship\.ps1, which is not one of them')
    $e = Threw { Read-EngineRecordsBundle (Zip-Of ($three + @{ 'records/client-licences/../../x.txt' = 'x' })) }
    Yes '2.   and one with a path out of records\ is refused' ($e -match 'which is not one of them')
    $two = $three.Clone(); $two.Remove('records/client-licences.json')
    $e = Threw { Read-EngineRecordsBundle (Zip-Of $two) }
    Yes '2. a bundle with a record missing is refused' ($e -match 'no records\\client-licences\.json')
    $mixed = $three.Clone(); $mixed['records/client-build.json'] = Client-Record ('b6c76e45' + ('0' * 32))
    $e = Threw { Get-EngineRecordsCommit (Read-EngineRecordsBundle (Zip-Of $mixed)) }
    Yes '2. records of two commits are refused' ($e -match 'not one engine')
    $into = Join-Path $T 'into'
    Put (Join-Path $into 'records/client-licences/old-port.txt') 'a text the new build has not'
    Put (Join-Path $into 'records/server-build.json') 'old'
    Save-EngineRecords $files $into
    Yes '2. Save-EngineRecords writes the records' ([IO.File]::ReadAllText((Join-Path $into 'records/server-build.json')) -eq (Server-Record $commit) -and (Test-Path -LiteralPath (Join-Path $into 'records/client-licences/fmt.txt')))
    Yes '2.   and replaces records\client-licences\ whole' (-not (Test-Path -LiteralPath (Join-Path $into 'records/client-licences/old-port.txt')) -and @(Get-ChildItem -LiteralPath (Join-Path $into 'records/client-licences')).Count -eq 2)

    # ========================================= 3. Get-EngineRecords.ps1 whole ==
    Write-Host ''; Write-Host '3. Get-EngineRecords.ps1'
    $null = & git -C $repo init -q 2>&1
    Put (Join-Path $repo 'records/client-licences/old-port.txt') 'a text the new build has not'
    Put (Join-Path $repo 'records/server-build.json') (Server-Record ('595d2997' + ('0' * 32)))
    $oldPin = '595d2997b87e86a425ec68ee5095d50d3a93c0dc'
    $null = & git -C $repo update-index --add --cacheinfo "160000,$oldPin,engine/skymp" 2>&1
    $gh = Join-Path $T 'gh'
    $null = New-Item -ItemType Directory -Force -Path $gh
    [IO.File]::WriteAllText((Join-Path $gh 'run.json'), '{"id":40400000000,"path":".github/workflows/engine.yml","status":"completed","conclusion":"success","html_url":"https://github.com/ThornswoodRP/Thornswood/actions/runs/40400000000"}', $utf8)
    [IO.File]::WriteAllText((Join-Path $gh 'jobs.json'), '{"jobs":[{"id":111,"name":"Engine build","conclusion":"failure"},{"id":222,"name":"Engine build (VPS fallback)","conclusion":"success"},{"id":333,"name":"Wake the engine pin","conclusion":"success"}]}', $utf8)
    $logLines = @('2026-10-26T17:00:00.0000000Z Run .\scripts\release\EngineRecords.ps1') + @(Get-LogHandBackLines ('ENGINE' + '-RECORDS') $bundle | ForEach-Object { '2026-10-26T17:00:01.0000000Z ' + $_ })
    [IO.File]::WriteAllLines((Join-Path $gh 'log-222.txt'), [string[]]$logLines)
    [IO.File]::WriteAllText((Join-Path $gh 'log-111.txt'), 'the hosted job, refused for billing', $utf8)
    $ghFake = Join-Path $T 'gh-stand-in.ps1'
    [IO.File]::WriteAllText($ghFake, @'
$state = $env:TS_GH_STATE
[IO.File]::AppendAllText((Join-Path $state 'calls.txt'), (($args -join ' ') + "`n"))
# TS_GH_NEW: a gh of 2.92 or newer, which names --allow-escape-sequences in
# its help and refuses a log (whose colours are escape sequences) without it.
if ($args[0] -eq 'api' -and $args[1] -eq '--help') { if ($env:TS_GH_NEW) { 'FLAGS'; '  --allow-escape-sequences   Allow terminal escape sequences in the output' }; exit 0 }
if ($env:TS_GH_NEW -and $args[0] -eq 'api' -and $args[1] -match '/logs$' -and $args -notcontains '--allow-escape-sequences') { [Console]::Error.WriteLine('the response contains terminal escape sequences; pass --allow-escape-sequences to output it anyway'); exit 1 }
if ($args[0] -eq 'api' -and $args[1] -eq 'repos/ThornswoodRP/Thornswood/actions/runs/40400000000') { [IO.File]::ReadAllText((Join-Path $state 'run.json')); exit 0 }
if ($args[0] -eq 'api' -and $args[1] -eq 'repos/ThornswoodRP/Thornswood/actions/runs/40400000000/jobs') { [IO.File]::ReadAllText((Join-Path $state 'jobs.json')); exit 0 }
if ($args[0] -eq 'api' -and $args[1] -match '^repos/ThornswoodRP/Thornswood/actions/jobs/(\d+)/logs$') { [IO.File]::ReadAllLines((Join-Path $state ('log-' + $Matches[1] + '.txt'))); exit 0 }
[Console]::Error.WriteLine('stand-in gh was asked ' + ($args -join ' ')); exit 1
'@, $utf8)
    $env:TS_GH_STATE = $gh
    $script = Join-Path $repo 'scripts/release/Get-EngineRecords.ps1'
    $ps = (Get-Process -Id $PID).Path
    function Take() {
        $o = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $t = & $ps -NoProfile -ExecutionPolicy Bypass -File $script -Run 40400000000 -Gh $ghFake -NoPause 2>&1 | Out-String; return [pscustomobject]@{ Code = $LASTEXITCODE; Out = $t } }
        finally { $ErrorActionPreference = $o }
    }
    function Untouched { return ((Test-Path -LiteralPath (Join-Path $repo 'records/client-licences/old-port.txt')) -and -not (Test-Path -LiteralPath (Join-Path $repo 'records/client-build.json'))) }

    $keep = [IO.File]::ReadAllText((Join-Path $gh 'run.json'))
    [IO.File]::WriteAllText((Join-Path $gh 'run.json'), $keep.Replace('engine.yml', 'build.yml'), $utf8)
    $r = Take
    Yes ("3. a run that is not engine.yml's stops, writing nothing (exit {0})" -f $r.Code) ($r.Code -eq 1 -and $r.Out -match 'is not an engine\.yml run' -and (Untouched))
    [IO.File]::WriteAllText((Join-Path $gh 'run.json'), $keep.Replace('"success"', '"failure"'), $utf8)
    $r = Take
    Yes ("3. a run that is not green stops, writing nothing (exit {0})" -f $r.Code) ($r.Code -eq 1 -and $r.Out -match 'not green' -and (Untouched))
    [IO.File]::WriteAllText((Join-Path $gh 'run.json'), $keep, $utf8)
    $logKeep = [IO.File]::ReadAllText((Join-Path $gh 'log-222.txt'))
    [IO.File]::WriteAllText((Join-Path $gh 'log-222.txt'), 'a log from before #3399', $utf8)
    $r = Take
    Yes ("3. a log with no records stops saying so (exit {0})" -f $r.Code) ($r.Code -eq 1 -and $r.Out -match 'does not hold the records whole' -and (Untouched))
    [IO.File]::WriteAllText((Join-Path $gh 'log-222.txt'), $logKeep, $utf8)
    $r = Take
    Yes ("3. records of another commit than the index pins stop, naming the line that moves the pin (exit {0})" -f $r.Code) (
        $r.Code -eq 1 -and $r.Out -match "recorded fork commit $commit" -and $r.Out -match "pins engine/skymp to $oldPin" -and $r.Out -match [regex]::Escape("git update-index --cacheinfo 160000,$commit,engine/skymp") -and (Untouched))
    $null = & git -C $repo update-index --cacheinfo "160000,$commit,engine/skymp" 2>&1
    $r = Take
    Yes ("3. with the pin moved, the records are written (exit {0})" -f $r.Code) ($r.Code -eq 0 -and $r.Out -match 'records of fork commit c1f2e448e9b9 are written' -and
        [IO.File]::ReadAllText((Join-Path $repo 'records/server-build.json')) -eq (Server-Record $commit) -and (Test-Path -LiteralPath (Join-Path $repo 'records/client-build.json')))
    Yes '3.   and the old licence text is gone' (-not (Test-Path -LiteralPath (Join-Path $repo 'records/client-licences/old-port.txt')) -and (Test-Path -LiteralPath (Join-Path $repo 'records/client-licences/zlib.txt')))
    Yes '3.   read from the log of the Engine build job that succeeded' ([IO.File]::ReadAllText((Join-Path $gh 'calls.txt')) -match 'actions/jobs/222/logs' -and -not ([IO.File]::ReadAllText((Join-Path $gh 'calls.txt')) -match 'actions/jobs/111/logs'))
    Yes '3.   not the wake job that succeeded beside it (#5219)' (-not ([IO.File]::ReadAllText((Join-Path $gh 'calls.txt')) -match 'actions/jobs/333/logs'))
    Yes '3.   an older gh, with no such flag, is not given --allow-escape-sequences' ([IO.File]::ReadAllText((Join-Path $gh 'calls.txt')) -notmatch 'allow-escape-sequences')
    # #5202: engine-pin.yml stopped here on 31 Oct 2026, its runner's gh
    # refusing the log for its colours.
    [IO.File]::WriteAllText((Join-Path $gh 'calls.txt'), '', $utf8)
    $env:TS_GH_NEW = '1'
    try { $r = Take } finally { Remove-Item -LiteralPath 'Env:TS_GH_NEW' -ErrorAction SilentlyContinue }
    Yes ("3. a gh that refuses a log's escape sequences is told --allow-escape-sequences, and the records are written (exit {0})" -f $r.Code) ($r.Code -eq 0 -and
        [IO.File]::ReadAllText((Join-Path $gh 'calls.txt')) -match 'actions/jobs/222/logs --allow-escape-sequences')
}
finally {
    Remove-Item -LiteralPath 'Env:TS_GH_STATE' -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
