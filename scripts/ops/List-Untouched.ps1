<#
  List-Untouched.ps1

  Lists the open issues nobody has touched for a month, oldest first, for the
  weekly board review to re-rank (#5185):

      pwsh scripts/ops/List-Untouched.ps1
      pwsh scripts/ops/List-Untouched.ps1 -Days 45 -OutFile temp/review/untouched.md

  WHY (#5185, the redesign's part 5). 909 issues were open when #5185 was
  filed, and an issue nobody looks at keeps whatever Order it was given the
  day it was filed. A month untouched is the cue to look again: move it to
  where it belongs now (an order: label), merge it into the issue it
  repeats, or write what it waits on. Never to close it for being old (docs/guide/the-board.md: an issue closes when it is done, a duplicate or replaced).

  WHAT "TOUCHED" MEANS. GitHub's own updated time for the issue: a comment, a
  label, an edit, a pull request or a commit naming it, a close or reopen.
  It is read with GitHub's issue search, which a cloud thread may use, so no
  board read is needed.

  It prints one line per issue: its number, title and the day it was last
  touched, and the count (its Order is on the board, which a search cannot
  read; Read-Board.ps1 has it). -OutFile also
  writes them there as a Markdown list. It changes nothing anywhere.

  Exits 0 with the list (an empty one included), 1 when GitHub could not be
  asked, and says why.
#>
[CmdletBinding()]
param(
    [ValidateRange(1, 3650)]
    [int]$Days = 30,
    [string]$GitHubRepo = 'ThornswoodRP/Thornswood',
    [string]$OutFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Die($m) { Write-Host "STOP. $m" -ForegroundColor Red; exit 1 }
if ($GitHubRepo -notmatch '^[\w.-]+/[\w.-]+$') { Die "'$GitHubRepo' is not owner/name." }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Die 'there is no gh here to ask GitHub with.' }

$before = [DateTime]::UtcNow.AddDays(-$Days).ToString('yyyy-MM-dd')
$query = "repo:$GitHubRepo is:issue is:open updated:<$before"
$found = New-Object System.Collections.Generic.List[object]
# Page by page until one comes back short: gh's --paginate follows GitHub's
# next links, which the cloud's proxy refuses (Check-Board.ps1 says so). The
# search answers at most 1,000 results.
for ($page = 1; $page -le 10; $page++) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $raw = @(& gh api -X GET search/issues -f "q=$query" -f sort=updated -f order=asc -f per_page=100 -f "page=$page" 2>&1 | ForEach-Object { "$_" })
    $code = $LASTEXITCODE
    $ErrorActionPreference = $old
    if ($code -ne 0) { Die ('GitHub''s search did not answer: ' + (($raw | Select-Object -Last 2) -join ' ')) }
    try { $r = ($raw -join "`n") | ConvertFrom-Json } catch { Die ('GitHub''s search answered something that is not JSON: ' + $_.Exception.Message) }
    $items = @($r.items)
    foreach ($i in $items) { $found.Add($i) }
    if ($items.Count -lt 100) { break }
}

$lines = New-Object System.Collections.Generic.List[string]
foreach ($i in $found) {
    $when = ([DateTime]$i.updated_at).ToUniversalTime().ToString('d MMM yyyy', [Globalization.CultureInfo]::InvariantCulture)
    $lines.Add(('#{0} {1} (last touched {2})' -f $i.number, $i.title, $when))
}
Write-Host ('{0} open issue(s) on {1} untouched since {2} ({3} days):' -f $lines.Count, $GitHubRepo, $before, $Days)
foreach ($l in $lines) { Write-Host "  $l" }
if ($OutFile) {
    $md = @("Open issues untouched for $Days days or more, read $([DateTime]::UtcNow.ToString('d MMM yyyy', [Globalization.CultureInfo]::InvariantCulture)): $($lines.Count)", '') + @($lines | ForEach-Object { "- $_" })
    $dir = Split-Path -Parent $OutFile
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    [IO.File]::WriteAllLines($OutFile, [string[]]$md, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "written to $OutFile"
}
exit 0
