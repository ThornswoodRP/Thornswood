<#
  test-5356-new-box-pwsh.ps1

  A new box runs PowerShell 7 from its first login on, the way the box runs
  everything (#5356).

  WHY THIS EXISTS. Since #5371 every script, task and forced command on the
  box starts pwsh, but a new Windows Server has only Windows PowerShell. So
  Setup-SshKey.ps1 -NewBox and Bootstrap-VPS.ps1 still started powershell.exe,
  and Bootstrap-VPS put the newest PowerShell release on the box, unchecked.
  Now -NewBox's first login puts one pinned release there, held to the
  SHA-256 PowerShell publishes for it, with only what Windows Server has
  (cmd, curl.exe, certutil, msiexec), and runs its key step in it; Bootstrap
  runs in pwsh after it and holds the same pin.

  Checks:
    1. Setup-SshKey.ps1 and Bootstrap-VPS.ps1 pin the same release and
       SHA-256, and the address is PowerShell's own for that release.
    2. -NewBox's line checks the hash before msiexec runs, waits for msiexec,
       deletes the file either way, skips the install when pwsh is there,
       and runs the key step in pwsh by its full path. Nothing names
       Windows PowerShell.
    3. That line, with a real key step, fits in the 8,191 characters cmd.exe
       takes from sshd.
    4. Remote.ps1 and Send-Script.ps1 start pwsh for every script, with no
       switch back to Windows PowerShell.
    5. Bootstrap-VPS.ps1 installs the pinned release through its checked
       msi step, and never the newest one unchecked.

  Read only. Never connects to anything.

      pwsh -NoProfile -File tests\test-5356-new-box-pwsh.ps1
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Text([string]$rel) { return [IO.File]::ReadAllText((Join-Path $Root $rel)) }
function Code([string]$text) { return (($text -replace '(?s)<#.*?#>', '') -replace '(?m)^\s*#.*$', '') }

$setup = Text 'scripts/vps/Setup-SshKey.ps1'
$boot = Text 'scripts/vps/Bootstrap-VPS.ps1'
$remote = Text 'scripts/vps/Remote.ps1'
$send = Text 'scripts/vps/Send-Script.ps1'

# ---- 1. one pin in both --------------------------------------------------
$sv = [regex]::Match($setup, "(?m)^\`$PwshVersion = '([0-9.]+)'").Groups[1].Value
$ss = [regex]::Match($setup, "(?m)^\`$PwshSha256 = '([0-9a-f]{64})'").Groups[1].Value
$bv = [regex]::Match($boot, "\[string\]\`$PwshVersion\s*=\s*'([0-9.]+)'").Groups[1].Value
$bs = [regex]::Match($boot, "\[string\]\`$PwshSha256\s*=\s*'([0-9a-f]{64})'").Groups[1].Value
Yes ('both pin one PowerShell release and its SHA-256 (' + $sv + ')') ($sv -and $ss -and $sv -eq $bv -and $ss -eq $bs)
Yes '  from PowerShell''s own release, its x64 msi' ($setup.Contains('$PwshUrl = "https://github.com/PowerShell/PowerShell/releases/download/v$PwshVersion/PowerShell-$PwshVersion-win-x64.msi"') -and
    $boot.Contains('"https://github.com/PowerShell/PowerShell/releases/download/v$PwshVersion/PowerShell-$PwshVersion-win-x64.msi"'))

# ---- 2. the first login's line ---------------------------------------------
$sc = Code $setup
$at = $sc.IndexOf('$line = ')
$lineSrc = $(if ($at -ge 0) { $sc.Substring($at, $sc.IndexOf('Invoke-ThornswoodNative', $at) - $at) } else { '' })
Yes '-NewBox builds its line from the pin' ($lineSrc.Contains('$PwshUrl') -and $lineSrc.Contains('$PwshSha256'))
Yes '  installs only when pwsh is not there' ($lineSrc.Contains("'if not exist ' + `$pwshExe + ' ("))
$hash = $lineSrc.IndexOf('certutil -hashfile')
$find = $lineSrc.IndexOf('findstr /i /x')
$msiexec = $lineSrc.IndexOf('start "" /wait msiexec /i')
Yes '  checks the hash before msiexec, which runs only on a match (&&), and waits for it' ($hash -gt 0 -and $find -gt $hash -and $msiexec -gt $find -and
    $lineSrc.Substring($find, $msiexec - $find).Contains(' >nul && '))
Yes '  deletes the file whether it matched or not (&, not &&)' ($lineSrc.Contains("/quiet /norestart & del ' + `$msi + ')"))
Yes '  runs the key step in pwsh by its full path' ($sc.Contains("`$pwshExe = '`"%ProgramFiles%\PowerShell\7\pwsh.exe`"'") -and $lineSrc.Contains("`$pwshExe + ' -NoProfile -EncodedCommand ' + `$b64"))
Yes '  and nothing in it starts Windows PowerShell' ($sc -notmatch '(?i)["'' ]powershell(\.exe)? -NoProfile')
Yes '  ssh is given that line' ($sc.Contains('Invoke-ThornswoodNative { & ssh -o StrictHostKeyChecking=yes $target $line }'))

# ---- 3. it fits ----------------------------------------------------------
$here = [regex]::Match($sc, '(?s)\$remote = @"\r?\n(.*?)\r?\n"@')
$keyStep = $here.Groups[1].Value.Replace('$pub', 'ssh-ed25519 ' + ('A' * 68) + ' thornswood-one')
$b64 = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($keyStep))
$url = "https://github.com/PowerShell/PowerShell/releases/download/v$sv/PowerShell-$sv-win-x64.msi"
$msiPath = '"%TEMP%\thornswood-pwsh.msi"'
$exe = '"%ProgramFiles%\PowerShell\7\pwsh.exe"'
$built = 'if not exist ' + $exe + ' (curl.exe -fsSL -o ' + $msiPath + ' ' + $url + ' && certutil -hashfile ' + $msiPath + ' SHA256 | findstr /i /x ' + $ss +
         ' >nul && start "" /wait msiexec /i ' + $msiPath + ' /quiet /norestart & del ' + $msiPath + ') & ' + $exe + ' -NoProfile -EncodedCommand ' + $b64
Yes ('  the whole line is ' + $built.Length + ' characters, under the 8,191 cmd.exe takes') ($here.Success -and $built.Length -lt 8191)

# ---- 4. every later script in pwsh -----------------------------------------
$rc = Code $remote
$sd = Code $send
Yes 'Remote.ps1 asks for no Windows PowerShell, for Bootstrap-VPS.ps1 or anything else' ($rc -notmatch 'NewBox' -and $rc -notmatch "(?i)'powershell'")
Yes 'Send-Script.ps1 starts pwsh, with no switch back' ($sd.Contains("`$shell = 'pwsh'") -and $sd -notmatch '\[switch\]\$NewBox' -and $sd -notmatch "(?i)`$shell = 'powershell'")

# ---- 5. Bootstrap-VPS ------------------------------------------------------
$bc = Code $boot
Yes 'Bootstrap-VPS.ps1 installs the pinned PowerShell through its checked msi step' ($bc.Contains('Install-Msi "https://github.com/PowerShell/PowerShell/releases/download/v$PwshVersion/PowerShell-$PwshVersion-win-x64.msi" "PowerShell $PwshVersion" $PwshSha256'))
Yes '  never the newest release, unchecked' ($boot -notmatch 'PowerShell/PowerShell/releases/latest' -and $boot -notmatch '(?i)PowerShell 5\.1')
Yes '  and leaves a newer one as it is' ($bc.Contains('if ($havePwsh -and $havePwsh -ge [version]$PwshVersion)'))

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
