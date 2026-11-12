<#
  Invoke-Said.ps1

      . .\scripts\release\Invoke-Said.ps1
      Invoke-Said "vpk pack for $ch" { & $vpk pack ... }
      if ($LASTEXITCODE -ne 0) { exit 1 }

  Runs a command, prints every line it writes as it comes, as before, and
  when it ends with an exit code other than 0, writes one ::error line
  carrying the command's own reason: its last lines that say an error, or
  its last lines when none does (#5765). $LASTEXITCODE is the command's.

  WHY. Merge release run 121 (job 130005007520) failed in "Pack the launcher
  and the game files with Velopack" with the one annotation "vpk pack for
  dev failed; the lines above say why". The lines above were in the job log
  alone, which is too big for a Bot to read (Ops #266), so the reason could
  be read only by someone who opened the log. The annotation is what the
  checks page and the API's annotations show, so the reason goes there, as
  a failed harness's FAIL lines do (scripts\dev\Nightly-Harnesses.ps1,
  Get-FailSaid, #5660).

  At most SAID_LINES lines of at most SAID_LINE_CHARS each, read from the
  last SAID_KEPT lines the command wrote. A workflow command's message takes
  %0A for a new line and % itself as %25. tests\test-5765-pack-reason.ps1
  holds it.
#>
$SAID_LINES = 10
$SAID_LINE_CHARS = 300
$SAID_KEPT = 400
# A line that says an error: vpk's [ERR] and its Error:, MSBuild's and
# dotnet's "error XX1234:", an exception, "failed", "could not", "cannot",
# "unable to", "not found".
$SAID_ERROR = '(?i)\[(ERR|FTL)\]|\b(ERR|FTL)\b\]?|\berror\b|\bexception\b|\bfail(ed|s|ure)?\b|\bfatal\b|could not|cannot|can''t|unable to|not found'

function Get-SaidReason([string[]]$Lines) {
    $lines = @($Lines | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
    if (-not $lines.Count) { return ': it printed nothing' }
    $why = @($lines | Where-Object { $_ -match $SAID_ERROR })
    $head = 'its error lines'
    if (-not $why.Count) { $why = $lines; $head = 'no error line; its last lines' }
    $more = $why.Count - $SAID_LINES
    $show = @($why | Select-Object -Last $SAID_LINES | ForEach-Object {
        if ($_.Length -gt $SAID_LINE_CHARS) { $_.Substring(0, $SAID_LINE_CHARS) + '...' } else { $_ }
    })
    if ($more -gt 0) { $head += (', the last {0} of {1}' -f $SAID_LINES, $why.Count) }
    $text = ': ' + $head + "`n" + ($show -join "`n")
    return $text.Replace('%', '%25').Replace("`r", '%0D').Replace("`n", '%0A')
}

function Invoke-Said([string]$What, [scriptblock]$Run) {
    $kept = [System.Collections.Generic.Queue[string]]::new()
    $global:LASTEXITCODE = 0
    & $Run 2>&1 | ForEach-Object {
        $s = "$_"
        Write-Host $s
        foreach ($l in ($s -split "`r?`n")) {
            $kept.Enqueue($l)
            if ($kept.Count -gt $SAID_KEPT) { $null = $kept.Dequeue() }
        }
    }
    $code = $LASTEXITCODE
    if ($code -ne 0) { Write-Host ('::error::' + $What.Replace('%', '%25') + ' failed (exit ' + $code + ')' + (Get-SaidReason @($kept))) }
    $global:LASTEXITCODE = $code
}
