<#
  test-2909-door-whole-write.ps1

      pwsh -NoProfile -File .\tests\test-2909-door-whole-write.ps1

  Issue #2909, the first of its three. Set-Door.ps1 -Enforce and -Watch read
  allowed.json, set enforce, and wrote the list back IN PLACE with
  [IO.File]::WriteAllText: the file cut to nothing, then filled. The gamemode
  reads that list whenever the door asks, and writes it whole every five
  minutes with mp.writeFileWhole, a POSIX rename (#2740). So a read beside the
  flip could find the list empty or cut short, and WriteAllText's handle,
  which does not share delete, refused the gamemode's rename while it was
  open. Now the flip writes a new file beside the list and puts it over the
  list with the same POSIX rename (Feed-Store.ps1's Move-FeedStoreInto).

  WHAT IT HOLDS IT TO.
    1. The flip writes no WriteAllText to the list itself, writes a file
       beside it, and puts it over the list with Move-FeedStoreInto, which
       it sends up with the script.
    2. In PowerShell 7 (the box runs it with that since #5356), the script
       the flip sends, run against a list in a temp folder:
       enforce is set, every profile is kept, nothing is left beside it, and
       a reader that opened the list before the flip, sharing ReadWrite and
       Delete as the gamemode's node does, still reads the old list whole.

  -Repo runs it against another checkout's scripts (main before #2909 fails
  1 and 2). Nothing outside its own temp folder is written.
#>
[CmdletBinding()]
param([string]$Repo)

$ErrorActionPreference = 'Stop'
if (-not $Repo) { $Repo = Split-Path -Parent $PSScriptRoot }

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
function Text([string]$p) { return ([IO.File]::ReadAllText($p) -replace "`r`n", "`n") }

# ---- 1: what the flip sends ------------------------------------------------------
$door = Text (Join-Path $Repo 'scripts\ops\Set-Door.ps1')
# To the closing brace before the next section's rule: the script it sends
# has braces at the start of its lines too.
$flip = [regex]::Match($door, '(?s)\nif \(\$Enforce -or \$Watch\) \{.*?\n\}\n\n# -').Value
$sent = [regex]::Match($flip, '(?s)Remote (?:\(\$script:FeedStoreSwap \+ "`n" \+ )?@"\n(.*?)\n"@').Groups[1].Value
Yes 'Set-Door: the flip and the script it sends are there' ($flip.Length -gt 0 -and $sent.Length -gt 0)
Yes '...it never writes the list in place' ($sent -notmatch 'WriteAllText\(`\$f\b')
Yes '...it writes a new file beside the list and puts it over the list with Move-FeedStoreInto' (
    $sent -match 'WriteAllText\(`\$part\b' -and $sent -match 'Move-FeedStoreInto `\$part `\$f')
Yes '...and sends Move-FeedStoreInto up with it, from Feed-Store.ps1' (
    $flip -match 'Remote \(\$script:FeedStoreSwap \+' -and $door -match "\. \(Join-Path \`$Here '\.\.\\release\\Feed-Store\.ps1'\)")
Yes '...and stops when the list could not be put back' ($flip -match "-match '[^']*THE LIST WAS NOT WRITTEN")

# ---- 2: the script the flip sends, run --------------------------------------------
$storePs1 = Join-Path $Repo 'scripts\release\Feed-Store.ps1'
if (-not $sent -or -not (Test-Path -LiteralPath $storePs1)) { Done }
. (Join-Path $PSScriptRoot 'Windows.ps1')

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-2909-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $work
try {
    $old = '{"enforce":false,"profiles":[11,22,33],"people":[{"name":"Hulda","profiles":[11]}],"at":"2026-10-22T10:00:00Z"}'
    $held = Join-Path $work 'held.ps1'
    [IO.File]::WriteAllText($held, @'
param($store, $root, $body)
$ErrorActionPreference = 'Stop'
. $store
$f = Join-Path $root 'private\allowed.json'
$h = New-Object IO.FileStream($f, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
$said = @(& $body 2>&1 | ForEach-Object { [string]$_ })
$r = New-Object IO.StreamReader($h); $was = $r.ReadToEnd(); $r.Dispose()
'SAID ' + ($said -join ' / ')
'HELD ' + $was
'@)
    $shells = @(@{ Name = 'the box''s PowerShell 7'; Exe = (Get-BoxPowerShell) })
    foreach ($sh in $shells) {
        $root = Join-Path $work ($sh.Name -replace '\W', '')
        $priv = Join-Path $root 'private'
        $null = New-Item -ItemType Directory -Force -Path $priv
        [IO.File]::WriteAllText((Join-Path $priv 'allowed.json'), $old)
        # The here-string as Set-Door fills it in, for -Enforce on this root.
        $want = 'true'
        $body = Join-Path $root 'body.ps1'
        [IO.File]::WriteAllText($body, $ExecutionContext.InvokeCommand.ExpandString($sent))
        $out = @(& $sh.Exe -NoProfile -ExecutionPolicy Bypass -File $held $storePs1 $root $body 2>&1 | ForEach-Object { [string]$_ })
        $said = ([string](@($out | Where-Object { $_ -like 'SAID *' }) | Select-Object -First 1))
        $was = ([string](@($out | Where-Object { $_ -like 'HELD *' }) | Select-Object -First 1))
        $now = $null
        try { $now = [IO.File]::ReadAllText((Join-Path $priv 'allowed.json')) | ConvertFrom-Json } catch { $now = $null }
        $left = @(Get-ChildItem -LiteralPath $priv -Force | Where-Object { $_.Name -ne 'allowed.json' })
        Yes ("{0}: the flip says the door is on with three profiles ({1})" -f $sh.Name, $(if ($said) { $said } else { $out -join ' / ' })) (
            $said -match 'enforce is now true, with 3 profiles on the list')
        Yes ("{0}: the list now has enforce true and every profile and person kept" -f $sh.Name) (
            $null -ne $now -and $now.enforce -eq $true -and (@($now.profiles) -join ',') -eq '11,22,33' -and @($now.people)[0].name -eq 'Hulda')
        Yes ("{0}: nothing is left beside the list ({1})" -f $sh.Name, (($left | ForEach-Object { $_.Name }) -join ', ')) ($left.Count -eq 0)
        Yes ("{0}: a reader that held the list before the flip reads the old list whole ({1})" -f $sh.Name, $was) ($was -eq ('HELD ' + $old))
    }
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
Done
