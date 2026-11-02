<#
  test-script-index.ps1

      pwsh -NoProfile -File .\tests\test-script-index.ps1

  Ship.ps1 says every option it takes where Get-Help can read it, and
  scripts\README.md lists every script in this folder exactly as
  New-ScriptIndex.ps1 writes it.

  WHY THIS EXISTS. Entry 260 on the To Do List. MEASURED 24 SEPTEMBER:
  Get-Help .\scripts\release\Ship.ps1 -Full printed the syntax line and nothing else.
  Ship's header listed five options as if they were all of them, while its
  param block declared thirteen, and the one left out that mattered was
  -Channel, which the whole dev workflow runs on. There were 128 scripts in
  tools, six with a .SYNOPSIS, and nothing that listed them. The entry's
  words: "a list presented as complete is trusted as complete".

  WHY EVERY PARAMETER NEEDS ITS OWN .PARAMETER, and not merely some text in
  Get-Help. Ship's param block has comments in it, written in the leading
  comma style, so each comment sits after the parameter before the one it is
  about. Get-Help gives a comment to the parameter it follows. Measured on a
  copy of Ship.ps1 with the .PARAMETER lines taken out: -Root came out
  described as where releases are staged (the DistRoot comment), -MoveServer
  as the NoPause comment, -NoPause as the AnnounceMinutes one, -NoAnnounce as
  the Channel one, and -Channel with nothing at all. A check that only asked
  whether Get-Help printed something would pass that. So the help block is
  read directly, and each declared parameter must have a .PARAMETER there.
  Three things the help says are also read against the code, because text
  that is merely present can still be wrong: that a main release refuses
  -Version, that it refuses a file in a folder a release is built from that
  git does not know, and that a
  dry run closes a running game.

  The index half runs New-ScriptIndex.ps1 -Check against this folder, which
  is what keeps the list from falling behind, and then drives the generator
  in a temp folder to prove the check goes red when it should.

  Read only. Writes only into a temp folder, which it removes.
#>
[CmdletBinding()]
param([string]$ToolsPath)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
# The scripts, in scripts\<area> since phase 8 of issue #440.
if (-not $ToolsPath) { $ToolsPath = Join-Path $Here 'scripts' }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$Utf8 = New-Object Text.UTF8Encoding($false)
$Ship = Join-Path $ToolsPath 'release\Ship.ps1'
$Gen = Join-Path $ToolsPath 'dev\New-ScriptIndex.ps1'
$Readme = Join-Path $ToolsPath 'README.md'

# What the param block declares against what the help block documents, both
# read off the parse, never off Get-Help, for the reason at the top.
function Get-HelpGaps([string]$path) {
    $text = [IO.File]::ReadAllText($path, $Utf8)
    $tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($text, $path, [ref]$tokens, [ref]$errors)
    $declared = @()
    if ($ast.ParamBlock) { $declared = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath }) }
    $help = $ast.GetHelpContent()
    $documented = @()
    if ($help) {
        foreach ($k in $help.Parameters.Keys) {
            if (([string]$help.Parameters[$k]).Trim()) { $documented += $k.ToUpperInvariant() }
        }
    }
    $upper = @($declared | ForEach-Object { $_.ToUpperInvariant() })
    return [pscustomobject]@{
        Declared = $declared
        Missing  = @($declared | Where-Object { $documented -notcontains $_.ToUpperInvariant() })
        Stale    = @($documented | Where-Object { $upper -notcontains $_ })
        Help     = $help
        Errors   = @($errors)
    }
}

# ============================================================ Ship.ps1's help

Yes 'Ship.ps1 is there' (Test-Path -LiteralPath $Ship)
$gaps = Get-HelpGaps $Ship
Yes 'Ship.ps1 parses' ($gaps.Errors.Count -eq 0)
Yes ("its param block declares its parameters ({0} of them)" -f $gaps.Declared.Count) ($gaps.Declared.Count -ge 12)
Yes 'it has a help block PowerShell recognises' ($null -ne $gaps.Help)
Yes ('every declared parameter has a .PARAMETER of its own' +
     $(if ($gaps.Missing.Count) { ', missing: ' + ($gaps.Missing -join ', ') } else { '' })) ($gaps.Missing.Count -eq 0)
Yes ('no .PARAMETER names a parameter that is not declared' +
     $(if ($gaps.Stale.Count) { ', stale: ' + ($gaps.Stale -join ', ') } else { '' })) ($gaps.Stale.Count -eq 0)

# And Get-Help actually shows it, which is the whole point. A help block that
# a stray line has detached from the script parses perfectly and shows nothing.
$h = Get-Help $Ship -Full
$synopsis = ([string]$h.Synopsis).Trim()
Yes 'Get-Help prints a synopsis rather than the syntax line' (
    $synopsis -and $synopsis -notmatch 'Ship\.ps1 \[' -and $synopsis -notmatch '^Ship\.ps1')
$desc = (@($h.description) | ForEach-Object { $_.Text }) -join ' '
Yes 'and a description' ($desc.Trim().Length -gt 100)
$shown = @($h.parameters.parameter)
Yes ("and lists all {0} parameters" -f $gaps.Declared.Count) ($shown.Count -eq $gaps.Declared.Count)
$bare = @($shown | Where-Object { -not ((@($_.description) | ForEach-Object { $_.Text }) -join ' ').Trim() } |
          ForEach-Object { $_.name })
Yes ('every one of them with a description' + $(if ($bare.Count) { ', bare: ' + ($bare -join ', ') } else { '' })) ($bare.Count -eq 0)

# The one the dev workflow runs on, and the danger in it.
# With no help block at all, Get-Help refuses -Parameter outright, which is
# the failure this is looking for, so it is read as nothing said.
$channel = ''
try { $channel = (Get-Help $Ship -Parameter Channel -ErrorAction Stop | Out-String) } catch { $channel = '' }
Yes 'Get-Help -Parameter Channel names both channels' ($channel -match '\bmain\b' -and $channel -match '\bdev\b')
Yes 'and says the last dev Ship wins' ($channel -match '(?i)last dev ship wins')
Yes 'and says to check with the team before taking it, not to post in #staff-updates' ($channel -match '(?i)check with the team' -and $channel -notmatch '#staff-updates')
$examples = (@($h.examples.example) | ForEach-Object { $_.code }) -join "`n"
Yes 'there is an example of a dev release' ($examples -match '-Channel dev')

# The help has to agree with what the code does, not merely be there. On
# 24 Sep #253 made a main release refuse -Version and refuse a file under
# tools that git does not know, while this branch's help still said -Version
# wrote the number into Updater.cs for any release. Every check above passed
# on that, because each parameter had some text. So the two refusals a person
# is most likely to walk into are read off the code, and the help has to say
# each one exactly when the code does it, either way round.
$shipText = [IO.File]::ReadAllText($Ship, $Utf8)
$versionHelp = ''
try { $versionHelp = (Get-Help $Ship -Parameter Version -ErrorAction Stop | Out-String) } catch { $versionHelp = '' }
$versionHelp = $versionHelp -replace '\s+', ' '
$channelFlat = $channel -replace '\s+', ' '
$refusesVersion = $shipText -match '-not \$Dev -and \$Version -ne \$current'
$saysVersion = ($versionHelp -match '(?i)a main release refuses it') -and ($versionHelp -match 'LauncherVersion\.ps1')
Yes ('Get-Help -Parameter Version says a main release refuses it, exactly when the code does' +
     ' (code refuses: ' + $refusesVersion + ', help says: ' + $saysVersion + ')') ($refusesVersion -eq $saysVersion)
$refusesLoose = $shipText -match 'ls-files --others --exclude-standard -- @moreRoots'
$saysLoose = $channelFlat -match '(?i)a file in a folder a release is built from that git does not know'
Yes ('Get-Help -Parameter Channel names the refusal of a file git does not know in a folder a release is built from, exactly when the code does' +
     ' (code refuses: ' + $refusesLoose + ', help says: ' + $saysLoose + ')') ($refusesLoose -eq $saysLoose)

# A dry run must not close a running game and must not prune old packs
# (issue #494). Until then the help had to admit that Publish-Update still
# called Stop-Game on a dry run. Ship now passes it -NoClose (and KeepPacks 0)
# when -DryRun is set; help and the DryRun example must say a dry run does not
# close, matching that wiring. Ship installs no launcher since #4825.
$dryHelp = ''
try { $dryHelp = (Get-Help $Ship -Parameter DryRun -ErrorAction Stop | Out-String) } catch { $dryHelp = '' }
$dryHelp = $dryHelp -replace '\s+', ' '
$dryExample = (@($h.examples.example) | Where-Object { $_.code -match '-DryRun' } |
               ForEach-Object { (@($_.remarks) | ForEach-Object { $_.Text }) -join ' ' }) -join ' '
$dryExample = $dryExample -replace '\s+', ' '
$dryNoClose = ($shipText -match "(?s)\`$pubArgs\['NoClose'\]\s*=\s*\`$true") -and
              ($shipText -match "(?s)\`$pubArgs\['KeepPacks'\]\s*=\s*0")
$saysNoClose = ($dryHelp -match '(?i)does not\s+close a running game') -and
               ($dryExample -match '(?i)does not\s+close a running game') -and
               ($dryHelp -match '(?i)non-destructive for close')
Yes ('Ship -DryRun passes -NoClose and KeepPacks 0, and Get-Help says it does not close (#494)' +
     ' (code: ' + $dryNoClose + ', help: ' + $saysNoClose + ')') ($dryNoClose -and $saysNoClose)
Yes 'and nothing in it says a dry run leaves nothing behind' (
    ($dryHelp + ' ' + $dryExample) -notmatch '(?i)leaves nothing behind')

# Nothing about how Ship is called moved. Notes is mandatory at position 0,
# and every recorded command, the ops repo's CLAUDE.md's included, gives it first unnamed.
$cmd = Get-Command -Name $Ship
$notes = $cmd.Parameters['Notes']
$set = $null
if ($notes) { $set = $notes.ParameterSets['__AllParameterSets'] }
Yes 'Notes is still mandatory' ($set -and $set.IsMandatory)
Yes 'and still at position 0' ($set -and $set.Position -eq 0)
$positional = @($cmd.Parameters.Values | Where-Object {
    $s = $_.ParameterSets['__AllParameterSets']
    $s -and $s.Position -ge 0 -and $_.Name -ne 'Notes' } | ForEach-Object { $_.Name })
Yes ('and it is the only positional one' + $(if ($positional.Count) { ', also: ' + ($positional -join ', ') } else { '' })) ($positional.Count -eq 0)
$vs = @($cmd.Parameters['Channel'].Attributes | Where-Object { $_ -is [System.Management.Automation.ValidateSetAttribute] })
Yes 'Channel still takes main or dev and nothing else' (
    $vs.Count -eq 1 -and (@($vs[0].ValidValues) -join ',') -eq 'main,dev')

# ================================================= a new parameter goes red

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-index-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
    # A fourteenth parameter, added the way the last four were, with no help.
    $text = [IO.File]::ReadAllText($Ship, $Utf8)
    $tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($text, $Ship, [ref]$tokens, [ref]$errors)
    $close = $ast.ParamBlock.Extent.EndOffset - 1
    $grown = $text.Substring(0, $close) + "    ,[switch]`$Fourteenth`r`n" + $text.Substring($close)
    $copy = Join-Path $work 'Ship.ps1'
    [IO.File]::WriteAllText($copy, $grown, (New-Object Text.UTF8Encoding($true)))
    $g = Get-HelpGaps $copy
    Yes 'a parameter added without a .PARAMETER is caught' (
        $g.Errors.Count -eq 0 -and $g.Declared -contains 'Fourteenth' -and (@($g.Missing) -join ',') -eq 'Fourteenth')

    # And writing its help is what puts it right.
    $end = $grown.IndexOf('#>')
    $helped = $grown.Substring(0, $end) + ".PARAMETER Fourteenth`r`n  For the harness.`r`n" + $grown.Substring($end)
    [IO.File]::WriteAllText($copy, $helped, (New-Object Text.UTF8Encoding($true)))
    $g = Get-HelpGaps $copy
    Yes 'and its .PARAMETER puts it right' ($g.Errors.Count -eq 0 -and $g.Missing.Count -eq 0)

    # ======================================================== the index here

    Yes 'New-ScriptIndex.ps1 is there' (Test-Path -LiteralPath $Gen)
    # Everything below runs it, and a missing script is one FAIL, not a crash.
    if (-not (Test-Path -LiteralPath $Gen)) { throw 'no New-ScriptIndex.ps1, so the index was not checked' }
    Yes 'scripts\README.md is there' (Test-Path -LiteralPath $Readme)
    $global:LASTEXITCODE = 0
    & $Gen -Scripts $ToolsPath -Check
    Yes 'scripts\README.md is what New-ScriptIndex.ps1 writes (if not, run it and commit the file)' ($LASTEXITCODE -eq 0)

    $rows = @()
    if (Test-Path -LiteralPath $Readme) {
        $rows = @([IO.File]::ReadAllText($Readme, $Utf8) -split "\r?\n" | Where-Object { $_ -match '^\| \[' })
    }
    $rootFull = (Resolve-Path -LiteralPath $ToolsPath).Path.TrimEnd('\', '/')
    $scripts = @(Get-ChildItem -LiteralPath $ToolsPath -Filter '*.ps1' -File -Recurse |
                 Where-Object { $_.Extension -eq '.ps1' } |
                 ForEach-Object { $_.FullName.Substring($rootFull.Length + 1).Replace('\', '/') } |
                 Where-Object { $_ -notlike 'oneoff/*' })
    $listed = @($rows | ForEach-Object { if ($_ -match '^\| \[([^\]]+)\]') { $Matches[1] } })
    $unlisted = @($scripts | Where-Object { $listed -notcontains $_ })
    $some = @($unlisted | Select-Object -First 8)
    if ($unlisted.Count -gt $some.Count) { $some += ('and ' + ($unlisted.Count - $some.Count) + ' more') }
    Yes ("it has one row for each of the {0} scripts under scripts" -f $scripts.Count +
         $(if ($unlisted.Count) { ', not listed: ' + ($some -join ', ') } else { '' })) (
        $rows.Count -eq $scripts.Count -and $unlisted.Count -eq 0)
    $silent = @($rows | Where-Object { $_.Contains('Nothing at the top of this script says what it is for.') })
    Yes ('every script says what it is for' + $(if ($silent.Count) { ": `n      " + ($silent -join "`n      ") } else { '' })) ($silent.Count -eq 0)

    function Row([string]$name) {
        foreach ($r in $rows) {
            if ($r.StartsWith('| [' + $name + ']')) { return ($r -replace '^\| \[[^\]]+\]\([^)]+\) \| ', '' -replace ' \|$', '') }
        }
        return ''
    }
    Yes "Ship.ps1's row is its synopsis" (
        $gaps.Help -and (Row 'release/Ship.ps1') -and (Row 'release/Ship.ps1') -eq (($gaps.Help.Synopsis -replace '\s+', ' ').Trim()))
    Yes 'a name line with the purpose on it gives that purpose (Chargen-Log.ps1)' (
        (Row 'ops/Chargen-Log.ps1') -eq 'What the server thinks is happening to your character.')
    Yes 'and carries it on to the next line (Go.ps1)' (
        (Row 'release/Go.ps1') -eq 'Installs the front, the overlays and the plugins, then reports what the server is doing.')
    Yes 'usage lines at the top are passed over (Check-Build.ps1)' (
        (Row 'release/Check-Build.ps1') -and (Row 'release/Check-Build.ps1') -notmatch '^\.\\')
    Yes 'a header written in # lines is read too (Check-DevRosterSeed.ps1)' (
        (Row 'ops/Check-DevRosterSeed.ps1').StartsWith('Expand the roster seed here-string'))

    # ================================================== the check goes red

    $t = Join-Path $work 'scripts'
    New-Item -ItemType Directory -Path $t -Force | Out-Null
    foreach ($n in 'release\Ship.ps1', 'release\Go.ps1', 'mods\Check-Plugins.ps1') {
        Copy-Item -LiteralPath (Join-Path $ToolsPath $n) -Destination $t
    }
    $out = Join-Path $t 'README.md'

    $global:LASTEXITCODE = 0
    & $Gen -Scripts $t -Check 6>$null
    Yes 'no index at all is red' ($LASTEXITCODE -eq 1)

    & $Gen -Scripts $t 6>$null
    Yes 'writing it is fine' ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $out))
    & $Gen -Scripts $t -Check 6>$null
    Yes 'and then it is green' ($LASTEXITCODE -eq 0)

    [IO.File]::WriteAllText((Join-Path $t 'Add-Nothing.ps1'),
        "<#`r`n  Add-Nothing.ps1`r`n`r`n  Adds nothing, for the harness.`r`n#>`r`nparam()`r`n", $Utf8)
    & $Gen -Scripts $t -Check 6>$null
    Yes 'a script added without running it is red' ($LASTEXITCODE -eq 1)
    & $Gen -Scripts $t 6>$null
    & $Gen -Scripts $t -Check 6>$null
    $now = [IO.File]::ReadAllText($out, $Utf8)
    Yes 'and running it puts the new script in, with its purpose' (
        $LASTEXITCODE -eq 0 -and $now.Contains('| [Add-Nothing.ps1](Add-Nothing.ps1) | Adds nothing, for the harness. |'))

    [IO.File]::WriteAllText($out, ($now -replace 'Adds nothing, for the harness\.', 'Adds something.'), $Utf8)
    & $Gen -Scripts $t -Check 6>$null
    Yes 'a row edited by hand is red' ($LASTEXITCODE -eq 1)

    # Git turns line endings either way on checkout, and that is not drift.
    & $Gen -Scripts $t 6>$null
    [IO.File]::WriteAllText($out, ([IO.File]::ReadAllText($out, $Utf8) -replace "\r\n", "`n"), $Utf8)
    & $Gen -Scripts $t -Check 6>$null
    Yes 'the same index with other line endings is still green' ($LASTEXITCODE -eq 0)

    [IO.File]::WriteAllText((Join-Path $t 'Do-Something.ps1'), "param()`r`nWrite-Host 'hello'`r`n", $Utf8)
    & $Gen -Scripts $t 6>$null
    $now = [IO.File]::ReadAllText($out, $Utf8)
    Yes 'a script with no comment at its top gets a row that says so' (
        $now.Contains('| [Do-Something.ps1](Do-Something.ps1) | Nothing at the top of this script says what it is for. |'))

    # Until #5356 Windows PowerShell 5.1 had to write the same bytes as
    # PowerShell 7 here (#2944). Nothing runs it in 5.1 now, Patrick and the
    # build check alike, so that comparison went with it.
} catch {
    # Anything that stops the run part way is a failure, said as one, and the
    # count below still prints.
    Yes ('the rest ran: ' + $_.Exception.Message) $false
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
