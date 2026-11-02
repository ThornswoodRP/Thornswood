<#
  test-2199-fetch-whole-path.ps1

      pwsh -NoProfile -File .\tests\test-2199-fetch-whole-path.ps1

  Issue #2199, the refresh of the scheduled fetch. On 12 Oct
  Fetch-Backups.ps1 -Schedule was run through Git Bash with an unquoted
  -To C:\Users\<you>\Downloads\Thornswood-Repo\local\backups. Bash dropped
  the backslashes, the script got C:Users<you>DownloadsThornswood-Repolocalbackups,
  a path relative to the current folder on drive C:, made that folder where
  it ran, and registered the task with it word for word. The task's next run
  would have fetched into a new folder under its own copy's folder.

  This runs the real script with paths that are not whole and reads what
  happens:

    - a drive-relative -To (C:name), a folder-relative -To and a -To that
      starts at the root of the drive are each refused, exit 1, naming the
      path, with no folder made where the script ran and nothing written to
      a fetch.log there
    - with -Schedule, a bad -To or -KeyFile is refused before the scripts are
      copied or a task is registered (a task name of its own, checked after)
    - a whole -To (C:\...) still works, with -PruneOnly

  The script runs under PowerShell 7, which the task uses since #5356. Touches
  nothing but a scratch folder under the temp folder; LOCALAPPDATA is pointed
  into it for the runs, so even a broken refusal would not copy over the
  real scheduled copy.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Fetch = Join-Path (Split-Path -Parent $Here) 'scripts\vps\Fetch-Backups.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$tokens = $null; $errors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($Fetch, [ref]$tokens, [ref]$errors)
Yes 'Fetch-Backups.ps1 parses' ($errors.Count -eq 0)

. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) {
    Write-Host 'SKIP  the runs: they are about Windows drive paths (C:\... whole, C:... drive-relative) and a scheduled task, which only Windows has'
    Done
}
$boxPs = Get-BoxPowerShell

$root = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-2199w-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$cwd = Join-Path $root 'ran-here'
$app = Join-Path $root 'appdata'
[void][IO.Directory]::CreateDirectory($cwd)
[void][IO.Directory]::CreateDirectory($app)
$task = 'Thornswood Fetch Backups test-2199-' + [guid]::NewGuid().ToString('N').Substring(0, 8)

$script:last = @()
function Run([string[]]$argv) {
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $oldApp = $env:LOCALAPPDATA
    Push-Location -LiteralPath $cwd
    [Environment]::CurrentDirectory = $cwd
    try {
        $env:LOCALAPPDATA = $app
        $script:last = @(& $boxPs -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Fetch @argv 2>&1 | ForEach-Object { "$_" })
        $code = $LASTEXITCODE
    } finally {
        $env:LOCALAPPDATA = $oldApp
        Pop-Location
        [Environment]::CurrentDirectory = (Get-Location).ProviderPath
        $ErrorActionPreference = $eap
    }
    return $code
}
function Show { foreach ($l in $script:last | Select-Object -Last 12) { Write-Host ('        ' + $l) } }
function Said([string]$pattern) { return (($script:last -join "`n") -match $pattern) }
function MadeHere { return @(Get-ChildItem -LiteralPath $cwd -Force -Recurse -EA SilentlyContinue).Count }

try {
    # The drive the scratch folder is on, so a drive-relative path lands in
    # $cwd (the current folder of that drive for the run) if it is not refused.
    $drive = $cwd.Substring(0, 2)
    $bad = @(
        @{ Name = 'a drive-relative -To, as Git Bash passes C:\... unquoted'; To = ($drive + 'UsersyouDownloadsThornswood-Repolocalbackups') },
        @{ Name = 'a folder-relative -To'; To = 'local\backups' },
        # Into the scratch folder, so a script that took it makes nothing
        # at the root of the drive.
        @{ Name = 'a -To from the root of the current drive'; To = (Join-Path $root.Substring(2) 'from-the-root') }
    )
    foreach ($b in $bad) {
        $code = Run @('-To', $b.To, '-PruneOnly', '-NoPause')
        $ok = ($code -eq 1) -and (Said 'not a whole path') -and (Said ([regex]::Escape($b.To)))
        Yes ("{0} is refused, naming it (exit {1})" -f $b.Name, $code) $ok
        if (-not $ok) { Show }
        Yes '  nothing made where it ran' ((MadeHere) -eq 0)
        if ($b.To.StartsWith('\')) { Yes '  nothing made at that folder' (-not (Test-Path -LiteralPath ($drive + $b.To))) }
    }

    $code = Run @('-Schedule', '-TaskName', $task, '-To', ($drive + 'UsersyouDownloadsThornswood-Repolocalbackups'), '-NoPause')
    Yes ("-Schedule with a drive-relative -To is refused (exit {0})" -f $code) (($code -eq 1) -and (Said 'not a whole path'))
    Yes '  no task registered' (-not (Get-ScheduledTask -TaskName $task -EA SilentlyContinue))
    Yes '  no scripts copied' (-not (Test-Path -LiteralPath (Join-Path $app 'Thornswood\Backups-Fetch')))
    Yes '  nothing made where it ran' ((MadeHere) -eq 0)

    $whole = Join-Path $root 'backups'
    $code = Run @('-Schedule', '-TaskName', $task, '-To', $whole, '-KeyFile', ($drive + 'key.txt'), '-NoPause')
    Yes ("-Schedule with a drive-relative -KeyFile is refused (exit {0})" -f $code) (($code -eq 1) -and (Said 'KeyFile is not a whole path'))
    Yes '  no task registered' (-not (Get-ScheduledTask -TaskName $task -EA SilentlyContinue))
    Yes '  no scripts copied' (-not (Test-Path -LiteralPath (Join-Path $app 'Thornswood\Backups-Fetch')))

    $code = Run @('-To', $whole, '-PruneOnly', '-NoPause')
    Yes ("a whole -To still works with -PruneOnly (exit {0})" -f $code) (($code -eq 0) -and (Test-Path -LiteralPath (Join-Path $whole 'fetch.log')))
    if ($code -ne 0) { Show }
} finally {
    if (Get-ScheduledTask -TaskName $task -EA SilentlyContinue) { Unregister-ScheduledTask -TaskName $task -Confirm:$false -EA SilentlyContinue }
    Remove-Item -LiteralPath $root -Recurse -Force -EA SilentlyContinue
}
Done
