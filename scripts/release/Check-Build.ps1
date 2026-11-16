<#
  Check-Build.ps1

      .\scripts\release\Check-Build.ps1                  check the Thornswood build
      .\scripts\release\Check-Build.ps1 -Data "C:\Program Files (x86)\Steam\steamapps\common\Skyrim Special Edition\Data"
                                               check the Vortex build instead
      .\scripts\release\Check-Build.ps1 -All             list the ones that are fine too

  The server does not check plugin names. It checks size and crc32 of every
  plugin it names, so the wrong version of a mod is the same to it as not
  having the mod. "I installed it" and "I installed the right file" are
  different sentences and only one of them lets somebody connect.

  This reads the manifest the server publishes, walks a Data folder, and says
  which of the three a plugin is:

    missing       not there at all
    wrong file    there, but a different version than the server has
    fine          byte for byte what the server has

  It is the same comparison the client makes, run somewhere you can read the
  answer. Point it at the Vortex build to find out whether the collection
  actually reproduces Thornswood before anybody downloads it, and point it at
  somebody's install when they say they cannot get in.

  Reads only.
#>
#Requires -Version 7
[CmdletBinding()]
param(
  [string]$Data = ((& (Join-Path $PSScriptRoot 'Where.ps1') Install) + '\Game\Data'),
  # A manifest on disk. Without one it asks the game server, which is the copy
  # that is actually deciding whether people get in.
  [string]$Manifest,
  # The game server publishes its own data folder on this port. The WEBSITE
  # does not serve this file and never has: the gamemode's log line says
  # /api/servers/thornswood/manifest.json, and that path is relative to the
  # server's own resources folder on 3000, not to thornswood.net. Asking the
  # site for it gets a 401, because the site treats an unknown path as
  # something you have to sign in for.
  [string]$Vps  = '',
  [int]$Port    = 3000,
  [switch]$All,
  [switch]$Vortex,
  [switch]$NoPause
)


$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here '..\vps\Vps.ps1')
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
# ---------------------------------------------------------------- -Vortex ---
#
# Where the build actually is.
#
# Two answers, and the wrong one is silent: it produces a load order that
# looks fine and does not match what anybody is running. The old build under
# C:\Thornswood\Game is still on this machine and still readable, so a default
# that points at it keeps working long after it stopped being the truth.
#
# -Vortex reads the live one instead: Skyrim where Steam put it, with the mods
# Vortex has deployed into it, and the plugin list of whichever Vortex profile
# is active. That is what is loaded when the game starts, so it is what the
# server should be built from.
function Get-SkyrimPath {
    $roots = @()
    foreach ($k in 'HKCU:\Software\Valve\Steam','HKCU:\Software\Wow6432Node\Valve\Steam') {
        try { $p = (Get-ItemProperty -Path $k -Name SteamPath -EA Stop).SteamPath } catch { continue }
        if ($p) { $roots += ($p -replace '/','\') }
    }
    try { $p = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Wow6432Node\Valve\Steam' -Name InstallPath -EA Stop).InstallPath } catch { $p = $null }
    if ($p) { $roots += $p }

    # Games are not always in Steam's own folder. Every extra library is listed
    # in this file, one "path" line each, with the separator escaped.
    foreach ($r in @($roots)) {
        $vdf = Join-Path $r 'config\libraryfolders.vdf'
        if (-not (Test-Path -LiteralPath $vdf)) { continue }
        foreach ($line in (Get-Content -LiteralPath $vdf)) {
            $m = [regex]::Match($line, '^\s*"path"\s+"(.+)"\s*$')
            if ($m.Success) { $roots += ($m.Groups[1].Value -replace '\\\\','\') }
        }
    }

    foreach ($r in ($roots | Select-Object -Unique)) {
        $g = Join-Path $r 'steamapps\common\Skyrim Special Edition'
        if (Test-Path -LiteralPath (Join-Path $g 'SkyrimSE.exe')) { return $g }
    }
    return ''
}

if ($Vortex) {
    $sk = Get-SkyrimPath
    if (-not $sk) { throw "Could not find Skyrim Special Edition through Steam, so -Vortex has nothing to read." }
    $Data = Join-Path $sk 'Data'
}

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) {
  Write-Host ''
  Write-Host "STOP. $m" -ForegroundColor Red
  if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
  exit 1
}

# A crc32 in PowerShell one byte at a time takes minutes on Skyrim.esm, which
# is 250 MB. Compiled, it is under a second.
if (-not ('Thornswood.Crc32' -as [type])) {
  Add-Type -TypeDefinition @'
namespace Thornswood {
  public static class Crc32 {
    static readonly uint[] T = Build();
    static uint[] Build() {
      var t = new uint[256];
      for (uint i = 0; i < 256; i++) {
        uint c = i;
        for (int k = 0; k < 8; k++) c = ((c & 1) != 0) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
        t[i] = c;
      }
      return t;
    }
    public static int OfFile(string path) {
      uint c = 0xFFFFFFFFu;
      using (var fs = System.IO.File.OpenRead(path)) {
        var buf = new byte[1 << 20];
        int n;
        while ((n = fs.Read(buf, 0, buf.Length)) > 0)
          for (int i = 0; i < n; i++) c = T[(c ^ buf[i]) & 0xFF] ^ (c >> 8);
      }
      return unchecked((int)(c ^ 0xFFFFFFFFu));
    }
  }
}
'@
}

Write-Host ''
Write-Host '  THORNSWOOD  -  does this build match the server' -ForegroundColor White

if (-not (Test-Path -LiteralPath $Data)) { Die "No such folder: $Data" }
Say "  looking at  $Data" 'DarkGray'

# ------------------------------------------------------------ the manifest ---
$doc = $null
if ($Manifest) {
  if (-not (Test-Path -LiteralPath $Manifest)) { Die "No such manifest: $Manifest" }
  $raw = (Get-Content -LiteralPath $Manifest -Raw) -replace '^\uFEFF', ''
  $doc = $raw | ConvertFrom-Json
  Say "  manifest    $Manifest" 'DarkGray'
}
else {
  $url = "http://${Vps}:$Port/api/servers/thornswood/manifest.json"
  Say "  manifest    $url" 'DarkGray'
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $doc = Invoke-RestMethod -Uri $url -TimeoutSec 20
  }
  catch {
    Die ("Could not read the manifest from the game server: " + $_.Exception.Message +
         [Environment]::NewLine + [Environment]::NewLine +
         "That port only answers while the server is running, and only from an" +
         [Environment]::NewLine +
         "address its firewall lets through. Start it, or pass -Manifest with a" +
         [Environment]::NewLine +
         "copy on disk.")
  }
}

if (-not $doc -or -not $doc.mods) { Die 'That manifest has no mods in it.' }
$mods = @($doc.mods)
Say ("  the server names {0} plugin(s)" -f $mods.Count) 'DarkGray'

# ----------------------------------------------------------------- compare ---
Head 'Checking'

$missing = @(); $wrong = @(); $fine = @()
$i = 0
foreach ($m in $mods) {
  $i++
  $name = [string]$m.filename
  $path = Join-Path $Data $name
  Write-Progress -Activity 'Checking' -Status $name -PercentComplete ([int](100 * $i / $mods.Count))

  if (-not (Test-Path -LiteralPath $path)) { $missing += $name; continue }

  $len = (Get-Item -LiteralPath $path).Length
  if ($len -ne [int64]$m.size) {
    $wrong += [pscustomobject]@{ Name = $name; Why = ("{0:n0} bytes, the server has {1:n0}" -f $len, [int64]$m.size) }
    continue
  }

  # The server writes zlib's CRC-32 as a signed int32, so half of all files
  # carry a negative number. Another tool may write the same 32 bits unsigned,
  # and [int] of anything over 2147483647 throws. Both are read as the low 32
  # bits, so the two spellings of one checksum are the same file.
  $crc  = [int64][Thornswood.Crc32]::OfFile($path) -band 0xFFFFFFFFL
  $want = [int64]$m.crc32 -band 0xFFFFFFFFL
  if ($crc -ne $want) {
    $wrong += [pscustomobject]@{ Name = $name; Why = 'same size, different contents' }
    continue
  }

  $fine += $name
}
Write-Progress -Activity 'Checking' -Completed

# ------------------------------------------------------------------ report ---
if ($missing.Count) {
  Head ("Missing ({0})" -f $missing.Count)
  Say '  Not in this build at all. Nobody with this build can connect.' 'DarkGray'
  Write-Host ''
  foreach ($n in $missing) { Say "  $n" 'Red' }
}

if ($wrong.Count) {
  Head ("Wrong file ({0})" -f $wrong.Count)
  Say '  Present, but not the version the server has. This is the one that' 'DarkGray'
  Say '  looks fine in a mod manager and still turns people away.' 'DarkGray'
  Write-Host ''
  foreach ($w in $wrong) { Say ("  {0}`n      {1}" -f $w.Name, $w.Why) 'Yellow' }
}

if ($All -and $fine.Count) {
  Head ("Fine ({0})" -f $fine.Count)
  foreach ($n in $fine) { Say "  $n" 'DarkGray' }
}

Head 'In short'
Say ("  {0} fine, {1} missing, {2} the wrong file" -f $fine.Count, $missing.Count, $wrong.Count) `
    $(if ($missing.Count -or $wrong.Count) { 'Yellow' } else { 'Green' })

if (-not $missing.Count -and -not $wrong.Count) {
  Write-Host ''
  Say '  This build is byte for byte what the server expects.' 'Green'
}

Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
if ($missing.Count -or $wrong.Count) { exit 2 }
