$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot

$p = Start-Process -FilePath ".\VOID-test.exe" -ArgumentList "/port:port.txt" -PassThru
Start-Sleep -Seconds 3
if (-not (Test-Path "port.txt")) { Write-Host "NO PORT FILE"; if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }; exit 1 }
$port = Get-Content "port.txt"
Write-Host ("port=" + $port + " alive=" + (-not $p.HasExited))

function Probe([string]$path) {
    $c = New-Object System.Net.Sockets.TcpClient("127.0.0.1", $port)
    $s = $c.GetStream()
    $nl = [char]13 + [char]10
    $req = "GET " + $path + " HTTP/1.1" + $nl + "Host: x" + $nl + "Connection: close" + $nl + $nl
    $bytes = [System.Text.Encoding]::ASCII.GetBytes($req)
    $s.Write($bytes, 0, $bytes.Length)
    $s.Flush()
    $buf = New-Object byte[] 262144
    $total = 0
    $head = ""
    try {
        while ($true) {
            $n = $s.Read($buf, 0, $buf.Length)
            if ($n -le 0) { break }
            $total += $n
            if ($head.Length -lt 64) { $head = $head + [System.Text.Encoding]::ASCII.GetString($buf, 0, [Math]::Min($n, 64)) }
        }
    } catch {
        Write-Host ("  read error: " + $_.Exception.Message)
    }
    $c.Close()
    Write-Host ($path + " -> " + $total + " bytes  " + $head.Split("`r")[0])
}

Probe "/index.html"
$js = Get-ChildItem "..\dist\assets" -Filter "*.js" | Select-Object -First 1 -ExpandProperty Name
Probe ("/assets/" + $js)
Probe "/samples/void-figure.png"
Probe "/sources/list.json"
Probe "/sources/nope.png"
Probe "/shutdown"
Start-Sleep -Milliseconds 800
Write-Host ("alive-after-shutdown=" + (-not $p.HasExited))
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
Write-Host "--- http log ---"
Get-Content "void-http.log" -ErrorAction SilentlyContinue
