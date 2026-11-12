<#
  Check-Serena.ps1

  Read only. Says how Claude Code on this machine starts Serena, and times
  one start the way Claude Code makes it: from the repo folder, over stdin
  and stdout, until Serena answers initialize and lists its tools. Claude
  Code gives an MCP server 30 seconds (MCP_TIMEOUT when that is set) and then
  shows it as failed for the whole session.

    pwsh -NoProfile -File scripts\dev\Check-Serena.ps1
    pwsh -NoProfile -File scripts\dev\Check-Serena.ps1 -Phases

  Why it exists: #2935. On One on 20 October a session started with Serena
  failed, "connection timed out after 30000ms", and Serena had not written
  its log yet, so the time went before Serena's own code ran. Serena was
  started as `uvx --from serena-agent serena start-mcp-server ...`, and uvx
  resolves serena-agent against PyPI at every start: measured on 21 October
  it reads 148 index entries each time, and the set it resolves to changed 15
  times in the 30 days before (a new serena-agent, httpx2, certifi, pillow
  and the like), and each change makes uvx build a new environment on the
  next start, downloading what changed and compiling every module on first
  import. scripts\dev\Install-Serena.ps1 installs the version in
  scripts\dev\serena-version.txt once and points Claude Code at that program;
  this says whether a machine is set up that way and how long a start takes.

  -Phases also times the parts of a uvx start on their own: uvx with the
  index, uvx offline, and the import of Serena, so a slow start can be put
  down to the part it is spent in.

  It changes nothing of ours. The Serena it starts writes its usual log in
  ~\.serena\logs and is stopped again once it has answered.

  Exit 0 when Serena starts from the installed program at the pinned version
  and answers inside -Within seconds, 1 otherwise, with the reason.
#>
#Requires -Version 7
[CmdletBinding()]
param(
    # The folder Claude Code is started in. Serena is run with
    # --project-from-cwd, so this is the project it loads.
    [string]$Folder = '',
    # Claude Code's own config, where `claude mcp add --scope user` writes.
    [string]$Config = '',
    # A start that answers later than this fails the check. Half of Claude
    # Code's 30 seconds, because a session start shares the machine with
    # every other server Claude Code starts at the same moment.
    [int]$Within = 15,
    # How long to wait for an answer at all before calling the start dead.
    [int]$Limit = 90,
    # Also time uvx with the index, uvx offline, and Serena's import.
    [switch]$Phases
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
if (-not $Folder) { $Folder = $Repo }
if (-not $Config) { $Config = if ($env:CLAUDE_CONFIG_DIR) { Join-Path $env:CLAUDE_CONFIG_DIR '.claude.json' } else { Join-Path $HOME '.claude.json' } }
$Pin = (Get-Content -LiteralPath (Join-Path $Here 'serena-version.txt') -TotalCount 1).Trim()

function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan }
function Say($m, $c = 'Gray') { Write-Host ('  ' + $m) -ForegroundColor $c }
$problems = [Collections.Generic.List[string]]::new()

# Claude Code keys its projects by folder, with forward slashes.
function Same-Folder([string]$a, [string]$b) {
    $n = { param($p) ($p -replace '\\', '/').TrimEnd('/') }
    return [string]::Equals((& $n $a), (& $n $b), [StringComparison]::OrdinalIgnoreCase)
}

# ------------------------------------------------------------ which entry ---
#
# Claude Code takes the most local definition of a server: one for this
# folder (local scope, in the same file), then the repo's .mcp.json, then
# the user's own. The one that wins is the one that gets started.

Head "How Claude Code starts Serena here"
$found = @()
if (Test-Path -LiteralPath $Config) {
    $cfg = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json -AsHashtable
    if ($cfg.ContainsKey('projects') -and $cfg.projects) {
        foreach ($k in $cfg.projects.Keys) {
            $s = $cfg.projects[$k]
            if ((Same-Folder $k $Folder) -and $s.ContainsKey('mcpServers') -and $s.mcpServers -and $s.mcpServers.ContainsKey('serena')) {
                $found += @{ Scope = "local, for $k"; Entry = $s.mcpServers['serena'] }
            }
        }
    }
} else {
    Say "no Claude Code config at $Config" 'Yellow'
}
$mcpJson = Join-Path $Folder '.mcp.json'
if (Test-Path -LiteralPath $mcpJson) {
    $pj = Get-Content -LiteralPath $mcpJson -Raw | ConvertFrom-Json -AsHashtable
    if ($pj.ContainsKey('mcpServers') -and $pj.mcpServers.ContainsKey('serena')) {
        $found += @{ Scope = "project, $mcpJson"; Entry = $pj.mcpServers['serena'] }
    }
}
if ($cfg -and $cfg.ContainsKey('mcpServers') -and $cfg.mcpServers -and $cfg.mcpServers.ContainsKey('serena')) {
    $found += @{ Scope = 'user'; Entry = $cfg.mcpServers['serena'] }
}
if (-not $found) {
    Say "Claude Code has no Serena for $Folder." 'Red'
    Say 'pwsh -NoProfile -File scripts\dev\Install-Serena.ps1 sets it up.'
    exit 1
}
foreach ($f in $found) { Say ("{0}: {1} {2}" -f $f.Scope, $f.Entry.command, ($f.Entry.args -join ' ')) }
$use = $found[0]
$command = [string]$use.Entry.command
$cmdArgs = @($use.Entry.args | ForEach-Object { [string]$_ })
if ($found.Count -gt 1) { Say ("the {0} one wins, so that is the one timed" -f $use.Scope) }

# ------------------------------------------------------------ what it runs --

$exe = Get-Command $command -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) {
    Say "$command is not a program on this machine, so Serena cannot start at all." 'Red'
    exit 1
}
$leaf = [IO.Path]::GetFileNameWithoutExtension($exe.Source).ToLowerInvariant()
$uv = Get-Command uv -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$route = 'other'
$from = ''
if ($leaf -eq 'uvx' -or ($leaf -eq 'uv' -and $cmdArgs.Count -ge 2 -and $cmdArgs[0] -eq 'tool' -and $cmdArgs[1] -eq 'run')) {
    $route = 'uvx'
    $i = [Array]::IndexOf($cmdArgs, '--from')
    if ($i -ge 0 -and $i + 1 -lt $cmdArgs.Count) { $from = $cmdArgs[$i + 1] } else { $from = 'serena-agent' }
    Say ("uvx resolves {0} against the package index at every start, and builds a new environment whenever what it resolves to has changed." -f $from) 'Yellow'
    $problems.Add("Serena is started through uvx, so every start resolves it first; Install-Serena.ps1 installs version $Pin once instead.")
} elseif ($leaf -eq 'serena') {
    $route = 'installed'
    if (-not $uv) {
        $problems.Add('uv is not on PATH, so which Serena version is installed cannot be read.')
    } else {
        $bin = (& $uv.Source tool dir --bin).Trim()
        if (-not (Same-Folder (Split-Path -Parent $exe.Source) $bin)) {
            $problems.Add("$($exe.Source) is not the program uv installed in $bin.")
        }
        $have = @(& $uv.Source tool list 2>$null | Where-Object { $_ -match '^serena-agent v(\S+)' } | ForEach-Object { $Matches[1] })
        if (-not $have) {
            $problems.Add('uv has no serena-agent installed.')
        } else {
            Say ("installed serena-agent {0}, the repo pins {1}" -f $have[0], $Pin)
            if ($have[0] -ne $Pin) { $problems.Add("installed serena-agent is $($have[0]) and the repo pins $Pin; Install-Serena.ps1 brings it to the pin.") }
        }
    }
} else {
    $problems.Add("Serena is started by $command, which is neither uvx nor the installed program.")
}

# ------------------------------------------------------------ one start -----
#
# The same exchange Claude Code opens with: initialize, the initialized
# notice, tools/list. Times are from the moment the process is created.
# Serena logs to stderr, and its first line is the one that names the log
# file; lines before it are uvx's own (downloads and installs show there).

$window = 30
if ($env:MCP_TIMEOUT -match '^\d+$') { $window = [int]$env:MCP_TIMEOUT / 1000 }

Head ("One start, from {0}" -f $Folder)
$psi = [Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $exe.Source
foreach ($a in $cmdArgs) { $psi.ArgumentList.Add($a) }
$psi.WorkingDirectory = $Folder
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$utf8 = [Text.UTF8Encoding]::new($false)
$psi.StandardInputEncoding = $utf8
$psi.StandardOutputEncoding = $utf8
$psi.StandardErrorEncoding = $utf8
if ($use.Entry.ContainsKey('env') -and $use.Entry.env) {
    foreach ($k in $use.Entry.env.Keys) { $psi.Environment[$k] = [string]$use.Entry.env[$k] }
}

$sw = [Diagnostics.Stopwatch]::StartNew()
$proc = [Diagnostics.Process]::Start($psi)
$errTask = $proc.StandardError.ReadLineAsync()
$errOpen = $true
$firstSerena = $null
$before = [Collections.Generic.List[string]]::new()

function Read-Err {
    while ($script:errOpen -and $script:errTask.IsCompleted) {
        $line = $script:errTask.Result
        if ($null -eq $line) { $script:errOpen = $false; return }
        if (-not $script:firstSerena -and $line -match 'serena\.cli|Serena MCP server') {
            $script:firstSerena = $script:sw.Elapsed.TotalSeconds
        } elseif (-not $script:firstSerena -and $line.Trim()) {
            $script:before.Add($line.Trim())
        }
        $script:errTask = $script:proc.StandardError.ReadLineAsync()
    }
}

# The next JSON-RPC answer with this id, or $null when none came in time.
function Read-Answer([int]$id) {
    while ($true) {
        $t = $script:proc.StandardOutput.ReadLineAsync()
        while (-not $t.IsCompleted) {
            $left = $script:Limit - $script:sw.Elapsed.TotalSeconds
            if ($left -le 0) { return $null }
            $wait = @($t)
            if ($script:errOpen) { $wait += $script:errTask }
            [void][Threading.Tasks.Task]::WaitAny([Threading.Tasks.Task[]]$wait, [int][Math]::Min(250, $left * 1000))
            Read-Err
        }
        $line = $t.Result
        if ($null -eq $line) { return $null }
        # An MCP server writes only JSON-RPC to stdout; anything else is not an answer.
        if (-not (Test-Json -Json $line -ErrorAction SilentlyContinue)) { continue }
        $msg = $line | ConvertFrom-Json -AsHashtable
        if ($msg -is [hashtable] -and $msg.ContainsKey('id') -and $msg.id -eq $id) { return $msg }
    }
}

function Send($o) {
    $script:proc.StandardInput.WriteLine(($o | ConvertTo-Json -Depth 8 -Compress))
    $script:proc.StandardInput.Flush()
}

Send @{ jsonrpc = '2.0'; id = 1; method = 'initialize'; params = @{ protocolVersion = '2025-06-18'; capabilities = @{}; clientInfo = @{ name = 'Check-Serena'; version = '1' } } }
$init = Read-Answer 1
$tInit = $sw.Elapsed.TotalSeconds
$tools = $null
if ($init) {
    Send @{ jsonrpc = '2.0'; method = 'notifications/initialized' }
    Send @{ jsonrpc = '2.0'; id = 2; method = 'tools/list' }
    $tools = Read-Answer 2
}
$tTools = $sw.Elapsed.TotalSeconds
Read-Err

foreach ($b in $before) { Say ("before Serena: {0}" -f $b) 'DarkGray' }
if ($firstSerena) { Say ("{0,6:N1} s  Serena's first log line" -f $firstSerena) } else { Say "Serena wrote no log line" 'Yellow' }
if ($init -and $init.ContainsKey('result')) {
    $c = if ($tInit -gt $window) { 'Red' } elseif ($tInit -gt $Within) { 'Yellow' } else { 'Green' }
    Say ("{0,6:N1} s  answered initialize ({1} s is Claude Code's window)" -f $tInit, $window) $c
    if ($tools -and $tools.ContainsKey('result')) { Say ("{0,6:N1} s  listed {1} tools" -f $tTools, @($tools.result.tools).Count) }
    else { Say 'did not answer tools/list' 'Yellow'; $problems.Add('Serena answered initialize but not tools/list.') }
    if ($tInit -gt $Within) { $problems.Add(("Serena took {0:N1} s to answer, more than the {1} s this check allows inside Claude Code's {2}." -f $tInit, $Within, $window)) }
} else {
    $why = if ($proc.HasExited) { "it stopped with exit code $($proc.ExitCode)" } else { "nothing came in $Limit s" }
    Say ("never answered initialize: {0}" -f $why) 'Red'
    $problems.Add("Serena never answered initialize: $why.")
}

# Closing stdin is how an MCP client says goodbye; Serena stops its language
# servers and exits. Whatever is still running after that is stopped with its
# children, so the check leaves no process behind.
$proc.StandardInput.Close()
if (-not $proc.WaitForExit(15000)) { $proc.Kill($true); [void]$proc.WaitForExit(5000) }

# ------------------------------------------------------------ the parts -----

if ($Phases) {
    Head 'The parts of a start'
    if (-not $uv) {
        Say 'uv is not on PATH, so there are no uvx parts to time.' 'Yellow'
    } else {
        if ($route -eq 'uvx') {
            $uvx = Join-Path (Split-Path -Parent $uv.Source) ('uvx' + [IO.Path]::GetExtension($uv.Source))
            $runs = @(
                # --refresh asks the index again for every entry, which is what
                # a start does once the cached answers are ten minutes old.
                @{ What = 'uvx asking the index again';      Args = @('--refresh', '--from', $from, 'python', '-c', 'pass') },
                @{ What = 'uvx with the index, bare python'; Args = @('--from', $from, 'python', '-c', 'pass') },
                @{ What = 'uvx offline, bare python';        Args = @('--offline', '--from', $from, 'python', '-c', 'pass') },
                @{ What = 'uvx offline, import serena';      Args = @('--offline', '--from', $from, 'python', '-c', 'import serena.cli') }
            )
            foreach ($r in $runs) {
                $t = [Diagnostics.Stopwatch]::StartNew()
                $o = & $uvx @($r.Args) 2>&1
                $code = $LASTEXITCODE
                $t.Stop()
                $note = if ($code -ne 0) { "  (exit $code, $(@($o)[-1]))" } else { '' }
                Say ("{0,6:N1} s  {1}{2}" -f $t.Elapsed.TotalSeconds, $r.What, $note)
            }
        } elseif ($route -eq 'installed') {
            $py = @(Get-ChildItem -LiteralPath (Join-Path (& $uv.Source tool dir).Trim() 'serena-agent') -Recurse -File -Include 'python.exe', 'python' -ErrorAction SilentlyContinue | Select-Object -First 1)
            if ($py) {
                $t = [Diagnostics.Stopwatch]::StartNew()
                $o = & $py[0].FullName -c 'import serena.cli' 2>&1
                $t.Stop()
                Say ("{0,6:N1} s  installed program, import serena" -f $t.Elapsed.TotalSeconds)
            }
        }
        # Each environment uvx built, newest last. The first level is what was
        # asked for, the second what it resolved to: a new entry under the same
        # first level is a start that found the resolution changed and
        # installed every package again.
        $envs = Join-Path (& $uv.Source cache dir).Trim() 'environments-v2'
        if (Test-Path -LiteralPath $envs) {
            Head "Environments uvx has built ($envs)"
            Get-ChildItem -LiteralPath $envs -Directory | ForEach-Object {
                $top = $_.Name
                Get-ChildItem -LiteralPath $_.FullName -Force | ForEach-Object { [pscustomobject]@{ At = $_.CreationTime; Name = "$top\$($_.Name)" } }
            } | Sort-Object At | ForEach-Object { Say ("{0:yyyy-MM-dd h:mm tt}  {1}" -f $_.At, $_.Name) }
        }
    }
}

Head 'Result'
if ($problems.Count) {
    foreach ($p in $problems) { Say $p 'Red' }
    exit 1
}
Say ("Serena {0} starts from the installed program and answered in {1:N1} s." -f $Pin, $tInit) 'Green'
exit 0
