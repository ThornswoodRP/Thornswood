<#
  Set-Door.ps1

  Turns the game server's door on, off, or tells you what it has been seeing.

      .\scripts\ops\Set-Door.ps1              what the door is doing right now
      .\scripts\ops\Set-Door.ps1 -Connect     point it at the site and start refreshing
      .\scripts\ops\Set-Door.ps1 -Enforce     start actually turning people away
      .\scripts\ops\Set-Door.ps1 -Watch       go back to watching only
      .\scripts\ops\Set-Door.ps1 -Log 40      the last 40 lines it wrote

  Why this exists: the server has had no access control at all. Anyone who knows
  the live address:port can connect, and that address is on a public website.

  How the door works:

    The site knows who is in the Discord and what roles they have. The launcher
    sends the profile id it is about to play as when it checks in, so the site
    can tie a Discord account to a profile number. The game server pulls that
    list every five minutes and keeps it in data\allowed.json. Its door reads
    that list and, when enforcing, turns away anybody not on it.

  -Connect also copies the site's join pass key (passKey in the site's
  config.json, which the site makes itself) into door.json, so the gamemode
  can check the join pass a launcher hands the game (#937). The key is read and
  written on the VPS and never crosses this machine or its screen.

  The safe order is -Connect, then leave it watching for a day, then read the
  log, then -Enforce. Turning it on before the list has filled up would turn
  away people who have simply not pressed Play since the launcher started
  sending their profile id.
#>
[CmdletBinding()]
param(
  [string]$Vps  = '',
  [string]$User = '',
  [string]$Site = 'https://thornswood.net',
  [string]$DocsRoot = 'C:/Thornswood-Docs',
  # Which server. Empty takes the live one, C:\Thornswood-Server, or the
  # only server folder on C: (#4201). Give it
  # C:\Thornswood-Server-Dev to point at the dev instance, which is the
  # only way to refresh the dev door after the site key is rotated.
  [string]$Root,
  [switch]$Connect,
  [switch]$Enforce,
  [switch]$Watch,
  [int]$Log = 0,
  [switch]$NoPause
)


$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here '..\vps\Vps.ps1')
. (Join-Path $Here '..\vps\Send-Script.ps1')
# Move-FeedStoreInto, sent up with -Enforce and -Watch: the list goes back
# with the same POSIX rename as the gamemode's own write of it (#2909).
. (Join-Path $Here '..\release\Feed-Store.ps1')
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
$ssh = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes')
$docsWin = $DocsRoot.Replace('/','\')

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

function Remote($script) {
  # Send-Script.ps1 (issue #1070): a long script goes by scp and its run takes
  # it off the box before it runs, and the far side's exit code comes back.
  return Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script $script
}

if ($Enforce -and $Watch) { Die 'Pick one of -Enforce or -Watch, not both.' }

Write-Host ''
Write-Host '  THORNSWOOD  -  the door on the game server' -ForegroundColor White

Head 'Finding the server'
if ($Root) {
  $root = $Root.TrimEnd('\', '/')
} else {
  $found = Remote @"
`$ErrorActionPreference = 'Continue'
foreach (`$d in (Get-ChildItem 'C:\' -Directory -EA SilentlyContinue)) {
  if (Test-Path (Join-Path `$d.FullName 'server-settings.json')) { 'ROOT ' + `$d.FullName }
}
"@
  $roots = @(@($found) | Where-Object { $_ -match '^ROOT ' } | ForEach-Object { ("$_" -replace '^ROOT ', '').Trim() } | Where-Object { $_ })
  # The live server's folder by its name, as every other box script names it
  # (#4201): the first folder found was C:\Thornswood-Rehearsal whenever a
  # restore rehearsal was there, which sorts before it. One folder and not
  # live is a box set up another way, and is taken; two or more with none
  # live are not guessed between.
  $live = @($roots | Where-Object { $_ -ieq 'C:\Thornswood-Server' })
  if ($live.Count) { $root = $live[0] }
  elseif ($roots.Count -eq 1) { $root = $roots[0] }
  elseif ($roots.Count -gt 1) {
    Die ('No C:\Thornswood-Server on the VPS, and ' + $roots.Count + ' folders hold server settings: ' + ($roots -join ', ') + '. Give -Root with the one you mean.')
  } else { $root = '' }
}
if (-not $root) { Die 'No server-settings.json anywhere on C: of the VPS.' }
Say "  $root"
# The dev server's door asks the dev list, /dev/api/allowed, which is only the
# people the dev build is for (SERVER.md in the ops repo, "The door"). Without -Site this
# wrote the live address into the dev door and it fetched the live list (#964).
if ($root -match '-Dev$' -and -not $PSBoundParameters.ContainsKey('Site')) {
  $Site = $Site.TrimEnd('/') + '/dev'
}

# ------------------------------------------------------------- connecting ---
if ($Connect) {
  Head 'Pointing the door at the site'
  # The key is already on the VPS in the site's own config. Reading it there
  # rather than asking for it keeps it off the command line and out of your
  # PowerShell history, and means there is only one copy to rotate.
  $out = Remote @"
`$ErrorActionPreference = 'Continue'
`$root = '$root'
`$privDir = 'private'
try {
  `$s = Get-Content (Join-Path `$root 'server-settings.json') -Raw | ConvertFrom-Json
  if (`$s.privDir) { `$privDir = [string]`$s.privDir }
} catch { }
`$priv = Join-Path `$root `$privDir

`$key = ''
`$pass = ''
try {
  `$c = Get-Content '$docsWin\config.json' -Raw | ConvertFrom-Json
  `$key = [string]`$c.botKey
  `$pass = [string]`$c.passKey
} catch { }
if (-not `$key) { 'NO BOT KEY in $docsWin\config.json. Run Install-Bot.ps1 first.'; exit }

`$doc = @{ site = '$Site'; key = `$key }
if (`$pass) { `$doc.passKey = `$pass }
`$doc = `$doc | ConvertTo-Json
if (-not (Test-Path `$priv)) { New-Item -ItemType Directory -Path `$priv -Force | Out-Null }
[IO.File]::WriteAllText((Join-Path `$priv 'door.json'), `$doc, (New-Object Text.UTF8Encoding(`$false)))
'door.json written, pointing at $Site'
if (`$pass) { 'with the join pass key, so this server can check join passes' }
else { 'WITHOUT a join pass key: the site has not made one yet. Deploy-Docs.ps1, then -Connect again.' }
'The gamemode picks it up within five minutes, or restart the server to be sure.'
"@
  $out | ForEach-Object { Say "  $_" }
  if ("$out" -match 'NO BOT KEY') { Die 'The door cannot ask the site for the list without it.' }
}

# ---------------------------------------------------------------- flipping ---
if ($Enforce -or $Watch) {
  $want = if ($Enforce) { 'true' } else { 'false' }
  Head $(if ($Enforce) { 'Turning the door ON' } else { 'Back to watching only' })
  $out = Remote ($script:FeedStoreSwap + "`n" + @"
`$ErrorActionPreference = 'Continue'
`$root = '$root'
`$privDir = 'private'
try {
  `$s = Get-Content (Join-Path `$root 'server-settings.json') -Raw | ConvertFrom-Json
  if (`$s.privDir) { `$privDir = [string]`$s.privDir }
} catch { }
`$f = Join-Path (Join-Path `$root `$privDir) 'allowed.json'
if (-not (Test-Path `$f)) { 'NO LIST YET. Run -Connect first and give it five minutes.'; exit }
# Read sharing write and delete, so this read never refuses the gamemode's
# whole write of the list, a POSIX rename (#2740).
`$h = New-Object IO.FileStream(`$f, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
try { `$d = (New-Object IO.StreamReader(`$h, (New-Object Text.UTF8Encoding(`$false)), `$true)).ReadToEnd() | ConvertFrom-Json } finally { `$h.Dispose() }
`$n = @(`$d.profiles).Count
if ('$want' -eq 'true' -and `$n -lt 1) {
  'THE LIST IS EMPTY. Turning the door on now would turn away everybody.'
  exit
}
`$d.enforce = ('$want' -eq 'true')
# The list goes back whole (#2909): a new file beside it, put over it with
# the POSIX rename the gamemode's mp.writeFileWhole uses. Written in place,
# the gamemode's read could find the list cut short or empty, and the write
# was refused while the gamemode's own rename of the list held it.
`$part = Join-Path (Split-Path -Parent `$f) ('.allowed.json.door-' + `$PID)
[IO.File]::WriteAllText(`$part, (`$d | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding(`$false)))
try { Move-FeedStoreInto `$part `$f }
catch {
  Remove-Item -LiteralPath `$part -Force -ErrorAction SilentlyContinue
  'THE LIST WAS NOT WRITTEN: ' + `$_.Exception.Message
  exit
}
'enforce is now $want, with ' + `$n + ' profiles on the list'
"@)
  $out | ForEach-Object { Say "  $_" }
  if ("$out" -match 'THE LIST IS EMPTY|NO LIST YET|THE LIST WAS NOT WRITTEN') {
    Die 'Nothing was changed.'
  }
}

# ----------------------------------------------------------------- reading ---
Head 'What the door has'
$out = Remote @"
`$ErrorActionPreference = 'Continue'
`$root = '$root'
`$privDir = 'private'
try {
  `$s = Get-Content (Join-Path `$root 'server-settings.json') -Raw | ConvertFrom-Json
  if (`$s.privDir) { `$privDir = [string]`$s.privDir }
} catch { }
`$priv = Join-Path `$root `$privDir

`$f = Join-Path `$priv 'allowed.json'
if (-not (Test-Path `$f)) {
  'NO allowed.json. The door is OFF and anybody can connect.'
} else {
  # Sharing write and delete, as above (#2740).
  `$h = New-Object IO.FileStream(`$f, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
  try { `$d = (New-Object IO.StreamReader(`$h, (New-Object Text.UTF8Encoding(`$false)), `$true)).ReadToEnd() | ConvertFrom-Json } finally { `$h.Dispose() }
  'mode      ' + `$(if (`$d.enforce) { 'ENFORCING, people not on the list are turned away' } else { 'watching only, nobody is turned away' })
  'profiles  ' + @(`$d.profiles).Count
  'updated   ' + `$(if (`$d.at) { `$d.at } else { 'never, this list was written by hand' })
  foreach (`$p in @(`$d.people)) { '  ' + `$p.name + '  ' + (@(`$p.profiles) -join ', ') }
  # Each faction's Leader role and the profiles that hold it, whose faction
  # book is theirs in the game (#3317).
  if (`$d.factionLeaderProfiles) {
    'faction leaders'
    foreach (`$l in `$d.factionLeaderProfiles.PSObject.Properties) { '  ' + `$l.Name + '  ' + (@(`$l.Value) -join ', ') }
  }
}
`$j = Join-Path `$priv 'door.json'
'refreshing ' + `$(if (Test-Path `$j) { 'yes, from the site' } else { 'NO. Run -Connect, or the list never updates.' })
`$pk = `$false
try { `$pk = [bool]([string](Get-Content `$j -Raw | ConvertFrom-Json).passKey) } catch { }
'join pass key ' + `$(if (`$pk) { 'yes' } else { 'NO. Run -Connect once the site has made one (#937).' })
"@
$out | ForEach-Object { Say "  $_" }

if ($Log -gt 0) {
  Head "The last $Log lines the door wrote"
  Remote @"
`$ErrorActionPreference = 'Continue'
`$root = '$root'
`$privDir = 'private'
try {
  `$s = Get-Content (Join-Path `$root 'server-settings.json') -Raw | ConvertFrom-Json
  if (`$s.privDir) { `$privDir = [string]`$s.privDir }
} catch { }
`$l = Join-Path (Join-Path `$root `$privDir) 'door.log'
if (Test-Path `$l) { Get-Content `$l -Tail $Log } else { 'nothing logged yet' }
"@ | ForEach-Object { Say "  $_" }
}

Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
