<#
  test-vps-folders-on-create.ps1

      pwsh -NoProfile -File .\tests\test-vps-folders-on-create.ps1

  The scripts that make the VPS service folders lock them as they make them,
  with the rules Lock-VpsFolders.ps1 applies (follow-up to #1183 and #1691),
  through the one helper, scripts\vps\Lock-Folder.ps1. Offline, against
  stand-in folders under %TEMP% whose parent hands Users a rule the way C:\
  does, with the real Get-Acl and Set-Acl, read back:
    - each creator (Watch-Services -Install and -SetWebhook, Watch-Load,
      Setup-Domain, Artifact, Swap) sends the helper's text for its folder and
      no bare New-Item for it any more; that text, run in PowerShell 7 for
      the creator's own variable, leaves the folder locked
    - Send-ThornswoodArtifact's real text, with the far side stood in, locks
      a new store
    - a folder that is already there is left as it is
    - the helper leaves exactly the rules Lock-VpsFolders.ps1 leaves
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = (Resolve-Path (Join-Path $Here '..')).Path
$helper = Join-Path $repo 'scripts\vps\Lock-Folder.ps1'
$lockBox = Join-Path $repo 'scripts\vps\Lock-VpsFolders.ps1'
. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) { Write-Host 'NOT RUN  each folder is made with its rights already set, a Windows ACL, which only Windows has'; exit 0 }
$boxPs = Get-BoxPowerShell
. $helper

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
$broadSids = @('S-1-5-32-545', 'S-1-1-0', 'S-1-5-11', 'S-1-3-0')
$runner = 'S-1-5-21-1-2-3-1001'
$me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$keep = @('S-1-5-18', 'S-1-5-32-544', $me)
function All([string]$p) { return @((Get-Acl -LiteralPath $p).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) }
function Broad([string]$p) { return @(All $p | Where-Object { $broadSids -contains $_.IdentityReference.Value }).Count }
function Locked([string]$p) {
    $acl = Get-Acl -LiteralPath $p
    if (-not $acl.AreAccessRulesProtected) { return $false }
    if ((Broad $p) -gt 0) { return $false }
    foreach ($k in $keep) {
        if (-not @(All $p | Where-Object { $_.IdentityReference.Value -eq $k -and ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl }).Count) { return $false }
    }
    return $true
}
function Grant([string]$p, [string]$sid, [string]$type = 'Allow') {
    $acl = Get-Acl -LiteralPath $p
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)), 'ReadAndExecute', 'ContainerInherit, ObjectInherit', 'None', $type)))
    Set-Acl -LiteralPath $p -AclObject $acl
}
function Run51([string]$text) {
    $f = Join-Path ([IO.Path]::GetTempPath()) ('tw-oncreate-' + [guid]::NewGuid().ToString('N') + '.ps1')
    [IO.File]::WriteAllText($f, $text, (New-Object Text.UTF8Encoding($true)))
    try { return @(& $boxPs -NoProfile -ExecutionPolicy Bypass -File $f 2>&1 | ForEach-Object { "$_" }) } finally { Remove-Item -LiteralPath $f -Force -EA SilentlyContinue }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tw-oncreate-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Path $tmp
try {
    # Like C:\: Users may read and make things in whatever is made under it.
    Grant $tmp 'S-1-5-32-545'
    $c = $tmp

    # ---- each creator sends the helper's text for its own folder
    $creators = @(
        @{ F = 'scripts\vps\Watch-Services.ps1';  V = 'Root';     N = 2; Name = 'Thornswood-Watch';   Old = "New-Item -ItemType Directory -Path '`$Root'" },
        @{ F = 'scripts\vps\Watch-Load.ps1';      V = 'Root';     N = 1; Name = 'Thornswood-Watch';   Old = "New-Item -ItemType Directory -Path '`$Root'" },
        @{ F = 'scripts\deploy\Setup-Domain.ps1'; V = 'caddyWin'; N = 1; Name = 'Thornswood-Caddy';   Old = 'New-Item -ItemType Directory -Path `$dir' },
        @{ F = 'scripts\deploy\Artifact.ps1';     V = 'store';    N = 1; Name = 'Thornswood-Deploys'; Old = '' },
        @{ F = 'scripts\deploy\Swap.ps1';         V = 'storeWin'; N = 1; Name = 'Thornswood-Deploys'; Old = '' }
    )
    foreach ($k in $creators) {
        $path = Join-Path $repo $k.F
        $src = [IO.File]::ReadAllText($path)
        $ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$null)
        $calls = @($ast.FindAll({ param($n) $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Get-ThornswoodLockedFolderScript' }, $true))
        $mine = @($calls | Where-Object { $_.CommandElements[1].Extent.Text -match ('^\$' + $k.V + '\b') })
        $inHere = @($mine | Where-Object { $p = $_.Parent; while ($p -and $p -isnot [Management.Automation.Language.ExpandableStringExpressionAst]) { $p = $p.Parent }; $null -ne $p })
        Yes ($k.F + ': sends the helper for $' + $k.V + ' ' + $k.N + ' time(s), inside the script for the box') ($inHere.Count -eq $k.N)
        Yes ($k.F + ': dot-sources Lock-Folder.ps1') ($src -match "Lock-Folder\.ps1'\)")
        if ($k.Old) { Yes ($k.F + ': no bare New-Item for that folder any more') ($src.IndexOf($k.Old) -lt 0) }

        # The creator's own argument text, run for a stand-in in place of the box's folder.
        $stand = Join-Path $c ($k.Name + '-' + ($k.F -replace '[\\.]', '_'))
        Set-Variable -Name $k.V -Value $stand
        $arg = $mine[0].CommandElements[1].Extent.Text
        $text = Get-ThornswoodLockedFolderScript -Path ([string](Invoke-Expression $arg))
        $out = Run51 $text
        Yes ('  run for a stand-in ' + $k.Name + ': it is made') (Test-Path -LiteralPath $stand)
        Yes '  and locked: takes nothing from above, SYSTEM, Administrators and this account Full Control, no Users rule' (Locked $stand)
        Yes '  and says so' (@($out | Where-Object { $_ -like 'locked *' }).Count -eq 1)
        [IO.File]::WriteAllText((Join-Path $stand 'later.txt'), 'x')
        Yes '  and a file made in it later takes no Users rule' ((Broad (Join-Path $stand 'later.txt')) -eq 0)
    }

    # ---- Send-ThornswoodArtifact's real text, with the far side stood in
    $store = Join-Path $c 'Thornswood-Deploys'
    $sent = Run51 @"
`$ErrorActionPreference = 'Stop'
. '$($repo.Replace("'", "''"))\scripts\deploy\Artifact.ps1'
function Invoke-ThornswoodArtifactRemote(`$t, `$s, `$text) { `$f = Join-Path `$env:TEMP ('tw-art-' + [guid]::NewGuid().ToString('N') + '.ps1'); [IO.File]::WriteAllText(`$f, `$text); try { & '$boxPs' -NoProfile -ExecutionPolicy Bypass -File `$f } finally { Remove-Item `$f -Force } }
function Send-ThornswoodArtifactFile(`$l, `$t, `$s, `$far) { Copy-Item -LiteralPath `$l -Destination `$far.Replace('/', '\') -Force }
`$zip = Join-Path `$env:TEMP ('tw-art-' + [guid]::NewGuid().ToString('N') + '.zip'); [IO.File]::WriteAllText(`$zip, 'zip')
`$rec = `$zip + '.json'; [IO.File]::WriteAllText(`$rec, '{}')
`$a = [pscustomobject]@{ Component = 'site'; Name = 'site-1.zip'; Zip = `$zip; RecordPath = `$rec; Sha256 = (Get-FileHash -LiteralPath `$zip -Algorithm SHA256).Hash.ToLowerInvariant() }
Send-ThornswoodArtifact -Artifact `$a -Target 'nobody@nowhere' -Store '$($store.Replace("'", "''"))'
Remove-Item `$zip, `$rec -Force
"@
    Yes 'Send-ThornswoodArtifact with the box stood in: the store is made, with site\ and current\' ((Test-Path (Join-Path $store 'site\site-1.zip')) -and (Test-Path (Join-Path $store 'current')))
    Yes '  and the store is locked' (Locked $store)
    Yes '  and current\ and the zip under it take no Users rule' (((Broad (Join-Path $store 'current')) + (Broad (Join-Path $store 'site\site-1.zip'))) -eq 0)
    if (-not (Locked $store)) { $sent | ForEach-Object { Write-Host "      $_" } }

    # ---- a folder already there is left to Lock-VpsFolders.ps1
    $old = Join-Path $c 'Thornswood-Caddy-old'
    $null = New-Item -ItemType Directory -Path $old
    $before = (Get-Acl -LiteralPath $old).Sddl
    $out = Run51 (Get-ThornswoodLockedFolderScript -Path $old)
    Yes 'a folder already there: left exactly as it was, and nothing said' (((Get-Acl -LiteralPath $old).Sddl -eq $before) -and -not @($out | Where-Object { $_ }).Count)

    # ---- -Only: SYSTEM, Administrators and this account and nothing else
    $only = Join-Path $c 'only'
    $null = New-Item -ItemType Directory -Path $only; Grant $only $runner 'Deny'
    Lock-ThornswoodFolder -Path $only -Only
    Yes '-Only takes every rule by name off but SYSTEM, Administrators and this account' ((Locked $only) -and -not @(All $only | Where-Object { $keep -notcontains $_.IdentityReference.Value }).Count)

    # ---- the same rules as Lock-VpsFolders.ps1
    $a = Join-Path $c 'a'; $b = Join-Path $c 'b'
    foreach ($p in $a, (Join-Path $b 'Thornswood-Caddy'), (Join-Path $b 'Thornswood-Dumps'), (Join-Path $c 'only2')) { $null = New-Item -ItemType Directory -Force -Path $p; Grant $p $runner 'Deny' }
    Lock-ThornswoodFolder -Path $a
    Lock-ThornswoodFolder -Path (Join-Path $c 'only2') -Only -Writers @('S-1-5-19', $runner)
    $null = & $boxPs -NoProfile -ExecutionPolicy Bypass -File $lockBox -Parent $b -AllowGamingPc -SiteSid none -BotSid none -DumpWriterSids ('S-1-5-19,' + $runner)
    function Rules([string]$p) { return ((All $p | ForEach-Object { $_.IdentityReference.Value + '|' + $_.AccessControlType + '|' + [int]$_.FileSystemRights + '|' + [int]$_.InheritanceFlags + '|' + $_.IsInherited }) | Sort-Object) -join ';' }
    Yes 'the helper leaves exactly the rules Lock-VpsFolders.ps1 leaves on a service folder (the runner''s deny kept)' (((Rules $a) -eq (Rules (Join-Path $b 'Thornswood-Caddy'))) -and (Rules $a).Contains($runner))
    Yes 'and -Only -Writers exactly the rules it leaves on Dumps, the writers'' write included' ((Rules (Join-Path $c 'only2')) -eq (Rules (Join-Path $b 'Thornswood-Dumps')))
} finally {
    & icacls $tmp /reset /T /C /Q 2>&1 | Out-Null
    Remove-Item -LiteralPath $tmp -Recurse -Force -EA SilentlyContinue
}
Write-Host ''
Write-Host ("$script:pass passed, $script:fail failed")
if ($script:fail) { exit 1 }
