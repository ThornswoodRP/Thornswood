<#
  Get-SevenZip.ps1

  Puts 7-Zip's own Linux build (7zz, 25.01) on a Linux machine, checked
  against its pinned sha256, and prints where it is, so a cloud session can
  unpack every archive of the collection (#2969).

      pwsh scripts/release/Get-SevenZip.ps1           fetch it if it is not there, print the path
      pwsh scripts/release/Get-SevenZip.ps1 -Check    print the path, or say it is not there

  WHY. 14 of the 115 archives of collection revision 3 are RAR. Measured in a
  cloud session on 21 Oct 2026: Ubuntu's 7zip package (23.01+dfsg-11) has no
  RAR codec ("Unsupported Method" on Skyrim Sewers), and its 7zip-rar codec
  (23.01-4) crashes on every one of the 14 (exit 139). 7-Zip's own build
  from 7-zip.org unpacks all 14. On Windows 7-Zip is installed as usual, and
  this script is not needed.

  WHERE. $XDG_DATA_HOME/thornswood/7zip-25.01/7zz, or
  ~/.local/share/thornswood/7zip-25.01/7zz when XDG_DATA_HOME is not set.
  SevenZip.ps1's Get-SevenZipOwnBuild holds the version, the address, the
  sha256 and this place, and its Find-SevenZip, which every script that
  needs 7-Zip calls, looks there before PATH (#4424).

  WHAT IS FETCHED. https://www.7-zip.org/a/7z2501-linux-x64.tar.xz, 1,571,044
  bytes. The sha256 below was read on 21 Oct 2026 from that file and from the
  same release on 7-Zip's GitHub (ip7z/7zip, tag 25.01); both are the same
  bytes. A download that is anything else is deleted and nothing is put in
  place. Only 7zz is kept from it.

.PARAMETER Check
  Fetches nothing. Prints the path when it is there, or says it is not.
#>
[CmdletBinding()]
param(
  [switch]$Check
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'SevenZip.ps1')
$own = Get-SevenZipOwnBuild
$Url = $own.Url
$Sha256 = $own.Sha256
$Version = $own.Version

if ($PSVersionTable.PSVersion.Major -lt 6 -or $IsWindows) { throw 'This is for Linux. On Windows, 7-Zip is installed from 7-zip.org as usual, and the scripts find it in Program Files.' }
if (-not $own.Dir) { throw 'There is no XDG_DATA_HOME or HOME here to put 7-Zip in.' }
$dir = $own.Dir
$exe = $own.Path

if (Test-Path -LiteralPath $exe -PathType Leaf) { Write-Output $exe; exit 0 }
if ($Check) { Write-Host ('7-Zip ' + $Version + ' is not at ' + $exe + '. pwsh scripts/release/Get-SevenZip.ps1 puts it there.'); exit 1 }
# Only fetching needs the machine to be x64: -Check above answers on any.
if ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [Runtime.InteropServices.Architecture]::X64) { throw ('The pinned build is for x64 Linux, and this machine is ' + [Runtime.InteropServices.RuntimeInformation]::OSArchitecture + '.') }

$work = Join-Path $dir 'fetch'
if (Test-Path -LiteralPath $work) { [IO.Directory]::Delete($work, $true) }
New-Item -ItemType Directory -Force -Path $work | Out-Null
$tar = Join-Path $work '7z-linux-x64.tar.xz'
try {
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -Uri $Url -OutFile $tar -MaximumRedirection 0 -UseBasicParsing
  $got = (Get-FileHash -LiteralPath $tar -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($got -ne $Sha256) { throw ($Url + ' sent a file with sha256 ' + $got + ', not the pinned ' + $Sha256 + ', so it was deleted and nothing was put in place.') }
  & tar -xJf $tar -C $work 7zz
  if ($LASTEXITCODE -ne 0) { throw ('tar could not take 7zz out of ' + $tar + ' (exit ' + $LASTEXITCODE + ').') }
  & chmod 755 (Join-Path $work '7zz')
  [IO.File]::Move((Join-Path $work '7zz'), $exe)
}
finally { if (Test-Path -LiteralPath $work) { [IO.Directory]::Delete($work, $true) } }
Write-Output $exe
