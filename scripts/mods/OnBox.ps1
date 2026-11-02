<#
  OnBox.ps1

  The two scripts Run-OnBox.ps1 sends to the box (issue #2899): the keeper,
  which makes the run's folder and removes it, and the run. Kept apart so
  tests\test-2899-run-on-box.ps1 runs the same text under PowerShell 7, as
  the box does, against a stand-in folder. Defines functions and nothing else.

  The keeper's folder is the one way a script here lands files on the box or
  makes them there to bring back (#3035): Open-ThornswoodOnBoxFolder and
  Close-ThornswoodOnBoxFolder, below, for Run-OnBox.ps1 and Backup-Server.ps1
  alike. A script that only needs its text run there sends it through
  Send-Script.ps1 instead, whose run deletes a long one's copy before it runs.

  The far side runs under PowerShell 7: ASCII, and .NET for the
  hashes, not Get-FileHash (ServerContent.ps1 says why).
#>

# Skyrim's own archives the content tools read (Patrick, 20 Oct 2026, A on
# #2899): Interface for the string tables and the menus, Meshes and Textures
# for the notice board and Check-FromGame. Kept on the box in one folder of
# their own, SYSTEM's and Administrators' only, each file read only to
# everyone but SYSTEM, and every one of them the bytes records\skyrim-files.json
# names. scripts\mods\Send-GameArchives.ps1 puts them there, and with them,
# under Strings, the loose string tables records\game-strings.json names: a
# localized master whose names are in no archive (RaceCompatibility.esm,
# measured 20 Oct) stops Build-LastPlugin without them. _ResourcePack.bsa,
# the game's own archive beside _ResourcePack.esl, since #3100: that master
# is localized and its string tables are in that archive alone, so on 21 Oct
# the hunt and ore builders failed on the box with "_ResourcePack.esl:
# localised and no english string table found" (records\skyrim-files.json
# pins its size and sha1 like the others).
$ThornswoodGameArchiveStore = 'C:\Thornswood-GameData'
$ThornswoodGameArchives = @('Skyrim - Interface.bsa', 'Skyrim - Meshes0.bsa', 'Skyrim - Meshes1.bsa') +
    @(0..8 | ForEach-Object { 'Skyrim - Textures' + $_ + '.bsa' }) + @('_ResourcePack.bsa')
# And the script pack (#3105): every Papyrus script a game PC's Data folder
# holds, which scripts\mods\New-ScriptPack.py makes there and
# records\papyrus-scripts.json pins. None of the archives that carry scripts
# is on the box (Skyrim - Misc.bsa, the Creation Club ones, the mods'), so on
# 26 Oct the whole rebuild stopped at the crime table with 14,553 scripts
# missing. Each run links it into its data folder beside the archives, where
# scripts\dev\Audit-PapyrusEvents.py reads it in their place.
$ThornswoodScriptPack = 'papyrus-scripts.zip'

# Text for the box: makes a file readable, and linkable, and nothing more to
# everyone but SYSTEM. A run reaches the archives through hard links, which
# share the file's rules, so a tool that opens one to write is refused and
# the store keeps its bytes; deleting the link needs only the run folder's
# own rules. Making a hard link opens the file for its attributes, so the
# account that links needs WriteAttributes: measured 20 Oct, the build
# runner's account (not elevated) was refused "Access is denied" at the link
# with read alone (run 39470283490), where Administrator on the box was not
# refused. Attributes are not the bytes: writing still needs
# WriteData, which nobody but SYSTEM has.
function Get-ThornswoodArchiveReadOnlyScript {
    return @'
function Set-ThornswoodArchiveReadOnly([string]$Path) {
  $acl = New-Object Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-5-18')), 'FullControl', 'Allow')))
  foreach ($s in @('S-1-5-32-544', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)) {
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($s)), 'ReadAndExecute, WriteAttributes, Synchronize', 'Allow')))
  }
  [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo](Get-Item -LiteralPath $Path -Force), $acl)
}
'@
}

# Text for the box: names the run's folder $run and holds it through its lock
# for as long as the process that runs this lives. The folder is in use while
# its lock is held (the keeper, below), and a run holds it too, so even with
# the keeper's session gone no other run's sweep takes the folder from under
# what is running in it. The handle goes when the process ends, however it
# ends. A folder no keeper made has no lock, and nothing runs in it.
function Get-ThornswoodOnBoxHoldScript([Parameter(Mandatory = $true)][string]$Run) {
    return @"
`$run = '$Run'
try { `$hold = New-Object IO.FileStream((`$run + '.lock'), 'Open', 'ReadWrite', 'ReadWrite') }
catch { 'STOP. the run''s folder could not be held through its lock, so nothing ran: ' + `$_.Exception.GetBaseException().Message; exit 2 }
"@
}

# -Run is the run's own folder on the box, holding tools.zip; -ServerRoot the
# game server whose plugins folder is copied; -Tool the repository path of
# the tool, a .py run by Python, a .js by node or a .ps1 by PowerShell 7
# (#3100); -Arguments what it is run with, '{data}', '{plugins}',
# '{settings}' and '{repo}' standing for the data folder, the plugin list,
# the load order settings and the repository folder of the run. The plugin
# list is the server's loadOrder as the game's plugins.txt; the load order
# settings are a server-settings.json holding that loadOrder alone, each
# plugin in the run's data folder, for the builders that read a server's
# settings (Build-NpcPopulation.py), so they read this commit's own plugins
# and not the server's copies. Each is made only when an argument names it:
# server-settings.json holds the server's secrets too, so only its loadOrder
# is read, and only the file names in it are written.
function Get-ThornswoodOnBoxScript {
    param(
        [Parameter(Mandatory = $true)][string]$Run,
        [Parameter(Mandatory = $true)][string]$ServerRoot,
        [Parameter(Mandatory = $true)][string]$Tool,
        [string[]]$Arguments = @(),
        [string]$ArchiveStore = $ThornswoodGameArchiveStore,
        # What the run lists and brings back when it changes: folders and
        # files of the repository, with forward slashes. Run-OnBox.ps1 adds
        # every file a step of the content chain writes outside these (#3425).
        [string[]]$Watch = @('game', 'records', 'docs/systems')
    )
    foreach ($w in $Watch) {
        if ($w -notmatch '^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$' -or $w -match '(^|/)\.\.?(/|$)') { throw "$w is not a path inside the repository to watch." }
    }
    $watchText = (@($Watch | ForEach-Object { "'" + $_.Replace('/', '\') + "'" }) -join ', ')
    $argText = (@($Arguments | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }) -join ', ')
    $wantsPlugins = [bool]@($Arguments | Where-Object { $_ -like '*{plugins}*' }).Count
    $wantsSettings = [bool]@($Arguments | Where-Object { $_ -like '*{settings}*' }).Count
    $kind = [IO.Path]::GetExtension($Tool).ToLowerInvariant()
    $toolFar = $Tool.Replace('/', '\')
    return @"
`$ErrorActionPreference = 'Stop'
`$ProgressPreference = 'SilentlyContinue'
$(Get-ThornswoodOnBoxHoldScript -Run $Run)
`$repo = Join-Path `$run 'repo'
`$data = Join-Path `$run 'data'
`$plugins = '$serverRoot\plugins'
if (-not (Test-Path -LiteralPath `$plugins)) { 'STOP. there is no ' + `$plugins + ' on the box.'; exit 2 }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory((Join-Path `$run 'tools.zip'), `$repo)
New-Item -ItemType Directory -Force -Path `$data | Out-Null
`$ours = @(Get-ChildItem -LiteralPath (Join-Path `$repo 'game\content') -File | ForEach-Object { `$_.Name.ToLowerInvariant() })
foreach (`$f in @(Get-ChildItem -LiteralPath `$plugins -File)) {
  if (`$ours -notcontains `$f.Name.ToLowerInvariant()) { Copy-Item -LiteralPath `$f.FullName -Destination `$data }
}
foreach (`$f in @(Get-ChildItem -LiteralPath (Join-Path `$repo 'game\content') -File)) { Copy-Item -LiteralPath `$f.FullName -Destination `$data }
'data      ' + @(Get-ChildItem -LiteralPath `$data -File).Count + ' plugin(s): ' + `$plugins + ', with this commit''s own in place of the server''s'
`$store = '$ArchiveStore'
`$linked = 0
if (Test-Path -LiteralPath `$store) {
  foreach (`$f in @(Get-ChildItem -LiteralPath `$store -File -Filter '*.bsa')) {
    `$null = New-Item -ItemType HardLink -Path (Join-Path `$data `$f.Name) -Value `$f.FullName
    `$linked++
  }
}
if (`$linked) { 'archives  ' + `$linked + ' from ' + `$store + ', linked, read only' } else { 'archives  none: ' + `$store + ' holds no Skyrim archive, so a tool that reads one stops' }
`$pack = Join-Path `$store '$ThornswoodScriptPack'
if (Test-Path -LiteralPath `$pack) {
  `$null = New-Item -ItemType HardLink -Path (Join-Path `$data '$ThornswoodScriptPack') -Value `$pack
  'scripts   $ThornswoodScriptPack from ' + `$store + ', linked, read only'
} else { 'scripts   none: ' + `$store + ' holds no $ThornswoodScriptPack, so a tool that reads the scripts stops' }
`$storeStrings = Join-Path `$store 'Strings'
`$linkedStrings = 0
if (Test-Path -LiteralPath `$storeStrings) {
  `$dataStrings = Join-Path `$data 'Strings'
  New-Item -ItemType Directory -Force -Path `$dataStrings | Out-Null
  foreach (`$f in @(Get-ChildItem -LiteralPath `$storeStrings -File)) {
    `$null = New-Item -ItemType HardLink -Path (Join-Path `$dataStrings `$f.Name) -Value `$f.FullName
    `$linkedStrings++
  }
}
if (`$linkedStrings) { 'strings   ' + `$linkedStrings + ' loose string table(s) from ' + `$storeStrings + ', linked, read only' }
`$pluginList = Join-Path `$run 'plugins.txt'
`$orderSettings = Join-Path `$run 'server-settings.json'
if (`$$wantsPlugins -or `$$wantsSettings) {
  try { `$order = @(([IO.File]::ReadAllText('$ServerRoot\server-settings.json') | ConvertFrom-Json).loadOrder) } catch { `$order = @() }
  `$names = @(`$order | ForEach-Object { [IO.Path]::GetFileName([string]`$_) } | Where-Object { `$_ })
  if (-not `$names.Count) { 'STOP. ' + '$ServerRoot\server-settings.json' + ' names no loadOrder, so there is no load order to give the tool.'; exit 2 }
}
if (`$$wantsPlugins) {
  `$masters = @('skyrim.esm', 'update.esm', 'dawnguard.esm', 'hearthfires.esm', 'dragonborn.esm')
  `$lines = @(`$names | Where-Object { `$masters -notcontains `$_.ToLowerInvariant() } | ForEach-Object { '*' + `$_ })
  [IO.File]::WriteAllLines(`$pluginList, [string[]]`$lines, (New-Object Text.UTF8Encoding(`$false)))
  'plugins   ' + `$lines.Count + ' line(s) in plugins.txt: the loadOrder of ' + '$ServerRoot\server-settings.json' + ' after the five masters'
}
if (`$$wantsSettings) {
  `$inData = @(`$names | ForEach-Object { (Join-Path `$data `$_).Replace('\', '/') })
  [IO.File]::WriteAllText(`$orderSettings, (ConvertTo-Json -InputObject @{ loadOrder = [string[]]`$inData } -Depth 3), (New-Object Text.UTF8Encoding(`$false)))
  'settings  ' + `$inData.Count + ' plugin(s) in server-settings.json: the loadOrder of ' + '$ServerRoot\server-settings.json' + ', in the run''s data folder, and nothing else of it'
}

`$sha = [Security.Cryptography.SHA256]::Create()
function Hashes {
  `$h = @{}
  foreach (`$top in $watchText) {
    `$d = Join-Path `$repo `$top
    if (-not (Test-Path -LiteralPath `$d)) { continue }
    `$files = `$(if (Test-Path -LiteralPath `$d -PathType Leaf) { @(Get-Item -LiteralPath `$d) } else { @(Get-ChildItem -LiteralPath `$d -File -Recurse) })
    foreach (`$f in `$files) {
      `$rel = `$f.FullName.Substring(`$repo.Length + 1).Replace('\', '/')
      `$s = [IO.File]::OpenRead(`$f.FullName)
      try { `$h[`$rel] = [BitConverter]::ToString(`$sha.ComputeHash(`$s)) } finally { `$s.Close() }
    }
  }
  return `$h
}
`$before = Hashes

# python.exe itself, named by the py launcher: run through py, a quoted
# path arrived with a space in front of it and Python could not open it.
# Named for every tool, because Rebuild-ContentTables.ps1 runs Python
# builders too: it goes first on the PATH the tool is given.
`$launcher = Get-Command py -CommandType Application -EA SilentlyContinue | Select-Object -First 1
if (-not `$launcher) { 'STOP. there is no Python launcher (py) on the box.'; exit 2 }
`$python = (& `$launcher.Source -3 -c 'import sys; print(sys.executable)' | Select-Object -First 1)
if (-not `$python -or -not (Test-Path -LiteralPath `$python)) { 'STOP. py -3 named no Python on the box.'; exit 2 }
`$env:PATH = (Split-Path -Parent `$python) + ';' + `$env:PATH
# Thornswood-Last.esp is this commit's, made from its recipe out of the run's
# data folder (#2791): the plugin is not in the repository, so what the copy
# above put there is the server's, made from whichever recipe it last
# deployed. When this commit's recipe does not make it here (a plugin it
# reads is another copy, the content plugin of a pull request), the server's
# stays and the line says so; Build-LastPlugin.py makes this commit's.
`$lastRecipe = Join-Path `$repo 'game\data\last-plugin.recipe'
if (Test-Path -LiteralPath `$lastRecipe) {
  `$lastSaid = @(& `$python (Join-Path `$repo 'scripts\mods\Make-LastPlugin.py') --data `$data --recipe `$lastRecipe 2>&1 | ForEach-Object { "`$_".Trim() } | Where-Object { `$_ })
  if (`$LASTEXITCODE -eq 0) { 'last      Thornswood-Last.esp made from this commit''s recipe: ' + (`$lastSaid -join ' ') }
  else { 'last      Thornswood-Last.esp is the server''s copy, because this commit''s recipe does not make it here: ' + (`$lastSaid -join ' ') }
}
`$words = @()
switch ('$kind') {
  '.py' { `$exe = `$python }
  '.js' {
    `$c = Get-Command node -CommandType Application -EA SilentlyContinue | Select-Object -First 1
    if (-not `$c) { 'STOP. there is no node on the box.'; exit 2 }
    `$exe = `$c.Source
  }
  '.ps1' {
    `$c = Get-Command pwsh -CommandType Application -EA SilentlyContinue | Select-Object -First 1
    if (-not `$c) { 'STOP. there is no PowerShell 7 (pwsh) on the box.'; exit 2 }
    `$exe = `$c.Source
    `$words = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File')
  }
  default { 'STOP. ' + '$Tool' + ' is not a .py, .js or .ps1 tool.'; exit 2 }
}
`$given = @($argText)
`$words += '"' + (Join-Path `$repo '$toolFar') + '"'
foreach (`$a in `$given) { `$words += '"' + `$a.Replace('{data}', `$data).Replace('{plugins}', `$pluginList).Replace('{settings}', `$orderSettings).Replace('{repo}', `$repo) + '"' }
`$env:THORNSWOOD_DATA = `$data
`$env:PYTHONUTF8 = '1'
`$env:PYTHONIOENCODING = 'utf-8'
`$env:PYTHONDONTWRITEBYTECODE = '1'
`$out = Join-Path `$run 'out.txt'
`$err = Join-Path `$run 'err.txt'
`$p = Start-Process -FilePath `$exe -ArgumentList `$words -WorkingDirectory `$repo -NoNewWindow -PassThru -RedirectStandardOutput `$out -RedirectStandardError `$err
# Taking the handle now is what keeps ExitCode: without it, a process
# Start-Process started reports none once it has ended.
`$null = `$p.Handle
try { `$p.PriorityClass = 'BelowNormal' } catch { 'priority left as it was: ' + `$_.Exception.Message }
`$p.WaitForExit()
`$code = `$p.ExitCode
'-------- $tool --------'
Get-Content -LiteralPath `$out -Encoding UTF8
Get-Content -LiteralPath `$err -Encoding UTF8
'-------- end --------'

`$after = Hashes
`$changed = @(`$after.Keys | Where-Object { `$before[`$_] -ne `$after[`$_] } | Sort-Object)
if (`$changed.Count) {
  `$zip = [IO.Compression.ZipFile]::Open((Join-Path `$run 'back.zip'), 'Create')
  try { foreach (`$c in `$changed) { [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile(`$zip, (Join-Path `$repo `$c.Replace('/', '\')), `$c) } } finally { `$zip.Dispose() }
}
foreach (`$c in `$changed) { 'CHANGED ' + `$c }
'EXIT ' + `$code
"@
}

# The run's folder lives as long as one far process, the keeper's (#2999).
# Until 21 Oct 2026 the folder was made by one ssh call and removed by
# another at the end, so a run cut before that call (a bridge reset, the
# machine running it going away) left the folder on the box for good, with
# its 383 MB copy of the plugins, and nothing there ever removed it. Now:
#
#   - <run>.lock, beside the folder, is held for as long as the run is going:
#     by this script from before the folder exists until it is removed, and by
#     the run itself (above) while the tool runs. Windows lets go of a handle
#     when its process ends however it ends.
#   - The keeper waits on a named event of its own, $End, made here (a name
#     somebody made first is refused before anything else is done). When it
#     is set, which Close-ThornswoodOnBoxFolder does from a second ssh
#     session, it removes the folder itself and says GONE. Until 21 Oct it
#     waited for its standard input to close, and on the box that never
#     came: sshd passes on nothing written or closed after a session starts
#     (#2912, #3059), so every Close waited for good (#3063). The named
#     event is how the secret proof's watcher is stopped there (#2912).
#   - A folder whose lock nobody holds belongs to a run that is over, so before
#     it makes its own, this removes every such thornswood-onbox-* folder
#     beside it: a folder whose keeper was ended (the box restarting), and
#     one from before the lock (it has none). A folder whose lock is held
#     is a run still going, and is left alone. No age and no time limit decide
#     it: only whether the process that owns the folder is still there.
#   - It also ends when its caller is gone without setting the event (the
#     machine running it going away, a bridge reset). A far process outlives
#     its ssh session on the box (#3059), so the session ending tells it
#     nothing by itself; what does is a write to its standard output, which
#     fails (Win32 error 232) from the moment its session is over (measured
#     on the box 21 Oct 2026, #3063). So while it waits it writes a bare line
#     end every five seconds with WriteFile itself, and when that write fails
#     it removes the folder as if its event had been set. Not through .NET's
#     console stream: that one swallows a broken pipe and reports the write
#     as made. A bare line end is nothing to anybody reading what it says.
#
# Removing takes the lock alone (shared for deleting only, so it can delete
# the lock while it holds it; Windows lets the file go when the handle
# closes), so the run and its keeper, and two runs sweeping at once, never
# remove a folder another holds. Lines out: GONE <folder>, HELD
# <folder>: why (still in use), LEFT <folder>: why (could not be removed),
# MADE <folder> once this run's own is there, and TAKEN <name> when its event
# was made by somebody else first. Each is written and flushed as it happens,
# because Run-OnBox.ps1 waits for MADE while this waits for its end. Short
# enough for the command line on purpose
# (Start-ThornswoodRemote): a script sent as a file first would be one more
# thing on the box a cut session leaves.
function Get-ThornswoodOnBoxKeepScript([Parameter(Mandatory = $true)][string]$Run, [Parameter(Mandatory = $true)][string]$End) {
    if ($End -notmatch '^Global\\Thornswood-OnBoxEnd-[0-9a-f]{32}$') { throw ('not a keeper''s end event: ' + $End) }
    return @"
`$ErrorActionPreference = 'Stop'
`$ProgressPreference = 'SilentlyContinue'
`$run = '$Run'
`$top = Split-Path -Parent `$run
function Say([string]`$l) { [Console]::Out.WriteLine(`$l); [Console]::Out.Flush() }
`$made = `$false
`$end = [Threading.EventWaitHandle]::new(`$false, [Threading.EventResetMode]::ManualReset, '$End', [ref]`$made)
if (-not `$made) { Say ('TAKEN $End'); exit 2 }
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class ThornswoodKeeperOut{[DllImport("kernel32.dll")]static extern IntPtr GetStdHandle(int n);[DllImport("kernel32.dll",SetLastError=true)]static extern bool WriteFile(IntPtr h,byte[] b,int n,out int d,IntPtr o);public static int Beat(){byte[] b={10};int d;return WriteFile(GetStdHandle(-11),b,1,out d,IntPtr.Zero)?0:Marshal.GetLastWin32Error();}}'
function Drop([string]`$d) {
  try { `$h = New-Object IO.FileStream((`$d + '.lock'), 'OpenOrCreate', 'ReadWrite', 'Delete') }
  catch { Say ('HELD ' + `$d + ': ' + `$_.Exception.GetBaseException().Message); return }
  try {
    if (Test-Path -LiteralPath `$d) { Remove-Item -LiteralPath `$d -Recurse -Force }
    [IO.File]::Delete(`$d + '.lock')
    Say ('GONE ' + `$d)
  } catch { Say ('LEFT ' + `$d + ': ' + `$_.Exception.Message) } finally { `$h.Dispose() }
}
`$seen = @{}
foreach (`$f in @(Get-ChildItem -LiteralPath `$top -Filter 'thornswood-onbox-*' -Force)) {
  if (`$f.Name -notmatch '^(thornswood-onbox-[0-9a-f]{12})(\.lock)?`$') { continue }
  `$d = Join-Path `$top `$Matches[1]
  if (`$d -eq `$run -or `$seen[`$d]) { continue }
  `$seen[`$d] = 1
  Drop `$d
}
`$own = New-Object IO.FileStream((`$run + '.lock'), 'CreateNew', 'ReadWrite', 'ReadWrite')
New-Item -ItemType Directory -Path `$run | Out-Null
Say ('MADE ' + `$run)
while (-not `$end.WaitOne(5000)) { if ([ThornswoodKeeperOut]::Beat()) { break } }
`$own.Dispose()
Drop `$run
`$end.Dispose()
"@
}

# What the second ssh session runs to end a keeper: sets its event. Says END
# SET, or END GONE when no keeper holds that event any more.
function Get-ThornswoodOnBoxEndScript([Parameter(Mandatory = $true)][string]$End) {
    if ($End -notmatch '^Global\\Thornswood-OnBoxEnd-[0-9a-f]{32}$') { throw ('not a keeper''s end event: ' + $End) }
    return "`$e = `$null; if ([Threading.EventWaitHandle]::TryOpenExisting('$End', [ref]`$e)) { [void]`$e.Set(); `$e.Dispose(); 'END SET' } else { 'END GONE' }"
}

# A folder of its own on the box for one run, held by its keeper until
# Close-ThornswoodOnBoxFolder ends it (above). Needs Send-Script.ps1 loaded.
# Hands back Run (the folder, Windows form), Far (with forward slashes, for
# scp), Made, Keeper (the ssh process), Said (what the keeper's sweep of
# earlier folders said before MADE), Rest (the read of what it says after),
# and End, Target and SshArgs for the close. Made false means there is no folder: the caller stops, and still
# hands this to Close-ThornswoodOnBoxFolder.
function Open-ThornswoodOnBoxFolder {
    param(
        [Parameter(Mandatory = $true)][string]$Target,
        [string[]]$SshArgs = @()
    )
    $run = 'C:\Windows\Temp\thornswood-onbox-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
    # A name nobody can know ahead of the run, so nobody makes it first.
    $end = 'Global\Thornswood-OnBoxEnd-' + [Guid]::NewGuid().ToString('N')
    # The keeper first: it removes what earlier runs left, then makes this
    # run's folder and holds it until its event is set.
    $keeper = Start-ThornswoodRemote -Target $Target -SshArgs $SshArgs -Script (Get-ThornswoodOnBoxKeepScript -Run $run -End $end)
    $said = @()
    $made = $false
    while ($null -ne ($l = $keeper.StandardOutput.ReadLine())) {
        $l = $l.Trim()
        if ($l -eq ('MADE ' + $run)) { $made = $true; break }
        if ($l) { $said += $l }
    }
    # The rest is read as it comes, so the keeper's line ends while it waits
    # never fill the pipe and stop it at a write.
    $rest = $keeper.StandardOutput.ReadToEndAsync()
    return [pscustomobject]@{ Run = $run; Far = $run.Replace('\', '/'); Made = $made; Keeper = $keeper; Said = $said; Rest = $rest; End = $end; Target = $Target; SshArgs = $SshArgs }
}

# Tells the keeper the run is over: a second ssh session sets its event, and
# it removes the folder, says GONE and ends, and its ssh with it. The event is
# set even when the keeper's ssh here has already ended, since on the box the
# keeper outlives its session (#3059). When it could not be set, nothing will
# end that keeper's ssh here, so it is ended, and what the set said is handed
# back with the rest. Hands back Gone (the keeper said its folder is gone, or
# there was none), Told (the event was set, or no keeper holds it any more)
# and Said (the keeper's last lines, then the set's).
function Close-ThornswoodOnBoxFolder([Parameter(Mandatory = $true)]$Folder) {
    $k = $Folder.Keeper
    $told = @(Invoke-ThornswoodRemote -Target $Folder.Target -SshArgs $Folder.SshArgs -Script (Get-ThornswoodOnBoxEndScript -End $Folder.End) 2>&1 | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
    if (-not $k.HasExited -and -not ($told -contains 'END SET')) {
        # With the bridge's node under it on One: the whole tree where .NET
        # can (PowerShell 7), the ssh alone where it cannot (5.1).
        if ($PSVersionTable.PSVersion.Major -ge 6) { $k.Kill($true) } else { $k.Kill() }
    }
    $said = @($Folder.Rest.Result -split '\r?\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $k.WaitForExit()
    return [pscustomobject]@{ Gone = ((-not $Folder.Made) -or ($said -contains ('GONE ' + $Folder.Run))); Told = (($told -contains 'END SET') -or ($told -contains 'END GONE')); Said = @($said + @($told | Where-Object { $_ -ne 'END SET' })) }
}
