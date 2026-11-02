<#
  test-site-gone-public.ps1

      pwsh -NoProfile -File .\tests\test-site-gone-public.ps1

  A public file that leaves the repository leaves the site. On 17 Oct
  thornswood.net still served looks.js and looks.css after #2572 took the
  "Make the site yours" panel out, because Deploy-Docs sends only the public
  files that changed and nothing ever took one away.

  What this proves, with no box and no network:
    1. Deploy-Docs.ps1 names the public files (and the modules in lib) the
       box has and the repository does not, counts them as a change to the
       app, and hands them to the swap as $Gone.
    2. Swap.ps1's service swap block, run for real on a scratch root under
       PowerShell 7, as on the box: a healthy start takes the gone file out into the
       .prev folder and says so, and a start that does not answer puts it
       back with the old files.

  Everything it writes is in its own temp folder.
#>
$ErrorActionPreference = 'Stop'
$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = (Resolve-Path (Join-Path $Here '..')).Path
$docs = [IO.File]::ReadAllText((Join-Path $repo 'scripts\deploy\Deploy-Docs.ps1'))
$swap = [IO.File]::ReadAllText((Join-Path $repo 'scripts\deploy\Swap.ps1'))

# ---- 1. Deploy-Docs ------------------------------------------------------------
Write-Host 'Deploy-Docs.ps1'
Yes 'it names the top level public files the box has and the repository does not' (
    $docs.Contains('$gonePublic = @($publicThere.Keys | Where-Object { $repoPublic -notcontains $_ }'))
Yes 'it names the modules in lib the box has and the repository does not (#5357)' (
    $docs.Contains('$goneLib = @($libThere.Keys | Where-Object { $repoLib -notcontains $_ }'))
Yes 'and takes out both' $docs.Contains('$gone = @(@($goneLib) + @($gonePublic))')
Yes 'a gone file is a change to the app, so the swap runs' $docs.Contains('$appUnchanged = ($send.Count -eq 0 -and $gone.Count -eq 0)')
# The line ends as the checkout ends it: CRLF on a Windows runner, LF elsewhere.
Yes 'and the swap is told them as $Gone, empty for -PutBack' ($docs.Contains("('`$Gone = @(' +") -and $docs -match '(?m)^\s*\$gone = @\(\)\r?$')

# ---- 2. the swap block, run ------------------------------------------------------
Write-Host ''
Write-Host 'Swap.ps1, the service swap block'
# The box runs the block under PowerShell 7 since #5356, and so does this.
. (Join-Path $PSScriptRoot 'Windows.ps1')
$boxPs = Get-BoxPowerShell
$tmpRoot = if ($env:TEST_TMP) { $env:TEST_TMP } else { [IO.Path]::GetTempPath() }
$work = Join-Path $tmpRoot ('ts-site-gone-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work | Out-Null
try {
    $marker = "`$serviceSwapBlock = @'"
    $start = $swap.IndexOf($marker)
    if ($start -lt 0) { throw 'service swap block not found' }
    $start = $swap.IndexOf("`n", $start) + 1
    $end = $swap.IndexOf("`n'@", $start)
    if ($end -lt 0) { throw 'service swap block did not end' }
    $blockPath = Join-Path $work 'swap-block.ps1'
    # With StopAndMove.ps1 in front, as Swap.ps1 puts it (#2928).
    $stopAndMove = [IO.File]::ReadAllText((Join-Path $repo 'scripts\deploy\StopAndMove.ps1'))
    [IO.File]::WriteAllText($blockPath, $stopAndMove + "`r`n" + $swap.Substring($start, $end - $start))

    function Run([string]$name, [bool]$healthy) {
        $root = Join-Path $work $name
        New-Item -ItemType Directory -Force -Path (Join-Path $root 'public'), (Join-Path $root '.stage-test\public') | Out-Null
        [IO.File]::WriteAllText((Join-Path $root 'public\keep.js'), 'old keep')
        [IO.File]::WriteAllText((Join-Path $root 'public\looks.js'), 'the panel')
        [IO.File]::WriteAllText((Join-Path $root '.stage-test\public\keep.js'), 'new keep')
        $answer = if ($healthy) { '$true' } else { '$false' }
        $lines = @(
            '$ErrorActionPreference = ''Continue'''
            ('$Root = ''' + $root.Replace("'", "''") + '''')
            '$Stage = ''.stage-test'''
            '$Prev = ''.prev-test'''
            '$Wait = 1'
            '$KeepStage = $false'
            '$Want = [ordered]@{}'
            '$Want[''public/keep.js''] = ''unused'''
            '$Parse = @()'
            '$Gone = @(''public/looks.js'', ''public/never-there.css'')'
            'function StopIt { ''stopped'' }'
            'function StartIt { }'
            ('function Healthy { return ' + $answer + ' }')
            'function Answer { ''it answers'' }'
            'function Why { ''it did not answer'' }'
            (". '" + $blockPath.Replace("'", "''") + "'")
        )
        $child = Join-Path $work ($name + '.ps1')
        [IO.File]::WriteAllText($child, ($lines -join "`r`n"))
        $said = (& $boxPs -NoProfile -ExecutionPolicy Bypass -File $child 2>&1 | ForEach-Object { "$_" }) -join "`n"
        $keep = Join-Path $root 'public\keep.js'
        return [pscustomobject]@{
            Said = $said
            Looks = Test-Path -LiteralPath (Join-Path $root 'public\looks.js')
            LooksAside = Test-Path -LiteralPath (Join-Path $root '.prev-test\public\looks.js')
            Keep = if (Test-Path -LiteralPath $keep) { [IO.File]::ReadAllText($keep) } else { '' }
        }
    }

    $ok = Run 'healthy' $true
    Yes 'a start that answers: SWAP OK, with the changed file in place' ($ok.Said -match 'SWAP OK' -and $ok.Keep -eq 'new keep')
    Yes 'the file the deploy no longer has is out of public and in the .prev folder' (-not $ok.Looks -and $ok.LooksAside)
    Yes 'it says what it took out, and only what was there' ($ok.Said -match 'took out 1 file\(s\) this deploy no longer has' -and $ok.Said -match 'public/looks\.js' -and $ok.Said -notmatch 'never-there')

    $bad = Run 'unhealthy' $false
    Yes 'a start that does not answer rolls back' ($bad.Said -match 'SWAP ROLLED BACK')
    Yes 'and puts the gone file back beside the old files' ($bad.Looks -and $bad.Keep -eq 'old keep')
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -EA SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
