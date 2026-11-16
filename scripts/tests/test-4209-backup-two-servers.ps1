<#
  test-4209-backup-two-servers.ps1

      pwsh -NoProfile -File scripts/tests/test-4209-backup-two-servers.ps1

  Issue #4209. Backup-Server.ps1 took every folder on C:\ with a
  server-settings.json in it, four levels down, as a game server, and named
  them game, game-2, game-3 in the order it found them. So the kept copies a
  server install leaves (Thornswood-Server.prev-<stamp>) and a restore
  rehearsal's folder went into the zip too, and any of them could be the one
  labelled game. Restore-Server.ps1 and the nightly know the two servers as
  game (C:\Thornswood-Server) and game-dev (C:\Thornswood-Server-Dev).

  The gather's server part is taken out of the real script, with C:\ turned
  into a scratch drive holding the live and dev servers, a kept copy and a
  rehearsal folder, and its Grab stood in to say what it was asked to take:
    1. the live server is taken, as game
    2. the dev server is taken, as game-dev
    3. nothing else is: not the kept copy, not the rehearsal
    4. a box with no dev server says it is missing and takes the live one
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

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-4209s-' + [Guid]::NewGuid().ToString('N'))
try {
    # The gather is an expandable here-string sent to the box; expanded here
    # as the script expands it.
    $ast = [Management.Automation.Language.Parser]::ParseFile($script, [ref]$null, [ref]$null)
    $assign = $ast.Find({ param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and "$($n.Left)" -eq '$gather' }, $true)
    $name = 'thornswood-backup-test.zip'
    $gatherText = Invoke-Expression $assign.Right.Extent.Text
    $startMark = "Grab 'C:\Thornswood-Voice' 'voice'"
    $endMark = '# Whatever is terminating TLS'
    $from = $gatherText.IndexOf($startMark)
    $to = $gatherText.IndexOf($endMark)
    Yes 'the gather has its game server part, after the voice folder and before the web server' ($from -gt 0 -and $to -gt $from)
    if ($from -le 0 -or $to -le $from) { throw 'the game server part was not found' }
    $part = $gatherText.Substring($from + $startMark.Length, $to - $from - $startMark.Length)

    function Run([string[]]$folders) {
        $drive = Join-Path $work ('c-' + [Guid]::NewGuid().ToString('N'))
        foreach ($f in $folders) {
            $d = Join-Path $drive $f
            $null = New-Item -ItemType Directory -Force -Path (Join-Path $d 'world')
            '{}' | Set-Content -LiteralPath (Join-Path $d 'server-settings.json')
        }
        $text = $part.Replace("'C:\", "'" + $drive + [IO.Path]::DirectorySeparatorChar)
        $script:asked = New-Object System.Collections.ArrayList
        function Grab($from, $asName) { [void]$script:asked.Add([pscustomobject]@{ From = [string]$from; As = [string]$asName }) }
        $said = @(. ([scriptblock]::Create($text)) | ForEach-Object { "$_" })
        return [pscustomobject]@{ Drive = $drive; Said = $said; Asked = @($script:asked) }
    }
    function Under($r, [string]$folder) { @($r.Asked | Where-Object { $_.From.StartsWith((Join-Path $r.Drive $folder) + [IO.Path]::DirectorySeparatorChar) }) }
    function AsTag($r, [string]$tag) { @($r.Asked | Where-Object { $_.As -like ($tag + '\*') }) }

    $r = Run @('Thornswood-Server', 'Thornswood-Server-Dev', 'Thornswood-Server.prev-20261012-103440', 'Thornswood-Rehearse\live')
    $live = Under $r 'Thornswood-Server'
    Yes "1. the live server is taken, as game ($(($live | ForEach-Object { $_.As }) -join ', '))" ($live.Count -ge 2 -and @($live | Where-Object { $_.As -notlike 'game\*' }).Count -eq 0)
    $dev = Under $r 'Thornswood-Server-Dev'
    Yes "2. the dev server is taken, as game-dev ($(($dev | ForEach-Object { $_.As }) -join ', '))" ($dev.Count -ge 2 -and @($dev | Where-Object { $_.As -notlike 'game-dev\*' }).Count -eq 0)
    $stray = @($r.Asked | Where-Object { $_.From -like '*Thornswood-Server.prev-*' -or $_.From -like '*Thornswood-Rehearse*' })
    Yes "3. nothing else is taken: not the kept copy, not the rehearsal ($(($stray | ForEach-Object { $_.From }) -join ', '))" ($stray.Count -eq 0 -and $r.Asked.Count -eq ($live.Count + $dev.Count))
    Yes '   and only game and game-dev are written' (@($r.Asked | Where-Object { $_.As -notlike 'game\*' -and $_.As -notlike 'game-dev\*' }).Count -eq 0)

    $r = Run @('Thornswood-Server', 'Thornswood-Server.prev-20261012-103440')
    Yes "4. no dev server: it says so ($(($r.Said | Where-Object { $_ -like 'missing*' }) -join ' | '))" (@($r.Said | Where-Object { $_ -like 'missing*' -and $_ -match 'game-dev' }).Count -eq 1)
    Yes '   and still takes the live one, as game, and not the kept copy' ((Under $r 'Thornswood-Server').Count -ge 2 -and (AsTag $r 'game').Count -eq $r.Asked.Count -and @($r.Asked | Where-Object { $_.From -like '*.prev-*' }).Count -eq 0)
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
