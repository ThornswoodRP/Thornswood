<#
  test-4173-one-character.ps1

      pwsh -NoProfile -File .\tests\test-4173-one-character.ps1

  Issue #4173. scripts\ops\Reset-Character.ps1 said it reset "your
  character", but run with no options it took the live server's folder and
  task, stopped it, and moved every character there aside, without asking
  and without looking whether anybody was in the world; and
  scripts\ops\New-Character.cmd ran it that way on a double click.

  This runs the real script, and the steps it sends to the server lifted out
  of it, against stand-in server folders in a scratch folder:

    P  it needs a server named (-Server dev or main, or -UseLocal) and one
       character (-Character), and with either missing it does nothing;
    L  the look that runs while the server still runs: anybody in the world
       (the server's online.json in its dataDir), or a running server whose
       count cannot be read, stops it with nothing moved; nothing on the game
       port is nobody on, whatever online.json still says; a character that
       is there is found by its form id, long or short, and nothing moves;
    M  the reset itself moves that one character and no other;
    B  the box's script looks before it holds or stops anything, and a look
       that says no stops it there, with the task never stopped;
    A  it asks for RESET before it stops anything, on this machine and for
       the box, and an answer that is not RESET leaves the character;
    C  New-Character.cmd runs New-Character.ps1, this machine's own tool,
       and never Reset-Character.ps1.

  Nothing leaves this machine. The scratch folder goes at the end.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Windows.ps1')
$boxPs = Get-BoxPowerShell
$ResetPs = Join-Path $Repo 'scripts\ops\Reset-Character.ps1'
$ListPs = Join-Path $Repo 'scripts\ops\Release-List.ps1'
$WorldPs = Join-Path $Repo 'scripts\deploy\World.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond, [string]$said = '') {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what"; if ($said) { Write-Host ('      it said: ' + ($said -replace "`n", ' / ')) } }
}

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-4173-' + [Guid]::NewGuid().ToString('N'))
function Put([string]$path, [string]$text) {
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllText($path, $text)
}
# A server folder with two characters, a01 (Ada) and a02, and the world's own form.
function Server([string]$name, [string]$settings = '{"port":45777,"thornswoodServer":"dev"}') {
    $root = Join-Path $T $name
    Put (Join-Path $root 'server-settings.json') $settings
    Put (Join-Path $root 'world\changeForms\0.json') '{"formDesc":"a01","profileId":5001,"appearanceDump":{"name":"Ada"}}'
    Put (Join-Path $root 'world\changeForms\1.json') '{"formDesc":"a02","profileId":5002,"appearanceDump":{"name":"Bo"}}'
    Put (Join-Path $root 'world\changeForms\13164_Skyrim.esm.json') '{"formDesc":"13164:Skyrim.esm","profileId":-1}'
    return $root
}
function Online([string]$root, [int]$now, [string]$dir = 'data') { Put (Join-Path $root ($dir + '\online.json')) ('{"now":' + $now + ',"max":30}') }
function Forms([string]$root) {
    return ((@(Get-ChildItem -LiteralPath (Join-Path $root 'world\changeForms') -Filter '*.json' -File | ForEach-Object { $_.Name } | Sort-Object)) -join ',')
}
function Run([string]$file, [string[]]$arg) {
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $said = @(& $boxPs -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $file @arg 2>&1 | ForEach-Object { "$_" })
        return @{ Code = $LASTEXITCODE; Said = ($said -join "`n") }
    }
    finally { $ErrorActionPreference = $eap }
}
function Script([string]$text) {
    $f = Join-Path $T ('step-' + [Guid]::NewGuid().ToString('N') + '.ps1')
    Put $f $text
    return $f
}

$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($ResetPs, [ref]$tokens, [ref]$errors)
$text = [IO.File]::ReadAllText($ResetPs)
Yes 'Reset-Character.ps1 parses' (@($errors).Count -eq 0)
function RightOf([string]$name) {
    $n = '$' + $name
    $a = @($ast.FindAll({ param($x) $x -is [System.Management.Automation.Language.AssignmentStatementAst] -and "$($x.Left)" -eq $n }.GetNewClosure(), $true))
    if ($a.Count -ne 1) { return $null }
    return $a[0].Right.Extent.Text
}
$bodyText = RightOf 'body'
$body = $null
if ($bodyText) { $body = & { . $ListPs; . $WorldPs; & ([scriptblock]::Create($bodyText)) } }
$run = $null
$rights = @((RightOf 'stopAndMove'), (RightOf 'readyWait'), (RightOf 'run'))
if (@($rights | Where-Object { $_ }).Count -eq 3) {
    $run = & {
        $Here = Join-Path $Repo 'scripts\ops'
        . (Join-Path $Repo 'scripts\vps\ServerHold.ps1')
        $stopAndMove = & ([scriptblock]::Create($rights[0]))
        $readyWait = & ([scriptblock]::Create($rights[1]))
        & ([scriptblock]::Create($rights[2]))
    }
}
$useLocal = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.IfStatementAst] -and "$($n.Clauses[0].Item1)" -eq '$UseLocal' }, $true))
Yes 'its body, the box''s script and the -UseLocal branch are found' ($body -and $run -and $useLocal.Count -eq 1)

try {
    [void][IO.Directory]::CreateDirectory($T)
    $bodyFile = Script $body

    # ---- P: a server and a character, or nothing -----------------------------------
    $p = $ast.ParamBlock.Parameters
    function ParamOf([string]$n) { return @($p | Where-Object { $_.Name.VariablePath.UserPath -eq $n })[0] }
    function Sets($param) {
        return @($param.Attributes | Where-Object { $_.TypeName.Name -eq 'Parameter' } | ForEach-Object {
            $m = @($_.NamedArguments | Where-Object { $_.ArgumentName -eq 'Mandatory' })
            $s = @($_.NamedArguments | Where-Object { $_.ArgumentName -eq 'ParameterSetName' })
            @{ Mandatory = ($m.Count -and "$($m[0].Argument)" -eq '$true'); Set = $(if ($s.Count) { $s[0].Argument.Value } else { '' }) }
        })
    }
    $server = @(Sets (ParamOf 'Server')); $local = @(Sets (ParamOf 'UseLocal')); $char = @(Sets (ParamOf 'Character'))
    Yes 'P1 -Server is needed for the box, and is dev or main' (
        $server.Count -eq 1 -and $server[0].Mandatory -and $server[0].Set -eq 'Box' -and
        "$((ParamOf 'Server').Attributes | Where-Object { $_.TypeName.Name -eq 'ValidateSet' })" -match "'dev', 'main'")
    Yes 'P2 -UseLocal is the other way to name the server' ($local.Count -eq 1 -and $local[0].Mandatory -and $local[0].Set -eq 'Here')
    Yes 'P3 -Character is needed either way' ($char.Count -eq 1 -and $char[0].Mandatory -and $char[0].Set -eq '')
    Yes 'P4 nothing names the live server''s folder or task as a default' (
        -not (ParamOf 'VpsRoot') -and -not (ParamOf 'TaskName') -and $text -match "main = @\{ Root = 'C:\\Thornswood-Server';")
    # Each run of the real script names a box that is this machine, so even a
    # script that went past its parameters reaches no server at all.
    $nowhere = @('-VpsHost', '127.0.0.1', '-VpsUser', 'nobody', '-NoPause')
    $r = Run $ResetPs $nowhere
    Yes ('P5 run with nothing named it ends with an error and does nothing (exit ' + $r.Code + ')') (
        $r.Code -ne 0 -and $r.Said -match 'mandatory parameters' -and $r.Said -notmatch 'VPS at|Type RESET|This machine') $r.Said
    $r = Run $ResetPs (@('-Server', 'main') + $nowhere)
    Yes ('P6 a server with no character does the same (exit ' + $r.Code + ')') ($r.Code -ne 0 -and $r.Said -match 'Character' -and $r.Said -notmatch 'VPS at|Type RESET') $r.Said
    $r = Run $ResetPs (@('-Server', 'live', '-Character', 'a01') + $nowhere)
    Yes ('P7 a server that is not dev or main is refused (exit ' + $r.Code + ')') ($r.Code -ne 0 -and $r.Said -match 'ValidateSet|does not belong to the set') $r.Said
    $r = Run $bodyFile @('-Root', (Server 'p-bad'), '-Character', 'ff000000', '-Look', '-Running', 'no')
    Yes ('P8 an id that is not a character''s is refused with nothing touched (exit ' + $r.Code + ')') (
        $r.Code -eq 1 -and $r.Said -match "not a character's form id" -and (Forms (Join-Path $T 'p-bad')) -eq '0.json,1.json,13164_Skyrim.esm.json') $r.Said

    # ---- L: the look, while the server still runs -----------------------------------
    $l1 = Server 'look-on'; Online $l1 2
    $r = Run $bodyFile @('-Root', $l1, '-Character', 'ff000a01', '-Look', '-Running', 'yes')
    Yes ('L1 two in the world stops it, with nothing moved (exit ' + $r.Code + ')') (
        $r.Code -eq 1 -and $r.Said -match 'STOP\. 2 in the world on this server' -and $r.Said -match 'Nothing was stopped or thrown away' -and
        (Forms $l1) -eq '0.json,1.json,13164_Skyrim.esm.json') $r.Said
    $l2 = Server 'look-unread'
    $r = Run $bodyFile @('-Root', $l2, '-Character', 'ff000a01', '-Look', '-Running', 'yes')
    Yes ('L2 a running server with no count to read is not taken as nobody on (exit ' + $r.Code + ')') (
        $r.Code -eq 1 -and $r.Said -match 'does not say who is on' -and (Forms $l2) -eq '0.json,1.json,13164_Skyrim.esm.json') $r.Said
    Put (Join-Path $l2 'data\online.json') '{"max":3}'
    $r = Run $bodyFile @('-Root', $l2, '-Character', 'ff000a01', '-Look', '-Running', 'yes')
    Yes ('L3 and nor is a count file with no count in it (exit ' + $r.Code + ')') ($r.Code -eq 1 -and $r.Said -match 'no "now" count') $r.Said
    $l4 = Server 'look-stale'; Online $l4 3
    $r = Run $bodyFile @('-Root', $l4, '-Character', 'ff000a01', '-Look', '-Running', 'no')
    Yes ('L4 nothing on the game port is nobody on, whatever online.json still says (exit ' + $r.Code + ')') (
        $r.Code -eq 0 -and $r.Said -match 'found character ff000a01 \(Ada\), in 0\.json') $r.Said
    $l5 = Server 'look-datadir' '{"port":45777,"dataDir":"state"}'; Online $l5 0 'state'; Online $l5 4 'data'
    $r = Run $bodyFile @('-Root', $l5, '-Character', 'a01', '-Look', '-Running', 'yes')
    Yes ('L5 the count is read from the server''s own dataDir, and the short id finds the character (exit ' + $r.Code + ')') (
        $r.Code -eq 0 -and $r.Said -match 'nobody is in the world' -and $r.Said -match 'found character ff000a01 \(Ada\)') $r.Said
    Yes 'L6 a look moves nothing' ((Forms $l4) -eq '0.json,1.json,13164_Skyrim.esm.json' -and (Forms $l5) -eq '0.json,1.json,13164_Skyrim.esm.json' -and
        -not @(Get-ChildItem -LiteralPath (Join-Path $l5 'world\changeForms') -Directory).Count)
    $r = Run $bodyFile @('-Root', $l4, '-Character', 'ff000a07', '-Look', '-Running', 'no')
    Yes ('L7 a character not there stops it and says which are (exit ' + $r.Code + ')') (
        $r.Code -eq 1 -and $r.Said -match 'There is no character ff000a07 on this server: its characters are ff000a01 \(Ada\), ff000a02 \(Bo\)') $r.Said

    # ---- M: the reset moves that one character ----------------------------------------
    $m1 = Server 'move'
    $r = Run $bodyFile @('-Root', $m1, '-Character', '0xFF000A02')
    $binned = @(Get-ChildItem -LiteralPath (Join-Path $m1 'world\changeForms') -Directory -Filter '_discarded-*' | ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -File } | ForEach-Object { $_.Name })
    Yes ('M1 the reset moves that one character aside and no other (exit ' + $r.Code + ', ' + ($binned -join ',') + ')') (
        $r.Code -eq 0 -and ($binned -join ',') -eq '1.json' -and (Forms $m1) -eq '0.json,13164_Skyrim.esm.json' -and
        $r.Said -match 'thrown away: character ff000a02 \(Bo\)') $r.Said
    $list = Join-Path $m1 'private\deleted-characters.json'
    Yes 'M2 and the release list names only it' ((Test-Path -LiteralPath $list) -and [IO.File]::ReadAllText($list) -match '"actors":\[4278192642\]')

    # ---- B: the box's script looks before it holds or stops anything --------------
    function At([string]$s) { return $run.IndexOf($s) }
    $look = At '-File C:\thornswood-reset.ps1 -Look -Running $running -Root $Root -Character $Character'
    Yes ('B1 the box looks before it holds the server, stops the task or waits on it (' + (@($look, (At 'Set-ThornswoodHold -Target $Task'), (At 'Stop-ScheduledTask -TaskName $Task')) -join ',') + ')') (
        $look -gt 0 -and $look -gt (At '$pids = @(Get-NetUDPEndpoint') -and $look -lt (At '$held = @(Get-ThornswoodProcessHeld $pids)') -and
        $look -lt (At 'Set-ThornswoodHold -Target $Task') -and $look -lt (At 'Stop-ScheduledTask -TaskName $Task'))
    Yes 'B2 and moves the one character it was given' ((At '-File C:\thornswood-reset.ps1 -Root $Root -Character $Character') -gt (At 'Stop-ScheduledTask -TaskName $Task'))
    # The box's script on a stand-in: the server on its port, the task, and the body where the box keeps it.
    $stand = @'
function Get-NetUDPEndpoint { [pscustomobject]@{ LocalPort = 45777; OwningProcess = 999999 } }
function Stop-ScheduledTask { Write-Host 'TASK STOPPED' }
function Start-ScheduledTask { Write-Host 'TASK STARTED' }
'@
    $boxRun = $run.Replace('C:\thornswood-reset.ps1', $bodyFile)
    $boxRun = $boxRun.Substring(0, $boxRun.IndexOf("`n") + 1) + $stand + "`n" + $boxRun.Substring($boxRun.IndexOf("`n") + 1)
    $boxFile = Script $boxRun
    $b3 = Server 'box-on'; Online $b3 1
    $r = Run $boxFile @('-Root', $b3, '-Task', 'Thornswood test task', '-Server', 'dev', '-Character', 'ff000a01')
    Yes ('B3 one in the world stops the box''s script before the task is stopped (exit ' + $r.Code + ')') (
        $r.Code -eq 1 -and $r.Said -match 'STOP\. 1 in the world' -and $r.Said -match 'The look before the stop said no' -and
        $r.Said -notmatch 'TASK STOPPED|stopped pid|held' -and (Forms $b3) -eq '0.json,1.json,13164_Skyrim.esm.json') $r.Said
    $b4 = Server 'box-absent'; Online $b4 0
    $r = Run $boxFile @('-Root', $b4, '-Task', 'Thornswood test task', '-Server', 'dev', '-Character', 'ff000a09')
    Yes ('B4 and so does a character that is not there (exit ' + $r.Code + ')') (
        $r.Code -eq 1 -and $r.Said -match 'There is no character ff000a09' -and $r.Said -notmatch 'TASK STOPPED|stopped pid') $r.Said

    # ---- A: it asks before it stops anything ------------------------------------------
    $vps = $text.Substring($text.IndexOf('Head "The $Server server on the VPS'))
    Yes 'A1 for the box, it asks for RESET before anything is sent' (
        $vps.IndexOf("Read-Host '  Type RESET to go ahead'") -gt 0 -and $vps.IndexOf("Read-Host '  Type RESET to go ahead'") -lt $vps.IndexOf('& scp @ssh'))
    $branch = $useLocal[0].Clauses[0].Item2.Extent.Text
    Yes 'A2 on this machine, it looks, then asks, then stops the server' (
        $branch.IndexOf('-Look') -gt 0 -and $branch.IndexOf('-Look') -lt $branch.IndexOf("Read-Host '  Type RESET to go ahead'") -and
        $branch.IndexOf("Read-Host '  Type RESET to go ahead'") -lt $branch.IndexOf('Stop-ThornswoodProcessHeld'))
    function LocalRun([string]$root, [string]$answer, [string]$node) {
        $ops = New-Item -ItemType Directory -Force -Path (Join-Path $T 'ops')
        $rel = New-Item -ItemType Directory -Force -Path (Join-Path $T 'release')
        Copy-Item -LiteralPath (Join-Path $Repo 'scripts\release\Get-ScratchDir.ps1') -Destination $rel.FullName -Force
        $f = Join-Path $ops.FullName ('uselocal-' + [Guid]::NewGuid().ToString('N') + '.ps1')
        $t = @"
`$ErrorActionPreference = 'Stop'
`$body = Get-Content -Raw -LiteralPath '$bodyFile'
`$Local = '$root'
`$Character = 'ff000a01'
`$Yes = `$false
`$NoPause = `$true
`$stopAndMove = '$(Join-Path $Repo 'scripts\deploy\StopAndMove.ps1')'
function Say(`$m, `$c) { Write-Host `$m }
function Head(`$m) { Write-Host `$m }
function Die(`$m) { Write-Host ('STOP. ' + `$m); exit 1 }
function Read-Host(`$m) { Write-Host 'ASKED'; return '$answer' }
function Get-Process { $node }
if (`$true) $branch
exit 0
"@
        [IO.File]::WriteAllText($f, $t)
        return (Run $f @())
    }
    $a3 = Server 'ask-no'
    $r = LocalRun $a3 'reset' ''
    Yes ('A3 an answer that is not RESET leaves the character, with nothing stopped (exit ' + $r.Code + ')') (
        $r.Code -eq 1 -and $r.Said -match 'ASKED' -and $r.Said -match 'Left alone' -and $r.Said -notmatch 'stopping the server' -and
        (Forms $a3) -eq '0.json,1.json,13164_Skyrim.esm.json') $r.Said
    $a4 = Server 'ask-on'; Online $a4 2
    $r = LocalRun $a4 'RESET' "[pscustomobject]@{ Id = 999999 }"
    Yes ('A4 with people in the world it stops before it asks (exit ' + $r.Code + ')') (
        $r.Code -eq 1 -and $r.Said -notmatch 'ASKED' -and $r.Said -match '2 in the world' -and (Forms $a4) -eq '0.json,1.json,13164_Skyrim.esm.json') $r.Said
    $a5 = Server 'ask-yes'
    $r = LocalRun $a5 'RESET' ''
    Yes ('A5 and RESET throws away that one character (exit ' + $r.Code + ')') (
        $r.Code -eq 0 -and $r.Said -match 'ASKED' -and (Forms $a5) -eq '1.json,13164_Skyrim.esm.json') $r.Said

    # ---- C: the double click stays on this machine ------------------------------------
    $cmd = [IO.File]::ReadAllText((Join-Path $Repo 'scripts\ops\New-Character.cmd'))
    Yes 'C1 New-Character.cmd runs New-Character.ps1 and never Reset-Character.ps1' (
        $cmd -match 'pwsh [^\r\n]*-File "%~dp0New-Character\.ps1"' -and $cmd -notmatch '-File "%~dp0Reset-Character\.ps1"')
} finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
