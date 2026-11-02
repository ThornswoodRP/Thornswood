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
              many failed and were skipped, and a line for each failing
              check, harness first, so a red run names its checks without
              anybody opening a log. $env:GITHUB_STEP_SUMMARY on a runner.

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

.PARAMETER Expect
  How many share reports there should be. 0, any number, unless asked.

.PARAMETER MostLines
  The most failing checks the summary lists by name; the rest are counted.
  A summary holds 1 MiB at most.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string[]]$Path,
    [string]$Out = '',
    [string]$Summary = $env:GITHUB_STEP_SUMMARY,
    [string]$Title = 'Harnesses',
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
$failing = New-Object System.Collections.Generic.List[object]
foreach ($s in $suites) {
    foreach ($c in $s.SelectNodes('testcase')) {
        $all++
        if ($c.SelectSingleNode('failure')) { $bad++; $failing.Add([pscustomobject]@{ Harness = $s.GetAttribute('name'); What = $c.GetAttribute('name') }) }
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

# Markdown: a table cell holds no line break and no bar of its own.
function Cell([string]$s) { ($s -replace '[\r\n]+', ' ' -replace '\|', '\|').Trim() }
$md = New-Object System.Text.StringBuilder
[void]$md.AppendLine('## ' + $Title)
[void]$md.AppendLine('')
[void]$md.AppendLine(('{0} checks in {1} harnesses: {2} failed, {3} skipped.' -f $all, $suites.Count, $bad, $skip))
foreach ($p in $problems) { [void]$md.AppendLine(''); [void]$md.AppendLine('**' + (Cell $p) + '.**') }
if ($failing.Count) {
    [void]$md.AppendLine('')
    [void]$md.AppendLine('| Harness | Failing check |')
    [void]$md.AppendLine('| --- | --- |')
    foreach ($x in @($failing | Select-Object -First $MostLines)) { [void]$md.AppendLine(('| {0} | {1} |' -f (Cell $x.Harness), (Cell $x.What))) }
    if ($failing.Count -gt $MostLines) {
        [void]$md.AppendLine('')
        [void]$md.AppendLine(('{0} more failing checks are in the merged report.' -f ($failing.Count - $MostLines)))
    }
}
if ($Summary) { [IO.File]::AppendAllText($Summary, $md.ToString(), (New-Object System.Text.UTF8Encoding $false)) }
else { Write-Host $md.ToString() }

Write-Host ('{0} checks in {1} harnesses from {2} report(s): {3} failed, {4} skipped' -f $all, $suites.Count, $files.Count, $bad, $skip)
if ($problems.Count) {
    foreach ($p in $problems) { Write-Host ('::error::' + $p) }
    exit 1
}
exit 0
