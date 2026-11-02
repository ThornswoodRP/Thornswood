<#
  test-2459-artifact-unpack-race.ps1

      pwsh -NoProfile -File .\tests\test-2459-artifact-unpack-race.ps1

  Two runs at one commit from one checkout build the same artifact under the
  same names in out\deploys\<component>: the zip, its .json record and the
  unpacked folder. Issue #2459: New-ThornswoodArtifact used to Remove-Item the
  shared unpacked folder on every call, so two runs failed each other while
  one read game\gamemode.js. Issue #2742: it then looked for the zip and moved
  its own into the name, so two runs could both find it missing and the
  second's move failed with "Cannot create a file when that file already
  exists" (about one run of this harness in eight, measured on main 13cc245e).
  This proves:

    1. A second call for an already-unpacked artifact leaves the folder alone
       (same path, same mtime on a held file) with a reader open: no delete.
    2. Another run's whole build landing in the moment before this run names
       its zip, its record or its folder leaves this run finished with that
       same artifact, every time: the other run is put there, not hoped for.
       And a zip another run named, still held the way MoveFileExW holds
       it while it names it, is read and unpacked all the same (#3067).
    3. A zip, a record or a folder already at the name that is not what this
       run built is refused and left as it was, never replaced or used.
    4. Eight runs in separate processes, half under PowerShell 7 and half
       under Windows PowerShell 5.1 where both are here, released at once,
       three times over: every one finishes with the same artifact.
    5. No .building-* file and no unpacked folder but the one the .folder
       file names is left behind, and the source never Remove-Items the
       shared folder.

  Since #2888 a run unpacks into a folder of its own that is never renamed,
  and what is named is the small <zip basename>.folder file that says which
  folder is the artifact's; tests\test-2888-artifact-folder-name.ps1 holds
  that no folder is ever what gets named.

  Read only apart from files under its own temp folder.
#>
[CmdletBinding()]
param()
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
. (Join-Path $PSScriptRoot 'Windows.ps1')
Add-Type -AssemblyName System.IO.Compression.FileSystem

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-2459-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$src = Join-Path $tmp 'repo'
$out = Join-Path $tmp 'out'
$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$path, [string]$text) {
    $d = Split-Path -Parent $path
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
    [IO.File]::WriteAllText($path, $text, $utf8)
}
function Run-Git { $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; & git @args 2>&1 | Out-Null; $ErrorActionPreference = $old }
function Sha([string]$path) { return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Build([string]$OutDir) { return (New-ThornswoodArtifact -Component gamemode -RepoDir $src -Paths 'game' -OutDir $OutDir) }
# The harness's own reads of what is at the names, not the code under test's.
# '' when the folder holds every recorded file at its recorded size.
function FolderShort([string]$Folder, $Files) {
    if (-not (Test-Path -LiteralPath $Folder -PathType Container)) { return 'no folder' }
    foreach ($f in @($Files)) {
        $p = Join-Path $Folder ([string]$f.path).Replace('/', '\')
        if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { return ($f.path + ' missing') }
        if ((Get-Item -LiteralPath $p).Length -ne [long]$f.size) { return ($f.path + ' wrong size') }
    }
    return ''
}
# True when the record at $Path lists the same zip and the same files.
function RecordSame($Want, [string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    $have = [IO.File]::ReadAllText($Path) | ConvertFrom-Json
    if ([string]$have.name -ne [string]$Want.name -or [string]$have.sha256 -ne [string]$Want.sha256 -or
        [string]$have.commit -ne [string]$Want.commit -or [string]$have.size -ne [string]$Want.size) { return $false }
    $a = @($Want.files); $b = @($have.files)
    if ($a.Count -ne $b.Count) { return $false }
    for ($i = 0; $i -lt $a.Count; $i++) {
        if ([string]$a[$i].path -ne [string]$b[$i].path -or [string]$a[$i].sha256 -ne [string]$b[$i].sha256 -or [string]$a[$i].size -ne [string]$b[$i].size) { return $false }
    }
    return $true
}
# A handle on $Path the way MoveFileExW holds the file it names: delete
# access, sharing everything. Off Windows there is no delete access to ask
# for, and nothing there refuses a reader, so it is an ordinary handle.
if ($OnWindows -and -not ('Harness2459Hold' -as [type])) {
    Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class Harness2459Hold {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);

    public static SafeFileHandle Open(string path) {
        // DELETE | SYNCHRONIZE, FILE_SHARE_READ | WRITE | DELETE, OPEN_EXISTING.
        SafeFileHandle h = CreateFileW(path, 0x00010000 | 0x00100000, 7, IntPtr.Zero, 3, 0, IntPtr.Zero);
        if (h.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        return h;
    }
}
'@
}
function Hold-AsRenaming([string]$Path) {
    if ($OnWindows) { return [Harness2459Hold]::Open($Path) }
    return [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
}
# What a run must not leave in its folder: a .building-* of its own, or an
# unpacked folder that no .folder file there names.
function Leftovers([string]$OutDir) {
    $named = @(Get-ChildItem -LiteralPath $OutDir -Force -File -Filter '*.folder' -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notlike '.building-*' } | ForEach-Object { ([IO.File]::ReadAllText($_.FullName)).Trim() })
    return @(Get-ChildItem -LiteralPath $OutDir -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like '.building-*' -or ($_.PSIsContainer -and $named -notcontains $_.Name) } | ForEach-Object { $_.Name })
}

$oldCeiling = $env:GIT_CEILING_DIRECTORIES
$env:GIT_CEILING_DIRECTORIES = $tmp
$shells = @()
foreach ($n in 'pwsh', 'powershell') {
    $c = Get-Command $n -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { $shells += $c.Source }
}

try {
    New-Item -ItemType Directory -Force -Path $src | Out-Null
    Put (Join-Path $src 'game\gamemode.js') ("'use strict';`nconsole.log('gamemode-2459');`n")
    Put (Join-Path $src 'game\extra.js') ("'use strict';`nconsole.log('extra');`n")
    Put (Join-Path $src 'game\data\more.json') ('{"more": "' + ('x' * 4096) + '"}')
    Run-Git -C $src init -q
    Run-Git -C $src config core.autocrlf false
    Run-Git -C $src add -A
    # No auto maintenance after the commit: a git start of its own, and
    # nothing this harness reads (#3168).
    Run-Git -C $src -c user.name=test -c user.email=test@example.invalid -c commit.gpgsign=false -c maintenance.auto=false commit -q -m one

    # ---- 1. second call while a reader holds a file in the shared folder ----
    $a1 = Build $out
    $held = Join-Path $a1.Folder 'game\gamemode.js'
    Yes 'first build unpacked game\gamemode.js' (Test-Path -LiteralPath $held)
    $beforeWrite = (Get-Item -LiteralPath $held).LastWriteTimeUtc
    $stream = [IO.File]::Open($held, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        $a2 = $null
        $secondErr = $null
        try { $a2 = Build $out } catch { $secondErr = $_ }
        Yes 'second call with a reader open does not throw' ($null -eq $secondErr)
        if ($secondErr) { Write-Host ("  " + $secondErr.Exception.Message) }
        Yes 'second call returns the same folder path' ($null -ne $a2 -and $a2.Folder -eq $a1.Folder)
        Yes 'second call returns the same sha256' ($null -ne $a2 -and $a2.Sha256 -eq $a1.Sha256)
        Yes 'the held file was not rewritten (mtime unchanged)' (
            (Test-Path -LiteralPath $held) -and ((Get-Item -LiteralPath $held).LastWriteTimeUtc -eq $beforeWrite))
        Yes 'the reader can still read the bytes' (
            $stream.CanRead -and ($stream.ReadByte() -ge 0))
    } finally {
        $stream.Dispose()
    }
    $good = $a1
    $goodRecord = [IO.File]::ReadAllText($good.RecordPath)

    # ---- 2. another run's whole build lands in the gap before a name -------
    # Set-ThornswoodArtifactName is the one step that names the zip, the record
    # and the folder (#2742). Standing in front of it, the first time this run
    # names the chosen one, a whole second build runs to the end in the same
    # out folder, exactly what a second process finishing at that moment
    # does. Before #2742 the zip and the folder were named with Move-Item after
    # a Test-Path, so Move-Item is stood in front of the same way; on that code
    # the zip case fails with "Cannot create a file when that file already
    # exists", and the record case finds no naming step at all.
    $script:realName = ${function:Set-ThornswoodArtifactName}
    $script:gapAt = ''
    $script:gapOut = ''
    $script:gapRan = $false
    $script:gapOther = $null
    function Invoke-OtherRunInGap([string]$To) {
        if ($script:gapRan -or -not $script:gapAt) { return }
        $kind = 'folder'
        if ($To -like '*.zip') { $kind = 'zip' } elseif ($To -like '*.json') { $kind = 'record' }
        if ($kind -ne $script:gapAt) { return }
        $script:gapRan = $true
        $script:gapOther = Build $script:gapOut
    }
    $script:holdZip = $false
    $script:held = $null
    function Set-ThornswoodArtifactName([string]$From, [string]$To) {
        if ($script:holdZip -and -not $script:held -and $To -like '*.zip') {
            # 2b: the same zip named by the other run, which still holds it.
            $theirs = Join-Path (Split-Path -Parent $To) ('.building-' + [Guid]::NewGuid().ToString('N') + '.zip')
            [IO.File]::Copy($From, $theirs)
            if (-not (& $script:realName $theirs $To)) { throw "the other run's zip could not be named $To" }
            $script:held = Hold-AsRenaming $To
        }
        Invoke-OtherRunInGap $To
        return (& $script:realName $From $To)
    }
    function Move-Item {
        param([string]$LiteralPath, [string]$Destination)
        Invoke-OtherRunInGap $Destination
        Microsoft.PowerShell.Management\Move-Item -LiteralPath $LiteralPath -Destination $Destination
    }
    foreach ($at in 'zip', 'record', 'folder') {
        $script:gapOut = Join-Path $tmp ('out-gap-' + $at)
        $script:gapAt = $at
        $script:gapRan = $false
        $script:gapOther = $null
        $mine = $null
        $err = $null
        try { $mine = Build $script:gapOut } catch { $err = $_ }
        $script:gapAt = ''
        Yes "the other run finished in the gap before this run named its $at" ($script:gapRan -and $null -ne $script:gapOther)
        Yes "this run still finishes when the other named the $at first" ($null -eq $err -and $null -ne $mine)
        if ($err) { Write-Host ('  ' + $err.Exception.Message) }
        if ($null -ne $mine -and $null -ne $script:gapOther) {
            $other = $script:gapOther
            Yes "  both runs name the same artifact ($at)" ($mine.Name -eq $other.Name -and $mine.Sha256 -eq $other.Sha256 -and $mine.Name -eq $good.Name)
            Yes "  the zip there is the bytes both built ($at)" ((Sha $mine.Zip) -eq $good.Sha256)
            Yes "  the record there says what both built ($at)" (RecordSame $good.Record $mine.RecordPath)
            Yes "  the folder there holds every file ($at)" ((FolderShort $mine.Folder $good.Record.files) -eq '' -and $mine.Folder -eq $other.Folder)
        } else {
            foreach ($w in 'both runs name the same artifact', 'the zip there is the bytes both built', 'the record there says what both built', 'the folder there holds every file') { Yes "  $w ($at)" $false }
        }
        $left = Leftovers $script:gapOut
        Yes "  nothing of either run's own is left behind ($at)" ($left.Count -eq 0)
        if ($left.Count) { Write-Host ('  left: ' + ($left -join ', ')) }
    }

    # ---- 2b. the zip at its name while the run that named it holds it ------
    # MoveFileExW names a file through a handle it opened on that file with
    # delete access, and closes it only once the name is given (and, under
    # MOVEFILE_WRITE_THROUGH, written through). The run that lost the name
    # finds the zip there in that moment, and reads it twice: its sha256,
    # then its files into this run's folder. Until #3067 both reads opened
    # with FileShare.Read, which Windows refuses beside a handle with delete
    # access, and the run stopped with "being used by another process"
    # (about one gate run in a dozen). Here the other run's zip takes the name
    # first and a handle with delete access is held on it for all of this run.
    $oHeld = Join-Path $tmp 'out-zip-held'
    $script:holdZip = $true
    $mine = $null
    $err = $null
    $refused = $null
    try {
        try { $mine = Build $oHeld } catch { $err = $_ }
        if ($script:held -and $OnWindows) {
            # The held handle is the one that refused the old reads: a
            # FileShare.Read open of the zip beside it is refused.
            try { [IO.File]::Open((Join-Path $oHeld $good.Name), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read).Dispose(); $refused = $false }
            catch { $refused = $_.Exception.Message -like '*being used by another process*' }
        }
    } finally {
        $script:holdZip = $false
        if ($script:held) { $script:held.Dispose(); $script:held = $null }
    }
    Yes 'the other run named the zip first and held it the way MoveFileExW does' ($null -ne $refused -or -not $OnWindows)
    if ($OnWindows) { Yes '  a FileShare.Read open beside that handle is refused, as Get-FileHash and ZipFile were' ($refused -eq $true) }
    Yes '  this run still finishes, reading the zip while it is held' ($null -eq $err -and $null -ne $mine)
    if ($err) { Write-Host ('  ' + $err.Exception.Message) }
    Yes '  it names the same artifact with every file unpacked' (
        $null -ne $mine -and $mine.Name -eq $good.Name -and $mine.Sha256 -eq $good.Sha256 -and
        (FolderShort $mine.Folder $good.Record.files) -eq '' -and (RecordSame $good.Record $mine.RecordPath))
    $left = Leftovers $oHeld
    Yes "  nothing of either run's own is left behind (zip held)" ($left.Count -eq 0)
    if ($left.Count) { Write-Host ('  left: ' + ($left -join ', ')) }

    Remove-Item Function:\Move-Item
    Remove-Item Function:\Set-ThornswoodArtifactName
    if ($script:realName) { Set-Item Function:\Set-ThornswoodArtifactName -Value $script:realName }

    # ---- 3. something else at the name is refused and left alone ----------
    # A zip whose bytes are not this build's, under this build's name.
    $o3 = Join-Path $tmp 'out-other-zip'
    New-Item -ItemType Directory -Force -Path $o3 | Out-Null
    $planted = Join-Path $o3 $good.Name
    [IO.File]::WriteAllText($planted, 'not the zip', $utf8)
    $err = $null
    try { Build $o3 | Out-Null } catch { $err = $_ }
    Yes 'a different zip at the name refuses the build' ($null -ne $err -and $err.Exception.Message -like '*is not the zip this run built*')
    Yes '  and is left exactly as it was' ([IO.File]::ReadAllText($planted) -eq 'not the zip')
    Yes '  and nothing of this run is left beside it' ((Leftovers $o3).Count -eq 0)

    # The right zip with a record beside it that says something else.
    $o4 = Join-Path $tmp 'out-other-record'
    New-Item -ItemType Directory -Force -Path $o4 | Out-Null
    [IO.File]::Copy($good.Zip, (Join-Path $o4 $good.Name))
    $wrong = $goodRecord.Replace($good.Record.files[0].sha256, ('0' * 64))
    $plantedRecord = Join-Path $o4 ([IO.Path]::GetFileName($good.RecordPath))
    [IO.File]::WriteAllText($plantedRecord, $wrong, $utf8)
    $err = $null
    try { Build $o4 | Out-Null } catch { $err = $_ }
    Yes 'a record at the name that says something else refuses the build' ($null -ne $err -and $err.Exception.Message -like '*is not the record of the zip this run built*')
    Yes '  and is left exactly as it was' ([IO.File]::ReadAllText($plantedRecord) -eq $wrong)
    Yes '  and nothing of this run is left beside it' ((Leftovers $o4).Count -eq 0)

    # A folder the .folder file names that is short of a file.
    $o5 = Join-Path $tmp 'out-short-folder'
    New-Item -ItemType Directory -Force -Path $o5 | Out-Null
    $shortLeaf = [IO.Path]::GetFileNameWithoutExtension($good.Name) + '.' + ('5' * 32)
    $shortFolder = Join-Path $o5 $shortLeaf
    Put (Join-Path $shortFolder 'game\gamemode.js') 'short'
    Put (Join-Path $o5 ([IO.Path]::GetFileNameWithoutExtension($good.Name) + '.folder')) $shortLeaf
    $err = $null
    try { Build $o5 | Out-Null } catch { $err = $_ }
    Yes 'a folder at the name short of a file refuses the build' ($null -ne $err -and $err.Exception.Message.Contains($shortFolder))
    Yes '  and is left exactly as it was' (
        ([IO.File]::ReadAllText((Join-Path $shortFolder 'game\gamemode.js')) -eq 'short') -and
        @(Get-ChildItem -LiteralPath $shortFolder -Recurse -File).Count -eq 1)
    Yes '  and nothing of this run is left beside it' ((Leftovers $o5).Count -eq 0)

    # ---- 4. many processes released at once, under both PowerShells --------
    $worker = Join-Path $tmp 'worker.ps1'
    $workerBody = @'
param([string]$Helper, [string]$RepoDir, [string]$OutDir, [string]$Result, [string]$Ready, [string]$Gate)
$ErrorActionPreference = 'Stop'
$env:THORNSWOOD_HARNESS = '1'
try {
  . $Helper
  Initialize-ThornswoodArtifactType
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.File]::WriteAllText($Ready, 'ready')
  # Every worker waits here, loaded, until the harness lets them all go at once.
  while (-not (Test-Path -LiteralPath $Gate)) { Start-Sleep -Milliseconds 2 }
  $a = New-ThornswoodArtifact -Component gamemode -RepoDir $RepoDir -Paths 'game' -OutDir $OutDir
  [IO.File]::WriteAllText($Result, ('OK|' + $a.Sha256 + '|' + $a.Folder + '|' + $a.Name + '|' + $PSVersionTable.PSEdition))
  exit 0
} catch {
  [IO.File]::WriteAllText($Result, ('ERR|' + $_.Exception.Message + ' (' + $_.InvocationInfo.ScriptName + ':' + $_.InvocationInfo.ScriptLineNumber + ')'))
  exit 1
}
'@
    [IO.File]::WriteAllText($worker, $workerBody, $utf8)
    Yes 'a PowerShell to start workers with is here' ($shells.Count -gt 0)
    $count = 8
    foreach ($round in 1..3) {
        $dir = Join-Path $tmp ('round-' + $round)
        $o = Join-Path $dir 'out'
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        $gate = Join-Path $dir 'go'
        $procs = @()
        for ($i = 0; $i -lt $count; $i++) {
            $sh = $shells[$i % [Math]::Max(1, $shells.Count)]
            # Windows PowerShell 5.1 started from PowerShell 7 gets 7's module
            # path and cannot load its own cmdlets (#2460); it is left out for it.
            $savedPath = $env:PSModulePath
            if ([IO.Path]::GetFileNameWithoutExtension($sh) -eq 'powershell') { $env:PSModulePath = '' }
            try {
                $procs += Start-Process -FilePath $sh -PassThru -NoNewWindow -ArgumentList @(
                    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $worker + '"'),
                    '-Helper', ('"' + $helper + '"'), '-RepoDir', ('"' + $src + '"'), '-OutDir', ('"' + $o + '"'),
                    '-Result', ('"' + (Join-Path $dir ('result-' + $i + '.txt')) + '"'),
                    '-Ready', ('"' + (Join-Path $dir ('ready-' + $i + '.txt')) + '"'), '-Gate', ('"' + $gate + '"')) `
                    -RedirectStandardOutput (Join-Path $dir ('stdout-' + $i + '.txt')) -RedirectStandardError (Join-Path $dir ('stderr-' + $i + '.txt'))
            } finally { $env:PSModulePath = $savedPath }
        }
        # The harness waits for every worker to be loaded, then opens the gate.
        $until = [DateTime]::UtcNow.AddSeconds(120)
        while (@(Get-ChildItem -LiteralPath $dir -Filter 'ready-*.txt').Count -lt $count -and [DateTime]::UtcNow -lt $until -and @($procs | Where-Object { -not $_.HasExited }).Count) {
            Start-Sleep -Milliseconds 20
        }
        [IO.File]::WriteAllText($gate, 'go')
        Wait-Process -Id @($procs | ForEach-Object { $_.Id }) -Timeout 120 -ErrorAction SilentlyContinue
        $texts = @()
        for ($i = 0; $i -lt $count; $i++) {
            $r = Join-Path $dir ('result-' + $i + '.txt')
            if (Test-Path -LiteralPath $r) { $texts += (Get-Content -LiteralPath $r -Raw).Trim() } else { $texts += 'MISSING' }
        }
        foreach ($p in $procs) { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
        $ok = @($texts | Where-Object { $_.StartsWith('OK|') })
        $editions = @($ok | ForEach-Object { $_.Split('|')[4] } | Sort-Object -Unique) -join ' and '
        Yes "round ${round}: all $count runs released at once finished ($($ok.Count) did, under $editions)" ($ok.Count -eq $count)
        foreach ($t in @($texts | Where-Object { -not $_.StartsWith('OK|') })) { Write-Host ("  " + $t) }
        $shas = @($ok | ForEach-Object { $_.Split('|')[1] } | Sort-Object -Unique)
        $folders = @($ok | ForEach-Object { $_.Split('|')[2] } | Sort-Object -Unique)
        Yes "  every run has the same artifact and folder (round $round)" ($ok.Count -eq $count -and $shas.Count -eq 1 -and $shas[0] -eq $good.Sha256 -and $folders.Count -eq 1)
        $f = if ($folders.Count) { $folders[0] } else { '' }
        Yes "  the folder holds every file and the record matches (round $round)" (
            $f -and (FolderShort $f $good.Record.files) -eq '' -and
            (RecordSame $good.Record (Join-Path $o ([IO.Path]::GetFileName($good.RecordPath)))))
        $left = Leftovers $o
        Yes "  nothing of any run's own is left behind (round $round)" ($left.Count -eq 0)
        if ($left.Count) { Write-Host ('  left: ' + ($left -join ', ')) }
    }

    # ---- 5. source still never Remove-Items the shared folder name ----------
    $srcText = Get-Content -LiteralPath $helper -Raw
    Yes 'Artifact.ps1 no longer Remove-Items the shared unpack folder' (
        $srcText -notmatch 'if \(Test-Path -LiteralPath \$folder\) \{ Remove-Item -LiteralPath \$folder -Recurse -Force \}')
    Yes 'Artifact.ps1 unpacks into a folder of its own and names its .folder file' (
        $srcText.Contains('$mine = Join-Path $OutDir ($base + ''.'' + [Guid]::NewGuid()') -and
        $srcText -match 'Save-ThornswoodArtifactFolderName \$folderName')
} finally {
    $env:GIT_CEILING_DIRECTORIES = $oldCeiling
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}

Done
