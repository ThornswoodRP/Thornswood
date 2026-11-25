<#
  test-setup-discord-empty-hook.ps1

  Setup-Discord.ps1 ends by handing bot\news-webhook.txt to Discord-Hook.ps1
  -Save. An empty file read back as $null and .Trim() threw on it. This runs
  only that tail, cut out of the real script, in a temp copy of the layout:
  scripts\deploy, the real scripts\ops\Discord-Hook.ps1 and the real
  scripts\vps\Send-Secret.ps1, Send-Script.ps1 and Vps.ps1 (functions only), with scripts\vps\Remote.ps1 swapped for a stub
  that writes down that it was called and contacts nothing. No Python, no
  token, no network, no webhook.

  What it proves:
    an empty file: no throw, says it is empty, nothing reaches the VPS stub
    a whitespace-only file: the same
    a missing file: the old "no webhook was made" lines, nothing sent
    a file that is not a webhook address: Discord-Hook.ps1 refuses it,
      the tail says it is not on the VPS, nothing reaches the stub
    a leftover file under -Check: says the file is there, leaves it untouched (#4226)
    a leftover file under -Only: exits without saving, leaves it untouched (#4226)
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$RepoDir = Split-Path -Parent $Here
$ps = (Get-Process -Id $PID).Path

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$src = [IO.File]::ReadAllText((Join-Path $RepoDir 'scripts\deploy\Setup-Discord.ps1'))
$at = $src.IndexOf('$hook = Join-Path $Here')
Yes 'the webhook hand-over is where it was in Setup-Discord.ps1' ($at -gt 0)

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-setup-discord-' + [Guid]::NewGuid().ToString('N'))
try {
    $dep = Join-Path $work 'scripts\deploy'; $ops = Join-Path $work 'scripts\ops'; $vps = Join-Path $work 'scripts\vps'; $bot = Join-Path $work 'bot'
    New-Item -ItemType Directory -Force -Path $dep, $ops, $vps, $bot | Out-Null
    Copy-Item -LiteralPath (Join-Path $RepoDir 'scripts\ops\Discord-Hook.ps1') -Destination $ops
    foreach ($f in @(Get-ChildItem -LiteralPath (Join-Path $RepoDir 'scripts\vps') -Filter '*.ps1' | Where-Object { $_.Name -in 'Send-Secret.ps1', 'Send-Script.ps1', 'Vps.ps1' })) { Copy-Item -LiteralPath $f.FullName -Destination $vps }
    $called = Join-Path $work 'remote-called.txt'
    $stub = "param([Parameter(ValueFromRemainingArguments=`$true)]`$rest)`r`n[IO.File]::AppendAllText('" + $called.Replace("'", "''") + "', 'called`r`n')`r`nexit 1`r`n"
    [IO.File]::WriteAllText((Join-Path $vps 'Remote.ps1'), $stub)
    $tail = "param([switch]`$Check, [string[]]`$Only = @())`r`n`$ErrorActionPreference = 'Stop'`r`n`$Here = `$PSScriptRoot`r`n`$code = 0`r`n" + $src.Substring($at)
    $tailPath = Join-Path $dep 'Setup-Discord-tail.ps1'
    [IO.File]::WriteAllText($tailPath, $tail, (New-Object Text.UTF8Encoding($true)))
    $hookFile = Join-Path $bot 'news-webhook.txt'

    function RunTail([string[]]$TailArgs = @()) {
        Remove-Item -LiteralPath $called -Force -ErrorAction SilentlyContinue
        $ErrorActionPreference = 'Continue'
        $said = @(& $ps -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $tailPath @TailArgs 2>&1 | ForEach-Object { "$_" })
        $rc = $LASTEXITCODE
        return @{ Said = ($said -join "`n"); Code = $rc; Sent = (Test-Path -LiteralPath $called) }
    }

    foreach ($case in @(@{ Name = 'empty'; Bytes = [byte[]]@() }, @{ Name = 'whitespace-only'; Bytes = [Text.Encoding]::ASCII.GetBytes("  `r`n") })) {
        [IO.File]::WriteAllBytes($hookFile, $case.Bytes)
        $r = RunTail
        Yes ("$($case.Name) file: no throw, exit 0 (got $($r.Code))") ($r.Code -eq 0 -and $r.Said -notmatch 'null-valued|empty string|Exception')
        Yes ("$($case.Name) file: says the file is empty") ($r.Said -match 'news-webhook\.txt is empty')
        Yes ("$($case.Name) file: nothing reached the VPS stub") (-not $r.Sent)
        if ($script:fail) { Write-Host $r.Said }
    }

    Remove-Item -LiteralPath $hookFile -Force
    $r = RunTail
    Yes "missing file: exit 0 (got $($r.Code))" ($r.Code -eq 0)
    Yes 'missing file: says no webhook was made' ($r.Said -match 'no webhook was made')
    Yes 'missing file: nothing reached the VPS stub' (-not $r.Sent)

    [IO.File]::WriteAllText($hookFile, 'not a webhook at all')
    $r = RunTail
    Yes 'not an address: Discord-Hook.ps1 refuses it' ($r.Said -match 'not a Discord webhook address')
    Yes 'not an address: the tail says it is not on the VPS' ($r.Said -match 'not on the VPS')
    Yes 'not an address: nothing reached the VPS stub' (-not $r.Sent)

    # Leftover webhook file from an earlier run (#4226)
    $validHook = 'https://discord.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz'
    [IO.File]::WriteAllText($hookFile, $validHook)

    $r = RunTail -TailArgs @('-Check')
    Yes '-Check with leftover file: exit 0' ($r.Code -eq 0)
    Yes '-Check with leftover file: says the file is there' ($r.Said -match 'news-webhook\.txt is there')
    Yes '-Check with leftover file: nothing reached the VPS stub' (-not $r.Sent)
    Yes '-Check with leftover file: leaves file untouched' ((Test-Path -LiteralPath $hookFile) -and [IO.File]::ReadAllText($hookFile) -eq $validHook)

    $r = RunTail -TailArgs @('-Only', 'Gamemasters')
    Yes '-Only with leftover file: exit 0' ($r.Code -eq 0)
    Yes '-Only with leftover file: nothing reached the VPS stub' (-not $r.Sent)
    Yes '-Only with leftover file: leaves file untouched' ((Test-Path -LiteralPath $hookFile) -and [IO.File]::ReadAllText($hookFile) -eq $validHook)

    Remove-Item -LiteralPath $hookFile -Force
    $r = RunTail -TailArgs @('-Check')
    Yes '-Check without file: exit 0' ($r.Code -eq 0)
    Yes '-Check without file: nothing reached the VPS stub' (-not $r.Sent)
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }
exit 0