<#
.SYNOPSIS
  The reference load order a release carries (profile\plugins.txt and
  loadorder.txt), made from the commit's records.

.DESCRIPTION
  A launcher compares the game's plugin list with its reference list
  (Profile\Default\plugins.txt, the package's profile\, Verify.cs), and its
  Fix switches on only what that list enables. The server's order is the
  Release's catalogue order (ServerOrder.cs, #6209), which the box's content
  build reads from records\load-order.json (ContentPaths.ps1). So the
  reference list is made from the same record (#6298).

  Until 16 Nov 2026 every merge release packed the :golden: lists of the
  last Ship from One, recorded on 10 Nov at collection revision 7. Dev's
  server moved to revision 8's 107 plugins with build-1.3.75, and every dev
  launcher refused Play at Improved Eyes Skyrim.esp: its list did not
  enable it, so Fix could not.

  plugins.txt: the record's header lines (Vortex's), then each plugin of
  records\load-order.json that the collection puts in Data
  (records\collection.json "plugins") or that is Thornswood's own
  (RepoPlugins.ps1), in the record's order, enabled, as Vortex writes it.
  The game's own masters and the storefront files are not in it, as Vortex
  leaves them out.

  loadorder.txt: the record's lines, with each plugin the new plugins.txt
  enables and the old list lacks put right after the plugin before it in
  plugins.txt, so the two lists keep one order.

  Both keep the old files' byte order mark and line endings.

  Defines functions and nothing else.
#>

. (Join-Path $PSScriptRoot 'Read-JsonFile.ps1')
. (Join-Path $PSScriptRoot 'RepoPlugins.ps1')

function Get-ThornswoodReferencePlugins([string]$RepoDir) {
    $orderPath = Join-Path $RepoDir 'records/load-order.json'
    $collPath = Join-Path $RepoDir 'records/collection.json'
    foreach ($p in $orderPath, $collPath) {
        if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw "$p is not there, so there is no reference load order to make." }
    }
    $order = ConvertFrom-ThornswoodJson ([IO.File]::ReadAllText($orderPath)) $orderPath
    $coll = ConvertFrom-ThornswoodJson ([IO.File]::ReadAllText($collPath)) $collPath
    if (-not $order.PSObject.Properties['loadOrder']) { throw "$orderPath has no loadOrder." }
    if (-not $coll.PSObject.Properties['plugins']) { throw "$collPath has no plugins." }
    $theirs = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($p in @($coll.plugins)) { if ($p.name) { [void]$theirs.Add([string]$p.name) } }
    $names = @(@($order.loadOrder) | ForEach-Object { [string]$_ } | Where-Object { $_ -and ($theirs.Contains($_) -or (Test-ThornswoodRepoPlugin $_)) })
    foreach ($o in $ThornswoodRepoPlugins) {
        if (-not (@($names) -icontains $o)) { throw "records\load-order.json does not name $o, so the reference load order would not load it." }
    }
    return [string[]]$names
}

function Split-ThornswoodList([byte[]]$Bytes) {
    $bom = $Bytes.Length -ge 3 -and $Bytes[0] -eq 0xEF -and $Bytes[1] -eq 0xBB -and $Bytes[2] -eq 0xBF
    $text = (New-Object Text.UTF8Encoding($false)).GetString($Bytes, $(if ($bom) { 3 } else { 0 }), $Bytes.Length - $(if ($bom) { 3 } else { 0 }))
    $nl = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
    $lines = [System.Collections.Generic.List[string]]::new([string[]]($text -split "`r?`n"))
    if ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -eq '') { $lines.RemoveAt($lines.Count - 1) }
    [pscustomobject]@{ Bom = $bom; Nl = $nl; Lines = $lines }
}

function Join-ThornswoodList($Shape, [string[]]$Lines) {
    $text = ($Lines -join $Shape.Nl) + $Shape.Nl
    $body = (New-Object Text.UTF8Encoding($false)).GetBytes($text)
    if (-not $Shape.Bom) { return $body }
    return [byte[]](@(0xEF, 0xBB, 0xBF) + $body)
}

# Rewrites ProfileDir\plugins.txt and loadorder.txt (the record's, already
# there) from the records, and returns the plugins the new list enables
# that the record's did not.
function Set-ThornswoodReferenceList([string]$ProfileDir, [string]$RepoDir) {
    $names = Get-ThornswoodReferencePlugins $RepoDir
    $pPath = Join-Path $ProfileDir 'plugins.txt'
    $lPath = Join-Path $ProfileDir 'loadorder.txt'
    foreach ($p in $pPath, $lPath) { if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw "$p is not there to make the reference load order over." } }

    $plugins = Split-ThornswoodList ([IO.File]::ReadAllBytes($pPath))
    $was = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $header = New-Object System.Collections.Generic.List[string]
    foreach ($l in $plugins.Lines) {
        if ($l.StartsWith('#')) { $header.Add($l) }
        elseif ($l.StartsWith('*')) { [void]$was.Add($l.Substring(1).Trim()) }
    }
    $out = New-Object System.Collections.Generic.List[string]
    $out.AddRange($header)
    foreach ($n in $names) { $out.Add('*' + $n) }
    [IO.File]::WriteAllBytes($pPath, (Join-ThornswoodList $plugins $out.ToArray()))

    $lo = Split-ThornswoodList ([IO.File]::ReadAllBytes($lPath))
    $lines = $lo.Lines
    for ($i = 0; $i -lt $names.Count; $i++) {
        $n = $names[$i]
        $at = -1
        for ($k = 0; $k -lt $lines.Count; $k++) { if ([string]::Equals($lines[$k].Trim(), $n, [StringComparison]::OrdinalIgnoreCase)) { $at = $k; break } }
        if ($at -ge 0) { continue }
        # After the plugin before it in plugins.txt; at the end when none is.
        $after = -1
        for ($j = $i - 1; $j -ge 0 -and $after -lt 0; $j--) {
            for ($k = 0; $k -lt $lines.Count; $k++) { if ([string]::Equals($lines[$k].Trim(), $names[$j], [StringComparison]::OrdinalIgnoreCase)) { $after = $k; break } }
        }
        if ($after -lt 0) { $lines.Add($n) } else { $lines.Insert($after + 1, $n) }
    }
    [IO.File]::WriteAllBytes($lPath, (Join-ThornswoodList $lo $lines.ToArray()))

    return [string[]]@($names | Where-Object { -not $was.Contains($_) })
}
