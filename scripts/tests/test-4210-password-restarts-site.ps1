<#
  test-4210-password-restarts-site.ps1

  Issue #4210. The site reads its config.json once, when it starts
  (site\lib\config.js). Deploy-Docs.ps1 -Password writes the new member
  password into that file, but with nothing in the app to swap it restarted
  the site only when the site's account had changed (OWNER NEW, #4077). So
  a -Password on its own said the password was set and left the site running
  on the old one.

  This takes the part of Deploy-Docs.ps1 that decides whether the site is
  restarted (from the end of the site hooks to the swap) out of the real
  script and runs it in a child pwsh, with the box stood in: Remote records
  what it was sent and answers as the box would. Nothing leaves this machine.

    1  -Password, nothing in the app to swap: the site is restarted, and the
       line says it is for the password
    2  and a restart the box says did not come back ends 1
    3  nothing in the app, no -Password, same account: left running
    4  nothing in the app, a new account (#4077): restarted, as before
    5  -Password with an app change: the swap restarts it, not this
    6  -Password with -PutBack: the swap restarts it, not this
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$pass = 0; $fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}

$docs = [IO.File]::ReadAllText((Join-Path $Repo 'scripts\deploy\Deploy-Docs.ps1'.Replace('\', [IO.Path]::DirectorySeparatorChar)))
$from = $docs.IndexOf('# ==== end thornswood site hooks ====')
$to = $docs.IndexOf('if ($PutBack -or -not $appUnchanged) {')
Yes 'Deploy-Docs.ps1 has the restart decision between the site hooks and the swap' ($from -gt 0 -and $to -gt $from)
if ($from -le 0 -or $to -le $from) { Write-Host "`n$pass passed, $fail failed"; exit 1 }
$part = $docs.Substring($from, $to - $from)

$work = Join-Path ([IO.Path]::GetTempPath()) ('tw-4210-restart-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null

# Runs the part with the variables Deploy-Docs has set by then, and the box
# stood in. Returns the exit code, what it printed, and every script it sent.
function Run([hashtable]$v, [string]$boxSays) {
    $sent = Join-Path $work 'sent.txt'
    Remove-Item -LiteralPath $sent -Force -EA SilentlyContinue
    $head = @"
`$ErrorActionPreference = 'Stop'
`$Password = `$$($v.Password)
`$PutBack = `$$($v.PutBack)
`$appUnchanged = `$$($v.AppUnchanged)
`$ownerNew = `$$($v.OwnerNew)
`$owner = 'S-1-5-87-1'
`$rootWin = 'C:\Thornswood-Docs'
`$Root = 'C:/Thornswood-Docs'
`$Wait = 30
`$Task = 'Thornswood Docs'
`$Port = 3001
`$siteAccountHelpers = ''
`$siteHooks = ''
`$ThornswoodHoldText = ''
`$ThornswoodStopAndMoveText = ''
function Get-ThornswoodHoldBy([string]`$s) { 'test' }
function Remote([string]`$script) {
  [IO.File]::AppendAllText('$($sent.Replace("'", "''"))', `$script + "`n==== SENT ====`n")
  foreach (`$l in @($(($boxSays -split "`n" | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }) -join ', '))) { `$l }
}
"@
    $file = Join-Path $work 'run.ps1'
    [IO.File]::WriteAllText($file, $head + "`n" + $part + "`nexit 0`n")
    $out = & pwsh -NoProfile -File $file 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE
    $scripts = @()
    if (Test-Path -LiteralPath $sent) { $scripts = @(([IO.File]::ReadAllText($sent) -split '==== SENT ====') | Where-Object { $_.Trim() }) }
    return [pscustomobject]@{ Code = $code; Out = ($out -join "`n"); Sent = $scripts }
}
function Restarted($r) { @($r.Sent | Where-Object { $_ -match '(?m)^StopIt\s*$' -and $_ -match '(?m)^StartIt\s*$' }).Count -eq 1 }

$ok = "PASS: the site answers on 3001`nRESTART OK"
try {
    Write-Host ''
    Write-Host '1. -Password, nothing in the app to swap:'
    $r = Run @{ Password = 'true'; PutBack = 'false'; AppUnchanged = 'true'; OwnerNew = 'false' } $ok
    Yes 'the site is restarted, so it reads the new password' (Restarted $r)
    Yes 'and the line says it is restarted for the password' ($r.Out -match 'password' -and $r.Out -match 'restarting it')
    Yes 'and it does not say the site was left running' ($r.Out -notmatch 'site left running')
    Yes 'and the watchdog hold it sets names the password as why' (@($r.Sent | Where-Object { $_.Contains("`$RestartWhy = 'the site reads its password only when it starts'") -and $_.Contains("-Why ('restarting the site: ' + `$RestartWhy)") }).Count -eq 1)
    Yes 'and it ends 0' ($r.Code -eq 0)

    Write-Host ''
    Write-Host '2. -Password, and the site does not come back:'
    $r = Run @{ Password = 'true'; PutBack = 'false'; AppUnchanged = 'true'; OwnerNew = 'false' } "FAIL: it did not answer within 30 seconds`nDOCS DID NOT START."
    Yes 'it ends 1' ($r.Code -eq 1)
    Yes 'and says the site did not answer after its restart' ($r.Out -match 'DID NOT ANSWER AFTER ITS RESTART')

    Write-Host ''
    Write-Host '3. nothing in the app, no -Password, the same account:'
    $r = Run @{ Password = 'false'; PutBack = 'false'; AppUnchanged = 'true'; OwnerNew = 'false' } $ok
    Yes 'nothing is sent and the site is left running' ($r.Sent.Count -eq 0 -and $r.Out -match 'site left running' -and $r.Code -eq 0)

    Write-Host ''
    Write-Host '4. nothing in the app, a new account (#4077):'
    $r = Run @{ Password = 'false'; PutBack = 'false'; AppUnchanged = 'true'; OwnerNew = 'true' } $ok
    Yes 'the site is restarted onto the launcher, as before' ((Restarted $r) -and $r.Out -match 'launcher' -and $r.Code -eq 0)

    Write-Host ''
    Write-Host '5. -Password with an app change:'
    $r = Run @{ Password = 'true'; PutBack = 'false'; AppUnchanged = 'false'; OwnerNew = 'false' } $ok
    Yes 'the swap restarts it, so nothing is sent here' ($r.Sent.Count -eq 0 -and $r.Out -match 'Stopping, swapping in and starting' -and $r.Code -eq 0)

    Write-Host ''
    Write-Host '6. -Password with -PutBack:'
    $r = Run @{ Password = 'true'; PutBack = 'true'; AppUnchanged = 'true'; OwnerNew = 'false' } $ok
    Yes 'the put-back restarts it, so nothing is sent here' ($r.Sent.Count -eq 0 -and $r.Out -match 'Putting back' -and $r.Code -eq 0)
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -EA SilentlyContinue
}

Write-Host "`n$pass passed, $fail failed"
if ($fail) { exit 1 }
exit 0
