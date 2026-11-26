<#
  Artifact.ps1

  What a deploy sends, built from a commit rather than copied off a working
  tree, and what the box keeps to say which commit each part runs. Issue #459.
  Dot-sourced by Deploy-Docs.ps1 (site), Install-Voice.ps1 (voice),
  Install-Bot.ps1 (bot), Deploy-DevGamemode.ps1, Deploy-Server.ps1 and
  Publish-Server.ps1 (gamemode). Publish-Server records through
  Set-ThornswoodServerRecord and Restore-ThornswoodServerRecord, near the end.

  THE ARTIFACT. New-ThornswoodArtifact reads the named paths out of the
  repository's HEAD commit (git's own bytes, so line endings and file dates on
  this machine do not come into it) and writes them into one zip:

      <component>-<commit, 12>-<sha256 of the zip, 16>.zip
      e.g. site-655846b6a1c2-3f09c2d1e8a7b654.zip

  The zip is stored (no compression), its entries in ordinal order, every date
  2000-01-01, written by the few lines of C# below rather than by .NET's
  ZipArchive, whose headers and deflate output differ between Windows
  PowerShell 5.1 and PowerShell 7. So the same commit gives the same bytes on
  any machine, and the name alone says which commit it is. Beside it,
  <same name>.json is the record: component, commit, sha256, size, and every
  file with its own size and sha256. The record has no clock in it either.

  A DEPLOY SENDS A COMMIT OR NOTHING. A file with uncommitted changes, staged
  or not, deleted, or untracked, under the named paths or among the other
  repository files a deploy sends (-AlsoSends), refuses the deploy before it
  talks to the box, naming every such file (Assert-ThornswoodCommitted).
  There is no switch past it: commit the change, or put it back, and run the
  deploy again. Patrick, 29 Sep, issue #1121. Until then (#1090) such a
  deploy went through and its record said "edited". Ignored files are never
  sent and do not count.

  SITE AND VOICE, BEFORE ANYTHING IS SENT. Deploy-Docs.ps1 and
  Install-Voice.ps1 call Assert-ThornswoodSourceIntegrity on the artifact
  they just built. It checks the zip's hash and every file in the expanded
  tree against the commit's own blobs. If any of that differs, it throws
  and those scripts do not send. Issue #1335.

  The zip is expanded next to itself, laid out like the repository, into a
  folder <same name>.<32 hex> that is never renamed, and <same name>.folder
  names it (#2888). The deploy scripts send from that folder instead of from
  the working tree, so what goes up is exactly what the zip holds.

  TWO RUNS AT ONE COMMIT (#2459, #2742). Two runs from one checkout at one
  commit (a deploy and a Ship, two dev deploys) build the same artifact under
  the same names. Each run writes its zip, its record and its .folder file
  under names of its own, then gives each its real name in one step that
  either takes the name or finds it taken (Set-ThornswoodArtifactName), with no
  look first and never replacing what is there. Only files are named that way,
  never a folder: Windows refuses to rename a folder while anything has a file
  in it open, and a virus scanner opens the files an unpack has just closed
  (#2888). A run that finds the name taken holds what is there to what it
  built (the zip by its sha256, the record field by field, the folder the
  .folder file names by every file's size), uses it when it is the same and
  says so, and refuses, changing nothing, when it is not.

  ON THE BOX, C:\Thornswood-Deploys:
    <component>\<name>.zip and <name>.json   every artifact sent, kept
                                              (Send-ThornswoodArtifact); server\
                                              holds each server build a full
                                              deploy or a publish sent
                                              (ServerArtifact.ps1)
    current\<part>.json                       what each part runs now, one per
                                              folder a part runs from, e.g.
                                              thornswood-server-dev.json
    history.log                               one line per deploy
  and a copy of the part's record beside what it runs, as
  thornswood-deploy.json (Set-ThornswoodArtifactCurrent). Those are read over
  HTTP: the site's /api/deploys lists every part for staff signed into the
  hub (#1359), the voice service's /health carries its own, and a game
  server serves its own from its data folder, so
  http://<box>:3000/thornswood-deploy.json for live and :7788 for dev.

  Nothing here stops, starts or swaps anything. Building needs git; sending
  needs ssh and scp and the person's key on the box, nothing else, so any
  machine that can reach the box can do it.
#>

# ssh and scp run through Invoke-ThornswoodNative (issue #941).
. (Join-Path $PSScriptRoot '..\vps\Vps.ps1')

. (Join-Path $PSScriptRoot '..\vps\Send-Script.ps1')
. (Join-Path $PSScriptRoot '..\vps\Lock-Folder.ps1')

$script:ThornswoodDeployStore = 'C:/Thornswood-Deploys'

function Initialize-ThornswoodArtifactType {
  # Its own type, so a session that loaded ThornswoodArtifactZip before this
  # was added still gets it.
  if (-not ('ThornswoodArtifactName' -as [type]) -and [Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    # Off Windows (a cloud thread, #2872) there is no kernel32: loading it
    # failed inside Claim with "Value cannot be null (path1)". Linux's
    # renameat2 with RENAME_NOREPLACE is the same promise as MoveFileEx
    # without MOVEFILE_REPLACE_EXISTING, for a file and a folder alike: it
    # names in one step, or answers EEXIST and leaves what is there. A plain
    # rename would replace a file, and an empty folder, at the name.
    Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;

public static class ThornswoodArtifactName {
    [DllImport("libc", SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.SafeDirectories)]
    static extern int renameat2(int olddirfd, string oldpath, int newdirfd, string newpath, uint flags);

    const int AT_FDCWD = -100;
    const uint RENAME_NOREPLACE = 1;
    const int EEXIST = 17;

    // Gives a finished file or folder its name in one rename, or answers
    // false when the name is already taken. Any other refusal is thrown with
    // its reason.
    public static bool Claim(string from, string to) {
        string source = Path.GetFullPath(from), target = Path.GetFullPath(to);
        if (renameat2(AT_FDCWD, source, AT_FDCWD, target, RENAME_NOREPLACE) == 0) return true;
        int code = Marshal.GetLastWin32Error();
        if (code == EEXIST) return false;
        throw new IOException(source + " could not be named " + target + ": " + Marshal.GetPInvokeErrorMessage(code) + " (errno " + code + ")");
    }
}
'@
  }
  if (-not ('ThornswoodArtifactName' -as [type])) {
    Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;

public static class ThornswoodArtifactName {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool MoveFileExW(string from, string to, int flags);

    // Gives a finished file or folder its name in one rename, or answers
    // false when the name is already taken. MoveFileEx without
    // MOVEFILE_REPLACE_EXISTING never replaces what is there: a file or a
    // folder at the name, it answers ERROR_ALREADY_EXISTS (183) or
    // ERROR_FILE_EXISTS (80). Any other refusal is thrown with its reason.
    public static bool Claim(string from, string to) {
        string source = Path.GetFullPath(from), target = Path.GetFullPath(to);
        if (MoveFileExW(source, target, 0x8 /* MOVEFILE_WRITE_THROUGH */)) return true;
        int code = Marshal.GetLastWin32Error();
        if (code == 183 || code == 80) return false;
        throw new IOException(source + " could not be named " + target + ": " + new Win32Exception(code).Message + " (Windows error " + code + ")");
    }
}
'@
  }
  if ('ThornswoodArtifactZip' -as [type]) { return }
  Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

public static class ThornswoodArtifactZip {
    static uint[] table;

    static uint[] Table() {
        if (table != null) return table;
        uint[] t = new uint[256];
        for (uint n = 0; n < 256; n++) {
            uint c = n;
            for (int k = 0; k < 8; k++) c = ((c & 1) != 0) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
            t[n] = c;
        }
        table = t;
        return t;
    }

    public static uint Crc32(byte[] data) {
        uint[] t = Table();
        uint c = 0xFFFFFFFFu;
        for (int i = 0; i < data.Length; i++) c = t[(c ^ data[i]) & 0xFF] ^ (c >> 8);
        return c ^ 0xFFFFFFFFu;
    }

    static string ReadLine(Stream s) {
        StringBuilder sb = new StringBuilder();
        while (true) {
            int b = s.ReadByte();
            if (b < 0) throw new EndOfStreamException("git cat-file ended early");
            if (b == 10) return sb.ToString();
            sb.Append((char)b);
        }
    }

    // The exact bytes of each blob, from one git cat-file --batch.
    public static byte[][] ReadBlobs(string git, string repo, string[] ids) {
        ProcessStartInfo psi = new ProcessStartInfo(git, "cat-file --batch");
        psi.WorkingDirectory = repo;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardInput = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        Process p = Process.Start(psi);
        p.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { };
        p.BeginErrorReadLine();
        Stream input = p.StandardInput.BaseStream;
        Stream output = p.StandardOutput.BaseStream;
        byte[][] res = new byte[ids.Length][];
        try {
            // .NET Framework puts a byte order mark in front of the first
            // thing written to a child's standard input, which git reads as
            // part of the first object name. One empty line first takes it,
            // on either runtime, and its "missing" answer is read and dropped.
            input.WriteByte(10);
            input.Flush();
            string first = ReadLine(output);
            if (!first.EndsWith("missing")) throw new InvalidOperationException("git cat-file answered: " + first);
            for (int i = 0; i < ids.Length; i++) {
                byte[] q = Encoding.ASCII.GetBytes(ids[i] + "\n");
                input.Write(q, 0, q.Length);
                input.Flush();
                string header = ReadLine(output);
                string[] parts = header.Split(' ');
                if (parts.Length != 3 || parts[1] != "blob") throw new InvalidOperationException("git cat-file answered: " + header);
                int size = int.Parse(parts[2]);
                byte[] buf = new byte[size];
                int got = 0;
                while (got < size) {
                    int n = output.Read(buf, got, size - got);
                    if (n <= 0) throw new EndOfStreamException("git cat-file ended inside " + ids[i]);
                    got += n;
                }
                output.ReadByte();
                res[i] = buf;
            }
        } catch (Exception e) {
            // A read that failed leaves git waiting on its input, so the input
            // is closed to let it end. When git has already gone, closing a
            // pipe with a write still buffered fails too; that is said beside
            // the failure that caused it rather than put in its place.
            string closing = "";
            try { input.Close(); }
            catch (IOException c) { closing = " (closing its input then failed as well: " + c.Message + ")"; }
            p.WaitForExit();
            throw new InvalidOperationException("git cat-file --batch in " + repo + " failed: " + e.Message + closing, e);
        }
        // Everything read: closing the input is what tells git to end, and a
        // failure here, or git ending with an error, is a failure of the read.
        input.Close();
        p.WaitForExit();
        if (p.ExitCode != 0) throw new InvalidOperationException("git cat-file --batch in " + repo + " ended with exit code " + p.ExitCode);
        return res;
    }

    // A stored zip whose bytes depend on nothing but the names and contents.
    public static void WriteStored(string path, string[] names, byte[][] datas) {
        if (names.Length != datas.Length) throw new ArgumentException("names and contents differ in count");
        if (names.Length > 65535) throw new InvalidOperationException("too many files for one zip");
        ushort time = 0;
        ushort date = (ushort)(((2000 - 1980) << 9) | (1 << 5) | 1);
        ushort flags = 0x0800;
        uint[] crcs = new uint[names.Length];
        uint[] offsets = new uint[names.Length];
        byte[][] nameBytes = new byte[names.Length][];
        using (FileStream fs = new FileStream(path, FileMode.Create, FileAccess.Write)) {
            BinaryWriter w = new BinaryWriter(fs);
            for (int i = 0; i < names.Length; i++) {
                if (fs.Position > uint.MaxValue - (long)datas[i].Length - 1024) throw new InvalidOperationException("the zip would pass 4 GB");
                nameBytes[i] = new UTF8Encoding(false).GetBytes(names[i]);
                crcs[i] = Crc32(datas[i]);
                offsets[i] = (uint)fs.Position;
                w.Write((uint)0x04034b50); w.Write((ushort)10); w.Write(flags); w.Write((ushort)0);
                w.Write(time); w.Write(date); w.Write(crcs[i]);
                w.Write((uint)datas[i].Length); w.Write((uint)datas[i].Length);
                w.Write((ushort)nameBytes[i].Length); w.Write((ushort)0);
                w.Write(nameBytes[i]); w.Write(datas[i]);
            }
            uint cdStart = (uint)fs.Position;
            for (int i = 0; i < names.Length; i++) {
                w.Write((uint)0x02014b50); w.Write((ushort)20); w.Write((ushort)10); w.Write(flags); w.Write((ushort)0);
                w.Write(time); w.Write(date); w.Write(crcs[i]);
                w.Write((uint)datas[i].Length); w.Write((uint)datas[i].Length);
                w.Write((ushort)nameBytes[i].Length); w.Write((ushort)0); w.Write((ushort)0);
                w.Write((ushort)0); w.Write((ushort)0); w.Write((uint)0); w.Write(offsets[i]);
                w.Write(nameBytes[i]);
            }
            uint cdEnd = (uint)fs.Position;
            w.Write((uint)0x06054b50); w.Write((ushort)0); w.Write((ushort)0);
            w.Write((ushort)names.Length); w.Write((ushort)names.Length);
            w.Write(cdEnd - cdStart); w.Write(cdStart); w.Write((ushort)0);
            w.Flush();
        }
    }
}
'@
}

function Get-ThornswoodSha256Hex([byte[]]$Bytes) {
  $h = [Security.Cryptography.SHA256]::Create()
  try { return (-join ($h.ComputeHash($Bytes) | ForEach-Object { $_.ToString('x2') })) } finally { $h.Dispose() }
}

<#
  The one step that gives an artifact's zip, record or .folder file its
  name (#2742): $true when this run's took the name, $false when the name was
  taken already. Nothing at the name is ever replaced. Until #2742 the zip was
  looked for and then moved, so two runs could both find it missing and the
  second's move failed with "Cannot create a file when that file already
  exists". tests\test-2459-artifact-unpack-race.ps1 stands in front of this to
  put another run's whole build in the moment before the name is given.
#>
function Set-ThornswoodArtifactName([string]$From, [string]$To) {
  return [ThornswoodArtifactName]::Claim($From, $To)
}

<#
  A file at its artifact name, opened to read and sharing every kind of access
  (#3067, #6916). The run whose file took the name is still inside MoveFileExW,
  holding the file with delete access, when the run that lost the name finds it there;
  Get-FileHash, ZipFile.ExtractToDirectory and ReadAllText open with
  FileShare.Read, which refuses to open beside that handle, and the loser
  stopped with "being used by another process". A file at its name is never
  written again (nothing at a name is replaced), so a reader has nothing to deny anybody.
#>
function Open-ThornswoodArtifactFile([string]$Path) {
  return (New-Object IO.FileStream($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)))
}

# Text at an immutable artifact name, including its record and folder pointer.
function Read-ThornswoodArtifactText([string]$Path) {
  $stream = Open-ThornswoodArtifactFile $Path
  try {
    $reader = New-Object IO.StreamReader($stream)
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
  } finally { $stream.Dispose() }
}

# The whole sha256 of a zip at its name, sharing its publishing handle.
function Get-ThornswoodArtifactZipSha256([string]$Zip) {
  $stream = Open-ThornswoodArtifactFile $Zip
  try {
    $h = [Security.Cryptography.SHA256]::Create()
    try { return (-join ($h.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') })) } finally { $h.Dispose() }
  } finally { $stream.Dispose() }
}

# Unpacks a zip at its name into $To, sharing its publishing handle.
function Expand-ThornswoodArtifactZip([string]$Zip, [string]$To) {
  $stream = Open-ThornswoodArtifactFile $Zip
  try {
    $archive = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Read)
    try { [IO.Compression.ZipFileExtensions]::ExtractToDirectory($archive, $To) } finally { $archive.Dispose() }
  } finally { $stream.Dispose() }
}

# The zip this run built, under its name. When another run's is there first,
# it has to be the same bytes by its whole sha256; then it is used and this
# run's copy goes. A different file there is refused and left alone.
function Save-ThornswoodArtifactZip([string]$Building, [string]$Zip, [string]$Sha256) {
  if (Set-ThornswoodArtifactName $Building $Zip) { return }
  Remove-Item -LiteralPath $Building -Force
  $there = Get-ThornswoodArtifactZipSha256 $Zip
  if ($there -ne $Sha256) {
    throw ("$Zip is already there and is not the zip this run built (its sha256 is $there, this build's is $Sha256). Nothing was replaced: remove that file and run again.")
  }
  Write-Host ('  ' + [IO.Path]::GetFileName($Zip) + ' was already here from a run at this commit, with the same sha256, so that one is used') -ForegroundColor DarkGray
}

# What differs between the record this run built and the one at its name, in
# words, or '' when they say the same thing. Compared field by field, not as
# text: Windows PowerShell 5.1 and PowerShell 7 lay the same JSON out apart.
function Get-ThornswoodArtifactRecordDifference($Want, [string]$Path) {
  $have = $null
  try { $have = Read-ThornswoodArtifactText $Path | ConvertFrom-Json } catch { return ('it does not read as JSON (' + $_.Exception.Message + ')') }
  if ($null -eq $have) { return 'it is empty' }
  $names = @($have.PSObject.Properties | ForEach-Object { $_.Name })
  foreach ($k in @($Want.Keys)) {
    if ($names -notcontains $k) { return "it has no $k" }
    if ($k -ne 'files') {
      if ([string]$have.$k -ne [string]$Want[$k]) { return ("its $k is " + $have.$k + ", this build's is " + $Want[$k]) }
      continue
    }
    $a = @($Want[$k]); $b = @($have.$k)
    if ($a.Count -ne $b.Count) { return ('it lists ' + $b.Count + ' file(s), this build ' + $a.Count) }
    for ($i = 0; $i -lt $a.Count; $i++) {
      foreach ($f in 'path', 'size', 'sha256') {
        if ([string]$b[$i].$f -ne [string]$a[$i][$f]) { return ('its file ' + ($i + 1) + ' has ' + $f + ' ' + $b[$i].$f + ", this build's " + $a[$i]['path'] + ' has ' + $a[$i][$f]) }
      }
    }
  }
  foreach ($n in $names) { if (-not $Want.Contains($n)) { return "it has $n, which this build's record does not" } }
  return ''
}

# The record beside the zip, under its name the same way: written under a name
# of this run's, then named. One already there has to say what this run's says.
function Save-ThornswoodArtifactRecord([string]$RecordPath, $Record) {
  $building = Join-Path (Split-Path -Parent $RecordPath) ('.building-' + [Guid]::NewGuid().ToString('N') + '.json')
  [IO.File]::WriteAllText($building, (ConvertTo-Json -InputObject $Record -Depth 5), (New-Object Text.UTF8Encoding($false)))
  if (Set-ThornswoodArtifactName $building $RecordPath) { return }
  Remove-Item -LiteralPath $building -Force
  $why = Get-ThornswoodArtifactRecordDifference $Record $RecordPath
  if ($why) { throw ("$RecordPath is already there and is not the record of the zip this run built: $why. Nothing was replaced: remove it and run again.") }
}

# Names the folder this run unpacked ($Leaf, beside $FolderName) as the
# artifact's folder (#2888): <zip basename>.folder, holding that one name,
# written under a name of this run's and then named the way the zip and the
# record are. $true when this run's took the name, $false when another run's
# was there first, which is then the folder used. A folder is never what gets
# named: Windows refuses that while a scanner has one of its files open.
function Save-ThornswoodArtifactFolderName([string]$FolderName, [string]$Leaf) {
  $building = Join-Path (Split-Path -Parent $FolderName) ('.building-' + [Guid]::NewGuid().ToString('N') + '.folder')
  [IO.File]::WriteAllText($building, $Leaf, (New-Object Text.UTF8Encoding($false)))
  if (Set-ThornswoodArtifactName $building $FolderName) { return $true }
  Remove-Item -LiteralPath $building -Force
  return $false
}

# The full path of the unpacked folder a <zip basename>.folder file names. It
# holds one name, <zip basename>.<32 hex>, of a folder beside it; anything
# else is refused and left as it is.
function Get-ThornswoodArtifactFolderNamed([string]$FolderName, [string]$Base) {
  $leaf = (Read-ThornswoodArtifactText $FolderName).Trim()
  if ($leaf -notmatch ('^' + [regex]::Escape($Base) + '\.[0-9a-f]{32}$')) {
    throw ("$FolderName does not name an unpacked folder of $Base (it holds '" + $leaf + "'). Nothing was changed: remove it and run again.")
  }
  return (Join-Path (Split-Path -Parent $FolderName) $leaf)
}

# The first file of the record an unpacked folder does not hold at its size,
# in words, or '' when it holds them all.
function Get-ThornswoodArtifactFolderShort([string]$Folder, $Contents) {
  if (-not (Test-Path -LiteralPath $Folder -PathType Container)) { return 'there is no folder there' }
  foreach ($f in $Contents) {
    $p = Join-Path $Folder (([string]$f.path) -replace '/', [IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { return ($f.path + ' is missing') }
    if ((Get-Item -LiteralPath $p).Length -ne [long]$f.size) { return ($f.path + ' is not ' + $f.size + ' bytes') }
  }
  return ''
}

# Runs git in the repository and hands back its lines. git writes progress and
# warnings on stderr, and the deploy scripts run with Stop, so stderr is left
# out here and a failure is read from the exit code instead.
function Invoke-ThornswoodArtifactGit([string]$RepoDir, [string[]]$GitArgs) {
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out = @(& git -C $RepoDir -c core.quotepath=off @GitArgs 2>$null)
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $eap }
  if ($code -ne 0) { throw ('git ' + ($GitArgs -join ' ') + ' failed in ' + $RepoDir + ' (exit ' + $code + ')') }
  return @($out | ForEach-Object { [string]$_ })
}

<#
  Every file under -Paths (repository paths, files or folders, forward
  slashes) that is not exactly what the commit holds: changed, staged,
  deleted, renamed or untracked, as git status says it. Ignored files are not
  listed. Each is a Path and, in plain words, How.
#>
function Get-ThornswoodUncommitted([string]$RepoDir, [string[]]$Paths) {
  $Paths = @($Paths | Where-Object { $_ } | ForEach-Object { ([string]$_).Replace('\', '/').Trim('/') })
  if (-not $Paths.Count) { return @() }
  $found = @()
  foreach ($line in (Invoke-ThornswoodArtifactGit $RepoDir (@('status', '--porcelain', '--untracked-files=all', '--') + $Paths))) {
    if ($line.Length -lt 4) { continue }
    $xy = $line.Substring(0, 2)
    $p = $line.Substring(3)
    if ($p -match ' -> ') { $p = ($p -split ' -> ')[-1] }
    $how = 'changed and not committed'
    if ($xy -eq '??') { $how = 'new and not committed' }
    elseif ($xy.Contains('D')) { $how = 'deleted and not committed' }
    $found += [pscustomobject]@{ Path = $p; How = $how }
  }
  return @($found | Sort-Object Path)
}

<#
  Refuses, by throwing, when any file under -Paths is not what the commit
  holds, naming each one. Every deploy that sends files out of this
  repository calls it before it talks to the box: New-ThornswoodArtifact does,
  and Publish-Server.ps1 does for the files it sends. No switch turns it off.
#>
function Assert-ThornswoodCommitted {
  param(
    [Parameter(Mandatory = $true)][string]$RepoDir,
    [string[]]$Paths = @(),
    [string]$What = 'this deploy',
    # The files of a laid content build (ContentPaths.ps1, Get-ThornswoodLaidBuild),
    # already held to its record: they are the build's, not the commit's.
    [Collections.IDictionary]$Laid = $null
  )
  $dirty = @(Get-ThornswoodUncommitted $RepoDir $Paths | Where-Object { -not ($Laid -and $Laid.Contains($_.Path)) })
  if (-not $dirty.Count) { return }
  $nl = [Environment]::NewLine
  $list = @($dirty | ForEach-Object { '    ' + $_.Path + '  (' + $_.How + ')' }) -join $nl
  throw ('Refused: ' + $What + ' would send ' + $dirty.Count + ' file(s) that are not committed, so nothing was sent and the box was not touched:' + $nl +
         $list + $nl +
         'Commit them, or put them back, then run it again. A deploy only ever sends a commit.')
}

<#
  Builds the artifact and expands it. -Paths are repository paths, files or
  folders, with forward slashes. -AlsoSends are the other repository files
  the deploy sends that are not in the zip (a plugin, a record, a script);
  they are only checked. Any of either that is not committed refuses the
  build (Assert-ThornswoodCommitted). -OutDir defaults to
  out\deploys\<component>.

  -Content dev|main (#5191, stage 4e): what the box's content build writes
  (ContentPaths.ps1, Get-ThornswoodBuiltPaths: the content plugin, the
  tables, the Last plugin's recipe) is never committed, so it comes from the
  build laid over this checkout instead (Get-ContentBuild.ps1), held to be
  that server's build of this commit's inputs with every file its sha256
  (Get-ThornswoodLaidBuild). Every other file is still the commit's. The
  record names the build, as content: "<server> <key> <the commit it was
  built from>".
#>
function New-ThornswoodArtifact {
  param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-z][a-z0-9-]*$')][string]$Component,
    [Parameter(Mandatory = $true)][string]$RepoDir,
    [string[]]$Paths = @(),
    [string[]]$AlsoSends = @(),
    [string]$OutDir = '',
    [ValidateSet('', 'dev', 'main')][string]$Content = ''
  )
  Initialize-ThornswoodArtifactType
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $RepoDir = (Resolve-Path -LiteralPath $RepoDir).ProviderPath.TrimEnd('\')
  $laid = $null
  $builtPaths = @()
  if ($Content) {
    # The caller has laid the build, so it has scripts\mods\ContentPaths.ps1
    # loaded; a script that sends no build never loads it through here.
    if (-not (Get-Command Get-ThornswoodLaidBuild -ErrorAction SilentlyContinue)) { throw "-Content $Content takes the content build laid over this checkout, which scripts\mods\ContentPaths.ps1 reads; dot-source it before New-ThornswoodArtifact. Nothing was built." }
    $laid = Get-ThornswoodLaidBuild -Repo $RepoDir -Server $Content
    $builtPaths = Get-ThornswoodBuiltPaths -Repo $RepoDir
  }
  if ($laid) {
    foreach ($a in @($AlsoSends | Where-Object { $_ } | ForEach-Object { ([string]$_).Replace('\', '/').Trim('/') })) {
      if ((Test-ThornswoodBuiltPath $builtPaths $a) -and -not $laid.Files.Contains($a)) { throw "the $Component deploy sends $a, which the content build writes, and the build laid over this checkout ($($laid.Key)) has no $a. Nothing was built." }
    }
  }
  Assert-ThornswoodCommitted -RepoDir $RepoDir -Paths (@($Paths) + @($AlsoSends)) -What ('the ' + $Component + ' deploy') -Laid $(if ($laid) { $laid.Files } else { $null })
  if (-not $OutDir) {
    $where = Join-Path $PSScriptRoot '..\release\Where.ps1'
    $OutDir = Join-Path (Join-Path (& $where Out) 'deploys') $Component
  }
  if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
  $OutDir = (Resolve-Path -LiteralPath $OutDir).ProviderPath

  $commit = (Invoke-ThornswoodArtifactGit $RepoDir @('rev-parse', '--verify', 'HEAD^{commit}') | Select-Object -First 1).Trim()
  if ($commit -notmatch '^[0-9a-f]{40}$') { throw "Could not read the commit in $RepoDir, so there is nothing to build an artifact from." }
  $git = (Get-Command git -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source

  $Paths = @($Paths | Where-Object { $_ } | ForEach-Object { ([string]$_).Replace('\', '/').Trim('/') })
  $blobs = @{}
  # A built file's bytes, from the laid build (-Content), by path.
  $fromBuild = @{}
  if ($Paths.Count) {
    foreach ($line in (Invoke-ThornswoodArtifactGit $RepoDir (@('ls-tree', '-r', '--full-tree', $commit, '--') + $Paths))) {
      $m = [regex]::Match($line, '^(\d{6}) (\w+) ([0-9a-f]{40})\t(.+)$')
      if (-not $m.Success) { throw "git ls-tree said something this does not read: $line" }
      if ($m.Groups[2].Value -ne 'blob') { continue }
      $p = $m.Groups[4].Value
      if ($p.StartsWith('"')) { throw "A path git had to quote cannot go into an artifact: $p" }
      # A copy of a built file still in the commit is not the build.
      if ($laid -and (Test-ThornswoodBuiltPath $builtPaths $p)) { continue }
      $blobs[$p] = $m.Groups[3].Value
    }
    if ($laid) {
      foreach ($n in @($laid.Files.Keys)) {
        if (-not @($Paths | Where-Object { $n -ceq $_ -or $n.StartsWith($_ + '/') }).Count) { continue }
        $fromBuild[$n] = [IO.File]::ReadAllBytes((Join-Path $RepoDir $n))
        if ((Get-ThornswoodSha256Hex $fromBuild[$n]) -cne [string]$laid.Files[$n]) { throw "$n changed after the content build was laid and held. Nothing was built." }
      }
    }
    foreach ($want in $Paths) {
      $hit = @(@($blobs.Keys) + @($fromBuild.Keys) | Where-Object { $_ -eq $want -or $_.StartsWith($want + '/') })
      if (-not $hit.Count) {
        if ($laid -and (Test-ThornswoodBuiltPath $builtPaths $want)) { throw "The content build laid over this checkout ($($laid.Key)) has nothing at $want, so the $Component artifact would be missing it." }
        throw "The commit $($commit.Substring(0, 12)) has nothing at $want, so the $Component artifact would be missing it."
      }
    }
  }

  [string[]]$names = @(@($blobs.Keys) + @($fromBuild.Keys))
  if (-not $names.Count) { throw "The $Component artifact would be empty." }
  [Array]::Sort($names, [StringComparer]::Ordinal)
  [string[]]$gitNames = @($names | Where-Object { $blobs.ContainsKey($_) })
  [string[]]$ids = @($gitNames | ForEach-Object { $blobs[$_] })
  $byName = @{}
  if ($ids.Count) {
    $read = [ThornswoodArtifactZip]::ReadBlobs($git, $RepoDir, $ids)
    for ($i = 0; $i -lt $gitNames.Count; $i++) { $byName[$gitNames[$i]] = $read[$i] }
  }
  foreach ($n in @($fromBuild.Keys)) { $byName[$n] = $fromBuild[$n] }
  $datas = New-Object 'byte[][]' $names.Count
  for ($i = 0; $i -lt $names.Count; $i++) { $datas[$i] = $byName[$names[$i]] }

  $building = Join-Path $OutDir ('.building-' + [Guid]::NewGuid().ToString('N') + '.zip')
  [ThornswoodArtifactZip]::WriteStored($building, $names, $datas)
  $sha = (Get-FileHash -LiteralPath $building -Algorithm SHA256).Hash.ToLowerInvariant()
  $short = $commit.Substring(0, 12)
  $name = $Component + '-' + $short + '-' + $sha.Substring(0, 16) + '.zip'
  $zip = Join-Path $OutDir $name
  Save-ThornswoodArtifactZip $building $zip $sha

  $contents = @()
  for ($i = 0; $i -lt $names.Count; $i++) {
    $contents += [ordered]@{ path = $names[$i]; size = $datas[$i].Length; sha256 = (Get-ThornswoodSha256Hex $datas[$i]) }
  }
  $record = [ordered]@{
    component = $Component
    name      = $name
    commit    = $commit
    sha256    = $sha
    size      = (Get-Item -LiteralPath $zip).Length
    files     = $contents
  }
  if ($laid) { $record['content'] = ($laid.Server + ' ' + $laid.Key + ' ' + $laid.Commit) }
  $recordPath = [IO.Path]::ChangeExtension($zip, '.json')
  Save-ThornswoodArtifactRecord $recordPath $record

  # Laid out like the repository, so a script that sent <repo>\site\server.js
  # sends <folder>\site\server.js. Two runs at one commit in one checkout
  # share one folder (#2459), so it is never Remove-Item'd: a second call (or
  # a concurrent first) would delete it under another run that is reading
  # game\gamemode.js from it. Each run unpacks into a folder of its own,
  # <zip basename>.<32 hex>, that is never renamed (#2888: Windows refuses to
  # rename a folder while anything has a file in it open, and a virus scanner
  # opens the files an unpack has just closed). The artifact's folder is the
  # one its <zip basename>.folder file names, and that small file is what is
  # named (Save-ThornswoodArtifactFolderName), only once the folder is whole.
  # When another run names its folder first, that one is used and this run's
  # goes. Either way it has to hold every recorded file at its recorded size.
  $base = [IO.Path]::GetFileNameWithoutExtension($name)
  $folderName = Join-Path $OutDir ($base + '.folder')
  if (-not (Test-Path -LiteralPath $folderName)) {
    $mine = Join-Path $OutDir ($base + '.' + [Guid]::NewGuid().ToString('N'))
    $named = $false
    try {
      Expand-ThornswoodArtifactZip $zip $mine
      $named = Save-ThornswoodArtifactFolderName $folderName ([IO.Path]::GetFileName($mine))
      if (-not $named) {
        Write-Host ('  ' + $base + ' was unpacked by another run at this commit first, so that folder is used') -ForegroundColor DarkGray
      }
    } finally {
      if (-not $named -and (Test-Path -LiteralPath $mine)) {
        try { Remove-Item -LiteralPath $mine -Recurse -Force -ErrorAction Stop }
        catch { Write-Warning ("This run's spare unpacked copy " + $mine + ' could not be removed and is left there: ' + $_.Exception.Message) }
      }
    }
  }
  $folder = Get-ThornswoodArtifactFolderNamed $folderName $base
  # Its own name: $short is the commit's twelve, which the result hands on
  # (#2747 reused the name here, and every artifact after it named no commit).
  $folderGap = Get-ThornswoodArtifactFolderShort $folder $contents
  if ($folderGap) {
    throw ("The $Component artifact folder $folder, which $folderName names, is not what $name holds ($folderGap). Nothing in it was changed: remove that folder and $folderName, and run again.")
  }

  return [pscustomobject]@{
    Component  = $Component
    Name       = $name
    Zip        = $zip
    RecordPath = $recordPath
    Record     = $record
    Folder     = $folder
    Commit     = $commit
    Short      = $short
    Sha256     = $sha
    Size       = $record.size
  }
}

function Assert-ThornswoodSourceIntegrity {
  param(
    [Parameter(Mandatory = $true)]$Artifact,
    [Parameter(Mandatory = $true)][string]$RepoDir
  )
  # Deploy-Docs (site) and Install-Voice (voice) call this after the artifact
  # is built and before anything is sent. The tree that would go up has to be
  # the commit's own bytes: the zip's hash, every expanded file's hash, and
  # the blobs git has for that commit. A miss throws, and the caller must not
  # send. This does not replace the hash compare those scripts already make
  # of the files once they are on the box.
  if (-not $Artifact -or -not $Artifact.Folder -or -not $Artifact.Zip -or -not $Artifact.Record) {
    throw 'Refused: there is no site or voice artifact to check, so nothing was sent and the box was not touched.'
  }
  $component = [string]$Artifact.Component
  if (-not $component) { $component = 'deploy' }
  $RepoDir = (Resolve-Path -LiteralPath $RepoDir).ProviderPath.TrimEnd('\')
  $commit = (Invoke-ThornswoodArtifactGit $RepoDir @('rev-parse', '--verify', 'HEAD^{commit}') | Select-Object -First 1).Trim()
  if ($commit -notmatch '^[0-9a-f]{40}$' -or $commit -ne [string]$Artifact.Commit) {
    $built = [string]$Artifact.Commit
    throw "Refused: the $component artifact is not HEAD ($commit), it was built from $built, so nothing was sent and the box was not touched."
  }
  if (-not (Test-Path -LiteralPath $Artifact.Zip)) {
    throw "Refused: the $component artifact zip is missing, so nothing was sent and the box was not touched."
  }
  $zipHash = Get-ThornswoodArtifactZipSha256 $Artifact.Zip
  if ($zipHash -ne ([string]$Artifact.Sha256).ToLowerInvariant()) {
    throw "Refused: the $component artifact zip is not the bytes built from $($commit.Substring(0, 12)), so nothing was sent and the box was not touched."
  }
  if (-not (Test-Path -LiteralPath $Artifact.Folder)) {
    throw "Refused: the $component artifact tree is missing, so nothing was sent and the box was not touched."
  }

  $reasons = [ordered]@{}
  $want = @{}
  foreach ($f in @($Artifact.Record.files)) {
    $path = $null; $sha = $null; $sizeText = $null
    if ($f -is [System.Collections.IDictionary]) {
      $path = [string]$f['path']; $sha = [string]$f['sha256']; $sizeText = [string]$f['size']
    } else {
      $path = [string]$f.path; $sha = [string]$f.sha256; $sizeText = [string]$f.size
    }
    if (-not $path) { $path = '(no path)' }
    $path = $path.Replace('\', '/').Trim('/')
    if ($sha) { $sha = $sha.ToLowerInvariant() }
    $size = 0L
    $sizeOk = $false
    try { $size = [int64]$sizeText; if ($size -ge 0) { $sizeOk = $true } } catch { $sizeOk = $false }
    if ($want.ContainsKey($path)) {
      $reasons[$path] = 'listed twice in the artifact record'
      continue
    }
    if ($sha -notmatch '^[0-9a-f]{64}$' -or -not $sizeOk) {
      $reasons[$path] = 'the artifact record has no usable size and sha256'
      $want[$path] = @{ sha256 = ''; size = -1L }
      continue
    }
    $want[$path] = @{ sha256 = $sha; size = $size }
  }
  if (-not $want.Count) {
    throw "Refused: the $component artifact lists no files, so nothing was sent and the box was not touched."
  }

  $root = (Get-Item -LiteralPath $Artifact.Folder).FullName.TrimEnd('\')
  $onDisk = @{}
  foreach ($file in @(Get-ChildItem -LiteralPath $root -Recurse -File -Force)) {
    if ($file.FullName.Length -le $root.Length -or ($file.FullName[$root.Length] -ne [char]92 -and $file.FullName[$root.Length] -ne '/')) {
      throw "Refused: could not name a file under the $component artifact tree, so nothing was sent and the box was not touched."
    }
    $rel = $file.FullName.Substring($root.Length).TrimStart('\', '/').Replace('\', '/')
    if ($onDisk.ContainsKey($rel)) { $reasons[$rel] = 'two files in the tree land on one path' }
    $onDisk[$rel] = $file.FullName
  }
  foreach ($path in @($want.Keys)) {
    if (-not $onDisk.ContainsKey($path)) { $reasons[$path] = 'missing from the tree that would be sent' }
  }
  foreach ($path in @($onDisk.Keys)) {
    if (-not $want.ContainsKey($path) -and -not $reasons.Contains($path)) {
      $reasons[$path] = 'in the tree that would be sent, but not in the commit artifact'
    }
  }

  $diskSha = @{}
  foreach ($path in @($want.Keys)) {
    if (-not $onDisk.ContainsKey($path)) { continue }
    if ($reasons.Contains($path)) { continue }
    $bytes = [IO.File]::ReadAllBytes($onDisk[$path])
    $hex = Get-ThornswoodSha256Hex $bytes
    $diskSha[$path] = $hex
    if ($bytes.LongLength -ne $want[$path].size -or $hex -ne $want[$path].sha256) {
      $reasons[$path] = 'bytes are not the recorded source'
    }
  }

  Initialize-ThornswoodArtifactType
  $git = (Get-Command git -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $blobIds = @{}
  $pathArgs = @($want.Keys)
  foreach ($line in @(Invoke-ThornswoodArtifactGit $RepoDir (@('ls-tree', '-r', '--full-tree', $commit, '--') + $pathArgs))) {
    if (-not $line) { continue }
    $m = [regex]::Match($line, '^(\d{6}) (\w+) ([0-9a-f]{40})\t(.+)$')
    if (-not $m.Success) { throw "Refused: git ls-tree said something this does not read ($line), so nothing was sent and the box was not touched." }
    if ($m.Groups[2].Value -ne 'blob') { continue }
    $p = $m.Groups[4].Value
    if ($p.StartsWith('"')) { throw "Refused: a path git had to quote cannot be checked ($p), so nothing was sent and the box was not touched." }
    $blobIds[$p] = $m.Groups[3].Value
  }
  $idNames = New-Object System.Collections.Generic.List[string]
  $ids = New-Object System.Collections.Generic.List[string]
  foreach ($path in @($want.Keys)) {
    if (-not $blobIds.ContainsKey($path)) {
      if (-not $reasons.Contains($path)) { $reasons[$path] = 'not in commit ' + $commit.Substring(0, 12) }
      continue
    }
    if (-not $want[$path].sha256) { continue }
    [void]$idNames.Add($path)
    [void]$ids.Add($blobIds[$path])
  }
  if ($ids.Count) {
    $datas = [ThornswoodArtifactZip]::ReadBlobs($git, $RepoDir, $ids.ToArray())
    for ($i = 0; $i -lt $idNames.Count; $i++) {
      $path = $idNames[$i]
      $hex = Get-ThornswoodSha256Hex $datas[$i]
      $recordSha = $want[$path].sha256
      $diskOk = $diskSha.ContainsKey($path) -and $diskSha[$path] -eq $hex
      if ($hex -ne $recordSha -or -not $diskOk) {
        if (-not $reasons.Contains($path)) { $reasons[$path] = "not the commit's bytes" }
      }
    }
  }

  if ($reasons.Count) {
    $nl = [Environment]::NewLine
    $list = @($reasons.Keys | Sort-Object | ForEach-Object { '    ' + $_ + '  (' + $reasons[$_] + ')' }) -join $nl
    throw ("Refused: the $component deploy would send " + $reasons.Count + " file(s) that are not the source at " + $commit.Substring(0, 12) + ", so nothing was sent and the box was not touched:" + $nl + $list)
  }
}

# One line for a deploy to print.
function Format-ThornswoodArtifact($Artifact) {
  return ('{0}, commit {1}, {2} file(s), {3:N0} bytes' -f $Artifact.Name, $Artifact.Short, @($Artifact.Record.files).Count, $Artifact.Size)
}

# The name the box files a part under: the folder it runs from, so the live and
# dev copies of one component never share a record. C:/Thornswood-Server-Dev is
# thornswood-server-dev.
function Get-ThornswoodArtifactPart([string]$Root) {
  $leaf = ($Root.Replace('\', '/').TrimEnd('/') -split '/')[-1]
  if ($leaf -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { throw "Cannot name a part after the folder $Root." }
  return $leaf.ToLowerInvariant()
}

function Invoke-ThornswoodArtifactRemote([string]$Target, [string[]]$SshArgs, [string]$Script) {
  # Host key checking on whatever the caller passed (#450): only the box whose
  # key known_hosts holds, checked against vps.json, is ever talked to.
  # Send-Script.ps1 adds it and refuses a weaker one.
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    # cmd.exe on the box stops at 8,191 characters (tests\test-remote-length.ps1).
    # These scripts are short; one that is not goes by scp, and its run
    # deletes the copy before it runs (Send-Script.ps1, issues #1070, #3059).
    $out = @(Invoke-ThornswoodRemote -Target $Target -SshArgs @($SshArgs | Where-Object { $_ }) -Script $Script | Where-Object { $_ -is [string] } | ForEach-Object { $_.Trim() })
  } finally { $ErrorActionPreference = $eap }
  return $out
}

function Send-ThornswoodArtifactFile([string]$Local, [string]$Target, [string[]]$SshArgs, [string]$Far) {
  # Host key checking on whatever the caller passed (#450): only the box whose
  # key known_hosts holds, checked against vps.json, is ever talked to.
  $strict = @('-o', 'StrictHostKeyChecking=yes') + @($SshArgs | Where-Object { $_ })
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    Invoke-ThornswoodNative { & scp @strict $Local ($Target + ':' + $Far) } 2>&1 | Out-Null
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $eap }
  if ($code -ne 0) { throw ('scp failed sending ' + (Split-Path -Leaf $Local) + ' to ' + $Far) }
}

<#
  Puts the zip and its record in the box's store, before anything is swapped.
  A zip the store already holds with the same hash is not sent again, so
  deploying the same commit twice moves nothing. Throws when the box does not
  end up holding exactly these bytes.
#>
function Send-ThornswoodArtifact {
  param(
    [Parameter(Mandatory = $true)]$Artifact,
    [Parameter(Mandatory = $true)][string]$Target,
    [string[]]$SshArgs = @(),
    [string]$Store = $script:ThornswoodDeployStore
  )
  $store = $Store.Replace('\', '/').TrimEnd('/')
  $dir = $store + '/' + $Artifact.Component
  $zipWin = ($dir + '/' + $Artifact.Name).Replace('/', '\')
  $ask = @"
$(Get-ThornswoodLockedFolderScript $store.Replace('/', '\'))
New-Item -ItemType Directory -Force -Path '$($dir.Replace('/', '\'))', '$($store.Replace('/', '\'))\current' | Out-Null
if (Test-Path -LiteralPath '$zipWin') { 'HAS ' + (Get-FileHash -LiteralPath '$zipWin' -Algorithm SHA256).Hash.ToLowerInvariant() } else { 'HAS none' }
"@
  $said = @(Invoke-ThornswoodArtifactRemote $Target $SshArgs $ask)
  # A store the box could not lock is never written into (#4212).
  $lockFailed = Get-ThornswoodLockFailure $said
  if ($lockFailed) { throw ('The box could not lock the deploy store, so nothing was sent to it: ' + $lockFailed) }
  $have = @($said | Where-Object { $_ -like 'HAS *' }) | Select-Object -Last 1
  if ($have -eq ('HAS ' + $Artifact.Sha256)) {
    Write-Host ('  ' + $Artifact.Name + ' is already in the store on the box') -ForegroundColor DarkGray
  } else {
    Send-ThornswoodArtifactFile $Artifact.Zip $Target $SshArgs ($dir + '/' + $Artifact.Name)
    $said = @(Invoke-ThornswoodArtifactRemote $Target $SshArgs $ask)
    $lockFailed = Get-ThornswoodLockFailure $said
    if ($lockFailed) { throw ('The box could not lock the deploy store, so nothing was swapped: ' + $lockFailed) }
    $have = @($said | Where-Object { $_ -like 'HAS *' }) | Select-Object -Last 1
    if ($have -ne ('HAS ' + $Artifact.Sha256)) { throw ('The box does not hold ' + $Artifact.Name + ' as it was built (' + $have + '). Nothing was swapped.') }
    Write-Host ('  ' + $Artifact.Name + ' sent to the store on the box, ' + $Artifact.Sha256.Substring(0, 16) + ' checked there') -ForegroundColor DarkGray
  }
  Send-ThornswoodArtifactFile $Artifact.RecordPath $Target $SshArgs ($dir + '/' + [IO.Path]::GetFileName($Artifact.RecordPath))
}

# What the box keeps for a part: the artifact's record without its file list,
# plus where it runs, when, and from which machine.
function New-ThornswoodDeployRecord($Artifact, [string]$Root) {
  return [ordered]@{
    part        = (Get-ThornswoodArtifactPart $Root)
    component   = $Artifact.Component
    name        = $Artifact.Name
    commit      = $Artifact.Commit
    sha256      = $Artifact.Sha256
    size        = $Artifact.Size
    files       = @($Artifact.Record.files).Count
    root        = $Root.Replace('\', '/')
    deployedUtc = [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", [Globalization.CultureInfo]::InvariantCulture)
    from        = [Environment]::MachineName  # COMPUTERNAME is Windows only (#2872)
  }
}

<#
  Records that a part now runs this artifact: current\<part>.json in the store,
  the same record beside what it runs (-Beside, default <Root>/thornswood-
  deploy.json), and a line in history.log. Called once the new files are in
  place, never before.
#>
function Set-ThornswoodArtifactCurrent {
  param(
    [Parameter(Mandatory = $true)]$Artifact,
    [Parameter(Mandatory = $true)][string]$Target,
    [string[]]$SshArgs = @(),
    [Parameter(Mandatory = $true)][string]$Root,
    [string]$Beside = '',
    [string]$Store = $script:ThornswoodDeployStore
  )
  $rec = New-ThornswoodDeployRecord $Artifact $Root
  if (-not $Beside) { $Beside = $Root.Replace('\', '/').TrimEnd('/') + '/thornswood-deploy.json' }
  $store = $Store.Replace('\', '/').TrimEnd('/')
  $local = Join-Path (Split-Path -Parent $Artifact.Zip) ($rec.part + '.deploy.json')
  [IO.File]::WriteAllText($local, (ConvertTo-Json -InputObject $rec -Depth 4), (New-Object Text.UTF8Encoding($false)))
  $far = $store + '/current/' + $rec.part + '.json'
  Send-ThornswoodArtifactFile $local $Target $SshArgs $far
  $line = ($rec.deployedUtc + ' ' + $rec.part + ' ' + $rec.name + ' from ' + $rec.from).Replace("'", "''")
  $said = Invoke-ThornswoodArtifactRemote $Target $SshArgs @"
Copy-Item -LiteralPath '$($far.Replace('/', '\'))' -Destination '$($Beside.Replace('/', '\').Replace("'", "''"))' -Force
Add-Content -LiteralPath '$($store.Replace('/', '\'))\history.log' -Value '$line'
'RECORDED'
"@
  if ($said -notcontains 'RECORDED') {
    Write-Host ('  the record went to the store and not beside ' + $rec.part + ': ' + ($said -join ' ')) -ForegroundColor Yellow
  } else {
    Write-Host ('  the box records ' + $rec.part + ' as ' + $rec.name) -ForegroundColor DarkGray
  }
  return $rec
}

<#
  A FULL SERVER PUBLISH RECORDS THE SAME WAY (#459). Publish-Server.ps1 does
  not swap files inside the root the way Deploy-Server.ps1 does: the installer
  swaps the whole folder and keeps the old one beside it as
  <root>.prev-<stamp>, and it does not carry data\thornswood-deploy.json from
  one folder to the next, because that file describes the folder it is in.
  Until 11 Oct a full publish wrote no record at all, so the new folder went
  on naming the gamemode the old one ran (measured 30 Sep: e445101a, with
  32dea10d installed).

  Once the installer has said INSTALL OK, which is the new server answering on
  both its ports, and the artifact is in the store (Send-ThornswoodArtifact),
  Set-ThornswoodServerRecord asks the box to hold what the root now runs to
  that artifact: gamemode.js must be the artifact's own bytes, and the root's
  thornswood-build.json must describe that gamemode.js. Either one wrong, and
  nothing is recorded and the box says SERVER NOT RECORDED and why. Otherwise
  the record goes beside it (data\, where the server serves it) and into
  current\<part>.json, with a line in history.log, the same record
  Set-ThornswoodArtifactCurrent writes. It names the commit the gamemode came
  from; the engine's own commit is in the root's server-build.json, which
  DeployedBuild.ps1 reads for the site, so the two stay apart.

  After a put-back, Restore-ThornswoodServerRecord: the folder that came back
  has its own record in data\. It becomes current only when the store's record
  of the artifact it names lists the gamemode.js that came back with it. A
  folder with no record, or one whose record does not describe its gamemode.js
  (a folder installed before 11 Oct holds the record the folder before it
  had), is recorded as an older copy with no commit, as Restore-SwapRecord
  does for a put-back inside the root.
#>
function Get-ThornswoodServerRecordScript {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$GamemodeSha,
    [Parameter(Mandatory = $true)][string]$RecordJson,
    [Parameter(Mandatory = $true)][string]$Line,
    [string]$Store = $script:ThornswoodDeployStore
  )
  $q = { param($s) "'" + ([string]$s).Replace("'", "''") + "'" }
  $rootWin = $Root.Replace('/', '\').TrimEnd('\')
  $storeWin = $Store.Replace('/', '\').TrimEnd('\')
  $cur = $storeWin + '\current\' + (Get-ThornswoodArtifactPart $Root) + '.json'
  return @"
`$r = $(& $q $rootWin)
`$want = $(& $q $GamemodeSha.ToLowerInvariant())
`$gm = Join-Path `$r 'gamemode.js'
`$why = ''
if (-not (Test-Path -LiteralPath `$gm)) { `$why = 'there is no gamemode.js in ' + `$r }
elseif ((Get-FileHash -LiteralPath `$gm -Algorithm SHA256).Hash.ToLowerInvariant() -ne `$want) { `$why = 'the gamemode.js in ' + `$r + ' is not the one in ' + $(& $q $Name) }
else {
  `$s = `$null
  try { `$s = ([IO.File]::ReadAllText((Join-Path `$r 'thornswood-build.json')) -replace '^\uFEFF', '') | ConvertFrom-Json } catch { `$s = `$null }
  if (-not `$s -or [string]`$s.gamemodeSha256 -ne `$want) { `$why = 'the thornswood-build.json in ' + `$r + ' does not describe that gamemode.js' }
}
if (`$why) { 'SERVER NOT RECORDED: ' + `$why }
else {
  `$e = New-Object Text.UTF8Encoding `$false
  `$j = $(& $q $RecordJson)
  `$cur = $(& $q $cur)
  New-Item -ItemType Directory -Force -Path (Join-Path `$r 'data'), (Split-Path -Parent `$cur) | Out-Null
  [IO.File]::WriteAllText((Join-Path `$r 'data\thornswood-deploy.json'), `$j, `$e)
  [IO.File]::WriteAllText(`$cur, `$j, `$e)
  Add-Content -LiteralPath $(& $q ($storeWin + '\history.log')) -Value $(& $q $Line)
  'SERVER RECORDED ' + $(& $q $Name)
}
"@
}

function Set-ThornswoodServerRecord {
  param(
    [Parameter(Mandatory = $true)]$Artifact,
    [Parameter(Mandatory = $true)][string]$Target,
    [string[]]$SshArgs = @(),
    [Parameter(Mandatory = $true)][string]$Root,
    [string]$Store = $script:ThornswoodDeployStore
  )
  $gmSha = ''
  foreach ($f in @($Artifact.Record.files)) { if ([string]$f.path -eq 'game/gamemode.js') { $gmSha = [string]$f.sha256 } }
  if ($gmSha -notmatch '^[0-9a-fA-F]{64}$') { return @('SERVER NOT RECORDED: ' + $Artifact.Name + ' lists no game/gamemode.js') }
  $rec = New-ThornswoodDeployRecord $Artifact $Root
  $json = ConvertTo-Json -InputObject $rec -Depth 4
  $line = $rec.deployedUtc + ' ' + $rec.part + ' ' + $rec.name + ' from ' + $rec.from
  $said = @(Invoke-ThornswoodArtifactRemote $Target $SshArgs (Get-ThornswoodServerRecordScript -Root $Root -Name $Artifact.Name -GamemodeSha $gmSha -RecordJson $json -Line $line -Store $Store))
  if (@($said | Where-Object { "$_" -like 'SERVER RECORDED *' }).Count) { Write-Host ('  the box records ' + $rec.part + ' as ' + $rec.name) -ForegroundColor DarkGray }
  return $said
}

function Get-ThornswoodServerRestoreScript {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$At,
    [string]$From = [Environment]::MachineName,
    [string]$Store = $script:ThornswoodDeployStore
  )
  $q = { param($s) "'" + ([string]$s).Replace("'", "''") + "'" }
  $rootWin = $Root.Replace('/', '\').TrimEnd('\')
  $storeWin = $Store.Replace('/', '\').TrimEnd('\')
  $part = Get-ThornswoodArtifactPart $Root
  return @"
$(Get-ThornswoodLockedFolderScript $storeWin)
`$r = $(& $q $rootWin)
`$b = Join-Path `$r 'data\thornswood-deploy.json'
`$st = $(& $q $storeWin)
`$cur = Join-Path `$st $(& $q ('current\' + $part + '.json'))
`$sha = ''
if (Test-Path -LiteralPath (Join-Path `$r 'gamemode.js')) { `$sha = (Get-FileHash -LiteralPath (Join-Path `$r 'gamemode.js') -Algorithm SHA256).Hash.ToLowerInvariant() }
`$name = 'an older copy kept before deploys were recorded'
`$ok = `$false
if (Test-Path -LiteralPath `$b) {
  `$name = 'an older copy its record does not describe'
  try {
    `$n = [string](([IO.File]::ReadAllText(`$b) -replace '^\uFEFF', '') | ConvertFrom-Json).name
    if (`$n -match '^gamemode-[0-9a-f]{12}-[0-9a-f]{16}\.zip$') {
      `$a = ([IO.File]::ReadAllText((Join-Path `$st ('gamemode\' + `$n.Replace('.zip', '.json')))) -replace '^\uFEFF', '') | ConvertFrom-Json
      if (`$sha -and @(`$a.files | Where-Object { `$_.path -eq 'game/gamemode.js' -and `$_.sha256 -eq `$sha }).Count -eq 1) { `$ok = `$true; `$name = `$n }
    }
  } catch { `$ok = `$false }
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent `$cur), (Join-Path `$r 'data') | Out-Null
if (`$ok) { Copy-Item -LiteralPath `$b -Destination `$cur -Force }
else {
  `$j = ConvertTo-Json -InputObject ([ordered]@{ part = $(& $q $part); component = 'gamemode'; name = `$name; commit = ''; putBack = `$true; root = $(& $q $Root.Replace('\', '/').TrimEnd('/')); deployedUtc = $(& $q $At); from = $(& $q $From) })
  `$e = New-Object Text.UTF8Encoding `$false
  [IO.File]::WriteAllText(`$b, `$j, `$e)
  [IO.File]::WriteAllText(`$cur, `$j, `$e)
}
Add-Content -LiteralPath (Join-Path `$st 'history.log') -Value ($(& $q ($At + ' ' + $part + ' put back to ')) + `$name)
'SERVER RECORDED ' + `$name
"@
}

function Restore-ThornswoodServerRecord {
  param(
    [Parameter(Mandatory = $true)][string]$Target,
    [string[]]$SshArgs = @(),
    [Parameter(Mandatory = $true)][string]$Root,
    [string]$Store = $script:ThornswoodDeployStore
  )
  $at = [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", [Globalization.CultureInfo]::InvariantCulture)
  $said = @(Invoke-ThornswoodArtifactRemote $Target $SshArgs (Get-ThornswoodServerRestoreScript -Root $Root -At $at -Store $Store))
  $lockFailed = Get-ThornswoodLockFailure $said
  if ($lockFailed) { throw ('The box could not lock the deploy store, so the put-back was not recorded: ' + $lockFailed) }
  $r = @($said | Where-Object { "$_" -like 'SERVER RECORDED *' })
  if ($r.Count) { Write-Host ('  the box records ' + (Get-ThornswoodArtifactPart $Root) + ' as ' + ([string]$r[0]).Substring(16)) -ForegroundColor DarkGray }
  return $said
}
