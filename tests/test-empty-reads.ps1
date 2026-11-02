<#
  test-empty-reads.ps1

      powershell -NoProfile -File .\tests\test-empty-reads.ps1
      pwsh -NoProfile -File .\tests\test-empty-reads.ps1

  Get-Content -Raw hands back $null for an empty file, not '', so
  (Get-Content x -Raw).Trim() throws "You cannot call a method on a
  null-valued expression", and under Stop that ends the script before the
  message written for an empty file. Each case puts an empty file where a
  script reads one:
    Restore-Backup.ps1 and vps-nightly-backup.ps1  the passphrase file
    Set-DevNews.ps1 -Check                         bot\dev-channel.txt
    Discord-Hook.ps1 -Check                        the local webhook copy
    Source-Notice.ps1 Get-SourceNoticeEntries      client-build.json, and the
                                                   front record the setup's
                                                   note reads (Build-SetupFiles)
  Scratch folders and scratch copies only; the VPS is a stub that answers
  NOHOOK, and nothing reaches the network.
#>
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$Shell = (Get-Process -Id $PID).Path
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-empty-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
[void][IO.Directory]::CreateDirectory($T)
function Empty([string]$p) { [void][IO.Directory]::CreateDirectory((Split-Path -Parent $p)); [IO.File]::WriteAllBytes($p, [byte[]]@()); return $p }
function Child([string[]]$a) {
    $ErrorActionPreference = 'Continue'
    $o = & $Shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File @a 2>&1 | Out-String
    return @{ Code = $LASTEXITCODE; Out = $o }
}
$null_ = 'null-valued'
try {
    # ---- the passphrase files ----------------------------------------------------
    $key = Empty (Join-Path $T 'key.txt')
    $enc = Join-Path $T 'backup.enc'; [IO.File]::WriteAllBytes($enc, [byte[]](1..64))
    $r = Child @((Join-Path $Repo 'scripts\vps\Restore-Backup.ps1'), '-Backup', $enc, '-KeyFile', $key, '-Work', (Join-Path $T 'work'), '-NoPause')
    Yes 'Restore-Backup: an empty passphrase file says it is empty' ($r.Code -eq 1 -and $r.Out -match 'passphrase file at .* is empty' -and $r.Out -notmatch $null_)
    $out = Join-Path $T 'backup-out'
    $r = Child @((Join-Path $Repo 'scripts\vps\vps-nightly-backup.ps1'), '-KeyFile', $key, '-Out', $out)
    Yes 'vps-nightly-backup: an empty passphrase file says it is empty' ($r.Code -ne 0 -and $r.Out -match 'backup passphrase file is empty' -and $r.Out -notmatch $null_)
    Yes '  and makes no archive folder' (-not (Test-Path -LiteralPath $out))

    # ---- Set-DevNews -Check, from a scratch copy ----------------------------------
    $sd = Join-Path $T 'sd'
    [void][IO.Directory]::CreateDirectory((Join-Path $sd 'scripts\ops'))
    [IO.File]::Copy((Join-Path $Repo 'scripts\ops\Set-DevNews.ps1'), (Join-Path $sd 'scripts\ops\Set-DevNews.ps1'))
    $null = Empty (Join-Path $sd 'bot\dev-channel.txt')
    $r = Child @((Join-Path $sd 'scripts\ops\Set-DevNews.ps1'), '-Check', '-NoPause')
    Yes 'Set-DevNews -Check: an empty dev-channel.txt reads as no channel id' ($r.Out -match 'no channel id in bot' -and $r.Out -notmatch $null_)

    # ---- Discord-Hook -Check, from a scratch copy, VPS stubbed -------------------
    $dh = Join-Path $T 'dh'
    foreach ($d in 'scripts\ops', 'scripts\vps') { [void][IO.Directory]::CreateDirectory((Join-Path $dh $d)) }
    [IO.File]::Copy((Join-Path $Repo 'scripts\ops\Discord-Hook.ps1'), (Join-Path $dh 'scripts\ops\Discord-Hook.ps1'))
    foreach ($f in 'Send-Secret.ps1', 'Send-Script.ps1', 'Vps.ps1') { [IO.File]::Copy((Join-Path $Repo "scripts\vps\$f"), (Join-Path $dh "scripts\vps\$f")) }
    $stub = Join-Path $dh 'remote-stub.ps1'
    [IO.File]::WriteAllText($stub, "param([string]`$Body, `$Secret)`n'NOHOOK'`nexit 0`n")
    $null = Empty (Join-Path $dh 'bot\dev-webhook.txt')
    $r = Child @((Join-Path $dh 'scripts\ops\Discord-Hook.ps1'), '-Name', 'dev', '-Check', '-RemoteScript', $stub)
    Yes 'Discord-Hook -Check: an empty local copy reads as no webhook' ($r.Code -eq 0 -and $r.Out -match 'no dev webhook on the VPS yet' -and $r.Out -notmatch $null_)

    # ---- the build records ---------------------------------------------------------
    . (Join-Path $Repo 'scripts\release\Source-Notice.ps1')
    $client = Empty (Join-Path $T 'records\client-build.json')
    $one = [string]@($SourceNoticeFiles.Keys)[0]
    $threw = ''
    try { $null = Get-SourceNoticeEntries $client @($one) 'runtime' (Join-Path $T 'lic') } catch { $threw = $_.Exception.Message }
    Yes ("Source-Notice: an empty client-build.json is named as empty ({0})" -f $threw) ($threw -eq "$client is empty")
    [IO.File]::WriteAllText($client, "  `r`n")
    $threw = ''
    try { $null = Get-SourceNoticeEntries $client @($one) 'runtime' (Join-Path $T 'lic') } catch { $threw = $_.Exception.Message }
    Yes '  and so is one holding only white space' ($threw -eq "$client is empty")

    # The setup's note (kind setup) reads front-build.json beside the client
    # record as well, the way Build-SetupFiles.ps1 passes it. Until #4824 the
    # old installer's Get-SourceNotice read the two build records here.
    [IO.File]::Copy((Join-Path $Repo 'records\client-build.json'), $client, $true)
    $front = Empty (Join-Path $T 'records\front-build.json')
    $threw = ''
    try { & { Set-StrictMode -Version Latest; $ErrorActionPreference = 'Stop'; $null = Get-SourceNoticeEntries $client @('Data\Platform\UI\build.js') 'setup' (Join-Path $T 'lic') $front } } catch { $threw = $_.Exception.Message }
    Yes ("Source-Notice, the setup's note: an empty front record is named as empty ({0})" -f $threw) ($threw -eq "$front is empty")
    [IO.File]::WriteAllBytes($client, [byte[]]@())
    $threw = ''
    try { & { Set-StrictMode -Version Latest; $ErrorActionPreference = 'Stop'; $null = Get-SourceNoticeEntries $client @('Data\Platform\UI\build.js') 'setup' (Join-Path $T 'lic') $front } } catch { $threw = $_.Exception.Message }
    Yes ("  and so is an empty client record before it ({0})" -f $threw) ($threw -eq "$client is empty")
}
finally { Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }