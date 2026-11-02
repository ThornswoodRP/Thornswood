<#
  PluginRuleLoops.ps1

  The plugin rules of a collection that LOOT can never keep, because they go
  against an order the game itself sets. Dot-sourced by
  Install-NexusRevision.ps1 (which stops a revision on one) and by
  Check-CollectionRules.ps1 (which says NO to one on an installed collection).

  WHY. Revision 5 of the collection added cheddars_mashups.esl with the rule
  "load after Immersive Weapons.esp, Hothtrooper44_ArmorCompilation.esp and
  ZIA_Complete Pack.esp". The game loads an .esl as a master whatever its
  header says, and every master before every plugin that is not one, so the
  game puts it above all three, and the rule says below. LOOT sorts with both
  and finds them going round: Vortex showed, on a clean install of revision 5
  on 27 October, "Cyclic interaction ... immersive weapons.esp -->
  cheddars_mashups.esl --> immersive weapons.esp", the same for the other two,
  with a box offering to remove the rule. Nothing read the rules against what
  the plugins are: Install-NexusRevision held them to the collection's plugin
  list, which has the .esl at the end where the game never puts it, and
  Check-CollectionRules leaves light plugins out. This reads them against the
  plugins' own headers.

  THE GAME'S OWN ORDER, which LOOT holds as hard as any rule (libloot's
  sorting, the edges it adds before any metadata):
    - a plugin the game loads as a master (an .esm or .esl name, or the 0x1
      flag) goes before every plugin it does not. One exception: a plugin
      that is a master of a master (named in its MAST records, or theirs) is
      hoisted above it, so no order between those two is set this way;
    - every plugin goes after each master its header names.
  A rule "B loads after A" is one more such edge, A before B. A rule is a loop
  when the plugins it names are already ordered the other way by these edges
  and the other rules: then no order keeps everything, and LOOT says so.

  Read only. Keep it ASCII. It runs in PowerShell 7.
#>

# The flags and declared masters out of a plugin's TES4 header, or $null when
# the file is not there or is not a plugin. Master is what the game loads as
# one: an .esm or .esl name, or 0x1 in the flags.
function Read-PluginRuleHeader([string]$Path) {
    if (-not [IO.File]::Exists($Path)) { return $null }
    $fs = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
        $head = New-Object byte[] 24
        if ($fs.Read($head, 0, 24) -lt 24) { return $null }
        if ([Text.Encoding]::ASCII.GetString($head, 0, 4) -ne 'TES4') { return $null }
        $size = [BitConverter]::ToUInt32($head, 4)
        $flags = [BitConverter]::ToUInt32($head, 8)
        $size = [int][Math]::Min([uint32]1048576, $size)
        $b = New-Object byte[] $size
        $got = 0
        while ($got -lt $size) {
            $n = $fs.Read($b, $got, $size - $got)
            if ($n -le 0) { break }
            $got += $n
        }
    } finally { $fs.Close() }
    $masters = New-Object Collections.Generic.List[string]
    $at = 0
    # The header's fields: four letters, a UInt16 length, then the data.
    while ($at + 6 -le $got) {
        $type = [Text.Encoding]::ASCII.GetString($b, $at, 4)
        $len = [BitConverter]::ToUInt16($b, $at + 4)
        if ($at + 6 + $len -gt $got) { break }
        if ($type -eq 'MAST') { [void]$masters.Add([Text.Encoding]::GetEncoding(1252).GetString($b, $at + 6, $len).TrimEnd([char]0)) }
        $at += 6 + $len
    }
    $name = [IO.Path]::GetFileName($Path)
    return [pscustomobject]@{
        Master  = ($name -match '\.(esm|esl)$') -or (($flags -band 1) -ne 0)
        Light   = ($name -match '\.esl$') -or (($flags -band 0x200) -ne 0)
        Masters = [string[]]$masters.ToArray()
    }
}

<#
  Every rule that makes a loop.
    $Rules    the collection's pluginRules.plugins, each { name, after, before }
    $Headers  a hashtable, plugin name to Read-PluginRuleHeader's answer, for
              every plugin the game loads (the enabled ones)
  A rule naming a plugin that is not in $Headers orders nothing the game
  loads, and is left out, as Install-NexusRevision leaves it out.
  Returns one object per loop: Rule (the plugin the rule is about), Before
  and After (the rule's edge, After loads after Before), Loop, the plugins
  round the loop the way Vortex shows one ("a --> b --> a", each arrow
  "loads before"), Why naming what sets each step, and Nodes.
#>
function Get-PluginRuleLoops($Rules, [hashtable]$Headers) {
    $cmp = [StringComparer]::OrdinalIgnoreCase
    $names = New-Object Collections.Generic.List[string]
    $hdr = [Collections.Generic.Dictionary[string, object]]::new($cmp)
    # In name order, so the same plugins give the same loops in the same order
    # on every run, whatever order the hashtable keeps its keys in.
    foreach ($k in @($Headers.Keys | Sort-Object)) {
        if ($null -eq $Headers[$k] -or $hdr.ContainsKey([string]$k)) { continue }
        $hdr[[string]$k] = $Headers[$k]
        [void]$names.Add([string]$k)
    }
    # Edges, each "From loads before To", with what sets it.
    $next = [Collections.Generic.Dictionary[string, object]]::new($cmp)
    $why = [Collections.Generic.Dictionary[string, string]]::new($cmp)
    foreach ($n in $names) { $next[$n] = New-Object Collections.Generic.List[string] }
    $add = {
        param([string]$a, [string]$b, [string]$w)
        $key = $a + '|' + $b
        if ($why.ContainsKey($key)) { return }
        $why[$key] = $w
        [void]$next[$a].Add($b)
    }
    # Each plugin's masters, and theirs: the ones it hoists.
    $hoists = [Collections.Generic.Dictionary[string, object]]::new($cmp)
    foreach ($n in $names) {
        $all = [Collections.Generic.HashSet[string]]::new($cmp)
        $todo = New-Object Collections.Generic.Queue[string]
        foreach ($m in $hdr[$n].Masters) { $todo.Enqueue($m) }
        while ($todo.Count) {
            $m = $todo.Dequeue()
            if (-not $all.Add($m)) { continue }
            if ($hdr.ContainsKey($m)) { foreach ($mm in $hdr[$m].Masters) { $todo.Enqueue($mm) } }
        }
        $hoists[$n] = $all
    }
    # Every name as the plugin list spells it, whatever case a rule or a
    # header gives it in.
    $canon = [Collections.Generic.Dictionary[string, string]]::new($cmp)
    foreach ($n in $names) { $canon[$n] = $n }
    foreach ($n in $names) {
        foreach ($m in $hdr[$n].Masters) {
            if ($hdr.ContainsKey($m)) { & $add $canon[$m] $n ($n + ' names ' + $canon[$m] + ' as a master') }
        }
    }
    foreach ($a in $names) {
        if (-not $hdr[$a].Master) { continue }
        foreach ($b in $names) {
            if ($hdr[$b].Master -or $hoists[$a].Contains($b)) { continue }
            & $add $a $b ($a + ' loads as a master and ' + $b + ' does not')
        }
    }
    $ruleEdges = New-Object Collections.Generic.List[object]
    foreach ($r in @($Rules)) {
        if ($null -eq $r -or -not ($r.PSObject.Properties.Name -contains 'name')) { continue }
        $p = "$($r.name)".Trim()
        if (-not $hdr.ContainsKey($p)) { continue }
        $p = $canon[$p]
        $pairs = @()
        if ($r.PSObject.Properties.Name -contains 'after') { foreach ($x in @($r.after)) { $x = "$x".Trim(); if ($x) { $pairs += ,@($x, $p) } } }
        if ($r.PSObject.Properties.Name -contains 'before') { foreach ($x in @($r.before)) { $x = "$x".Trim(); if ($x) { $pairs += ,@($p, $x) } } }
        foreach ($pr in $pairs) {
            if (-not $hdr.ContainsKey($pr[0]) -or -not $hdr.ContainsKey($pr[1])) { continue }
            $a = $canon[$pr[0]]; $b = $canon[$pr[1]]
            & $add $a $b ('the rule ' + $b + ' loads after ' + $a)
            [void]$ruleEdges.Add([pscustomobject]@{ Rule = $p; Before = $a; After = $b })
        }
    }
    # A rule edge Before -> After is a loop when After already reaches Before.
    # First over the game's own edges alone: a rule that can never hold
    # whatever the other rules say, as revision 5's for cheddars_mashups.esl
    # (three loops, the three Vortex showed). Only when there is none, over
    # the rules as well, for rules that go round with each other. A long loop
    # that passes through a shorter one already found is that one again (on
    # revision 5, 30 more rules closed a loop only through the .esl's), so it
    # is not said twice.
    $ruleKey = [Collections.Generic.HashSet[string]]::new($cmp)
    foreach ($e in $ruleEdges) { [void]$ruleKey.Add($e.Before + '|' + $e.After) }
    $found = New-Object Collections.Generic.List[object]
    foreach ($withRules in @($false, $true)) {
        foreach ($e in $ruleEdges) {
            $from = @{}
            $q = New-Object Collections.Generic.Queue[string]
            $q.Enqueue($e.After)
            $from[$e.After.ToLowerInvariant()] = $null
            $hit = $false
            while ($q.Count -and -not $hit) {
                $x = $q.Dequeue()
                foreach ($y in $next[$x]) {
                    if (-not $withRules -and $ruleKey.Contains($x + '|' + $y)) { continue }
                    $k = $y.ToLowerInvariant()
                    if ($from.ContainsKey($k)) { continue }
                    $from[$k] = $x
                    if ($cmp.Equals($y, $e.Before)) { $hit = $true; break }
                    $q.Enqueue($y)
                }
            }
            if (-not $hit) { continue }
            $path = New-Object Collections.Generic.List[string]
            $c = $e.Before
            while ($null -ne $c) { $path.Insert(0, $c); $c = $from[$c.ToLowerInvariant()] }
            # After ... Before, then the rule's own edge back to After.
            [void]$path.Add($e.After)
            $steps = New-Object Collections.Generic.List[string]
            for ($i = 0; $i + 1 -lt $path.Count; $i++) { [void]$steps.Add($why[$path[$i] + '|' + $path[$i + 1]]) }
            [void]$found.Add([pscustomobject]@{
                Rule   = $e.Rule
                Before = $e.Before
                After  = $e.After
                Loop   = ($path -join ' --> ')
                Why    = [string[]]$steps.ToArray()
                Nodes  = [string[]]$path.ToArray()
            })
        }
        if ($found.Count) { break }
    }
    $out = New-Object Collections.Generic.List[object]
    foreach ($l in @($found | Sort-Object { $_.Nodes.Count }, Loop)) {
        $set = [Collections.Generic.HashSet[string]]::new([string[]]$l.Nodes, $cmp)
        $again = $false
        foreach ($o in $out) { if ($set.IsSupersetOf([string[]]$o.Nodes)) { $again = $true; break } }
        if (-not $again) { [void]$out.Add($l) }
    }
    return $out.ToArray()
}
