<#
  Check-CollectionRecord.ps1

  Holds records\collection.json, the collection as it should be, to the load
  order, each mod's page and the servers' order, from the repository alone
  (#5189):

      pwsh scripts/release/Check-CollectionRecord.ps1
      pwsh scripts/release/Check-CollectionRecord.ps1 -Base origin/main    and what it changes

  WHY. A mod change is a pull request to that record (docs\COLLECTION-CHANGES.md),
  and its merge drafts the revision on Nexus and publishes it
  (Publish-CollectionRecord.ps1). So what a revision used to be refused for
  after it was drafted, or worse after it was published, is refused here,
  in the pull request, where nothing has gone to Nexus yet:
    - the record's own shape: every file's plugins on the list, every plugin
      put in Data by one file, each plugin's facts as its name allows;
    - the load order: every rule names a plugin the list enables, the list
      keeps every rule, no rule goes round with the order the game sets
      (PluginRuleLoops.ps1, the cheddars_mashups.esl loop of revision 5), and
      a chain of rules holds every full plugin under the one above it, so
      LOOT cannot swap two (Check-CollectionRules.ps1's five);
    - each mod's page: every mod is Thornswood's own or its page, read into
      records\collection-permissions.json, allows it in a collection
      (collection-permissions.js check);
    - the servers: a plugin they load that the record takes out is named
      under dropped with why, and no full plugin they load moves to another
      index, which would point every form it stored at another plugin
      (#2320), unless Patrick's decision to wipe both worlds is written
      under wipe;
    - the record and records\collection-plugins.json name the same revision.
  It says too, without failing, which plugins the change adds and takes out,
  and which of those the Last plugin's recipe reads, so its rebuild on the
  new revision is expected.

  The plugins' headers are read from the record, not from the files, which
  no repository holds. The merge lays the draft out and holds it to this
  record, the facts included, before anything is published.

  -Base names a git revision whose records\collection.json this is held
  against, and says what the change asks of Nexus, as the merge will do it.

  Exit 0 when the record passes, 1 when it does not, 2 when something it
  reads is not there or does not read. tests\test-5189-collection-record.ps1
  holds all of this.
#>
[CmdletBinding()]
param(
    [string]$Record = '',
    [string]$Base = '',
    [string]$Root = ''
)
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Root) { $Root = Split-Path -Parent (Split-Path -Parent $Here) }
. (Join-Path $Here 'CollectionRecord.ps1')
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Fail2($m) { Write-Host "STOP. $m" -ForegroundColor Red; exit 2 }

if (-not $Record) { $Record = Join-Path $Root 'records/collection.json' }
try { $r = Read-CollectionRecord $Record } catch { Fail2 $_.Exception.Message }
$ctx = [pscustomobject]@{ Plugins = $null; Last = $null; Refusals = @(); RecipeSources = @() }
try {
    $ctx.Plugins = Read-CollectionRecord (Join-Path $Root 'records/collection-plugins.json')
    $ctx.Last = Read-CollectionRecord (Join-Path $Root 'game/data/last-plugin.json')
    $recipe = Join-Path $Root 'game/data/last-plugin.recipe'
    if (Test-Path -LiteralPath $recipe -PathType Leaf) { $ctx.RecipeSources = @(Read-CollectionLastRecipeSources $recipe) }
} catch { Fail2 $_.Exception.Message }

Say ''
Say "  THORNSWOOD  -  the collection record, $([IO.Path]::GetFileName($Record))" 'White'
Say ''

$shape = @(Get-CollectionRecordShapeProblems $r)
if (-not $shape.Count) {
    # Each mod's page, as collection-permissions.js reads it.
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { Fail2 'node is not on this machine, and collection-permissions.js says what each mod''s page allows.' }
    $ids = (@(@($r.mods) | ForEach-Object { [long]$_.modId } | Sort-Object -Unique) -join ',')
    $out = @(& $node.Source (Join-Path $Here 'collection-permissions.js') check --record (Join-Path $Root 'records/collection-permissions.json') --mods $ids 2>&1 | ForEach-Object { "$_" })
    $code = $LASTEXITCODE
    if ($code -ne 0 -and $code -ne 1) { Fail2 ('collection-permissions.js could not check the mods: ' + ($out -join ' ')) }
    $ctx.Refusals = @($out | Where-Object { $_ } | ForEach-Object { $c = $_.Split("`t"); [pscustomobject]@{ modId = $c[0]; name = $c[1]; why = $c[2] } })
}
$problems = @(Get-CollectionRecordProblems $r $ctx)
Say ("  collection $($r.collection) as revision $($r.revision) and the change on it: " + @($r.mods).Count + ' files, ' + @($r.plugins).Count + ' plugins (' + @(@($r.plugins) | Where-Object { $_.enabled -ne $false }).Count + ' on)')

if ($Base) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $text = & git -C $Root show ($Base + ':records/collection.json') 2>&1
    $gc = $LASTEXITCODE
    $ErrorActionPreference = $old
    if ($gc -ne 0) {
        Say "  $Base has no records/collection.json, so the whole record is new" 'Yellow'
    } else {
        $b = ($text -join "`n") | ConvertFrom-Json
        # The base record as the collection.json the merge reads from Nexus.
        $asCollection = [pscustomobject]@{
            # A FOMOD file's answers go with it, as Vortex writes them in its
            # entry, so a file the base already has keeps them (#4603).
            mods        = @(@($b.mods) | ForEach-Object {
                    $e = [pscustomobject][ordered]@{ name = $_.name; source = [pscustomobject]@{ type = 'nexus'; modId = $_.modId; fileId = $_.fileId } }
                    if ($_.PSObject.Properties['choices'] -and $_.choices) { $e | Add-Member -NotePropertyName choices -NotePropertyValue $_.choices }
                    $e })
            pluginRules = [pscustomobject]@{ plugins = @(@($b.plugins) | Where-Object { @($_.after).Count } | ForEach-Object { [pscustomobject]@{ name = ([string]$_.name).ToLowerInvariant(); after = @(@($_.after) | ForEach-Object { ([string]$_).ToLowerInvariant() }) } }) }
        }
        $cs = Get-CollectionChangeSet $r $asCollection
        Say ''
        if ($cs.Empty -and -not $cs.Problems.Count) { Say "  against ${Base}: no change for Nexus" }
        else {
            Say "  against $Base, the merge asks Nexus for:" 'White'
            foreach ($l in (Format-CollectionChangeSet $cs)) { Say "    $l" }
            foreach ($l in $cs.Problems) { $problems += $l }
        }
    }
}

foreach ($n in (Get-CollectionRecordNotes $r $ctx)) { Say "  NOTE  $n" 'Cyan' }
Say ''
if ($problems.Count) {
    foreach ($p in $problems) { Say "  NO  $p" 'Red' }
    Say ''
    Say "  $($problems.Count) thing(s) to fix in $Record before it can be drafted." 'Red'
    exit 1
}
Say '  YES  the record holds: load order, permissions and the servers'' order' 'Green'
exit 0
