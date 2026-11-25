<#
  test-4683-uninstall-percent.ps1

  The uninstall hands its deletes to a .cmd script it writes
  (Uninstall.Script) and runs once the launcher has exited. cmd expands
  %...% in a .cmd file, inside quotes too, and setlocal does not stop it, so
  until #4683 a path with one percent sign reached rmdir and del with the
  sign dropped (nothing of the install removed, and the uninstall said it was
  done), and a path with two reached them with the part between expanded as
  a variable: a different folder from the one the launcher checked.

  This holds, with the real Script lifted out of Uninstall.cs and built with
  the build's compiler (tests\Launcher-Csc.ps1):
    1. every path Script writes into the .cmd file has each % doubled, which
       cmd reads back as one: the targets, _quarantine, the install folder,
       the root record, Velopack's Update.exe and the farewell note
    2. a value Script is given empty (the farewell note, Update.exe, the
       root record) writes no line, as a null one writes none: an empty
       note gave del /f /q "", the folder cmd runs in (#6382)
    3. on Windows, the script run by cmd removes exactly the folder it was
       given, and leaves the folder cmd's expansion would have reached:
         - an install folder with one percent sign, beside the same name
           without it
         - an install folder named %TW4683DECOY%, with that variable set to
           the name of a decoy folder beside it
       and the scripts it runs name no empty path: cmd reads one as the
       folder it runs in, and del /q emptied the repository root of its
       files while other harnesses read them (#6382)

  Off Windows, part 3 says SKIP: a SKIP is not a pass. Read only apart from
  its own scratch folder, which it removes.
#>
[CmdletBinding()]
param([string]$Root)
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Root) { $Root = Split-Path -Parent (Split-Path -Parent $Here) }

. (Join-Path (Join-Path $Root 'tests') 'Launcher-Csc.ps1')   # the build's compiler and C# version (#2821)
. (Join-Path (Join-Path $Root 'tests') 'Windows.ps1')        # $OnWindows (#2957)

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host "$script:pass passed, $script:fail failed"
    exit $(if ($script:fail) { 1 } else { 0 })
}

$src = [IO.File]::ReadAllText((Join-Path (Join-Path (Join-Path $Root 'launcher') 'app') 'Uninstall.cs'))

# From the start of the signature's line to the brace that closes it.
function Lift([string]$text, [string]$signature) {
    $at = $text.IndexOf($signature)
    if ($at -lt 0) { return $null }
    $lineStart = $text.LastIndexOf("`n", $at) + 1
    $open = $text.IndexOf('{', $at)
    $depth = 0
    for ($i = $open; $i -lt $text.Length; $i++) {
        if ($text[$i] -eq '{') { $depth++ }
        elseif ($text[$i] -eq '}') { $depth--; if ($depth -eq 0) { return $text.Substring($lineStart, $i + 1 - $lineStart) } }
    }
    return $null
}

$scriptSrc = Lift $src 'public static string Script(string[] targets, int waitFor, string note, string updateExe = null, string rootRecord = null)'
Yes 'Uninstall.cs has Script' ($null -ne $scriptSrc)
if ($null -eq $scriptSrc) { Done }
# Read from the code, so it holds with no compiler too: every value Script
# puts between quotes in a line goes through CmdPath, bar the process id.
$quotedExprs = @([regex]::Matches($scriptSrc, '\\"" \+ (.+?) \+ "\\"') | ForEach-Object { $_.Groups[1].Value.Trim() } | Where-Object { $_ -ne 'waitFor' })
$raw = @($quotedExprs | Where-Object { -not $_.StartsWith('CmdPath(') })
Yes ("Script writes values between quotes ($($quotedExprs.Count))") ($quotedExprs.Count -ge 6)
Yes ('each goes through CmdPath' + $(if ($raw.Count) { ' (not: ' + ($raw -join ', ') + ')' } else { '' })) ($quotedExprs.Count -gt 0 -and $raw.Count -eq 0)

# The helper Script writes every path through, when Uninstall.cs has it.
$helpers = New-Object System.Text.StringBuilder
$h = Lift $src 'static string CmdPath(string path)'
if ($h) { [void]$helpers.AppendLine($h) }

$stub = "using System;`nusing System.IO;`nusing System.Text;`nnamespace Thornswood`n{`n" +
        "    static class Paths { public static string Root; }`n" +
        "    static class Uninstall`n    {`n" + $helpers.ToString() + "`n" + $scriptSrc + "`n    }`n}`n"
$asm = $null
try { $asm = Add-LauncherType -Source $stub }
catch { Write-Host ('      ' + $_.Exception.Message) }
Yes 'Script compiles with the compiler the build runs' ($null -ne $asm)
if ($null -eq $asm) { Done }
$PathsT = $asm.GetType('Thornswood.Paths')
$U = $asm.GetType('Thornswood.Uninstall')
# note, update and record are untyped on purpose (#6382). PowerShell hands a
# [string] parameter given $null an empty string, so Run's scripts got
# del /f /q "" for the farewell note; cmd reads an empty name as the folder it
# runs in, which for a harness is the repository root, and /q emptied it of
# its files while other harnesses read them. Untyped, $null reaches Script as
# null, as it does from the launcher.
function Build([string]$root, [string[]]$targets, [int]$pid_, $note, $update, $record) {
    $PathsT.GetField('Root').SetValue($null, $root)
    return [string]$U.GetMethod('Script').Invoke($null, [object[]]@([string[]]$targets, $pid_, $note, $update, $record))
}

# ---- 1. the text --------------------------------------------------------------
$sep = [IO.Path]::DirectorySeparatorChar
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('ts-4683-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch | Out-Null
try {
    $r = Join-Path $scratch 'A%B%C'
    $game = $r + $sep + 'Game'
    $text = Build $r @($game) 1 ($r + $sep + 'note%1.ps1') ($r + $sep + 'Up%date.exe') ($r + $sep + 'root%.txt')
    $quoted = @([regex]::Matches($text, '"([^"]*)"') | ForEach-Object { $_.Groups[1].Value } | Where-Object { $_.StartsWith($scratch) })
    Yes "Script writes the paths it was given ($($quoted.Count) quoted)" ($quoted.Count -ge 7)
    # Every % in a path line comes in pairs, and halving them gives the path back.
    $bad = @($quoted | Where-Object { ([regex]::Matches($_, '%+') | Where-Object { $_.Length % 2 -ne 0 }).Count -gt 0 })
    Yes ('every % in a path in the script is doubled' + $(if ($bad.Count) { ' (not: ' + ($bad -join ', ') + ')' } else { '' })) ($bad.Count -eq 0)
    $back = @($quoted | ForEach-Object { $_.Replace('%%', '%') })
    foreach ($want in @($game, (Join-Path $r '_quarantine'), $r, ($r + $sep + 'root%.txt'), ($r + $sep + 'Up%date.exe'), ($r + $sep + 'note%1.ps1'))) {
        Yes "  and $want reads back as itself" ($back -contains $want)
    }

    # ---- 2. an empty value writes nothing --------------------------------------
    foreach ($none in @($null, '')) {
        $said = if ($null -eq $none) { 'null' } else { 'empty' }
        $text = Build $r @($game) 1 $none $none $none
        $blank = @($text -split "`r?`n" | Where-Object { $_.Contains('""') })
        Yes ("with every value $said, no line has an empty path" + $(if ($blank.Count) { ' (not: ' + ($blank -join ' | ') + ')' } else { '' })) ($blank.Count -eq 0)
    }

    # ---- 3. cmd runs it -------------------------------------------------------
    if (-not $OnWindows) {
        Write-Host 'SKIP  the script run by cmd: this is not Windows'
    }
    else {
        $cmdExe = Get-WindowsPath 'System32\cmd.exe'
        # A process that has exited, so the script's wait ends at once.
        $gone = Start-Process -FilePath $cmdExe -ArgumentList '/c', 'exit' -PassThru -WindowStyle Hidden
        $gone.WaitForExit()
        function Run([string]$root, [string]$target) {
            $text = Build $root @($target) $gone.Id $null $null $null
            $cmdFile = Join-Path $scratch ('run-' + [Guid]::NewGuid().ToString('N') + '.cmd')
            if ($text.Contains('""')) { $script:emptyPath = $true }
            [IO.File]::WriteAllText($cmdFile, $text, (New-Object System.Text.UTF8Encoding($false)))
            $p = Start-Process -FilePath $cmdExe -ArgumentList '/c', ('"' + $cmdFile + '"') -WorkingDirectory $scratch -PassThru -WindowStyle Hidden
            $p.WaitForExit()
        }
        function Put([string]$dir) { New-Item -ItemType Directory -Path $dir -Force | Out-Null; [IO.File]::WriteAllText((Join-Path $dir 'file.txt'), 'x') }

        # One percent sign: cmd drops it, and Thorns%wood becomes Thornswood.
        $script:emptyPath = $false
        $one = Join-Path $scratch 'one'
        $r1 = Join-Path $one 'Thorns%wood'
        Put (Join-Path $r1 'Game'); Put (Join-Path (Join-Path $one 'Thornswood') 'Game')
        Run $r1 (Join-Path $r1 'Game')
        Yes 'one %: the install''s Game folder is removed' (-not (Test-Path -LiteralPath (Join-Path $r1 'Game')))
        Yes '  and the folder of the same name without the % is left' (Test-Path -LiteralPath (Join-Path (Join-Path (Join-Path $one 'Thornswood') 'Game') 'file.txt'))

        # Two: %TW4683DECOY% is a variable, and cmd would read the decoy's name.
        $two = Join-Path $scratch 'two'
        $env:TW4683DECOY = 'decoy'
        $r2 = Join-Path $two '%TW4683DECOY%'
        Put (Join-Path $r2 'Game'); Put (Join-Path (Join-Path $two 'decoy') 'Game')
        Run $r2 (Join-Path $r2 'Game')
        Yes 'two %: the install''s Game folder is removed' (-not (Test-Path -LiteralPath (Join-Path $r2 'Game')))
        Yes '  and the folder the variable names is left' (Test-Path -LiteralPath (Join-Path (Join-Path (Join-Path $two 'decoy') 'Game') 'file.txt'))
        Remove-Item Env:\TW4683DECOY
        Yes 'the scripts cmd ran name no empty path, which del would read as the folder cmd runs in (#6382)' (-not $script:emptyPath)
    }
}
finally {
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}
Done
