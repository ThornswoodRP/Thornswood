# test-2076-dev-build-check.ps1
#
#     pwsh -NoProfile -File .\tests\test-2076-dev-build-check.ps1
#
# Deploy-DevGamemode.ps1 sends a gamemode only onto the server build its
# commit records (#2076), the comparison Deploy-Server -GamemodeOnly makes for
# live (#1089). Main since #2060 records engine 9fd1f69b and its gamemode no
# longer handles drops (#1719); both servers ran 720a5f7c, so a dev deploy from
# main would have lost every dropped extra on dev.
#
# Get-ThornswoodBoxBuildProblem (ServerBuild.ps1) is called with stand-in
# record sums, and the script is read for where it asks: before the artifact
# leaves this machine, and not on -PutBack, which sends no gamemode.
# Read only. Nothing connects to anything.
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'scripts\deploy\ServerBuild.ps1')

$pass = 0; $fail = 0
function Yes([string]$what, [bool]$cond) {
  if ($cond) { $script:pass++; Write-Host ('PASS  ' + $what) }
  else { $script:fail++; Write-Host ('FAIL  ' + $what) }
}

$old = ('a' * 64); $new = ('b' * 64)
$put = 'scripts\release\Publish-Server.ps1 -Channel dev'
$same = Get-ThornswoodBoxBuildProblem $new '9fd1f69b6c3893e47511fd3f49ce914737d5d633' $new '9fd1f69b6c3893e47511fd3f49ce914737d5d633' 'dev server' $put
Yes 'the build the commit records: no problem' ($null -eq $same)
$other = Get-ThornswoodBoxBuildProblem $old '720a5f7caaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' $new '9fd1f69b6c3893e47511fd3f49ce914737d5d633' 'dev server' $put
Yes 'another build: refused, naming both commits and how to put the right one on' (
  $other -and $other -match 'commit 720a5f7c' -and $other -match 'commit 9fd1f69b' -and $other.Contains($put))
$none = Get-ThornswoodBoxBuildProblem 'none' '' $new '9fd1f69b' 'dev server' $put
Yes 'no record on the box: refused' ($none -and $none -match 'no server-build.json')
$silent = Get-ThornswoodBoxBuildProblem '' '' $new '9fd1f69b' 'dev server' $put
Yes 'no answer from the box: refused' ($silent -and $silent -match 'did not say')
$unread = Get-ThornswoodBoxBuildProblem $old '' $new '9fd1f69b' 'dev server' $put
Yes 'another build whose commit cannot be read: still refused' ($unread -and $unread -match 'an unreadable one')

# The record sum ignores line endings, as on the box.
$lf = [Text.Encoding]::UTF8.GetBytes("{`n  ""a"": 1`n}`n")
$crlf = [Text.Encoding]::UTF8.GetBytes("{`r`n  ""a"": 1`r`n}`r`n")
Yes 'a record sums the same with either line ending' ((Get-ThornswoodRecordSum $lf) -eq (Get-ThornswoodRecordSum $crlf))

$src = [IO.File]::ReadAllText((Join-Path $repo 'scripts\deploy\Deploy-DevGamemode.ps1')).Replace("`r`n", "`n")
$guard = $src.IndexOf("if (-not `$PutBack) {`n`$alsoSends")
$ask = $src.IndexOf('Get-ThornswoodBoxBuildProblem $devBoxSum')
$send = $src.IndexOf('Send-ThornswoodArtifact -Artifact $artifact')
Yes 'Deploy-DevGamemode asks the dev box which build it runs' ($ask -gt 0)
Yes 'after the -PutBack guard, so -PutBack, which sends no gamemode, is not asked' ($guard -gt 0 -and $ask -gt $guard)
Yes 'before the artifact is sent, so a refusal sends nothing' ($send -gt $ask)
Yes 'and a refusal stops the run' ($src.IndexOf("throw 'The dev server does not run the server build this gamemode is written for.", $ask) -gt $ask)
# The record it compares is held to the commit like the files it sends (#2132):
# read from the working tree, an uncommitted record would be compared with the
# box in place of the one the gamemode's commit holds.
$also = [regex]::Match($src, '(?m)^\$alsoSends = @\(([^)]*)\)')
Yes 'records\server-build.json is in what Deploy-DevGamemode holds to the commit' ($also.Success -and $also.Groups[1].Value.Contains("'records/server-build.json'"))
$built = $src.IndexOf('New-ThornswoodArtifact -Component gamemode')
$read = $src.IndexOf('[IO.File]::ReadAllBytes($devRecordPath)')
Yes '  and the commit check runs before the record is read' ($built -gt 0 -and $read -gt $built)

# #2711: what each box answers when its server-build.json does not read. The
# dev box's commit read and the live box's commit and light reads sat in a try
# with an empty catch: dev then refused with no why, and live's -FromStore
# took the load order as written for an engine with no light plugins. Each
# box read runs here, in PowerShell 7 as on the box (#5356), against a folder
# standing in for the server root.
. (Join-Path $repo 'scripts\deploy\ServerContent.ps1')
. (Join-Path $repo 'scripts\deploy\ServerSettings.ps1')
. (Join-Path $PSScriptRoot 'Windows.ps1')
$boxPs = Get-BoxPowerShell
function On-Box([string]$text) {
  $e = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($text))
  return @(& $boxPs -NoProfile -NonInteractive -EncodedCommand $e 2>&1 | ForEach-Object { "$_".Trim() })
}
$box = Join-Path ([IO.Path]::GetTempPath()) ('ts-2076-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $box | Out-Null
try {
  [IO.File]::WriteAllText((Join-Path $box 'server-build.json'), '{ "source": { "commit": ')
  [IO.File]::WriteAllText((Join-Path $box 'server-settings.json'), '{ "port": 7777, "thornswoodRequirePass": true }')

  # Dev: the text Deploy-DevGamemode sends, with $Root its stand-in.
  $m = [regex]::Match($src, '(?s)-Script \(\$ThornswoodRecordSumText \+ "`r`n" \+ @"\n(.*?)\n"@\)')
  Yes 'the dev box read is where it was' ($m.Success)
  if ($m.Success) {
    $Root = $box
    $said = On-Box ($ThornswoodRecordSumText + "`r`n" + $ExecutionContext.InvokeCommand.ExpandString($m.Groups[1].Value))
    Yes 'a dev record that does not read is answered RECORDUNREADABLE, with why' (@($said | Where-Object { $_ -match '^RECORDUNREADABLE \S' }).Count -eq 1 -and @($said | Where-Object { $_ -match '^RECORD [0-9a-f]{64}$' }).Count -eq 1)
  }
  Yes '  and the refusal says what reading it said' ($src.Contains("elseif (`$l -match '^RECORDUNREADABLE (.*)$') { `$devBoxUnread = `$Matches[1] }") -and $src.Contains("if (`$devBuildProblem -and `$devBoxUnread) { `$devBuildProblem += ' Its server-build.json does not read: ' + `$devBoxUnread }"))

  # Live: Deploy-Server's -GamemodeOnly and -FromStore read, and the refusals
  # it makes of the answer, both taken out of the script and run.
  $ds = [IO.File]::ReadAllText((Join-Path $repo 'scripts\deploy\Deploy-Server.ps1')).Replace("`r`n", "`n")
  $rm = [regex]::Match($ds, "(?s)\n  \`$boxRead = @'\n(.*?)\n'@\n")
  $p0 = $ds.IndexOf('  $livePort = 0')
  $p1 = $ds.IndexOf('  $how = if ($FromStore)', $p0)
  Yes 'the live box read and its refusals are where they were' ($rm.Success -and $p0 -gt 0 -and $p1 -gt $p0)
  if ($rm.Success -and $p0 -gt 0 -and $p1 -gt $p0) {
    $boxSaid = @(On-Box ($ThornswoodRecordSumText + "`r`n`$root = '" + $box.Replace("'", "''") + "'`r`n" + $rm.Groups[1].Value + "`r`n" + $ThornswoodServerContentText))
    Yes 'a live record that does not read is answered RECORDUNREADABLE, with no commit or light line' (
      @($boxSaid | Where-Object { $_ -match '^RECORDUNREADABLE \S' }).Count -eq 1 -and @($boxSaid | Where-Object { $_ -match '^RECORD(COMMIT|LIGHT) ' }).Count -eq 0)
    $Root = 'C:/Thornswood-Server'
    $rec = [pscustomobject]@{ source = [pscustomobject]@{ commit = ('9fd1f69b' + ('0' * 32)) }; lightPlugins = $false }
    $recordSum = $new
    foreach ($FromStore in @($true, $false)) {
      $refusals = $null
      Invoke-Expression $ds.Substring($p0, $p1 - $p0)
      Yes ('  and ' + $(if ($FromStore) { '-FromStore' } else { '-GamemodeOnly' }) + ' refuses it, saying what reading it said') (@($refusals | Where-Object { $_ -match "server-build\.json does not read \(" }).Count -eq 1)
    }
    [IO.File]::WriteAllText((Join-Path $box 'server-settings.json'), '{ "port": ')
    $boxSaid = @(On-Box ($ThornswoodRecordSumText + "`r`n`$root = '" + $box.Replace("'", "''") + "'`r`n" + $rm.Groups[1].Value + "`r`n" + $ThornswoodServerContentText))
    $FromStore = $false; $refusals = $null
    Invoke-Expression $ds.Substring($p0, $p1 - $p0)
    Yes 'live settings that do not read are refused with what reading them said' (@($refusals | Where-Object { $_ -match 'cannot be read \(.+\), so there is no telling which process' }).Count -eq 1)
  }
} finally {
  Remove-Item -LiteralPath $box -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host ("$pass passed, $fail failed")
if ($fail) { exit 1 }
