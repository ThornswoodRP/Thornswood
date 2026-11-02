# test-docs-public.ps1
#
# Deploy-Docs.ps1 sends a public file only when it differs from the copy on
# the VPS. On 25 September -Site and -Docs known both stopped with
# "scp.exe: dest open C:/Thornswood-Docs/public/banner.mp4: Failure", a file
# that had not changed since #91, and the throw left the public pages and the
# restart undone. Every file had gone up every time.
#
# This lifts the real lines out of Deploy-Docs, from the hash listing to the
# count it prints, and runs them with Remote standing in for ssh (the script
# it would send runs in PowerShell 7, the shell the box runs it in) and Push
# standing in for scp (a copy into a scratch folder that refuses the file
# marked as held).
# It touches nothing outside that scratch folder.
#
#   pwsh -File tests\test-docs-public.ps1                 the repo's copy
#   pwsh -File tests\test-docs-public.ps1 -Path <file>    any other copy
param([string]$Path)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$here = Split-Path -Parent $here
if (-not $Path) { $Path = Join-Path $here 'scripts\deploy\Deploy-Docs.ps1' }

$pass = 0; $fail = 0
function yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host ('PASS  ' + $what) }
    else { $script:fail++; Write-Host ('FAIL  ' + $what) }
}

$text = [IO.File]::ReadAllText($Path)
$start = $text.IndexOf('$publicThere = @{}')
$endMark = "public file(s) already the same up there, not sent')"
$end = $text.IndexOf($endMark)
yes 'Deploy-Docs.ps1 lists what is already up there before it sends public\' ($start -ge 0 -and $end -gt $start)
if ($start -lt 0 -or $end -le $start) {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $pass, $fail)
    exit 1
}
$lines = $text.Substring($start, $end + $endMark.Length - $start)

. (Join-Path $PSScriptRoot 'Windows.ps1')
# The far side runs in PowerShell 7, as on the box since #5356.
$shell = Get-BoxPowerShell

$scratch = Join-Path ([System.IO.Path]::GetTempPath()) ('ts-docs-public-' + [guid]::NewGuid().ToString('N'))
try {
    $App = Join-Path $scratch 'repo'
    $rootWin = Join-Path $scratch 'vps'
    $Root = $rootWin
    # Since issue #446 what differs goes into the stage and is listed in $send
    # for the box to hash. The stage here is the scratch folder itself, so the
    # files still land where this reads them back.
    $stageFar = $rootWin
    $send = [ordered]@{}
    New-Item -ItemType Directory -Force -Path (Join-Path $App 'public'), (Join-Path $rootWin 'public') | Out-Null
    function put([string]$p, [string]$s) { [IO.File]::WriteAllText($p, $s) }
    # The same in both places, as banner.mp4 was.
    put (Join-Path $App 'public\banner.mp4') 'the painting, moving'
    put (Join-Path $rootWin 'public\banner.mp4') 'the painting, moving'
    put (Join-Path $App 'public\fonts.css') 'same'
    put (Join-Path $rootWin 'public\fonts.css') 'same'
    # Changed here, and new here.
    put (Join-Path $App 'public\home.html') 'home, new'
    put (Join-Path $rootWin 'public\home.html') 'home, old'
    put (Join-Path $App 'public\robots.txt') 'new file'

    $script:held = 'banner.mp4'
    $script:pushed = @()
    function Remote($s) {
        # The VPS is Windows; off Windows the one path in it needs the other slash.
        if ([IO.Path]::DirectorySeparatorChar -ne '\') { $s = $s.Replace('\', '/') }
        return & $shell -NoProfile -NonInteractive -Command $s 2>&1
    }
    function Push($local, $remote) {
        $name = Split-Path -Leaf $local
        if ($name -eq $script:held) { throw "scp failed: $local" }
        Copy-Item -LiteralPath $local -Destination $remote -Force
        $script:pushed += $name
    }

    $threw = $null
    $said = @()
    try { $said = & ([ScriptBlock]::Create($lines)) 6>&1 | ForEach-Object { "$_" } } catch { $threw = $_.Exception.Message }
    Write-Host ('      it said: ' + (($said -join ' / ').Trim()))

    yes 'a file that is the same up there is not sent, so one held open there does not stop the deploy' (-not $threw)
    yes 'a file that changed is sent' ($script:pushed -contains 'home.html' -and
        [IO.File]::ReadAllText((Join-Path $rootWin 'public\home.html')) -eq 'home, new')
    yes 'a file that is not up there yet is sent' ($script:pushed -contains 'robots.txt')
    yes 'the other unchanged file is not sent either' ($script:pushed -notcontains 'fonts.css')
    yes 'and it counts the two it left alone' ((($said -join ' ') -match '2 public file\(s\) already the same'))

    # A file that differs and cannot be written still stops it, and says which.
    put (Join-Path $App 'public\banner.mp4') 'the painting, recut'
    $script:pushed = @()
    $threw = $null
    try { & ([ScriptBlock]::Create($lines)) 6>&1 | Out-Null } catch { $threw = $_.Exception.Message }
    yes 'a changed file that cannot be written still stops the deploy and names the file' ($threw -match 'banner\.mp4')

    # Nothing to compare against: the listing up there fails or is empty.
    Remove-Item -LiteralPath (Join-Path $rootWin 'public') -Recurse -Force
    New-Item -ItemType Directory -Force -Path (Join-Path $rootWin 'public') | Out-Null
    $script:held = ''
    $script:pushed = @()
    & ([ScriptBlock]::Create($lines)) 6>&1 | Out-Null
    yes 'with nothing up there, everything goes' ($script:pushed.Count -eq 4)
} finally {
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $pass, $fail)
if ($fail) { exit 1 }
exit 0
