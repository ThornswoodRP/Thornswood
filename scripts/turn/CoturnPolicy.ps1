# The public policy contains no secret, performs no I/O and opens no listener.
function Get-CoturnPublicOptions {
    param([Parameter(Mandatory)]$Policy,[Parameter(Mandatory)][ValidateSet('dev','main')][string]$Role,[Parameter(Mandatory)][string]$RelayIPv4)
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
    @('listening-ip='+$RelayIPv4;'relay-ip='+$RelayIPv4;'listening-port='+$r.udpPort;'min-port='+$r.minPort;'max-port='+$r.maxPort;'realm='+$r.realm;'use-auth-secret';'fingerprint';'no-tcp';'no-tls';'no-tcp-relay';'no-multicast-peers';'no-auth-pings';'no-software-attribute';'relay-threads=0';'user-quota='+$Policy.userQuota;'total-quota='+$Policy.totalQuota;'max-bps='+$Policy.bytesPerSecondPerAllocation;'bps-capacity='+$Policy.bytesPerSecondTotal;'simple-log';'log-file=stdout';'pidfile=../logs/relay.pid';'denied-peer-ip=0.0.0.0-0.255.255.255';'denied-peer-ip=10.0.0.0-10.255.255.255';'denied-peer-ip=100.64.0.0-100.127.255.255';'denied-peer-ip=127.0.0.0-127.255.255.255';'denied-peer-ip=169.254.0.0-169.254.255.255';'denied-peer-ip=172.16.0.0-172.31.255.255';'denied-peer-ip=192.0.0.0-192.0.0.255';'denied-peer-ip=192.0.2.0-192.0.2.255';'denied-peer-ip=192.168.0.0-192.168.255.255';'denied-peer-ip=198.18.0.0-198.19.255.255';'denied-peer-ip=198.51.100.0-198.51.100.255';'denied-peer-ip=203.0.113.0-203.0.113.255';'denied-peer-ip=224.0.0.0-255.255.255.255';'denied-peer-ip=::-::1';'denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff';'denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff')
}

