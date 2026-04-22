@echo off
color 0A
title Servidor Maestro - Productividad Jabil

:: Verificar privilegios
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo ==================================================
    echo ADVERTENCIA DE RED INTERNA
    echo ==================================================
    echo.
    echo Para que otras computadoras puedan conectarse a esta PC,
    echo se requiere abrir el puerto 8000 en el Firewall.
    echo.
    echo Solicitando elevacion de permisos...
    goto UACPrompt
) else ( goto gotAdmin )

:UACPrompt
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    echo UAC.ShellExecute "cmd.exe", "/c ""%~s0""", "", "runas", 1 >> "%temp%\getadmin.vbs"
    "%temp%\getadmin.vbs"
    exit /B

:gotAdmin
    if exist "%temp%\getadmin.vbs" ( del "%temp%\getadmin.vbs" )
    pushd "%CD%"
    CD /D "%~dp0"

echo.
echo Iniciando motor de Servidor PowerShell...
powershell -NoProfile -ExecutionPolicy Bypass -File "Servidor_Maestro.ps1"
pause
