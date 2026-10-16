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
$BuildVenv = Join-Path $Root ".build-venv"
$BuildPython = Join-Path $BuildVenv "Scripts\python.exe"

function Find-CompatiblePython {
    # Scoop has python.exe but commonly no Windows py launcher.
    foreach ($name in @("python", "python3", "py")) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if (-not $command) { continue }
        $executable = $command.Source
        $arguments = @()
        if ($name -eq "py") { $arguments = @("-3") }
        try {
            & $executable @arguments -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" 2>$null
            if ($LASTEXITCODE -eq 0) {
                return @{ Executable = $executable; Args = $arguments }
            }
        } catch {
            # Ignore Windows Store aliases and unsupported installations.
        }
    }
    throw "Python 3.10+ nao encontrado. Execute 'scoop install python', reabra o terminal e tente novamente."
}

Write-Host "Media Finder Pro: configurando assistente local..."
$Python = Find-CompatiblePython
Write-Host "Python encontrado: $($Python.Executable)"
$Interpreter = $Python.Executable
$InterpreterArgs = @($Python.Args)

# Create a dedicated build environment without requiring manual activation.
if (-not (Test-Path $BuildPython)) {
    Write-Host "Criando ambiente de compilacao isolado..."
    & $Interpreter @InterpreterArgs -m venv $BuildVenv
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $BuildPython)) {
        throw "Falha ao criar o ambiente Python. Verifique a instalacao do Python e o modulo venv."
    }
}
Write-Host "Instalando PyInstaller no ambiente isolado..."
& $BuildPython -m pip install --disable-pip-version-check --upgrade pyinstaller
if ($LASTEXITCODE -ne 0) {
    throw "Falha ao instalar o PyInstaller. Verifique sua conexao e tente novamente."
}

Write-Host "Compilando o Native Messaging Host..."
& $BuildPython -m PyInstaller --noconfirm --onefile --clean --name mediafinder_native --distpath $Dist --workpath (Join-Path $Root "build") --specpath $Root (Join-Path $Root "host.py")
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $Executable)) {
    throw "Falha ao compilar o assistente local."
}

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

Write-Host "Assistente registrado no Chrome e Brave para a extensao $ExtensionId."
if (-not (Get-Command yt-dlp -ErrorAction SilentlyContinue)) {
    Write-Warning "yt-dlp ausente no PATH. Instale: scoop install yt-dlp"
}
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Warning "FFmpeg ausente no PATH. Instale: scoop install ffmpeg"
}
Write-Host "Instalacao concluida. Feche completamente e reabra o navegador."
