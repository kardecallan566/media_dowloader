param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-p]{32}$')]
    [string]$ExtensionId
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dist = Join-Path $Root "dist"
$Executable = Join-Path $Dist "mediafinder_native.exe"
$ManifestPath = Join-Path $Root "com.mediafinder.bridge.json"

Write-Host "Compilando assistente local a partir de native/host.py..."
if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
    throw "Python não encontrado. Instale Python 3.10+ e o launcher py."
}
& py -m pip install --user --upgrade pyinstaller
if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar PyInstaller." }
& py -m PyInstaller --onefile --clean --name mediafinder_native --distpath $Dist --workpath (Join-Path $Root "build") --specpath $Root (Join-Path $Root "host.py")
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $Executable)) { throw "Falha ao criar o assistente local." }

$Definition = @{
    name = "com.mediafinder.bridge"
    description = "Media Finder Pro - helper local opcional"
    path = $Executable
    type = "stdio"
    allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($ManifestPath, $Definition, [System.Text.UTF8Encoding]::new($false))
foreach ($Key in @(
    "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.mediafinder.bridge",
    "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.mediafinder.bridge"
)) {
    New-Item -Path $Key -Force | Out-Null
    Set-Item -Path $Key -Value $ManifestPath
}
Write-Host "Registrado no Chrome e Brave para a extensão $ExtensionId"
if (-not (Get-Command yt-dlp -ErrorAction SilentlyContinue)) {
    Write-Warning "yt-dlp ausente. Instale com: scoop install yt-dlp"
}
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Warning "FFmpeg ausente. Instale com: scoop install ffmpeg"
}
Write-Host "Feche e reabra o navegador. O assistente só será usado quando você clicar para baixar."
