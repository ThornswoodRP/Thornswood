# Pinned archive staging only; this file never opens a listener or installs a task.
function Read-CoturnRuntime {
    param([Parameter(Mandatory)][string]$Archive, [Parameter(Mandatory)]$Pin)
    if ($Pin.schema -ne 1 -or $Pin.supplier -cne 'coturn/coturn' -or @($Pin.files).Count -lt 1 -or @($Pin.files).Count -gt 64 -or @($Pin.files | Where-Object path -CEQ 'bin/turnserver.exe').Count -ne 1) { throw 'The reviewed pin does not describe one native coturn runtime.' }
    if ($Pin.artifactBytes -le 0 -or $Pin.artifactBytes -gt 67108864 -or $Pin.innerArchiveBytes -le 0 -or $Pin.innerArchiveBytes -gt 16777216) { throw 'The reviewed archive sizes exceed staging bounds.' }
    $file = Get-Item -LiteralPath $Archive -ErrorAction Stop
    if ($file.Length -ne $Pin.artifactBytes -or (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Pin.artifactSha256) { throw 'The upstream archive does not match the reviewed pin.' }
    $outer = [IO.Compression.ZipFile]::OpenRead($file.FullName)
    try {
        $innerEntries = @($outer.Entries | Where-Object FullName -CEQ $Pin.innerArchiveName)
        if ($innerEntries.Count -ne 1 -or $innerEntries[0].Length -ne $Pin.innerArchiveBytes) { throw 'The pinned runtime archive is missing or ambiguous.' }
        $memory = [IO.MemoryStream]::new()
        $inputStream = $innerEntries[0].Open()
        try {
            $innerBytes = [byte[]]::new([int]$Pin.innerArchiveBytes)
            $inputStream.ReadExactly($innerBytes)
            if ($inputStream.ReadByte() -ne -1) { throw 'The inner archive exceeds its reviewed size.' }
            $memory.Write($innerBytes)
        } finally { $inputStream.Dispose() }
        try {
            if ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($memory.ToArray())).ToLowerInvariant() -ne $Pin.innerArchiveSha256) { throw 'The inner runtime archive does not match the reviewed pin.' }
            $memory.Position = 0
            $inner = [IO.Compression.ZipArchive]::new($memory, [IO.Compression.ZipArchiveMode]::Read, $true)
            try {
                $result = [Collections.Generic.List[object]]::new()
                $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
                foreach ($expected in $Pin.files) {
                    $name = [string]$expected.path
                    if (($name -cnotmatch '^bin/[A-Za-z0-9_.-]+$' -and $name -cne 'doc/turnserver/LICENSE') -or -not $seen.Add($name)) { throw 'The reviewed runtime file list is unsafe or ambiguous.' }
                    if ($expected.bytes -le 0 -or $expected.bytes -gt 16777216) { throw 'The reviewed runtime file size is outside the staging limit.' }
                    $entries = @($inner.Entries | Where-Object FullName -CEQ $name)
                    if ($entries.Count -ne 1 -or $entries[0].Length -ne $expected.bytes) { throw 'A reviewed runtime file is missing, duplicated or the wrong size.' }
                    $data = [IO.MemoryStream]::new()
                    $inputStream = $entries[0].Open()
                    try {
                        $bytes = [byte[]]::new([int]$expected.bytes)
                        $inputStream.ReadExactly($bytes)
                        if ($inputStream.ReadByte() -ne -1) { throw 'A runtime file exceeds its reviewed size.' }
                    } finally { $inputStream.Dispose(); $data.Dispose() }
                    if ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant() -ne $expected.sha256) { throw 'A runtime file differs from the reviewed pin.' }
                    $result.Add([pscustomobject]@{ Path = $name; Bytes = $bytes; Sha256 = $expected.sha256 })
                }
                return ,$result
            } finally { $inner.Dispose() }
        } finally { $memory.Dispose() }
    } finally { $outer.Dispose() }
}

function Assert-NewCoturnStagingPath {
    param([Parameter(Mandatory)][string]$Path)
    $full = [IO.Path]::GetFullPath($Path)
    if (Test-Path -LiteralPath $full) { throw 'The staging destination already exists; no existing package is overwritten.' }
    $parent = [IO.Directory]::GetParent($full)
    if ($null -eq $parent -or $null -eq $parent.Parent) { throw 'The staging destination must be below a named directory.' }
    while ($null -ne $parent) {
        if (Test-Path -LiteralPath $parent.FullName) {
            $item = Get-Item -LiteralPath $parent.FullName -Force -ErrorAction Stop
            if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'A staging ancestor is not a plain directory.' }
        }
        $parent = $parent.Parent
    }
    return $full
}
