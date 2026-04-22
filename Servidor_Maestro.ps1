$port = 8000
$ErrorActionPreference = "Stop"

# Get Local IP
$ip = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Wi-Fi","Ethernet" -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^169\.' -and $_.IPAddress -ne "127.0.0.1" } | Select-Object -ExpandProperty IPAddress -First 1)
if (-not $ip) { $ip = "127.0.0.1" }

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://*:$port/")
try {
    $listener.Start()
} catch {
    Write-Host "Error: No se pudo arrancar el servidor en el puerto $port. Asegurese de ejecutar como Administrador." -ForegroundColor Red
    Read-Host "Presiona Enter para salir..."
    exit
}

$ScriptDir = Split-Path $MyInvocation.MyCommand.Path -Parent
$dbFile = Join-Path $ScriptDir "base_de_datos.json"

if (-not (Test-Path $dbFile)) {
    Set-Content $dbFile "{`"techs`":[], `"data`":{}}" -Encoding UTF8
}

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "   SERVIDOR JABIL MASTER ENCENDIDO (ONLINE)" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Tus companeros pueden acceder desde sus PCs entrando a este enlace en Chrome:"
Write-Host " -> http://$ip`:$port/" -ForegroundColor Yellow
Write-Host "------------------------------------------------"
Write-Host " Manten esta ventana negra abierta durante el turno." 
Write-Host "================================================" -ForegroundColor Cyan

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        
        $url = $request.Url.LocalPath
        $method = $request.HttpMethod
        
        # CORS
        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        
        if ($method -eq "OPTIONS") {
            $response.StatusCode = 200
            $response.Close()
            continue
        }

        try {
            if ($url -eq "/api/data" -and $method -eq "GET") {
                $content = Get-Content -Raw -Path $dbFile
                $buffer = [System.Text.Encoding]::UTF8.GetBytes($content)
                $response.ContentType = "application/json"
                $response.ContentLength64 = $buffer.Length
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
            }
            elseif ($url -eq "/api/data" -and $method -eq "POST") {
                $reader = New-Object System.IO.StreamReader($request.InputStream, $request.ContentEncoding)
                $payload = $reader.ReadToEnd()
                $reader.Close()

                $currentDb = Get-Content -Raw -Path $dbFile | ConvertFrom-Json
                $currentDb.data = (ConvertFrom-Json $payload)
                $newJson = ConvertTo-Json -InputObject $currentDb -Depth 20 -Compress

                Set-Content -Path $dbFile -Value $newJson -Encoding UTF8

                $buffer = [System.Text.Encoding]::UTF8.GetBytes("{`"status`":`"ok`"}")
                $response.ContentType = "application/json"
                $response.ContentLength64 = $buffer.Length
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
            }
            elseif ($url -eq "/api/techs" -and $method -eq "POST") {
                $reader = New-Object System.IO.StreamReader($request.InputStream, $request.ContentEncoding)
                $payload = $reader.ReadToEnd()
                $reader.Close()

                $currentDb = Get-Content -Raw -Path $dbFile | ConvertFrom-Json
                $currentDb.techs = (ConvertFrom-Json $payload)
                $newJson = ConvertTo-Json -InputObject $currentDb -Depth 20 -Compress

                Set-Content -Path $dbFile -Value $newJson -Encoding UTF8

                $buffer = [System.Text.Encoding]::UTF8.GetBytes("{`"status`":`"ok`"}")
                $response.ContentType = "application/json"
                $response.ContentLength64 = $buffer.Length
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
            }
            else {
                $filePath = $ScriptDir + $url
                if ($url -eq "/") { $filePath = $ScriptDir + "\index.html" }
                
                if (Test-Path $filePath -PathType Leaf) {
                    $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                    switch ($ext) {
                        ".html" { $response.ContentType = "text/html; charset=utf-8" }
                        ".css"  { $response.ContentType = "text/css" }
                        ".js"   { $response.ContentType = "application/javascript" }
                        ".json" { $response.ContentType = "application/json" }
                        default { $response.ContentType = "application/octet-stream" }
                    }
                    
                    $fileBytes = [System.IO.File]::ReadAllBytes($filePath)
                    $response.ContentLength64 = $fileBytes.Length
                    $response.OutputStream.Write($fileBytes, 0, $fileBytes.Length)
                } else {
                    $response.StatusCode = 404
                }
            }
        } catch {
            Write-Host "Error en Peticion: $($_.Exception.Message)" -ForegroundColor Red
            $response.StatusCode = 500
        }
        
        $response.Close()
    }
} finally {
    $listener.Stop()
}
