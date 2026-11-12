<#
  ContentPaths.ps1

  What a content build on the box reads and what it writes, worked out from
  scripts\mods\content-tables.json and the builders themselves (#5191). One
  copy, for Run-OnBox.ps1 (what it sends and what it brings back) and
  Build-ContentOnBox.ps1 (what a build's inputs are, and what it keeps).
  Defines functions and nothing else.
#>

<#
  The repository paths a content run reads, -Paths, and the paths it may
  write, -Watch, for the chain of content-tables.json and -Tool, at -Repo.

  Paths: scripts\mods, scripts\dev, game\content, game\data, records and
  layout.json, and whatever else a builder of the chain reads, uses or
  writes. Until #2962 the artifact held only those folders, so every builder
  that writes its table into game\gamemode.js stopped on the box with "No
  such file" for gamemode.js, and the one that reads docs\systems\cut-items.json
  would have too. Until #3425 the list named only the tables, so the K
  panel's book that Build-SpellTable.ps1 reads (game\ui) and the game
  scripts Build-MerchantGamemode.js embeds never went up, and the run
  stopped at the spell table; their uses name them now. And every script a
  builder, or -Tool, loads from beside it outside those folders, and what
  that one loads in turn: a .ps1's . (Join-Path $PSScriptRoot '<path>') and
  a .js's require('./<path>'). Build-RecipeTable.ps1 loads
  scripts\deploy\ServerOrder.ps1, which loads scripts\release\Read-JsonFile.ps1;
  game\merchant-commissions.js requires .\merchant-commission-state.js.

  Watch: game\, records\ and docs\systems\, and every file a step writes
  outside them, so a table a builder writes is never left on the box (#3425).

  Writes: every path a step of the chain says it writes, in the chain's
  order, each once.
#>
function Get-ThornswoodContentPaths {
    param(
        [Parameter(Mandatory = $true)][string]$Repo,
        [string]$Tool = ''
    )
    $chain = [IO.File]::ReadAllText((Join-Path $Repo 'scripts/mods/content-tables.json')) | ConvertFrom-Json
    $paths = @('scripts/mods', 'scripts/dev', 'game/content', 'game/data', 'records', 'layout.json')
    foreach ($s in @($chain.steps)) {
        foreach ($p in @(@($s.reads) + @($s.readsBack) + @($s.uses) + @($s.writes) | Where-Object { $_ })) {
            $p = [string]$p
            if (-not @($paths | Where-Object { $p -eq $_ -or $p.StartsWith($_ + '/') }).Count) { $paths += $p }
        }
    }
    $watch = @('game', 'records', 'docs/systems')
    $writes = @()
    foreach ($p in @($chain.steps | ForEach-Object { @($_.writes) } | Where-Object { $_ })) {
        $p = [string]$p
        if ($writes -notcontains $p) { $writes += $p }
        if (-not @($watch | Where-Object { $p -eq $_ -or $p.StartsWith($_ + '/') }).Count) { $watch += $p }
    }
    $load = New-Object 'Collections.Generic.Queue[string]'
    $tools = @(@($chain.steps | ForEach-Object { [string]$_.tool }) + @($chain.steps | ForEach-Object { @($_.uses) } | Where-Object { $_ -like '*.js' -or $_ -like '*.ps1' }))
    if ($Tool) { $tools += $Tool }
    foreach ($t in $tools) { $load.Enqueue([string]$t) }
    $seen = @{}
    while ($load.Count) {
        $t = $load.Dequeue()
        if ($seen.ContainsKey($t)) { continue }
        $seen[$t] = $true
        $full = Join-Path $Repo $t
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { continue }
        $text = [IO.File]::ReadAllText($full)
        $found = @([regex]::Matches($text, "\.\s+\(Join-Path\s+\`$PSScriptRoot\s+'([^']+)'\)") + [regex]::Matches($text, "require\(\s*['""](\.\.?/[^'""]+)['""]\s*\)"))
        foreach ($m in $found) {
            $parts = New-Object 'Collections.Generic.List[string]'
            foreach ($w in @(($t.Substring(0, $t.LastIndexOf('/')) + '/' + $m.Groups[1].Value.Replace('\', '/')).Split('/'))) {
                if ($w -eq '..') { if ($parts.Count) { $parts.RemoveAt($parts.Count - 1) } } elseif ($w -and $w -ne '.') { $parts.Add($w) }
            }
            $p = $parts -join '/'
            if ($t -like '*.js' -and -not [IO.Path]::GetExtension($p)) { $p += '.js' }
            if ($p -notmatch '^(scripts|game)/' -or -not (Test-Path -LiteralPath (Join-Path $Repo $p) -PathType Leaf)) { continue }
            if (-not @($paths | Where-Object { $p -eq $_ -or $p.StartsWith($_ + '/') }).Count) { $paths += $p }
            $load.Enqueue($p)
        }
    }
    return [pscustomobject]@{ Paths = $paths; Watch = $watch; Writes = $writes }
}
