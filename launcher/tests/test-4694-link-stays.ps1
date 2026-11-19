<#
  test-4694-link-stays.ps1

      pwsh -NoProfile -File .\launcher\tests\test-4694-link-stays.ps1

  Issue #4694. Before Fix writes one of our plugins over the copy in Data,
  it takes that name off when the file is a hard link (OwnGame.Detach),
  because Vortex deploys by hard link and the other name is the Nexus mod's
  copy in Vortex's staging, which every Skyrim profile on the machine
  shares. When the name did not come off, Detach noted it and returned as if
  it had, and when the number of names could not be read, Links answered 1,
  so Fix wrote through the link into another server's collection and said
  nothing.

  WHAT IT CHECKS.
    1. By the source: Detach catches nothing, Links never answers a count it
       could not read, and FetchPlugin takes the name off inside the same try
       as its write, whose catch says the plugin could not be written.
       DeployPersonal does the same before its copy.
    2. Detach, Links and FetchPlugin's write, lifted from launcher\app with
       what they need, built the way the launcher builds (Add-LauncherType,
       tests\Launcher-Csc.ps1). On Windows they are run over a scratch
       staging folder and a Data folder whose plugin is a hard link to it:
         a. a link that comes off: our bytes are written, and only into Data;
         b. a refused delete (Windows will not let this account delete the
            file, or delete files from its folder, but still lets it write
            the file): nothing is written, the staged copy keeps its bytes,
            and Fix says the plugin could not be written;
         c. a link count that cannot be read: the same.

  Writes only a scratch folder under the temp directory, removed at the end.
#>
[CmdletBinding()]
param([string]$AppPath)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
if (-not $AppPath) { $AppPath = Join-Path $Repo 'launcher\app' }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail -gt 0) { exit 1 }
    exit 0
}

# Line ends as git checked them out: CRLF on a runner, LF in some worktrees.
function Src([string]$path) { [IO.File]::ReadAllText($path) -replace "`r`n", "`n" }
$og = Src (Join-Path $AppPath 'OwnGame.cs')
$verify = Src (Join-Path $AppPath 'Verify.cs')

function Get-CsMember([string]$text, [string]$declaration) {
    $at = $text.IndexOf($declaration, [StringComparison]::Ordinal)
    if ($at -lt 0) { return $null }
    $i = $text.IndexOf('{', $at + $declaration.Length)
    if ($i -lt 0) { return $null }
    $depth = 0
    while ($i -lt $text.Length) {
        $c = $text[$i]
        $n = if ($i + 1 -lt $text.Length) { $text[$i + 1] } else { [char]0 }
        if ($c -eq '/' -and $n -eq '/') { $i = $text.IndexOf("`n", $i); if ($i -lt 0) { return $null }; continue }
        if ($c -eq '@' -and $n -eq '"') {
            $i += 2
            while ($i -lt $text.Length) {
                if ($text[$i] -eq '"') { if ($i + 1 -lt $text.Length -and $text[$i + 1] -eq '"') { $i += 2; continue }; break }
                $i++
            }
            $i++; continue
        }
        if ($c -eq '"' -or $c -eq "'") {
            $q = $c; $i++
            while ($i -lt $text.Length -and $text[$i] -ne $q) { if ($text[$i] -eq '\') { $i++ }; $i++ }
            $i++; continue
        }
        if ($c -eq '{') { $depth++ }
        elseif ($c -eq '}') {
            $depth--
            if ($depth -eq 0) { return $text.Substring($at, $i + 1 - $at) }
        }
        $i++
    }
    return $null
}
# The code alone, without its comments, for the checks that read it.
function Code([string]$member) { (($member -split "`n") | ForEach-Object { $_ -replace '//.*$', '' }) -join "`n" }

# ---- 1. by the source ---------------------------------------------------------------------
$detach = Get-CsMember $og 'public static void Detach(string path)'
$links = Get-CsMember $og 'static int Links(string path)'
$fetch = Get-CsMember $verify 'static bool FetchPlugin(Config cfg, Issue i, Func<string, byte[]> release, Action<string> say)'
$personal = Get-CsMember $verify 'public static int DeployPersonal()'
Yes 'Detach, Links, FetchPlugin and DeployPersonal are where they were' ($detach -and $links -and $fetch -and $personal)
if (-not ($detach -and $links -and $fetch -and $personal)) { Done }
Yes 'Detach catches nothing, so a name that did not come off reaches the caller' ((Code $detach) -notmatch '\bcatch\b')
Yes 'Links never answers a count it could not read' ((Code $links) -notmatch 'return 1;')
Yes 'FetchPlugin takes the name off inside the try of its write, so a failure there is its failed write' (
    (Code $fetch) -match 'try\s*\{\s*OwnGame\.Detach\(dest\);\s*using \(var fs = new FileStream\(dest, FileMode\.Create' -and
    ([regex]::Matches((Code $fetch), 'OwnGame\.Detach\(')).Count -eq 1)
Yes 'DeployPersonal takes the name off inside the try of its copy' ((Code $personal) -match 'try\s*\{[^}]*OwnGame\.Detach\(full\);\s*File\.Copy\(src, full, true\);')

# ---- 2. run -------------------------------------------------------------------------------
# FetchPlugin's write, from the comment that opens it up to the cache line
# after it, run as it is inside a method of its own.
$from = $verify.IndexOf('            // Our bytes go in our copy of the file and nowhere else.', [StringComparison]::Ordinal)
$to = if ($from -ge 0) { $verify.IndexOf('            lock (crcCache) { crcCache.Remove(dest); }', $from, [StringComparison]::Ordinal) } else { -1 }
Yes "FetchPlugin's write is where it was" ($from -ge 0 -and $to -gt $from)
if (-not ($from -ge 0 -and $to -gt $from)) { Done }
$write = $verify.Substring($from, $to - $from)

$struct = Get-CsMember $og 'struct FileInfoByHandle'
$fileTime = Get-CsMember $og 'struct FileTime'
$consts = ([regex]::Matches($og, '(?m)^\s*const uint (FileReadAttributes|FileShareAll|OpenExisting|BackupSemantics) = [^;]+;') | ForEach-Object { $_.Value.Trim() }) -join "`n"
$create = [regex]::Match($og, '(?s)\[LibraryImport\("kernel32\.dll", EntryPoint = "CreateFileW"[^\]]*\]\s*private static partial SafeFileHandle CreateFile\([^;]+;').Value
$info = [regex]::Match($og, '(?s)\[LibraryImport\("kernel32\.dll"[^\]]*\]\s*\[return: [^\]]*\]\s*private static partial bool GetFileInformationByHandle\([^;]+;').Value
Yes 'lifted the two structs, the two imports and the four constants' ($struct -and $fileTime -and $create -and $info -and ($consts -split "`n").Count -eq 4)

# The same code twice: once as Windows answers, once with Windows refusing
# to say how many names the file has.
$failedInfo = @'
        static bool GetFileInformationByHandle(SafeFileHandle hFile, out FileInfoByHandle info)
        {
            info = default(FileInfoByHandle);
            Marshal.SetLastPInvokeError(5);
            return false;
        }
'@
function Source([string]$ns, [string]$infoImport) {
@"
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace $ns {
    public sealed class Item { public string Plugin = ""; }
    static class Swallow
    {
        public static readonly List<string> Notes = new List<string>();
        public static void Note(string where, Exception ex) { Notes.Add(where + ": " + ex.GetType().Name); }
    }
    static class Failure
    {
        public static string Why(string where, Exception ex, string what) { return "why " + ex.GetType().Name; }
    }
    public static partial class OwnGame
    {
        $fileTime
        [StructLayout(LayoutKind.Sequential)]
        $struct
        $infoImport
        $create
        $consts
        [LibraryImport("kernel32.dll", EntryPoint = "CreateHardLinkW", StringMarshalling = StringMarshalling.Utf16, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static partial bool MakeLink(string lpFileName, string lpExistingFileName, IntPtr lpSecurityAttributes);
        public static bool Link(string name, string existing) { return MakeLink(name, existing, IntPtr.Zero); }
        public $links
        $detach
    }
    public static class Fix
    {
        public static bool Write(string dest, byte[] bytes, Item i, Action<string> say)
        {
$write
            return true;
        }
    }
}
"@
}

. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # builds launcher code the way the project does (#2821, #4823)
Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }
$tag = [guid]::NewGuid().ToString('N').Substring(0, 8)
$nsReal = 'Link4694_' + $tag
$nsFailed = 'Link4694F_' + $tag
$built = $true
try {
    $asmReal = Add-LauncherType -Source (Source $nsReal $info)
    $asmFailed = Add-LauncherType -Source (Source $nsFailed $failedInfo)
} catch { $built = $false; Write-Host $_.Exception.Message }
Yes 'Detach, Links and the write build the way the launcher does' $built
if (-not $built) { Done }
if (-not $OnWindows) {
    Write-Host 'SKIP  2, the run: hard links and CreateFile are kernel32''s, which only Windows has'
    Done
}
$G = $asmReal.GetType("$nsReal.OwnGame")
$F = $asmReal.GetType("$nsReal.Fix")
$GF = $asmFailed.GetType("$nsFailed.OwnGame")
$FF = $asmFailed.GetType("$nsFailed.Fix")

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-4694-' + [guid]::NewGuid().ToString('N'))
$ours = [Text.Encoding]::ASCII.GetBytes('THORNSWOOD-RELEASE-COPY')
# A staged plugin in Vortex's staging and its deployed name in Data, one file.
# Its name is made up: a harness that names a plugin the content build writes
# is held back as a content check while that build is behind main, and this
# one reads no build at all.
function Stage([string]$case, [type]$own) {
    $staged = Join-Path $work "$case\staging\SomeMod\Ours-4694.esp"
    $dest = Join-Path $work "$case\Data\Ours-4694.esp"
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $staged))
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $dest))
    [IO.File]::WriteAllText($staged, 'VORTEX-STAGED-COPY')
    if (-not $own::Link($dest, $staged)) { throw "could not make the hard link for $case" }
    return @($staged, $dest)
}
function Run([type]$fix, [string]$dest, [ref]$said) {
    $lines = New-Object 'System.Collections.Generic.List[string]'
    $item = [Activator]::CreateInstance($fix.Assembly.GetType($fix.Namespace + '.Item'))
    $item.Plugin = 'Ours-4694.esp'
    $say = [Action[string]] { param($m) $lines.Add($m) }.GetNewClosure()
    $ok = $fix::Write($dest, $ours, $item, $say)
    $said.Value = ($lines -join ' | ')
    return $ok
}

New-Item -ItemType Directory -Path $work | Out-Null
try {
    # a. The link comes off: ours goes into Data alone.
    $a = Stage 'a' $G
    $said = ''
    $ok = Run $F $a[1] ([ref]$said)
    Yes 'a. a link that comes off: the write goes ahead' $ok
    Yes 'a. our bytes are in Data' ([IO.File]::ReadAllText($a[1]) -eq 'THORNSWOOD-RELEASE-COPY')
    Yes "a. and Vortex's staged copy keeps its own" ([IO.File]::ReadAllText($a[0]) -eq 'VORTEX-STAGED-COPY')

    # b. The delete is refused, while a write is still let through. A handle
    # of another program cannot do this: one that may read or write the file
    # also stops the write, and one that only reads its attributes stops
    # nothing, since Windows leaves such a handle out of sharing. So this
    # account is refused the delete itself: Windows lets a name be deleted
    # when the file allows Delete or its folder allows deleting what is in
    # it, and here neither does.
    $b = Stage 'b' $G
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $fileInfo = [IO.FileInfo]$b[1]
    $dirInfo = [IO.DirectoryInfo](Split-Path -Parent $b[1])
    $noDelete = [Security.AccessControl.FileSystemAccessRule]::new($me, [Security.AccessControl.FileSystemRights]::Delete, [Security.AccessControl.AccessControlType]::Deny)
    $noDeleteIn = [Security.AccessControl.FileSystemAccessRule]::new($me, [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles, [Security.AccessControl.AccessControlType]::Deny)
    $fileAcl = [IO.FileSystemAclExtensions]::GetAccessControl($fileInfo); $fileAcl.AddAccessRule($noDelete); [IO.FileSystemAclExtensions]::SetAccessControl($fileInfo, $fileAcl)
    $dirAcl = [IO.FileSystemAclExtensions]::GetAccessControl($dirInfo); $dirAcl.AddAccessRule($noDeleteIn); [IO.FileSystemAclExtensions]::SetAccessControl($dirInfo, $dirAcl)
    $said = ''
    try { $ok = Run $F $b[1] ([ref]$said) }
    finally {
        # Delete allowed again, so the scratch folder can go.
        $fileAcl = [IO.FileSystemAclExtensions]::GetAccessControl($fileInfo); [void]$fileAcl.RemoveAccessRule($noDelete); [IO.FileSystemAclExtensions]::SetAccessControl($fileInfo, $fileAcl)
        $dirAcl = [IO.FileSystemAclExtensions]::GetAccessControl($dirInfo); [void]$dirAcl.RemoveAccessRule($noDeleteIn); [IO.FileSystemAclExtensions]::SetAccessControl($dirInfo, $dirAcl)
    }
    Yes 'b. the name still has its link, so the delete really was refused' ($G::Links($b[0]) -eq 2)
    Yes 'b. a refused delete: the plugin is not written' (-not $ok)
    Yes "b. Vortex's staged copy keeps its bytes" ([IO.File]::ReadAllText($b[0]) -eq 'VORTEX-STAGED-COPY')
    Yes 'b. and Fix says the plugin could not be written' ($said -match 'Ours-4694\.esp could not be written \(why ')

    # c. How many names the file has cannot be read.
    $c = Stage 'c' $GF
    $said = ''
    $ok = Run $FF $c[1] ([ref]$said)
    Yes 'c. a link count that cannot be read: the plugin is not written' (-not $ok)
    Yes "c. Vortex's staged copy keeps its bytes" ([IO.File]::ReadAllText($c[0]) -eq 'VORTEX-STAGED-COPY')
    Yes 'c. and Fix says the plugin could not be written' ($said -match 'Ours-4694\.esp could not be written \(why ')
}
finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
Done
