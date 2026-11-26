<#
.SYNOPSIS
  Writes records\load-order.json, the load order the servers run and every content build reads (#5191), moved to the collection revision records\collection-plugins.json names.

.DESCRIPTION
  Writes records\load-order.json, the load order the servers run and every
  content build reads (#5191), moved to the collection revision
  records\collection-plugins.json names:

      pwsh scripts/mods/Set-LoadOrder.ps1
      pwsh scripts/mods/Set-LoadOrder.ps1 -Check

  WHY. A build is made from its commit alone, so the order it reads has to
  be in the commit. Until 16 Nov 2026 it was game\data\npc-population.json's
  loadOrder, a table the build itself writes, so each build read its order
  back from the build before it, and the tables could not leave git.

  WHEN. In the pull request that moves the records to a new revision, after
  records\collection-plugins.json and records\collection-dropped.json are
  that revision's: the order those two give, from the one recorded here
  (ContentPaths.ps1, Get-ThornswoodContentOrder). A plugin the revision
  adds goes on the end of its kind, what collection-dropped.json names goes,
  and no plugin moves to another index (docs\LIGHT-ORDER-DRIFT.md).

  -Check writes nothing and ends 1 when the record is not that order, which
  tests\test-5191-load-order.ps1 runs. Exit 0 when it is (or was written).
#>
[CmdletBinding()]
param(
    [string]$Repo = '',
    [switch]$Check
)
$ErrorActionPreference = 'Stop'
if (-not $Repo) { $Repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).ProviderPath }
. (Join-Path $PSScriptRoot 'ContentPaths.ps1')

$path = Join-Path $Repo 'records\load-order.json'
try { $order = Get-ThornswoodContentOrder -Repo $Repo }
catch { Write-Output ('STOP. ' + $_.Exception.Message + ' Nothing was written.'); exit 1 }
$text = Format-ThornswoodLoadOrderRecord -Slug $order.Slug -Revision $order.Revision -Order $order.Names
$now = if (Test-Path -LiteralPath $path -PathType Leaf) { [IO.File]::ReadAllText($path) } else { '' }
$say = "collection $($order.Slug) revision $($order.Revision), $($order.Names.Count) plugins" +
    $(if ($order.Added.Count) { ', adding ' + ($order.Added -join ', ') } else { '' }) +
    $(if ($order.Dropped.Count) { ', taking out ' + ($order.Dropped -join ', ') } else { '' })
if ($now -ceq $text) {
    Write-Host "records\load-order.json is the order of $say"
    exit 0
}
if ($Check) {
    Write-Host "records\load-order.json is not the order the records give ($say). Run pwsh scripts/mods/Set-LoadOrder.ps1 and commit records\load-order.json with the records."
    exit 1
}
[IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
Write-Host "wrote records\load-order.json: $say"
exit 0
