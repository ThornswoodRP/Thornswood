<#
  Set-Vps.ps1

  Renames the game's own name, the one name everything reaches the box by.

      .\scripts\vps\Set-Vps.ps1

  It asks for the new name, shows you what it is about to change, and waits
  for a yes before touching anything.

  Why this exists: the name lives in scripts\vps\vps.json, and the admin
  scripts read it through Vps.ps1. The same name is written into the few
  files that cannot read vps.json at run time: the launcher's default
  (launcher\app\Config.cs), the example config (config.example.json), the
  whose-game gate in game\plugins\thornswood-front.js, the chat page's Dev
  guard in game\ui\thornswood-chat.js, and the docs that name it.
  tests\test-vps-defaults.ps1 holds the list. This script walks the repo
  (vps.json included) so one rename stays one rename.

  It changes the name only where it stands whole (#4525): a longer name
  that holds it, such as one more label in front (dev.<name>) or more
  letters after it, is a different name and is neither counted nor
  rewritten.

  A BOX MOVE IS NOT THIS (#3690). The repository names the box only by its
  name, a DNS record in Cloudflare, and never by its address, because the
  repository is going public. A new box is that record pointed at its
  address (docs\MOVING-THE-SERVER.md), and no file changes. So this refuses
  an IP address. Launchers already installed take a new name from the feed
  (Set-Server.ps1), so nothing is written into the launcher to move them.

  What it does NOT do, because Set-Server.ps1 already does it properly:
  config.json on this machine, and version.json for everyone else's launcher.
  Run that one after this one. It is printed at the end.

  Reads and rewrites files in the repo only. Nothing is sent anywhere.
#>
[CmdletBinding()]
param(
  [string]$Address,
  [switch]$Preview,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$RepoDir = Split-Path -Parent (Split-Path -Parent $Here)

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) {
  Write-Host ''
  Write-Host "STOP. $m" -ForegroundColor Red
  if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
  exit 1
}

function ReadText($path) {
  $raw = [IO.File]::ReadAllBytes($path)
  $skip = 0
  if ($raw.Length -ge 3 -and $raw[0] -eq 0xEF -and $raw[1] -eq 0xBB -and $raw[2] -eq 0xBF) { $skip = 3 }
  return [Text.Encoding]::UTF8.GetString($raw, $skip, $raw.Length - $skip)
}

function WriteText($path, $text) {
  [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}

Write-Host ''
Write-Host '  THORNSWOOD  -  move to a different box' -ForegroundColor White

# ------------------------------------------------------- what it is now ---
$ConfigCs = Join-Path $Here '..\..\launcher\app\Config.cs'
if (-not (Test-Path -LiteralPath $ConfigCs)) { Die "not found: $ConfigCs" }

$cs = ReadText $ConfigCs
$m = [regex]::Match($cs, 'public\s+string\s+ServerAddress\s*=\s*"([^"]+)"')
if (-not $m.Success) { Die "Could not find the ServerAddress default in app\Config.cs. Nothing has been changed." }
$Old = $m.Groups[1].Value

Say ''
Say "  now       $Old" 'DarkGray'

# ------------------------------------------------------ what it becomes ---
if (-not $Address) {
  Write-Host ''
  $Address = (Read-Host '  New name (a DNS name that points at the box)').Trim()
}
$Address = "$Address".Trim()
if (-not $Address) { Die 'No address given. Nothing has been changed.' }

$parsed = $null
if ([Net.IPAddress]::TryParse($Address, [ref]$parsed)) {
  Die "That is an IP address. The repository names the box only by a DNS name (#3690); a new box is the record for $Old pointed at its address, which docs\MOVING-THE-SERVER.md walks through. Nothing has been changed."
}
if ($Address -notmatch '^[A-Za-z0-9]([A-Za-z0-9\-\.]*[A-Za-z0-9])?$') {
  Die "That is not a name: $Address"
}
if ($Address -eq $Old) { Die "That is already the address. Nothing has been changed." }

# The old name where it stands whole: not one more label or letter of a
# longer name on either side. A full stop after it that ends a sentence is
# not part of a name; one followed by a letter or digit is.
$Whole = New-Object regex ('(?<![A-Za-z0-9\-\.])' + [regex]::Escape($Old) + '(?![A-Za-z0-9\-]|\.[A-Za-z0-9])')

Say "  becomes   $Address" 'Green'

# ------------------------------------------------------------ the files ---
Head 'What carries the old address'

$skipDirs = @('.git', 'node_modules', 'bin', 'obj', '_dist', 'packages')
$hits = @()
$content = @()

foreach ($f in (Get-ChildItem -LiteralPath $RepoDir -Recurse -File -ErrorAction SilentlyContinue)) {
  $rel = $f.FullName.Substring($RepoDir.Length).TrimStart('\', '/')
  $parts = $rel -split '[\\/]'
  $skip = $false
  foreach ($p in $parts) { if ($skipDirs -contains $p) { $skip = $true } }
  if ($skip) { continue }
  if ($f.Length -gt 8MB) { continue }
  if ($f.Extension -notin @('.ps1', '.cs', '.js', '.json', '.html', '.css', '.txt', '.md', '.cmd', '.bat', '.xaml', '.ini', '.py')) { continue }

  $text = ''
  try { $text = ReadText $f.FullName } catch { continue }
  $n = $Whole.Matches($text).Count
  if ($n -eq 0) { continue }

  # data\board.json and the like are a record of what was said, not a setting.
  # Rewriting history there would make old messages describe a box that never
  # existed at the time. Those get listed and left alone.
  $isRecord = ($rel -match '(^|[\\/])site[\\/]data[\\/]') -and ($f.Extension -eq '.json')

  if ($isRecord) { $content += [pscustomobject]@{ Rel = $rel; Count = $n } }
  else { $hits += [pscustomobject]@{ Path = $f.FullName; Rel = $rel; Count = $n; Text = $text } }
}

if ($hits.Count -eq 0) { Die "Nothing in the repo carries $Old. Nothing has been changed." }

foreach ($h in ($hits | Sort-Object Rel)) {
  Say ("  {0}  {1}" -f $h.Count.ToString().PadLeft(3), $h.Rel)
}
Say ("  {0} file(s), {1} place(s)" -f $hits.Count, (($hits | Measure-Object -Property Count -Sum).Sum)) 'DarkGray'

if ($content.Count -gt 0) {
  Write-Host ''
  Say '  Left alone, because they are a record of what was said and not a setting:' 'DarkGray'
  foreach ($c in ($content | Sort-Object Rel)) { Say ("    {0}  {1}" -f $c.Count.ToString().PadLeft(3), $c.Rel) 'DarkGray' }
}

if ($Preview) {
  Write-Host ''
  Say 'Preview only. Nothing was changed.' 'Yellow'
  Write-Host ''
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 0
}

Write-Host ''
$yes = Read-Host "  Change all of that from $Old to $Address ? (y/n)"
if ("$yes".Trim().ToLower() -ne 'y') { Die 'Left alone, as asked.' }

# ---------------------------------------------------------- do the work ---
Head 'Changing them'

foreach ($h in ($hits | Sort-Object Rel)) {
  $new = $Whole.Replace($h.Text, $Address)
  WriteText $h.Path $new
  Say ("  {0}" -f $h.Rel) 'Green'
}

# ------------------------------------------------------------ what next ---
Head 'What is left'
Say '  The repo says the new name. Two things do not:' 'DarkGray'
Write-Host ''
Say '  1. The name itself: in Cloudflare, DNS, Records, an A record for it to' 'White'
Say '     the box, DNS only (the grey cloud), because the game port is UDP.' 'White'
Write-Host ''
Say '  2. This machine and everyone else, in one go, once the name resolves:' 'White'
# Say has no -NoNewline (a stray one went to $args and split this line in
# two, issue #1086), so the command and its name are one Write-Host pair.
Write-Host '       .\scripts\ops\Set-Server.ps1 -Address ' -NoNewline -ForegroundColor Gray
Write-Host $Address -ForegroundColor Green
Say '     It checks the box answers by that name first.' 'DarkGray'
Write-Host ''
Say '  Then on every machine that reaches the box over ssh, so its Host block' 'DarkGray'
Say '  and known_hosts line carry the new name: .\scripts\vps\Setup-SshKey.ps1' 'DarkGray'

Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
