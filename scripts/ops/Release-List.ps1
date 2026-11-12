<#
  Release-List.ps1

  The release list a game server lets go of at its next start (#2351), as
  Reset-Character.ps1, Wipe-Saves.ps1 (#2668) and New-Character.ps1 (#2673)
  write it. Dot-sourced by all three; it does nothing on its own.
  $ThornswoodReleaseList is the text of the functions below, sent with the
  step each script already runs on the server (Windows PowerShell 5.1 there)
  or, for New-Character on a local test server, run in place, so there is
  one copy of it and the scripts cannot drift apart.

  The list is private\deleted-characters.json (the server's privDir), the
  same shape Delete-Person.ps1 writes and game\gamemode.js reads:

      { "profiles": [ ... ], "actors": [ runtime form ids ], "done": { part: time } }

  WHO IT NAMES. A reset, a new character or a wipe throws characters away
  and keeps every profile: the profile keeps its id, its mod menu choices
  and, after a reset or a new character, its house, offices, books and
  farm. So each names the thrown-away characters by form id only and never
  a profile. Each register's release in gamemode.js lets go by profile what
  a profile holds and by form id only what the character held (a dungeon
  chest's reservation, an embassy row with no profile, a trader's supply
  waits, commission promises and a trade waiting on that character, and
  the trade ships' manifest, #511), so a list with no profiles in it never
  takes anything a profile holds (#2668 has the table, part by part).

  A character's form id is read off its change form the way Delete-Person
  reads it: profileId above 0 and a formDesc made in the world, a hex
  number with no plugin (FormDesc::ToString), which is the form's local id.
  The list keeps the runtime form id, 0xff000000 + that local id, the one
  shape every register keeps (#2870, ConvertFrom-ThornswoodFormDesc, the
  twin of game\form-id.js). A change form that will not parse, or a
  character's whose formDesc is not a runtime form, is named in a
  RELEASENOTE line, so nobody is left off the list without it being said.
  A list there whose actors are local ids, the shape from a build before
  #2870, is not read and is left as it is for a person; docs\GAMEMODE.md
  says what to do.

  WHERE IT GOES. The privDir server-settings.json names, as the server reads
  it; private when the file names none or is not there. A server-settings.json
  that is there and will not parse is a server that will not start, and a
  list put in a guessed folder would never be read, so nothing is written
  and the caller is told (RELEASEBAD).

  MERGED, NOT REPLACED. A list still waiting there (a deletion the server
  has not let go of yet) keeps every id it names; the new ids join it. A
  list there that is not one is never overwritten: the caller is told and
  writes nothing. Done is what the caller says: cleared for a reset, so
  every part runs for the new ids; for a wipe, the parts whose registers
  the wipe has just set aside, so only the merchant ledger, the register a
  wipe keeps, waits on it.

  AND 'saves' WHEN NO PROFILE IS NAMED. The part 'saves' is server-log.js's
  (scripts\vps\Server-Log.js, #2758): it takes the change forms, card, mod
  menu choices, take counts and last-left time of the profiles a list names,
  and nothing else. A list that names no profile leaves it nothing to do,
  and a server on this machine (Reset-Character -UseLocal, New-Character)
  is started as node dist_back/skymp5-server.js by the launcher or by hand,
  never under
  server-log.js, so nothing there would ever mark it done and the list
  would wait for good. So the merged list marks 'saves' done itself when it
  names no profile. A list carrying a profile still waiting (a deletion not
  yet let go of) leaves 'saves' to server-log.js.

  Each function says what it did as lines, for the caller to print:
    RELEASE|<file>|<profiles>|<characters>[|done: <parts>]
    RELEASE|none                     nothing to name
    RELEASENOTE|<why>                carried on, but worth saying
    RELEASEBAD|<why>                 no list was written
#>
$ThornswoodReleaseList = @'
# ---- the release list (scripts\ops\Release-List.ps1, #2668) ----
# The server's private folder, or $null when its server-settings.json is
# there and will not parse (the callers say so; nothing is guessed).
function Get-ThornswoodPrivDir([string]$Root) {
  $settings = Join-Path $Root 'server-settings.json'
  $priv = 'private'
  if (Test-Path -LiteralPath $settings) {
    $cfg = $null
    try { $cfg = [IO.File]::ReadAllText($settings) -replace '^\uFEFF', '' | ConvertFrom-Json }
    catch { return $null }
    if ($cfg -and $cfg.privDir) { $priv = [string]$cfg.privDir }
  }
  if ([IO.Path]::IsPathRooted($priv)) { return $priv }
  return (Join-Path $Root $priv)
}
function Get-ThornswoodReleaseListPath([string]$Root) {
  $priv = Get-ThornswoodPrivDir $Root
  if (-not $priv) { return $null }
  return (Join-Path $priv 'deleted-characters.json')
}
function ConvertTo-ThornswoodIds($a, [long]$top) {
  if ($null -eq $a -or -not ($a -is [array])) { return $null }
  $out = New-Object 'System.Collections.Generic.List[long]'
  foreach ($n in $a) {
    if (-not ($n -is [int] -or $n -is [long] -or $n -is [decimal] -or $n -is [double])) { return $null }
    if ($n -ne [math]::Floor($n) -or $n -le 0 -or $n -gt $top) { return $null }
    $out.Add([long]$n)
  }
  return ,$out.ToArray()
}
# One shape for a character's form id (#2870), the twin of game\form-id.js:
# a runtime form's formDesc is its local hex alone, and its runtime form id
# is 0xff000000 + local. Anything else (a plugin, more digits, 0) gives 0.
function ConvertFrom-ThornswoodFormDesc($Desc) {
  if (-not ($Desc -is [string]) -or $Desc -notmatch '^[0-9a-f]{1,6}$') { return [long]0 }
  $local = [Convert]::ToInt64($Desc, 16)
  if ($local -le 0) { return [long]0 }
  return ([long]4278190080 + $local)
}
function Read-ThornswoodReleaseList([string]$File) {
  if (-not $File) { return @{ ok = $false } }
  if (-not (Test-Path -LiteralPath $File)) { return @{ ok = $true; missing = $true; profiles = @(); actors = @() } }
  $v = $null
  try { $v = [IO.File]::ReadAllText($File) -replace '^\uFEFF', '' | ConvertFrom-Json } catch { $v = $null }
  if (-not ($v -is [System.Management.Automation.PSCustomObject])) { return @{ ok = $false } }
  $acts = $v.actors
  if ($null -eq $acts) { $acts = @() }
  $p = ConvertTo-ThornswoodIds $v.profiles 9007199254740991
  $a = ConvertTo-ThornswoodIds $acts 4294967295
  if ($null -eq $p -or $null -eq $a) { return @{ ok = $false } }
  # Every actor a runtime form id; a local id is the old shape (#2870).
  if (@($a | Where-Object { $_ -le 4278190080 }).Count) { return @{ ok = $false; old = (@($a | Where-Object { $_ -le 16777215 }).Count -gt 0) } }
  return @{ ok = $true; missing = $false; profiles = $p; actors = $a }
}
# The form ids of the characters in these change forms, and a RELEASENOTE
# line for each one that will not parse: @{ ids = @(...); notes = @(...) }.
function Get-ThornswoodCharacterIds($Files) {
  $ids = @()
  $notes = @()
  foreach ($f in @($Files)) {
    if (-not $f) { continue }
    $o = $null
    try { $o = [IO.File]::ReadAllText([string]$f) -replace '^\uFEFF', '' | ConvertFrom-Json }
    catch { $notes += ('RELEASENOTE|' + $f + ' will not parse, so its character, if it is one, is not on the release list'); continue }
    if (-not ($o -is [System.Management.Automation.PSCustomObject])) { continue }
    $p = $o.profileId
    if (-not ($p -is [int] -or $p -is [long] -or $p -is [decimal] -or $p -is [double])) { $p = 0 }
    if ($p -le 0) { continue }
    $id = ConvertFrom-ThornswoodFormDesc $o.formDesc
    if ($id -gt 0) { $ids += $id }
    else { $notes += ('RELEASENOTE|' + $f + ' has a formDesc that is not a runtime form, so its character is not on the release list') }
  }
  return @{ ids = @($ids | Sort-Object -Unique); notes = $notes }
}
function Write-ThornswoodReleaseList {
  param([string]$Root, $Actors = @(), [string[]]$Carry = @(), [string[]]$Done = @())
  $file = Get-ThornswoodReleaseListPath $Root
  if (-not $file) { 'RELEASEBAD|' + (Join-Path $Root 'server-settings.json') + ' will not parse, so the server''s private folder is not known and no list was written'; return }
  $now = Read-ThornswoodReleaseList $file
  if (-not $now.ok -and $now.old) { 'RELEASEBAD|' + $file + ' holds form ids in the old shape, from a build before #2870, and is not read, so no list was written and it is left as it is; docs\GAMEMODE.md says what to do'; return }
  if (-not $now.ok) { 'RELEASEBAD|' + $file + ' is not a list of deleted characters, so no list was written and it is left as it is'; return }
  $P = @($now.profiles)
  $A = @($now.actors) + @($Actors)
  # Each list set aside is carried (Wipe-Saves.ps1): the requests and, since
  # #4920, the list the server took and had not finished. One not there is none.
  foreach ($c in @($Carry | Where-Object { $_ })) {
    $old = Read-ThornswoodReleaseList $c
    if (-not $old.ok) { 'RELEASENOTE|' + $c + ' is not a list of deleted characters, so nothing was carried from it; it is left as it is' }
    elseif (-not $old.missing) { $P += @($old.profiles); $A += @($old.actors) }
  }
  $P = @($P | Where-Object { $null -ne $_ } | ForEach-Object { [long]$_ } | Where-Object { $_ -gt 0 } | Sort-Object -Unique)
  $A = @($A | Where-Object { $null -ne $_ } | ForEach-Object { [long]$_ } | Where-Object { $_ -gt 4278190080 -and $_ -le 4294967295 } | Sort-Object -Unique)
  if (-not $P.Count -and -not $A.Count) { 'RELEASE|none'; return }
  # 'saves' acts only on profiles, and no server on this machine runs it (above).
  if (-not $P.Count) { $Done = @($Done) + 'saves' }
  $parts = @($Done | Where-Object { $_ -match '^[a-z]+$' } | Sort-Object -Unique)
  $t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $json = '{"profiles":[' + ($P -join ',') + '],"actors":[' + ($A -join ',') + ']'
  if ($parts.Count) { $json += ',"done":{' + (($parts | ForEach-Object { '"' + $_ + '":' + $t }) -join ',') + '}' }
  $json += '}'
  try {
    $dir = Split-Path -Parent $file
    if (-not (Test-Path -LiteralPath $dir)) { [void][IO.Directory]::CreateDirectory($dir) }
    $tmp = $file + '.tmp'
    [IO.File]::WriteAllText($tmp, $json, (New-Object Text.UTF8Encoding $false))
    if (Test-Path -LiteralPath $file) { [IO.File]::Replace($tmp, $file, [NullString]::Value) } else { [IO.File]::Move($tmp, $file) }
  } catch { 'RELEASEBAD|' + $file + ' could not be written: ' + $_.Exception.Message; return }
  $line = 'RELEASE|' + $file + '|' + $P.Count + '|' + $A.Count
  if ($parts.Count) { $line += '|done: ' + ($parts -join ', ') }
  $line
}
# ---- end of the release list ----
'@
