# Run the installer's actual merge in isolation, without starting setup or the launcher.
$ErrorActionPreference = 'Stop'
$app = Join-Path $PSScriptRoot '../app'
$steps = (Get-Content -Raw (Join-Path $app 'InstallSteps.cs')).Replace("`r`n", "`n")
$start = $steps.IndexOf('        internal static JsonObject Merge(')
$end = $steps.IndexOf('        internal static JsonObject ReadJson(', $start)
$merge = $steps.Substring($start, $end - $start)
Add-Type -TypeDefinition @"
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Nodes;
public static class ReinstallConfig {
$merge
    public static string Run(string disk, string package, bool? folder) {
        var card = new Dictionary<string, JsonNode>();
        if (folder.HasValue) card["MakeOwnGame"] = JsonValue.Create(folder.Value);
        return Merge(JsonNode.Parse(disk) as JsonObject, JsonNode.Parse(package) as JsonObject, card).ToJsonString();
    }
}
"@
$disk = '{"Theme":"Ember","MusicOff":true,"MusicLevel":"17","AutoJoin":false,"MakeOwnGame":false,"VortexGame":"ExistingFolder","ServerAddress":"old.invalid","ServerPort":"7777","VoiceUrl":"https://old.invalid/voice","Channel":"dev","ServerPassword":"local-only","FuturePreference":[1,2]}'
$package = '{"Theme":"Forge","MusicOff":false,"MusicLevel":"50","AutoJoin":true,"MakeOwnGame":true,"VortexGame":"PackageFolder","ServerAddress":"new.invalid","ServerPort":"7787","VoiceUrl":"https://new.invalid/voice","Channel":"","ServerPassword":"","FuturePreference":[0]}'
$merged = [ReinstallConfig]::Run($disk, $package, $null) | ConvertFrom-Json -AsHashtable
$script:fails = 0
function Check($name, $ok) {
    if ($ok) { Write-Host "PASS $name" }
    else { Write-Host "FAIL $name"; $script:fails++ }
}
Check 'reinstall keeps theme' ($merged.Theme -ceq 'Ember')
Check 'reinstall keeps music off and volume' ($merged.MusicOff -eq $true -and $merged.MusicLevel -ceq '17')
Check 'reinstall keeps auto-join off' ($merged.AutoJoin -eq $false)
Check 'reinstall keeps both folder preferences' ($merged.MakeOwnGame -eq $false -and $merged.VortexGame -ceq 'ExistingFolder')
Check 'reinstall keeps fields the package does not own' ($merged.ServerPassword -ceq 'local-only' -and ($merged.FuturePreference -join ',') -ceq '1,2')
Check 'reinstall updates the build addresses and ports' ($merged.ServerAddress -ceq 'new.invalid' -and $merged.ServerPort -ceq '7787' -and $merged.VoiceUrl -ceq 'https://new.invalid/voice')
Check 'an explicit main channel replaces the old channel' ($merged.Channel -ceq '')
$changed = [ReinstallConfig]::Run($disk, $package, $true) | ConvertFrom-Json -AsHashtable
Check 'a fresh choice on the setup card still wins' ($changed.MakeOwnGame -eq $true)
$fresh = [ReinstallConfig]::Run('{}', $package, $false) | ConvertFrom-Json -AsHashtable
Check 'a clean install takes build settings, not the packager preferences' ($fresh.ServerAddress -ceq 'new.invalid' -and $fresh.MakeOwnGame -eq $false -and !$fresh.Contains('Theme') -and !$fresh.Contains('VortexGame'))
$window = Get-Content -Raw (Join-Path $app 'InstallWindow.cs')
Check 'choosing a root loads its own folder preference before showing the route' ($window -match 'chkOwn\.IsChecked\s*=\s*Config\.Load\(Path\.Combine\(installRoot, "config\.json"\)\)\.MakeOwnGame;')
Write-Host "$(10 - $fails) passed, $fails failed"
if ($fails) { exit 1 }
