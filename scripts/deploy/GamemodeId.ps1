<#
  GamemodeId.ps1

  What the gamemode says it is as it loads, worked out here the same way, so
  a deploy can wait for the server to say it loaded what was sent (#3196,
  #5191): the git blob id of gamemode.js and the git tree id of its tables
  folder. Dot-sourced by Reload.ps1, which sends both functions to the box in
  front of its block, and by the scripts that send the tables
  (Deploy-DevGamemode.ps1, Deploy-Server.ps1, Publish-Server.ps1,
  Deploy-Gamemode.ps1). tests\test-3196-dev-reload.ps1 holds both ids to
  git's and the gamemode's own.

  Keep it ASCII: the function text goes to Windows PowerShell 5.1 on the box.
#>

# The git blob id of a gamemode.js, the way the gamemode works it out at load
# (game/gamemode.js, gamemodeId): every CR LF made LF, then git's blob hash, so
# it is the id git hash-object prints for the committed file. Latin-1 maps
# every byte to one char and back, so the replace touches nothing else.
function Get-ThornswoodGamemodeBlob([string]$Path) {
  $latin = [Text.Encoding]::GetEncoding(28591)
  $lf = $latin.GetBytes($latin.GetString([IO.File]::ReadAllBytes($Path)).Replace("`r`n", "`n"))
  $head = $latin.GetBytes('blob ' + $lf.Length + [char]0)
  $sha = [Security.Cryptography.SHA1]::Create()
  try {
    $null = $sha.TransformBlock($head, 0, $head.Length, $null, 0)
    $null = $sha.TransformFinalBlock($lf, 0, $lf.Length)
    return (-join @($sha.Hash | ForEach-Object { $_.ToString('x2') }))
  } finally { $sha.Dispose() }
}

# The git tree id of a folder of gamemode tables, the way the gamemode works
# it out at load (game/gamemode.js, tableFolder): each NAME.json file's blob
# as Get-ThornswoodGamemodeBlob gives it, in git's order, then git's tree
# hash, so it is the id git rev-parse <commit>:game/gamemode-tables prints.
# '' when there is no folder: a gamemode from before #5191, which has none.
function Get-ThornswoodTablesTree([string]$Dir) {
  if (-not (Test-Path -LiteralPath $Dir -PathType Container)) { return '' }
  $names = [string[]]@(Get-ChildItem -LiteralPath $Dir -File -Force | Where-Object { $_.Name -cmatch '^[A-Z][A-Z0-9_]*\.json$' } | ForEach-Object { $_.Name })
  [Array]::Sort($names, [StringComparer]::Ordinal)
  $latin = [Text.Encoding]::GetEncoding(28591)
  $body = New-Object IO.MemoryStream
  foreach ($n in $names) {
    $head = $latin.GetBytes('100644 ' + $n + [char]0)
    $body.Write($head, 0, $head.Length)
    $hex = Get-ThornswoodGamemodeBlob (Join-Path $Dir $n)
    for ($i = 0; $i -lt 40; $i += 2) { $body.WriteByte([Convert]::ToByte($hex.Substring($i, 2), 16)) }
  }
  $b = $body.ToArray()
  $head = $latin.GetBytes('tree ' + $b.Length + [char]0)
  $sha = [Security.Cryptography.SHA1]::Create()
  try {
    $null = $sha.TransformBlock($head, 0, $head.Length, $null, 0)
    $null = $sha.TransformFinalBlock($b, 0, $b.Length)
    return (-join @($sha.Hash | ForEach-Object { $_.ToString('x2') }))
  } finally { $sha.Dispose() }
}

# The table files of a folder, the ones the gamemode reads: NAME.json, named
# like the constant that holds the table, in git's order.
function Get-ThornswoodTableFiles([string]$Dir) {
  if (-not (Test-Path -LiteralPath $Dir -PathType Container)) { return @() }
  $files = @(Get-ChildItem -LiteralPath $Dir -File -Force | Where-Object { $_.Name -cmatch '^[A-Z][A-Z0-9_]*\.json$' })
  $names = [string[]]@($files | ForEach-Object { $_.Name })
  $byName = @{}
  foreach ($f in $files) { $byName[$f.Name] = $f }
  [Array]::Sort($names, [StringComparer]::Ordinal)
  foreach ($n in $names) { $byName[$n] }
}
