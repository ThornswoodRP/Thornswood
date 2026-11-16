<#
  test-4209-backup-counts-copies.ps1

      pwsh -NoProfile -File scripts/tests/test-4209-backup-counts-copies.ps1

  Issue #4209. Backup-Server.ps1's gather copied each file with its errors
  silenced and counted it either way, so a world file the server had locked
  was missing from the zip while "took ... N file(s)" counted it, and nothing
  said so.

  Part A runs the gather's own Grab, taken out of the script, against a
  scratch folder, with Copy-Item stood in so one file is refused the way
  Windows refuses a file another process has open:
    1. the count is the files really copied
    2. the file not copied is named, with why, on a NOT TAKEN line
    3. a single file that is refused is NOT TAKEN, not "took"
  Part B runs the whole script in a scratch copy, with the box, the run's
  folder and scp stood in, so nothing leaves this machine:
    4. a NOT TAKEN line from the box ends 1 and says the backup is missing
       files, after the zip is brought down
    5. a box with nothing NOT TAKEN ends 0
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$script = Join-Path (Join-Path (Join-Path $Repo 'scripts') 'vps') 'Backup-Server.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-4209-' + [Guid]::NewGuid().ToString('N'))
try {
    # ---- A: the gather's Grab -------------------------------------------------
    # The gather is an expandable here-string sent to the box; expanded here
    # as the script expands it, and its Grab defined from that text.
    $ast = [Management.Automation.Language.Parser]::ParseFile($script, [ref]$null, [ref]$null)
    $assign = $ast.Find({ param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and "$($n.Left)" -eq '$gather' }, $true)
    $name = 'thornswood-backup-test.zip'
    $gatherText = Invoke-Expression $assign.Right.Extent.Text
    $gAst = [Management.Automation.Language.Parser]::ParseInput($gatherText, [ref]$null, [ref]$null)
    $grabAst = $gAst.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Grab' }, $true)
    Yes 'the gather has its Grab' ($null -ne $grabAst)
    . ([scriptblock]::Create($grabAst.Extent.Text))

    $src = Join-Path $work 'src'
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $src 'changeForms')
    'a' | Set-Content -LiteralPath (Join-Path $src 'changeForms\1.json'.Replace('\', [IO.Path]::DirectorySeparatorChar))
    'b' | Set-Content -LiteralPath (Join-Path $src 'changeForms\2.json'.Replace('\', [IO.Path]::DirectorySeparatorChar))
    'c' | Set-Content -LiteralPath (Join-Path $src 'changeForms\locked.json'.Replace('\', [IO.Path]::DirectorySeparatorChar))
    $stage = Join-Path $work 'stage'
    $null = New-Item -ItemType Directory -Force -Path $stage

    # Windows' refusal of a file another process has open.
    function Copy-Item {
        [CmdletBinding()]
        param([Parameter(Position = 0)][string]$Path, [Parameter(Position = 1)][string]$Destination, [string]$LiteralPath, [switch]$Force)
        $from = $(if ($LiteralPath) { $LiteralPath } else { $Path })
        if ($from -like '*locked*') {
            $e = New-Object IO.IOException "The process cannot access the file '$from' because it is being used by another process."
            $PSCmdlet.WriteError((New-Object Management.Automation.ErrorRecord $e, 'Locked', 'ResourceBusy', $from))
            return
        }
        Microsoft.PowerShell.Management\Copy-Item -LiteralPath $from -Destination $Destination -Force
    }

    $said = @(Grab $src 'game\world' | ForEach-Object { "$_" })
    $took = @($said | Where-Object { $_ -like 'took*' })
    Yes "1. the count is the files really copied: $($took -join ' | ')" ($took.Count -eq 1 -and $took[0] -match '\b2 file\(s\)')
    $not = @($said | Where-Object { $_ -like 'NOT TAKEN*' })
    Yes "2. the file not copied is named, with why: $($not -join ' | ')" ($not.Count -eq 1 -and $not[0] -match 'locked\.json' -and $not[0] -match 'being used by another process')

    $one = Join-Path $src 'changeForms'
    $said = @(Grab (Join-Path $one 'locked.json') 'game\server-settings.json' | ForEach-Object { "$_" })
    Yes "3. a single file that is refused is NOT TAKEN, not took: $($said -join ' | ')" (@($said | Where-Object { $_ -like 'took*' }).Count -eq 0 -and @($said | Where-Object { $_ -like 'NOT TAKEN*' -and $_ -match 'being used' }).Count -eq 1)
    Remove-Item Function:\Copy-Item

    # ---- B: the whole script against a stand-in box -----------------------------
    $vps = Join-Path (Join-Path $work 'scripts') 'vps'
    $mods = Join-Path (Join-Path $work 'scripts') 'mods'
    $null = New-Item -ItemType Directory -Force -Path $vps, $mods
    Copy-Item -LiteralPath $script -Destination $vps
    Copy-Item -LiteralPath (Join-Path (Split-Path -Parent $script) 'Protect-BackupZip.ps1') -Destination $vps
    $utf8 = New-Object Text.UTF8Encoding $false
    [IO.File]::WriteAllText((Join-Path $vps 'Send-Script.ps1'), @'
function Get-ThornswoodVpsUser { 'x' }
function Get-ThornswoodVpsAddress { '127.0.0.1' }
function Invoke-ThornswoodRemote { param($Target, $SshArgs, $Script) @(($env:TS4209_SAYS -split '\|') | Where-Object { $_ }) }
function Invoke-ThornswoodNative($c) { & $c }
function scp { [IO.File]::WriteAllText([string]$args[-1], 'encrypted') }
'@, $utf8)
    [IO.File]::WriteAllText((Join-Path $mods 'OnBox.ps1'), @'
function Open-ThornswoodOnBoxFolder { param($Target, $SshArgs) [pscustomobject]@{ Said = @(); Made = $true; Run = 'C:\Windows\Temp\run'; Far = 'C:/Windows/Temp/run' } }
function Close-ThornswoodOnBoxFolder($box) { [pscustomobject]@{ Gone = $true; Told = $true; Said = @() } }
function Get-ThornswoodOnBoxHoldScript { param($Run) '' }
'@, $utf8)
    $pwsh = (Get-Process -Id $PID).Path
    function Run([string]$says) {
        $out = Join-Path $work ('out-' + [Guid]::NewGuid().ToString('N'))
        $env:TS4209_SAYS = $says
        try {
            $o = @(& $pwsh -NoProfile -File (Join-Path $vps 'Backup-Server.ps1') -NoPause -Out $out 2>&1 | ForEach-Object { "$_" })
            return [pscustomobject]@{ Code = $LASTEXITCODE; Said = ($o -join "`n"); Got = @(Get-ChildItem -LiteralPath $out -Filter *.enc -ErrorAction SilentlyContinue).Count }
        } finally { Remove-Item Env:TS4209_SAYS -ErrorAction SilentlyContinue }
    }
    $r = Run 'took      game\world   1422 file(s)|NOT TAKEN C:\Thornswood-Server\world\changeForms\3f.json   The process cannot access the file because it is being used by another process.|zip       2.1 MB, encrypted'
    Yes "4. a NOT TAKEN line ends 1 (exit $($r.Code)), after the zip is brought down ($($r.Got))" ($r.Code -eq 1 -and $r.Got -eq 1)
    Yes '   and says the backup is missing a file' ($r.Said -match '1 file\(s\) could not be copied on the server and are not in this backup')
    $r = Run 'took      game\world   1423 file(s)|zip       2.1 MB, encrypted'
    Yes "5. nothing NOT TAKEN ends 0 (exit $($r.Code))" ($r.Code -eq 0 -and $r.Got -eq 1 -and $r.Said -notmatch 'could not be copied')
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
