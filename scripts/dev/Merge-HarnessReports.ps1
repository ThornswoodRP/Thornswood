<#
.SYNOPSIS
  Merges the JUnit reports of a run's harness shares into one report, and
  writes the failing checks, by name, to the run's summary (#5295).

.DESCRIPTION
  scripts\dev\Nightly-Harnesses.ps1 -Report writes one JUnit file a run:
  a test suite for each harness and a test case for each PASS, FAIL, SKIP
  or NOT RUN line it printed. Nightly-Harnesses.ps1 -Summary hands its own
  to this, so each share of the gate and the nightly writes its section of
  the run's page. Given several, from shares run by hand, it reads them
  all as one. It writes:

    -Out      one JUnit file with every share's suites, in the order given;
    -Summary  Markdown for the run's summary page: how many checks ran, how
              many failed and were skipped, and each failed test under a
              heading of its own, with its FAIL lines, the end of what it
              printed when it had no FAIL line, and the command that runs it
              alone (#4178), so a red run says what failed and how to see it
              fail without anybody opening a log. $env:GITHUB_STEP_SUMMARY
              on a runner.
    -Failed   the same list of failed tests alone, without the heading and
              counts, to a file of its own: nightly.yml hands it to the
              nightly's failure comment (Nightly-Issue.ps1). An empty file
              when nothing failed.

      .\scripts\dev\Merge-HarnessReports.ps1 -Path reports -Expect 5 -Out harnesses.xml

  -Path takes files, or folders whose *.xml files it reads, in name order.
  With -Expect it says when fewer reports came than shares ran: a share that
  stopped before its report was written ran checks this cannot name, and
  the summary says so instead of looking complete. That, or a report that
  does not read as one of ours, exits 1 after the summary is written, so
  the job that runs this is red; failing checks alone do not, since the
  share that ran them is red already.

  tests\test-5295-harness-report.ps1 holds this and the report it reads.

.PARAMETER Path
  The share reports: files, or folders holding them.

.PARAMETER Out
  Where the merged JUnit file goes. None unless asked.

.PARAMETER Summary
  Where the Markdown goes, added to what is there. GITHUB_STEP_SUMMARY on a
  runner; printed here off one.

.PARAMETER Title
  The summary's heading.

.PARAMETER Failed
  Where the list of failed tests goes, by itself, for a comment. None
  unless asked.

.PARAMETER Expect
  How many share reports there should be. 0, any number, unless asked.

.PARAMETER MostLines
  The most FAIL lines the list gives, across every failed test; a test past
  that is still named with its command. A summary holds 1 MiB at most.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string[]]$Path,
    [string]$Out = '',
    [string]$Summary = $env:GITHUB_STEP_SUMMARY,
    [string]$Title = 'Harnesses',
    [string]$Failed = '',
    [int]$Expect = 0,
    [int]$MostLines = 200
)

$ErrorActionPreference = 'Stop'

$files = @(foreach ($p in $Path) {
    if (Test-Path -LiteralPath $p -PathType Container) {
        Get-ChildItem -LiteralPath $p -Filter '*.xml' -File -Recurse | Sort-Object FullName | ForEach-Object { $_.FullName }
    } elseif (Test-Path -LiteralPath $p -PathType Leaf) { (Resolve-Path -LiteralPath $p).Path }
})

$problems = New-Object System.Collections.Generic.List[string]
$suites = New-Object System.Collections.Generic.List[System.Xml.XmlElement]
foreach ($f in $files) {
    $doc = New-Object System.Xml.XmlDocument
    try { $doc.Load($f) }
    catch { $problems.Add(('{0} does not read as XML: {1}' -f [IO.Path]::GetFileName($f), $_.Exception.Message)); continue }
    if ($doc.DocumentElement.get_LocalName() -ne 'testsuites') { $problems.Add(('{0} is not a harness report: its root is {1}' -f [IO.Path]::GetFileName($f), $doc.DocumentElement.get_LocalName())); continue }
    foreach ($s in $doc.DocumentElement.SelectNodes('testsuite')) { $suites.Add($s) }
}
if ($Expect -gt 0 -and $files.Count -lt $Expect) {
    $problems.Add(('{0} of the {1} share reports came; a share that stopped before writing its report ran checks this report cannot name' -f $files.Count, $Expect))
}

$all = 0; $bad = 0; $skip = 0
# Each failing harness, in report order, with its failing checks; a check
# that is the runner's own (a harness that ended with no FAIL line) carries
# the end of what the harness printed as its failure's text.
$byHarness = [ordered]@{}
foreach ($s in $suites) {
    foreach ($c in $s.SelectNodes('testcase')) {
        $all++
        $f = $c.SelectSingleNode('failure')
        if ($f) {
            $bad++
            $h = $s.GetAttribute('name')
            $x = [pscustomobject]@{ Harness = $h; What = $c.GetAttribute('name'); Tail = ([string]$f.InnerText).Trim() }
            if (-not $byHarness.Contains($h)) { $byHarness[$h] = New-Object System.Collections.Generic.List[object] }
            $byHarness[$h].Add($x)
        }
        elseif ($c.SelectSingleNode('skipped')) { $skip++ }
    }
}

if ($Out) {
    $merged = New-Object System.Xml.XmlDocument
    [void]$merged.AppendChild($merged.CreateXmlDeclaration('1.0', 'utf-8', $null))
    $root = $merged.CreateElement('testsuites')
    $root.SetAttribute('name', $Title)
    $root.SetAttribute('tests', [string]$all)
    $root.SetAttribute('failures', [string]$bad)
    $root.SetAttribute('skipped', [string]$skip)
    [void]$merged.AppendChild($root)
    foreach ($s in $suites) { [void]$root.AppendChild($merged.ImportNode($s, $true)) }
    $dir = Split-Path -Parent ([IO.Path]::GetFullPath($Out))
    if ($dir) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $settings = New-Object System.Xml.XmlWriterSettings
    $settings.Indent = $true
    $settings.Encoding = New-Object System.Text.UTF8Encoding $false
    $w = [System.Xml.XmlWriter]::Create([IO.Path]::GetFullPath($Out), $settings)
    try { $merged.Save($w) } finally { $w.Dispose() }
}

# The command that runs a harness alone, from the repository's root, as the
# runner starts it (Nightly-Harnesses.ps1 Start-One): node for a .js,
# pwsh -NoProfile -File for the rest. A harness's name is its path from the
# repository when it has a slash in it, and a file in tests\ when it has
# none (Harness-Files.ps1).
function Alone-Command([string]$name) {
    $path = $(if ($name.Contains('/')) { $name } else { 'tests/' + $name })
    if ($name -like '*.js') { return 'node ' + $path }
    return 'pwsh -NoProfile -File ' + $path
}
# A line of a block: one line, at most 300 characters.
function Clip([string]$s) {
    $s = ($s -replace '[\r\n]+', ' ').Trim()
    if ($s.Length -gt 300) { return $s.Substring(0, 300) + '...' }
    return $s
}
# A fenced block that no run of backticks in its text can close early.
function Block([string[]]$lines) {
    $n = 3
    foreach ($m in [regex]::Matches(($lines -join "`n"), '`+')) { if ($m.Length -ge $n) { $n = $m.Length + 1 } }
    $fence = '`' * $n
    return ($fence + "`n" + ($lines -join "`n") + "`n" + $fence + "`n")
}
# Each failed test (#4178): a heading, its FAIL lines, the end of what it
# printed when it had no FAIL line of its own, and the command that runs it
# alone. At most -MostLines FAIL lines in all; a test past that still has
# its heading and command, and says where its lines are. $room caps the
# whole list: a GitHub comment holds 65,536 characters, a summary 1 MiB.
function Failed-List([int]$room) {
    $out = New-Object System.Text.StringBuilder
    $lines = 0; $left = 0
    foreach ($h in $byHarness.Keys) {
        $b = New-Object System.Text.StringBuilder
        [void]$b.AppendLine('### ' + $h)
        [void]$b.AppendLine('')
        $checks = $byHarness[$h]
        $show = @(foreach ($x in $checks) { if ($lines -lt $MostLines) { $lines++; $x } })
        if ($show.Count) { [void]$b.Append((Block @($show | ForEach-Object { 'FAIL  ' + (Clip $_.What) }))) }
        if ($show.Count -lt $checks.Count) { [void]$b.AppendLine(('{0} more FAIL line(s) of it are in the merged report.' -f ($checks.Count - $show.Count))) }
        foreach ($x in $show) {
            if (-not $x.Tail) { continue }
            [void]$b.AppendLine('')
            [void]$b.AppendLine('Its last lines:')
            [void]$b.AppendLine('')
            [void]$b.Append((Block @($x.Tail -split "`r?`n" | Where-Object { $_.Trim() } | ForEach-Object { Clip $_ })))
        }
        [void]$b.AppendLine('')
        [void]$b.AppendLine('Run it alone:')
        [void]$b.AppendLine('')
        [void]$b.Append((Block @(Alone-Command $h)))
        [void]$b.AppendLine('')
        if ($left -or $out.Length + $b.Length -gt $room) { $left++; continue }
        [void]$out.Append($b.ToString())
    }
    if ($left) { [void]$out.AppendLine(('{0} more failed test(s) are named in the merged report and on the run''s page.' -f $left)) }
    return $out.ToString()
}
$list = Failed-List $(if ($Failed) { 60000 } else { 900000 })

# Markdown: a line of its own holds no line break.
function Cell([string]$s) { ($s -replace '[\r\n]+', ' ').Trim() }
$md = New-Object System.Text.StringBuilder
[void]$md.AppendLine('## ' + $Title)
[void]$md.AppendLine('')
[void]$md.AppendLine(('{0} checks in {1} harnesses: {2} failed, {3} skipped.' -f $all, $suites.Count, $bad, $skip))
foreach ($p in $problems) { [void]$md.AppendLine(''); [void]$md.AppendLine('**' + (Cell $p) + '.**') }
if ($list) {
    [void]$md.AppendLine('')
    [void]$md.Append($list)
}
if ($Summary) { [IO.File]::AppendAllText($Summary, $md.ToString(), (New-Object System.Text.UTF8Encoding $false)) }
else { Write-Host $md.ToString() }
if ($Failed) {
    $said = New-Object System.Text.StringBuilder
    foreach ($p in $problems) { [void]$said.AppendLine('**' + (Cell $p) + '.**'); [void]$said.AppendLine('') }
    [void]$said.Append($list)
    $dir = Split-Path -Parent ([IO.Path]::GetFullPath($Failed))
    if ($dir) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($Failed), $said.ToString(), (New-Object System.Text.UTF8Encoding $false))
}

Write-Host ('{0} checks in {1} harnesses from {2} report(s): {3} failed, {4} skipped' -f $all, $suites.Count, $files.Count, $bad, $skip)
if ($problems.Count) {
    foreach ($p in $problems) { Write-Host ('::error::' + $p) }
    exit 1
}
exit 0
