<#
  test-deploy-artifact.ps1

      pwsh -NoProfile -File .\tests\test-deploy-artifact.ps1

  Issue #459: every deploy (gamemode, site, voice, bot) builds one versioned
  artifact, a zip named by component, commit and sha256, sends that and
  records it on the box, so the box can say exactly which commit each part
  runs. scripts\deploy\Artifact.ps1 does it; this proves:

    1. The same commit gives the same bytes: built twice, built from a second
       clone that checks files out with CRLF, and built by the other
       PowerShell (5.1 or 7, whichever this is not) all give one sha256.
    2. The record matches: its sha256 and size are the zip's, its commit is
       HEAD, and its file list is the zip's entries, each with the size and
       sha256 of the commit's own bytes. The name carries the component, the
       commit and the hash.
    3. A deploy sends a commit or nothing (#1121, Patrick 29 Sep): a file
       under the named paths that is changed, staged, deleted or untracked,
       or one of the other files the deploy sends (-AlsoSends), refuses the
       build, naming every such file; an ignored file does not count and
       never goes in; there is no way to hand it a file from elsewhere; a
       path the commit lacks stops the build.
    4. Sending and recording, against a stand-in box (ssh and scp replaced by
       functions that act on a temp folder): the store gets the zip and its
       record, a zip the store already holds is not sent again, and
       current\<part>.json, the copy beside the part and history.log all say
       the artifact.
    5. The five deploy scripts, read and never run: each builds its
       component's artifact, sends it before anything is swapped, sends from
       its folder, and records it once the files are in place; each names
       the other repository files it sends so they are checked too, and
       Publish-Server refuses before its first scp; and the site's reader,
       Deploy-Docs' grant and Artifact.ps1 name one store.
       tests\test-deploy-swaps.ps1 runs each of them against a dirty tree.
    6. Site and voice, before anything would be sent (#1335): the expanded
       tree and the zip have to match the commit's own bytes. A flipped
       file, an extra file, a flipped zip or an artifact from another
       commit is refused, and the refusal happens before a send.

  Read only apart from files under its own temp folder.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

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
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$helper = Join-Path $Repo 'scripts\deploy\Artifact.ps1'
Yes 'scripts\deploy\Artifact.ps1 is there' (Test-Path -LiteralPath $helper)
if (-not (Test-Path -LiteralPath $helper)) { Done }
. $helper
. (Join-Path $Repo 'scripts\release\BuildStamp.ps1')
Add-Type -AssemblyName System.IO.Compression.FileSystem

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-artifact-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$src = Join-Path $tmp 'repo'
$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$path, [string]$text) {
    $d = Split-Path -Parent $path
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
    [IO.File]::WriteAllText($path, $text, $utf8)
}
# Not named Git: a function called git would be found before the program.
function Run-Git { $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; & git @args 2>&1 | Out-Null; $ErrorActionPreference = $old }
function Head-Of([string]$dir) { return ((& git -C $dir rev-parse HEAD) | Out-String).Trim() }
function Blob([string]$dir, [string]$spec) {
    # The commit's own bytes, read from git's output stream itself. A pipe
    # would decode them, and so does Start-Process -RedirectStandardOutput
    # off Windows (on Linux it turned 14 bytes into 18, #2872).
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = 'git'
    $psi.Arguments = '-C "' + $dir + '" cat-file blob ' + $spec
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $p = [Diagnostics.Process]::Start($psi)
    $ms = New-Object IO.MemoryStream
    $p.StandardOutput.BaseStream.CopyTo($ms)
    $p.WaitForExit()
    $b = $ms.ToArray()
    return ,$b
}
function Hex([byte[]]$b) { return (Get-ThornswoodSha256Hex $b) }

$oldCeiling = $env:GIT_CEILING_DIRECTORIES
$env:GIT_CEILING_DIRECTORIES = $tmp

try {
    # ---- a scratch repository, committed with LF ---------------------------
    Put (Join-Path $src 'site\server.js') "'use strict';`nconsole.log('site');`n"
    Put (Join-Path $src 'site\public\index.html') "<!doctype html>`n<p>hello</p>`n"
    Put (Join-Path $src 'site\public\b.css') "p { color: red; }`n"
    Put (Join-Path $src 'site\data\help.md') "# Help`n`nline`n"
    Put (Join-Path $src 'site\README.md') "not sent`n"
    Put (Join-Path $src 'game\gamemode.js') "'use strict';`nconsole.log('gamemode');`n"
    Put (Join-Path $src '.gitignore') "site/public/*.tmp`n"
    [IO.File]::WriteAllBytes((Join-Path $src 'site\public\logo.png'), [byte[]](0, 1, 2, 3, 255, 13, 10, 0))
    Put (Join-Path $src 'voice\voice-server.js') "'use strict';`nconst BUILD = 'test';`n"
    Put (Join-Path $src 'voice\headlines.js') "'use strict';`nconsole.log('headlines');`n"
    Run-Git -C $src init -q
    Run-Git -C $src config core.autocrlf false
    Run-Git -C $src add -A
    Run-Git -C $src -c user.name=test -c user.email=test@example.invalid -c commit.gpgsign=false commit -q -m one
    $head = Head-Of $src
    Yes "the scratch repository has a commit ($($head.Substring(0, 12)))" ($head -match '^[0-9a-f]{40}$')

    $paths = @('site/server.js', 'site/public', 'site/data')

    # ---- 1. the same commit, the same bytes --------------------------------
    $a1 = New-ThornswoodArtifact -Component site -RepoDir $src -Paths $paths -OutDir (Join-Path $tmp 'out1')
    $a2 = New-ThornswoodArtifact -Component site -RepoDir $src -Paths $paths -OutDir (Join-Path $tmp 'out2')
    Yes 'built twice: one sha256' ($a1.Sha256 -eq $a2.Sha256)
    Yes 'built twice: the same bytes on disk' ((Get-FileHash -LiteralPath $a1.Zip).Hash -eq (Get-FileHash -LiteralPath $a2.Zip).Hash)
    Yes 'built twice: the same record' ((Get-Content -LiteralPath $a1.RecordPath -Raw) -eq (Get-Content -LiteralPath $a2.RecordPath -Raw))

    # A second clone that checks text out with CRLF, as One's git does.
    $crlf = Join-Path $tmp 'crlf'
    Run-Git -c core.autocrlf=true clone -q $src $crlf
    Run-Git -C $crlf config core.autocrlf true
    $onDisk = [IO.File]::ReadAllText((Join-Path $crlf 'site\server.js'))
    Yes 'the second clone has CRLF on disk' ($onDisk.Contains("`r`n"))
    $a3 = New-ThornswoodArtifact -Component site -RepoDir $crlf -Paths $paths -OutDir (Join-Path $tmp 'out3')
    Yes 'a CRLF checkout of the same commit builds the same bytes' ($a3.Sha256 -eq $a1.Sha256 -and $a3.Name -eq $a1.Name)
    Yes 'and does not count line endings as uncommitted changes' ($a3.Sha256 -eq $a1.Sha256)

    # The other PowerShell, whichever this is not.
    $other = $(if ($PSVersionTable.PSEdition -eq 'Core') { 'powershell.exe' } else { 'pwsh' })
    $otherCmd = Get-Command $other -ErrorAction SilentlyContinue
    if ($otherCmd) {
        $script = Join-Path $tmp 'other.ps1'
        Put $script ('. ''' + $helper.Replace("'", "''") + "'`n" +
                     '$a = New-ThornswoodArtifact -Component site -RepoDir ''' + $src.Replace("'", "''") + ''' -Paths ''site/server.js'', ''site/public'', ''site/data'' -OutDir ''' + (Join-Path $tmp 'out4').Replace("'", "''") + "'`n" +
                     'Write-Output (''SHA '' + $a.Sha256)' + "`n")
        $said = @(& $otherCmd.Source -NoProfile -ExecutionPolicy Bypass -File $script 2>&1 | ForEach-Object { "$_" })
        $shaLine = @($said | Where-Object { $_ -like 'SHA *' }) | Select-Object -Last 1
        Yes "$other builds the same bytes as PowerShell $($PSVersionTable.PSVersion.Major)" ($shaLine -eq ('SHA ' + $a1.Sha256))
        if ($shaLine -ne ('SHA ' + $a1.Sha256)) { $said | Select-Object -Last 8 | ForEach-Object { Write-Host "  $_" } }
    } else {
        Write-Host "SKIP  $other is not on this machine, so only one PowerShell built it"
    }

    # ---- 2. the record matches ---------------------------------------------
    $r = Get-Content -LiteralPath $a1.RecordPath -Raw | ConvertFrom-Json
    Yes 'the name is component, commit and hash' ($a1.Name -eq ('site-' + $head.Substring(0, 12) + '-' + $a1.Sha256.Substring(0, 16) + '.zip'))
    Yes 'the record sits beside the zip, named the same' ([IO.Path]::GetFileNameWithoutExtension($a1.RecordPath) -eq [IO.Path]::GetFileNameWithoutExtension($a1.Zip))
    Yes "the record's sha256 is the zip's" ($r.sha256 -eq (Get-FileHash -LiteralPath $a1.Zip -Algorithm SHA256).Hash.ToLowerInvariant())
    Yes "the record's size is the zip's" ([long]$r.size -eq (Get-Item -LiteralPath $a1.Zip).Length)
    Yes "the record's commit is HEAD, in full" ($r.commit -eq $head)
    Yes 'the record says component site, and nothing about edits, since there can be none' ($r.component -eq 'site' -and -not ($r.PSObject.Properties.Name -contains 'edited'))
    Yes 'the record names the zip' ($r.name -eq $a1.Name)

    $z = [IO.Compression.ZipFile]::OpenRead($a1.Zip)
    try {
        $entries = @($z.Entries | ForEach-Object { $_.FullName })
        $bytes = @{}
        foreach ($e in $z.Entries) {
            $ms = New-Object IO.MemoryStream
            $st = $e.Open(); $st.CopyTo($ms); $st.Dispose()
            $bytes[$e.FullName] = $ms.ToArray()
        }
    } finally { $z.Dispose() }
    $want = @('site/data/help.md', 'site/public/b.css', 'site/public/index.html', 'site/public/logo.png', 'site/server.js')
    Yes 'the zip holds exactly the named paths, in ordinal order' (($entries -join '|') -eq ($want -join '|'))
    Yes 'a file outside the named paths stays out' ($entries -notcontains 'site/README.md')
    Yes "the record's file list is the zip's entries" ((@($r.files | ForEach-Object { $_.path }) -join '|') -eq ($entries -join '|'))
    $allMatch = $true
    foreach ($f in $r.files) {
        $b = [byte[]]$bytes[$f.path]
        $c = Blob $src ($head + ':' + $f.path)
        if ($b.Length -ne [int]$f.size -or (Hex $b) -ne $f.sha256 -or (Hex $c) -ne $f.sha256) { $allMatch = $false; Write-Host "  differs: $($f.path)" }
    }
    Yes "every entry is the commit's own bytes, and the record's size and sha256 for it" $allMatch
    Yes 'text went in as the commit holds it, LF, whatever the checkout' (-not ([Text.Encoding]::UTF8.GetString([byte[]]$bytes['site/server.js'])).Contains("`r"))
    $folder = Join-Path $a3.Folder 'site\server.js'
    Yes 'the folder the scripts send from is the zip expanded, laid out like the repository' (
        (Test-Path -LiteralPath $folder) -and (Hex ([IO.File]::ReadAllBytes($folder))) -eq (Hex ([byte[]]$bytes['site/server.js'])))

    # ---- 3. uncommitted is refused, ignored does not count, missing stops ---
    # What a refused build said, or '' when it built.
    function Refusal([scriptblock]$build) {
        try { $null = & $build; return '' } catch { return $_.Exception.Message }
    }
    $out5 = Join-Path $tmp 'out5'
    Put (Join-Path $src 'site\public\b.css') "p { color: blue; }`n"
    $why = Refusal { New-ThornswoodArtifact -Component site -RepoDir $src -Paths $paths -OutDir $out5 }
    Yes 'a changed file refuses the build' ($why -match '^Refused: the site deploy would send 1 file')
    Yes '  naming the file and how, and saying the box was not touched' (
        $why.Contains('site/public/b.css  (changed and not committed)') -and $why -match 'the box was not touched')
    Yes '  and nothing is built' (-not (Test-Path -LiteralPath $out5) -or -not @(Get-ChildItem -LiteralPath $out5 -Filter '*.zip').Count)
    Run-Git -C $src add -- site/public/b.css
    $why = Refusal { New-ThornswoodArtifact -Component site -RepoDir $src -Paths $paths -OutDir $out5 }
    Yes 'a staged change refuses it too' ($why.Contains('site/public/b.css  (changed and not committed)'))
    Run-Git -C $src reset -q -- site/public/b.css
    Run-Git -C $src checkout -q -- site/public/b.css
    Put (Join-Path $src 'site\public\new.svg') "<svg/>`n"
    Remove-Item -LiteralPath (Join-Path $src 'site\data\help.md') -Force
    $why = Refusal { New-ThornswoodArtifact -Component site -RepoDir $src -Paths $paths -OutDir $out5 }
    Yes 'an untracked file and a deleted one refuse it, each named' (
        $why -match 'would send 2 file' -and $why.Contains('site/public/new.svg  (new and not committed)') -and
        $why.Contains('site/data/help.md  (deleted and not committed)'))
    Remove-Item -LiteralPath (Join-Path $src 'site\public\new.svg') -Force
    Run-Git -C $src checkout -q -- site/data/help.md
    Put (Join-Path $src 'site\public\scratch.tmp') "ignored`n"
    $back = New-ThornswoodArtifact -Component site -RepoDir $src -Paths $paths -OutDir (Join-Path $tmp 'out6')
    Yes 'an ignored file does not count, and never goes in' ($back.Sha256 -eq $a1.Sha256 -and -not (Test-Path -LiteralPath (Join-Path $back.Folder 'site\public\scratch.tmp')))
    Yes 'with the changes gone it is the clean artifact again, byte for byte' ($back.Sha256 -eq $a1.Sha256)
    Put (Join-Path $src 'site\README.md') "changed, and not sent`n"
    Yes 'a change outside what the deploy sends does not stop it' ((Refusal { New-ThornswoodArtifact -Component site -RepoDir $src -Paths $paths -OutDir (Join-Path $tmp 'out6b') }) -eq '')
    $why = Refusal { New-ThornswoodArtifact -Component site -RepoDir $src -Paths $paths -AlsoSends 'site/README.md' -OutDir (Join-Path $tmp 'out6c') }
    Yes 'but one of the other files it sends (-AlsoSends) refuses it, named' ($why.Contains('site/README.md  (changed and not committed)'))
    Run-Git -C $src checkout -q -- site/README.md
    $why = Refusal { Assert-ThornswoodCommitted -RepoDir $src -Paths 'game/gamemode.js', 'site' -What 'this publish' }
    Yes 'Assert-ThornswoodCommitted on its own passes a clean tree' ($why -eq '')
    Put (Join-Path $src 'game\gamemode.js') "'use strict';`nconsole.log('changed');`n"
    $why = Refusal { Assert-ThornswoodCommitted -RepoDir $src -Paths 'game/gamemode.js', 'site' -What 'this publish' }
    Yes '  and refuses a dirty one, in the words the caller gave' ($why -match '^Refused: this publish would send 1 file' -and $why.Contains('game/gamemode.js'))
    Run-Git -C $src checkout -q -- game/gamemode.js

    $threw = $false
    try { $null = New-ThornswoodArtifact -Component site -RepoDir $src -Paths 'site/nothing-here' -OutDir (Join-Path $tmp 'out7') } catch { $threw = $true }
    Yes 'a path the commit lacks stops the build' $threw

    # #2711: the blob reader closed git's input in a try with an empty catch.
    # Now a read that fails closes it and says so beside the failure, and a
    # read that finished is held to git ending cleanly.
    $gitExe = (Get-Command git -CommandType Application | Select-Object -First 1).Source
    $blobId = ((& git -C $src rev-parse 'HEAD:site/server.js') | Out-String).Trim()
    $treeId = ((& git -C $src rev-parse 'HEAD:site') | Out-String).Trim()
    $got = [ThornswoodArtifactZip]::ReadBlobs($gitExe, $src, [string[]]@($blobId))
    Yes 'the blob reader gives a blob''s exact bytes' ((Hex $got[0]) -eq (Hex ([IO.File]::ReadAllBytes((Join-Path $src 'site\server.js')))))
    $why = ''
    try { $null = [ThornswoodArtifactZip]::ReadBlobs($gitExe, $src, [string[]]@($blobId, $treeId)) } catch { $why = $_.Exception.InnerException.Message; if (-not $why) { $why = $_.Exception.Message } }
    Yes 'a read that fails stops, naming git and the repository, and git is let go' ($why -match 'git cat-file --batch in .+ failed: git cat-file answered: [0-9a-f]{40} tree')

    $params = @((Get-Command New-ThornswoodArtifact).Parameters.Keys | Where-Object { [System.Management.Automation.PSCmdlet]::CommonParameters -notcontains $_ })
    Yes 'New-ThornswoodArtifact takes no file from elsewhere and no switch past the refusal' (
        ((($params | Sort-Object) -join ',') -eq 'AlsoSends,Component,OutDir,Paths,RepoDir'))

    # A second commit is a second name.
    Put (Join-Path $src 'site\server.js') "'use strict';`nconsole.log('site two');`n"
    Run-Git -C $src add -A
    Run-Git -C $src -c user.name=test -c user.email=test@example.invalid -c commit.gpgsign=false commit -q -m two
    $head2 = Head-Of $src
    $n2 = New-ThornswoodArtifact -Component site -RepoDir $src -Paths $paths -OutDir (Join-Path $tmp 'out9')
    Yes 'the next commit gives another name and records that commit' ($n2.Name -like ('site-' + $head2.Substring(0, 12) + '-*.zip') -and $n2.Commit -eq $head2 -and $n2.Sha256 -ne $a1.Sha256)

    # The gamemode stamp takes the artifact's word for the commit.
    $g = New-ThornswoodArtifact -Component gamemode -RepoDir $src -Paths 'game/gamemode.js' -OutDir (Join-Path $tmp 'out10')
    $stamp = New-ThornswoodBuildStamp -Gamemode (Join-Path $g.Folder 'game\gamemode.js') -Channel dev -RepoDir $src -Artifact $g
    Yes "the build stamp names the artifact's commit, and that the commit holds it" ($stamp.commit -eq $g.Short -and $stamp.gamemodeMatchesCommit -eq $true)
    # 19 Oct: after #2747 every artifact's Short was '' and the stamp said "no commit".
    Yes "  and that commit is the artifact's own twelve, not empty" ($g.Short -match '^[0-9a-f]{12}$' -and $g.Commit.StartsWith($g.Short) -and (Format-ThornswoodArtifact $g) -match (', commit ' + $g.Short + ','))

    # ---- 3b. site and voice source integrity, before anything is sent ------
    # Issue #1335. The check has to pass on the tree that would be sent, and
    # a failure has to stop short of sending.
    function Flip-Last([string]$path) {
        $b = [IO.File]::ReadAllBytes($path)
        $b[$b.Length - 1] = ($b[$b.Length - 1] -bxor 0x5A)
        [IO.File]::WriteAllBytes($path, $b)
    }
    $shipped = $false
    try {
        Assert-ThornswoodSourceIntegrity -Artifact $n2 -RepoDir $src
        $shipped = $true
    } catch { $shipped = $false }
    Yes 'a site tree that matches the commit may be sent' $shipped

    $why = Refusal { Assert-ThornswoodSourceIntegrity -Artifact $a1 -RepoDir $src }
    Yes 'an artifact built from an older commit is refused, and nothing is sent' (
        $why -match 'not HEAD' -and $why -match 'nothing was sent' -and $why -match 'the box was not touched')

    $siteFile = Join-Path $n2.Folder 'site\server.js'
    Flip-Last $siteFile
    $shipped = $false
    $why = Refusal {
        Assert-ThornswoodSourceIntegrity -Artifact $n2 -RepoDir $src
        $shipped = $true
    }
    Yes 'a tampered site file is refused before a send' (
        -not $shipped -and $why.Contains('site/server.js') -and $why -match 'nothing was sent' -and $why -match 'the box was not touched')
    Flip-Last $siteFile
    Yes 'the site tree is accepted again once the file matches the commit' (
        (Refusal { Assert-ThornswoodSourceIntegrity -Artifact $n2 -RepoDir $src }) -eq '')

    $extra = Join-Path $n2.Folder 'site\public\evil.html'
    Put $extra "no`n"
    $why = Refusal { Assert-ThornswoodSourceIntegrity -Artifact $n2 -RepoDir $src }
    Yes 'a file added to the site tree is refused' ($why.Contains('site/public/evil.html') -and $why -match 'nothing was sent')
    Remove-Item -LiteralPath $extra -Force
    Yes 'removing that file lets the site tree pass' ((Refusal { Assert-ThornswoodSourceIntegrity -Artifact $n2 -RepoDir $src }) -eq '')

    Flip-Last $n2.Zip
    $why = Refusal { Assert-ThornswoodSourceIntegrity -Artifact $n2 -RepoDir $src }
    Yes 'a tampered site zip is refused before a send' ($why -match 'zip is not the bytes' -and $why -match 'nothing was sent')
    Flip-Last $n2.Zip
    Yes 'the site zip is accepted again once its hash matches' ((Refusal { Assert-ThornswoodSourceIntegrity -Artifact $n2 -RepoDir $src }) -eq '')

    $voicePaths = @('voice/voice-server.js', 'voice/headlines.js')
    $v = New-ThornswoodArtifact -Component voice -RepoDir $src -Paths $voicePaths -OutDir (Join-Path $tmp 'out-voice')
    $shipped = $false
    try {
        Assert-ThornswoodSourceIntegrity -Artifact $v -RepoDir $src
        $shipped = $true
    } catch { $shipped = $false }
    Yes 'a voice tree that matches the commit may be sent' $shipped
    $voiceFile = Join-Path $v.Folder 'voice\headlines.js'
    Flip-Last $voiceFile
    $shipped = $false
    $why = Refusal {
        Assert-ThornswoodSourceIntegrity -Artifact $v -RepoDir $src
        $shipped = $true
    }
    Yes 'a tampered voice file is refused before a send' (
        -not $shipped -and $why.Contains('voice/headlines.js') -and $why -match 'nothing was sent' -and $why -match 'the box was not touched')
    Flip-Last $voiceFile
    Yes 'the voice tree is accepted again once the file matches the commit' (
        (Refusal { Assert-ThornswoodSourceIntegrity -Artifact $v -RepoDir $src }) -eq '')

    # ---- 4. sending and recording, against a stand-in box ------------------
    $box = Join-Path $tmp 'box'
    $store = (Join-Path $box 'Thornswood-Deploys').Replace('\', '/')
    $partRoot = (Join-Path $box 'Thornswood-Server-Dev').Replace('\', '/')
    New-Item -ItemType Directory -Force -Path (Join-Path $partRoot 'data') | Out-Null
    $global:tsScp = @()
    $global:tsSsh = 0
    $global:tsFarTemp = (Join-Path $box 'Temp').Replace('\', '/') + '/'
    New-Item -ItemType Directory -Force -Path $global:tsFarTemp | Out-Null
    function global:scp {
        $far = [string]$args[-1]; $local = [string]$args[-2]
        $path = $far.Substring($far.IndexOf(':', $far.IndexOf('@')) + 1)
        # The box's C:/Windows/Temp is the stand-in box's own temp, never this
        # machine's (a non-admin runner may not remove files there).
        $path = $path.Replace('C:/Windows/Temp/', $global:tsFarTemp)
        $global:tsScp += $path
        Copy-Item -LiteralPath $local -Destination $path -Force
        $global:LASTEXITCODE = 0
    }
    function global:ssh {
        $in = @($input | ForEach-Object { [string]$_ })
        $global:tsSsh++
        $cmd = ([string]$args[-1]).Replace('C:/Windows/Temp/', $global:tsFarTemp)
        if ($cmd -match ' -Command (.+)$') { & ([ScriptBlock]::Create($Matches[1])) }
        else {
            $b64 = ($cmd -split ' ')[-1]
            $text = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($b64))
            # A script past Send-Script.ps1's limit (the store's lock from
            # Lock-Folder.ps1 makes Send-ThornswoodArtifact's one) comes by
            # scp, and the runner on the line takes the copy off the box and
            # runs it (#3059).
            $rp = Get-ThornswoodRemoteRunnerPath $text
            if ($rp) { $rf = $global:tsFarTemp + ($rp -split '\\')[-1]; $text = [IO.File]::ReadAllText($rf); Remove-Item -LiteralPath $rf -Force }
            & ([ScriptBlock]::Create($text))
        }
        $global:LASTEXITCODE = 0
    }
    try {
        Send-ThornswoodArtifact -Artifact $g -Target 'someone@box' -SshArgs @('-o', 'BatchMode=yes') -Store $store
        $zipThere = Join-Path $store ('gamemode/' + $g.Name)
        Yes 'the store on the box holds the zip' (Test-Path -LiteralPath $zipThere)
        Yes 'as it was built' ((Test-Path -LiteralPath $zipThere) -and (Get-FileHash -LiteralPath $zipThere).Hash.ToLowerInvariant() -eq $g.Sha256)
        Yes 'and its record beside it' (Test-Path -LiteralPath ([IO.Path]::ChangeExtension($zipThere, '.json')))
        $before = @($global:tsScp | Where-Object { $_ -like '*.zip' }).Count
        Send-ThornswoodArtifact -Artifact $g -Target 'someone@box' -Store $store
        Yes 'a zip the store already holds is not sent again' (@($global:tsScp | Where-Object { $_ -like '*.zip' }).Count -eq $before)

        $rec = Set-ThornswoodArtifactCurrent -Artifact $g -Target 'someone@box' -Root $partRoot -Beside "$partRoot/data/thornswood-deploy.json" -Store $store
        $cur = Join-Path $store 'current/thornswood-server-dev.json'
        Yes 'the part is named after the folder it runs from' ($rec.part -eq 'thornswood-server-dev')
        Yes 'current\<part>.json is on the box' (Test-Path -LiteralPath $cur)
        $c = Get-Content -LiteralPath $cur -Raw | ConvertFrom-Json
        Yes 'and says the commit, the zip and its hash' ($c.commit -eq $g.Commit -and $c.name -eq $g.Name -and $c.sha256 -eq $g.Sha256 -and $c.component -eq 'gamemode' -and -not ($c.PSObject.Properties.Name -contains 'edited'))
        # Read as text: PowerShell 7's ConvertFrom-Json turns a date into a DateTime.
        Yes 'and when, and from which machine' ((Get-Content -LiteralPath $cur -Raw) -match '"deployedUtc":\s*"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ"' -and $c.from -eq [Environment]::MachineName)
        $beside = Join-Path $partRoot 'data/thornswood-deploy.json'
        Yes 'the same record is beside what the part runs' ((Test-Path -LiteralPath $beside) -and (Get-Content -LiteralPath $beside -Raw) -eq (Get-Content -LiteralPath $cur -Raw))
        $bb = [IO.File]::ReadAllBytes($beside)
        Yes 'with no byte order mark, so node reads it' ($bb.Length -gt 3 -and -not ($bb[0] -eq 0xEF -and $bb[1] -eq 0xBB))
        $hist = @(Get-Content -LiteralPath (Join-Path $store 'history.log'))
        Yes 'and history.log has a line for it' ($hist.Count -eq 1 -and $hist[0] -like ('* thornswood-server-dev ' + $g.Name + ' from *'))
        New-Item -ItemType Directory -Force -Path (Join-Path $box 'Thornswood-Docs') | Out-Null
        $rec2 = Set-ThornswoodArtifactCurrent -Artifact $n2 -Target 'someone@box' -Root "$box/Thornswood-Docs" -Store $store
        Yes 'the default copy goes beside the root, and each part keeps its own record' (
            (Test-Path -LiteralPath (Join-Path $box 'Thornswood-Docs/thornswood-deploy.json')) -and
            (Test-Path -LiteralPath (Join-Path $store 'current/thornswood-docs.json')) -and
            ((Get-Content -LiteralPath $cur -Raw | ConvertFrom-Json).name -eq $g.Name))
    } finally {
        Remove-Item -Path Function:\scp, Function:\ssh -ErrorAction SilentlyContinue
    }
} finally {
    $env:GIT_CEILING_DIRECTORIES = $oldCeiling
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- 5. the deploy scripts, read and never run -----------------------------
function Read-Ast([string]$rel) {
    $p = Join-Path $Repo $rel
    if (-not (Test-Path -LiteralPath $p)) { return $null }
    $tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { return $null }
    return $ast
}
function Commands($ast, [string]$name) {
    if (-not $ast) { return @() }
    return @($ast.FindAll({ param($n)
        $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq $name
    }, $true))
}
function Arg($cmd, [string]$name) {
    $els = $cmd.CommandElements
    for ($i = 0; $i -lt $els.Count - 1; $i++) {
        if ($els[$i] -is [System.Management.Automation.Language.CommandParameterAst] -and
            $els[$i].ParameterName -eq $name) { return $els[$i + 1].Extent.Text }
    }
    return ''
}
function DotSources($ast, [string]$file) {
    if (-not $ast) { return $false }
    foreach ($h in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and
            $n.InvocationOperator -eq [System.Management.Automation.Language.TokenKind]::Dot }, $true)) {
        if ($h.Extent.Text -like "*$file*") { return $true }
    }
    return $false
}
function At($ast, [string]$text) { if (-not $ast) { return -1 }; return $ast.Extent.Text.IndexOf($text) }

$wiring = @(
    @{ File = 'scripts\deploy\Deploy-Docs.ps1';        Component = 'site';     SendsFrom = '$App = Join-Path $artifact.Folder ''site''' },
    @{ File = 'scripts\deploy\Install-Voice.ps1';      Component = 'voice';    SendsFrom = '$src = Join-Path $artifact.Folder ''voice''' },
    @{ File = 'scripts\deploy\Install-Bot.ps1';        Component = 'bot';      SendsFrom = '$Repo = $artifact.Folder' },
    @{ File = 'scripts\deploy\Deploy-DevGamemode.ps1'; Component = 'gamemode'; SendsFrom = '$Gamemode = Join-Path $artifact.Folder ''game\gamemode.js''' },
    @{ File = 'scripts\deploy\Deploy-Server.ps1';      Component = 'gamemode'; SendsFrom = '$src = Join-Path $artifact.Folder ''game\gamemode.js''' }
)
foreach ($w in $wiring) {
    $n = Split-Path -Leaf $w.File
    $ast = Read-Ast $w.File
    Yes "$n parses" ($null -ne $ast)
    if (-not $ast) { continue }
    Yes "$n loads Artifact.ps1" (DotSources $ast 'Artifact.ps1')
    $builds = @(Commands $ast 'New-ThornswoodArtifact')
    Yes "$n builds the $($w.Component) artifact" ($builds.Count -ge 1 -and @($builds | Where-Object { (Arg $_ 'Component') -ne $w.Component }).Count -eq 0)
    # Its own artifact; Deploy-Server also sends the server build's (#459,
    # ServerArtifact.ps1), checked below.
    $sends = @(Commands $ast 'Send-ThornswoodArtifact' | Where-Object { (Arg $_ 'Artifact') -eq '$artifact' })
    $sets = @(Commands $ast 'Set-ThornswoodArtifactCurrent')
    Yes "$n sends it to the store once" ($sends.Count -eq 1)
    Yes "$n records it on the box once" ($sets.Count -eq 1)
    $from = At $ast $w.SendsFrom
    Yes "$n sends from the artifact's folder, not the working tree" ($from -ge 0)
    if ($builds.Count -and $sends.Count -and $sets.Count) {
        Yes "$n builds, then sends, then records" (
            $builds[0].Extent.StartOffset -lt $sends[0].Extent.StartOffset -and $sends[0].Extent.StartOffset -lt $sets[0].Extent.StartOffset)
    }
}

# The other repository files each sends, beside its artifact, are checked too.
$also = @(
    @{ File = 'scripts\deploy\Install-Voice.ps1';      Want = @('scripts/vps/Server-Log.js') },
    @{ File = 'scripts\deploy\Deploy-DevGamemode.ps1'; Want = @('records/most-online.json', 'records/server-build.json', 'game/content/Thornswood-Content.esp', 'game/data/last-plugin.recipe', 'game/data/last-plugin.json') },
    @{ File = 'scripts\deploy\Deploy-Server.ps1';      Want = @('game/content/Thornswood-Content.esp', 'game/data/last-plugin.recipe', 'game/data/last-plugin.json', 'records/server-build.json') }
)
foreach ($w in $also) {
    $t = Get-Content -LiteralPath (Join-Path $Repo $w.File) -Raw
    $missing = @($w.Want | Where-Object { -not $t.Contains("'" + $_ + "'") })
    Yes ((Split-Path -Leaf $w.File) + ' has the files it sends beside its artifact checked: ' + ($w.Want -join ', ')) (
        $missing.Count -eq 0 -and $t -match '-AlsoSends')
}
. (Join-Path $Repo 'scripts\release\RepoPlugins.ps1')
. (Join-Path $Repo 'scripts\deploy\LastPluginRecipe.ps1')
# Every plugin of ours but Thornswood-Last.esp, which the box makes from the
# recipe the deploy sends in its place (#2791).
foreach ($w in $also | Where-Object { $_.File -like '*Deploy-*' }) {
    $plug = @($w.Want | Where-Object { $_ -like 'game/content/*' } | ForEach-Object { $_.Substring(13) } | Sort-Object)
    $sent = @($ThornswoodRepoPlugins | Where-Object { $_ -ine $ThornswoodLastPlugin } | Sort-Object)
    Yes ((Split-Path -Leaf $w.File) + ' sends every plugin RepoPlugins.ps1 calls ours, no more, and Thornswood-Last.esp as its recipe (#2486, #2791)') (
        ($plug -join '|') -eq ($sent -join '|') -and @($w.Want) -contains 'game/data/last-plugin.recipe')
}
$iv = Read-Ast 'scripts\deploy\Install-Voice.ps1'
if ($iv) {
    $build = @(Commands $iv 'New-ThornswoodArtifact')
    Yes 'Install-Voice builds, so refuses, before it asks the box what is running' (
        $build.Count -eq 1 -and $build[0].Extent.StartOffset -lt (At $iv "`$current = & (Join-Path `$Here '..\vps\Remote.ps1')"))
}
$ps = Read-Ast 'scripts\release\Publish-Server.ps1'
Yes 'Publish-Server.ps1 parses' ($null -ne $ps)
if ($ps) {
    Yes 'Publish-Server loads Artifact.ps1' (DotSources $ps 'Artifact.ps1')
    $as = @(Commands $ps 'Assert-ThornswoodCommitted')
    $firstScp = @(Commands $ps 'scp' | Sort-Object { $_.Extent.StartOffset })
    Yes 'Publish-Server refuses uncommitted files before its first scp' (
        $as.Count -eq 1 -and $firstScp.Count -ge 1 -and $as[0].Extent.StartOffset -lt $firstScp[0].Extent.StartOffset)
    $pt = $ps.Extent.Text
    Yes '  and checks the installer, the log writer, the gamemode and the most online record' (
        $pt.Contains("'scripts/deploy/Install-ThornswoodServer.ps1'") -and $pt.Contains("'scripts/vps/Server-Log.js'") -and
        $pt.Contains("'game/gamemode.js'") -and $pt.Contains("'records/most-online.json'"))
}

$ds = Read-Ast 'scripts\deploy\Deploy-Server.ps1'
if ($ds) {
    $send = @(Commands $ds 'Send-ThornswoodArtifact' | Where-Object { (Arg $_ 'Artifact') -eq '$artifact' })
    $set = @(Commands $ds 'Set-ThornswoodArtifactCurrent')
    Yes 'Deploy-Server sends the artifact before anything is staged' ($send.Count -eq 1 -and $send[0].Extent.StartOffset -lt (At $ds 'Write-Host "Staging in'))
    $sendSrv = @(Commands $ds 'Send-ThornswoodArtifact' | Where-Object { (Arg $_ 'Artifact') -eq '$serverArtifact' })
    Yes '  and the server build''s, once, before anything is staged (#459)' ($sendSrv.Count -eq 1 -and $sendSrv[0].Extent.StartOffset -lt (At $ds 'Write-Host "Staging in') -and
        @(Commands $ds 'Send-ThornswoodArtifact').Count -eq 3)
    # -FromStore -ServerBuild sends a build CI made to the store, before the
    # stage too, after it is held to the record here (#459).
    $sendCi = @(Commands $ds 'Send-ThornswoodArtifact' | Where-Object { (Arg $_ 'Artifact') -eq '$sent' })
    Yes '  and -FromStore -ServerBuild''s, once, held to the record first and sent before anything is staged (#459)' (
        $sendCi.Count -eq 1 -and $sendCi[0].Extent.StartOffset -lt (At $ds 'Write-Host "Staging in') -and
        (At $ds '$sent = Test-ThornswoodServerBuildArtifact -Zip $ServerBuild -Record $recordPath') -lt $sendCi[0].Extent.StartOffset)
    Yes 'and records it only once the swap has said SWAP OK' ($set.Count -eq 1 -and $set[0].Extent.StartOffset -gt (At $ds "if (`$swapOut -notcontains 'SWAP OK')"))
    Yes 'and the live server serves the record from its data folder' ($set.Count -eq 1 -and (Arg $set[0] 'Beside') -eq '"$Root/data/thornswood-deploy.json"')
    Yes 'the build copy of gamemode.js is compared by hash, not by size' ((At $ds '(Get-FileHash -LiteralPath $src).Hash -ne (Get-FileHash -LiteralPath $built).Hash') -ge 0)
    $stamps = @(Commands $ds 'Save-ThornswoodBuildStamp')
    Yes "the stamp takes the artifact's commit" ($stamps.Count -eq 1 -and (Arg $stamps[0] 'Artifact') -eq '$artifact')
}
$dd = Read-Ast 'scripts\deploy\Deploy-DevGamemode.ps1'
if ($dd) {
    $set = @(Commands $dd 'Set-ThornswoodArtifactCurrent')
    # Since #446 the start is inside the swap, and the record waits for it to
    # have said SWAP OK, or since #3196 for the server to have loaded a reload.
    $okAt = At $dd 'if (-not $deployed) { exit 1 }'
    Yes 'Deploy-DevGamemode records it only once the swap has answered or the reload loaded' ($set.Count -eq 1 -and $okAt -gt 0 -and $set[0].Extent.StartOffset -gt $okAt)
    Yes 'and the dev server serves the record from its data folder' ($set.Count -eq 1 -and (Arg $set[0] 'Beside') -eq '"$Root/data/thornswood-deploy.json"')
    $stamps = @(Commands $dd 'Save-ThornswoodBuildStamp')
    Yes "its stamp takes the artifact's commit" ($stamps.Count -eq 1 -and (Arg $stamps[0] 'Artifact') -eq '$artifact')
    Yes 'its stamp is of the artifact copy, made after $Gamemode points at it' (
        $stamps.Count -eq 1 -and $stamps[0].Extent.StartOffset -gt (At $dd '$Gamemode = Join-Path $artifact.Folder'))
}

# One store, named the same in the three places that name it.
$storeLine = [regex]::Match((Get-Content -LiteralPath $helper -Raw), "\`$script:ThornswoodDeployStore = '([^']+)'").Groups[1].Value
Yes "Artifact.ps1 names the store ($storeLine)" ($storeLine -eq 'C:/Thornswood-Deploys')
# The site is server.js over its modules in site\lib since #5357.
. (Join-Path $PSScriptRoot 'SiteFiles.ps1')
$siteSrc = Get-SiteSource (Join-Path $Repo 'site')
Yes "the site reads current\ in that store by default" ($siteSrc.Contains('process.env.THORNSWOOD_DEPLOYS_DIR || ''C:\\Thornswood-Deploys\\current'''))
$docsSrc = Get-Content -LiteralPath (Join-Path $Repo 'scripts\deploy\Deploy-Docs.ps1') -Raw
# Named from the folder the site's root is in, C: on the box (#1273).
Yes "Deploy-Docs grants the site's account read on it" ($docsSrc.Contains("@('`$boxWin\Thornswood-Deploys\current', '(OI)(NP)R')"))


foreach ($rel in @('scripts\deploy\Deploy-Docs.ps1', 'scripts\deploy\Install-Voice.ps1')) {
    $ast = Read-Ast $rel
    $n = Split-Path -Leaf $rel
    $checks = @(Commands $ast 'Assert-ThornswoodSourceIntegrity')
    $sends = @(Commands $ast 'Send-ThornswoodArtifact')
    Yes "$n checks source integrity before it sends" (
        $null -ne $ast -and $checks.Count -ge 1 -and $sends.Count -eq 1 -and
        $checks[0].Extent.StartOffset -lt $sends[0].Extent.StartOffset)
}
$docsText = Get-Content -LiteralPath (Join-Path $Repo 'scripts\deploy\Deploy-Docs.ps1') -Raw
Yes 'Deploy-Docs still hash-compares server.js and the public files on the box' (
    $docsText.Contains('(Get-FileHash -LiteralPath ''$rootWin\server.js'' -Algorithm SHA256 -EA SilentlyContinue).Hash') -and
    $docsText.Contains('(Get-FileHash -LiteralPath `$_.FullName -Algorithm SHA256 -EA SilentlyContinue).Hash') -and
    $docsText.Contains('if ($publicThere[$_.Name] -eq (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)'))

Done
