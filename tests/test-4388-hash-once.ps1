<#
  test-4388-hash-once.ps1

      pwsh -NoProfile -File .\tests\test-4388-hash-once.ps1

  #4388. Install-NexusRevision read every cached archive in full for its md5
  on every run whenever the size matched, because nothing kept which
  archive had already passed at which size and write time. And a re-run
  over a folder it had laid out read each placed file twice: once (the
  unpacked copy) for the new files.txt and once (the copy in the game
  folder) to check the old layout before taking it out, because the old
  layout kept no record of what it had placed beyond files.txt.

  WHAT THIS HOLDS, with a stand-in hasher that counts its reads, over
  scratch files (never the real collection, the cache or Vortex):
    1. scripts\release\HashStamps.ps1: a file whose size and write time are
       what its stamp says is taken as its recorded hash with no read; a
       touched one is read again; a wrong one is refused and its stamp goes;
       one the wrong size is refused with no read; stamps survive a save
       and a read
    2. a re-run layout: the old layout's check reads no placed file whose
       size and time are as placed, so each placed file is read once, for
       the new files.txt
    3. Install-NexusRevision.ps1 uses it at both places: the cache keeps
       md5-passed.tsv and the old layout's check reads placed.tsv, which is
       written when the layout is whole and taken out with the old layout

  -Repo points it at another checkout, which is how it was shown to fail on
  main before the change.
#>
[CmdletBinding()]
param([string]$Repo)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Repo) { $Repo = Split-Path -Parent $Here }

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

$helper = Join-Path $Repo 'scripts/release/HashStamps.ps1'
$inr = Join-Path $Repo 'scripts/release/Install-NexusRevision.ps1'
$inrText = [IO.File]::ReadAllText($inr)

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-4388-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $T | Out-Null
$script:reads = 0
$hasher = { param([string]$p) $script:reads++; return ([BitConverter]::ToString([Security.Cryptography.MD5]::Create().ComputeHash([IO.File]::ReadAllBytes($p))) -replace '-', '').ToLowerInvariant() }
function Md5Of([string]$p) { return ([BitConverter]::ToString([Security.Cryptography.MD5]::Create().ComputeHash([IO.File]::ReadAllBytes($p))) -replace '-', '').ToLowerInvariant() }

try {
    Yes 'scripts/release/HashStamps.ps1 is there' (Test-Path -LiteralPath $helper -PathType Leaf)
    if (Test-Path -LiteralPath $helper -PathType Leaf) {
        . $helper

        # ---- 1. a cached archive ---------------------------------------------------
        Write-Host 'a cached archive'
        $a = Join-Path $T '493920/SkyUI 493920.7z'
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $a) | Out-Null
        [IO.File]::WriteAllText($a, 'the archive the revision lists')
        $size = (Get-Item -LiteralPath $a).Length
        $md5 = Md5Of $a
        $stamps = @{}
        $script:reads = 0
        $ok = Test-HashAsRecorded $stamps '493920\SkyUI 493920.7z' $a $size $md5 $hasher
        Yes 'the first run reads it once and it passes' ($ok -and $script:reads -eq 1)
        $file = Join-Path $T 'md5-passed.tsv'
        Save-HashStamps $file $stamps
        $stamps = Read-HashStamps $file
        $script:reads = 0
        $ok = Test-HashAsRecorded $stamps '493920\SkyUI 493920.7z' $a $size $md5 $hasher
        Yes 'the second run, size and time unchanged, passes it with 0 reads (stamp saved and read back)' ($ok -and $script:reads -eq 0)
        Yes '  a stamp for another md5 does not pass it' (-not (Test-HashAsRecorded $stamps '493920\SkyUI 493920.7z' $a $size ('0' * 32) $hasher))

        $stamps = Read-HashStamps $file
        [IO.File]::SetLastWriteTimeUtc($a, [IO.File]::GetLastWriteTimeUtc($a).AddMinutes(5))
        $script:reads = 0
        $ok = Test-HashAsRecorded $stamps '493920\SkyUI 493920.7z' $a $size $md5 $hasher
        Yes 'a touched one is read again, and passes when its bytes are right' ($ok -and $script:reads -eq 1)

        # Same size, other bytes, and a new write time: refused.
        $stamps = Read-HashStamps $file
        [IO.File]::WriteAllText($a, 'the archive the revision listz')
        [IO.File]::SetLastWriteTimeUtc($a, [IO.File]::GetLastWriteTimeUtc($a).AddMinutes(10))
        $script:reads = 0
        $ok = Test-HashAsRecorded $stamps '493920\SkyUI 493920.7z' $a $size $md5 $hasher
        Yes 'a wrong one, the same size, is read and refused' (-not $ok -and $script:reads -eq 1)
        Yes '  and its stamp is taken out' (-not $stamps.ContainsKey('493920\skyui 493920.7z'))
        $script:reads = 0
        $ok = Test-HashAsRecorded @{} 'x' $a ($size + 1) $md5 $hasher
        Yes 'one the wrong size is refused with no read' (-not $ok -and $script:reads -eq 0)
        $ok = Test-HashAsRecorded @{} 'x' (Join-Path $T 'none.7z') $size $md5 $hasher
        Yes 'one that is not there is refused with no read' (-not $ok -and $script:reads -eq 0)
        Yes 'no stamp file reads as no stamps' ((Read-HashStamps (Join-Path $T 'none.tsv')).Count -eq 0)

        # ---- 2. a re-run layout ---------------------------------------------------
        Write-Host ''
        Write-Host 'a re-run layout'
        $game = Join-Path $T 'game'
        $src = Join-Path $T 'unpacked'
        $rels = @('Data\SkyUI_SE.esp', 'Data\Interface\skyui.swf', 'Data\Scripts\ski_main.pex')
        foreach ($r in $rels) {
            foreach ($root in $src, $game) {
                $p = Join-Path $root ($r.Replace('\', [IO.Path]::DirectorySeparatorChar))
                New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p) | Out-Null
                [IO.File]::WriteAllText($p, 'bytes of ' + $r)
            }
        }
        # The first run placed them and stamped them with the hash it had
        # already worked out for files.txt: no read.
        $placedStamps = @{}
        $script:reads = 0
        $sums = @{}
        foreach ($r in $rels) { $sums[$r] = Md5Of (Join-Path $game ($r.Replace('\', [IO.Path]::DirectorySeparatorChar))) }
        foreach ($r in $rels) { Set-HashStamp $placedStamps $r (Join-Path $game ($r.Replace('\', [IO.Path]::DirectorySeparatorChar))) $sums[$r] }
        Yes 'stamping the placed files reads none of them' ($script:reads -eq 0)
        Save-HashStamps (Join-Path $T 'placed.tsv') $placedStamps

        # The re-run: the new files.txt reads each unpacked copy once, and the
        # old layout's check reads none that are as placed.
        $placedStamps = Read-HashStamps (Join-Path $T 'placed.tsv')
        $script:reads = 0
        foreach ($r in $rels) { [void](& $hasher (Join-Path $src ($r.Replace('\', [IO.Path]::DirectorySeparatorChar)))) }
        $changed = @()
        foreach ($r in $rels) {
            $g = Join-Path $game ($r.Replace('\', [IO.Path]::DirectorySeparatorChar))
            if (-not (Test-HashAsRecorded $placedStamps $r $g (Get-Item -LiteralPath $g).Length $sums[$r] $hasher)) { $changed += $r }
        }
        Yes ('one read per placed file in all (' + $script:reads + ' for ' + $rels.Count + ')') ($script:reads -eq $rels.Count)
        Yes '  and the old layout is found as placed' ($changed.Count -eq 0)

        # Something else writes one of them: it is read, and found changed.
        $g = Join-Path $game 'Data/SkyUI_SE.esp'
        [IO.File]::WriteAllText($g, 'bytes of Data\SkyUI_SF.esp')
        [IO.File]::SetLastWriteTimeUtc($g, [DateTime]::UtcNow.AddMinutes(3))
        $script:reads = 0
        $ok = Test-HashAsRecorded $placedStamps 'Data\SkyUI_SE.esp' $g (Get-Item -LiteralPath $g).Length $sums['Data\SkyUI_SE.esp'] $hasher
        Yes 'a placed file something else wrote is read and found changed' (-not $ok -and $script:reads -eq 1)
    }

    # ---- 3. Install-NexusRevision uses it -------------------------------------------
    Write-Host ''
    Write-Host 'Install-NexusRevision.ps1'
    Yes 'dot-sources HashStamps.ps1' ($inrText -match "\. \(Join-Path \`$Here 'HashStamps\.ps1'\)")
    Yes 'the cache keeps md5-passed.tsv' ($inrText -match "Join-Path \`$Cache 'md5-passed\.tsv'")
    Yes '  a cached archive is passed through Test-HashAsRecorded, not read for its md5 each run' ($inrText -match 'Test-HashAsRecorded \$cacheStamps' -and $inrText -notmatch "Get-FileHash -LiteralPath \`$f\.FullName -Algorithm MD5")
    Yes '  a download that matched is stamped with the md5 it was checked against' ($inrText -match 'Set-HashStamp \$cacheStamps')
    Yes '  and the stamps are saved for the archives this revision uses' ($inrText -match 'Save-HashStamps \(Join-Path \$Cache ''md5-passed\.tsv''\)')
    Yes 'the old layout''s check reads placed.tsv and passes files through Test-HashAsRecorded' ($inrText -match "Read-HashStamps \(Join-Path \`$recDir 'placed\.tsv'\)" -and $inrText -match 'Test-HashAsRecorded \$placedStamps')
    Yes '  and no longer reads every old file for its sha256 itself' ($inrText -notmatch '\[Thornswood\.Layout\.NexusLayout\]::Sha256Of\(\$f\) -ne \$o\.Sha256')
    Yes 'placed.tsv is taken out with the old layout' ($inrText -match "foreach \(\`$n in 'layout\.json', 'files\.txt', 'plugins\.txt', 'loadorder\.txt', 'slidersets\.json', 'placed\.tsv'\)")
    Yes '  and written when the layout is whole, from the sha256 files.txt has' ($inrText -match 'Set-HashStamp \$placedNow' -and $inrText -match "Save-HashStamps \(Join-Path \`$recDir 'placed\.tsv'\) \`$placedNow")
} finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
