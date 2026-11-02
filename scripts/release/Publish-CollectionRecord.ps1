<#
  Publish-CollectionRecord.ps1

  Makes the collection on Nexus what records\collection.json says, once a
  change to that record is merged (#5189). Run by
  .github\workflows\collection-record.yml on main, with the Nexus key:

      pwsh scripts/release/Publish-CollectionRecord.ps1 -Out <folder>
      pwsh scripts/release/Publish-CollectionRecord.ps1 -Out <folder> -WhatIf

  WHY. A mod change is one pull request to the record (docs\COLLECTION-CHANGES.md),
  checked there with no key (Check-CollectionRecord.ps1). Merging it is the
  decision. Until now the revision was then worked out again by hand as a
  New-NexusRevision.ps1 line, drafted, laid out and published in separate
  runs, and nothing held what was published to what was reviewed. Patrick
  decided on 31 Oct that a merged mod change drafts and publishes the
  revision by itself (the plan's "Content and mods" line).

  WHAT IT DOES, stopping at the first thing that is not so:
    1. the record on main passes its own check, and names the revision Nexus
       has published now (NexusPublished.ps1): a record behind Nexus has to
       follow it first, and one ahead of it names a revision nobody made;
    2. the published revision's collection.json, read from its archive, and
       the record give the change (Get-CollectionChangeSet): which files to
       add, move and take out, and which rules change. No change, and it
       says so and stops with nothing written;
    3. the archive of each new file is downloaded (as Nexus-Run.ps1 does),
       and New-NexusRevision.ps1 drafts the next revision with every change
       in one run, after its own checks (each page's permissions, patches,
       mod rules);
    4. Install-NexusRevision.ps1 lays the draft out with -KeepPlugins and
       stops on a rule that loops with the game's order;
    5. the record that layout makes (New-CollectionRecordFromLayout: each
       plugin's facts from its own header) is held to the record that was
       merged. Where they part, nothing the pull request reviewed is what
       Nexus would hand out, so the draft is discarded (New-NexusRevision.ps1
       -Discard) and it stops, naming each difference;
    6. only then, New-NexusRevision.ps1 -Publish.
  Then -Out holds what the records that follow the publish are made from:
  the layout's layout.json, files.txt, plugins.txt and loadorder.txt, the
  record of the new revision (collection.json), the dropped plugins for
  records\collection-dropped.json (dropped.json), the draft's own
  collection.json for collection-permissions.js update (nexus-collection.json),
  and last-rebuild.txt, the Last plugin's sources whose bytes the new
  revision changes. No plugin goes in it: the plugins are other authors'
  files and stay on the runner.

  WHAT THE LOG SHOWS. The steps, the change, and a STOP line from any script
  that stopped. The scripts' own output is not printed, as Nexus-Run.ps1
  keeps it out of the public log (#2841).

  -WhatIf does 1 and 2, downloads the new files and runs New-NexusRevision.ps1
  -WhatIf, which builds the archive and says every write it would make, and
  writes nothing to Nexus.

  Exit 0 when the revision is published or there is no change, 1 when it
  stopped. THORNSWOOD_NEXUS_API_KEY comes from the job (the desk environment's
  NEXUS_API_KEY), or THORNSWOOD_NEXUS_STANDIN points at the harness's stand-in.
#>
[CmdletBinding()]
param(
    [string]$Out = '',
    [string]$Record = '',
    [switch]$WhatIf
)
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
. (Join-Path $Here 'CollectionRecord.ps1')
. (Join-Path $Here 'Nexus.ps1')
$utf8 = New-Object Text.UTF8Encoding($false)
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan }
$script:OnNexus = New-Object Collections.Generic.List[string]
function Stop-Record([string]$m) {
    Write-Host ''
    Write-Host "STOP. $m" -ForegroundColor Red
    if ($script:OnNexus.Count) { Write-Host ('On Nexus from this run: ' + ($script:OnNexus -join '; ') + '.') -ForegroundColor Yellow }
    else { Write-Host 'Nothing was changed on Nexus.' -ForegroundColor Yellow }
    exit 1
}

if (-not $Record) { $Record = Join-Path $Repo 'records/collection.json' }
$base = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$Work = Join-Path $base ('thornswood-collection-record-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
if (-not $Out) { $Out = Join-Path $Work 'out' }
New-Item -ItemType Directory -Force -Path $Work, $Out | Out-Null
$shell = (Get-Process -Id $PID).Path

# One of the Nexus scripts of this checkout in a pwsh of its own, given its
# parameters as a hashtable, never through a command line. What it prints
# goes to a file of the run's own and is not shown, except its STOP line.
# Returns its exit code.
$script:Step = 0
function Invoke-RecordStep([string]$Name, $Params) {
    $script:Step++
    $log = Join-Path $Work ('step-' + $script:Step + '-' + $Name + '.txt')
    $b64 = [Convert]::ToBase64String($utf8.GetBytes(($Params | ConvertTo-Json -Depth 6 -Compress)))
    $path = (Join-Path $Here ($Name + '.ps1')).Replace("'", "''")
    $cmd = "`$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$b64')) | ConvertFrom-Json -AsHashtable; & '$path' @p; exit `$LASTEXITCODE"
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $shell
    foreach ($a in @('-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd)))) { $psi.ArgumentList.Add($a) }
    $psi.WorkingDirectory = $Repo
    $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
    $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
    $psi.EnvironmentVariables['NO_COLOR'] = '1'
    $proc = [Diagnostics.Process]::Start($psi)
    $proc.StandardInput.Close()
    $so = $proc.StandardOutput.ReadToEndAsync()
    $se = $proc.StandardError.ReadToEndAsync()
    $proc.WaitForExit()
    [IO.File]::WriteAllText($log, $so.Result + "`n" + $se.Result, $utf8)
    foreach ($l in @(($so.Result + "`n" + $se.Result) -split "`r?`n" | Where-Object { $_ -match '^\s*STOP\.' })) { Say ('  ' + $Name + ': ' + $l.Trim()) 'Red' }
    return $proc.ExitCode
}

if (-not $env:THORNSWOOD_NEXUS_API_KEY -and -not $env:THORNSWOOD_NEXUS_STANDIN) {
    Stop-Record 'THORNSWOOD_NEXUS_API_KEY is not set. In collection-record.yml it is the NEXUS_API_KEY secret of the "desk" environment.'
}

# ------------------------------------------------------------ 1. the record --
Head 'The record on main'
try { $want = Read-CollectionRecord $Record } catch { Stop-Record $_.Exception.Message }
$check = @(& $shell -NoProfile -File (Join-Path $Here 'Check-CollectionRecord.ps1') -Record $Record -Root $Repo 2>&1 | ForEach-Object { "$_" })
if ($LASTEXITCODE -ne 0) {
    foreach ($l in @($check | Where-Object { $_ -match '^\s+NO  |STOP' })) { Say $l 'Red' }
    Stop-Record 'The record on main does not pass Check-CollectionRecord.ps1, so it is not drafted.'
}
Say ("  collection $($want.collection), following revision $($want.revision): " + @($want.mods).Count + ' files, ' + @($want.plugins).Count + ' plugins') 'Green'
try { $published = [int](& (Join-Path $Here 'NexusPublished.ps1') -Slug $want.collection -Game $want.game) } catch { Stop-Record $_.Exception.Message }
if ($published -gt [int]$want.revision) { Stop-Record "Nexus has published revision $published and the record follows revision $($want.revision). The records follow revision $published first (New-CollectionRecord.ps1 from its layout); a change is drafted on the newest revision only." }
if ($published -lt [int]$want.revision) { Stop-Record "The record follows revision $($want.revision), and the newest Nexus has published is $published, so it names a revision nobody published." }
Say "  Nexus has published revision $published, the one the record follows" 'Green'

# ------------------------------------------------------------ 2. the change --
Head "What the record changes on revision $published"
try { $arc = Receive-NexusRevisionArchive $want.collection $want.game $published (Join-Path $Work 'published') } catch { Stop-Record $_.Exception.Message }
$sz = Find-SevenZip
if (-not $sz) { Stop-Record '7-Zip is not on this machine, and the published revision is a 7z archive.' }
& $sz x -y ('-o' + (Join-Path $Work 'published/x')) $arc.Path 'collection.json' | Out-Null
$pubJson = Join-Path $Work 'published/x/collection.json'
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $pubJson)) { Stop-Record "Revision $published's archive holds no collection.json 7-Zip could take out." }
$collection = [IO.File]::ReadAllText($pubJson) | ConvertFrom-Json
$cs = Get-CollectionChangeSet $want $collection
if ($cs.Problems.Count) {
    foreach ($p in $cs.Problems) { Say "  NO  $p" 'Red' }
    Stop-Record 'The record asks for a change New-NexusRevision.ps1 does not make.'
}
if ($cs.Empty) {
    Say "  none: the record is revision $published as published, so there is nothing to draft" 'Green'
    exit 0
}
foreach ($l in (Format-CollectionChangeSet $cs)) { Say "  $l" }

# ------------------------------------------------------------- 3. the draft --
Head 'The new files'
$params = [ordered]@{ NoPause = $true; Slug = [string]$want.collection; Game = [string]$want.game }
try {
    if ($cs.Move.Count) {
        $params.Mod = [string[]]@($cs.Move | ForEach-Object { [string]$_.modId })
        $params.FileId = [string[]]@($cs.Move | ForEach-Object { [string]$_.fileId })
        $params.Archive = [string[]]@($cs.Move | ForEach-Object { $g = Get-NexusFileArchive $want.game ([string]$_.fileId) (Join-Path $Work 'archives'); Say ("  file $($_.fileId): $($g.Name), $($g.Size) bytes"); $g.Path })
        $drops = @($cs.Move | ForEach-Object { $m = $_; @($m.dropPatch) | Where-Object { $_ } | ForEach-Object { [string]$m.modId + ':' + $_ } })
        if ($drops.Count) { $params.DropPatch = [string[]]$drops }
    }
    if ($cs.Add.Count) {
        $adds = @($cs.Add | ForEach-Object {
                $g = Get-NexusFileArchive $want.game ([string]$_.fileId) (Join-Path $Work 'archives')
                Say ("  file $($_.fileId): $($g.Name), $($g.Size) bytes")
                $one = [ordered]@{ modId = [long]$_.modId; fileId = [long]$_.fileId; archive = $g.Path; plugins = @($_.plugins | ForEach-Object { [ordered]@{ name = $_.name; after = @($_.after) } }) }
                if ($_.PSObject.Properties['choices']) { $one.choices = $_.choices }
                $one
            })
        $params.Add = Join-Path $Work 'add.json'
        [IO.File]::WriteAllText($params.Add, (ConvertTo-Json -InputObject @($adds) -Depth 12), $utf8)
    }
} catch { Stop-Record $_.Exception.Message }
if ($cs.Remove.Count) { $params.Remove = [string[]]@($cs.Remove | ForEach-Object { [string]$_ }) }
if ($cs.Rule.Count) {
    $params.Rule = Join-Path $Work 'rule.json'
    [IO.File]::WriteAllText($params.Rule, (ConvertTo-Json -InputObject @($cs.Rule | ForEach-Object { [ordered]@{ name = $_.name; after = @($_.after) } }) -Depth 4), $utf8)
}
if (-not $cs.Move.Count -and -not $cs.Add.Count) { Say '  none' }

if ($WhatIf) {
    Head 'What it would draft'
    $params.WhatIf = $true
    $code = Invoke-RecordStep 'New-NexusRevision' $params
    if ($code -ne 0) { Stop-Record "New-NexusRevision.ps1 -WhatIf stopped (exit $code)." }
    Say "  New-NexusRevision.ps1 -WhatIf built revision $($published + 1) from the record; nothing was written to Nexus" 'Green'
    exit 0
}

Head "Drafting revision $($published + 1)"
$code = Invoke-RecordStep 'New-NexusRevision' $params
$q = '{ collection(slug: "' + $want.collection + '", domainName: "' + $want.game + '") { draftRevisionNumber } }'
$draft = 0
$draftUnread = ''
try { $draft = [int](Get-NexusField (Get-NexusField (Invoke-NexusGraph $q $null 'Reading the draft') 'collection') 'draftRevisionNumber') }
catch { $draftUnread = $_.Exception.Message }
if ($code -ne 0) {
    if ($draft -gt $published) { $script:OnNexus.Add("draft revision $draft, which New-NexusRevision.ps1 left when it stopped") }
    Stop-Record "New-NexusRevision.ps1 stopped (exit $code) and the revision was not drafted."
}
if ($draftUnread) { Stop-Record "New-NexusRevision.ps1 finished, and Nexus could not be asked which revision is the draft: $draftUnread" }
if ($draft -ne $published + 1) { Stop-Record "New-NexusRevision.ps1 finished, and Nexus names draft revision $draft, not $($published + 1)." }
$script:OnNexus.Add("draft revision $draft")
Say "  draft revision $draft" 'Green'

# ------------------------------------------------- 4 and 5. laid out, held --
Head "Laying out revision $draft and holding it to the record"
$lay = Join-Path $Work 'layout'
$code = Invoke-RecordStep 'Install-NexusRevision' ([ordered]@{ Revision = $draft; Slug = [string]$want.collection; GameDomain = [string]$want.game; Record = $lay; KeepPlugins = $true; NoPause = $true })
$why = ''
$diff = @()
$got = $null
if ($code -ne 0) { $why = "Install-NexusRevision.ps1 could not lay draft revision $draft out (exit $code)" }
else {
    try { $got = New-CollectionRecordFromLayout $lay } catch { $why = $_.Exception.Message }
    if ($got) { $diff = @(Compare-CollectionRecord $want $got) }
    if ($diff.Count) { $why = "draft revision $draft is not what the record says" }
}
if ($why) {
    foreach ($d in $diff) { Say "  NO  $d" 'Red' }
    $dc = Invoke-RecordStep 'New-NexusRevision' ([ordered]@{ Discard = $draft; Slug = [string]$want.collection; Game = [string]$want.game; NoPause = $true })
    if ($dc -eq 0) { $script:OnNexus.Clear(); Say "  draft revision $draft discarded" 'Yellow' }
    else { $script:OnNexus.Add("draft revision $draft could not be discarded (exit $dc): discard it before the next merge") }
    Stop-Record "$why, so it is not published. Nothing the pull request reviewed would be what Nexus hands out."
}
Say "  revision $draft is the record: the same files, plugins, order, rules and headers" 'Green'

# ------------------------------------------------------------ 6. published --
Head "Publishing revision $draft"
$code = Invoke-RecordStep 'New-NexusRevision' ([ordered]@{ Publish = $draft; Slug = [string]$want.collection; Game = [string]$want.game; NoPause = $true })
if ($code -ne 0) { Stop-Record "New-NexusRevision.ps1 -Publish $draft stopped (exit $code); the draft is held to the record and waits." }
$script:OnNexus.Clear()
Say "  revision $draft is published" 'Green'
# The workflow's later steps run only after a publish.
if ($env:GITHUB_OUTPUT) { [IO.File]::AppendAllText($env:GITHUB_OUTPUT, "published=$draft`n", $utf8) }

# ------------------------------------------- what the records follow from --
foreach ($f in @('layout.json', 'files.txt', 'plugins.txt', 'loadorder.txt')) { Copy-Item -LiteralPath (Join-Path $lay $f) -Destination (Join-Path $Out $f) }
$got.revision = $draft
[IO.File]::WriteAllText((Join-Path $Out 'collection.json'), (ConvertTo-CollectionRecordText $got), $utf8)
$dropped = [ordered]@{ collection = [string]$want.collection; revision = $draft; dropped = @(@($want.dropped) | Where-Object { $_ }) }
[IO.File]::WriteAllText((Join-Path $Out 'dropped.json'), ($dropped | ConvertTo-Json -Depth 4), $utf8)
$na = Join-Path $Work 'draft'
try {
    $da = Receive-NexusRevisionArchive $want.collection $want.game $draft $na
    & $sz x -y ('-o' + (Join-Path $na 'x')) $da.Path 'collection.json' | Out-Null
    Copy-Item -LiteralPath (Join-Path $na 'x/collection.json') -Destination (Join-Path $Out 'nexus-collection.json')
} catch { Say ('  the published revision''s collection.json could not be kept for collection-permissions.js update: ' + $_.Exception.Message) 'Yellow' }
# The Last plugin's sources whose bytes the new revision changes.
$bytes = @{}
foreach ($line in [IO.File]::ReadAllLines((Join-Path $lay 'files.txt'))) {
    if (-not $line -or $line.StartsWith('#')) { continue }
    $c = $line.Split("`t")
    if ($c.Count -ge 4 -and $c[3] -match '^Data\\([^\\]+\.(esp|esm|esl))$') { $bytes[$Matches[1].ToLowerInvariant()] = $c[0] }
}
$rebuild = @()
$recipe = Join-Path $Repo 'game/data/last-plugin.recipe'
if (Test-Path -LiteralPath $recipe -PathType Leaf) {
    foreach ($s in @(Read-CollectionLastRecipeSources $recipe | Where-Object { $_.Kind -eq 'plugin' })) {
        $k = $s.Name.ToLowerInvariant()
        if (Test-CollectionName $script:CollectionGameOwn $s.Name) { continue }
        if (-not $bytes.ContainsKey($k)) { $rebuild += ($s.Name + "`tgone") }
        elseif ($bytes[$k] -ne $s.Sha256) { $rebuild += ($s.Name + "`tchanged") }
    }
}
[IO.File]::WriteAllText((Join-Path $Out 'last-rebuild.txt'), (($rebuild -join "`n") + "`n"), $utf8)
Say ''
Say ("  the records follow revision $draft from $Out" + $(if ($rebuild.Count) { "; the Last plugin reads $($rebuild.Count) plugin(s) it changes" } else { '' })) 'Green'
exit 0
