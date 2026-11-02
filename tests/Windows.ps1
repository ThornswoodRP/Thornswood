<#
  Windows.ps1
  Dot-sourced by every harness that runs box code, or something only Windows
  has: cmd.exe, a scheduled task, a folder's ACL, the .NET Framework.

      . (Join-Path $PSScriptRoot 'Windows.ps1')

  It sets one variable and three functions, and nothing else:

    $OnWindows             $true on Windows, under pwsh or under Windows
                           PowerShell 5.1, and $false anywhere else.
    Get-WindowsPath <rel>  <rel> under the Windows folder, as in
                           Get-WindowsPath 'System32\cmd.exe'. Off Windows it
                           throws, because there is no Windows folder to name.
    Get-BoxPowerShell      The PowerShell 7 that runs the harness, the shell the
                           box runs its scripts in since #5356. It works on
                           every OS, so a harness that runs box code in a child
                           shell runs it here too, on Linux as on Windows.
    Get-WindowsPowerShell  Windows PowerShell 5.1's powershell.exe. Nothing on
                           the box starts it since #5356; it is kept only for
                           the launcher harnesses still on it (among them
                           tests\test-signer-check.ps1) until the launcher's
                           pull request lands. It throws when
                           that file is not where Windows keeps it, and it
                           throws off Windows.

  A harness that runs a box script in a child shell asks for that shell:

      $ps = Get-BoxPowerShell
      $o = & $ps -NoProfile -NonInteractive -File $script 2>&1

  A harness that needs Windows itself asks $OnWindows first, and only then
  asks for a path, and names what Windows has that it needs:

      if (-not $OnWindows) {
          Write-Host 'SKIP  the task check: it registers a scheduled task, which only Windows has'
          Done
      }
      $cmd = Get-WindowsPath 'System32\cmd.exe'

  A harness that is about Windows from end to end (a folder's ACL, a task, a
  script only the box runs) says so at its top and ends there, with no count,
  because it checked nothing:

      if (-not $OnWindows) { Write-Host 'NOT RUN  <what it proves> happens only on Windows'; exit 0 }

  WHY ONE PLACE (#2957, 21 Oct). Every harness found Windows PowerShell by
  itself: by joining a path onto $env:SystemRoot or $env:WINDIR, or by asking
  Get-Command for powershell.exe. Off Windows those variables are unset, so the
  join threw "Cannot bind argument to parameter 'Path' because it is null"
  before any guard after it ran, and harness after harness stopped on its first
  lines under pwsh on Linux; the line was copied from one harness to the next,
  so each new one did the same. On Windows, Get-Command found nothing when
  powershell.exe was missing, and the harness said SKIP, or ran pwsh in its
  place, and passed without running what it was for. Here, off Windows is said
  plainly, and on Windows a powershell.exe that is not where Windows keeps it
  is a failure, never a skip. tests\test-2957-windows-one-way.ps1 fails on a
  harness that finds Windows any other way.

  WHY GET-BOXPOWERSHELL (#5356, 1 Nov). The box ran its scripts in Windows
  PowerShell 5.1, so the harnesses ran box code in it too, and off Windows they
  said SKIP for every run. Now every script on the box runs in PowerShell 7,
  the same pwsh that runs the harness, so box code runs in the harness's own
  shell everywhere and a harness skips only for what Windows itself has.
#>
$OnWindows = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
function Get-WindowsPath([string]$Relative) {
    if (-not $OnWindows) { throw ('Get-WindowsPath ' + $Relative + ': this is not Windows. Ask $OnWindows first, and say what does not run.') }
    # The Windows folder from .NET, not from the environment, which a child
    # can be started without.
    Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)) $Relative
}
function Get-BoxPowerShell {
    # The running pwsh itself, from .NET, so it is the same build on every OS
    # and never one found on PATH.
    [Environment]::ProcessPath
}
function Get-WindowsPowerShell {
    $p = Get-WindowsPath 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (-not (Test-Path -LiteralPath $p)) { throw ('Windows PowerShell 5.1 is not at ' + $p + ', where Windows keeps it, so nothing that needs it can be checked here.') }
    $p
}
