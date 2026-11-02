<#
  test-remote-command-map.ps1

      pwsh -NoProfile -File .\tests\test-remote-command-map.ps1
      powershell -NoProfile -File .\tests\test-remote-command-map.ps1

  Every call under scripts\ that reaches the VPS is in
  records\remote-commands.json, with what it does and the class it needs: a
  gate verb (stage, swap, putback, feed-send, task-start-stop, read-status),
  admin, or transport (a helper that only carries what its caller hands it,
  where the caller is the row that counts). Issue #2182, section 5 step 1 of
  the ops repo's DEPLOY-IDENTITIES.md.

  WHY THIS EXISTS. Section 2 of that doc was first read off script names, not
  off the commands each script sends. A deploy identity built from a list like
  that either breaks (a deploy path sends something only admin may do) or is
  given more than any script uses. The record is the checked list, and this
  keeps it true: a new remote call with no row fails here, and so does a row
  whose call is gone.

  HOW. Parses every .ps1 and .psm1 under scripts\ with the PowerShell parser
  (tests\fixtures\remote-calls.ps1; comments and the text of scripts sent to
  the box are not commands, so they never count) and finds each command named
  ssh, scp, ssh-keyscan, Invoke-ThornswoodRemote,
  Invoke-ThornswoodSecretRemote, Invoke-ThornswoodArtifactRemote,
  Send-ThornswoodArtifactFile, Start-ThornswoodRemote or Remote, and each call of Remote.ps1 by path.

  A ROW NAMES ITS CALL BY TEXT, NOT BY PLACE (#2498). A row is script, the
  function the call sits in (<top> outside one), the command, and an anchor:
  text from the call's own lines, or from the few lines above it when several
  calls in that function send the same text. Until #2498 a row carried the
  call's number among its script's calls instead, so a call put in ahead of
  others moved every later row onto the wrong call (#2471, #2500) and only a
  renumbering by hand, which nothing checked, put them back. Now an anchor
  that names no call, or more than one, fails here, and so does a call that
  no row names or that two rows name. A call put in anywhere fails by name
  until it has a row, and every other row stays on its own call. The record
  keeps no count of its scripts or calls (#5191): that one-to-one check
  already holds them, and a count was a line every pull request with a new
  remote call changed, so two of them always conflicted. Nothing is run and
  nothing leaves this machine.
#>
[CmdletBinding()]
param([string]$Record)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
if (-not $Record) { $Record = Join-Path $Repo 'records\remote-commands.json' }
. (Join-Path $Repo 'tests\fixtures\remote-calls.ps1')

$pass = 0; $fail = 0
function Ok([bool]$cond, [string]$what) {
    if ($cond) { $script:pass++ } else { $script:fail++; Write-Host ('FAIL ' + $what) -ForegroundColor Red }
}

$classes = @('stage', 'swap', 'putback', 'feed-send', 'task-start-stop', 'read-status', 'admin', 'transport')

# Holds rows to calls. Returns the problems, one string each.
function Get-MapProblems($Calls, $Rows) {
    $out = New-Object System.Collections.Generic.List[string]
    $named = @{}
    foreach ($r in @($Rows)) {
        $key = [string]$r.script + '|' + [string]$r.scope + '|' + [string]$r.via
        $anchor = [string]$r.anchor
        if (-not $anchor.Trim()) { $out.Add($key + ' has no anchor'); continue }
        $m = @(Find-RemoteCallsByAnchor $Calls $key $anchor)
        if ($m.Count -eq 0) { $out.Add($key + ' anchor names no call: ' + $anchor); continue }
        if ($m.Count -gt 1) { $out.Add($key + ' anchor names ' + $m.Count + ' calls (lines ' + (($m | ForEach-Object { $_.Line }) -join ', ') + '): ' + $anchor); continue }
        $id = $m[0].Key + '@' + $m[0].Line
        if ($named.ContainsKey($id)) { $out.Add($key + ' line ' + $m[0].Line + ' is named by two rows: ' + $named[$id] + ' and ' + $anchor) }
        else { $named[$id] = $anchor }
    }
    foreach ($c in $Calls) {
        if (-not $named.ContainsKey($c.Key + '@' + $c.Line)) { $out.Add('remote call not in the record: ' + $c.Key + ' at line ' + $c.Line + ': ' + (($c.Own | Select-Object -First 1) -as [string]).Trim()) }
    }
    return , $out
}

$calls = Get-RemoteCalls $Repo
Ok ($calls.Count -gt 0) 'the scan found no remote calls at all, so the scan itself is broken'

if (-not (Test-Path -LiteralPath $Record)) {
    Ok $false ('there is no record at ' + $Record + '; every remote call is unmapped (' + $calls.Count + ')')
} else {
    $doc = Get-Content -LiteralPath $Record -Raw | ConvertFrom-Json
    $rows = @($doc.calls)
    foreach ($r in $rows) {
        $k = $r.script + '|' + $r.scope + '|' + $r.via + ' (' + $r.anchor + ')'
        Ok ($null -eq $r.PSObject.Properties['n']) ($k + ' still carries a position number, which #2498 took out')
        Ok ($classes -contains $r.class) ($k + ' has class ' + $r.class + ', not one of ' + ($classes -join ', '))
        Ok ([bool]([string]$r.does).Trim()) ($k + ' says nothing about what it does')
        Ok ([bool]([string]$r.reason).Trim()) ($k + ' gives no reason for its class')
    }
    $problems = Get-MapProblems $calls $rows
    foreach ($p in $problems) { Ok $false $p }
    Ok ($problems.Count -eq 0) 'every row names exactly one call and every call exactly one row'
    # No totals in the record (#5191): the check above already holds every
    # call to one row and every row to one call, and a count beside them was
    # the one line every pull request that adds or takes away a remote call
    # changed, so any two of them conflicted in the merge queue.
    $totals = @('scriptCount', 'callCount' | Where-Object { $null -ne $doc.PSObject.Properties[$_] })
    Ok ($totals.Count -eq 0) ('the record carries no totals, which two pull requests would both change' + $(if ($totals) { ': it has ' + ($totals -join ', ') } else { '' }))
}

# ---- planted: a call put in ahead of others moves no row (#2498) -------------
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('remote-map-' + [guid]::NewGuid().ToString('n'))
try {
    $dir = Join-Path $tmp 'scripts'
    [void][IO.Directory]::CreateDirectory($dir)
    $f = Join-Path $dir 'Planted.ps1'
    $before = "function Remote(`$s) { }`r`n# stop the site`r`nRemote @`"`r`nStop-It`r`n`"@`r`n# read the log`r`nRemote @`"`r`nRead-It`r`n`"@`r`n"
    [IO.File]::WriteAllText($f, $before)
    $c1 = Get-RemoteCalls $tmp
    $planted = @(
        [pscustomobject]@{ script = 'scripts/Planted.ps1'; scope = '<top>'; via = 'Remote'; anchor = 'Stop-It'; does = 'stops'; class = 'admin'; reason = 'x' },
        [pscustomobject]@{ script = 'scripts/Planted.ps1'; scope = '<top>'; via = 'Remote'; anchor = 'Read-It'; does = 'reads'; class = 'read-status'; reason = 'x' })
    Ok ((Get-MapProblems $c1 $planted).Count -eq 0) 'planted: two calls sending the same opening line are each named by their own text'
    [IO.File]::WriteAllText($f, $before.Replace("# stop the site", "Remote 'New-It'`r`n# stop the site"))
    $c2 = Get-RemoteCalls $tmp
    $p2 = Get-MapProblems $c2 $planted
    Ok ($p2.Count -eq 1 -and $p2[0] -like 'remote call not in the record:*New-It*') ('planted: a call put in first fails by name, alone (' + ($p2 -join ' / ') + ')')
    $stop = @(Find-RemoteCallsByAnchor $c2 'scripts/Planted.ps1|<top>|Remote' 'Stop-It')
    Ok ($stop.Count -eq 1 -and ($stop[0].Own -join "`n").Contains('Stop-It')) 'planted: and the row that named the stop call still names the stop call'
    $dup = @($planted[0], $planted[0])
    Ok (@(Get-MapProblems $c1 $dup | Where-Object { $_ -like '*named by two rows*' }).Count -eq 1) 'planted: two rows on one call fail'
    $gone = @([pscustomobject]@{ script = 'scripts/Planted.ps1'; scope = '<top>'; via = 'Remote'; anchor = 'Gone-It' })
    Ok (@(Get-MapProblems $c1 $gone | Where-Object { $_ -like '*names no call*' }).Count -eq 1) 'planted: an anchor whose call is gone fails'
    $wide = @([pscustomobject]@{ script = 'scripts/Planted.ps1'; scope = '<top>'; via = 'Remote'; anchor = '-It' })
    Ok (@(Get-MapProblems $c1 $wide | Where-Object { $_ -like '*names 2 calls*' }).Count -eq 1) 'planted: an anchor that names two calls fails'
} finally {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
}

Write-Host ('{0} passed, {1} failed' -f $pass, $fail)
if ($fail) { exit 1 }
exit 0