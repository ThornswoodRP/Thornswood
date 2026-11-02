<#
  Guide-Text.ps1: the Developer Guide's text, for a harness that holds the
  guide to a rule. Dot-source it: . (Join-Path $PSScriptRoot 'Guide-Text.ps1')

  The guide was one file, Developer-Guide.md, until 1 Nov 2026 (plan line 39
  of the 31 Oct redesign). It is now an index, Developer-Guide.md, and one
  short page per task in docs/guide. tests/guide-text.js is the same for the
  node harnesses, and reads the pages the same way.

  Get-GuidePages lists the pages in the order of the index's "The pages"
  table, the guide's own order, so nothing here keeps a second list. It throws
  when the table names a page that is not there, or a page in docs/guide is
  not in the table, since then Get-GuideText would leave text out.

  Get-GuideText is the index and then every page, CR taken out, joined by a
  blank line: for a rule that may sit on any page, or a line that must be on
  none. Get-GuidePage <name> is one page, docs/guide/<name>.md, for a check of
  what one section says.
#>

$script:GuideRoot = Split-Path -Parent $PSScriptRoot

function Read-GuideFile([string]$Rel) {
    $t = [IO.File]::ReadAllText((Join-Path $script:GuideRoot $Rel))
    return $t.TrimStart([char]0xFEFF).Replace("`r", '')
}

function Get-GuidePages {
    $index = Read-GuideFile 'Developer-Guide.md'
    $at = $index.IndexOf("`n## The pages`n")
    if ($at -lt 0) { throw 'Developer-Guide.md has no "The pages" table' }
    $end = $index.IndexOf("`n## ", $at + 1)
    $table = if ($end -lt 0) { $index.Substring($at) } else { $index.Substring($at, $end - $at) }
    $named = @([regex]::Matches($table, '(?m)^\| \[[^\]]+\]\((docs/guide/[\w-]+\.md)\) \|') | ForEach-Object { $_.Groups[1].Value })
    if ($named.Count -eq 0) { throw 'Developer-Guide.md "The pages" table names no page' }
    $onDisk = @(Get-ChildItem -LiteralPath (Join-Path $script:GuideRoot 'docs/guide') -Filter '*.md' -File | ForEach-Object { 'docs/guide/' + $_.Name })
    $gone = @($named | Where-Object { $onDisk -notcontains $_ })
    $unlisted = @($onDisk | Where-Object { $named -notcontains $_ })
    if ($gone.Count) { throw ('Developer-Guide.md names pages that are not there: ' + ($gone -join ', ')) }
    if ($unlisted.Count) { throw ('pages in docs/guide that Developer-Guide.md does not list: ' + ($unlisted -join ', ')) }
    return $named
}

function Get-GuideText {
    $parts = @(Read-GuideFile 'Developer-Guide.md')
    foreach ($p in Get-GuidePages) { $parts += Read-GuideFile $p }
    return ($parts -join "`n`n")
}

function Get-GuidePage([string]$Name) {
    return Read-GuideFile ('docs/guide/' + $Name + '.md')
}
