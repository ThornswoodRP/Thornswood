<#
.SYNOPSIS
  Moves the engine pin in this checkout to a fork commit engine.yml recorded:
  the pin, the records, the front, the notice lines, and the pull request's
  title and body. One command for what was six hand steps.

.DESCRIPTION
  Issue #5148. engine\README.md, "One engine", step 4, as a script, so the
  same thing runs by hand and in .github\workflows\engine-pin.yml:

    1. the run is engine.yml's, on main, green, and recorded -Commit;
    2. engine\skymp in the index moves to -Commit (git update-index);
    3. Get-EngineRecords.ps1 -Run writes the four records from the run's log;
    4. Build-Front.ps1 -Record builds the front at the commit and records it
       (it fetches engine\skymp itself when this checkout never did);
    5. Write-EnginePinText.ps1 writes the pin's blocks in THIRD-PARTY.md and
       site\data\site\credits.md from the records;
    6. Check-Records.ps1, tests\test-one-engine.js, tests\test-third-party.js
       and Write-EnginePinText.ps1 -Check must pass;
    7. the changed paths are staged (exact paths, nothing else), and the pull
       request's title and body are written to -TitleFile and -BodyFile: the
       fork pull requests the move brings in, the Thornswood issues they name
       as Refs lines, and their Test tasks (EnginePin.ps1,
       Get-EnginePinNotes, says the shapes).

  It commits nothing and sends nothing: GitHub is only read, through gh.
  Any step that fails stops it with the step's own words, and what it
  already wrote stays for a person to read; nothing is put back.

  Exit 0: the move is staged. 1: it is not, and the last line says why.

.EXAMPLE
  git switch -c claude/pin-f0658585 origin/main
  pwsh scripts/release/Update-EnginePin.ps1 -Commit <fork commit> -Run <engine.yml run id>
  The whole pin move on a branch, ready to commit.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Commit,
    [Parameter(Mandatory = $true)][long]$Run,
    [string]$TitleFile,
    [string]$BodyFile,
    [string]$Gh = 'gh'
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
. (Join-Path $here 'ForkEngineBuild.ps1')
. (Join-Path $here 'EnginePin.ps1')
$repo = (Resolve-Path -LiteralPath (Join-Path $here '..\..')).ProviderPath
function Say($m) { Write-Host $m }
function Stop-Here($m) { Write-Host ''; Write-Host "STOP. $m"; exit 1 }
$Commit = $Commit.Trim().ToLowerInvariant()
if ($Commit -notmatch '^[0-9a-f]{40}$') { Stop-Here "'$Commit' is not a fork commit (40 hex)" }

$get = {
    param([string]$Path)
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = @(& $Gh api $Path 2>&1 | ForEach-Object { [string]$_ }); $code = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
    if ($code -ne 0) { throw ("GitHub answered GET $Path with: " + (($out | Select-Object -Last 2) -join ' ')) }
    return (($out -join "`n") | ConvertFrom-Json)
}.GetNewClosure()
function Invoke-Step([string]$What, [scriptblock]$Do) {
    Say "--- $What"
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { & $Do 2>&1 | ForEach-Object { Write-Host "  $_" }; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
    if ($code -ne 0) { Stop-Here "$What failed (exit $code); its lines are above" }
}

# 1. The run.
try { $r = & $get "repos/$EnginePinThornswood/actions/runs/$Run" } catch { Stop-Here $_.Exception.Message }
if ([string]$r.path -ne '.github/workflows/engine.yml') { Stop-Here "run $Run is not an engine.yml run (it is $($r.path))" }
if ([string]$r.head_branch -ne 'main') { Stop-Here "run $Run ran engine.yml from $($r.head_branch), not main, so its records are not main's way of making them" }
if ([string]$r.status -ne 'completed' -or [string]$r.conclusion -ne 'success') { Stop-Here "run $Run is $($r.status) $($r.conclusion), not green: $($r.html_url)" }
if ([string]$r.display_title -ne "Engine build of $Commit") { Stop-Here "run $Run is '$($r.display_title)', not the Engine build of $Commit" }

# 2. The pin.
$line = "$(& git -C $repo ls-files -s engine/skymp)".Trim()
if ($line -notmatch '^160000 ([0-9a-f]{40}) ') { Stop-Here 'this checkout has no engine/skymp pin in its index' }
$old = $Matches[1]
if ($old -eq $Commit) { Stop-Here "this checkout already pins $Commit" }
& git -C $repo update-index --cacheinfo "160000,$Commit,engine/skymp"
if ($LASTEXITCODE -ne 0) { Stop-Here 'git update-index could not move the pin' }
Say ("the pin moves from {0} to {1}" -f $old.Substring(0, 12), $Commit.Substring(0, 12))
# A checkout that fetched the fork has it at the old commit; Build-Front reads
# the fork through git, so it is moved too when it is there.
if (Test-Path -LiteralPath (Join-Path $repo 'engine/skymp/.git')) {
    & git -C (Join-Path $repo 'engine/skymp') fetch -q --depth 1 origin $Commit 2>$null
    & git -C (Join-Path $repo 'engine/skymp') checkout -q --detach $Commit
    if ($LASTEXITCODE -ne 0) { Stop-Here "engine/skymp could not be checked out at $Commit" }
}

# 3 to 6.
Invoke-Step 'the records engine.yml handed back' { & pwsh -NoProfile -File (Join-Path $here 'Get-EngineRecords.ps1') -Run $Run -Gh $Gh -NoPause }
Invoke-Step 'the front at this commit' { & pwsh -NoProfile -File (Join-Path $here 'Build-Front.ps1') -Record -Commit $Commit }
Invoke-Step 'the pin lines of THIRD-PARTY.md and credits.md' { & pwsh -NoProfile -File (Join-Path $here 'Write-EnginePinText.ps1') }
Invoke-Step 'Check-Records.ps1' { & pwsh -NoProfile -File (Join-Path $here 'Check-Records.ps1') }
Invoke-Step 'tests/test-one-engine.js' { & node (Join-Path $repo 'tests/test-one-engine.js') }
Invoke-Step 'tests/test-third-party.js' { & node (Join-Path $repo 'tests/test-third-party.js') }
Invoke-Step 'every pin block matches the records' { & pwsh -NoProfile -File (Join-Path $here 'Write-EnginePinText.ps1') -Check }

# 7. Staged, by exact path.
$paths = @('records/server-build.json', 'records/client-build.json', 'records/client-licences.json', 'records/client-licences',
           'records/front-build.json', 'records/front-licences', 'THIRD-PARTY.md', 'site/data/site/credits.md')
& git -C $repo add -A -- @paths
if ($LASTEXITCODE -ne 0) { Stop-Here 'git add failed' }

try { $notes = Get-EnginePinNotes $old $Commit $get } catch { Stop-Here ("the fork pull requests could not be read: " + $_.Exception.Message) }
$facts = Get-EnginePinFacts $repo
$title = "The engine pin moves to fork commit $($facts.Short)"
if ($notes.Issues.Count) {
    $named = @($notes.Issues | Select-Object -First 8 | ForEach-Object { "#$_" }) -join ', '
    $title += " (Refs $named$(if ($notes.Issues.Count -gt 8) { ', and more' }))"
}
$body = New-Object System.Collections.Generic.List[string]
$body.Add('## What changed'); $body.Add('')
$body.Add(("The engine pin moves from ``{0}`` to fork commit ``{1}`` (in full ``{2}``)." -f $old.Substring(0, 8), $facts.Short, $Commit))
$body.Add(("Cause: the fork's {0} had {1} merged pull request(s) that main did not pin, so no release carried them." -f $ForkEngineBranch, $notes.Count))
$body.Add('')
$body.Add('Fork pull requests it brings in:')
if ($notes.PullRequests.Count) { foreach ($l in $notes.PullRequests) { $body.Add($l) } } else { $body.Add('- none by merge commit; the commits are in the compare link below') }
$body.Add('')
$body.Add(("Every change: {0}/compare/{1}...{2}" -f $facts.Fork, $old.Substring(0, 12), $facts.Short))
$body.Add('')
$body.Add('## How you checked it'); $body.Add('')
$body.Add(("Made by scripts/release/Update-EnginePin.ps1 (#5148) from engine.yml run {0} ({1}), which recorded the fork's push build of this commit. The four records came from its log, the front was built again with Build-Front.ps1 -Record, and the pin blocks of THIRD-PARTY.md and credits.md were written from the records. Check-Records.ps1, tests/test-one-engine.js, tests/test-third-party.js and Write-EnginePinText.ps1 -Check passed before it was pushed. The server module's SHA256 is ``{2}``." -f $Run, $r.html_url, $facts.ServerSha256))
$body.Add('')
# The release note (plan part 8): the fork pull requests' own lines joined,
# none when each says none. With a fork pull request that has no line, none
# is written here: the line is left for a person, and the Release note check
# stays red until it is there.
$body.Add('## Release note'); $body.Add('')
if ($notes.NoNote.Count) {
    $body.Add(('Fork pull request(s) {0} carry no "Release note:" line. Write the line for them here, the way Developer-Guide.md says.' -f ((@($notes.NoNote | ForEach-Object { 'fork #' + $_ })) -join ', ')))
    if ($notes.ReleaseNote) { $body.Add(''); $body.Add('The others say:'); foreach ($l in @($notes.ReleaseNote -split "`n")) { $body.Add('    ' + $l) } }
} elseif ($notes.ReleaseNote) {
    $nl = @($notes.ReleaseNote -split "`n")
    $body.Add('Release note: ' + $nl[0])
    foreach ($l in @($nl | Select-Object -Skip 1)) { $body.Add($l) }
} else {
    $body.Add('Release note: none')
}
$body.Add('')
$body.Add('Whose work: mine')
$body.Add('')
$body.Add('## For the Thornswood team'); $body.Add('')
foreach ($i in $notes.Issues) { $body.Add("Refs #$i") }
foreach ($t in $notes.TestTasks) { $body.Add(''); $body.Add($t) }
$body.Add('')
# The heading ends the last Test task block, as it does in the pull request
# template: with no heading, the Test tasks check reads the ticked lines below
# as the block's own steps and refuses their code (#5240).
$body.Add('### Which parts it touches, and what runs after the merge'); $body.Add('')
$body.Add('- [x] The live server build, or the live settings')
$body.Add('- [x] The launcher (`launcher\app`), the game plugins (`game\plugins`) or anything else in a pack')
$body.Add('- [x] The public pages (`site\data\site\*.md`)')
if ($TitleFile) { [IO.File]::WriteAllText($TitleFile, $title, (New-Object Text.UTF8Encoding($false))) }
if ($BodyFile) { [IO.File]::WriteAllText($BodyFile, (($body -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false))) }
Say ''
Say $title
Say ("staged: the pin, the records, the front and the two pages; {0} fork pull request(s), {1} issue(s), {2} Test task(s)" -f $notes.Count, $notes.Issues.Count, $notes.TestTasks.Count)
exit 0
