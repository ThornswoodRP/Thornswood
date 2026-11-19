# The public policy contains no secret, performs no I/O and opens no listener.
function Get-PionConfiguration {
    param([Parameter(Mandatory)]$Policy,[Parameter(Mandatory)][ValidateSet('dev','main')][string]$Role,[Parameter(Mandatory)][string]$RelayIPv4,[Parameter(Mandatory)][string]$KeyFile)
    $ip=$null
    if(-not [Net.IPAddress]::TryParse($RelayIPv4,[ref]$ip) -or $ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $ip.ToString() -cne $RelayIPv4){throw 'The relay address must be one canonical IPv4 address.'}
    function Number([Net.IPAddress]$address) {
        $b=$address.GetAddressBytes()
        return (([uint64]$b[0] -shl 24) -bor ([uint64]$b[1] -shl 16) -bor ([uint64]$b[2] -shl 8) -bor [uint64]$b[3])
    }
    $number=Number $ip
    foreach($cidr in @('0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.0.0.0/24','192.0.2.0/24','192.168.0.0/16','198.18.0.0/15','198.51.100.0/24','203.0.113.0/24','224.0.0.0/3')) {
        $parts=$cidr.Split('/');$prefix=Number ([Net.IPAddress]::Parse($parts[0]));$mask=([uint64]4294967295 -shl (32-[int]$parts[1])) -band [uint64]4294967295
        if(($number -band $mask) -eq ($prefix -band $mask)){throw 'The relay address must be public unicast IPv4.'}
    }
    if($Policy.schema -ne 1 -or $Policy.userQuota -ne 8 -or $Policy.totalQuota -ne 32 -or $Policy.bytesPerSecondPerAllocation -ne 65536 -or $Policy.bytesPerSecondTotal -ne 2097152){throw 'The allocation/bandwidth policy differs from the reviewed limits.'}
    $r=$Policy.roles.$Role
    foreach($p in @($r.udpPort,$r.minPort,$r.maxPort)){if("$p" -notmatch '^[0-9]{1,5}$' -or $p -lt 1024 -or $p -ge 49152){throw 'Relay ports must be fixed ports below the default dynamic range.'}}
    if($r.maxPort-$r.minPort -ne 31 -or ($r.udpPort -ge $r.minPort -and $r.udpPort -le $r.maxPort)){throw 'The reviewed role needs one separate listener and 32 media ports.'}
    $other=$Policy.roles.$(if($Role -eq 'dev'){'main'}else{'dev'})
    if(($r.minPort -le $other.maxPort -and $other.minPort -le $r.maxPort) -or $r.udpPort -eq $other.udpPort -or ($r.udpPort -ge $other.minPort -and $r.udpPort -le $other.maxPort) -or ($other.udpPort -ge $r.minPort -and $other.udpPort -le $r.maxPort)){throw 'Relay roles overlap.'}
    if($r.realm -cne ('turn-'+$Role+'.thornswood.net') -or $r.taskName -cne ('Thornswood '+$(if($Role -eq 'dev'){'Dev'}else{'Main'})+' TURN')){throw 'The relay role identity differs from the reviewed policy.'}
    $expected=if($Role -eq 'dev'){@(3478,42000,42031)}else{@(3479,42032,42063)}
    if($r.udpPort -ne $expected[0] -or $r.minPort -ne $expected[1] -or $r.maxPort -ne $expected[2]){throw 'Role ports differ from the exact native configuration contract.'}
    if(-not [IO.Path]::IsPathFullyQualified($KeyFile)){throw 'The protected key path must be absolute.'}
    return [ordered]@{schema=1;role=$Role;listenAddress=$RelayIPv4;listenPort=[int]$r.udpPort;minPort=[int]$r.minPort;maxPort=[int]$r.maxPort;realm=$r.realm;keyFile=$KeyFile}
}
function Assert-PionConfigShape {
 param([Parameter(Mandatory)]$Expected,[Parameter(Mandatory)][byte[]]$Bytes)
 $utf8=[Text.UTF8Encoding]::new($false,$true)
 try{$text=$utf8.GetString($Bytes);$actual=$text | ConvertFrom-Json -AsHashtable}catch{throw 'Relay config is not valid strict UTF-8 JSON.'}
 if($actual.Count -ne $Expected.Count){throw 'Relay config field set differs from the reviewed shape.'}
 foreach($name in $Expected.Keys){if(-not $actual.ContainsKey($name) -or $actual[$name] -cne $Expected[$name]){throw 'Relay config value differs from the reviewed shape.'}}
 # The exact serialization also rejects duplicate/case-alias JSON keys.
 if($text -cne ($Expected | ConvertTo-Json -Compress)){throw 'Relay config is not the exact generated reviewed shape.'}
}
