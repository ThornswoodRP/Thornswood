<#
  Get-AppContainerStore.ps1

      . scripts\dev\Get-AppContainerStore.ps1
      $store = Get-AppContainerStore

  Says whether this process runs inside an app package's container (#5197),
  by the one thing that breaks the real game run there: a folder made under
  %LOCALAPPDATA% lands in the package's own store, under
  %LOCALAPPDATA%\Packages\<package>\LocalCache\Local, and not in the real
  folder. It returns that package folder's name, or "" when the folder went
  where it was made.

  WHY BY A FOLDER. Measured on One on 27 Nov: a shell started from the Claude
  app's Remote Control reads no package of its own (GetCurrentPackageFullName
  answers 15700), yet a folder it or its children made and renamed under
  %LOCALAPPDATA% went to Packages\Claude_...\LocalCache\Local. So the launcher
  the run started moved Windows' Skyrim folder aside into that store, the real
  one stayed where it was, and Play stopped on "Could not redirect ... a
  folder is there again". Asking Windows for a package says no; making a
  folder says what happens.

  The folder it makes is empty, has a name nothing else uses, and is taken
  away again before it returns.
#>

function Get-AppContainerStore {
    $local = [Environment]::GetFolderPath('LocalApplicationData')
    $name = 'thornswood-container-look-' + [guid]::NewGuid().ToString('N')
    $made = Join-Path $local $name
    New-Item -ItemType Directory -Path $made | Out-Null
    try {
        $packages = Join-Path $local 'Packages'
        if (-not (Test-Path -LiteralPath $packages)) { return '' }
        foreach ($p in @(Get-ChildItem -LiteralPath $packages -Directory -Force)) {
            if (Test-Path -LiteralPath (Join-Path $p.FullName ('LocalCache\Local\' + $name))) { return $p.Name }
        }
        return ''
    } finally {
        Remove-Item -LiteralPath $made -Force
    }
}
