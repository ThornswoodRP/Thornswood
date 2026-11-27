<#
.SYNOPSIS
  Writes the engine pin's lines in THIRD-PARTY.md and site\data\site\credits.md
  from the records, or with -Check says which ones differ from them.

.DESCRIPTION
  Issue #5148. The pin's commit, the upstream it starts from, the server
  module's SHA256 and build time and the front's size were typed into five
  places by hand at every pin, and went stale between pins. Now each is a
  marked block (scripts\release\EnginePin.ps1 says what a block is) written
  from records\server-build.json, records\client-build.json and
  records\front-build.json. The measured library tables come from
  records\client-licences.json. Update-EnginePin.ps1 runs this at every pin move;
  tests\test-5148-engine-pin.ps1 runs it with -Check in the build check, so a
  hand edit inside a block, or a record moved without the pages, is red.

  Which engine main runs is read from the page as it is ("Main remains on")
  unless -MainCommit says it: a pin move does not change what main runs.

  Exit 0: written, or with -Check every block matches. 1: a block differs
  (-Check) or the records do not name one engine; the lines say which.

.EXAMPLE
  pwsh scripts/release/Write-EnginePinText.ps1
  After a pin move: the blocks written from the records.

.EXAMPLE
  pwsh scripts/release/Write-EnginePinText.ps1 -MainCommit <the commit main's release carries>
  After a main Ship that carried a new engine.
#>
[CmdletBinding()]
param(
    [string]$MainCommit,
    [switch]$Check
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
. (Join-Path $here 'ForkEngineBuild.ps1')
. (Join-Path $here 'EnginePin.ps1')
$repo = (Resolve-Path -LiteralPath (Join-Path $here '..\..')).ProviderPath
try {
    $out = @(Update-EnginePinText -Repo $repo -Main $MainCommit -Check:$Check)
} catch {
    Write-Host ('STOP. ' + $_.Exception.Message)
    exit 1
}
if ($Check) {
    if ($out.Count) {
        foreach ($l in $out) { Write-Host ("differs from the records: $l") }
        Write-Host 'Run pwsh scripts/release/Write-EnginePinText.ps1 to write them from the records, never by hand.'
        exit 1
    }
    Write-Host 'every engine pin block matches the records'
    exit 0
}
if ($out.Count) { foreach ($p in $out) { Write-Host "wrote $p" } } else { Write-Host 'every engine pin block already matched the records' }
exit 0
