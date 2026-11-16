<#
  Leftovers.ps1

  What Clean-Leftovers.ps1 -Go removes, in one place, for it and for
  Audit-Leftovers.ps1 (#4256).

      . (Join-Path $PSScriptRoot 'Leftovers.ps1')
      Get-ThornswoodCleanTargets     every path Clean-Leftovers -Go removes
                                     when it is there, full paths

  Each script used to carry its own list of folders and its own pattern of
  what a leftover is, kept in step by hand, and they drifted: the audit
  counted the saves, OneDrive, the Steam copy, the engine's build folders and
  everything under a folder named temp or old as cruft, none of which Clean
  touches, so its total said far more could be freed than Clean ever frees.
  Since #4808 Clean removes only Thornswood's own leftovers named here, so
  the audit reads this list to mark each row Clean leaves and to count only
  what Clean frees. A path added here is one Clean removes and the audit
  counts, both at once.

    <install>\Launcher\Thornswood.exe.old
    <install>-DevBuild\Launcher\Thornswood.exe.old
        The launcher from before Velopack keeps its old exe under this name
        when its swap script puts an update in place, and launcher\move
        clears it when it starts. One is left when that never ran. The
        install is Where.ps1 Install, and -DevBuild beside it (Where.ps1
        InstallDev) is where the main launcher's Settings page installs the
        dev build.

  Defines a function and nothing else.
#>

function Get-ThornswoodCleanTargets {
    $where = Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'release') 'Where.ps1'
    foreach ($install in @((& $where Install), (& $where InstallDev))) {
        [IO.Path]::GetFullPath((Join-Path (Join-Path $install 'Launcher') 'Thornswood.exe.old'))
    }
}
