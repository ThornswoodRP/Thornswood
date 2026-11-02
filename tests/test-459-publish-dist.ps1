<#
  test-459-publish-dist.ps1

      pwsh -NoProfile -File .\tests\test-459-publish-dist.ps1

  Publish-Server.ps1 names the built server it packs (#459, the same defect
  #2309 found in Deploy-DevGamemode -LoadOrder). The deploys run only from a
  clean checkout at origin (#2118), which on the shipping machine is a fresh
  worktree, and a fresh worktree has no engine build. Publish-Server's -Dist
  defaulted to Where.ps1 ServerDist inside that checkout, so from the one
  place the guard lets it run it skipped the gamemode copy and the start
  point check without a word and stopped inside Export-ServerPayload with
  "server dist not found", naming neither -Dist nor the build the record
  wants. And the default was worked out in the parameter block, where
  Windows PowerShell 5.1 leaves $PSScriptRoot empty (#2229).

  A publish needs a built server, so -Dist stays: left out it is the
  checkout's own engine build and never another folder, and with no build
  there the publish stops before anything is copied, built or sent, saying
  how to name one.

  HOW. A scratch git repository stands in for a fresh checkout: the scripts,
  the records, layout.json and game\gamemode.js, committed, and no engine.
  ssh and scp are stand-ins on PATH that only write down that they were
  called, and the box is 127.0.0.1 with THORNSWOOD_HARNESS set, so the
  freshness guard lets the scratch checkout be. It proves:
    1. with no -Dist, from the fresh checkout, the publish stops naming the
       checkout's own build folder, -Dist and the engine commit the record
       names, before the gamemode artifact is built and with no ssh or scp;
    2. -Dist naming no folder, or a folder with no server-settings.json, stops
       the same way, naming that folder;
    3. -Dist naming a built server goes past that stop, and a build that is
       not the one records\server-build.json names is still refused before
       anything is copied (the shared clone's build of another engine commit
       is this case);
    4. the parameter block works nothing out: -Dist and -Zip have no default;
    5. on a machine that takes CI's engine build ({"ci": true}), no -Dist is
       a publish from the store with CI's server zip, fetched first by
       Get-EngineArtifact.ps1 when the pin's build is not here (#3262).

  Everything it writes is in its own temp folder. Nothing connects anywhere.
#>
$env:THORNSWOOD_HARNESS = '1'
# The fork's artifacts alone: tests\test-3047-ci-engine-build.ps1, section 7,
# holds the package path (#5152) with a stand-in registry.
$env:THORNSWOOD_ENGINE_REGISTRY = 'none'
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}
$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$path, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    [IO.File]::WriteAllText($path, $text, $utf8)
}

$Scratch = Join-Path ([IO.Path]::GetTempPath()) ('ts-459d-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $Scratch | Out-Null
$oldPath = $env:PATH; $oldLog = $env:TS_459D_CALLS
try {
    # ---- the fresh checkout: committed, no engine ---------------------------------------
    $fresh = Join-Path $Scratch 'fresh'
    New-Item -ItemType Directory -Force -Path $fresh | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo 'scripts') -Destination $fresh -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $repo 'records') -Destination $fresh -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $repo 'layout.json') -Destination (Join-Path $fresh 'layout.json') -Force
    New-Item -ItemType Directory -Force -Path (Join-Path $fresh 'game') | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo 'game\gamemode.js') -Destination (Join-Path $fresh 'game\gamemode.js') -Force
    # And its tables (#5191), which the gamemode artifact carries with it.
    Copy-Item -LiteralPath (Join-Path $repo 'game\gamemode-tables') -Destination (Join-Path $fresh 'game\gamemode-tables') -Recurse -Force
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $null = & git -C $fresh init -q 2>&1
        $null = & git -C $fresh -c core.autocrlf=false add -A 2>&1
        $null = & git -C $fresh -c user.name=harness -c user.email=harness@harness.invalid -c commit.gpgsign=false commit -q -m 'the fresh checkout' 2>&1
        $committed = ($LASTEXITCODE -eq 0)
    } finally { $ErrorActionPreference = $eap }
    Yes 'the scratch checkout is a committed git repository' $committed
    if (-not $committed) { Done }
    $publish = Join-Path $fresh 'scripts\release\Publish-Server.ps1'
    $own = [string](& (Join-Path $fresh 'scripts\release\Where.ps1') ServerDist)
    Yes ("it has no engine build: Where.ps1 ServerDist names {0}, which is not there" -f $own) (
        $own.StartsWith($fresh, [StringComparison]::OrdinalIgnoreCase) -and -not (Test-Path -LiteralPath $own))
    $recCommit = [string](([IO.File]::ReadAllText((Join-Path $fresh 'records\server-build.json')) | ConvertFrom-Json).source.commit)
    $recShort = $recCommit.Substring(0, 8)

    # ---- ssh and scp that only say they were called ---------------------------------------
    $bin = Join-Path $Scratch 'bin'
    $log = Join-Path $Scratch 'calls.txt'
    $env:TS_459D_CALLS = $log
    # A .cmd on Windows, a shell script anywhere else, where a .cmd is not run.
    . (Join-Path $PSScriptRoot 'Windows.ps1')
    foreach ($t in 'ssh', 'scp') {
        if ($OnWindows) { Put (Join-Path $bin "$t.cmd") ("@echo $t %*>>""%TS_459D_CALLS%""`r`n@exit /b 0`r`n") }
        else {
            Put (Join-Path $bin $t) ("#!/bin/sh`necho $t ""`$*"" >> ""`$TS_459D_CALLS""`nexit 0`n")
            & chmod 755 (Join-Path $bin $t)
        }
    }
    $env:PATH = $bin + [IO.Path]::PathSeparator + $oldPath

    function Run([string]$shell, [string[]]$more) {
        if (Test-Path -LiteralPath $log) { Remove-Item -LiteralPath $log -Force }
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try {
            $out = (& $shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $publish -Channel dev -NoPause -VpsHost 127.0.0.1 -VpsUser harness @more 2>&1 | Out-String)
            $code = $LASTEXITCODE
        } finally { $ErrorActionPreference = $old }
        $calls = @(if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log | Where-Object { $_ } })
        $out = $out -replace '\r?\n\s+\|\s+', ' '
        return [pscustomobject]@{ Code = $code; Out = $out; Calls = $calls }
    }
    $artifacts = Join-Path $fresh 'out\deploys'

    # ---- 1. no -Dist, from the fresh checkout -----------------------------------------------
    # The scripts run in PowerShell 7 only (#5356).
    $shells = @([pscustomobject]@{ Name = 'PowerShell 7'; Path = (Get-BoxPowerShell) })
    foreach ($sh in $shells) {
        Write-Host ''; Write-Host ("no -Dist, from the fresh checkout, under {0}" -f $sh.Name)
        $r = Run $sh.Path @()
        Yes '  stops with exit 1' ($r.Code -eq 1)
        Yes '  naming the checkout''s own build folder' ($r.Out.Contains("there is no built server at $own"))
        Yes ("  and saying to name the build with -Dist, held to engine {0}" -f $recShort) (
            $r.Out.Contains('-Channel dev -Dist <the engine build''s dist\server>') -and $r.Out.Contains("(engine $recShort)") -and $r.Out.Contains('Nothing was built or sent'))
        Yes '  before the gamemode artifact is built or the payload packed' (-not (Test-Path -LiteralPath $artifacts) -and $r.Out -notmatch 'gamemode artifact' -and $r.Out -notmatch 'Packing the payload')
        Yes ("  with no ssh or scp ({0} calls)" -f $r.Calls.Count) ($r.Calls.Count -eq 0)
        if ($r.Code -ne 1 -or -not $r.Out.Contains('there is no built server')) { Write-Host $r.Out }
    }

    # ---- 2. -Dist naming no build -------------------------------------------------------------
    Write-Host ''; Write-Host '-Dist naming no build'
    $none = Join-Path $Scratch 'no-build-here'
    $r = Run $shells[0].Path @('-Dist', $none)
    Yes 'a folder that is not there stops, naming it' ($r.Code -eq 1 -and $r.Out.Contains("there is no built server at $none") -and $r.Out.Contains('-Dist names the engine build') -and $r.Calls.Count -eq 0)
    $empty = Join-Path $Scratch 'empty-build'
    New-Item -ItemType Directory -Force -Path $empty | Out-Null
    $r = Run $shells[0].Path @('-Dist', $empty)
    Yes 'a folder with no server-settings.json stops, naming it' ($r.Code -eq 1 -and $r.Out.Contains("$empty holds no server-settings.json") -and $r.Calls.Count -eq 0)
    Yes '  and nothing went into it' (@(Get-ChildItem -LiteralPath $empty -Force).Count -eq 0)

    # ---- 2b. a record that does not read (#2711) ------------------------------------------------
    # It was read here in a try with an empty catch, and the refusal came only
    # after the payload was built. Now it stops first, saying why. -Record
    # names a scratch file, so the checkout stays clean.
    $badRecord = Join-Path $Scratch 'server-build-cut-off.json'
    Put $badRecord '{ "binary": "scam_native.node", "sha256": '
    foreach ($sh in $shells) {
        Write-Host ''; Write-Host ("a record that does not read, under {0}" -f $sh.Name)
        $r = Run $sh.Path @('-Dist', $none, '-Record', $badRecord)
        Yes '  stops with exit 1, naming the record and saying it does not read' ($r.Code -eq 1 -and $r.Out.Contains("$badRecord does not read") -and $r.Out.Contains('Nothing was built or sent'))
        Yes ("  before anything is built or sent ({0} ssh or scp calls)" -f $r.Calls.Count) ($r.Calls.Count -eq 0 -and $r.Out -notmatch 'gamemode artifact' -and $r.Out -notmatch 'Packing the payload')
        if ($r.Code -ne 1 -or -not $r.Out.Contains('does not read')) { Write-Host $r.Out }
    }

    # ---- 3. -Dist naming a build that is not the recorded one ---------------------------------
    Write-Host ''; Write-Host '-Dist naming a build of another engine commit'
    $other = Join-Path $Scratch 'other-build\dist\server'
    # One plugin, here, with a TES4 header that is not light, for the start point check to read.
    $esm = Join-Path $Scratch 'plugins\Skyrim.esm'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $esm) | Out-Null
    [IO.File]::WriteAllBytes($esm, ([Text.Encoding]::ASCII.GetBytes('TES4') + [byte[]](0, 0, 0, 0, 1, 0, 0, 0)))
    Put (Join-Path $other 'server-settings.json') ('{"port":7777,"name":"Thornswood","loadOrder":["' + $esm.Replace('\', '/') + '"],"startPoints":[{"worldOrCell":"0x3C","pos":[0,0,0],"angleZ":0}]}')
    Put (Join-Path $other 'scam_native.node') 'a binary of another engine commit'
    $r = Run $shells[0].Path @('-Dist', $other)
    Yes 'goes past the stop, naming the build it packs' ($r.Out -notmatch 'there is no built server' -and $r.Out -match ('built server\s+' + [regex]::Escape($other)))
    Yes '  and is refused as not the recorded build' ($r.Code -eq 1 -and $r.Out -match 'not the build' -and $r.Out -match 'Export-ServerPayload\.ps1 exited')
    Yes ("  before anything is copied: no ssh or scp ({0} calls)" -f $r.Calls.Count) ($r.Calls.Count -eq 0 -and $r.Out -notmatch '(?m)^Copying')
    if ($r.Code -ne 1 -or $r.Out -notmatch 'not the build') { Write-Host $r.Out }

    # ---- 5. a machine that takes CI's engine build (#3262) --------------------------------------
    # Its engine build is CI's artifact, which holds the server files and
    # their zip and never a server-settings.json, so a publish that names no
    # build goes from the store with that zip, fetching the pin's build first.
    Write-Host ''; Write-Host 'no -Dist, on a machine that takes CI''s engine build'
    $oldLocal = $env:LOCALAPPDATA
    $env:LOCALAPPDATA = Join-Path $Scratch 'appdata'
    try {
        Put (Join-Path $env:LOCALAPPDATA 'Thornswood\engine-build.json') '{"ci": true}'
        $ciDir = Join-Path $env:LOCALAPPDATA ('Thornswood\engine-ci\' + $recCommit.Substring(0, 12).ToLowerInvariant())
        # gh, which Get-EngineArtifact.ps1 asks, says no here.
        if ($OnWindows) { Put (Join-Path $bin 'gh.cmd') ("@echo gh %*>>""%TS_459D_CALLS%""`r`n@echo no network in this harness 1>&2`r`n@exit /b 1`r`n") }
        else {
            Put (Join-Path $bin 'gh') ("#!/bin/sh`necho gh ""`$*"" >> ""`$TS_459D_CALLS""`necho no network in this harness >&2`nexit 1`n")
            & chmod 755 (Join-Path $bin 'gh')
        }
        $r = Run $shells[0].Path @()
        Yes 'with the pin''s build not here, it asks Get-EngineArtifact.ps1 for it, and stops when that fails, sending nothing' (
            $r.Code -eq 1 -and $r.Out.Contains("Get-EngineArtifact.ps1 could not fetch CI's engine build of the pin") -and
            $r.Out -notmatch 'holds no server-settings\.json|there is no built server' -and @($r.Calls | Where-Object { $_ -match '^(ssh|scp) ' }).Count -eq 0)
        if ($r.Code -ne 1 -or -not $r.Out.Contains('could not fetch')) { Write-Host $r.Out }
        Put (Join-Path $ciDir 'engine-artifact.json') '{"commit": "x", "serverZip": "server-harness-0000000000000000.zip"}'
        $ciZip = Join-Path $ciDir 'artifact\server\server-harness-0000000000000000.zip'
        $r = Run $shells[0].Path @()
        Yes '  with the build here and its zip missing, it stops naming where the zip should be, sending nothing' (
            $r.Code -eq 1 -and $r.Out.Contains("there is none at $ciZip") -and @($r.Calls | Where-Object { $_ -match '^(ssh|scp) ' }).Count -eq 0)
        Put $ciZip 'not a real zip'
        $r = Run $shells[0].Path @()
        Yes '  with the zip there, it publishes from the store and sends that zip first, never asking for a server-settings.json' (
            $r.Out.Contains('which has no built server to pack, so this publishes from the store and sends ' + $ciZip) -and
            $r.Out -match 'server build\s+from the store on the box' -and $r.Out -notmatch 'holds no server-settings\.json|there is no built server')
        if (-not $r.Out.Contains('publishes from the store')) { Write-Host $r.Out }
    } finally { $env:LOCALAPPDATA = $oldLocal }

    # ---- 4. the parameter block ----------------------------------------------------------------
    Write-Host ''; Write-Host 'the script'
    $src = [IO.File]::ReadAllText((Join-Path $repo 'scripts\release\Publish-Server.ps1'))
    $ast = [Management.Automation.Language.Parser]::ParseInput($src, [ref]$null, [ref]$null)
    foreach ($name in 'Dist', 'Zip') {
        $p = @($ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq $name })
        Yes ("-{0} has no default worked out in the parameter block" -f $name) ($p.Count -eq 1 -and ($null -eq $p[0].DefaultValue -or $p[0].DefaultValue.Extent.Text -eq "''"))
    }
    $guard = $src.IndexOf('# ------------------------------------------------------- the build it packs ---')
    $artifactAt = $src.IndexOf('$artifact = New-ThornswoodArtifact')
    Yes 'the stop comes before the gamemode artifact is built' ($guard -gt 0 -and $artifactAt -gt $guard)
}
finally {
    $env:PATH = $oldPath; $env:TS_459D_CALLS = $oldLog
    Remove-Item -LiteralPath $Scratch -Recurse -Force -ErrorAction SilentlyContinue
}
Done
