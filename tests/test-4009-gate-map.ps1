<#
  test-4009-gate-map.ps1

      pwsh -NoProfile -File .\tests\test-4009-gate-map.ps1

  Issues #4009 and #5183: a pull request built off the box had no traced
  map and ran the whole gate. Since #5183 main's nightly trace on GitHub's
  Windows runner (.github\workflows\gate-map.yml) keeps the map as an
  artifact named gate-map, and scripts\dev\Gate-Map.ps1 -Fetch reads it
  back. This holds:

    1. -Fetch, against a stand-in for GitHub's API, writes latest.json, the
       map and the tree from the newest of main's own traces that kept one,
       and Affected-Harnesses.js pick picks from them;
    2. it passes over a run that is not gate-map.yml on main from the
       schedule or by hand of this repository (a pull request's trial, a
       branch's, another workflow's, a fork's), a run with no gate-map
       artifact or an expired one, and an artifact whose latest.json names
       another run or that lacks the map or the tree, and says why; with
       nothing usable, or no token, it exits 1; it takes the token from
       GATE_MAP_TOKEN and leaves none in the environment, and nothing hands
       it one on a command line (#4079);
    3. the gate's shares get the job's token for it, with actions: read, and
       Run-Gate.ps1 takes it out of the environment before any harness runs;
    4. gate-map.yml keeps gate-map only from main and gate-map-trial from a
       pull request, traces on windows-2022 and needs no secret; and since
       #5293 runs the whole gate on Linux beside it and keeps the two runs'
       comparison in the same map.

  Writes only its scratch folder, in the system's temp folder, and deletes it.
#>
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
function Gzip([string]$text) {
    $bytes = [Text.Encoding]::UTF8.GetBytes($text)
    $ms = New-Object IO.MemoryStream
    $gz = New-Object IO.Compression.GZipStream($ms, [IO.Compression.CompressionMode]::Compress)
    $gz.Write($bytes, 0, $bytes.Length); $gz.Close()
    , $ms.ToArray()
}

$gateMap = Join-Path (Join-Path (Join-Path $repo 'scripts') 'dev') 'Gate-Map.ps1'
$affected = Join-Path (Join-Path (Join-Path $repo 'scripts') 'dev') 'Affected-Harnesses.js'
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('gate-map-' + [Guid]::NewGuid().ToString('N'))
$keepEnv = @{}
foreach ($n in 'GATE_MAP_TOKEN') { $keepEnv[$n] = [Environment]::GetEnvironmentVariable($n) }
try {
    # ---- the box runner's folder, and the map the trace task left in it
    $root = Join-Path $scratch 'Thornswood-Runner'
    $temp = Join-Path (Join-Path $root '_work') '_temp'
    $maps = Join-Path $root 'gate-map'
    $null = New-Item -ItemType Directory -Force -Path $temp, $maps
    $key = '39800000001-1'
    $commit = ((& git -C $repo rev-parse HEAD) -join '').Trim()
    # Two harnesses: one reads README.md, which every commit has, one always
    # runs. Enough lines that the map takes more than one piece.
    $traces = @(
        '{"harness":"test-a.js","platform":"windows","listings":"enumerated","exit":0,"seconds":1,"skipped":false,"execs":["node.exe"],"paths":{"README.md":"read"}}',
        '{"harness":"test-c.js","platform":"windows","listings":"enumerated","exit":0,"seconds":1,"skipped":false,"always":"another process (git.exe) opened .git in the checkout while it ran","execs":["node.exe"],"paths":{}}'
    )
    for ($i = 0; $i -lt 400; $i++) { $traces += ('{"harness":"test-z' + $i + '.js","platform":"windows","listings":"enumerated","exit":0,"seconds":1,"skipped":false,"execs":["node.exe"],"paths":{"docs/z' + $i + '-' + [Guid]::NewGuid().ToString('N') + '.md":"read"}}') }
    [IO.File]::WriteAllBytes((Join-Path $maps ($key + '.traces.jsonl.gz')), (Gzip ($traces -join "`n")))
    $null = & node $affected tree $commit (Join-Path $maps ($key + '.tree.gz'))
    Set-Content -LiteralPath (Join-Path $maps 'latest.json') -Value ('{"key":"' + $key + '","commit":"' + $commit + '","read":"2026-10-27T03:00:00Z","harnesses":402}')

    # ---- the artifact gate-map.yml keeps, as a zip
    $art = Join-Path $scratch 'art'
    $null = New-Item -ItemType Directory -Force -Path $art
    $built = Join-Path $art ($key + '.map.json')
    $null = & node $affected build (Join-Path $maps ($key + '.traces.jsonl.gz')) $built $commit
    Copy-Item -LiteralPath (Join-Path $maps ($key + '.tree.gz')) -Destination (Join-Path $art ($key + '.tree.gz'))
    Set-Content -LiteralPath (Join-Path $art 'latest.json') -Value ('{"key":"' + $key + '","commit":"' + $commit + '","read":"2026-11-01 10:50 UTC"}')
    function Zip([string]$from, [string]$name) {
        $z = Join-Path $scratch ($name + '.zip')
        Compress-Archive -Path (Join-Path $from '*') -DestinationPath $z -Force
        return $z
    }
    $goodZip = Zip $art 'good'
    $other = Join-Path $scratch 'other'; Copy-Item -LiteralPath $art -Destination $other -Recurse
    Set-Content -LiteralPath (Join-Path $other 'latest.json') -Value ('{"key":"12345-1","commit":"' + $commit + '","read":"x"}')
    $otherZip = Zip $other 'other'
    $lack = Join-Path $scratch 'lack'; Copy-Item -LiteralPath $art -Destination $lack -Recurse
    Remove-Item -LiteralPath (Join-Path $lack ($key + '.tree.gz'))
    $lackZip = Zip $lack 'lack'

    $runId = [long]($key.Split('-')[0])
    function Run([long]$id, [string]$event = 'schedule', [string]$branch = 'main', [string]$path = '.github/workflows/gate-map.yml', [string]$repoName = 'o/r') {
        @{ id = $id; event = $event; head_branch = $branch; path = $path; head_repository = @{ full_name = $repoName } }
    }
    function Art([long]$id, [string]$name = 'gate-map', [bool]$expired = $false) { @{ id = $id; name = $name; expired = $expired } }
    $global:GateMapStub = $null
    $global:GateMapAsked = @()
    function global:Invoke-RestMethod {
        param([string]$Method, [string]$Uri, $Headers)
        $global:GateMapAsked += $Uri
        if ($Headers.Authorization -ne 'Bearer t0ken') { throw 'no token' }
        if ($Uri -match '/workflows/gate-map\.yml/runs\?branch=main&status=completed') { return @{ workflow_runs = $global:GateMapStub.Runs } }
        if ($Uri -match '/runs/(\d+)/artifacts\?name=gate-map$') { return @{ artifacts = @($global:GateMapStub.Arts[$Matches[1]]) } }
        throw ('no stand-in for ' + $Uri)
    }
    function global:Invoke-WebRequest {
        param([string]$Method, [string]$Uri, $Headers, [string]$OutFile, [switch]$UseBasicParsing)
        if ($Uri -notmatch '/artifacts/(\d+)/zip$') { throw ('no stand-in for ' + $Uri) }
        Copy-Item -LiteralPath $global:GateMapStub.Zips[$Matches[1]] -Destination $OutFile
    }
    $fetched = Join-Path $scratch 'fetched'
    function Invoke-Fetch([string]$token = 't0ken') {
        Remove-Item -LiteralPath $fetched -Recurse -Force -ErrorAction SilentlyContinue
        $env:GATE_MAP_TOKEN = $token
        $out = @(& $gateMap -Fetch $fetched -Repository 'o/r' 6>&1 | ForEach-Object { "$_" })
        [pscustomobject]@{ Code = $LASTEXITCODE; Text = ($out -join "`n"); Left = (Test-Path -LiteralPath Env:GATE_MAP_TOKEN) }
    }

    # ---- 1. the newest of main's own
    $global:GateMapStub = @{ Runs = @((Run $runId)); Arts = @{ "$runId" = (Art 77) }; Zips = @{ '77' = $goodZip } }
    $f = Invoke-Fetch
    Yes ('-Fetch writes the map main''s newest trace kept (exit ' + $f.Code + ')') ($f.Code -eq 0 -and $f.Text -match ('run ' + $runId) -and (Test-Path -LiteralPath (Join-Path $fetched 'latest.json')))
    Yes '  taking its token from GATE_MAP_TOKEN, which it leaves out of the environment' (-not $f.Left)
    $lj = $null
    if (Test-Path -LiteralPath (Join-Path $fetched 'latest.json')) { $lj = [IO.File]::ReadAllText((Join-Path $fetched 'latest.json')) | ConvertFrom-Json }
    Yes '  latest.json names the run and commit' ($lj -and $lj.key -eq $key -and $lj.commit -eq $commit)
    Yes '  the map and the tree are the artifact''s, byte for byte' ((Test-Path -LiteralPath (Join-Path $fetched ($key + '.map.json'))) -and
        ([IO.File]::ReadAllText($built) -eq [IO.File]::ReadAllText((Join-Path $fetched ($key + '.map.json')))) -and
        (Get-FileHash -LiteralPath (Join-Path $fetched ($key + '.tree.gz'))).Hash -eq (Get-FileHash -LiteralPath (Join-Path $maps ($key + '.tree.gz'))).Hash)
    Yes '  and leaves nothing else in the folder' (@(Get-ChildItem -LiteralPath $fetched).Count -eq 3)
    $gateFile = Join-Path $scratch 'gate.txt'
    $picked = Join-Path $scratch 'picked.txt'
    [IO.File]::WriteAllLines($gateFile, [string[]]@('test-a.js', 'test-c.js', 'test-z1.js'))
    $p = @(& node $affected pick (Join-Path $fetched ($key + '.map.json')) (Join-Path $fetched ($key + '.tree.gz')) $commit $gateFile $picked 2>&1 | ForEach-Object { "$_" })
    Yes ('Affected-Harnesses.js pick picks from it: ' + (($p | Select-Object -First 1) -join '')) ($LASTEXITCODE -eq 0 -and @([IO.File]::ReadAllLines($picked)) -join ' ' -eq 'test-c.js')
    $p = @(& node $affected pick (Join-Path $fetched ($key + '.map.json')) (Join-Path $fetched ($key + '.tree.gz')) ('0' * 40) $gateFile $picked 2>&1 | ForEach-Object { "$_" })
    Yes '  and refuses a map of another commit than latest.json names' ($LASTEXITCODE -ne 0)

    # ---- 2. what it passes over
    $global:GateMapStub = @{
        Runs = @((Run 905 'pull_request'), (Run 904 'schedule' 'my-branch'), (Run 903 'schedule' 'main' '.github/workflows/nightly.yml'), (Run 902 'schedule' 'main' '.github/workflows/gate-map.yml' 'fork/r'), (Run 901 'workflow_dispatch'), (Run $runId 'workflow_dispatch'))
        Arts = @{ '901' = @(); "$runId" = (Art 77) }
        Zips = @{ '77' = $goodZip }
    }
    $f = Invoke-Fetch
    Yes ('-Fetch passes over a pull request''s run, a branch''s, another workflow''s and a fork''s (exit ' + $f.Code + ')') ($f.Code -eq 0 -and $f.Text -match 'Passed over run 905' -and $f.Text -match 'Passed over run 904' -and $f.Text -match 'Passed over run 903' -and $f.Text -match 'Passed over run 902')
    Yes '  and a run that kept no gate-map, and takes the next' ($f.Text -match 'run 901: it kept no gate-map' -and $f.Text -match ('The map of main''s gate trace, run ' + $runId))
    Yes '  and never asks for a passed-over run''s artifacts' (-not @($global:GateMapAsked | Where-Object { $_ -match '/runs/(90[2-5])/artifacts' }).Count)

    $global:GateMapStub = @{ Runs = @((Run $runId), (Run 931), (Run 930)); Arts = @{ "$runId" = (Art 79 'gate-map' $true); '931' = (Art 78); '930' = (Art 80) }; Zips = @{ '78' = $otherZip; '80' = $lackZip } }
    $f = Invoke-Fetch
    Yes ('an expired artifact, one whose latest.json names another run and one that lacks the tree are passed over, and with nothing else it exits 1 (exit ' + $f.Code + ')') (
        $f.Code -eq 1 -and $f.Text -match ('run ' + $runId + ': it kept no gate-map artifact that has not expired') -and $f.Text -match 'run 931: its latest.json names 12345-1' -and $f.Text -match 'run 930: its latest.json names' -and -not (Test-Path -LiteralPath (Join-Path $fetched 'latest.json')))
    $global:GateMapStub = @{ Runs = @((Run 930)); Arts = @{ '930' = (Art 80) }; Zips = @{ '80' = $lackZip } }
    $global:GateMapStub.Runs[0].id = $runId; $global:GateMapStub.Arts = @{ "$runId" = (Art 80) }
    $f = Invoke-Fetch
    Yes '  an artifact of the right run that lacks its tree is passed over, said' ($f.Code -eq 1 -and $f.Text -match ('it holds no ' + [regex]::Escape($key) + '\.tree\.gz'))
    $f = Invoke-Fetch ''
    Yes 'with no token it exits 1 and asks GitHub nothing' ($f.Code -eq 1 -and $f.Text -match 'No token')
} finally {
    Remove-Item -LiteralPath Function:\Invoke-RestMethod, Function:\Invoke-WebRequest, Variable:\GateMapStub, Variable:\GateMapAsked -ErrorAction SilentlyContinue
    foreach ($n in $keepEnv.Keys) { [Environment]::SetEnvironmentVariable($n, $keepEnv[$n]) }
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- 3. build.yml and Run-Gate.ps1
$b = [IO.File]::ReadAllText((Join-Path (Join-Path (Join-Path $repo '.github') 'workflows') 'build.yml')).Replace("`r`n", "`n")
$gateJob = [regex]::Match($b, '(?ms)^  gate:\n.*?(?=^  \S)').Value
$pickJob = [regex]::Match($b, '(?ms)^  pick:\n.*?(?=^  \S)').Value
Yes 'build.yml no longer hands a map on (#4983)' (-not $b.Contains('Gate-Map.ps1 -Hand') -and $b.IndexOf("        id: gate`n") -gt 0)
Yes '  and gives its pick the job''s token for the map, with actions: read (#5183)' ($pickJob.Contains('GATE_MAP_TOKEN: ${{ github.token }}') -and $pickJob -match '(?m)^    permissions:\n      contents: read\n      actions: read\n')
Yes '  and the shares no token: they fetch nothing' (-not $gateJob.Contains('GATE_MAP_TOKEN') -and -not $gateJob.Contains('github.token'))
$rg = [IO.File]::ReadAllText((Join-Path (Join-Path (Join-Path $repo 'scripts') 'dev') 'Run-Gate.ps1'))
Yes 'Run-Gate.ps1 hands Gate-Map.ps1 no token on its command line (#4079)' ($rg.Contains("& (Join-Path `$Here 'Gate-Map.ps1') -Fetch `$maps 2>&1") -and -not ($rg -match '-Token\b'))
Yes 'Run-Gate.ps1 takes the token out of the environment before any harness starts' ($rg.IndexOf('Remove-Item -LiteralPath Env:GATE_MAP_TOKEN') -gt 0 -and $rg.IndexOf('Remove-Item -LiteralPath Env:GATE_MAP_TOKEN') -lt $rg.IndexOf("& (Join-Path `$Here 'Nightly-Harnesses.ps1')"))
$gm = [IO.File]::ReadAllText((Join-Path (Join-Path (Join-Path $repo 'scripts') 'dev') 'Gate-Map.ps1'))
Yes 'Gate-Map.ps1 has no -Hand left' (-not $gm.Contains('[switch]$Hand'))

# ---- 4. gate-map.yml
$w = [IO.File]::ReadAllText((Join-Path (Join-Path (Join-Path $repo '.github') 'workflows') 'gate-map.yml')).Replace("`r`n", "`n")
Yes 'gate-map.yml runs nightly, by hand, and on a pull request that changes the trace' ($w -match "(?m)^  schedule:\n    - cron: '[^']+'" -and $w -match '(?m)^  workflow_dispatch:' -and $w -match '(?m)^  pull_request:\n    paths:')
# After a merge that changes what runs the gate (#5296): the push paths are
# Affected-Harnesses.js FORCE's, so a merge that makes every pull request run
# the whole gate traces a new map, and no other merge does.
$pushPaths = @()
if ($w -match "(?m)^  push:\n    branches: \[main\]\n    paths:\n((?:      - .+\n)+)") { $pushPaths = @($Matches[1].Trim() -split '\n' | ForEach-Object { $_.Trim().Substring(2).Trim("'") }) }
$samples = @('.github/workflows/build.yml', '.github/workflows/build-pr.yml', '.github/workflows/nightly.yml', '.github/workflows/gate-map.yml',
    'scripts/dev/Run-Gate.ps1', 'scripts/dev/Gate-Map.ps1', 'scripts/dev/Nightly-Harnesses.ps1', 'scripts/dev/Gate-Harnesses.ps1',
    'scripts/dev/Affected-Harnesses.js', 'scripts/dev/Trace-HarnessReads.js', 'scripts/dev/Check-Change.ps1', 'tests/gate-excluded.txt',
    'tests/Harness.psm1', 'tests/helper.ps1', 'tests/helper.js', 'tests/helper.cjs', 'tests/helper.mjs', 'tests/helper.py', 'tests/helper.c',
    'tests/test-4009-gate-map.ps1', 'tests/test-3182-tested-tree.js', 'tests/test-x.py', 'tests/fixtures/a.ps1', 'tests/notes.md',
    'records/build-runners.json', 'records/github-repo-settings.json', '.gitattributes', '.gitmodules', 'game/gamemode.js')
# GitHub's filter: * is anything but /, a later ! pattern takes a path out.
$byFilter = { param($f) $hit = $false; foreach ($p in $pushPaths) { $neg = $p.StartsWith('!'); $g = $p.TrimStart('!'); $re = '^' + ([regex]::Escape($g) -replace '\\\*', '[^/]*') + '$'; if ($f -match $re) { $hit = -not $neg } }; $hit }
$forceJs = "const f=require(process.argv[1]).FORCE;for(const p of process.argv.slice(2))console.log(f.some(r=>r[0].test(p))?'1':'0')"
$forced = @(node -e $forceJs (Join-Path (Join-Path (Join-Path $repo 'scripts') 'dev') 'Affected-Harnesses.js') @samples)
$differ = @(for ($i = 0; $i -lt $samples.Count; $i++) { if (($forced[$i] -eq '1') -ne [bool](& $byFilter $samples[$i])) { $samples[$i] } })
if ($differ.Count) { Write-Host ('  the push paths and FORCE differ for: ' + ($differ -join ', ')) }
Yes 'gate-map.yml traces again on a push to main that changes what forces the whole gate, and on no other (#5296)' ($pushPaths.Count -gt 0 -and $forced.Count -eq $samples.Count -and -not $differ.Count)
Yes '  its gate step ends 0 with the gate''s code kept, so the map is read whatever the gate did' ($w -match "(?m)^          Add-Content -LiteralPath \`$env:GITHUB_OUTPUT -Value \('code=' \+ \`$LASTEXITCODE\)\r?\n          exit 0\r?\n")
Yes '  keeps gate-map only from main, and never from a pull request' ($w -match "(?ms)- name: Keep the map\n\s+if: github\.event_name != 'pull_request' && github\.ref == 'refs/heads/main'\n.*?name: gate-map\n")
Yes '  keeps a pull request''s as gate-map-trial' ($w -match "(?ms)- name: Keep the trial map\n\s+if: github\.event_name == 'pull_request'\n.*?name: gate-map-trial\n")
Yes '  traces on windows-2022, where node''s stats are opens the trace sees' ($w -match '(?m)^    runs-on: windows-2022$')
Yes '  checks the trace on the runner before it starts one' ($w.IndexOf('-Mode selftest') -gt 0 -and $w.IndexOf('-Mode selftest') -lt $w.IndexOf('-Mode start'))
Yes '  and needs no secret, and keeps no credentials on disk' ($w -notmatch 'secrets\.' -and $w.Contains('persist-credentials: false'))
$checkoutOf = { param($text) if ($text -match '(?m)^      - uses: actions/checkout@\S+ # v\d+\n        with:\n((?:          .+\n)+)') { @($Matches[1].Trim() -split '\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne 'persist-credentials: false' } | Sort-Object) -join ';' } else { '' } }
$gateCo = & $checkoutOf $gateJob
Yes '  checks out what the gate''s shares check out, so the trace runs the gate on the same history (#5179)' ($gateCo -ne '' -and $gateCo.Contains('fetch-depth: 0') -and $gateCo -eq (& $checkoutOf $w))

# #5293: the whole gate on Linux beside the trace, and the two runs compared
# into the same map.
$at = $w.IndexOf("`n  linux:`n"); $pt = $w.IndexOf("`n  platforms:`n")
$linuxJob = $(if ($at -gt 0 -and $pt -gt $at) { $w.Substring($at, $pt - $at) } else { '' })
$platJob = $(if ($pt -gt 0) { $w.Substring($pt) } else { '' })
Yes '  runs the whole gate on Linux too, with the start log, on the same history (#5293)' ($linuxJob -match '(?m)^    runs-on: ubuntu-latest$' -and
    $linuxJob -match '(?m)^          \./scripts/dev/Run-Gate\.ps1 -Throttle \d+ -BudgetSeconds \d+ -StartLog ' -and (& $checkoutOf $linuxJob) -eq $gateCo)
Yes '  where a harness that fails stays on Windows and leaves the job green, and no line at all is red' ($linuxJob -match '(?m)^          exit 0$' -and $linuxJob.Contains("wrote no line for any harness'; exit 1"))
Yes '  both runs keep what each harness said' ($w -match '(?ms)name: gate-starts-windows\n\s+path: \$\{\{ runner\.temp \}\}/gate-trace/starts\.jsonl' -and $linuxJob -match 'name: gate-starts-linux\n\s+path: \$\{\{ runner\.temp \}\}/gate-linux/starts\.jsonl')
Yes '  the job "platforms" waits for both, and runs unless cancelled or the trace never ran' ($platJob -match "(?m)^    needs: \[trace, linux\]\n    if: \`$\{\{ !cancelled\(\) && needs\.trace\.result != 'skipped' \}\}$")
Yes '  compares them with Affected-Harnesses.js platforms into <key>.platforms.json, for the map''s commit' ($platJob.Contains("node scripts/dev/Affected-Harnesses.js platforms `$win `$lin (Join-Path `$map ([string]`$l.key + '.platforms.json')) ([string]`$l.commit)"))
Yes '  and keeps no platforms file when either run or the map is missing' ($platJob.Contains("'keep=false'") -and $platJob.Contains('the Linux run kept nothing') -and $platJob.Contains('the trace kept no map'))
Yes '  keeping the map again under its own name, gate-map only from main' ($platJob -match "(?ms)- name: Keep the map with it\n\s+if: steps\.compare\.outputs\.keep == 'true' && github\.event_name != 'pull_request' && github\.ref == 'refs/heads/main'\n.*?name: gate-map\n.*?overwrite: true\n" -and
    $platJob -match "(?ms)- name: Keep the trial map with it\n\s+if: steps\.compare\.outputs\.keep == 'true' && github\.event_name == 'pull_request'\n.*?name: gate-map-trial\n.*?overwrite: true\n")

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
