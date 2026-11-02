<#
  New-CollectionRecord.ps1

  Writes records\collection.json, the collection as it should be (#5189),
  from a revision laid out by Install-NexusRevision.ps1 -Record -KeepPlugins:

      pwsh scripts/release/Nexus-Run.ps1 -Line 'Install-NexusRevision -Revision 6 -KeepPlugins'
      pwsh scripts/release/New-CollectionRecord.ps1 -Layout <the record folder Nexus-Run printed>

  WHY. The record says what each plugin's header says (master, light, its
  masters), because the pull request's check reads the load order from the
  record and no repository holds the plugins. Those facts are read here, from
  the plugins the layout kept, never typed in. The mods, the plugins each
  file puts in Data, the order and the rules come from layout.json and
  files.txt, which Install-NexusRevision wrote from the revision itself.

  It is how the record is first made, and how it is made again from any
  published revision. A change to the record is made by hand in a pull
  request (docs\COLLECTION-CHANGES.md); Publish-CollectionRecord.ps1 makes a
  record from the draft the same way and holds the two to each other.

  -Out writes somewhere else than records\collection.json. Its dropped list
  is empty, as a published revision's is.

  -Plugin prints the record's line for each plugin file named, read from
  its own header, for a pull request that adds a mod: copy each line into
  "plugins" where the plugin goes and fill in its "after" rule
  (docs\COLLECTION-CHANGES.md). It writes nothing.

      pwsh scripts/release/New-CollectionRecord.ps1 -Plugin <the plugin in Vortex's staging folder>
#>
[CmdletBinding(DefaultParameterSetName = 'Layout')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Layout')][string]$Layout,
    [Parameter(ParameterSetName = 'Layout')][string]$Out = '',
    [Parameter(Mandatory = $true, ParameterSetName = 'Plugin')][string[]]$Plugin
)
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'CollectionRecord.ps1')
if ($PSCmdlet.ParameterSetName -eq 'Plugin') {
    $bad = 0
    foreach ($f in $Plugin) {
        $line = ConvertTo-CollectionPluginLine $f
        if ($null -eq $line) { Write-Host "  NO  $f is not a plugin with a TES4 header." -ForegroundColor Red; $bad++; continue }
        Write-Output $line
    }
    if ($bad) { exit 1 }
    exit 0
}
if (-not $Out) { $Out = Join-Path $Here '..\..\records\collection.json' }
$Out = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Out)
try { $r = New-CollectionRecordFromLayout $Layout } catch { Write-Host "STOP. $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
$problems = @(Get-CollectionRecordShapeProblems $r)
if ($problems.Count) {
    foreach ($p in $problems) { Write-Host "  NO  $p" -ForegroundColor Red }
    Write-Host "STOP. The layout in $Layout does not make a record of the shape the check reads; nothing was written." -ForegroundColor Red
    exit 1
}
[IO.File]::WriteAllText($Out, (ConvertTo-CollectionRecordText $r), (New-Object Text.UTF8Encoding($false)))
Write-Host ("  wrote $Out`: collection $($r.collection) revision $($r.revision), " + @($r.mods).Count + ' files, ' + @($r.plugins).Count + ' plugins') -ForegroundColor Green
Write-Host '  Check it with: pwsh scripts/release/Check-CollectionRecord.ps1'
exit 0
