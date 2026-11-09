<#
  test-3114-run-gate.ps1

      pwsh -NoProfile -File .\tests\test-3114-run-gate.ps1

  Issue #3114, #4009 and #5183: a pull request runs only the gate harnesses
  its change can reach, by main's newest nightly map, which gate-map.yml
  traces on GitHub's hosted Windows runner. scripts\dev\Run-Gate.ps1 is
  build.yml's gate step. This runs it for real in a scratch repository,
  with Gate-Harnesses.ps1, Nightly-Harnesses.ps1 and Gate-Map.ps1 replaced
  by stand-ins that list three harnesses, write down what they were asked
  to run, and hand on a map:

    1. a pull request with main's map runs the harnesses that read what it
       changed and those that always run, says why each runs, and says
       nothing of whole, so its build keeps no "already tested" note; a
       change nothing reads runs only those that always run; the map is
       fetched into the runner's temp folder, and a runner's own
       <runner>\gate-map, which the box's old trace task filled, is never
       read (#5338);
    2. it runs the whole gate, and says whole=true, with no map, with a map
       that names no commit or does not read, and when it changes
       Run-Gate.ps1 itself;
    3. a main build runs the whole gate and says whole, and asks no trace
       task (#5338);
    4. the gate's exit code is the step's, and -StartLog given by hand
       (gate-map.yml) reaches Nightly-Harnesses.ps1;
    5. Run-Gate.ps1 has nothing left of the box's trace task (#5338);
    6. -Shard n -Of N with no plan runs harness i of the gate when i mod N
       is n - 1, says whole and reads no map, and a share that is not one
       exits 2 and runs nothing (build.yml's job "gate");
    7. -Pick N (build.yml's job "pick", #5183) runs nothing and writes a
       plan: on a pull request what its change reaches, on main the whole
       gate, split by the map's seconds, longest first to the least loaded
       share, or by place with no map; each share given the plan in
       GATE_PLAN runs its part, fetching nothing, and one given a plan it
       cannot trust runs nothing and fails. #5292: it makes no more shares
       than there are harnesses to run, and none (shares=[]) for a change
       that reaches none.

  Writes only its scratch folder, in the system's temp folder, and deletes it.
#>
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
function GitOk { $o = @(& git @args 2>&1); if ($LASTEXITCODE -ne 0) { throw ('git ' + ($args -join ' ') + ': ' + ($o -join ' ')) }; $o }
function Gzip([string]$text) {
    $bytes = [Text.Encoding]::UTF8.GetBytes($text)
    $ms = New-Object IO.MemoryStream
    $gz = New-Object IO.Compression.GZipStream($ms, [IO.Compression.CompressionMode]::Compress)
    $gz.Write($bytes, 0, $bytes.Length); $gz.Close()
    , $ms.ToArray()
}

$scratch = Join-Path ([IO.Path]::GetTempPath()) ('run-gate-' + [Guid]::NewGuid().ToString('N'))
$keepEnv = @{}
foreach ($n in 'RUNNER_ENVIRONMENT', 'RUNNER_TEMP', 'GITHUB_EVENT_NAME', 'GITHUB_REF', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_OUTPUT', 'STUB_RECORD', 'STUB_CODE', 'STUB_MAP', 'STUB_TOKEN', 'GATE_MAP_TOKEN', 'GATE_PLAN', 'RUNNER_NAME', 'COMPUTERNAME') {
    $keepEnv[$n] = [Environment]::GetEnvironmentVariable($n)
}
$here = Get-Location
try {
    # ---- the scratch repository, with stand-ins for the lister and the runner
    $sr = Join-Path $scratch 'repo'
    $dev = Join-Path (Join-Path $sr 'scripts') 'dev'
    $null = New-Item -ItemType Directory -Force -Path $dev, (Join-Path $sr 'records')
    foreach ($f in 'Run-Gate.ps1', 'Affected-Harnesses.js') { Copy-Item -LiteralPath (Join-Path (Join-Path (Join-Path $repo 'scripts') 'dev') $f) -Destination $dev }
    Set-Content -LiteralPath (Join-Path $dev 'Gate-Harnesses.ps1') -Value "'test-a.js'`n'test-b.js'`n'test-c.js'`nexit 0"
    Set-Content -LiteralPath (Join-Path $dev 'Nightly-Harnesses.ps1') -Value @'
param([string]$Only = '', [int]$Throttle = 0, [int]$Share = 0, [int]$BudgetSeconds = 0, [string]$StartLog = '')
[IO.File]::WriteAllText($env:STUB_RECORD, (@{ Only = $Only; StartLog = $StartLog; Throttle = $Throttle; Share = $Share; Budget = $BudgetSeconds; Token = [string]$env:GATE_MAP_TOKEN } | ConvertTo-Json -Compress))
if ($StartLog) { [IO.File]::WriteAllText($StartLog, "{`"name`":`"test-a.js`",`"pid`":1}`n") }
exit [int]$env:STUB_CODE
'@
    # Gate-Map.ps1 -Fetch, standing in (#4009): copies STUB_MAP's folder,
    # the shape main's handed-on map takes, or has none.
    Set-Content -LiteralPath (Join-Path $dev 'Gate-Map.ps1') -Value @'
param([string]$Fetch = '')
[IO.File]::WriteAllText($env:STUB_TOKEN, [string]$env:GATE_MAP_TOKEN)
if (-not $env:STUB_MAP) { Write-Host 'no map on GitHub, standing in'; exit 1 }
# Whatever is there goes, as the real one does.
if (Test-Path -LiteralPath $Fetch) { Remove-Item -LiteralPath $Fetch -Recurse -Force }
$null = New-Item -ItemType Directory -Force -Path $Fetch
Copy-Item -Path (Join-Path $env:STUB_MAP '*') -Destination $Fetch
Write-Host 'the handed-on map, standing in'
exit 0
'@
    Set-Content -LiteralPath (Join-Path (Join-Path $sr 'records') 'build-runners.json') -Value '{"runners":[1,2]}'
    foreach ($f in 'a.txt', 'b.txt', 'd.txt') { Set-Content -LiteralPath (Join-Path $sr $f) -Value $f }
    $null = GitOk init -q $sr
    $null = GitOk -C $sr config user.name 'Run gate test'
    $null = GitOk -C $sr config user.email 'run-gate-test@example.invalid'
    $null = GitOk -C $sr config core.autocrlf false
    $null = GitOk -C $sr add -A
    $null = GitOk -C $sr commit -q -m base
    $base = ((GitOk -C $sr rev-parse HEAD) -join '').Trim()
    Set-Location -LiteralPath $sr

    # ---- the runner's folder, and main's nightly map
    $root = Join-Path $scratch 'Thornswood-Runner'
    $temp = Join-Path (Join-Path $root '_work') '_temp'
    $traced = Join-Path $scratch 'traced'
    $null = New-Item -ItemType Directory -Force -Path $temp, $traced
    $key = '39800000001-1'
    $traces = @(
        '{"harness":"test-a.js","platform":"windows","listings":"enumerated","exit":0,"seconds":1,"skipped":false,"execs":["node.exe"],"paths":{"a.txt":"read"}}',
        '{"harness":"test-b.js","platform":"windows","listings":"enumerated","exit":0,"seconds":1,"skipped":false,"execs":["node.exe"],"paths":{"b.txt":"read"}}',
        '{"harness":"test-c.js","platform":"windows","listings":"enumerated","exit":0,"seconds":1,"skipped":false,"always":"another process (git.exe) opened .git in the checkout while it ran","execs":["node.exe"],"paths":{}}'
    ) -join "`n"
    [IO.File]::WriteAllBytes((Join-Path $traced ($key + '.traces.jsonl.gz')), (Gzip $traces))
    & node (Join-Path $dev 'Affected-Harnesses.js') tree HEAD (Join-Path $traced ($key + '.tree.gz'))
    Yes 'Affected-Harnesses.js tree lists a commit''s tree' ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath (Join-Path $traced ($key + '.tree.gz'))))
    # Main's nightly map, the shape Gate-Map.ps1 -Fetch hands on (#4009).
    $handed = Join-Path $scratch 'handed'
    $null = New-Item -ItemType Directory -Path $handed
    $null = & node (Join-Path $dev 'Affected-Harnesses.js') build (Join-Path $traced ($key + '.traces.jsonl.gz')) (Join-Path $handed ($key + '.map.json')) $base
    Copy-Item -LiteralPath (Join-Path $traced ($key + '.tree.gz')) -Destination $handed
    Set-Content -LiteralPath (Join-Path $handed 'latest.json') -Value ('{"key":"' + $key + '","commit":"' + $base + '","read":"2026-10-22T14:00:00Z","harnesses":3}')
    $env:STUB_MAP = $handed
    # What the box's old trace task left in a box runner's own folder: never
    # read again (#5338). Read, it would make every pull request whole.
    $old = Join-Path $root 'gate-map'
    $null = New-Item -ItemType Directory -Path $old
    Set-Content -LiteralPath (Join-Path $old 'latest.json') -Value '{"key":"nothing","commit":"x"}'

    $record = Join-Path $scratch 'nightly.json'
    $tokenFile = Join-Path $scratch 'token.txt'
    $outFile = Join-Path $scratch 'output.txt'
    # Run-Gate.ps1 as the gate step runs it, on the event given; what it
    # printed, its exit code, what the stand-in was asked and its outputs.
    function Invoke-Gate([string]$event, [string]$runner = 'self-hosted', [string[]]$extra = @(), [int]$code = 0, [string]$plan = '') {
        Remove-Item -LiteralPath $record, $outFile -Force -ErrorAction SilentlyContinue
        $env:RUNNER_ENVIRONMENT = $runner; $env:RUNNER_TEMP = $temp; $env:GITHUB_EVENT_NAME = $event
        $env:GITHUB_REF = $(if ($event -eq 'push') { 'refs/heads/main' } else { 'refs/pull/7/merge' })
        $env:GITHUB_RUN_ID = '39800000002'; $env:GITHUB_RUN_ATTEMPT = '1'
        $env:GITHUB_OUTPUT = $outFile; $env:STUB_RECORD = $record; $env:STUB_CODE = [string]$code
        $env:STUB_TOKEN = $tokenFile; $env:GATE_MAP_TOKEN = 't0ken'; $env:GATE_PLAN = $plan
        Remove-Item -LiteralPath $tokenFile -Force -ErrorAction SilentlyContinue
        $out = @(& pwsh -NoProfile -File (Join-Path $dev 'Run-Gate.ps1') -Throttle 6 -BudgetSeconds 1800 @extra 2>&1 | ForEach-Object { "$_" })
        $rc = $LASTEXITCODE
        $asked = $null
        if (Test-Path -LiteralPath $record) { $asked = [IO.File]::ReadAllText($record) | ConvertFrom-Json }
        $outputs = ''
        if (Test-Path -LiteralPath $outFile) { $outputs = [IO.File]::ReadAllText($outFile) }
        $planOut = $null
        if ($outputs -match '(?m)^plan=(.*)$') { $planOut = $Matches[1].Trim() }
        [pscustomobject]@{ Code = $rc; Text = ($out -join "`n"); Asked = $asked; Whole = ($outputs -match '(?m)^whole=true\s*$'); Plan = $planOut; Outputs = $outputs }
    }

    # ---- 1. a pull request, with main's map
    Set-Content -LiteralPath (Join-Path $sr 'a.txt') -Value 'a, changed'
    $null = GitOk -C $sr commit -q -am 'change a'
    $r = Invoke-Gate 'pull_request'
    Yes ('a pull request runs what its change reaches and what always runs (' + $(if ($r.Asked) { $r.Asked.Only } else { 'nothing' }) + ')') ($r.Code -eq 0 -and $r.Asked -and $r.Asked.Only -eq 'test-a.js test-c.js')
    Yes '  with the throttle, the share and the budget' ($r.Asked -and $r.Asked.Throttle -eq 6 -and $r.Asked.Budget -eq 1800 -and $r.Asked.Share -ge 1)
    Yes '  says which map, and why each one runs' ($r.Text -match ('main ' + $base.Substring(0, 8)) -and $r.Text -match 'the handed-on map, standing in' -and $r.Text -match 'runs test-a\.js: reads a\.txt' -and $r.Text -match 'runs test-c\.js: always' -and $r.Text -match '2 of 3 gate harnesses')
    Yes '  and does not say whole, so it keeps no note' (-not $r.Whole)
    Yes '  having fetched the map into the runner''s temp folder, never read the runner''s own gate-map (#5338)' ((Test-Path -LiteralPath (Join-Path (Join-Path $temp 'gate-map-fetched') 'latest.json')) -and $r.Text -notmatch 'names no commit')
    Yes '  having asked Gate-Map.ps1 with the job''s token' ((Test-Path -LiteralPath $tokenFile) -and [IO.File]::ReadAllText($tokenFile) -eq 't0ken')
    Yes '  which no harness gets' ($r.Asked -and -not $r.Asked.Token)
    $r = Invoke-Gate 'pull_request' 'github-hosted'
    Yes 'and so does one on GitHub''s hosted runner' ($r.Asked -and $r.Asked.Only -eq 'test-a.js test-c.js' -and -not $r.Whole)

    $null = GitOk -C $sr reset -q --hard $base
    Set-Content -LiteralPath (Join-Path $sr 'd.txt') -Value 'd, changed'
    $null = GitOk -C $sr commit -q -am 'change d'
    $r = Invoke-Gate 'pull_request'
    Yes 'a change nothing reads runs only what always runs' ($r.Asked -and $r.Asked.Only -eq 'test-c.js' -and -not $r.Whole)

    # ---- 2. the whole gate
    $null = GitOk -C $sr reset -q --hard $base
    Set-Content -LiteralPath (Join-Path $sr 'a.txt') -Value 'a, changed'
    $null = GitOk -C $sr commit -q -am 'change a'
    $env:STUB_MAP = ''
    $r = Invoke-Gate 'pull_request' 'github-hosted'
    Yes 'with no map on GitHub it runs the whole gate and says whole, and why' ($r.Asked -and $r.Asked.Only -eq 'test-a.js test-b.js test-c.js' -and $r.Whole -and $r.Text -match 'The whole gate runs: main''s nightly gate map could not be fetched')
    $nocommit = Join-Path $scratch 'nocommit'
    $null = New-Item -ItemType Directory -Path $nocommit
    Set-Content -LiteralPath (Join-Path $nocommit 'latest.json') -Value '{"key":"nothing","commit":"x"}'
    $env:STUB_MAP = $nocommit
    $r = Invoke-Gate 'pull_request'
    Yes 'and with a map that names no commit' ($r.Asked -and $r.Asked.Only -eq 'test-a.js test-b.js test-c.js' -and $r.Whole -and $r.Text -match 'names no commit')
    $env:STUB_MAP = $handed
    $tree = Join-Path $handed ($key + '.tree.gz')
    Copy-Item -LiteralPath $tree -Destination (Join-Path $scratch 'tree.gz')
    [IO.File]::WriteAllText($tree, 'not gzip')
    $r = Invoke-Gate 'pull_request'
    Yes 'and with a map that does not read, saying pick failed' ($r.Asked -and $r.Asked.Only -eq 'test-a.js test-b.js test-c.js' -and $r.Whole -and $r.Text -match 'pick failed')
    Copy-Item -LiteralPath (Join-Path $scratch 'tree.gz') -Destination $tree -Force
    Add-Content -LiteralPath (Join-Path $dev 'Run-Gate.ps1') -Value '# a change to the script that chooses'
    $null = GitOk -C $sr commit -q -am 'change Run-Gate'
    $r = Invoke-Gate 'pull_request'
    Yes 'a change to Run-Gate.ps1 runs the whole gate and says whole' ($r.Asked -and $r.Asked.Only -eq 'test-a.js test-b.js test-c.js' -and $r.Whole -and $r.Text -match 'Run-Gate\.ps1: the scripts that list, choose and run')
    $null = GitOk -C $sr reset -q --hard $base

    # ---- 3. a main build
    $r = Invoke-Gate 'push' -code 3
    Yes 'a main build runs the whole gate and says whole' ($r.Asked -and $r.Asked.Only -eq 'test-a.js test-b.js test-c.js' -and $r.Whole)
    Yes '  asking no trace task, with no -StartLog, and makes no trace folder (#5338)' (-not $r.Asked.StartLog -and $r.Text -notmatch 'Traced|Not traced' -and -not (Test-Path -LiteralPath (Join-Path $root 'trace')))
    Yes '  and the gate''s exit code is the step''s' ($r.Code -eq 3)

    # ---- 4. by hand
    $r = Invoke-Gate 'workflow_dispatch' -extra @('-StartLog', (Join-Path $scratch 'hand.jsonl'))
    Yes 'a dispatch runs the whole gate with the -StartLog it was given (gate-map.yml)' ($r.Asked -and $r.Asked.Only -eq 'test-a.js test-b.js test-c.js' -and $r.Asked.StartLog -eq (Join-Path $scratch 'hand.jsonl') -and $r.Whole)

    # ---- 6. shares of the gate (31 Oct 2026): build.yml's job "gate" runs
    # -Shard n -Of 5 on five hosted runners at once. With no plan from the
    # pick, harness i of the list is share (i mod Of) + 1 of the whole gate,
    # and none reads a map.
    $union = @()
    foreach ($n in 1, 2, 3) {
        $r = Invoke-Gate 'pull_request' 'github-hosted' -extra @('-Shard', [string]$n, '-Of', '3')
        $want = @('test-a.js', 'test-b.js', 'test-c.js')[$n - 1]
        Yes ("share $n of 3 on a pull request runs its harness of the whole gate ($(if ($r.Asked) { $r.Asked.Only } else { 'nothing' }))") ($r.Code -eq 0 -and $r.Asked -and $r.Asked.Only -eq $want -and $r.Text -match "Share $n of 3 of the whole gate: 1 of its 3 harnesses")
        Yes '  says whole, reads no map and asks Gate-Map.ps1 nothing' ($r.Whole -and -not (Test-Path -LiteralPath $tokenFile) -and $r.Text -notmatch 'traced map|The whole gate runs')
        if ($r.Asked) { $union += @($r.Asked.Only -split ' ') }
    }
    Yes 'the shares together are the whole gate, each harness once' ((($union | Sort-Object) -join ' ') -eq 'test-a.js test-b.js test-c.js')
    $r = Invoke-Gate 'pull_request' 'github-hosted' -extra @('-Shard', '1', '-Of', '2')
    Yes 'share 1 of 2 takes the first and third' ($r.Asked -and $r.Asked.Only -eq 'test-a.js test-c.js' -and $r.Whole)
    $r = Invoke-Gate 'push' -extra @('-Shard', '2', '-Of', '2')
    Yes 'a share on main runs its part, with no -StartLog' ($r.Asked -and $r.Asked.Only -eq 'test-b.js' -and -not $r.Asked.StartLog)
    $r = Invoke-Gate 'pull_request' 'github-hosted' -extra @('-Shard', '3', '-Of', '2')
    Yes 'a share that is not one runs nothing and exits 2' ($r.Code -eq 2 -and -not $r.Asked -and $r.Text -match '-Shard 3 -Of 2 names no share')
    $r = Invoke-Gate 'pull_request' 'github-hosted' -extra @('-Shard', '2', '-Of', '3') -code 4
    Yes 'a share''s exit code is the step''s' ($r.Code -eq 4)

    # ---- 7. the pick (#5183): build.yml's job "pick" runs -Pick 5 once, on
    # Linux, and every share runs its part of that plan.
    $env:STUB_MAP = $handed
    Set-Content -LiteralPath (Join-Path $sr 'a.txt') -Value 'a, changed'
    $null = GitOk -C $sr commit -q -am 'change a'
    $r = Invoke-Gate 'pull_request' 'github-hosted' -extra @('-Pick', '2')
    $p = $null; if ($r.Plan) { $p = $r.Plan | ConvertFrom-Json }
    $flat = @(if ($p) { foreach ($x in @($p.shares)) { foreach ($n in @($x)) { [string]$n } } })
    Yes ('the pick on a pull request picks what its change reaches and splits it (' + $r.Plan + ')') ($r.Code -eq 0 -and -not $r.Asked -and $p -and [int]$p.of -eq 2 -and -not $p.whole -and [int]$p.gate -eq 3 -and @($p.shares).Count -eq 2 -and (($flat | Sort-Object) -join ' ') -eq 'test-a.js test-c.js')
    Yes '  runs no harness, and says whole=false and the shares for the matrix' (-not $r.Asked -and $r.Outputs -match '(?m)^whole=false\s*$' -and $r.Outputs -match '(?m)^shares=\[1,2\]\s*$')
    Yes '  having asked Gate-Map.ps1 with the job''s token, and says why each runs' ((Test-Path -LiteralPath $tokenFile) -and [IO.File]::ReadAllText($tokenFile) -eq 't0ken' -and $r.Text -match 'runs test-a\.js: reads a\.txt' -and $r.Text -match '2 of the gate''s 3 harnesses run, what this change can reach')
    $plan = $r.Plan
    $union = @()
    foreach ($n in 1, 2) {
        $r = Invoke-Gate 'pull_request' 'github-hosted' -extra @('-Shard', [string]$n, '-Of', '2') -plan $plan
        $want = @(@($p.shares)[$n - 1] | ForEach-Object { [string]$_ }) -join ' '
        Yes ("share $n of 2 runs its part of the plan ($want)") ($r.Code -eq 0 -and $(if ($want) { $r.Asked -and $r.Asked.Only -eq $want } else { -not $r.Asked }) -and $r.Text -match "Share $n of 2 of what this change can reach")
        Yes '  fetching nothing, and not saying whole' (-not (Test-Path -LiteralPath $tokenFile) -and -not $r.Whole)
        if ($r.Asked) { $union += @($r.Asked.Only -split ' ') }
    }
    Yes 'the shares of the plan together run what it picked, each once' ((($union | Sort-Object) -join ' ') -eq 'test-a.js test-c.js')

    # #5292: no more shares than harnesses to run, since an empty share still
    # waited for a Windows runner of its own; and none at all for a change
    # that reaches none, so build.yml skips the job "gate".
    $r = Invoke-Gate 'pull_request' 'github-hosted' -extra @('-Pick', '5')
    $p = $null; if ($r.Plan) { $p = $r.Plan | ConvertFrom-Json }
    Yes ('two harnesses picked for five shares make two shares, and say so (' + $r.Plan + ')') ($r.Code -eq 0 -and $p -and [int]$p.of -eq 2 -and @($p.shares).Count -eq 2 -and $r.Outputs -match '(?m)^shares=\[1,2\]\s*$' -and $r.Text -match '2 share\(s\), not 5')
    $r = Invoke-Gate 'pull_request' 'github-hosted' -extra @('-Shard', '1', '-Of', '1') -plan '{"of":1,"whole":false,"gate":3,"shares":[["test-a.js"]]}'
    Yes ('share 1 of 1, given a plan, runs the plan''s one part and fetches no map (' + $(if ($r.Asked) { $r.Asked.Only } else { 'nothing' }) + ')') ($r.Code -eq 0 -and $r.Asked -and $r.Asked.Only -eq 'test-a.js' -and -not (Test-Path -LiteralPath $tokenFile) -and $r.Text -match 'Share 1 of 1 of what this change can reach')
    $quiet = Join-Path $scratch 'quiet'
    $null = New-Item -ItemType Directory -Path $quiet
    $quietTraces = Join-Path $scratch 'quiet.traces.jsonl.gz'
    [IO.File]::WriteAllBytes($quietTraces, (Gzip ((@(
        '{"harness":"test-a.js","platform":"windows","listings":"enumerated","exit":0,"seconds":1,"skipped":false,"execs":["node.exe"],"paths":{"a.txt":"read"}}',
        '{"harness":"test-b.js","platform":"windows","listings":"enumerated","exit":0,"seconds":1,"skipped":false,"execs":["node.exe"],"paths":{"b.txt":"read"}}',
        '{"harness":"test-c.js","platform":"windows","listings":"enumerated","exit":0,"seconds":1,"skipped":false,"execs":["node.exe"],"paths":{"a.txt":"read"}}'
    )) -join "`n")))
    $null = & node (Join-Path $dev 'Affected-Harnesses.js') build $quietTraces (Join-Path $quiet ($key + '.map.json')) $base
    Copy-Item -LiteralPath (Join-Path $handed ($key + '.tree.gz')), (Join-Path $handed 'latest.json') -Destination $quiet
    $env:STUB_MAP = $quiet
    $null = GitOk -C $sr reset -q --hard $base
    Set-Content -LiteralPath (Join-Path $sr 'd.txt') -Value 'd, which no harness reads'
    $null = GitOk -C $sr commit -q -am 'change d'
    $r = Invoke-Gate 'pull_request' 'github-hosted' -extra @('-Pick', '5')
    $p = $null; if ($r.Plan) { $p = $r.Plan | ConvertFrom-Json }
    Yes ('a change no harness reads gets no share: shares=[] and a plan of none (' + $r.Plan + ')') ($r.Code -eq 0 -and $p -and [int]$p.of -eq 0 -and @($p.shares).Count -eq 0 -and $r.Outputs -match '(?m)^shares=\[\]\s*$' -and $r.Outputs -match '(?m)^whole=false\s*$')
    Yes '  says no Windows runner is started for the gate, and runs nothing' (-not $r.Asked -and $r.Text -match 'No gate harness of this change''s runs on Windows')
    $env:STUB_MAP = $handed

    # #5293: a harness the map's platforms file says Linux runs as fully as
    # Windows goes to a Linux share, when the pick is given Linux shares.
    $plat = Join-Path $scratch 'plat'
    $null = New-Item -ItemType Directory -Path $plat
    Copy-Item -Path (Join-Path $handed '*') -Destination $plat
    $pfile = Join-Path $plat ($key + '.platforms.json')
    Set-Content -LiteralPath $pfile -Value ('{"format":1,"commit":"' + $base + '","harnesses":{"test-a.js":{"linux":true},"test-b.js":{"linux":true},"test-c.js":{"linux":false,"why":"did not pass on Linux (exit 1)"}}}')
    $env:STUB_MAP = $plat
    $null = GitOk -C $sr reset -q --hard $base
    Set-Content -LiteralPath (Join-Path $sr 'a.txt') -Value 'a, changed'
    $null = GitOk -C $sr commit -q -am 'change a'
    $r = Invoke-Gate 'pull_request' 'github-hosted' -extra @('-Pick', '5', '-LinuxShares', '3')
    $p = $null; if ($r.Plan) { $p = $r.Plan | ConvertFrom-Json }
    Yes ('the pick sends what Linux runs fully to a Linux share, the rest to Windows (' + $r.Plan + ')') ($r.Code -eq 0 -and $p -and [int]$p.of -eq 1 -and (@(@($p.shares)[0]) -join ' ') -eq 'test-c.js' -and [int]$p.linux.of -eq 1 -and (@(@($p.linux.shares)[0]) -join ' ') -eq 'test-a.js')
    Yes '  says so, and hands both matrices on' ($r.Outputs -match '(?m)^shares=\[1\]\s*$' -and $r.Outputs -match '(?m)^linux_shares=\[1\]\s*$' -and $r.Text -match '1 on Windows, 1 on Linux' -and $r.Text -match '2 of its harnesses run on Linux as fully as on Windows')
    $lplan = $r.Plan
    $r = Invoke-Gate 'pull_request' 'github-hosted' -extra @('-Shard', '1', '-Of', '1', '-Platform', 'Linux') -plan $lplan
    Yes ('a Linux share runs the plan''s Linux part (' + $(if ($r.Asked) { $r.Asked.Only } else { 'nothing' }) + ')') ($r.Code -eq 0 -and $r.Asked -and $r.Asked.Only -eq 'test-a.js' -and $r.Text -match 'Linux Share 1 of 1')
    $r = Invoke-Gate 'pull_request' 'github-hosted' -extra @('-Shard', '1', '-Of', '1') -plan $lplan
    Yes ('  and the Windows share the rest (' + $(if ($r.Asked) { $r.Asked.Only } else { 'nothing' }) + ')') ($r.Code -eq 0 -and $r.Asked -and $r.Asked.Only -eq 'test-c.js')
    $r = Invoke-Gate 'pull_request' 'github-hosted' -extra @('-Shard', '1', '-Of', '2', '-Platform', 'Linux') -plan $lplan
    Yes '  a Linux share of a number the plan does not have runs nothing and fails' ($r.Code -eq 1 -and -not $r.Asked -and $r.Text -match 'is for 1 shares on Linux')
    $r = Invoke-Gate 'pull_request' 'github-hosted' -extra @('-Pick', '5')
    $p = $null; if ($r.Plan) { $p = $r.Plan | ConvertFrom-Json }
    Yes '  with no Linux shares asked for, everything runs on Windows' ($p -and [int]$p.of -eq 2 -and [int]$p.linux.of -eq 0 -and $r.Outputs -match '(?m)^linux_shares=\[\]\s*$')
    Set-Content -LiteralPath $pfile -Value ('{"format":1,"commit":"' + ('f' * 40) + '","harnesses":{"test-a.js":{"linux":true}}}')
    $r = Invoke-Gate 'pull_request' 'github-hosted' -extra @('-Pick', '5', '-LinuxShares', '3')
    $p = $null; if ($r.Plan) { $p = $r.Plan | ConvertFrom-Json }
    Yes '  and a platforms file of another commit is not used, saying so' ($p -and [int]$p.linux.of -eq 0 -and [int]$p.of -eq 2 -and $r.Text -match 'not the map''s commit')
    Remove-Item -LiteralPath $pfile
    $r = Invoke-Gate 'pull_request' 'github-hosted' -extra @('-Pick', '5', '-LinuxShares', '3')
    $p = $null; if ($r.Plan) { $p = $r.Plan | ConvertFrom-Json }
    Yes '  nor is a map with none: every harness on Windows' ($p -and [int]$p.linux.of -eq 0 -and $r.Text -match 'no platforms file')
    $env:STUB_MAP = $handed

    # A plan the share cannot trust stops it red, running nothing.
    $bad = @(
        @('one made for another number of shares', '{"of":3,"whole":false,"gate":3,"shares":[["test-a.js"],[],[]]}', 'is for 3 shares'),
        @('one made from another gate', '{"of":2,"whole":false,"gate":4,"shares":[["test-a.js"],[]]}', 'from a gate of 4'),
        @('one naming what is not on the gate', '{"of":2,"whole":false,"gate":3,"shares":[["test-z.js"],[]]}', 'not on this checkout''s gate: test-z\.js'),
        @('one with a harness in two shares', '{"of":2,"whole":false,"gate":3,"shares":[["test-a.js"],["test-a.js"]]}', 'in two shares'),
        @('one saying whole and missing one', '{"of":2,"whole":true,"gate":3,"shares":[["test-a.js"],["test-b.js"]]}', 'says whole and holds 2'),
        @('one that does not read', '{"of":2,', 'does not read'))
    foreach ($b in $bad) {
        $r = Invoke-Gate 'pull_request' 'github-hosted' -extra @('-Shard', '1', '-Of', '2') -plan $b[1]
        Yes ('a share given ' + $b[0] + ' runs nothing and fails') ($r.Code -eq 1 -and -not $r.Asked -and $r.Text -match $b[2])
    }

    # By the seconds each took when traced: test-a.js 10, test-b.js 1 and
    # test-c.js 5 make test-a.js one share and the other two the other, where
    # place in the list would give test-a.js and test-c.js together.
    $timed = Join-Path $scratch 'timed'
    $null = New-Item -ItemType Directory -Path $timed
    Copy-Item -Path (Join-Path $handed '*') -Destination $timed
    $mj = Join-Path $timed ($key + '.map.json')
    $m = [IO.File]::ReadAllText($mj) | ConvertFrom-Json
    $m.harnesses.'test-a.js'.seconds = 10; $m.harnesses.'test-b.js'.seconds = 1; $m.harnesses.'test-c.js'.seconds = 5
    [IO.File]::WriteAllText($mj, ($m | ConvertTo-Json -Depth 20))
    $env:STUB_MAP = $timed
    $null = GitOk -C $sr reset -q --hard $base
    $r = Invoke-Gate 'push' 'github-hosted' -extra @('-Pick', '2')
    $p = $null; if ($r.Plan) { $p = $r.Plan | ConvertFrom-Json }
    Yes ('the pick on main is the whole gate, split by seconds (' + $r.Plan + ')') ($r.Code -eq 0 -and $p -and $p.whole -and $r.Outputs -match '(?m)^whole=true\s*$' -and
        (@(@($p.shares)[0]) -join ' ') -eq 'test-a.js' -and (@(@($p.shares)[1]) -join ' ') -eq 'test-b.js test-c.js' -and $r.Text -match 'Split by the seconds each took' -and $r.Text -match 'Share 1 of 2: 1 harnesses about 10 s')
    $r = Invoke-Gate 'push' 'github-hosted' -extra @('-Shard', '2', '-Of', '2') -plan $r.Plan
    Yes '  and a share of it says whole and runs its part' ($r.Asked -and $r.Asked.Only -eq 'test-b.js test-c.js' -and $r.Whole -and $r.Text -match 'Share 2 of 2 of the whole gate: 2 of its 3 harnesses')
    $env:STUB_MAP = ''
    $r = Invoke-Gate 'pull_request' 'github-hosted' -extra @('-Pick', '2')
    $p = $null; if ($r.Plan) { $p = $r.Plan | ConvertFrom-Json }
    Yes ('with no map the pick is the whole gate by place in the list, saying why (' + $r.Plan + ')') ($r.Code -eq 0 -and $p -and $p.whole -and (@(@($p.shares)[0]) -join ' ') -eq 'test-a.js test-c.js' -and (@(@($p.shares)[1]) -join ' ') -eq 'test-b.js' -and $r.Text -match 'The whole gate runs: main''s nightly gate map could not be fetched' -and $r.Text -match 'Split by place in the list')

    # ---- this build's share of the cores (#3860): the machine's cores over
    # the builds it runs at once. One's five builds took the box's count
    # until 27 Oct 2026, six cores each of its 22, and ran out of time.
    $pc = [Environment]::ProcessorCount
    function Want([int]$n) { [int][Math]::Min(6, [Math]::Max(1, [Math]::Floor($pc / $n))) }
    $env:RUNNER_NAME = 'thornswood-vps-2'; $env:COMPUTERNAME = 'BOX'
    $r = Invoke-Gate 'workflow_dispatch'
    Yes ("on the box, a build's share is the cores over the box's build runners ({0} of {1})" -f $(if ($r.Asked) { $r.Asked.Share } else { '?' }), $pc) ($r.Asked -and $r.Asked.Share -eq (Want 2) -and $r.Text -match '2 build\(s\) at once on this machine')
    Set-Content -LiteralPath (Join-Path (Join-Path $sr 'records') 'pr-build-runners.json') -Value '{"label":"x","runners":[2],"offBox":["thornswood-pr-one","thornswood-pr-one-2","thornswood-pr-one-3","thornswood-pr-elsewhere"]}'
    Set-Content -LiteralPath (Join-Path (Join-Path $sr 'records') 'other-runners.json') -Value '{"label":"y","runners":[1],"offBox":["thornswood-pr-one-3","thornswood-pr-one-4"]}'
    $env:RUNNER_NAME = 'thornswood-pr-one-3'; $env:COMPUTERNAME = 'ONE'
    $r = Invoke-Gate 'workflow_dispatch'
    Yes ("on One, over One's runners the records name, each once ({0})" -f $(if ($r.Asked) { $r.Asked.Share } else { '?' })) ($r.Asked -and $r.Asked.Share -eq (Want 4) -and $r.Text -match '4 build\(s\) at once on this machine')
    $env:RUNNER_NAME = 'thornswood-pr-solo'; $env:COMPUTERNAME = 'SOLO'
    $r = Invoke-Gate 'workflow_dispatch'
    Yes '  an off-box runner no record names builds alone' ($r.Asked -and $r.Asked.Share -eq (Want 1))
    $env:RUNNER_NAME = 'GitHub Actions 7'
    $r = Invoke-Gate 'workflow_dispatch' 'github-hosted'
    Yes '  and so does GitHub''s hosted runner' ($r.Asked -and $r.Asked.Share -eq (Want 1))
    Remove-Item -LiteralPath (Join-Path (Join-Path $sr 'records') 'pr-build-runners.json'), (Join-Path (Join-Path $sr 'records') 'other-runners.json')
} finally {
    Set-Location -LiteralPath $here
    foreach ($n in $keepEnv.Keys) { [Environment]::SetEnvironmentVariable($n, $keepEnv[$n]) }
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- 5. nothing left of the box's trace task (#5338)
$rg = [IO.File]::ReadAllText((Join-Path (Join-Path (Join-Path $repo 'scripts') 'dev') 'Run-Gate.ps1'))
Yes 'Run-Gate.ps1 asks no trace task: no Request-Trace, no -AnswerSeconds, no ask.json' ($rg -notmatch 'Request-Trace|AnswerSeconds|Trace-Gate-Task|ask\.json|done\.json')
Yes '  and reads no runner''s own gate-map' ($rg -notmatch "Join-Path \`$root 'gate-map'")

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
