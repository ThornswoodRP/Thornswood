<#
  test-2841-nexus-run.ps1

      pwsh -NoProfile -File .\tests\test-2841-nexus-run.ps1

  The Nexus key out of the default cloud environment (#2841, Patrick's
  answer A): a session runs a Nexus script through
  scripts\release\Nexus-Run.ps1, whose workflow (nexus-run.yml) alone has
  the key. This holds:
    1. nexus-verbs.json against the scripts: each verb's script is there and
       takes every parameter, list and fixed word the file lets through, and
       none lets a caller name a file of the runner (-Archive, -From,
       -Layout, -CollectionArchive, -Game, -UploadId, -Record).
    2. Lines: the ones it takes give exactly the parameters the script is
       given, lists split on commas; a line outside the file, a pack missing
       a part, a path that climbs out of the repository or a -Mod with no
       -FileId is refused.
    3. The pack: files of main alone, the same bytes from the same commit,
       each entry at its path under -PackRoot, and a file git does not track
       refused.
    4. The runner's half against the stand-in Nexus (tests\fixtures\
       nexus-standin.js): Set-NexusKey, Send-NexusFile with a pack and
       New-NexusRevision's download each run, print nothing of the script's
       output into the log, and seal it to the session's key; no key stops
       it before anything runs.
    5. nexus-run.yml: on GitHub's Windows runner (#4013), main-only environment, the key in one step's
       environment, no input pasted into a script, actions pinned by SHA,
       the output sealed and kept a day.
    6. Set-NexusKey -ToEnvironment holds the environment to main alone and
       sends the key on gh's standard input; Nexus.ps1 no longer tells a
       cloud session to hold the key.
  Nothing outside the loopback stand-in is reached, and nothing outside the
  temp folder is touched.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Skip([string]$what) { Write-Host "SKIP  $what" }
function Text([string]$rel) { return [IO.File]::ReadAllText((Join-Path $Repo $rel)) }
function Import-Functions([string]$rel, [string[]]$names) {
    $err = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $Repo $rel), [ref]$null, [ref]$err)
    $out = @()
    foreach ($n in $names) {
        $f = $ast.Find({ param($a) $a -is [Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq $n }, $true)
        if ($f) { $out += $f.Extent.Text }
    }
    return ($out -join "`n")
}
function ParamsOf([string]$rel) {
    $err = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $Repo $rel), [ref]$null, [ref]$err)
    return @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
}
$T = Join-Path ([IO.Path]::GetTempPath()) ('tw-2841-nexus-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $T -Force | Out-Null
$script:standin = $null
function Done {
    if ($script:standin -and -not $script:standin.HasExited) { try { $script:standin.Kill() } catch { Write-Host "      the stand-in had already gone: $($_.Exception.Message)" } }
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host ''
    Write-Host "$script:pass passed, $script:fail failed"
    if ($script:fail) { exit 1 }
    exit 0
}

$nr = 'scripts/release/Nexus-Run.ps1'
$err = $null; $tok = $null
[void][Management.Automation.Language.Parser]::ParseFile((Join-Path $Repo $nr), [ref]$tok, [ref]$err)
Yes 'Nexus-Run.ps1 parses' (-not $err.Count)
. (Join-Path $Repo 'scripts/vps/gate/GateRules.ps1')
. (Join-Path $Repo 'scripts/ops/Sealed.ps1')
$OwnParams = @('PackRoot', 'Pack', 'PackName')
Invoke-Expression (Import-Functions $nr @('Test-NexusRunLine', 'ConvertTo-NexusRunParams', 'Test-NexusRunPath', 'Get-NexusRunTracked', 'New-NexusRunPack'))
$verbs = Read-ThornswoodGateVerbs (Join-Path $Repo 'scripts/release/nexus-verbs.json')

# ---- 1. nexus-verbs.json against the scripts --------------------------------------
$names = @($verbs.verbs.PSObject.Properties | ForEach-Object { $_.Name })
Yes 'nexus-verbs.json names the six Nexus scripts' ((($names | Sort-Object) -join ',') -eq 'Install-NexusRevision,New-NexusRevision,Read-NexusFile,Send-NexusFile,Set-NexusDescription,Set-NexusKey')
$runnerFiles = @('Archive', 'From', 'Layout', 'CollectionArchive', 'Game', 'UploadId', 'Record', 'Cache')
foreach ($n in $names) {
    $v = $verbs.verbs.$n
    $have = ParamsOf $v.script
    $given = @($v.params.PSObject.Properties | ForEach-Object { $_.Name } | Where-Object { $OwnParams -notcontains $_ })
    $fixed = @($v.fixed | ForEach-Object { $_.TrimStart('-') })
    $missing = @(($given + $fixed + @($v.lists | Where-Object { $_ })) | Where-Object { $have -notcontains $_ })
    Yes "$n is $($v.script) and takes every parameter the file lets through" ((Test-Path -LiteralPath (Join-Path $Repo $v.script)) -and -not $missing.Count)
    $files = @($given | Where-Object { $runnerFiles -contains $_ -and -not ($_ -eq 'Game' -and $n -ne 'Install-NexusRevision') })
    Yes "  and lets no caller name a file or folder of the runner" (-not $files.Count)
    Yes "  with -NoPause on every run" ($fixed -contains 'NoPause')
}
Yes 'Install-NexusRevision always writes its records into the run''s own folder' ($verbs.verbs.'Install-NexusRevision'.out -eq '-Record')
Yes 'Set-NexusKey runs as -Check alone' ((@($verbs.verbs.'Set-NexusKey'.fixed) -join ' ') -eq '-Check -NoPause' -and -not @($verbs.verbs.'Set-NexusKey'.params.PSObject.Properties).Count)

# ---- 2. lines ---------------------------------------------------------------------
function Params([string]$line) { return (ConvertTo-NexusRunParams (Test-NexusRunLine $line $verbs) $verbs) }
function Refused([string]$line) { try { [void](Params $line); return $false } catch { return $true } }
$c = Params 'Send-NexusFile -Mod 192001 -Version 1.3 -PackRoot game/content -Pack Thornswood-Content.esp -PackName Thornswood-Content-1.3.zip -WhatIf'
Yes 'a Send-NexusFile line gives its parameters, the pack apart' (
    (($c.Params.Keys) -join ',') -eq 'NoPause,Mod,Version,WhatIf' -and $c.Params['Mod'] -eq '192001' -and $c.Params['WhatIf'] -eq $true -and
    $c.Own['PackRoot'] -eq 'game/content' -and $c.Own['Pack'] -eq 'Thornswood-Content.esp' -and $c.Own['PackName'] -eq 'Thornswood-Content-1.3.zip')
$c = Params 'New-NexusRevision -Mod 192001,192762 -FileId 830001,830002 -DropPatch 192001:Thornswood-Content.esp'
Yes 'a list is split on its commas' (@($c.Params['Mod']).Count -eq 2 -and @($c.Params['FileId'])[1] -eq '830002' -and @($c.Params['DropPatch'])[0] -eq '192001:Thornswood-Content.esp' -and -not $c.Params.Contains('Archive'))
$c = Params 'New-NexusRevision -Remove 24104 -Rule docs/COLLECTION-REVISION-6-RULE.json -WhatIf'
Yes 'a revision can take a mod out and give a plugin a rule (#3649)' (@($c.Params['Remove'])[0] -eq '24104' -and $c.Params['Rule'] -eq 'docs/COLLECTION-REVISION-6-RULE.json')
$c = Params 'New-NexusRevision -Discard 6'
Yes 'and a waiting draft can be thrown away' ($c.Params['Discard'] -eq '6')
$c = Params 'Set-NexusDescription -Mod 192001,192762 -AddLine "THIS MOD IS NOT MADE, GUARANTEED OR SUPPORTED BY ZENIMAX OR ITS AFFILIATES." -WhatIf'
Yes 'a text value with spaces arrives whole' ($c.Params['AddLine'] -eq 'THIS MOD IS NOT MADE, GUARANTEED OR SUPPORTED BY ZENIMAX OR ITS AFFILIATES.' -and @($c.Params['Mod']).Count -eq 2)
$c = Params 'Set-NexusKey'
Yes 'Set-NexusKey is -Check' ((($c.Params.Keys) -join ',') -eq 'Check,NoPause')
foreach ($bad in @(
        @('ping', 'ping'),
        @('a script the file does not name', 'Ship -Channel main'),
        @('-Archive of the caller''s own', 'Send-NexusFile -Mod 192001 -Version 1.3 -Archive C:/x.zip'),
        @('-From', 'New-NexusRevision -From records/x.7z'),
        @('-Layout', 'New-NexusRevision -SetLight a.esp -Layout x'),
        @('-Game for Install-NexusRevision', 'Install-NexusRevision -Revision 3 -Game C:/Game'),
        @('-Record of the caller''s own', 'Install-NexusRevision -Revision 3 -Record x'),
        @('Send-NexusFile with no pack', 'Send-NexusFile -Mod 192001 -Version 1.3'),
        @('a pack missing its name', 'Send-NexusFile -Mod 192001 -Version 1.3 -PackRoot game/content -Pack Thornswood-Content.esp'),
        @('a pack name that is not a zip', 'Send-NexusFile -Mod 192001 -Version 1.3 -PackRoot game/content -Pack a.esp -PackName a.7z'),
        @('-Mod with no -FileId', 'New-NexusRevision -Mod 192001'),
        @('-Add outside records', 'New-NexusRevision -Add game/x.json'),
        @('-Rule outside docs', 'New-NexusRevision -Rule records/x.json'),
        @('-Rule that climbs out', 'New-NexusRevision -Rule docs/../x.json'),
        @('a dollar sign', 'Set-NexusDescription -Mod 192001 -AddLine "$env:THORNSWOOD_NEXUS_API_KEY"'),
        @('a parameter given twice', 'Set-NexusDescription -Mod 192001 -Mod 192762 -AddLine x'),
        @('a value that starts with a hyphen', 'Set-NexusDescription -Mod 192001 -AddLine -WhatIf'))) {
    Yes ('refused: ' + $bad[0]) (Refused $bad[1])
}
Yes 'a path that climbs out of the repository is not one' (-not (Test-NexusRunPath '../x') -and -not (Test-NexusRunPath 'game/../../x') -and -not (Test-NexusRunPath 'game//x') -and -not (Test-NexusRunPath '/etc/x') -and (Test-NexusRunPath 'game/content'))

# ---- 3. the pack ------------------------------------------------------------------
$esp = 'game/content/Thornswood-Content.esp'
if (Test-Path -LiteralPath (Join-Path $Repo $esp)) {
    $when = [DateTimeOffset]::FromUnixTimeSeconds(1761523200)
    $a = New-NexusRunPack $Repo 'game/content' @('Thornswood-Content.esp') 'one.zip' (Join-Path $T 'pa') $when
    $b = New-NexusRunPack $Repo 'game/content' @('Thornswood-Content.esp') 'one.zip' (Join-Path $T 'pb') $when
    $ha = [BitConverter]::ToString([Security.Cryptography.SHA256]::HashData([IO.File]::ReadAllBytes($a.Path)))
    $hb = [BitConverter]::ToString([Security.Cryptography.SHA256]::HashData([IO.File]::ReadAllBytes($b.Path)))
    Yes 'the pack holds the file at its path under -PackRoot' ((($a.Entries) -join ',') -eq 'Thornswood-Content.esp')
    Yes '  the same bytes from the same commit' ($ha -eq $hb)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [IO.Compression.ZipFile]::OpenRead($a.Path)
    $e = $z.Entries[0]; $inZip = New-Object IO.MemoryStream; $s = $e.Open(); $s.CopyTo($inZip); $s.Dispose()
    $same = [Convert]::ToBase64String($inZip.ToArray()) -eq [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $Repo $esp)))
    $z.Dispose()
    Yes '  and its bytes are the repository''s' $same
    $f = New-NexusRunPack $Repo 'scripts' @('vps/gate') 'gate.zip' (Join-Path $T 'pc') $when
    Yes 'a folder packs every file git tracks under it' ((($f.Entries) -join ',') -eq 'vps/gate/Gate.ps1,vps/gate/GateBroker.ps1,vps/gate/GateRules.ps1,vps/gate/Update-Gate.ps1,vps/gate/verbs.json')
} else { Skip "the pack: $esp is not in this checkout" }
$threw = $false; try { [void](New-NexusRunPack $Repo 'tests' @('no-such-file.esp') 'x.zip' (Join-Path $T 'pd') ([DateTimeOffset]::UtcNow)) } catch { $threw = $true }
Yes 'a file git does not track is refused' $threw
$threw = $false; try { [void](New-NexusRunPack $Repo 'game' @('../scripts') 'x.zip' (Join-Path $T 'pe') ([DateTimeOffset]::UtcNow)) } catch { $threw = $true }
Yes '  and so is a path out of -PackRoot' $threw

# ---- 4. the runner's half against the stand-in ------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
$pwshExe = (Get-Process -Id $PID).Path
$key = New-ThornswoodSealKey
function RunnerHalf([string]$line, [hashtable]$envs) {
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $pwshExe
    foreach ($x in @('-NoProfile', '-NonInteractive', '-File', (Join-Path $Repo $nr), '-OnTheRunner')) { $psi.ArgumentList.Add($x) }
    $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
    foreach ($k in @('THORNSWOOD_NEXUS_API_KEY', 'THORNSWOOD_NEXUS_STANDIN', 'THORNSWOOD_NEXUS_STANDIN_KEY', 'NEXUS_RECIPIENT', 'NEXUS_RUN_SEALED', 'GITHUB_ACTIONS')) { [void]$psi.EnvironmentVariables.Remove($k) }
    $sealedAt = Join-Path $T ('sealed-' + [Guid]::NewGuid().ToString('N') + '/nexus-run.sealed')
    $psi.EnvironmentVariables['NEXUS_LINE'] = $line
    $psi.EnvironmentVariables['NEXUS_RUN_SEALED'] = $sealedAt
    $psi.EnvironmentVariables['RUNNER_TEMP'] = $T
    $psi.EnvironmentVariables['NEXUS_RECIPIENT'] = $key.Public
    foreach ($k in $envs.Keys) { if ($null -eq $envs[$k]) { [void]$psi.EnvironmentVariables.Remove($k) } else { $psi.EnvironmentVariables[$k] = $envs[$k] } }
    $p = [Diagnostics.Process]::Start($psi)
    $e = $p.StandardError.ReadToEndAsync()
    $o = $p.StandardOutput.ReadToEnd()
    $p.WaitForExit()
    $opened = ''
    if (Test-Path -LiteralPath $sealedAt) {
        $kp = Join-Path $T ('k-' + [Guid]::NewGuid().ToString('N')); [IO.File]::WriteAllText($kp, $key.Private)
        $plain = Unprotect-ThornswoodSealed ([IO.File]::ReadAllBytes($sealedAt)) $key.Private
        $into = Join-Path $T ('open-' + [Guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Path $into | Out-Null
        [IO.File]::WriteAllBytes((Join-Path $into 'o.zip'), $plain)
        Expand-Archive -LiteralPath (Join-Path $into 'o.zip') -DestinationPath $into
        if (Test-Path -LiteralPath (Join-Path $into 'output.txt')) { $opened = [IO.File]::ReadAllText((Join-Path $into 'output.txt')) }
    }
    return [pscustomobject]@{ Code = $p.ExitCode; Log = ($o + $e.Result); Sealed = (Test-Path -LiteralPath $sealedAt); Out = $opened }
}

$r = RunnerHalf 'Set-NexusKey' @{}
Yes 'with no key and no stand-in the runner''s half stops before anything runs' ($r.Code -eq 1 -and $r.Log -match 'NEXUS_API_KEY secret of the "desk" environment' -and -not $r.Sealed)
$r = RunnerHalf 'Ship -Channel main' @{ THORNSWOOD_NEXUS_API_KEY = 'not-a-real-key' }
Yes 'a line outside the file is refused on the runner too' ($r.Code -eq 1 -and $r.Log -match 'STOP' -and -not $r.Sealed)

if (-not $node) { Skip 'the runs against the stand-in Nexus need node' }
else {
    $standinKey = 'standin-' + [Guid]::NewGuid().ToString('N')
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $node.Source; $psi.ArgumentList.Add((Join-Path $Repo 'tests/fixtures/nexus-standin.js'))
    $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
    $psi.EnvironmentVariables['NEXUS_STANDIN_KEY'] = $standinKey
    $psi.EnvironmentVariables['NEXUS_STANDIN_SAVE'] = (Join-Path $T 'save')
    New-Item -ItemType Directory -Path (Join-Path $T 'save') -Force | Out-Null
    $script:standin = [Diagnostics.Process]::Start($psi)
    trap { $script:fail++; Write-Host ('FAIL  the harness itself stopped: ' + $_.Exception.Message) -ForegroundColor Red; Done }
    $first = $script:standin.StandardOutput.ReadLineAsync()
    $heard = if ($first.Wait(15000)) { [string]$first.Result } else { '' }
    $pm = [regex]::Match($heard, '^\[nexus\] listening on 127\.0\.0\.1:(\d+)$')
    $port = if ($pm.Success) { [int]$pm.Groups[1].Value } else { 0 }
    Yes "the stand-in Nexus listens on its own port ($port)" ($port -gt 0)
    if (-not $port) { Done }
    $null = $script:standin.StandardOutput.ReadToEndAsync()
    $null = $script:standin.StandardError.ReadToEndAsync()
    $base = 'http://127.0.0.1:' + $port
    $SI = @{ THORNSWOOD_NEXUS_STANDIN = $base; THORNSWOOD_NEXUS_STANDIN_KEY = $standinKey; THORNSWOOD_NEXUS_API_KEY = 'marker-of-the-real-key' }

    $r = RunnerHalf 'Set-NexusKey' $SI
    Yes 'Set-NexusKey runs on the runner and its answer comes back sealed' ($r.Code -eq 0 -and $r.Sealed -and $r.Out -match 'owns 192001, Thornswood Content' -and $r.Out -match 'owns 192762')
    Yes '  the log has the end and none of what the script printed' ($r.Log -match 'ENDED 0 Set-NexusKey' -and $r.Log -notmatch 'owns 192001')
    Yes '  and no key anywhere' ($r.Log -notmatch 'marker-of-the-real-key' -and $r.Out -notmatch 'marker-of-the-real-key' -and $r.Log -notmatch [regex]::Escape($standinKey) -and $r.Out -notmatch [regex]::Escape($standinKey))

    if (Test-Path -LiteralPath (Join-Path $Repo $esp)) {
        $r = RunnerHalf 'Send-NexusFile -Mod 192001 -Version 1.3 -PackRoot game/content -Pack Thornswood-Content.esp -PackName Thornswood-Content-1.3.zip -WhatIf' $SI
        Yes 'Send-NexusFile -WhatIf uploads the zip packed from main' ($r.Code -eq 0 -and $r.Out -match 'packed Thornswood-Content-1\.3\.zip from game/content of main' -and $r.Out -match '"filename":"Thornswood-Content-1\.3\.zip"' -and $r.Out -match 'POST /v3/uploads')
        Yes '  and the log says only that it ended' ($r.Log -match 'ENDED 0 Send-NexusFile' -and $r.Log -notmatch 'POST /v3')
    } else { Skip "Send-NexusFile with a pack: $esp is not in this checkout" }

    $arc = Join-Path $T 'served.zip'
    [IO.File]::WriteAllBytes($arc, [byte[]](1..200 | ForEach-Object { [byte]($_ % 256) }))
    $ctl = @{ serve = @{ '830001' = @{ path = $arc; name = 'Thornswood Content 1.3.zip' } } } | ConvertTo-Json -Compress -Depth 5
    [void](Invoke-RestMethod -Method Post -Uri ($base + '/_control') -ContentType 'application/json' -Body $ctl)
    $r = RunnerHalf 'New-NexusRevision -Mod 192001 -FileId 830001 -WhatIf' $SI
    Yes 'New-NexusRevision gets the archive of -FileId from Nexus, never from the caller' ($r.Sealed -and $r.Out -match 'downloaded file 830001 from Nexus: Thornswood Content 1\.3\.zip, 200 bytes')
    $r = RunnerHalf 'New-NexusRevision -Mod 192001 -FileId 830999 -WhatIf' $SI
    Yes '  and a file Nexus does not have stops it before the script runs' ($r.Code -eq 1 -and $r.Out -match 'STOP\. .*830999' -and $r.Log -match 'REFUSED')
}

# ---- 5. nexus-run.yml -------------------------------------------------------------
$wf = (Text '.github/workflows/nexus-run.yml') -replace "`r`n", "`n"
Yes 'nexus-run.yml is started by hand and by nothing else' ($wf -match '(?m)^  workflow_dispatch:\s*$' -and @([regex]::Matches(([regex]::Match($wf, '(?ms)^on:\n(.*?)^\S').Groups[1].Value), '(?m)^  [a-z_]+:')).Count -eq 1)
Yes '  on GitHub''s Windows runner, never the box (#4013), in the environment desk, from main only, reading the repository only' ($wf -match '(?m)^    runs-on: windows-latest$' -and $wf -notmatch 'self-hosted|thornswood-' -and $wf -match "(?m)^    if: github\.ref == 'refs/heads/main'$" -and $wf -match '(?m)^    environment: desk$' -and $wf -match '(?m)^permissions:\n  contents: read$')
Yes '  the key in one step''s environment, and nowhere else' (@([regex]::Matches($wf, 'secrets\.')).Count -eq 1 -and $wf.Contains('THORNSWOOD_NEXUS_API_KEY: ${{ secrets.NEXUS_API_KEY }}'))
$runBlocks = @([regex]::Matches($wf, '(?ms)^\s+run: \|\s*\n(.*?)(?=^\s+- |\z)') | ForEach-Object { $_.Groups[1].Value })
Yes '  no input is pasted into a script; they reach it through the environment' (-not @($runBlocks | Where-Object { $_ -match '\$\{\{' }).Count)
Yes '  every action pinned by a full commit SHA' (-not @([regex]::Matches($wf, 'uses: [^\s@]+@(?![0-9a-f]{40}\b)')).Count)
Yes '  its output leaves the runner sealed, kept a day' ($wf.Contains('name: nexus-run-sealed') -and $wf.Contains('retention-days: 1'))
Yes '  one run at a time' ($wf -match '(?m)^  group: nexus-run$' -and $wf -match '(?m)^  cancel-in-progress: false$')
$longest = (@($verbs.verbs.PSObject.Properties | ForEach-Object { [int]$_.Value.timeoutMinutes }) | Measure-Object -Maximum).Maximum
$tm = [regex]::Match($wf, '(?m)^    timeout-minutes: (\d+)$')
Yes "  and the job outlasts the longest script ($longest minutes)" ($tm.Success -and [int]$tm.Groups[1].Value -gt $longest)

# ---- 6. Set-NexusKey -ToEnvironment, and where the key is said to be ------------------
$sk = Text 'scripts/release/Set-NexusKey.ps1'
Yes 'Set-NexusKey -ToEnvironment puts the key on gh''s standard input, into NEXUS_API_KEY' ($sk.Contains('$script:NexusKey | & gh secret set NEXUS_API_KEY --env $ToEnvironment --repo $GitHubRepo'))
Yes '  only once the environment lets in main alone' ($sk.IndexOf("`$names[0] -ne 'main'") -gt 0 -and $sk.IndexOf("`$names[0] -ne 'main'") -lt $sk.IndexOf('gh secret set NEXUS_API_KEY'))
Yes '  and after Nexus takes the key' ($sk.IndexOf('if (-not (Test-Key)) { Die ''Nexus takes the key, but its account does not own both of our mods, so it is not put on GitHub.') -lt $sk.IndexOf('gh secret set NEXUS_API_KEY'))
$nx = Text 'scripts/release/Nexus.ps1'
Yes 'Nexus.ps1 sends a cloud session to Nexus-Run, not to a variable of its own' ($nx.Contains('A cloud session holds none: run the script through pwsh scripts/release/Nexus-Run.ps1') -and -not $nx.Contains('In a cloud session it is the environment variable'))

# The session's half refuses a bad line before it asks GitHub for anything.
$psi = New-Object Diagnostics.ProcessStartInfo
$psi.FileName = $pwshExe
foreach ($x in @('-NoProfile', '-NonInteractive', '-File', (Join-Path $Repo $nr), '-Line', 'Send-NexusFile -Mod 192001 -Version 1.3 -Archive x.zip')) { $psi.ArgumentList.Add($x) }
$psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
$psi.EnvironmentVariables['PATH'] = ''
$p = [Diagnostics.Process]::Start($psi); $o = $p.StandardOutput.ReadToEnd() + $p.StandardError.ReadToEnd(); $p.WaitForExit()
Yes 'the session''s half refuses a line outside the file before it looks for gh' ($p.ExitCode -eq 1 -and $o -match 'not -Archive' -and $o -notmatch 'no gh here')

Done
