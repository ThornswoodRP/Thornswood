<#
  test-2957-windows-one-way.ps1

      pwsh -NoProfile -File .\tests\test-2957-windows-one-way.ps1

  Issue #2957. Harness after harness found Windows PowerShell by itself, by
  joining a path onto $env:SystemRoot or $env:WINDIR at its top, and copied
  the line from the harness before it. Off Windows both are unset, so the join
  threw "Cannot bind argument to parameter 'Path' because it is null" before
  any guard after it ran: measured on 21 October under pwsh on Linux, 56 of
  the 105 harnesses that named either stopped there. Others asked Get-Command
  for powershell.exe, which on a Windows machine without it said SKIP, or ran
  pwsh in its place, and passed without running what they were for. On main
  that day this reader found 114 harnesses that found Windows their own way.

  Now every harness asks tests\Windows.ps1: Get-BoxPowerShell for the
  PowerShell 7 the box runs its scripts in (#5356), and for Windows itself
  $OnWindows first, then Get-WindowsPath (or Get-WindowsPowerShell, kept
  only for the launcher harnesses until the launcher's pull request lands).
  This fails on:
    1. a harness in tests\ that names $env:SystemRoot or $env:WINDIR, in its
       code or in the text of a script it writes;
    2. one that runs powershell or cmd by name, or asks Get-Command for them;
    3. one that asks $IsWindows, which Windows PowerShell 5.1 does not have
       (unset there, and an error under Set-StrictMode);
    4. one that uses $OnWindows, Get-BoxPowerShell, Get-WindowsPowerShell or
       Get-WindowsPath without dot-sourcing tests\Windows.ps1 (or
       tests\Launcher-Csc.ps1, which dot-sources it).
  The same reader is run over planted harnesses, one of each, so a reader that
  finds nothing anywhere cannot pass by accident. Then Windows.ps1 itself:
  Get-BoxPowerShell names the PowerShell 7 running this on every OS; off
  Windows the Windows paths say so and name nothing; on Windows they name
  powershell.exe where Windows keeps it.

  Read only, apart from the planted folder under TEMP, which it removes.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
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

# What one harness does another way, as "line N: what", read through the
# PowerShell tokenizer so a comment that tells the history is not a hit.
function Get-OtherWay([string]$path) {
    $hits = New-Object System.Collections.Generic.List[string]
    $errs = $null
    $tokens = [System.Management.Automation.PSParser]::Tokenize([IO.File]::ReadAllText($path), [ref]$errs)
    $envVar = '^(env:|\{env:)(SystemRoot|windir)\}?$'
    $inText = '\$\{?env:(SystemRoot|windir)\b'
    $byName = '^(powershell|cmd)(\.exe)?$'
    $usesHelper = $false
    $loadsHelper = $false
    # A function the harness makes for itself (test-459-publish-record has a
    # Cmd that finds commands in a parsed script) is not cmd.exe.
    $own = @{}
    for ($i = 0; $i + 1 -lt $tokens.Count; $i++) {
        if ("$($tokens[$i].Type)" -eq 'Keyword' -and $tokens[$i].Content -eq 'function') { $own[$tokens[$i + 1].Content] = $true }
    }
    for ($i = 0; $i -lt $tokens.Count; $i++) {
        $t = $tokens[$i]
        $type = "$($t.Type)"
        $at = 'line ' + $t.StartLine + ': '
        if ($type -eq 'Variable' -and $t.Content -match $envVar) { $hits.Add($at + '$' + $t.Content) }
        elseif ($type -eq 'Variable' -and $t.Content -eq 'IsWindows') { $hits.Add($at + '$IsWindows, which Windows PowerShell 5.1 does not have') }
        elseif ($type -eq 'String' -and $t.Content -match $inText) { $hits.Add($at + 'a script it writes names $env:' + $Matches[1]) }
        elseif ($type -eq 'Command' -and $t.Content -match $byName -and -not $own.ContainsKey($t.Content)) { $hits.Add($at + 'runs ' + $t.Content + ' by name') }
        elseif ($type -eq 'Command' -and $t.Content -match '^(Get-Command|gcm)$') {
            for ($n = $i + 1; $n -lt $tokens.Count -and "$($tokens[$n].Type)" -match '^(CommandParameter|CommandArgument|String)$'; $n++) {
                if ("$($tokens[$n].Type)" -ne 'CommandParameter' -and $tokens[$n].Content -match $byName) { $hits.Add($at + 'asks Get-Command for ' + $tokens[$n].Content) }
            }
        }
        elseif ($type -eq 'Member' -and $t.Content -eq 'FileName' -and $i + 2 -lt $tokens.Count -and
                "$($tokens[$i + 2].Type)" -eq 'String' -and $tokens[$i + 2].Content -match $byName) {
            $hits.Add($at + 'starts ' + $tokens[$i + 2].Content + ' by name')
        }
        if (($type -eq 'Variable' -and $t.Content -eq 'OnWindows') -or
            ($type -eq 'Command' -and $t.Content -match '^Get-(Windows(PowerShell|Path)|BoxPowerShell)$')) { $usesHelper = $true }
        # Launcher-Csc.ps1 dot-sources it for the harnesses that compile the launcher.
        if ($type -eq 'String' -and $t.Content -match '^(Windows|Launcher-Csc)\.ps1$') { $loadsHelper = $true }
    }
    if ($usesHelper -and -not $loadsHelper) { $hits.Add('asks tests\Windows.ps1 without dot-sourcing it') }
    , $hits
}

# ---- 1. every harness here --------------------------------------------------
# Here and beside each product, in its own tests folder (plan line 42).
. (Join-Path (Join-Path (Join-Path $Repo 'scripts') 'dev') 'Harness-Files.ps1')
$harnesses = @(@($Here) + @(Get-ProductTestFolders $Repo | ForEach-Object { $_.Path }) | ForEach-Object {
    Get-ChildItem -LiteralPath $_ -File -Filter '*.ps1' } | Where-Object { $_.Name -ne 'Windows.ps1' -and $_.FullName -ne $PSCommandPath })
Yes ('there are harnesses to read (' + $harnesses.Count + ')') ($harnesses.Count -gt 300)
$bad = 0
foreach ($h in $harnesses) {
    $hits = Get-OtherWay $h.FullName
    if ($hits.Count) {
        $bad++
        Write-Host ('FAIL  ' + $h.Name + ' finds Windows itself; ask tests\Windows.ps1:')
        foreach ($x in $hits) { Write-Host ('      ' + $x) }
    }
}
Yes 'every harness finds Windows, and its PowerShell and cmd, through tests\Windows.ps1' ($bad -eq 0)

# ---- 2. the reader, over planted harnesses -----------------------------------
$plant = Join-Path ([IO.Path]::GetTempPath()) ('ts-2957-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
[void][IO.Directory]::CreateDirectory($plant)
try {
    $cases = [ordered]@{
        'the join issue #2957 measured' = @('$ps51 = Join-Path $env:SystemRoot ''System32\WindowsPowerShell\v1.0\powershell.exe''', 1)
        'the same through WINDIR, any case' = @('$w = Join-Path $env:windir ''System32\cmd.exe''', 1)
        'braced' = @('$w = "${env:SystemRoot}\System32"', 1)
        'inside a script the harness writes' = @('$text = ''& (Join-Path $env:SystemRoot "System32\cmd.exe") /c exit''', 1)
        'powershell.exe run by name' = @('& powershell.exe -NoProfile -File $f', 1)
        'powershell run by name, no .exe' = @('$o = & powershell @a 2>&1', 1)
        'Get-Command asked for powershell.exe' = @('$c = Get-Command powershell.exe -ErrorAction SilentlyContinue', 1)
        'Get-Command asked for cmd, after a parameter' = @('$c = Get-Command -CommandType Application cmd', 1)
        'a process started as powershell.exe' = @('$psi.FileName = ''powershell.exe''', 1)
        '$IsWindows asked' = @('$w = ($PSVersionTable.PSVersion.Major -lt 6) -or $IsWindows', 1)
        'the helper used without loading it' = @('if ($OnWindows) { $p = Get-WindowsPowerShell }', 1)
        'the box''s shell asked for without loading it' = @('$ps = Get-BoxPowerShell', 1)
        'the box''s shell, loaded and asked for' = @(". (Join-Path `$PSScriptRoot 'Windows.ps1')`r`n`$ps = Get-BoxPowerShell", 0)
        'the helper, loaded and used' = @(". (Join-Path `$PSScriptRoot 'Windows.ps1')`r`nif (-not `$OnWindows) { exit 0 }`r`n`$p = Get-WindowsPowerShell`r`n`$c = Get-WindowsPath 'System32\cmd.exe'", 0)
        'history told in a comment' = @("# before #2957 this joined onto `$env:SystemRoot and ran powershell.exe`r`n<# `$env:WINDIR #>`r`n`$x = 1", 0)
        'a stand-in process named powershell.exe in data' = @('$list = @([pscustomobject]@{ Name = ''powershell.exe''; ProcessId = 7 })', 0)
        'a function of its own named Cmd' = @("function Cmd([string]`$name) { `$name }`r`n`$a = Cmd 'Assert-ThornswoodCommitted'", 0)
    }
    $k = 0
    foreach ($name in $cases.Keys) {
        $k++
        $f = Join-Path $plant ('test-plant-' + $k + '.ps1')
        [IO.File]::WriteAllText($f, $cases[$name][0])
        $n = (Get-OtherWay $f).Count
        Yes ('planted, ' + $name + ': ' + $(if ($cases[$name][1]) { 'found' } else { 'not a hit' }) + ' (' + $n + ')') ($n -eq $cases[$name][1])
    }
} finally {
    Remove-Item -LiteralPath $plant -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- 3. Windows.ps1 itself ---------------------------------------------------
. (Join-Path $PSScriptRoot 'Windows.ps1')
$box = Get-BoxPowerShell
Yes ('Get-BoxPowerShell names the PowerShell 7 running this, on every OS (' + $box + ')') (
    $box -and (Test-Path -LiteralPath $box) -and $box -eq (Get-Process -Id $PID).Path -and $PSVersionTable.PSVersion.Major -ge 7)
$platform = [Environment]::OSVersion.Platform
Yes ('$OnWindows is ' + $OnWindows + ' on ' + $platform) ($OnWindows -eq ($platform -eq [PlatformID]::Win32NT))
if (-not $OnWindows) {
    $said = ''
    try { $null = Get-WindowsPowerShell } catch { $said = $_.Exception.Message }
    Yes 'off Windows, asking for Windows PowerShell throws, saying this is not Windows' ($said -match 'this is not Windows')
    $said = ''
    try { $null = Get-WindowsPath 'System32\cmd.exe' } catch { $said = $_.Exception.Message }
    Yes 'and so does asking for any other Windows path' ($said -match 'this is not Windows')
} else {
    $ps51 = Get-WindowsPowerShell
    Yes ('on Windows, Windows PowerShell 5.1 is where Windows keeps it (' + $ps51 + ')') (
        (Test-Path -LiteralPath $ps51) -and $ps51 -like '*\System32\WindowsPowerShell\v1.0\powershell.exe')
    Yes 'and Get-WindowsPath names cmd.exe beside it' ((Get-WindowsPath 'System32\cmd.exe') -eq (Join-Path (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $ps51))) 'cmd.exe'))
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
