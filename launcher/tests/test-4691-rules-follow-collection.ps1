<#
  test-4691-rules-follow-collection.ps1

      pwsh -NoProfile -File .\launcher\tests\test-4691-rules-follow-collection.ps1

  Every Play writes the settings in launcher\app\Enforce.cs into the mods' own
  ini files. Skyrim Souls RE left the collection in revision 2, and its two
  rules (bFavoritesMenu, bTweenMenu in SkyrimSoulsRE.ini) went on being
  written into a file nothing reads, because nothing tied a rule to the mod
  it is for (#4691).

  This holds every rule Enforce writes into Data\SKSE\Plugins to the records:
    1. a rule for a mod's ini names the mod (Mod = its Nexus id), and that id
       is a mod in records\collection.json
    2. a rule that names no mod is for a file the client build ships beside
       its own DLL (records\client-build.json), such as SkyrimPlatform.ini
    3. no rule writes SkyrimSoulsRE.ini, and the launcher's architecture page
       does not say Play writes it
    4. teeth: Skyrim Souls' rule planted back, with its Nexus id or with none,
       is caught by 1 and 2

  Reads files only. Nothing is compiled, nothing connects.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent (Split-Path -Parent $Here)
function RepoFile([string]$rel) {
    $p = Join-Path $repo $rel
    if (Test-Path -LiteralPath $p) { return $p }
    return (Join-Path $repo ($rel -replace '\\', '/'))
}

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

$enforce = [IO.File]::ReadAllText((RepoFile 'launcher\app\Enforce.cs'))
$collection = [IO.File]::ReadAllText((RepoFile 'records\collection.json')) | ConvertFrom-Json
$client = [IO.File]::ReadAllText((RepoFile 'records\client-build.json')) | ConvertFrom-Json
$modIds = @{}
foreach ($m in @($collection.mods)) { $modIds[[int]$m.modId] = [string]$m.name }
$shipped = @($client.files.PSObject.Properties.Name | ForEach-Object { ($_ -replace '/', '\').ToLowerInvariant() })

# The rules for a file in Data\SKSE\Plugins: P("<file>"), and Mod = <id> when
# the rule names one. What is wrong with each, or nothing.
function Problems([string]$src) {
    $out = @()
    $rules = [regex]::Matches($src, 'new Rule\(P\("(?<file>[^"]+)"\)[^\r\n]*')
    foreach ($r in $rules) {
        $file = $r.Groups['file'].Value
        $mod = [regex]::Match($r.Value, '\{\s*Mod\s*=\s*(\d+)\s*\}')
        if ($mod.Success) {
            $id = [int]$mod.Groups[1].Value
            if (-not $modIds.ContainsKey($id)) { $out += "$file names mod $id, which records\collection.json does not have" }
        }
        else {
            $dll = ('Data\SKSE\Plugins\' + [IO.Path]::GetFileNameWithoutExtension($file) + '.dll').ToLowerInvariant()
            if ($shipped -notcontains $dll) { $out += "$file names no mod, and the client build ships no $([IO.Path]::GetFileNameWithoutExtension($file)).dll" }
        }
    }
    return , @($out)
}

# ---- 1 and 2. the real rules ---------------------------------------------------------
Write-Host ''; Write-Host 'the rules in Enforce.cs'
$count = ([regex]::Matches($enforce, 'new Rule\(P\("')).Count
Yes ("Enforce.cs has rules for files in Data\SKSE\Plugins ({0})" -f $count) ($count -ge 2)
Yes ('records\collection.json lists the collection''s mods ({0})' -f $modIds.Count) ($modIds.Count -ge 20)
$p = Problems $enforce
Yes 'every rule names a mod in the collection, or is for a file the client build ships' ($p.Count -eq 0)
foreach ($x in $p) { Write-Host ('      ' + $x) -ForegroundColor DarkGray }
Yes '  Open Animation Replacer''s rules name it, 92109' (([regex]::Matches($enforce, 'P\("OpenAnimationReplacer\.ini"\)[^\r\n]*\{ Mod = 92109 \}')).Count -eq 2)

# ---- 3. Skyrim Souls ---------------------------------------------------------------
Write-Host ''; Write-Host 'Skyrim Souls RE, which revision 2 removed'
Yes 'records\collection.json has no Skyrim Souls RE (Nexus 27859)' (-not $modIds.ContainsKey(27859) -and -not (@($modIds.Values) -match 'Skyrim Souls'))
Yes 'no rule in Enforce.cs writes SkyrimSoulsRE.ini' ($enforce -notmatch 'SkyrimSoulsRE\.ini')
$arch = [IO.File]::ReadAllText((RepoFile 'launcher\app\ARCHITECTURE.md'))
Yes 'ARCHITECTURE.md does not say Play writes SkyrimSoulsRE.ini' ($arch -notmatch 'SkyrimSoulsRE\.ini')

# ---- 4. teeth ----------------------------------------------------------------------
Write-Host ''; Write-Host 'planted copies'
$withId = $enforce + "`n            l.Add(new Rule(P(`"SkyrimSoulsRE.ini`"), `"bTweenMenu`", `"false`", `"the Tab menu locking up`") { Mod = 27859 });`n"
$pw = Problems $withId
Yes 'Skyrim Souls'' rule with its own Nexus id is caught: the collection has no 27859' ($pw.Count -eq 1 -and $pw[0] -match '27859')
$noId = $enforce + "`n            l.Add(new Rule(P(`"SkyrimSoulsRE.ini`"), `"bTweenMenu`", `"false`", `"the Tab menu locking up`"));`n"
$pn = Problems $noId
Yes 'and with no id it is caught too: the client build ships no SkyrimSoulsRE.dll' ($pn.Count -eq 1 -and $pn[0] -match 'SkyrimSoulsRE\.dll')

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
