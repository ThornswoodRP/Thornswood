<#
  test-3035-file-script.ps1

      pwsh -NoProfile -File .\tests\test-3035-file-script.ps1
      powershell -NoProfile -File .\tests\test-3035-file-script.ps1

  Issue #3035. Six scripts put a file of their own on the box and removed it
  with a later step that a run cut short never reached, so it stayed there
  for good: Harden-VPS.ps1, Set-SshScope.ps1 and Set-TimeWait.ps1 a copy of
  their vps-*.ps1, Rotate-BotToken.ps1 a copy of Write-BotToken.ps1,
  Deploy-DevGamemode.ps1 the load order list, and Backup-Server.ps1 a copy of
  the world and the bot's data with its zip. Each now uses one of the two
  shared ways: the script's text through Send-Script.ps1, whose run takes a
  long one's copy off the box before it runs it (#3059), or, where files must
  be made on the box to come back, the run's folder whose life is its
  keeper's ssh session (scripts\mods\OnBox.ps1).

  This checks:
    1. Get-ThornswoodFileScript (Send-Script.ps1), the form a box script
       file is sent in, run the way the box runs it: Send-Script.ps1's
       runner on the command line of a PowerShell 7 of its own, which is
       what the box runs since #5356, taking the script from its copy in a scratch folder that
       stands for C:\Windows\Temp, and leaving the copy gone. The
       file's param block takes the arguments, a quoted one whole; a
       function's $script: write reaches the file's own top level, as under
       -File; and the file's exit code is the process's. The same file sent
       called with &, the form Remote.ps1 -File used until then, loses that
       write and exits 0, which is why it is dot-sourced.
    2. the six scripts and Remote.ps1, read: no scp of a file into
       C:\Windows\Temp and no -File run of one, each sends through the shared
       ways, and the three box scripts no longer delete themselves, having
       nothing on the box to delete.

  Nothing connects anywhere. What it writes is in its own temp folder, which
  it removes.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
. (Join-Path $PSScriptRoot 'Windows.ps1')
. (Join-Path $Repo 'scripts\vps\Send-Script.ps1')

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# The PowerShell the far side runs under: the box's own, PowerShell 7.
$shell = Get-BoxPowerShell

# Runs $script as the box would run it from Send-Script.ps1: the runner on
# the command line, the script in its copy, which the runner takes off the
# folder before it runs it. The runner's C:\Windows\Temp is $farTemp here.
function Invoke-AsBox([string]$script) {
    $id = [Guid]::NewGuid().ToString('N')
    $copy = Join-Path $farTemp ('thornswood-remote-' + $id + '.ps1')
    [IO.File]::WriteAllText($copy, "`$ProgressPreference = 'SilentlyContinue'`r`n" + $script, (New-Object Text.UTF8Encoding($false)))
    $runner = (Get-ThornswoodRemoteRunner -Path ('C:\Windows\Temp\thornswood-remote-' + $id + '.ps1')).Replace(('C:\Windows\Temp\thornswood-remote-' + $id + '.ps1'), $copy).Replace("'C:\Windows\Temp'", ("'" + $farTemp + "'"))
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $shell
    $psi.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($runner))
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    if ($psi.EnvironmentVariables.ContainsKey('PSModulePath')) { $psi.EnvironmentVariables.Remove('PSModulePath') }
    $p = [Diagnostics.Process]::Start($psi)
    $p.StandardInput.Close()
    $err = $p.StandardError.ReadToEndAsync()
    $out = $p.StandardOutput.ReadToEnd()
    $p.WaitForExit()
    $lines = @(($out + "`n" + $err.Result) -split '\r?\n' | Where-Object { $_.Trim() })
    return [pscustomobject]@{ Code = $p.ExitCode; Lines = $lines; Text = ($lines -join "`n"); CopyLeft = (Test-Path -LiteralPath $copy) }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-3035-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$farTemp = Join-Path $tmp 'far-temp'
New-Item -ItemType Directory -Force -Path $farTemp | Out-Null
try {
    # ---- 1. the sent form, run ---------------------------------------------------
    # Shaped like vps-harden.ps1 and vps-ssh-scope.ps1: help, CmdletBinding, a
    # param block, a top-level variable a function sets through $script:, and
    # an exit code that depends on it.
    $box = Join-Path $tmp 'box.ps1'
    [IO.File]::WriteAllText($box, (@(
        '<#',
        '.SYNOPSIS',
        '  A stand-in box script.',
        '#>',
        '[CmdletBinding()]',
        'param(',
        '    [Parameter(Mandatory = $true)][string]$From,',
        '    [switch]$DryRun',
        ')',
        '$stopped = $false',
        '$changes = 0',
        'function Change { $script:changes++ }',
        'function Stop-Here { $script:stopped = $true }',
        'Change; Change',
        "if (`$From -match 'stop') { Stop-Here }",
        "'FROM ' + `$From",
        "'DRY ' + [bool]`$DryRun",
        "'DONE ' + `$changes + ' change(s), stopped ' + `$stopped",
        'if ($stopped) { exit 3 }',
        'exit 0'
    ) -join "`r`n"), (New-Object Text.UTF8Encoding($false)))

    $sent = Get-ThornswoodFileScript -Path $box -Arguments "-From '203.0.113.7,it''s' -DryRun"
    Yes 'the file goes whole, as a block with its arguments after it' ($sent.Contains([IO.File]::ReadAllText($box)) -and $sent.TrimEnd().EndsWith("} -From '203.0.113.7,it''s' -DryRun"))
    $r = Invoke-AsBox $sent
    Yes ('run as the box runs it (' + (Split-Path -Leaf $shell) + '): the param block takes the arguments, the quoted one whole') (
        ($r.Lines -contains "FROM 203.0.113.7,it's") -and ($r.Lines -contains 'DRY True'))
    Yes '  a function''s $script: write reaches the file''s own top level, as under -File' ($r.Lines -contains 'DONE 2 change(s), stopped False')
    Yes '  and the exit code is the file''s' ($r.Code -eq 0)
    Yes '  and the runner took its copy off the box''s temp folder (#3059)' (-not $r.CopyLeft)
    if ($r.Code -ne 0 -or -not ($r.Lines -contains 'DONE 2 change(s), stopped False')) { Write-Host ('      it said, exit ' + $r.Code + ': ' + $r.Text) }

    $r = Invoke-AsBox (Get-ThornswoodFileScript -Path $box -Arguments "-From 'stop'")
    Yes 'a run the file stops: its STOP reaches the top level and the exit code is 3' ($r.Code -eq 3 -and ($r.Lines -contains 'DONE 2 change(s), stopped True') -and ($r.Lines -contains 'DRY False'))
    if ($r.Code -ne 3) { Write-Host ('      it said, exit ' + $r.Code + ': ' + $r.Text) }

    # The form Remote.ps1 -File sent until #3035: called with &, not
    # dot-sourced. Kept here as the measurement that says why.
    $r = Invoke-AsBox ("& {`r`n" + [IO.File]::ReadAllText($box) + "`r`n} -From 'stop'")
    Yes 'the same file called with & instead loses the $script: writes and exits 0: why the block is dot-sourced' ($r.Code -eq 0 -and ($r.Lines -contains 'DONE 0 change(s), stopped False'))

    # ---- 2. the six scripts, read ------------------------------------------------
    function Code([string]$rel) {
        # The script without its comments, so a line saying what it did once
        # is not taken for what it does.
        $path = Join-Path $Repo $rel
        $tokens = $null
        [void][Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$null)
        $text = [IO.File]::ReadAllText($path)
        foreach ($t in @($tokens | Where-Object { $_.Kind -eq 'Comment' } | Sort-Object { $_.Extent.StartOffset } -Descending)) {
            $text = $text.Remove($t.Extent.StartOffset, $t.Extent.EndOffset - $t.Extent.StartOffset)
        }
        return $text
    }
    $six = @(
        @{ Rel = 'scripts\vps\Harden-VPS.ps1'; Via = 'Get-ThornswoodFileScript -Path \$BoxScript' },
        @{ Rel = 'scripts\vps\Set-SshScope.ps1'; Via = 'Get-ThornswoodFileScript -Path \$BoxScript' },
        @{ Rel = 'scripts\vps\Set-TimeWait.ps1'; Via = 'Get-ThornswoodFileScript -Path \$BoxScript' },
        @{ Rel = 'scripts\deploy\Rotate-BotToken.ps1'; Via = '\(\$writerText \+ "`n" \+ @"' },
        @{ Rel = 'scripts\deploy\Deploy-DevGamemode.ps1'; Via = "``\`$orderWire = '\`$orderWire'" },
        @{ Rel = 'scripts\vps\Backup-Server.ps1'; Via = 'Open-ThornswoodOnBoxFolder -Target' }
    )
    foreach ($s in $six) {
        $c = Code $s.Rel
        $n = Split-Path -Leaf $s.Rel
        Yes "$n copies no file of its own into C:\Windows\Temp and runs none with -File" (
            $c -notmatch '(?i)C:[\\/]Windows[\\/]Temp[\\/]thornswood-(harden|ssh-scope|time-wait|write-bottoken|dev-loadorder|backup)' -and $c -notmatch '-File \$far' -and $c -notmatch '(?i)\$far(Win)?\b')
        Yes "  and sends the way it shares with the rest ($($s.Via))" ($c -match $s.Via)
    }
    foreach ($rel in 'scripts\vps\vps-harden.ps1', 'scripts\vps\vps-ssh-scope.ps1', 'scripts\vps\vps-time-wait.ps1') {
        $c = Code $rel
        Yes ((Split-Path -Leaf $rel) + ' deletes nothing of its own, since nothing of it is written on the box') ($c -notmatch 'PSCommandPath' -and $c -notmatch 'KeepSelf')
    }
    $backup = Code 'scripts\vps\Backup-Server.ps1'
    Yes 'Backup-Server.ps1 makes its copy and zip inside the run''s folder, held while it runs, and tells the keeper when it is over' (
        $backup -match "Join-Path ``\`$run 'stage'" -and $backup -match 'Get-ThornswoodOnBoxHoldScript -Run \$box\.Run' -and $backup -match 'Close-ThornswoodOnBoxFolder \$box' -and
        $backup -notmatch 'KeepOnVps' -and $backup -notmatch 'Remove-Item')
    $remote = Code 'scripts\vps\Remote.ps1'
    Yes 'Remote.ps1 -File sends its file in the same form' ($remote -match 'Get-ThornswoodFileScript -Path \$File -Arguments \$Arguments' -and $remote -notmatch '"& \{')
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
