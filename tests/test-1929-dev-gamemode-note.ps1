<#
  test-1929-dev-gamemode-note.ps1

  #1929. Deploy-DevGamemode.ps1's refusal when no note is given showed the
  note as a bare string after the script name. The script had no positional
  note: PowerShell gave the parameters positions in the order they are
  declared, so the first one, -Vps, took it. On 5 Oct Patrick ran the command
  as shown, the note became the VPS address, and the script stopped again
  with the same "needs -Note" line.

  So -Note is the script's one positional parameter now, and the refusal and
  the help show it as -Note "...". This reads the commands the refusal and
  the help show, out of the script, and binds each one against the script's
  own parameters the way PowerShell would, with
  StaticParameterBinder. Nothing is run and nothing connects to anything.

  Runs under PowerShell 7.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $here
$script = Join-Path $repo 'scripts\deploy\Deploy-DevGamemode.ps1'
Add-Type -Path (Join-Path $repo 'tools/ReleaseNotes/NoteRules.cs')   # the release note rules (#5354)

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

$text = [IO.File]::ReadAllText($script)
$ast = [Management.Automation.Language.Parser]::ParseInput($text, [ref]$null, [ref]$null)

# Binds a command shown to a person against the real script. The name in the
# shown command is a relative path, so it is put back as the full path here;
# everything after the name is exactly as shown. Returns the bound parameters
# by name with their text, and how many could not be bound.
function Bind-Shown([string]$shown) {
    $m = [regex]::Match($shown, '^\s*\.\\(scripts\\deploy\\)?Deploy-DevGamemode\.ps1')
    if (-not $m.Success) { return $null }
    $line = "& '" + $script.Replace("'", "''") + "'" + $shown.Substring($m.Length)
    $errs = $null
    $cast = [Management.Automation.Language.Parser]::ParseInput($line, [ref]$null, [ref]$errs)
    $cmds = @($cast.FindAll({ param($n) $n -is [Management.Automation.Language.CommandAst] }, $true))
    $b = [Management.Automation.Language.StaticParameterBinder]::BindCommand($cmds[0], $true)
    $bound = @{}
    foreach ($k in $b.BoundParameters.Keys) {
        $v = $b.BoundParameters[$k].Value
        $bound[$k] = if ($v -is [Management.Automation.Language.StringConstantExpressionAst]) { $v.Value } else { $v.Extent.Text }
    }
    [pscustomobject]@{
        Bound      = $bound
        Commands   = $cmds.Count
        ParseFails = @($errs).Count
        BindFails  = @($b.BindingExceptions.Keys).Count
    }
}

# ---- the parameters themselves ----------------------------------------------
$cmd = Get-Command $script
$positional = @($cmd.Parameters.Values | Where-Object {
    $_.ParameterSets.ContainsKey('__AllParameterSets') -and $_.ParameterSets['__AllParameterSets'].Position -ge 0
} | ForEach-Object { $_.Name })
Yes '-Note is the first positional parameter' ($cmd.Parameters['Note'].ParameterSets['__AllParameterSets'].Position -eq 0)
Yes '  and the only one, so a bare string can never be taken as -Vps or another' ($positional.Count -eq 1 -and $positional[0] -eq 'Note')

# ---- the refusal ------------------------------------------------------------
# The block that runs when -Note is empty: every Write-Host string in it, in
# order, is what the person reads.
$refusal = $ast.Find({ param($n)
    $n -is [Management.Automation.Language.IfStatementAst] -and
    $n.Clauses[0].Item1.Extent.Text -match '^-not\s+\$Note\.Trim\(\)$'
}, $true)
Yes 'the refusal for a missing note is in the script' ($null -ne $refusal)
$said = @()
if ($refusal) {
    $said = @($refusal.FindAll({ param($n)
        $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Write-Host'
    }, $true) | ForEach-Object {
        $a = $_.CommandElements | Select-Object -Skip 1 | Where-Object { $_ -is [Management.Automation.Language.StringConstantExpressionAst] } | Select-Object -First 1
        if ($a) { $a.Value } else { '' }
    })
}
# The command starts at the line naming the script and runs to the end of what
# is shown, the way it is copied: a note of several lines is one string.
$start = -1
for ($i = 0; $i -lt $said.Count; $i++) { if ($said[$i] -match '^\s*\.\\scripts\\deploy\\Deploy-DevGamemode\.ps1') { $start = $i; break } }
Yes 'the refusal shows a command to run' ($start -ge 0)
if ($start -ge 0) {
    $shown = ($said[$start..($said.Count - 1)] | ForEach-Object { $_.Trim() }) -join "`n"
    Yes 'the command it shows names -Note' ($shown -match '\.ps1\s+-Note\s+"')
    $r = Bind-Shown $shown
    Yes '  and is one command that parses' ($r.Commands -eq 1 -and $r.ParseFails -eq 0)
    Yes '  and binds without an error' ($r.BindFails -eq 0)
    Yes '  and binds the note to -Note' ($r.Bound.ContainsKey('Note') -and $r.Bound['Note'] -match 'The door answers')
    Yes '  and binds nothing to -Vps' (-not $r.Bound.ContainsKey('Vps'))
    Yes '  and binds nothing but -Note' ($r.Bound.Count -eq 1)
    if ($r.Bound.ContainsKey('Note')) {
        $n = $r.Bound['Note']
        $problems = @([Thornswood.ReleaseNotes.NoteRules]::AllProblems($n))
        Yes '  and the note it shows is one the script itself accepts, title and a "- " line' ($problems.Count -eq 0 -and $n -match "`n- ")
    }
}

# ---- the help ---------------------------------------------------------------
# Every example in the header that gives the script a quoted string. A note in
# the help is a title on the script's line and "- " lines under it, closed on
# the last one, so the lines after it are joined until the quote closes.
$headerText = $text.Substring(0, $ast.ParamBlock.Extent.StartOffset)
$lines = $headerText -split "`r?`n"
$examples = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -notmatch '^\s*\.\\Deploy-DevGamemode\.ps1\s.*"') { continue }
    $ex = $lines[$i].Trim()
    $j = $i
    while ((([regex]::Matches($ex, '"')).Count % 2) -eq 1 -and $j + 1 -lt $lines.Count) { $j++; $ex += "`n" + $lines[$j].Trim() }
    $examples += $ex
}
Yes 'the help shows a note' ($examples.Count -ge 1)
foreach ($ex in $examples) {
    $first = ($ex -split "`n")[0]
    $r = Bind-Shown $ex
    Yes "help: $first   names -Note" ($first -match '\.ps1\s+-Note\s+"')
    Yes '  and binds the note to -Note, nothing to -Vps' ($r.BindFails -eq 0 -and $r.Bound.ContainsKey('Note') -and -not $r.Bound.ContainsKey('Vps'))
}

# ---- what the old form does now ---------------------------------------------
# A bare string, the form shown until #1929, is the note too, so a person who
# copies it from an old message still gets what they meant.
$r = Bind-Shown ".\scripts\deploy\Deploy-DevGamemode.ps1 `"The door answers on the first knock`n- The door no longer needs a second try before it opens.`""
Yes 'a bare string binds to -Note, never to -Vps' ($r.BindFails -eq 0 -and $r.Bound.ContainsKey('Note') -and -not $r.Bound.ContainsKey('Vps'))
$r = Bind-Shown '.\scripts\deploy\Deploy-DevGamemode.ps1 -Vps 203.0.113.9 "The door answers on the first knock"'
Yes 'the address still goes by its name, beside a bare note' ($r.BindFails -eq 0 -and $r.Bound['Vps'] -eq '203.0.113.9' -and $r.Bound.ContainsKey('Note'))

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
