<#
  test-5183-check-change.ps1

      pwsh -NoProfile -File .\tests\test-5183-check-change.ps1

  Issue #5183: scripts\dev\Check-Change.ps1 is the one command to run before
  a push. It runs the gate harnesses the branch's change can reach, picked
  from main's nightly map the way the pull request's pick job does. This
  runs it for real in a scratch repository, with Gate-Harnesses.ps1,
  Gate-Map.ps1 and Nightly-Harnesses.ps1 replaced by stand-ins that list
  three harnesses, hand over a map or none, and write down what they were
  asked to run and which tokens they could see, and checks that:

    1. a tracked file with changes not committed stops it (exit 2) before
       anything runs;
    2. with no token anywhere it runs the whole gate and says why;
    3. with a token and a map it runs what the change reaches and what
       always runs, and the token reached Gate-Map.ps1 only, through
       GATE_MAP_TOKEN, never a harness, and GITHUB_TOKEN is back as it was
       afterwards;
    4. with a token and no map it runs the whole gate and says why;
    5. -List says what would run and runs nothing;
    6. a harness that fails makes it exit 1, and -Body with no file there,
       or a body with no release note line (thornswood-notes in
       tools\ReleaseNotes, or a FAIL naming the .NET SDK where it is not
       installed), fails too.

  Writes only its scratch folder, in the system's temp folder, and deletes it.
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows.ps1')
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

$scratch = Join-Path ([IO.Path]::GetTempPath()) ('check-change-test-' + [Guid]::NewGuid().ToString('N'))
$keepEnv = @{}
foreach ($n in 'GITHUB_TOKEN', 'GH_TOKEN', 'GATE_MAP_TOKEN', 'STUB_RECORD', 'STUB_CODE', 'STUB_MAP', 'STUB_TOKEN', 'PATH') { $keepEnv[$n] = [Environment]::GetEnvironmentVariable($n) }
$here = Get-Location
try {
    $sr = Join-Path $scratch 'repo'
    $dev = Join-Path (Join-Path $sr 'scripts') 'dev'
    $null = New-Item -ItemType Directory -Force -Path $dev
    foreach ($f in 'Check-Change.ps1', 'Affected-Harnesses.js') { Copy-Item -LiteralPath (Join-Path (Join-Path (Join-Path $repo 'scripts') 'dev') $f) -Destination $dev }
    $notes = Join-Path (Join-Path $sr 'tools') 'ReleaseNotes'
    $null = New-Item -ItemType Directory -Force -Path $notes
    foreach ($f in 'ReleaseNotes.csproj', 'packages.lock.json', 'NoteRules.cs', 'Program.cs') { Copy-Item -LiteralPath (Join-Path (Join-Path (Join-Path $repo 'tools') 'ReleaseNotes') $f) -Destination $notes }
    Set-Content -LiteralPath (Join-Path (Join-Path $sr 'tools') '.gitignore') -Value "bin/`nobj/"
    Set-Content -LiteralPath (Join-Path $dev 'Gate-Harnesses.ps1') -Value "'test-a.js'`n'test-b.js'`n'test-c.js'`nexit 0"
    Set-Content -LiteralPath (Join-Path $dev 'Nightly-Harnesses.ps1') -Value @'
param([string]$Only = '', [int]$Throttle = 0)
[IO.File]::WriteAllText($env:STUB_RECORD, (@{ Only = $Only; Throttle = $Throttle; Tokens = ([string]$env:GITHUB_TOKEN + [string]$env:GH_TOKEN + [string]$env:GATE_MAP_TOKEN) } | ConvertTo-Json -Compress))
exit [int]$env:STUB_CODE
'@
    # Gate-Map.ps1 -Fetch, standing in: writes down the token it was given
    # and whether GITHUB_TOKEN was still set, then copies STUB_MAP's folder.
    Set-Content -LiteralPath (Join-Path $dev 'Gate-Map.ps1') -Value @'
param([string]$Fetch = '', [string]$Repository = '')
[IO.File]::WriteAllText($env:STUB_TOKEN, ([string]$env:GATE_MAP_TOKEN + '|' + [string]$env:GITHUB_TOKEN + '|' + $Repository))
if (-not $env:STUB_MAP) { Write-Host 'no map on GitHub, standing in'; exit 1 }
$null = New-Item -ItemType Directory -Force -Path $Fetch
Copy-Item -Path (Join-Path $env:STUB_MAP '*') -Destination $Fetch
exit 0
'@
    foreach ($f in 'a.txt', 'b.txt', 'd.txt') { Set-Content -LiteralPath (Join-Path $sr $f) -Value $f }
    $null = GitOk init -q $sr
    $null = GitOk -C $sr config user.name 'Check change test'
    $null = GitOk -C $sr config user.email 'check-change-test@example.invalid'
    $null = GitOk -C $sr config core.autocrlf false
    $null = GitOk -C $sr add -A
    $null = GitOk -C $sr commit -q -m base
    $base = ((GitOk -C $sr rev-parse HEAD) -join '').Trim()
    Set-Location -LiteralPath $sr

    # The map of main's nightly trace: test-a.js reads a.txt, test-b.js
    # b.txt, and test-c.js always runs.
    $map = Join-Path $scratch 'map'
    $null = New-Item -ItemType Directory -Path $map
    $key = '41000000001-1'
    $traces = Join-Path $scratch 'traces.jsonl.gz'
    [IO.File]::WriteAllBytes($traces, (Gzip ((@(
        '{"harness":"test-a.js","platform":"windows","listings":"enumerated","exit":0,"seconds":1,"skipped":false,"execs":["node.exe"],"paths":{"a.txt":"read"}}',
        '{"harness":"test-b.js","platform":"windows","listings":"enumerated","exit":0,"seconds":1,"skipped":false,"execs":["node.exe"],"paths":{"b.txt":"read"}}',
        '{"harness":"test-c.js","platform":"windows","listings":"enumerated","exit":0,"seconds":1,"skipped":false,"always":"another process (git.exe) opened .git in the checkout while it ran","execs":["node.exe"],"paths":{}}'
    )) -join "`n")))
    $null = & node (Join-Path $dev 'Affected-Harnesses.js') build $traces (Join-Path $map ($key + '.map.json')) $base
    $null = & node (Join-Path $dev 'Affected-Harnesses.js') tree HEAD (Join-Path $map ($key + '.tree.gz'))
    Set-Content -LiteralPath (Join-Path $map 'latest.json') -Value ('{"key":"' + $key + '","commit":"' + $base + '","read":"2026-11-01 10:40 UTC"}')
    Yes 'the stand-in map is built' ((Test-Path -LiteralPath (Join-Path $map ($key + '.map.json'))) -and (Test-Path -LiteralPath (Join-Path $map ($key + '.tree.gz'))))

    # A gh that has no token, so "no token anywhere" holds on a machine
    # whose own gh is signed in.
    $bin = Join-Path $scratch 'bin'
    $null = New-Item -ItemType Directory -Path $bin
    if ($OnWindows) { Set-Content -LiteralPath (Join-Path $bin 'gh.cmd') -Value "@exit /b 1" }
    else { Set-Content -LiteralPath (Join-Path $bin 'gh') -Value "#!/bin/sh`nexit 1"; & chmod +x (Join-Path $bin 'gh') }
    $env:PATH = $bin + [IO.Path]::PathSeparator + $keepEnv['PATH']

    $record = Join-Path $scratch 'nightly.json'
    $tokenFile = Join-Path $scratch 'token.txt'
    function Invoke-Check([string[]]$extra = @(), [string]$token = '', [int]$code = 0) {
        Remove-Item -LiteralPath $record, $tokenFile -Force -ErrorAction SilentlyContinue
        $env:STUB_RECORD = $record; $env:STUB_TOKEN = $tokenFile; $env:STUB_CODE = [string]$code
        Remove-Item -LiteralPath Env:GH_TOKEN, Env:GATE_MAP_TOKEN -ErrorAction SilentlyContinue
        if ($token) { $env:GITHUB_TOKEN = $token } else { Remove-Item -LiteralPath Env:GITHUB_TOKEN -ErrorAction SilentlyContinue }
        $out = @(& pwsh -NoProfile -File (Join-Path $dev 'Check-Change.ps1') @extra 2>&1 | ForEach-Object { "$_" })
        $rc = $LASTEXITCODE
        $asked = $null
        if (Test-Path -LiteralPath $record) { $asked = [IO.File]::ReadAllText($record) | ConvertFrom-Json }
        $given = $(if (Test-Path -LiteralPath $tokenFile) { [IO.File]::ReadAllText($tokenFile) } else { $null })
        [pscustomobject]@{ Code = $rc; Text = ($out -join "`n"); Asked = $asked; Given = $given }
    }

    # ---- 1. changes not committed
    Set-Content -LiteralPath (Join-Path $sr 'a.txt') -Value 'a, not committed'
    $r = Invoke-Check
    Yes 'a tracked file with changes not committed stops it, running nothing' ($r.Code -eq 2 -and -not $r.Asked -and $r.Text -match 'not committed')
    $null = GitOk -C $sr commit -q -am 'change a'

    # ---- 2. no token anywhere
    $env:STUB_MAP = $map
    $r = Invoke-Check
    Yes ('with no token it runs the whole gate and says why (' + $(if ($r.Asked) { $r.Asked.Only } else { 'nothing' }) + ')') ($r.Code -eq 0 -and $r.Asked -and $r.Asked.Only -eq 'test-a.js test-b.js test-c.js' -and $r.Text -match 'no token' -and $null -eq $r.Given)

    # ---- 3. a token and a map
    $r = Invoke-Check -token 't0ken'
    Yes ('with a token and a map it runs what the change reaches and what always runs (' + $(if ($r.Asked) { $r.Asked.Only } else { 'nothing' }) + ')') ($r.Code -eq 0 -and $r.Asked -and $r.Asked.Only -eq 'test-a.js test-c.js' -and $r.Text -match '2 of the gate''s 3 harnesses')
    Yes '  the token reached Gate-Map.ps1 through GATE_MAP_TOKEN only, for this repository' ($r.Given -eq 't0ken||ThornswoodRP/Thornswood')
    Yes '  and no harness saw a token' ($r.Asked -and -not $r.Asked.Tokens)
    Yes '  with a throttle of the cores, six at most' ($r.Asked -and $r.Asked.Throttle -ge 1 -and $r.Asked.Throttle -le 6)
    Yes '  and says push it when everything passed' ($r.Text -match 'Push it\.')

    # ---- 4. a token and no map
    $env:STUB_MAP = ''
    $r = Invoke-Check -token 't0ken'
    Yes 'with a token and no map it runs the whole gate and says why' ($r.Asked -and $r.Asked.Only -eq 'test-a.js test-b.js test-c.js' -and $r.Text -match 'could not be fetched')
    $env:STUB_MAP = $map

    # ---- 5. -List
    $r = Invoke-Check -extra @('-List') -token 't0ken'
    Yes '-List says what would run and runs nothing' ($r.Code -eq 0 -and -not $r.Asked -and $r.Text -match '(?m)^  test-a\.js$' -and $r.Text -match '(?m)^  test-c\.js$' -and $r.Text -notmatch '(?m)^  test-b\.js$')

    # ---- 6. failures
    $r = Invoke-Check -token 't0ken' -code 1
    Yes 'a harness that fails makes it exit 1' ($r.Code -eq 1 -and $r.Text -match 'fix it before you push')
    $r = Invoke-Check -extra @('-Body', (Join-Path $scratch 'no-such-body.md')) -token 't0ken'
    Yes '-Body with no file there fails' ($r.Code -eq 1 -and $r.Text -match 'there is no body at')
    $noNote = Join-Path $scratch 'body.md'
    Set-Content -LiteralPath $noNote -Value "## What changed`n`nA change, and no release note line."
    $r = Invoke-Check -extra @('-Body', $noNote) -token 't0ken'
    if (Get-Command dotnet -CommandType Application -ErrorAction SilentlyContinue) {
        Yes '-Body with no release note line fails as the check "Release note" would' ($r.Code -eq 1 -and $r.Text -match 'STOP  release note: there is no "Release note:" line')
    } else {
        Yes '-Body with no .NET SDK here fails and names it' ($r.Code -eq 1 -and $r.Text -match 'FAIL  the release note: the \.NET 10 SDK is not on this machine')
    }
} finally {
    Set-Location -LiteralPath $here
    foreach ($n in $keepEnv.Keys) { [Environment]::SetEnvironmentVariable($n, $keepEnv[$n]) }
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
