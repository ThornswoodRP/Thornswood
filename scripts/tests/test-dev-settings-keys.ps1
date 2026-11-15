<#
  test-dev-settings-keys.ps1

  Deploy-DevGamemode never swaps in a copy of the dev settings that went stale
  while it counted down.

  WHY THIS EXISTS. Issue #1224. Deploy-DevGamemode copies the dev server's
  server-settings.json into its stage, edits the copy there, warns whoever is
  on, waits out the countdown, and swaps the copy in. Anything that changed
  the running settings in that minute (a second run, Publish-Server -Channel
  dev, a hand edit) was overwritten by the older copy, and nothing said so.
  Deploy-Server had the same hole and #1222 closed it with a read-back in
  Swap.ps1: given the keys a release means to change ($ReleaseKeys), the swap
  compares every other key of the file it is about to start with the one the
  server had, and puts the old files back when one moved.

  So this checks two things:

    1. Deploy-DevGamemode's $DevSettingsKeys is exactly the set of keys its
       edit block writes, read out of the script, so a new edit cannot leave
       the read-back calling its own change drift, and a stale entry cannot
       let a key nobody edits through unread. And the swap is handed that list
       on a deploy and nothing on a -PutBack.
    2. Swap.ps1's real read-back, lifted out of $swapBlock and run over two
       folders here with that list: the keys the deploy edits pass, and a key
       changed on the running file between the stage and the swap stops the
       swap and is named.

  Read only, apart from two folders under the temp directory.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)

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

# ---- 1. the list and the edits ------------------------------------------------
$devPath = Join-Path $Repo (Join-Path 'scripts' (Join-Path 'deploy' 'Deploy-DevGamemode.ps1'))
$text = [IO.File]::ReadAllText($devPath)
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$tokens, [ref]$errors)
Yes 'Deploy-DevGamemode.ps1 parses' (@($errors).Count -eq 0)

$assign = $ast.Find({
    param($n)
    $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and
    $n.Left -is [System.Management.Automation.Language.VariableExpressionAst] -and
    $n.Left.VariablePath.UserPath -eq 'DevSettingsKeys'
}, $true)
Yes 'it names the keys its edits may change, as $DevSettingsKeys' ($null -ne $assign)
if ($null -eq $assign) { Done }
$listed = @($assign.Right.FindAll({ param($n) $n -is [System.Management.Automation.Language.StringConstantExpressionAst] }, $true) |
            ForEach-Object { $_.Value })

# What the edit block writes. It is a here-string sent to the box, so its
# lines are read as text: every key it sets with Add-Member, and npcSettings,
# which it edits by taking a key out of it.
$written = @([regex]::Matches($text, '-NotePropertyName\s+(\w+)') | ForEach-Object { $_.Groups[1].Value })
if ($text -match '\.npcSettings\.PSObject\.Properties\.Remove\(') { $written += 'npcSettings' }
$written = @($written | Sort-Object -Unique)
Yes ('the edit block writes keys this can read ({0})' -f $written.Count) ($written.Count -ge 10)

$notListed = @($written | Where-Object { $listed -notcontains $_ })
$notWritten = @($listed | Where-Object { $written -notcontains $_ })
Yes ('every key the edit block writes is on the list' + $(if ($notListed.Count) { ' (not: ' + ($notListed -join ', ') + ')' } else { '' })) ($notListed.Count -eq 0)
Yes ('and nothing on the list is a key it never writes' + $(if ($notWritten.Count) { ' (' + ($notWritten -join ', ') + ')' } else { '' })) ($notWritten.Count -eq 0)

# A deploy's swap, not the put-back after a reload that did not take (#3196).
Yes 'the swap is handed the list on a deploy and nothing on a put-back' (
    ($text -match '(?m)^\s*\$readBackKeys = \$null\s*$') -and
    ($text -match '(?m)^\s*if \(-not \$PutBack -and \$outcome -eq ''swap''\) \{ \$readBackKeys = \$DevSettingsKeys \}\s*$') -and
    ($text -match 'SwapVars \$Root \$Task \$stageName \$prevName \$Wait \$hashes \$readBackKeys\)'))

# ---- 2. the read-back itself, over two folders ---------------------------------
$swapPath = Join-Path $Repo (Join-Path 'scripts' (Join-Path 'deploy' 'Swap.ps1'))
$swap = [IO.File]::ReadAllText($swapPath)
$a = $swap.IndexOf('# READ BACK, BEFORE ANYTHING STARTS')
$b = if ($a -ge 0) { $swap.IndexOf("`nif (`$moved) {", $a) } else { -1 }
Yes 'Swap.ps1 still has the read-back #1222 put before the start' ($a -ge 0 -and $b -gt $a)
if (-not ($a -ge 0 -and $b -gt $a)) { Done }
$readBack = $swap.Substring($a, $b - $a)

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-dev-keys-' + [Guid]::NewGuid().ToString('N'))
$Root = Join-Path $work 'root'
$prevDir = Join-Path $work 'prev'
New-Item -ItemType Directory -Force -Path $Root, $prevDir | Out-Null

# The settings the dev server had, and the same file with this deploy's edits.
$running = [ordered]@{
    port = 7787; name = 'Thornswood dev'; thornswoodVoicePort = 7778
    equipmentInventoryCheckEnabled = $true; npcEnabled = $false
    thornswoodChatRange = 'on'; loadOrder = @('Skyrim.esm', 'Update.esm')
}
function Write-Settings([string]$dir, $obj) {
    [IO.File]::WriteAllText((Join-Path $dir 'server-settings.json'), ($obj | ConvertTo-Json -Depth 10))
}
# The read-back as Swap.ps1 runs it, with the variables the swap has by then:
# the settings file placed, nothing failed yet, and the keys handed over.
function Run-ReadBack {
    $said = @(& ([scriptblock]::Create('param($moved, $placed, $ReleaseKeys, $prevDir, $Root) ' + $readBack + "`n" + '[pscustomobject]@{ Moved = $moved }')) $true @('server-settings.json') $DevKeys $prevDir $Root)
    $result = @($said | Where-Object { $_ -is [pscustomobject] })[-1]
    $lines = @($said | Where-Object { $_ -is [string] })
    return [pscustomobject]@{ Moved = $result.Moved; Said = ($lines -join "`n") }
}
$DevKeys = $listed
try {
    # The deploy's own edits and nothing else: the swap goes ahead.
    $edited = [ordered]@{}
    foreach ($k in $running.Keys) { $edited[$k] = $running[$k] }
    $edited.thornswoodVoicePort = 7789
    $edited.equipmentInventoryCheckEnabled = $false
    $edited.npcEnabled = $true
    Write-Settings $prevDir $running
    Write-Settings $Root $edited
    $r = Run-ReadBack
    Yes 'the keys the deploy edits pass the read-back, and the swap goes ahead' ($r.Moved -and $r.Said -match 'every setting outside this release is the one the server had')

    # The running file changed between the stage and the swap: the chat range
    # was turned off by hand. The staged copy still says on.
    $changed = [ordered]@{}
    foreach ($k in $running.Keys) { $changed[$k] = $running[$k] }
    $changed.thornswoodChatRange = 'off'
    Write-Settings $prevDir $changed
    Write-Settings $Root $edited
    $r = Run-ReadBack
    Yes 'a key changed on the running file meanwhile stops the swap' (-not $r.Moved)
    Yes '  and is named, with nothing started' ($r.Said -match 'read back: thornswoodChatRange would not be what the server had, so nothing is started')

    # And with no list, as before this, the same change would have gone through
    # unread: the read-back only runs when it is given the keys.
    $DevKeys = $null
    $r = Run-ReadBack
    Yes 'with no keys handed over there is no read-back at all, which is the hole #1224 found' ($r.Moved -and -not $r.Said)
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Done
