<#
  test-4212-lock-checked.ps1

      pwsh -NoProfile -File .\scripts\tests\test-4212-lock-checked.ps1

  A service folder whose lock failed is locked by the next run, and a lock
  that fails stops the script that sent it (#4212).

  WHY. Get-ThornswoodLockedFolderScript (scripts\vps\Lock-Folder.ps1), the
  text every creator of a service folder sends to the box, locked a folder
  only in the branch that had just made it. A lock that threw printed
  'FAILED    locking ...' and the script went on writing into the open
  folder; every later run found the folder there and skipped the lock, so it
  stayed open for good. Setup-Domain, Send-ThornswoodArtifact,
  Restore-ThornswoodServerRecord and Restore-SwapRecord did not look for the
  line at all.

  HOW. Offline, on any machine. Lock-ThornswoodFolder and
  Test-ThornswoodFolderLocked are stood in before the text is made, so the
  text the box would get carries the stand-ins (the Windows ACLs themselves
  are tests\test-vps-folders-on-create.ps1's). The text runs in PowerShell 7
  against a scratch folder, with a line after it that says whether the
  script went on. Then the callers that read nothing are run with the box
  stood in, answering with a failed lock.
#>
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
  if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
$utf8 = New-Object Text.UTF8Encoding($false)
$pwsh = (Get-Process -Id $PID).Path

. (Join-Path $Repo 'scripts/deploy/Artifact.ps1')
. (Join-Path $Repo 'scripts/deploy/Swap.ps1')
. (Join-Path $Repo 'scripts/vps/Lock-Folder.ps1')

# The stand-ins the box's text carries. What they do is set by the
# environment the text runs in.
function Lock-ThornswoodFolder {
  param([Parameter(Mandatory = $true)][string]$Path, [switch]$Only, [string[]]$Writers = @())
  if ($env:TS4212_CALLS) { Add-Content -LiteralPath $env:TS4212_CALLS -Value $Path }
  if ($env:TS4212_LOCK -eq 'throw') { throw 'Attempted to perform an unauthorized operation.' }
}
function Test-ThornswoodFolderLocked {
  param([Parameter(Mandatory = $true)][string]$Path)
  return ($env:TS4212_LOCKED -eq 'yes')
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tw-4212-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Path $tmp

# Runs the box's text for $Folder, then a line that shows the script went on.
function RunText([string]$Folder, [string]$Lock, [string]$Locked) {
  $calls = Join-Path $tmp ('calls-' + [guid]::NewGuid().ToString('N'))
  $f = Join-Path $tmp ('box-' + [guid]::NewGuid().ToString('N') + '.ps1')
  $text = "`$ErrorActionPreference = 'Continue'`n" + (Get-ThornswoodLockedFolderScript -Path $Folder) + "`n'WENT ON'`n"
  [IO.File]::WriteAllText($f, $text, $utf8)
  $env:TS4212_CALLS = $calls; $env:TS4212_LOCK = $Lock; $env:TS4212_LOCKED = $Locked
  try { $out = @(& $pwsh -NoProfile -File $f 2>&1 | ForEach-Object { "$_" }); $code = $LASTEXITCODE }
  finally { Remove-Item Env:TS4212_CALLS, Env:TS4212_LOCK, Env:TS4212_LOCKED -EA SilentlyContinue }
  $n = 0
  if (Test-Path -LiteralPath $calls) { $n = @(Get-Content -LiteralPath $calls).Count }
  return [pscustomobject]@{ Out = $out; Code = $code; Locks = $n; Text = ($out -join "`n") }
}

try {
  # ---- the box's text
  $new = Join-Path $tmp 'made-and-locked'
  $r = RunText $new 'ok' 'no'
  Yes 'a missing folder: made, locked once, says locked, ends 0' ((Test-Path -LiteralPath $new) -and $r.Locks -eq 1 -and $r.Text -match '(?m)^locked\s' -and $r.Code -eq 0)

  $new2 = Join-Path $tmp 'made-lock-fails'
  $r = RunText $new2 'throw' 'no'
  Yes 'a missing folder whose lock fails: FAILED line naming the folder and why' ($r.Text -match ('(?m)^FAILED\s+locking ' + [regex]::Escape($new2) + '.*unauthorized'))
  Yes '  and the script stops there: nothing after the lock runs' ($r.Text -notmatch 'WENT ON')
  Yes '  and ends 1' ($r.Code -eq 1)

  $open = Join-Path $tmp 'there-not-locked'
  $null = New-Item -ItemType Directory -Path $open
  $r = RunText $open 'ok' 'no'
  Yes 'a folder already there and not locked (a first lock that failed): locked by this run' ($r.Locks -eq 1 -and $r.Text -match '(?m)^locked\s' -and $r.Code -eq 0 -and $r.Text -match 'WENT ON')

  $r = RunText $open 'throw' 'no'
  Yes 'a folder already there and not locked whose lock fails again: FAILED, stops, ends 1' ($r.Text -match '(?m)^FAILED\s+locking ' -and $r.Text -notmatch 'WENT ON' -and $r.Code -eq 1)

  $r = RunText $open 'throw' 'yes'
  Yes 'a folder already there and locked: not locked again, nothing said, goes on' ($r.Locks -eq 0 -and $r.Text -notmatch 'locked|FAILED' -and $r.Text -match 'WENT ON' -and $r.Code -eq 0)

  # ---- the callers that read nothing, with the box answering a failed lock
  $failLine = 'FAILED    locking ''C:\Thornswood-Deploys'': Attempted to perform an unauthorized operation.'
  $script:sent = 0
  function Send-ThornswoodArtifactFile { $script:sent++ }

  $zip = Join-Path $tmp 'site-1.zip'; [IO.File]::WriteAllText($zip, 'zip')
  $sha = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
  $art = [pscustomobject]@{ Component = 'site'; Name = 'site-1.zip'; Zip = $zip; RecordPath = ($zip + '.json'); Sha256 = $sha }
  function Invoke-ThornswoodArtifactRemote { param($Target, $SshArgs, $Script) @($failLine, ('HAS ' + $sha)) }
  $threw = ''
  try { Send-ThornswoodArtifact -Artifact $art -Target 'nobody@nowhere' -Store 'C:/Thornswood-Deploys' } catch { $threw = $_.Exception.Message }
  Yes 'Send-ThornswoodArtifact: a failed lock on the store stops it, naming the lock' ($threw -match 'lock')
  Yes '  and nothing is sent to the open store' ($script:sent -eq 0)

  function Invoke-ThornswoodArtifactRemote { param($Target, $SshArgs, $Script) @($failLine, 'SERVER RECORDED an older copy') }
  $threw = ''
  try { $null = Restore-ThornswoodServerRecord -Target 'nobody@nowhere' -Root 'C:/Thornswood-Server' -Store 'C:/Thornswood-Deploys' } catch { $threw = $_.Exception.Message }
  Yes 'Restore-ThornswoodServerRecord: a failed lock on the store stops it, naming the lock' ($threw -match 'lock')

  function Invoke-ThornswoodArtifactRemote { param($Target, $SshArgs, $Script) @($failLine, 'RECORDED an older copy') }
  $threw = ''
  try { Restore-SwapRecord 'nobody@nowhere' @() 'C:/Thornswood-Site' @() '' 'site' 6>$null } catch { $threw = $_.Exception.Message }
  Yes 'Restore-SwapRecord: a failed lock on the store stops it, naming the lock' ($threw -match 'lock')

  # Setup-Domain sends its whole Caddy block at once and only prints what came
  # back, so its check is read: what Remote said for that block goes through
  # the shared check before anything else.
  $sd = [IO.File]::ReadAllText((Join-Path $Repo 'scripts/deploy/Setup-Domain.ps1'))
  $at = $sd.IndexOf('$(Get-ThornswoodLockedFolderScript $caddyWin)')
  $after = if ($at -ge 0) { $sd.Substring($at) } else { '' }
  $end = $after.IndexOf("`n" + '"@')
  $tail = if ($end -ge 0) { $after.Substring($end, [Math]::Min(600, $after.Length - $end)) } else { '' }
  Yes 'Setup-Domain: what the Caddy block said goes through Get-ThornswoodLockFailure, and a failed lock throws' ($tail -match 'Get-ThornswoodLockFailure' -and $tail -match 'throw')
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -EA SilentlyContinue
}
Write-Host ''
Write-Host ("$script:pass passed, $script:fail failed")
if ($script:fail) { exit 1 }
