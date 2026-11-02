<#
  GamemodeTables.ps1

  Where a builder puts a table the gamemode reads (#5191).

  Until #5191 every builder in scripts\mods\content-tables.json pasted its
  table into game\gamemode.js, so every content change rewrote the same lines
  of that file and no two content pull requests could merge side by side. Now
  each table is its own file, game\gamemode-tables\<NAME>.json, and the
  gamemode's `const NAME = table('NAME')` reads it when it loads.

  The file is laid out one entry to a line down to the second level and
  compact below that, so two changes to different rows are two lines git
  merges, written LF and UTF-8 with no BOM. The same rule is GamemodeTables.js
  and gamemode_tables.py; tests\test-5191-gamemode-tables.js holds the three
  to each other.

      . (Join-Path $PSScriptRoot 'GamemodeTables.ps1')
      $changed = Write-GamemodeTable 'ORES_BY_BASE' $json
#>

$script:GamemodeTableDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\game\gamemode-tables'))

function Format-GamemodeTable([string]$Text) {
    $sb = New-Object System.Text.StringBuilder ($Text.Length + 1024)
    $depth = 0
    $inString = $false
    $n = $Text.Length
    for ($i = 0; $i -lt $n; $i++) {
        $c = $Text[$i]
        if ($inString) {
            [void]$sb.Append($c)
            if ($c -eq [char]'\') { $i++; [void]$sb.Append($Text[$i]) }
            elseif ($c -eq [char]'"') { $inString = $false }
            continue
        }
        if ($c -eq [char]' ' -or $c -eq [char]"`t" -or $c -eq [char]"`r" -or $c -eq [char]"`n") { continue }
        if ($c -eq [char]'"') { $inString = $true; [void]$sb.Append($c); continue }
        if ($c -eq [char]'{' -or $c -eq [char]'[') {
            $depth++
            [void]$sb.Append($c)
            $j = $i + 1
            while ($j -lt $n -and [char]::IsWhiteSpace($Text[$j])) { $j++ }
            if ($depth -le 2 -and $j -lt $n -and $Text[$j] -ne [char]'}' -and $Text[$j] -ne [char]']') { [void]$sb.Append("`n") }
            continue
        }
        if ($c -eq [char]'}' -or $c -eq [char]']') {
            $last = if ($sb.Length) { $sb[$sb.Length - 1] } else { [char]0 }
            if ($depth -le 2 -and $last -ne [char]'{' -and $last -ne [char]'[') { [void]$sb.Append("`n") }
            $depth--
            [void]$sb.Append($c)
            continue
        }
        if ($c -eq [char]',' -and $depth -le 2) { [void]$sb.Append(",`n"); continue }
        [void]$sb.Append($c)
    }
    [void]$sb.Append("`n")
    return $sb.ToString()
}

function Get-GamemodeTableFile([string]$Name) {
    if ($Name -cnotmatch '^[A-Z][A-Z0-9_]*$') { throw "a gamemode table is named like the constant that holds it, not $Name" }
    return (Join-Path $script:GamemodeTableDir ($Name + '.json'))
}

# Writes the table $Name from its JSON text and says whether the file changed.
# The text has to parse: a table that does not would stop the gamemode.
function Write-GamemodeTable([string]$Name, [string]$Json) {
    $null = $Json | ConvertFrom-Json -Depth 100 -ErrorAction Stop
    $body = Format-GamemodeTable $Json
    $f = Get-GamemodeTableFile $Name
    if ([System.IO.File]::Exists($f) -and [System.IO.File]::ReadAllText($f) -ceq $body) { return $false }
    [System.IO.Directory]::CreateDirectory($script:GamemodeTableDir) | Out-Null
    [System.IO.File]::WriteAllText($f, $body, (New-Object System.Text.UTF8Encoding($false)))
    return $true
}
