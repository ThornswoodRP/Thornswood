<#
  test-3114-trace-gate.ps1

      pwsh -NoProfile -File .\tests\test-3114-trace-gate.ps1

  Issue #3114. The whole gate is traced on GitHub's hosted runner by
  gate-map.yml (#5183), which tests\test-4009-gate-map.ps1 holds, through
  scripts\dev\Trace-Gate-Here.ps1 and Trace-Gate-Box.ps1. Nothing here
  starts a trace:

    1. the box's half is gone (#5338): no trace-gate.yml (#5270), no
       Trace-Gate.ps1 and no trace task (Trace-Gate-Task.ps1), no gate verb
       Remove-GateTrace, and nothing in the scripts, the workflows or the
       records names them; gate-map.yml runs the whole gate under the trace;
    2. scripts\dev\Trace-Gate-Box.ps1 parses, its C# compiles against only
       the assemblies it names, it keeps the trace in a folder only
       administrators and the system can open, refuses a trace that lost
       events, and deletes the trace once read;
    3. its modes are the five gate-map.yml asks for, and Trace-Gate-Here.ps1
       takes those five and no more.

  Writes nothing.
#>
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
function Text([string]$rel) { [IO.File]::ReadAllText((Join-Path $repo $rel)) }

# ---- 1. the box's half is gone (#5270, #5338) ----------------------------------
Yes 'trace-gate.yml is not in this repository' (-not (Test-Path -LiteralPath (Join-Path $repo '.github\workflows\trace-gate.yml')))
Yes 'nor Trace-Gate.ps1 or the trace task, Trace-Gate-Task.ps1' (-not (Test-Path -LiteralPath (Join-Path $repo 'scripts\dev\Trace-Gate.ps1')) -and -not (Test-Path -LiteralPath (Join-Path $repo 'scripts\dev\Trace-Gate-Task.ps1')))
$verbs = (Text 'scripts\vps\gate\verbs.json' | ConvertFrom-Json).verbs
Yes '  nor the gate verb that took the task off the box, Remove-GateTrace' ($null -eq $verbs.'Remove-GateTrace')
$named = @()
foreach ($dir in 'scripts', '.github', 'records') {
    foreach ($f in Get-ChildItem -LiteralPath (Join-Path $repo $dir) -Recurse -File -Include '*.ps1', '*.js', '*.yml', '*.json', '*.py', '*.sh') {
        $x = [IO.File]::ReadAllText($f.FullName)
        if ($x -match 'Trace-Gate-Task\.ps1|Trace-Gate\.ps1|Remove-GateTrace|Thornswood Gate Trace') { $named += $f.FullName.Substring($repo.Length + 1) }
    }
}
Yes ('  and no script, workflow or record names them (' + ($named -join ', ') + ')') (-not $named.Count)
$g = Text '.github\workflows\gate-map.yml'
Yes 'gate-map.yml runs the whole gate under the trace' ($g -match 'Trace-Gate-Here\.ps1' -and $g -match '(?m)^\s+\.\\scripts\\dev\\Run-Gate\.ps1 -Throttle \d+ -BudgetSeconds \d+ -StartLog ')

# ---- 2. the tracer ---------------------------------------------------------------
$x = Text 'scripts\dev\Trace-Gate-Box.ps1'
$e = $null; $null = [Management.Automation.Language.Parser]::ParseInput($x, [ref]$null, [ref]$e)
Yes 'Trace-Gate-Box.ps1 parses' (-not $e.Count)
$m = [regex]::Match($x, "(?s)Add-Type -ReferencedAssemblies ([\w., ]+?) -TypeDefinition @'\r?\n(.*?)\r?\n'@")
$refs = @($m.Groups[1].Value -split ',\s*' | Where-Object { $_ })
$cs = $m.Groups[2].Value
# Built as the box builds it: PowerShell 7 with only the assemblies the
# script names, which ship with PowerShell on every system, the event log
# reader's included, so a missing one fails here and not on the box (#5356).
$compiled = ''
if ($cs) {
    $src = $cs.Replace('public static class ThornswoodTrace', 'public static class ThornswoodTraceTest' + [Guid]::NewGuid().ToString('N'))
    try { Add-Type -ReferencedAssemblies $refs -TypeDefinition $src -ErrorAction Stop } catch { $compiled = $_.Exception.Message + ' ' + (@($_.Exception.Errors | Select-Object -First 3 | ForEach-Object { "$_" }) -join ' ') }
} else { $compiled = 'no C# found' }
Yes ('  its C# compiles with only the assemblies it names (' + ($refs -join ', ') + ')' + $(if ($compiled) { ': ' + $compiled.Substring(0, [Math]::Min(400, $compiled.Length)) } else { '' })) (-not $compiled)
Yes '  the trace folder is closed to all but administrators and the system' ($x -match [regex]::Escape("icacls.exe `$traceRoot /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F'"))
Yes '  a trace that lost events is refused' ($x -match "(?s)'stop' \{\s*Stop-TraceSession \`$sessionName\s*if \(\`$script:lost\) \{ 'REFUSED: '.*?exit 1 \}")
Yes '  the trace is deleted once read, and only paths in the checkout leave' ($x -match "(?s)'END'\s*Remove-Item -LiteralPath \(Join-Path \`$traceRoot 'gate\.etl'\), \(Join-Path \`$traceRoot 'gate\.etl\.procs'\) -Force" -and $x -match 'if \(!inside\) \{ if \(objO != null\) objects\.Remove\(Address\(objO\)\); continue; \}')

# ---- 3. its modes (#5338) --------------------------------------------------------
$modes = @([regex]::Matches($x, "(?m)^    '([a-z]+)' \{") | ForEach-Object { $_.Groups[1].Value })
Yes ('Trace-Gate-Box.ps1 has the five modes gate-map.yml asks for and no more (' + ($modes -join ', ') + ')') ((($modes | Sort-Object) -join ' ') -eq 'clean read selftest start stop')
Yes '  and nothing of the trace task: no scheduled task, no runner folders' ($x -notmatch "Register-ScheduledTask|Thornswood Gate Trace|'gate-map'|TraceRunners")
$here = Text 'scripts\dev\Trace-Gate-Here.ps1'
Yes 'Trace-Gate-Here.ps1 takes those five' ($here -match "ValidateSet\('selftest', 'start', 'stop', 'read', 'clean'\)")
$asked = @([regex]::Matches($g, 'Trace-Gate-Here\.ps1 -Mode ([a-z]+)') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
Yes ('  and gate-map.yml asks for each of them and nothing else (' + ($asked -join ', ') + ')') ((($asked) -join ' ') -eq 'clean read selftest start stop')

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
