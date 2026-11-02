<#
  test-2888-artifact-folder-name.ps1

      pwsh -NoProfile -File .\tests\test-2888-artifact-folder-name.ps1

  Issue #2888. On 20 Oct a Deploy-Docs run on One stopped at the site
  artifact: the folder it had just unpacked "could not be named ...: Access
  is denied. (Windows error 5)". Windows refuses to rename a folder while
  anything has a file in it open, and a virus scanner opens the files an
  unpack has just closed, so the rename New-ThornswoodArtifact gave the
  folder its name with was refused now and then (one in fifteen fresh zips
  on One, gone again 53 ms later). Since #2888 a run unpacks into a folder of
  its own that is never renamed, and what gets named is the small
  <zip basename>.folder file that says which folder is the artifact's.
  This proves:

    1. Every name New-ThornswoodArtifact gives (Set-ThornswoodArtifactName)
       is given to a file, never to a folder.
    2. Forty artifacts, each from a commit with a file nobody has seen before
       (as new to a scanner as a fresh build), built one after the other into
       one out folder: every one finishes, its .folder file names a folder
       that holds every recorded file, that folder is the name the run
       unpacked into, and no other unpacked folder is left beside them.
    3. Forty files of new bytes, each named the moment it is written, the way
       the zip, the record and the .folder file are: every one is named.
    4. A .folder file that names something else is refused and left as it is.

  It also prints, without failing on it, how many of forty folders unpacked
  from fresh zips could not be renamed at once: the old way, measured on
  whatever machine runs this.

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
Initialize-ThornswoodArtifactType
Add-Type -AssemblyName System.IO.Compression.FileSystem

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-2888-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$src = Join-Path $tmp 'repo'
$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$path, [string]$text) {
    $d = Split-Path -Parent $path
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
    [IO.File]::WriteAllText($path, $text, $utf8)
}
function Run-Git { $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; & git @args 2>&1 | Out-Null; $ErrorActionPreference = $old }
function Commit([string]$what) {
    Run-Git -C $src add -A
    Run-Git -C $src -c user.name=test -c user.email=test@example.invalid -c commit.gpgsign=false commit -q -m $what
}
# A file of bytes nobody has seen before, so a scanner has not seen it either.
function FreshText([int]$n) {
    return ('fresh ' + $n + ' ' + [Guid]::NewGuid().ToString('N') + ' ' + ([Guid]::NewGuid().ToString('N') * 64))
}
function Build([string]$OutDir) { return (New-ThornswoodArtifact -Component site -RepoDir $src -Paths 'site' -OutDir $OutDir) }
# The harness's own read: '' when the folder holds every recorded file at its
# recorded size.
function FolderShort([string]$Folder, $Files) {
    if (-not (Test-Path -LiteralPath $Folder -PathType Container)) { return 'no folder' }
    foreach ($f in @($Files)) {
        $p = Join-Path $Folder ([string]$f.path).Replace('/', [IO.Path]::DirectorySeparatorChar)
        if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { return ($f.path + ' missing') }
        if ((Get-Item -LiteralPath $p).Length -ne [long]$f.size) { return ($f.path + ' wrong size') }
    }
    return ''
}

$oldCeiling = $env:GIT_CEILING_DIRECTORIES
$env:GIT_CEILING_DIRECTORIES = $tmp

try {
    New-Item -ItemType Directory -Force -Path $src | Out-Null
    Put (Join-Path $src 'site\server.js') ("'use strict';`nconsole.log('site-2888');`n")
    Put (Join-Path $src 'site\public\index.html') '<p>2888</p>'
    Run-Git -C $src init -q
    Run-Git -C $src config core.autocrlf false
    Commit 'one'

    # ---- 1. only files are ever named -------------------------------------
    $script:realName = ${function:Set-ThornswoodArtifactName}
    $script:named = @()
    function Set-ThornswoodArtifactName([string]$From, [string]$To) {
        $script:named += [pscustomobject]@{
            From = $From; To = $To
            File = (Test-Path -LiteralPath $From -PathType Leaf)
            Folder = (Test-Path -LiteralPath $From -PathType Container)
        }
        return (& $script:realName $From $To)
    }
    $o1 = Join-Path $tmp 'out-names'
    $a = $null
    $err = $null
    try { $a = Build $o1 } catch { $err = $_ }
    Yes 'a build finishes' ($null -eq $err -and $null -ne $a)
    if ($err) { Write-Host ('  ' + $err.Exception.Message) }
    $kinds = @($script:named | ForEach-Object { [IO.Path]::GetExtension($_.To) })
    Yes 'it names its zip, its record and its .folder file, three names' ($script:named.Count -eq 3 -and
        ($kinds -join ',') -eq '.zip,.json,.folder')
    Yes '  every one of them a file' (@($script:named | Where-Object { $_.File -and -not $_.Folder }).Count -eq $script:named.Count)
    Yes '  and never a folder' (@($script:named | Where-Object { $_.Folder }).Count -eq 0)
    foreach ($n in @($script:named | Where-Object { -not $_.File })) { Write-Host ('  named something not a file: ' + $n.From + ' -> ' + $n.To) }
    Remove-Item Function:\Set-ThornswoodArtifactName
    Set-Item Function:\Set-ThornswoodArtifactName -Value $script:realName

    if ($null -ne $a) {
        $base = [IO.Path]::GetFileNameWithoutExtension($a.Name)
        $pointer = Join-Path (Split-Path -Parent $a.Zip) ($base + '.folder')
        Yes 'the .folder file is beside the zip' (Test-Path -LiteralPath $pointer -PathType Leaf)
        Yes '  and names the folder the build hands on' ((Test-Path -LiteralPath $pointer) -and
            (Join-Path (Split-Path -Parent $a.Zip) ([IO.File]::ReadAllText($pointer))) -eq $a.Folder)
        Yes '  which is <zip basename>.<32 hex>' ([IO.Path]::GetFileName($a.Folder) -match ('^' + [regex]::Escape($base) + '\.[0-9a-f]{32}$'))
        Yes '  and holds every file' ((FolderShort $a.Folder $a.Record.files) -eq '')
        Yes 'the source integrity check passes on that folder' ($(try { Assert-ThornswoodSourceIntegrity -Artifact $a -RepoDir $src; $true } catch { Write-Host ('  ' + $_.Exception.Message); $false }))
    }

    # ---- 2. forty fresh artifacts, one after the other, in one out folder --
    $o2 = Join-Path $tmp 'out-fresh'
    $count = 40
    $finished = 0
    $whole = 0
    $problems = @()
    $folders = @()
    for ($i = 1; $i -le $count; $i++) {
        Put (Join-Path $src ('site\public\fresh-' + $i + '.txt')) (FreshText $i)
        Commit ('fresh ' + $i)
        try {
            $b = Build $o2
            $finished++
            $folders += [IO.Path]::GetFileName($b.Folder)
            $gap = FolderShort $b.Folder $b.Record.files
            if ($gap) { $problems += ('build ' + $i + ': ' + $gap) } else { $whole++ }
        } catch {
            $problems += ('build ' + $i + ': ' + $_.Exception.Message)
        }
    }
    Yes "all $count fresh builds finished ($finished did)" ($finished -eq $count)
    Yes "  every one's folder holds every file ($whole do)" ($whole -eq $count)
    foreach ($p in $problems) { Write-Host ('  ' + $p) }
    $named = @(Get-ChildItem -LiteralPath $o2 -Force -File -Filter '*.folder' | Where-Object { $_.Name -notlike '.building-*' } |
        ForEach-Object { ([IO.File]::ReadAllText($_.FullName)).Trim() })
    $dirs = @(Get-ChildItem -LiteralPath $o2 -Force -Directory | ForEach-Object { $_.Name })
    $unnamed = @($dirs | Where-Object { $named -notcontains $_ })
    Yes "  $count .folder files, one for each" ($named.Count -eq $count)
    Yes '  each names the folder its build unpacked into' ((@($named | Sort-Object) -join ',') -eq (@($folders | Sort-Object) -join ','))
    Yes '  no unpacked folder is left that none names' ($unnamed.Count -eq 0)
    foreach ($u in $unnamed) { Write-Host ('  left: ' + $u) }
    Yes '  and no .building- file is left' (@(Get-ChildItem -LiteralPath $o2 -Force -Filter '.building-*').Count -eq 0)

    # ---- 3. forty fresh files, each named the moment it is written ---------
    $o3 = Join-Path $tmp 'out-files'
    New-Item -ItemType Directory -Force -Path $o3 | Out-Null
    $refused = @()
    for ($i = 1; $i -le $count; $i++) {
        $from = Join-Path $o3 ('.building-' + [Guid]::NewGuid().ToString('N') + '.zip')
        [IO.File]::WriteAllText($from, (FreshText $i), $utf8)
        try {
            if (-not (Set-ThornswoodArtifactName $from (Join-Path $o3 ('file-' + $i + '.zip')))) { $refused += ('file ' + $i + ': the name was taken') }
        } catch { $refused += ('file ' + $i + ': ' + $_.Exception.Message) }
    }
    Yes "all $count fresh files were named at once ($($count - $refused.Count) were)" ($refused.Count -eq 0)
    foreach ($r in $refused) { Write-Host ('  ' + $r) }

    # ---- 4. a .folder file that names something else ----------------------
    $o4 = Join-Path $tmp 'out-other-name'
    $first = Build $o4
    $base = [IO.Path]::GetFileNameWithoutExtension($first.Name)
    $planted = Join-Path $o4 ($base + '.folder')
    $before = @(Get-ChildItem -LiteralPath $o4 -Force | ForEach-Object { $_.Name } | Sort-Object) -join ','
    foreach ($what in @('..\elsewhere', ($base + '-other.0123456789abcdef0123456789abcdef'), '')) {
        [IO.File]::WriteAllText($planted, $what, $utf8)
        $err = $null
        try { Build $o4 | Out-Null } catch { $err = $_ }
        Yes ("a .folder file holding '" + $what + "' refuses the build") ($null -ne $err -and $err.Exception.Message -like '*does not name an unpacked folder*')
        if ($err -and $err.Exception.Message -notlike '*does not name an unpacked folder*') { Write-Host ('  ' + $err.Exception.Message) }
        Yes '  and is left as it was' ([IO.File]::ReadAllText($planted) -eq $what)
        Yes '  and nothing of this run is left beside it' ((@(Get-ChildItem -LiteralPath $o4 -Force | ForEach-Object { $_.Name } | Sort-Object) -join ',') -eq $before)
    }

    # ---- the old way, measured, not held: rename a folder just unpacked ----
    $o5 = Join-Path $tmp 'out-old-way'
    New-Item -ItemType Directory -Force -Path $o5 | Out-Null
    $old = 0
    for ($i = 1; $i -le $count; $i++) {
        $z = Join-Path $o5 ('fresh-' + $i + '.zip')
        [ThornswoodArtifactZip]::WriteStored($z, [string[]]@('site/fresh.txt', 'site/server.js'),
            [byte[][]]@($utf8.GetBytes((FreshText $i)), $utf8.GetBytes('server ' + $i)))
        $from = Join-Path $o5 ('.unpacking-' + $i)
        [IO.Compression.ZipFile]::ExtractToDirectory($z, $from)
        try { if (-not ([ThornswoodArtifactName]::Claim($from, (Join-Path $o5 ('named-' + $i))))) { $old++ } } catch { $old++ }
    }
    Write-Host ("INFO  the old way: {0} of {1} folders unpacked from fresh zips could not be renamed at once here" -f $old, $count)
} finally {
    $env:GIT_CEILING_DIRECTORIES = $oldCeiling
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}

Done
