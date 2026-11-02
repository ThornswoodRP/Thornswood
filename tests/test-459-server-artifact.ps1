<#
  test-459-server-artifact.ps1

      pwsh -NoProfile -File .\tests\test-459-server-artifact.ps1

  The server build is an artifact with a name, made from the recorded files
  alone, and every full server deploy keeps it in the box's store (#459).

  WHY THIS EXISTS. The gamemode has been a versioned artifact since #1090, and
  the box keeps every one it ran. The server build was sent straight out of
  one machine's engine build folder, and the box kept it only as the installed
  folder and the two before it. scripts\deploy\ServerArtifact.ps1 makes it an
  artifact, server-<fork commit>-<zip hash>.zip; Publish-Server.ps1 and
  Deploy-Server.ps1 send it to the store. This proves, in a scratch folder,
  nothing sent anywhere:
    - the artifact holds exactly the files the record lists and the record,
      each the bytes it should be, and is named by the fork commit and its hash
    - the same build gives the same bytes and name: twice, with the record
      checked out with CR LF or LF, and read out of a payload zip (with the
      gamemode, settings and plugins beside it) or out of the build folder
    - its .json says component server, the fork commit, the record's sum and
      every file
    - a file that is not the recorded build, a server file the record does not
      list, a record with no fork commit, and no record each refuse it, with
      nothing written
    - Publish-Server builds it from the payload before anything is sent and
      sends it with the gamemode artifact once the install answers; Deploy-
      Server builds it on a full deploy and sends it before the stage, and
      -GamemodeOnly sends none (read from their source; tests\test-install-
      server.ps1 drives Publish-Server whole and reads it in the store)
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Threw([scriptblock]$b) { try { & $b | Out-Null; return '' } catch { return $_.Exception.Message } }

. (Join-Path $Repo 'scripts\deploy\ServerArtifact.ps1')
Add-Type -AssemblyName System.IO.Compression.FileSystem

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-server-artifact-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
function Put([string]$p, [string]$text) {
    $null = [IO.Directory]::CreateDirectory((Split-Path -Parent $p))
    [IO.File]::WriteAllText($p, $text, (New-Object Text.UTF8Encoding($false)))
}
function ShaFile([string]$p) { return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }
function ShaText([string]$t) { return Get-ThornswoodSha256Hex ([Text.Encoding]::UTF8.GetBytes($t)) }

$commit = 'cdd846514ae752d2ec70c5e87bf6f5ef76d4321e'
$fork = [ordered]@{
    'scam_native.node'               = 'the addon'
    'dist_back/skymp5-server.js'     = 'the javascript half'
    'dist_back/skymp5-server.js.map' = 'its map'
    'package.json'                   = '{"name":"skymp5-server"}'
    'yarn.lock'                      = '# lock'
    'launch_server.bat'              = 'node dist_back/skymp5-server.js'
    'data/scripts/ActiveMagicEffect.pex' = 'compiled papyrus'
}
function Build([string]$dir, [hashtable]$change = @{}, [string]$extra = '') {
    foreach ($k in $fork.Keys) {
        $t = if ($change.ContainsKey($k)) { $change[$k] } else { $fork[$k] }
        Put (Join-Path $dir ($k -replace '/', '\')) $t
    }
    # What a build holds beside the fork's files, none of which goes in.
    Put (Join-Path $dir 'gamemode.js') '// the gamemode'
    Put (Join-Path $dir 'server-settings.json') '{"port":7777}'
    Put (Join-Path $dir 'scam_native.pdb') 'symbols'
    if ($extra) { Put (Join-Path $dir ($extra -replace '/', '\')) 'from another build' }
}
function RecordText([string]$c = $commit) {
    $files = [ordered]@{}
    foreach ($k in $fork.Keys) { $files[$k] = [ordered]@{ sha256 = (ShaText $fork[$k]); bytes = $fork[$k].Length; commit = $c } }
    $src = [ordered]@{ repo = 'https://github.com/ThornswoodRP/skymp.git'; commit = $c }
    return ([ordered]@{ binary = 'scam_native.node'; sha256 = (ShaText $fork['scam_native.node']); source = $src; files = $files } | ConvertTo-Json -Depth 5)
}
function Entries([string]$zip) {
    $o = [ordered]@{}
    $z = [IO.Compression.ZipFile]::OpenRead($zip)
    try {
        foreach ($e in $z.Entries) {
            $ms = New-Object IO.MemoryStream; $s = $e.Open(); try { $s.CopyTo($ms) } finally { $s.Dispose() }
            $o[$e.FullName] = $ms.ToArray()
        }
    } finally { $z.Dispose() }
    return $o
}

try {
    $dist = Join-Path $T 'dist'
    Build $dist
    $recLf = Join-Path $T 'record-lf.json'
    $recCrlf = Join-Path $T 'record-crlf.json'
    $lf = (RecordText).Replace("`r`n", "`n")
    [IO.File]::WriteAllText($recLf, $lf, (New-Object Text.UTF8Encoding($false)))
    [IO.File]::WriteAllText($recCrlf, $lf.Replace("`n", "`r`n"), (New-Object Text.UTF8Encoding($false)))

    Write-Host 'the artifact'
    $a = New-ThornswoodServerBuildArtifact -From $dist -Record $recLf -OutDir (Join-Path $T 'out1')
    Yes ('it is named by the fork commit and its own hash: ' + $a.Name) ($a.Name -match '^server-cdd846514ae7-[0-9a-f]{16}\.zip$' -and $a.Name -eq ('server-' + $commit.Substring(0, 12) + '-' + $a.Sha256.Substring(0, 16) + '.zip'))
    Yes '  the zip and its .json are written, and the hash is the zip''s' ((Test-Path -LiteralPath $a.Zip) -and (Test-Path -LiteralPath $a.RecordPath) -and (ShaFile $a.Zip) -eq $a.Sha256)
    $ent = Entries $a.Zip
    [string[]]$want = @(@($fork.Keys) + 'server-build.json')
    [Array]::Sort($want, [StringComparer]::Ordinal)
    Yes '  it holds exactly the recorded files and the record, in ordinal order' ((@($ent.Keys) -join '|') -ceq ($want -join '|'))
    $same = $true
    foreach ($k in $fork.Keys) { if (-not $ent.Contains($k) -or (Get-ThornswoodSha256Hex $ent[$k]) -ne (ShaText $fork[$k])) { $same = $false } }
    Yes '  each recorded file is the bytes of the build' $same
    Yes '  and the record goes in as it is in git, LF' ($ent.Contains('server-build.json') -and [Text.Encoding]::UTF8.GetString($ent['server-build.json']) -ceq $lf)
    Yes '  not the gamemode, the settings or the symbols' (-not $ent.Contains('gamemode.js') -and -not $ent.Contains('server-settings.json') -and -not $ent.Contains('scam_native.pdb'))
    $j = Get-Content -LiteralPath $a.RecordPath -Raw | ConvertFrom-Json
    Yes '  its .json: component server, the fork commit, the zip''s hash and size' ($j.component -eq 'server' -and $j.commit -eq $commit -and $j.sha256 -eq $a.Sha256 -and [int64]$j.size -eq (Get-Item -LiteralPath $a.Zip).Length)
    Yes '  the record''s own sum, and every file with its size and hash' ($j.recordSha256 -eq (Get-ThornswoodRecordSum ([IO.File]::ReadAllBytes($recLf))) -and @($j.files).Count -eq 8 -and
        @($j.files | Where-Object { $_.path -eq 'scam_native.node' -and $_.sha256 -eq (ShaText $fork['scam_native.node']) }).Count -eq 1)
    Yes '  Format-ThornswoodArtifact can say it' ((Format-ThornswoodArtifact $a) -match '^server-cdd846514ae7-.*8 file\(s\)')

    Write-Host ''
    Write-Host 'the same build is the same artifact'
    $b = New-ThornswoodServerBuildArtifact -From $dist -Record $recLf -OutDir (Join-Path $T 'out2')
    Yes 'built again elsewhere: the same name and bytes' ($b.Name -eq $a.Name -and (ShaFile $b.Zip) -eq $a.Sha256)
    $c = New-ThornswoodServerBuildArtifact -From $dist -Record $recCrlf -OutDir (Join-Path $T 'out3')
    Yes 'with the record checked out CR LF: the same name and bytes' ($c.Name -eq $a.Name -and (ShaFile $c.Zip) -eq $a.Sha256)
    # A payload as Export-ServerPayload makes one: the recorded files, ours,
    # the plugins and the record, zipped by .NET.
    $pay = Join-Path $T 'payload'
    Build $pay
    Put (Join-Path $pay 'plugins\Skyrim.esm') 'a plugin'
    Put (Join-Path $pay 'thornswood-build.json') '{"channel":"dev"}'
    Copy-Item -LiteralPath $recCrlf -Destination (Join-Path $pay 'server-build.json')
    $payZip = Join-Path $T 'thornswood-server.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($pay, $payZip)
    $d = New-ThornswoodServerBuildArtifact -From $payZip -Record $recCrlf -OutDir (Join-Path $T 'out4')
    Yes 'read out of a payload zip, plugins and all beside it: the same name and bytes' ($d.Name -eq $a.Name -and (ShaFile $d.Zip) -eq $a.Sha256)
    $again = New-ThornswoodServerBuildArtifact -From $dist -Record $recLf -OutDir (Join-Path $T 'out1')
    Yes 'built over itself: the one zip, no stray build file' ($again.Name -eq $a.Name -and @(Get-ChildItem -LiteralPath (Join-Path $T 'out1') -File).Count -eq 2)

    Write-Host ''
    Write-Host 'what it refuses, writing nothing'
    $bad1 = Join-Path $T 'bad1'; Build $bad1 @{ 'dist_back/skymp5-server.js' = 'a javascript half from another build' }
    $o5 = Join-Path $T 'out5'
    $m = Threw { New-ThornswoodServerBuildArtifact -From $bad1 -Record $recLf -OutDir $o5 }
    Yes 'a file that is not the recorded build, named' ($m -match 'skymp5-server\.js' -and $m -match 'Nothing was built' -and -not (Test-Path -LiteralPath $o5))
    $bad2 = Join-Path $T 'bad2'; Build $bad2 @{} 'second.node'
    $m = Threw { New-ThornswoodServerBuildArtifact -From $bad2 -Record $recLf -OutDir $o5 }
    Yes 'a server file the record does not list' ($m -match 'second\.node' -and -not (Test-Path -LiteralPath $o5))
    $recNone = Join-Path $T 'record-nocommit.json'
    [IO.File]::WriteAllText($recNone, (RecordText '').Replace('"commit":  ""', '"commit": ""'), (New-Object Text.UTF8Encoding($false)))
    $m = Threw { New-ThornswoodServerBuildArtifact -From $dist -Record $recNone -OutDir $o5 }
    Yes 'a record with no fork commit' ($m -match 'no fork commit' -and -not (Test-Path -LiteralPath $o5))
    $m = Threw { New-ThornswoodServerBuildArtifact -From $dist -Record (Join-Path $T 'none.json') -OutDir $o5 }
    Yes 'no record' ($m -match 'no build record' -and -not (Test-Path -LiteralPath $o5))
    $m = Threw { New-ThornswoodServerBuildArtifact -From (Join-Path $T 'nothing-here') -Record $recLf -OutDir $o5 }
    Yes 'no build' ($m -match 'no server build' -and -not (Test-Path -LiteralPath $o5))

    Write-Host ''
    Write-Host 'the deploys keep it'
    $ps = [IO.File]::ReadAllText((Join-Path $Repo 'scripts\release\Publish-Server.ps1'))
    $iBuild = $ps.IndexOf('New-ThornswoodServerBuildArtifact -From $Zip -Record $Record')
    $iCopy = $ps.IndexOf("Head 'Copying'")
    Yes 'Publish-Server builds it from the payload it checked, before anything is copied' ($iBuild -gt 0 -and $iCopy -gt $iBuild -and
        $iBuild -gt $ps.IndexOf('$zipBuild = @(Get-ThornswoodServerBuildProblems'))
    $save = [regex]::Match($ps, '(?s)function Save-ServerRecords.*?\n\}').Value
    Yes '  and sends it to the store with the gamemode artifact, once the install answers' (
        $save.IndexOf('Send-ThornswoodArtifact -Artifact $serverArtifact') -gt 0 -and
        $save.IndexOf('Send-ThornswoodArtifact -Artifact $serverArtifact') -lt $save.IndexOf('Set-ThornswoodServerRecord'))
    $ds = [IO.File]::ReadAllText((Join-Path $Repo 'scripts\deploy\Deploy-Server.ps1'))
    $iDsBuild = $ds.IndexOf('$serverArtifact = New-ThornswoodServerBuildArtifact -From $Dist -Record $recordPath')
    $iDsSend = $ds.IndexOf('Send-ThornswoodArtifact -Artifact $serverArtifact')
    Yes 'Deploy-Server builds it once the build is held to the record' ($iDsBuild -gt $ds.IndexOf('$notBuild = @(Get-ThornswoodServerBuildProblems'))
    Yes '  and sends it before the stage, on a full deploy only' ($iDsSend -gt $iDsBuild -and $iDsSend -lt $ds.IndexOf('Staging in') -and
        $ds -match '(?s)if \(-not \$noBuild\) \{\s+Write-Host ''The server build artifact, to the store on the box\.\.\.''\s+Send-ThornswoodArtifact -Artifact \$serverArtifact')
} finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
