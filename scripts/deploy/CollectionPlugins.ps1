<#
  CollectionPlugins.ps1

  Holds the plugins a deploy sends to the collection's own bytes (#2019).
  A full deploy (Deploy-Server.ps1, Deploy-DevGamemode.ps1 -LoadOrder) sends
  a plugin from the deploying machine's -Data whenever its size differs from
  the box's copy. Nothing held those files to the collection, so on 5 Oct a
  3BBB.esp from another installer choice (3,288 bytes, not the collection's
  20,257) went to both servers and blocked Play for everybody who installed
  the collection.

  records\collection-plugins.json is the collection's plugins, one row each:

      { "version": 1,
        "builtBy": "scripts/mods/New-CollectionPluginRecord.ps1",
        "collection": "7essxf", "revision": 2,
        "plugins": [ { "name": "3BBB.esp", "size": 20257, "sha256": "ce4f..." } ] }

  scripts\mods\New-CollectionPluginRecord.ps1 writes it from a folder.

      Assert-ThornswoodCollectionPlugins -RecordPath <json> -Files <paths> -What 'this deploy'

  Throws, naming every plugin it would send that is not in the record, or is
  in it at another size or sha256. Only the plugins about to go are read, so
  a deploy that sends nothing reads nothing. Our own plugins
  ($ThornswoodRepoPlugins, RepoPlugins.ps1) are built in this repo and sent
  from it, so they are never in the record and are passed in -Exempt. With no record at all, a deploy that would send any
  other plugin is refused: the record is the only thing that can say those
  bytes are the collection's, and sending them unchecked is what #2019 was.

  Dot-sourced by the two deploy scripts; defines functions and nothing else.
  Runs in PowerShell 7.
#>
. (Join-Path $PSScriptRoot '..\release\Read-JsonFile.ps1')
. (Join-Path $PSScriptRoot '..\release\RecordShape.ps1')
. (Join-Path $PSScriptRoot '..\release\RepoPlugins.ps1')

function Get-ThornswoodPluginSha256([string]$Path) {
    $Path = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    $fs = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try { $h = $sha.ComputeHash($fs) } finally { $fs.Dispose(); $sha.Dispose() }
    return (($h | ForEach-Object { $_.ToString('x2') }) -join '')
}

# The record as a name -> row table (names compared without case, as Windows
# does), or $null when the file is not there. A record that is there and
# wrong stops here, named, rather than letting every plugin through.
function Read-ThornswoodCollectionPluginRecord([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    $doc = ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $Path -Raw) $Path
    $ver = $doc.PSObject.Properties['version']
    if (-not $ver -or [string]$ver.Value -ne '1') { throw "$Path is not a version 1 collection plugin record" }
    $rows = $doc.PSObject.Properties['plugins']
    if (-not $rows -or $null -eq $rows.Value) { throw "$Path has no plugins list" }
    $table = New-Object 'System.Collections.Generic.Dictionary[string,object]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($r in @($rows.Value)) {
        $n = [string]$r.name; $s = $r.size; $h = [string]$r.sha256
        if (-not $n -or $null -eq $s -or $h -notmatch '^[0-9a-fA-F]{64}$') { throw "$Path has a row without a name, a size and a sha256" }
        if ($table.ContainsKey($n)) { throw "$Path lists $n twice" }
        $table[$n] = [pscustomobject]@{ Name = $n; Size = [int64]$s; Sha256 = $h.ToLowerInvariant() }
    }
    # The same contract Check-Records holds the committed record to (#2180),
    # after the row checks above so their messages come first.
    $shape = @(Get-ThornswoodRecordProblems -Doc $doc -Kind collection-plugins)
    if ($shape.Count) { throw ("$Path is not a collection-plugins record this checkout can trust: " + ($shape -join '; ')) }
    return , $table
}

# One line per plugin that is not the collection's; none when all are.
function Get-ThornswoodCollectionPluginProblems($Record, [string[]]$Files) {
    $out = @()
    foreach ($f in @($Files)) {
        if (-not $f) { continue }
        $n = [IO.Path]::GetFileName($f)
        if (-not $Record.ContainsKey($n)) { $out += "$n  (not in the collection's record)"; continue }
        $want = $Record[$n]
        $len = (Get-Item -LiteralPath $f).Length
        if ($len -ne $want.Size) { $out += ('{0}  (this machine''s is {1:N0} bytes, the collection''s is {2:N0})' -f $n, $len, $want.Size); continue }
        $sum = Get-ThornswoodPluginSha256 $f
        if ($sum -ne $want.Sha256) { $out += ('{0}  (sha256 {1}, the collection''s is {2})' -f $n, $sum.Substring(0, 12), $want.Sha256.Substring(0, 12)) }
    }
    return $out
}

function Assert-ThornswoodCollectionPlugins {
    param(
        [Parameter(Mandatory)][string]$RecordPath,
        [AllowEmptyCollection()][string[]]$Files = @(),
        [string[]]$Exempt = $ThornswoodRepoPlugins,
        [string]$What = 'this deploy'
    )
    $check = @(@($Files) | Where-Object { $_ -and ($Exempt -notcontains [IO.Path]::GetFileName($_)) })
    if ($check.Count -eq 0) { return }
    $record = Read-ThornswoodCollectionPluginRecord $RecordPath
    if ($null -eq $record) {
        throw ("Refused: $What would send {0} plugin(s) ({1}) and there is no {2} to say they are the collection's. Nothing was sent. Make one with scripts\mods\New-CollectionPluginRecord.ps1 from a folder that holds the collection's plugins." -f
            $check.Count, (($check | ForEach-Object { [IO.Path]::GetFileName($_) }) -join ', '), $RecordPath)
    }
    $bad = @(Get-ThornswoodCollectionPluginProblems $record $check)
    if ($bad.Count) {
        throw ("Refused: $What would send {0} plugin(s) that are not the collection's:`n    {1}`nNothing was sent. Put the collection's file in -Data (reinstall that mod in Vortex with the collection's choices) and deploy again." -f
            $bad.Count, ($bad -join "`n    "))
    }
}
