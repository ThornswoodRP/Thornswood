<#
  test-swap-helpers.ps1

  The small helpers in scripts\deploy\Swap.ps1 and scripts\vps\Vps.ps1 that
  Deploy-Docs.ps1 (and Install-Bot, Install-Voice) lean on and that no other
  harness calls by name. test-deploy-swaps.ps1 runs Deploy-Docs whole through
  them; this holds each one to its own contract, so a change that keeps the
  happy path working but breaks an edge shows up here by name:

    ServiceSwapVars        the values line the service blocks run with. Run
                           back in a fresh scope, every value comes out as it
                           went in, apostrophes and all, and / turns into \.
    Get-SwapHashes         lower-case SHA-256 per file, in the order given.
    Get-SwapRecordPlace    where a part's record sits under its root, and no
                           relative path for a record outside it, including a
                           sibling folder whose name starts with the root's.
    Get-ThornswoodVpsLocalPath, Get-ThornswoodKnownHostsPath
                           which file each one names; with an address, the
                           known_hosts file ssh -G names (a stand-in ssh).

  Offline: nothing runs ssh or scp but the stand-in, and no file is written outside a scratch
  folder that is removed at the end. Runs on Windows PowerShell 5.1 and 7.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$root = Split-Path -Parent (Split-Path -Parent $Here)
. (Join-Path $root 'scripts\deploy\Swap.ps1')
. (Join-Path $root 'scripts\vps\Vps.ps1')
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Windows.ps1')

$script:pass = 0; $script:fail = 0
function Check([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}

$scratch = Join-Path ([IO.Path]::GetTempPath()) ('ts-swap-helpers-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $scratch | Out-Null
$savedLocal = $env:THORNSWOOD_VPS_LOCAL
$savedApp = $env:LOCALAPPDATA
try {
    # ---------------------------------------------------------- ServiceSwapVars
    $sums = [ordered]@{ 'server.js' = 'aa11'; "it's\odd.js" = "b'2"; 'public\home.js' = 'cc33' }
    $text = ServiceSwapVars "C:/Thornswood Docs/o'neil" ".stage-1'x" '.prev-1' 45 $sums @('server.js', '', $null, "it's\odd.js")
    $got = & ([scriptblock]::Create($text + "`r`n" + '[pscustomobject]@{ Root = $Root; Stage = $Stage; Prev = $Prev; Wait = $Wait; Keep = $KeepStage; Want = $Want; Parse = $Parse }'))
    Check 'ServiceSwapVars: the root comes back with / turned into \ and its apostrophe intact' ($got.Root -eq "C:\Thornswood Docs\o'neil")
    Check 'ServiceSwapVars: the stage name with an apostrophe comes back unchanged' ($got.Stage -eq ".stage-1'x")
    Check 'ServiceSwapVars: the wait is a number' (($got.Wait -is [int]) -and $got.Wait -eq 45)
    Check 'ServiceSwapVars: KeepStage is off for a deploy' ($got.Keep -eq $false)
    Check 'ServiceSwapVars: every hash comes back under its own name, in order' (
        (@($got.Want.Keys) -join '|') -eq "server.js|it's\odd.js|public\home.js" -and $got.Want["it's\odd.js"] -eq "b'2")
    Check 'ServiceSwapVars: empty and null names are dropped from Parse' (
        @($got.Parse).Count -eq 2 -and $got.Parse[1] -eq "it's\odd.js")
    $none = & ([scriptblock]::Create((ServiceSwapVars 'C:\x' 's' 'p' 1 ([ordered]@{}) @()) + '; ,@($Parse)'))
    Check 'ServiceSwapVars: no files to parse is an empty list, not a parse error' (@($none).Count -eq 0)

    # ----------------------------------------------------------- Get-SwapHashes
    $a = Join-Path $scratch 'a.txt'; $b = Join-Path $scratch "b'c.txt"
    [IO.File]::WriteAllBytes($a, [Text.Encoding]::ASCII.GetBytes('abc'))
    [IO.File]::WriteAllBytes($b, [byte[]]@())
    $h = Get-SwapHashes ([ordered]@{ 'z\a.txt' = $a; 'b.txt' = $b })
    Check 'Get-SwapHashes: the SHA-256 of abc, lower case' ($h['z\a.txt'] -ceq 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    Check 'Get-SwapHashes: an empty file has the empty SHA-256' ($h['b.txt'] -ceq 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    Check 'Get-SwapHashes: keyed by the stage path, in the order given' ((@($h.Keys) -join '|') -eq 'z\a.txt|b.txt')
    $threw = $false
    try { Get-SwapHashes ([ordered]@{ 'gone' = (Join-Path $scratch 'missing.txt') }) | Out-Null } catch { $threw = $true }
    Check 'Get-SwapHashes: a file that is not there stops the deploy rather than sending no hash' $threw

    # ------------------------------------------------------ Get-SwapRecordPlace
    $w = Get-SwapRecordPlace 'C:/ThornswoodDocs/' ''
    Check 'Get-SwapRecordPlace: no Beside is thornswood-deploy.json in the root' ($w.Beside -eq 'C:\ThornswoodDocs\thornswood-deploy.json' -and $w.Rel -eq 'thornswood-deploy.json')
    Check 'Get-SwapRecordPlace: the root loses its trailing slash and takes backslashes' ($w.Root -eq 'C:\ThornswoodDocs')
    $w = Get-SwapRecordPlace 'C:\Server' 'c:/server/data/thornswood-deploy.json'
    Check 'Get-SwapRecordPlace: a record under the root in another case and slashes is found' ($w.Rel -eq 'data\thornswood-deploy.json')
    $w = Get-SwapRecordPlace 'C:\Server' 'C:\Elsewhere\thornswood-deploy.json'
    Check 'Get-SwapRecordPlace: a record outside the root has no relative path' ($w.Rel -eq '')
    $w = Get-SwapRecordPlace 'C:\Server' 'C:\Server2\thornswood-deploy.json'
    Check 'Get-SwapRecordPlace: a sibling folder whose name starts with the root is outside it' ($w.Rel -eq '')

    # ------------------------------------------------------------------ Vps.ps1
    $env:THORNSWOOD_VPS_LOCAL = 'D:\mine\vps.json'
    Check 'Get-ThornswoodVpsLocalPath: THORNSWOOD_VPS_LOCAL wins' ((Get-ThornswoodVpsLocalPath) -eq 'D:\mine\vps.json')
    $env:THORNSWOOD_VPS_LOCAL = ''
    $env:LOCALAPPDATA = Join-Path $scratch 'AppLocal'
    Check 'Get-ThornswoodVpsLocalPath: otherwise %LOCALAPPDATA%\Thornswood\vps.json' ((Get-ThornswoodVpsLocalPath) -eq (Join-Path $scratch 'AppLocal\Thornswood\vps.json'))
    $env:LOCALAPPDATA = ''
    Check 'Get-ThornswoodVpsLocalPath: no LOCALAPPDATA is no file, not a path at the drive root' ((Get-ThornswoodVpsLocalPath) -eq '')
    Check 'Get-ThornswoodKnownHostsPath: the user''s own .ssh\known_hosts' ((Get-ThornswoodKnownHostsPath) -eq (Join-Path (Join-Path $HOME '.ssh') 'known_hosts'))
    # With an address, the file ssh itself reads for it (ssh -G), which on
    # the box through the gate is the gate's box_known_hosts (#5211's run of
    # Set-InboundRules -Check). A stand-in ssh says what ssh -G would.
    $bin = Join-Path $scratch 'bin'
    $null = New-Item -ItemType Directory -Path $bin -Force
    $gateFile = [IO.Path]::GetFullPath((Join-Path $scratch 'gate/keys/box_known_hosts'))
    function Set-StandInSsh([string]$line) {
        if ($OnWindows) { [IO.File]::WriteAllText((Join-Path $bin 'ssh.cmd'), "@echo off`r`necho host x`r`necho $line`r`n") }
        else { [IO.File]::WriteAllText((Join-Path $bin 'ssh'), "#!/bin/sh`necho 'host x'`necho '$line'`n"); & chmod +x (Join-Path $bin 'ssh') }
    }
    $savedPath = $env:PATH
    try {
        $env:PATH = $bin + [IO.Path]::PathSeparator + $env:PATH
        Set-StandInSsh ('userknownhostsfile ' + $gateFile.Replace('\', '/'))
        Check 'Get-ThornswoodKnownHostsPath -Address: the file ssh -G names for it, the gate''s own on the box' ((Get-ThornswoodKnownHostsPath -Address 'play.example') -eq $gateFile)
        Set-StandInSsh 'userknownhostsfile ~/.ssh/known_hosts ~/.ssh/known_hosts2'
        Check '  ssh''s default reads as the user''s own .ssh\known_hosts' ((Get-ThornswoodKnownHostsPath -Address 'play.example') -eq [IO.Path]::GetFullPath((Join-Path (Join-Path $HOME '.ssh') 'known_hosts')))
        Set-StandInSsh 'hostname play.example'
        Check '  an ssh that names none gives the user''s own' ((Get-ThornswoodKnownHostsPath -Address 'play.example') -eq (Join-Path (Join-Path $HOME '.ssh') 'known_hosts'))
    } finally { $env:PATH = $savedPath }

    # ----------------------------------------------------------- Show-SwapResult
    # On a failed swap where the box may not be as it was, Show-SwapResult prints
    # the folder holding what was replaced (the worst-case else branch).
    # On a normal swap that is .prev-<stamp>; on a failed put-back it is .undone-<stamp> (#4386).
    $failLines = @('something failed', 'could not start')
    $resText = $(Show-SwapResult $failLines 'C:\Thornswood\.undone-20261122-120000' 6>&1) -join "`n"
    Check 'Show-SwapResult: failed put-back text says the replaced files are in .undone' (
        $resText -match 'The files the swap replaced are in C:\\Thornswood\\\.undone-20261122-120000')

    # Verify that Install-Voice, Install-Bot, Deploy-DevGamemode, and Deploy-Docs
    # pass the .undone folder to Show-SwapResult when the put-back pick ran (#4386).
    $voiceSrc = Get-Content (Join-Path $root 'scripts\deploy\Install-Voice.ps1') -Raw
    $botSrc = Get-Content (Join-Path $root 'scripts\deploy\Install-Bot.ps1') -Raw
    $devSrc = Get-Content (Join-Path $root 'scripts\deploy\Deploy-DevGamemode.ps1') -Raw
    $docsSrc = Get-Content (Join-Path $root 'scripts\deploy\Deploy-Docs.ps1') -Raw

    Check 'Install-Voice passes .undone to Show-SwapResult on -PutBack' (
        $voiceSrc -match 'Show-SwapResult\s+\$swapOut\s+(\$prevWhere|\(?if\s*\(\$PutBack\))' -and
        $voiceSrc -match '\.undone-<stamp>')
    Check 'Install-Bot passes .undone to Show-SwapResult on -PutBack' (
        $botSrc -match 'Show-SwapResult\s+\$out\s+(\$prevWhere|\(?if\s*\(\$PutBack\))' -and
        $botSrc -match '\.undone-<stamp>')
    Check 'Deploy-DevGamemode passes .undone to Show-SwapResult on put-back/recover' (
        $devSrc -match 'Show-SwapResult\s+\$swapOut\s+(\$prevWhere|\(?if\s*\(\$PutBack)' -and
        $devSrc -match '\.undone-<stamp>')
    Check 'Deploy-Docs passes .undone to Show-SwapResult on -PutBack' (
        $docsSrc -match 'Show-SwapResult\s+\$swapOut\s+(\$prevWhere|\(?if\s*\(\$PutBack\))' -and
        $docsSrc -match '\.undone-<stamp>')
} finally {
    $env:THORNSWOOD_VPS_LOCAL = $savedLocal
    $env:LOCALAPPDATA = $savedApp
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 } else { exit 0 }
