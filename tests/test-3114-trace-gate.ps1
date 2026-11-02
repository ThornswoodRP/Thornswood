<#
  test-3114-trace-gate.ps1

      pwsh -NoProfile -File .\tests\test-3114-trace-gate.ps1

  Issue #3114. scripts\dev\Trace-Gate.ps1 is the box's half of the gate
  trace: the trace's self-test there and the trace task that traced main
  builds on the box's build runners. The whole gate is traced on GitHub's
  hosted runner by gate-map.yml (#5183), which tests\test-4009-gate-map.ps1
  holds. Nothing here starts a trace:

    1. no trace-gate.yml, here or started from here: the private ops
       repository's copy ran the gate on a box build runner, checking out
       any ref it was given, and is gone with the box's other jobs that do
       not need the box (#5270); Trace-Gate.ps1 starts no workflow, takes
       no ref and pushes nothing;
    2. Trace-Gate.ps1 parses, says what to run when given no mode, names
       gate-map.yml for the whole gate, and its -Install runs the self-test
       first and installs nothing when it fails;
    3. scripts\dev\Trace-Gate-Box.ps1 parses, its C# compiles as C# 5 (what
       Windows PowerShell 5.1 builds) against stand-ins for the event log
       reader, it keeps the trace in a folder only administrators and the
       system can open, refuses a trace that lost events, and deletes the
       trace once read.

  Writes only its scratch folder, in the system's temp folder, and deletes it.
#>
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
function Text([string]$rel) { [IO.File]::ReadAllText((Join-Path $repo $rel)) }

# ---- 1. no trace-gate.yml (#5270) --------------------------------------------
Yes 'trace-gate.yml is not in this repository' (-not (Test-Path -LiteralPath (Join-Path $repo '.github\workflows\trace-gate.yml')))
$t = Text 'scripts\dev\Trace-Gate.ps1'
# The script after its help, with its comment lines taken out.
$body = (@($t.Substring($t.IndexOf('#>') + 2) -split "`r?`n" | Where-Object { $_ -notmatch '^\s*#' }) -join "`n")
Yes 'Trace-Gate.ps1 starts no workflow and names no trace-gate.yml outside its help' ($body -notmatch 'trace-gate\.yml' -and $body -notmatch '&\s*gh\b' -and $body -notmatch 'Invoke-Gh' -and $body -notmatch 'Start-ThornswoodWorkflow')
Yes '  takes no ref, so nothing it is handed is checked out anywhere' ($t -notmatch '\[string\]\$Ref\b' -and $t -notmatch '\$PushRun')
Yes '  and pushes nothing' ($body -notmatch 'git ')

# ---- 2. the script on the shipping machine --------------------------------------
$e = $null; $null = [Management.Automation.Language.Parser]::ParseInput($t, [ref]$null, [ref]$e)
Yes 'Trace-Gate.ps1 parses' (-not $e.Count)
Yes '  given no mode it says which to give, and names gate-map.yml for the whole gate' ($body -match [regex]::Escape("if (-not (`$SelfTest -or `$Clean -or `$Install -or `$Status -or `$Uninstall)) {") -and $body -match [regex]::Escape('gh workflow run gate-map.yml --ref main'))
$g = Text '.github\workflows\gate-map.yml'
Yes '  and gate-map.yml is here and runs the whole gate under the trace' ($g -match 'Trace-Gate-Here\.ps1' -and $g -match '(?m)^\s+\.\\scripts\\dev\\Run-Gate\.ps1 -Throttle \d+ -BudgetSeconds \d+ -StartLog ')
$ins = $body.IndexOf('if ($Install) {')
$self = $body.IndexOf("Invoke-Box 'selftest'", [Math]::Max(0, $ins)); $put = $body.IndexOf("Invoke-Box 'install'")
Yes '  -Install runs the self-test before it installs, and installs nothing when it fails' ($ins -gt 0 -and $self -gt $ins -and $put -gt $self -and $body.Contains('Nothing was installed.'))

# ---- 3. the script on the box ---------------------------------------------------
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
Yes '  every mode Trace-Gate.ps1 asks for is there' (@('selftest', 'start', 'stop', 'read', 'clean', 'install', 'status', 'uninstall' | Where-Object { $x -notmatch ("(?m)^    '" + $_ + "' \{") }).Count -eq 0)

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
