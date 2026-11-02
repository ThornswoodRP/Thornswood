<#
  test-capture-443.ps1

      pwsh -NoProfile -File .\tests\test-capture-443.ps1

  Issues #2970 and #2946. scripts\vps\vps-capture-443.ps1 is the #2946
  packet capture as a reviewed file, sent to the box by Remote.ps1 -File, in
  place of lines typed into a shell there. This proves, without the box:

    1. it parses under pwsh, which is what runs it on the box;
    2. it does nothing unless told exactly one of -Start, -Status, -Stop,
       and takes no capture longer than 30 minutes;
    3. it keeps only TCP SYN and RST on port 443, 128 bytes a packet, in a
       circular file of at most 64 MB, at the card, in a folder of its own
       inside the watchdog's and never in the box's temp folder (#3017);
    4. it never holds the ssh session for the capture: no sleep, and the end
       is a one-shot task that stops pktmon, removes the filters, writes the
       text form and deletes itself;
    5. it refuses to start over its own running capture or over filters it
       did not add, since the end removes every filter.

  Reads only; the runs in 2 stop before anything reaches pktmon.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
$script = Join-Path (Join-Path (Join-Path $repo 'scripts') 'vps') 'vps-capture-443.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$t = [IO.File]::ReadAllText($script)

# ---- 1. it parses ------------------------------------------------------------
$errs = $null
[void][System.Management.Automation.Language.Parser]::ParseInput($t, [ref]$null, [ref]$errs)
Yes 'it parses under pwsh' (-not ($errs -and $errs.Count))

# ---- 2. one thing at a time, and a limit -----------------------------------------
function Run([string[]]$a) {
    $said = @(& pwsh -NoProfile -NonInteractive -File $script @a 2>&1 | ForEach-Object { "$_" }) -join "`n"
    return @{ Code = $LASTEXITCODE; Said = $said }
}
$r = Run @()
Yes "told nothing, it refuses and changes nothing (exit $($r.Code))" ($r.Code -eq 1 -and $r.Said -match '^REFUSED say one of -Start, -Status or -Stop')
$r = Run @('-Start', '-Stop')
Yes "told two things, it refuses (exit $($r.Code))" ($r.Code -eq 1 -and $r.Said -match '^REFUSED say one of')
$r = Run @('-Start', '-Minutes', '31')
Yes "a capture over 30 minutes is not taken (exit $($r.Code))" ($r.Code -ne 0 -and $r.Said -notmatch 'STARTED')
Yes '  and the limit is the parameter''s own range' ($t -match '\[ValidateRange\(1, 30\)\]\[int\]\$Minutes = 15')

# ---- 3. what it keeps ----------------------------------------------------------------
Yes 'it filters TCP SYN on 443' ($t -match "pktmon filter add \`$Filters\[0\] -t TCP SYN -p 443")
Yes '  and TCP RST on 443, and nothing else' ($t -match "pktmon filter add \`$Filters\[1\] -t TCP RST -p 443" -and ([regex]::Matches($t, 'pktmon filter add')).Count -eq 2)
Yes '  at the network card, 128 bytes a packet, circular, at most 64 MB' ($t -match 'pktmon start --capture --comp nics --pkt-size 128 --file-name \$Etl --file-size 64 --log-mode circular')
Yes '  into C:\Thornswood-Watch\capture-443\capture.etl, and its text form beside it' ($t -match "\`$Etl = 'C:\\Thornswood-Watch\\capture-443\\capture\.etl'" -and $t -match "\`$Txt = 'C:\\Thornswood-Watch\\capture-443\\capture\.txt'")
Yes '  never in the box''s temp folder, which is one run''s scratch (#3017)' ($t -notmatch "(?im)^[^#]*'C:\\Windows\\Temp")
Yes '  it refuses on a box without the watchdog''s folder, before pktmon is touched' ($t -match "(?s)if \(-not \(Test-Path -LiteralPath \`$Watch -PathType Container\)\) \{ 'REFUSED the watchdog''s folder.*?& pktmon filter remove \| Out-Null")
Yes '  and makes only its own folder, inside the watchdog''s, whose rules it takes' ($t -match "\`$Dir = 'C:\\Thornswood-Watch\\capture-443'" -and $t -match "if \(-not \(Test-Path -LiteralPath \`$Dir\)\) \{ \`$null = New-Item -ItemType Directory -Path \`$Dir \}" -and ([regex]::Matches($t, 'New-Item')).Count -eq 1)

# ---- 4. it never waits ------------------------------------------------------------------
Yes 'it never sleeps through the capture over ssh' ($t -notmatch '(?m)^[^#]*\bStart-Sleep\b')
Yes '  the end is a one-shot task at the end time, run as SYSTEM' ($t -match 'New-ScheduledTaskTrigger -Once -At \$at' -and $t -match "New-ScheduledTaskPrincipal -UserId 'SYSTEM'")
Yes '  which stops pktmon, removes the filters and writes the text form' ($t -match "\`$End = 'pktmon stop & pktmon filter remove & pktmon etl2txt")
Yes '  and deletes itself' ($t -match "' & schtasks /delete /tn `"' \+ \`$Task \+ '`" /f'")
Yes '  -Stop ends it at once and takes the task away' ($t -match '(?s)if \(\$Stop\) \{.*?Unregister-ScheduledTask -TaskName \$Task.*?cmd\.exe /c \$End')

# ---- 5. what it will not start over ------------------------------------------------------
Yes 'it refuses to start over its own running capture' ($t -match "(?m)^if \(Get-Ours\) \{ 'REFUSED a capture is already running")
Yes '  and over pktmon filters it did not add' ($t -match "'REFUSED pktmon has filters this script did not add")
Yes '  and when pktmon will not start, it takes its filters away again' ($t -match '(?s)if \(\$LASTEXITCODE -ne 0\) \{\s*& pktmon filter remove')

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
