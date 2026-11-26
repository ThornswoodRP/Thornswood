<#
.SYNOPSIS
  Adds a line to the description of one or more of our mods on Nexus Mods, or puts back a description from a file, and reads the page back to prove what Nexus kept (#2914).

.DESCRIPTION
  Adds a line to the description of one or more of our mods on Nexus Mods, or
  puts back a description from a file, and reads the page back to prove what
  Nexus kept (#2914).

      .\scripts\release\Set-NexusDescription.ps1 -Mod 192001,192762 -AddLine 'THIS MOD IS NOT MADE, GUARANTEED OR SUPPORTED BY ZENIMAX OR ITS AFFILIATES.' -WhatIf
      .\scripts\release\Set-NexusDescription.ps1 -Mod 192001 -From <a file this wrote before>

  WHY. #2829: Bethesda's Creation Kit licence asks every mod to carry one line,
  near the top, and both our mod pages need it. Patrick did page edits by hand
  on the website until 20 October.

  WHAT THE API HAS, read in https://api.nexusmods.com/openapi.yaml on
  20 October. v3 can write a description: editMod, PATCH /v3/mods/<id> with
  {"description": "..."}, "Full mod page description, in BBCode", stored "in
  the same encoding the mod page editor uses, so the result is identical to
  saving the same text from the website". v3 cannot read one: getMod answers
  only id, game_scoped_id, game_id and name, and no other v3 operation returns
  a description. So the description as it is now is read from the v2 GraphQL
  API, mod(modId, gameId) { description }, which answers in the stored form.
  Not legacyModsByDomain: measured on 20 October, for minutes after an edit
  it answers the old description on some asks and the new one on others,
  while mod(modId, gameId) answered the new one every time from the first ask.

  THE STORED FORM, measured on both our pages on 20 October through
  GraphQL, where both queries give the same form: the BBCode as typed, with every line break stored as a line
  break followed by <br />, and every backslash as &#92;. The apostrophe was
  stored as it is. Nothing else was there to measure: neither page has < > &
  or a double quote. So this turns the stored form back into what the editor
  holds by exactly those two rules, refuses a description that has anything
  it cannot turn back exactly (any other < or &, or a carriage return), and
  refuses to add text with < > & or a double quote, whose stored form has not
  been seen.

  THE ORDER, for each mod: read it (GET /v3/games/<game>/mods/<mod> for the id
  the edit takes, GraphQL for the description), work out the new text, keep
  the description as it was in a file under the scratch folder
  (Get-ScratchDir.ps1 nexus-description), send the edit, and read the page
  back through GraphQL. What Nexus kept has to be exactly the stored form of
  what was sent, or this stops and says how to put the old one back with
  -From and that file. A mod whose description already has the line is left
  as it is.

  -WhatIf reads both and prints where the line goes, then stops.

  First real run 20 October: the ZeniMax line on both our pages (#2829).

.PARAMETER Mod
  The mods' numbers on the website, as 192001,192762.

.PARAMETER Game
  The game's domain on Nexus. skyrimspecialedition unless said otherwise.

.PARAMETER AddLine
  The line to add, as its own paragraph.

.PARAMETER AfterLine
  How many lines of the description come before the new one. 1 unless said
  otherwise, so it goes straight under the heading.

.PARAMETER From
  A file holding a whole description as the editor holds it, which replaces
  the description: the file this keeps before an edit puts the page back.

.PARAMETER WhatIf
  Reads everything and says what it would send. Writes nothing.

.PARAMETER NoPause
  Does not wait for Enter at the end or on a stop.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string[]]$Mod,
  [string]$Game = 'skyrimspecialedition',
  [string]$AddLine,
  [int]$AfterLine = 1,
  [string]$From,
  [switch]$WhatIf,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'Nexus.ps1')

$script:Done = New-Object System.Collections.Generic.List[string]
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) {
  Write-Host ''
  Write-Host "STOP. $m" -ForegroundColor Red
  if ($script:Done.Count) { Write-Host ('On Nexus from this run: ' + ($script:Done -join '; ') + '.') -ForegroundColor Yellow }
  else { Write-Host 'Nothing was changed on Nexus.' -ForegroundColor Yellow }
  if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
  exit 1
}
function Step([scriptblock]$b) { try { return (& $b) } catch { Die $_.Exception.Message } }

$NL = [string][char]10
$BR = $NL + '<br />'

# The editor's text from the stored form, by the two measured rules, or $null
# with the reason in $script:Unreadable when the stored form holds anything else.
$script:Unreadable = ''
function ConvertFrom-Stored([string]$s) {
  $t = $s.Replace($BR, $NL)
  if ($t.Contains([string][char]13)) { $script:Unreadable = 'a carriage return'; return $null }
  if ($t.Contains('<') -or $t.Contains('>')) { $script:Unreadable = 'a < or > that is not a stored line break'; return $null }
  $amp = [regex]::Matches($t, '&[^;]*;?') | Where-Object { $_.Value -ne '&#92;' } | Select-Object -First 1
  if ($amp) { $script:Unreadable = ('"' + $amp.Value + '", an & this has not seen Nexus store'); return $null }
  return $t.Replace('&#92;', '\')
}
function ConvertTo-Stored([string]$t) { return $t.Replace('\', '&#92;').Replace($NL, $BR) }
function Test-Writable([string]$t, [string]$what) {
  foreach ($c in @('<', '>', '&', '"', [string][char]13)) {
    if ($t.Contains($c)) {
      $n = if ($c -eq [string][char]13) { 'a carriage return' } else { $c }
      Die ($what + ' has ' + $n + ', and how Nexus stores that has not been measured, so it could not be read back. Nothing was sent for it.')
    }
  }
}

if (-not $AddLine -and -not $From) { Die 'Say what to change: -AddLine with the line, or -From with a whole description.' }
if ($AddLine -and $From) { Die 'Give -AddLine or -From, not both.' }
if ($Game -notmatch '^[a-z0-9]+$') { Die ('-Game ' + $Game + ' is not a game domain.') }
$Mod = @($Mod | ForEach-Object { ([string]$_).Split(',') } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
foreach ($m in $Mod) { if ($m -notmatch '^\d+$') { Die ('-Mod ' + $m + ' is not a mod number.') } }
$fromText = $null
if ($AddLine) {
  $AddLine = $AddLine.Trim()
  if (-not $AddLine -or $AddLine.Contains($NL)) { Die '-AddLine is one line of text.' }
  Test-Writable $AddLine 'The line'
  if ($AfterLine -lt 0) { Die '-AfterLine cannot be below 0.' }
}
else {
  if (-not (Test-Path -LiteralPath $From -PathType Leaf)) { Die ('There is no file at ' + $From + '.') }
  if ($Mod.Count -ne 1) { Die '-From puts back one mod''s description, so give one -Mod.' }
  $fromText = ([IO.File]::ReadAllText($From, (New-Object Text.UTF8Encoding($false)))).Replace([string][char]13 + $NL, $NL).TrimStart([char]0xFEFF)
  if (-not $fromText.Trim()) { Die ($From + ' is empty, and Nexus refuses a blank description.') }
  Test-Writable $fromText ('The description in ' + $From)
}
[void](Step { Read-NexusKey })

Write-Host ''
Write-Host '  THORNSWOOD  -  a mod page description on Nexus Mods' -ForegroundColor White
if ($WhatIf) { Say '  -WhatIf: reads only, and says what it would write.' 'Yellow' }
Say ('  key from ' + $script:NexusKeyFrom) 'DarkGray'

function Read-Stored([string]$m, [string]$gameId) {
  $q = '{ mod(modId: ' + $m + ', gameId: ' + $gameId + ') { modId name description } }'
  $d = Invoke-NexusGraph $q $null ('Reading the description of mod ' + $m)
  $n = Get-NexusField $d 'mod'
  if (-not $n) { throw ('Nexus has no mod ' + $m + ' on ' + $Game + ' to read a description from.') }
  return [string](Get-NexusField $n 'description')
}

$scratch = & (Join-Path $Here 'Get-ScratchDir.ps1') 'nexus-description'

foreach ($m in $Mod) {
  Head ('Mod ' + $m)
  $info = Step { Get-NexusField (Invoke-NexusApi 'GET' ('/v3/games/' + $Game + '/mods/' + $m) '' ('Reading mod ' + $m)) 'data' }
  $uid = [string](Get-NexusField $info 'id')
  if (-not $uid) { Die ('Nexus answered for mod ' + $m + ' without its id.') }
  $gameId = [string](Get-NexusField $info 'game_id')
  if ($gameId -notmatch '^\d+$') { Die ('Nexus answered for mod ' + $m + ' without its game''s number.') }
  Say ('  ' + (Get-NexusField $info 'name') + ' (id ' + $uid + ')')
  $stored = Step { Read-Stored $m $gameId }
  $editor = ConvertFrom-Stored $stored
  if ($null -eq $editor -or (ConvertTo-Stored $editor) -cne $stored) {
    $why = if ($script:Unreadable) { $script:Unreadable } else { 'something that does not come back the same' }
    Die ('The description of mod ' + $m + ' has ' + $why + ', so this cannot be sure of sending it back unchanged. Nothing was sent for it.')
  }
  $lines = $editor.Split([char]10)
  Say ('  ' + $lines.Count + ' lines, ' + $editor.Length + ' characters as the editor holds it')

  if ($AddLine) {
    if (@($lines | Where-Object { $_.Trim() -ceq $AddLine }).Count) { Say '  already has the line; left as it is' 'Green'; continue }
    if ($AfterLine -gt $lines.Count) { Die ('The description of mod ' + $m + ' has ' + $lines.Count + ' lines, so the line cannot go after line ' + $AfterLine + '.') }
    $new = New-Object System.Collections.Generic.List[string]
    for ($i = 0; $i -lt $AfterLine; $i++) { $new.Add($lines[$i]) }
    $new.Add($AddLine)
    # Its own paragraph: a blank line under it unless the next line is one.
    if ($AfterLine -lt $lines.Count -and $lines[$AfterLine].Trim()) { $new.Add('') }
    for ($i = $AfterLine; $i -lt $lines.Count; $i++) { $new.Add($lines[$i]) }
    $text = $new -join $NL
    $show0 = [Math]::Max(0, $AfterLine - 1); $show1 = [Math]::Min($new.Count - 1, $AfterLine + 2)
    Say '  it would read:'
    for ($i = $show0; $i -le $show1; $i++) { Say ('    ' + ($i + 1) + '  ' + $new[$i]) $(if ($new[$i] -ceq $AddLine) { 'Green' } else { 'DarkGray' }) }
  }
  else {
    $text = $fromText
    if ($text -ceq $editor) { Say '  already reads as that file does; left as it is' 'Green'; continue }
    Say ('  the whole description becomes the ' + $text.Length + ' characters in ' + $From)
  }

  $body = [ordered]@{ description = $text } | ConvertTo-Json -Compress
  if ($WhatIf) {
    Say ('  would send PATCH /v3/mods/' + $uid + ' with the description, ' + $text.Length + ' characters') 'Yellow'
    continue
  }

  New-Item -ItemType Directory -Force -Path $scratch | Out-Null
  $kept = Join-Path $scratch ($m + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-before.txt')
  [IO.File]::WriteAllText($kept, $editor, (New-Object Text.UTF8Encoding($false)))
  Say ('  kept as it was in ' + $kept) 'DarkGray'

  [void](Step { Invoke-NexusApi 'PATCH' ('/v3/mods/' + $uid) $body ('Editing the description of mod ' + $m) })
  $script:Done.Add('mod ' + $m + ' description edited (as it was: ' + $kept + ')')
  $after = Step { Read-Stored $m $gameId }
  $want = ConvertTo-Stored $text
  if ($after -cne $want) {
    if ($after -ceq $stored) { Die ('Nexus answered the edit of mod ' + $m + ' but its description still reads as it was. Look at the page before running this again.') }
    $at = 0
    while ($at -lt $after.Length -and $at -lt $want.Length -and $after[$at] -ceq $want[$at]) { $at++ }
    $a = $after.Substring($at, [Math]::Min(60, $after.Length - $at)); $w = $want.Substring($at, [Math]::Min(60, $want.Length - $at))
    Die ('Nexus kept something other than what was sent for mod ' + $m + ', from character ' + $at + ': it has "' + $a + '" where "' + $w + '" was meant. Put the page back with: .\scripts\release\Set-NexusDescription.ps1 -Mod ' + $m + ' -From "' + $kept + '"')
  }
  Say '  read back: Nexus kept exactly what was sent' 'Green'
}

Write-Host ''
if ($WhatIf) { Say 'Nothing was written. Run it again without -WhatIf to send it.' 'Green' }
else { Say 'Done.' 'Green' }
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
exit 0
