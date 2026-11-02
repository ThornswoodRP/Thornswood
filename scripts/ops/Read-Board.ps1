<#
  Read-Board.ps1

  Reads the whole board, every card's Status and Order, into board.json, from
  a machine that has gh and no board token: a cloud Claude thread (#3192).

      pwsh scripts/ops/Read-Board.ps1
      pwsh scripts/ops/Read-Board.ps1 -OutFile temp/board-review/board.json
      pwsh scripts/ops/Read-Board.ps1 -Run 39712345678

  A cloud thread is refused GraphQL, and the board is read only through
  GraphQL, so this starts .github/workflows/board-read.yml on main, which
  reads the board with the board token on a VPS runner, waits for the run to
  end, reads board.json back out of the run's log and writes it to -OutFile.
  The workflow's header says what the file holds, and why it comes back in
  the log and not as an artifact (#3410: the artifact storage was full).
  Nothing on the board changes.

  -Run reads a run already started, for when the wait ran out before a
  runner took it. GitHub keeps a run's log 90 days.

  Exits:
    0  board.json written; the path and the count per Status are printed
    1  stopped, and the line before says why
    2  the run had not ended in -WaitMinutes; the line to read it later is
       printed
#>
[CmdletBinding(DefaultParameterSetName = 'Start')]
param(
    [Parameter(ParameterSetName = 'Run', Mandatory = $true)][long]$Run,
    [string]$OutFile,
    [int]$WaitMinutes = 15,
    [string]$GitHubRepo = 'ThornswoodRP/Thornswood'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Get-GhLogFlags, for reading the job's log (#5202).
. (Join-Path $PSScriptRoot '..\release\LogHandBack.ps1')

$workflow = 'board-read.yml'
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Die($m) { Write-Host "STOP. $m" -ForegroundColor Red; exit 1 }

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Die 'there is no gh here to start the board-read workflow with.' }
if (-not $OutFile) { $OutFile = Join-Path ([IO.Path]::GetTempPath()) 'thornswood-board.json' }
$OutFile = [IO.Path]::GetFullPath($OutFile)

# One GET, its answer as an object; a refusal stops the script with why.
# -NotYet: GitHub's Not Found means not served yet, and comes back as $null.
function Get-GitHub([string]$path, [switch]$NotYet) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $o = @(& gh api $path 2>&1 | ForEach-Object { "$_" })
    $c = $LASTEXITCODE
    $ErrorActionPreference = $old
    if ($c -ne 0) {
        if ($NotYet -and ($o -join ' ') -match '\(HTTP 404\)') { return $null }
        Die ("GitHub answered GET $path with: " + (($o | Select-Object -Last 2) -join ' '))
    }
    return (($o -join "`n") | ConvertFrom-Json)
}

# board.json from the lines of a board-read job's log (board-read.yml, THE
# HAND-BACK IS THE LOG): the BOARD-JSON begin line gives its length and
# sha256, the lines after it its gzip in base64, up to the end line. A log
# line may start with GitHub's timestamp. Throws, saying what is wrong, when
# a marker is missing or twice, or the bytes are not the length and sha256
# the begin line gives.
function Read-BoardFromLog([string[]]$Lines) {
    $mark = 'BOARD' + '-JSON'
    $re = '^(?:\d{4}-\d\d-\d\dT[\d:.]+Z )?' + $mark + ' (.*)$'
    $begin = $null; $ended = $false; $parts = New-Object System.Text.StringBuilder
    foreach ($l in @($Lines | ForEach-Object { ([string]$_) -split "`r?`n" })) {
        $m = [regex]::Match($l.TrimEnd(), $re)
        if (-not $m.Success) { continue }
        $rest = $m.Groups[1].Value
        if ($rest -match '^begin (\d+) ([0-9a-f]{64})$') {
            if ($begin) { throw "the log has two $mark begin lines" }
            $begin = [pscustomobject]@{ Length = [long]$Matches[1]; Sha = $Matches[2] }
            continue
        }
        if (-not $begin) { continue }
        if ($rest -eq 'end') { $ended = $true; break }
        if ($rest -notmatch '^[A-Za-z0-9+/=]+$') { throw "a $mark line between begin and end is not base64" }
        [void]$parts.Append($rest)
    }
    if (-not $begin) { throw "the log has no $mark begin line" }
    if (-not $ended) { throw "the log has no $mark end line after its begin line" }
    $in = New-Object IO.MemoryStream (, [Convert]::FromBase64String($parts.ToString()))
    $zip = New-Object IO.Compression.GZipStream($in, [IO.Compression.CompressionMode]::Decompress)
    $out = New-Object IO.MemoryStream
    $zip.CopyTo($out)
    $zip.Dispose()
    $bytes = $out.ToArray()
    if ($bytes.Length -ne $begin.Length) { throw ("it is {0} bytes, and the begin line says {1}" -f $bytes.Length, $begin.Length) }
    $sha = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
    if ($sha -ne $begin.Sha) { throw "its sha256 is $sha, and the begin line says $($begin.Sha)" }
    return , $bytes
}

if ($PSCmdlet.ParameterSetName -eq 'Run') {
    $id = $Run
    $started = $false
} else {
    $body = @{ ref = 'main'; return_run_details = $true } | ConvertTo-Json -Compress
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $o = @($body | & gh api -X POST "repos/$GitHubRepo/actions/workflows/$workflow/dispatches" --input - 2>&1 | ForEach-Object { "$_" })
    $c = $LASTEXITCODE
    $ErrorActionPreference = $old
    if ($c -ne 0) { Die ('GitHub did not start the board-read workflow: ' + (($o | Select-Object -Last 2) -join ' ')) }
    $answer = ($o -join "`n") | ConvertFrom-Json
    if (-not $answer.PSObject.Properties['workflow_run_id'] -or -not $answer.workflow_run_id) {
        Die ('GitHub started the board-read workflow but named no run, so its log cannot be found from here. Its runs: https://github.com/' + $GitHubRepo + '/actions/workflows/' + $workflow)
    }
    $id = [long]$answer.workflow_run_id
    $started = $true
    Say ('started the board-read workflow: ' + $answer.html_url) 'DarkGray'
}

# Waits for the run to end. A run the dispatch has just named can be Not Found
# for a few seconds while GitHub's copies catch up (Say-Staff.ps1, #3081), so
# until it is first served that is one more state of the wait, like queued.
$runPath = "repos/$GitHubRepo/actions/runs/$id"
$deadline = [DateTime]::UtcNow.AddMinutes($WaitMinutes)
$r = Get-GitHub $runPath -NotYet:$started
$told = ''
while (-not $r -or $r.status -ne 'completed') {
    $state = if ($r) { $r.status } else { 'not served by GitHub yet' }
    if ([DateTime]::UtcNow -gt $deadline) {
        Say ("the run has not ended after $WaitMinutes minutes (it was $state), so every runner is busy. It still reads the board when one takes it.") 'Yellow'
        Say ('  read it then: pwsh scripts/ops/Read-Board.ps1 -Run ' + $id) 'DarkGray'
        exit 2
    }
    if ($told -ne $state) { Say ("  waiting ($state)") 'DarkGray'; $told = $state }
    Start-Sleep -Seconds 5
    $r = Get-GitHub $runPath -NotYet:($started -and -not $r)
}
if ($r.path -notmatch ('/' + [regex]::Escape($workflow) + '$')) { Die ("run $id is not a board-read run (it is " + $r.path + ').') }
if ($r.conclusion -ne 'success') { Die ("the run ended $($r.conclusion), so there is no board.json. Its log says why: " + $r.html_url) }

# The job's log, as text. gh api follows GitHub's redirect to where the log
# is kept and prints it as it is.
$jobs = @((Get-GitHub "$runPath/jobs").jobs)
if ($jobs.Count -ne 1) { Die ("run $id has $($jobs.Count) jobs, not the one board-read.yml runs: " + $r.html_url) }
# A runner's log carries terminal escape sequences (its colours). gh 2.92 and
# newer refuse to hand over an answer that holds any (CVE-2026-45803) unless
# told --allow-escape-sequences, so a main Ship's board read on such a gh
# stopped here on 27 Oct 2026 and closed no issue. Get-GhLogFlags gives the
# flag when gh's own help names it, as for every other reader of a job's log
# (#5202). The log goes into $log and only its BOARD-JSON lines are read;
# nothing of it reaches the terminal as it is (the refusal below strips ESC
# first).
$flags = @(Get-GhLogFlags)
$old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$log = @(& gh api "repos/$GitHubRepo/actions/jobs/$($jobs[0].id)/logs" @flags 2>&1 | ForEach-Object { "$_" })
$c = $LASTEXITCODE
$ErrorActionPreference = $old
if ($c -ne 0) { Die ("GitHub did not hand over run $id's log: " + ((($log | Select-Object -Last 2) -join ' ') -replace "`e", '')) }
try { $bytes = Read-BoardFromLog $log } catch { Die ("run $id's log does not hold board.json whole: " + $_.Exception.Message + ' ' + $r.html_url) }
$board = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
$dir = Split-Path -Parent $OutFile
if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
[IO.File]::WriteAllBytes($OutFile, $bytes)

$items = @($board.items)
Say ("read {0} cards from {1}, as of {2}" -f $items.Count, $board.board.url, $board.read_at) 'Green'
foreach ($g in @($items | Group-Object { if ($_.status) { $_.status } else { '(no Status)' } } | Sort-Object Name)) { Say ("  {0}: {1}" -f $g.Name, $g.Count) }
Say ("  written to $OutFile") 'DarkGray'
exit 0
