<#
  test-signing-relative.ps1

      pwsh -NoProfile -File .\tests\test-signing-relative.ps1

  #1073: signing.json names records\signing\metadata.json and the signing
  client's Azure.CodeSigning.Dlib.dll relative to the repository, a machine
  gets one by moving its old signing.json aside and running
  Setup-ShipMachine.ps1 (which writes it from signing.template.json), and no
  tracked script reads C:\tools any more.

  HOW. Static reads of the tracked template and scripts, plus New-SigningConfig
  lifted out of Setup-ShipMachine.ps1 by its AST and run against a scratch
  folder in %TEMP%. Nothing signs, nothing contacts Azure, and the real
  records\signing\signing.json and C:\tools are never read or written.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$pass = 0; $fail = 0
function Yes([string]$what, [bool]$ok) {
  if ($ok) { $script:pass++; Write-Host ('PASS  ' + $what) -ForegroundColor Green }
  else { $script:fail++; Write-Host ('FAIL  ' + $what) -ForegroundColor Red }
}

# 1. The template names both files relative to the repository, and they are the tracked ones.
$tplPath = Join-Path $repo 'records\signing\signing.template.json'
$tpl = Get-Content -LiteralPath $tplPath -Raw | ConvertFrom-Json
Yes '1. template metadata is records\signing\metadata.json' ($tpl.metadata -eq 'records\signing\metadata.json')
Yes '1. template metadata is not rooted' (-not [IO.Path]::IsPathRooted([string]$tpl.metadata))
Yes '1. template dlib is not rooted' (-not [IO.Path]::IsPathRooted([string]$tpl.dlib))
Yes '1. template dlib is under records\signing\client and names Azure.CodeSigning.Dlib.dll' ([string]$tpl.dlib -match '^records\\signing\\client\\.*\\Azure\.CodeSigning\.Dlib\.dll$')
Yes '1. records\signing\metadata.json is tracked' ([bool](& git -C $repo ls-files -- 'records/signing/metadata.json'))
Yes '1. neither template path names C:\tools' (($tpl.metadata + '|' + $tpl.dlib) -notmatch '(?i)^[a-z]:\\tools')

# 2. Setup-ShipMachine writes one from the template, and never over an existing one.
$setup = Join-Path $repo 'scripts\release\Setup-ShipMachine.ps1'
$ast = [Management.Automation.Language.Parser]::ParseFile($setup, [ref]$null, [ref]$null)
$fn = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'New-SigningConfig' }, $true)
Yes '2. Setup-ShipMachine.ps1 defines New-SigningConfig' ($null -ne $fn)
. ([scriptblock]::Create($fn.Extent.Text))
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('tw-1073-' + [guid]::NewGuid().ToString('N'))
try {
  $target = Join-Path $scratch 'records\signing\signing.json'
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
  $old = '{"enabled":true,"method":"artifactsigning","dlib":"C:\\tools\\client\\Azure.CodeSigning.Dlib.dll","metadata":"C:\\tools\\metadata.json"}'
  [IO.File]::WriteAllText($target, $old)
  $r = New-SigningConfig $tplPath $target ''
  Yes '2. an existing (C:\tools) signing.json is left as it is' ((-not $r.Wrote) -and ((Get-Content -LiteralPath $target -Raw) -eq $old))
  Move-Item -LiteralPath $target -Destination ($target + '.old')
  $r = New-SigningConfig $tplPath $target ''
  Yes '2. moved aside, a new one is written from the template' ($r.Wrote -and (Test-Path -LiteralPath $target))
  $w = Get-Content -LiteralPath $target -Raw | ConvertFrom-Json
  Yes '2. the written metadata is records\signing\metadata.json' ($w.metadata -eq 'records\signing\metadata.json')
  Yes '2. the written dlib is the template''s, relative' (($w.dlib -eq $tpl.dlib) -and -not [IO.Path]::IsPathRooted([string]$w.dlib))
  Yes '2. the written file never names C:\tools' ((Get-Content -LiteralPath $target -Raw) -notmatch '(?i)C:\\\\tools')
  Remove-Item -LiteralPath $target
  $rel = 'records\signing\client\Microsoft.ArtifactSigning.Client.9.9.9\bin\x64\Azure.CodeSigning.Dlib.dll'
  $null = New-SigningConfig $tplPath $target $rel
  Yes '2. a client found on this machine is named relative too' ((Get-Content -LiteralPath $target -Raw | ConvertFrom-Json).dlib -eq $rel)
} finally { Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue }

# 3. Relative paths mean the repository's, in both readers.
$sign = Get-Content -LiteralPath (Join-Path $repo 'scripts\release\Sign-Artifact.ps1') -Raw
Yes '3. Sign-Artifact.ps1 resolves an unrooted dlib/metadata against the repository' ($sign -match 'IsPathRooted')
$setupText = Get-Content -LiteralPath $setup -Raw
Yes '3. Setup-ShipMachine.ps1 resolves them against the repository (Get-SigningPathsMissing)' ($setupText -match 'IsPathRooted\(\$v\)\)\s*\{\s*\$v = Join-Path \$Repo \$v')

# 4. Nothing tracked reads C:\tools (code, not docs or tests' own fixtures).
$files = & git -C $repo ls-files -- '*.ps1' '*.psm1' '*.js' '*.cs' '*.py' '*.json' '*.bat' '*.cmd' | Where-Object { $_ -notmatch '^(tests|docs|engine)/|^[^/]+/tests/' }
$hits = @()
foreach ($f in $files) {
  $p = Join-Path $repo $f
  if (-not (Test-Path -LiteralPath $p)) { continue }
  $n = 0
  foreach ($line in [IO.File]::ReadAllLines($p)) { $n++; if ($line -match '(?i)C:(\\|/|\\\\)tools(\\|/|\\\\|[''"\s]|$)') { $hits += ($f + ':' + $n) } }
}
Yes ('4. no tracked script, app or config names C:\tools (' + $files.Count + ' files' + $(if ($hits) { '; ' + ($hits -join ', ') } else { '' }) + ')') ($hits.Count -eq 0)

Write-Host ''
Write-Host ("$pass passed, $fail failed")
if ($fail) { exit 1 }