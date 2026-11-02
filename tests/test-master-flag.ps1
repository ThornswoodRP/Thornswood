<#
  test-master-flag.ps1

  The master flag in the plugin header, which the game honours BEFORE the list
  order, and which Deploy-Gamemode.ps1 never read until 22 September.

  WHY IT MATTERS. The server computes every form id as the plugin's position
  in its loadOrder times 0x01000000 plus the local id. The game does not take
  that position from the list alone: a plugin whose TES4 header carries bit
  0x1 is a master and is loaded at the FRONT, whatever place the list gives
  it. So a master-flagged plugin sitting anywhere but the top of the server's
  list means the client and the server disagree from that plugin's own
  position onwards, on every form id, for everybody at once.

  MEASURED 22 SEPTEMBER on Patrick's machine: of the 60 plugins that take a
  place in the order, seven carry the flag, Skyrim.esm, Update.esm,
  Dawnguard.esm, HearthFires.esm, Dragonborn.esm, Water for ENB.esm and
  Embers XD.esm, and all seven are .esm files already at the top. That is why
  this was latent and not absent. The silent case is an .esp carrying the bit:
  there is none today, and nothing would have said so on the day there was.

  This lifts Read-PluginHeader and Sort-MastersFirst out of the shipped
  Deploy-Gamemode.ps1 by text, so the test drives the real code rather than a
  copy of it, the same way test-ship-gate.ps1 lifts the Git gate out of
  Ship.ps1.

  Read only apart from files under its own temp folder.
#>
[CmdletBinding()]
param([string]$DeployPath)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
if (-not $DeployPath) { $DeployPath = Join-Path $Here 'scripts\deploy\Deploy-Gamemode.ps1' }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# ---- lift the two functions out of the shipped script -----------------------
#
# By name and by brace match, so a rename here fails loudly rather than
# silently testing nothing.
$src = Get-Content -LiteralPath $DeployPath -Raw

function Get-FunctionText([string]$text, [string]$name) {
    $at = $text.IndexOf("function $name")
    if ($at -lt 0) { return $null }
    $b = $text.IndexOf('{', $at)
    if ($b -lt 0) { return $null }
    $depth = 0
    for ($i = $b; $i -lt $text.Length; $i++) {
        $c = $text[$i]
        if ($c -eq '{') { $depth++ }
        elseif ($c -eq '}') { $depth--; if ($depth -eq 0) { return $text.Substring($at, $i - $at + 1) } }
    }
    return $null
}

$readFn = Get-FunctionText $src 'Read-PluginHeader'
$sortFn = Get-FunctionText $src 'Sort-MastersFirst'
Yes 'Read-PluginHeader is in Deploy-Gamemode.ps1' ($null -ne $readFn)
Yes 'Sort-MastersFirst is in Deploy-Gamemode.ps1' ($null -ne $sortFn)
if ($null -eq $readFn -or $null -eq $sortFn) {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    exit 1
}
. ([scriptblock]::Create($readFn))
. ([scriptblock]::Create($sortFn))

# ---- plugins on disk with headers we choose ---------------------------------
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-masterflag-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

# A TES4 record: the tag, the record size, then the flags dword at offset 8.
# 0x1 is master, 0x200 is light. The padding is there so the reader's
# 16 KB window has something to read past the header.
function New-Plugin([string]$name, [uint32]$flags) {
    $b = New-Object byte[] 64
    [Text.Encoding]::ASCII.GetBytes('TES4').CopyTo($b, 0)
    [BitConverter]::GetBytes([uint32]44).CopyTo($b, 4)
    [BitConverter]::GetBytes($flags).CopyTo($b, 8)
    $p = Join-Path $tmp $name
    [IO.File]::WriteAllBytes($p, $b)
    return $p
}

try {
    $plain      = New-Plugin 'Plain.esp'        0x0
    $flagged    = New-Plugin 'Flagged.esp'      0x1        # the silent case
    $lightEsp   = New-Plugin 'Light.esp'        0x200
    $bothEsp    = New-Plugin 'Both.esp'         0x201
    $esmNoBit   = New-Plugin 'NoBit.esm'        0x0        # master by extension
    $eslNoBit   = New-Plugin 'NoBit.esl'        0x0        # light by extension

    # ---- the header read ----------------------------------------------------
    $h = Read-PluginHeader $plain
    Yes 'a plain .esp is neither master nor light' ((-not $h.Master) -and (-not $h.Light))

    $h = Read-PluginHeader $flagged
    Yes 'an .esp carrying bit 0x1 reads as master' ($h.Master -and -not $h.Light)

    $h = Read-PluginHeader $lightEsp
    Yes 'an .esp carrying bit 0x200 reads as light and not master' ($h.Light -and -not $h.Master)

    $h = Read-PluginHeader $bothEsp
    Yes 'both bits set reads as both' ($h.Light -and $h.Master)

    $h = Read-PluginHeader $esmNoBit
    Yes 'an .esm with no bit set is still master, by extension' ($h.Master)

    $h = Read-PluginHeader $eslNoBit
    Yes 'an .esl with no bit set is still light, by extension' ($h.Light)

    # ---- the sort -----------------------------------------------------------
    $names = @('Plain.esp', 'Flagged.esp', 'NoBit.esm', 'Other.esp', 'Second.esm')
    $null = New-Plugin 'Other.esp'  0x0
    $null = New-Plugin 'Second.esm' 0x0
    $info = @{}
    foreach ($n in $names) { $info[$n] = Read-PluginHeader (Join-Path $tmp $n) }

    $sorted = @(Sort-MastersFirst $names $info)
    $sortedSet = (@($sorted | Sort-Object) -join '|')
    $namesSet  = (@($names  | Sort-Object) -join '|')
    Yes 'the sort keeps every entry, none added and none lost' ($sorted.Count -eq $names.Count -and $sortedSet -eq $namesSet)

    $firstThree = @($sorted[0], $sorted[1], $sorted[2]) -join ','
    Yes 'the three master-flagged entries come first' ($firstThree -eq 'Flagged.esp,NoBit.esm,Second.esm')

    # Stable on both sides. Flagged.esp is before NoBit.esm in the input and
    # must stay there; Plain.esp is before Other.esp and must stay there.
    Yes 'the masters keep their relative order' ([Array]::IndexOf($sorted, 'Flagged.esp') -lt [Array]::IndexOf($sorted, 'NoBit.esm'))
    Yes 'the rest keep their relative order' ([Array]::IndexOf($sorted, 'Plain.esp') -lt [Array]::IndexOf($sorted, 'Other.esp'))

    $already = @('NoBit.esm', 'Second.esm', 'Flagged.esp', 'Plain.esp', 'Other.esp')
    $alreadyOut = @(Sort-MastersFirst $already $info) -join '|'
    $alreadyIn  = $already -join '|'
    Yes 'a list already masters-first is left exactly as it is' ($alreadyOut -eq $alreadyIn)

    # A name with no header read at all must not be treated as a master and
    # must not be dropped: Deploy-Gamemode collects those separately.
    $withUnknown = @('Plain.esp', 'Ghost.esp', 'Flagged.esp')
    $sorted2 = Sort-MastersFirst $withUnknown $info
    Yes 'a plugin with no header read is kept and is not hoisted' ($sorted2.Count -eq 3 -and $sorted2[0] -eq 'Flagged.esp' -and ($sorted2 -contains 'Ghost.esp'))

    # ---- the real load order on this machine --------------------------------
    #
    # Not a pass or fail about the sort, but the number this entry rests on:
    # the flag is latent here only because every master-flagged plugin is an
    # .esm already at the top. If an .esp ever carries it, this prints it.
    $realData = 'C:\Thornswood\Game\Data'
    $realList = 'C:\Thornswood\Profile\LocalAppData\plugins.txt'
    if ((Test-Path -LiteralPath $realData) -and (Test-Path -LiteralPath $realList)) {
        $enabled = @('Skyrim.esm','Update.esm','Dawnguard.esm','HearthFires.esm','Dragonborn.esm')
        foreach ($l in (Get-Content -LiteralPath $realList)) {
            $t = "$l".Trim()
            if ($t.StartsWith('*')) { $enabled += $t.Substring(1).Trim() }
        }
        $odd = @()
        foreach ($n in $enabled) {
            $f = Join-Path $realData $n
            if (-not (Test-Path -LiteralPath $f)) { continue }
            $hh = Read-PluginHeader $f
            if ($hh.Master -and -not $hh.Light -and $n -notmatch '\.esm$') { $odd += $n }
        }
        Yes 'no .esp in the live load order carries the master flag' ($odd.Count -eq 0)
        if ($odd.Count) { foreach ($o in $odd) { Write-Host "      $o" -ForegroundColor Yellow } }
    } else {
        Write-Host 'SKIP  the live load order is not on this machine' -ForegroundColor DarkGray
    }
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
