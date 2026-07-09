@echo off
setlocal

set SKIN_DIR=C:\Users\USER\Documents\Rainmeter\Skins\ClaudeUsage
set HOST_DIR=%SKIN_DIR%\native-host

echo.
echo === Claude Usage Monitor - Native Host Installer ===
echo.
echo Which browser?
echo   1. Google Chrome
echo   2. Microsoft Edge
echo   3. Both
echo.
set /p BROWSER="Enter 1, 2, or 3: "

if "%BROWSER%"=="1" goto chrome
if "%BROWSER%"=="2" goto edge
if "%BROWSER%"=="3" goto both
echo Invalid choice.
pause
exit /b 1

:chrome
echo.
set /p EXT_ID="Paste your Chrome extension ID (from chrome://extensions): "
if "%EXT_ID%"=="" ( echo ERROR: ID cannot be empty. & pause & exit /b 1 )
call :write_manifest "%LOCALAPPDATA%\Google\Chrome\User Data\NativeMessagingHosts" "%EXT_ID%"
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\claude.silkwires.usage" /ve /t REG_SZ /d "%LOCALAPPDATA%\Google\Chrome\User Data\NativeMessagingHosts\claude.silkwires.usage.json" /f
goto done

:edge
echo.
set /p EXT_ID="Paste your Edge extension ID (from edge://extensions): "
if "%EXT_ID%"=="" ( echo ERROR: ID cannot be empty. & pause & exit /b 1 )
call :write_manifest "%LOCALAPPDATA%\Microsoft\Edge\User Data\NativeMessagingHosts" "%EXT_ID%"
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\claude.silkwires.usage" /ve /t REG_SZ /d "%LOCALAPPDATA%\Microsoft\Edge\User Data\NativeMessagingHosts\claude.silkwires.usage.json" /f
goto done

:both
echo.
set /p CHROME_ID="Paste your Chrome extension ID (from chrome://extensions): "
set /p EDGE_ID="Paste your Edge extension ID (from edge://extensions): "
if "%CHROME_ID%"=="" ( echo ERROR: Chrome ID cannot be empty. & pause & exit /b 1 )
if "%EDGE_ID%"=="" ( echo ERROR: Edge ID cannot be empty. & pause & exit /b 1 )
call :write_manifest_both "%CHROME_ID%" "%EDGE_ID%"
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\claude.silkwires.usage" /ve /t REG_SZ /d "%LOCALAPPDATA%\Google\Chrome\User Data\NativeMessagingHosts\claude.silkwires.usage.json" /f
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\claude.silkwires.usage" /ve /t REG_SZ /d "%LOCALAPPDATA%\Microsoft\Edge\User Data\NativeMessagingHosts\claude.silkwires.usage.json" /f
goto done

:done
echo.
echo Done! Restart your browser(s), then reload the Rainmeter skin.
echo.
pause
exit /b 0

:: Subroutine: write manifest for a single browser
:write_manifest
set NMH_DIR=%~1
set EID=%~2
if not exist "%NMH_DIR%" mkdir "%NMH_DIR%"
(
  echo {
  echo   "name": "claude.silkwires.usage",
  echo   "description": "Claude Usage Monitor native host",
  echo   "path": "%HOST_DIR:\=\\%\\launch_host.bat",
  echo   "type": "stdio",
  echo   "allowed_origins": ["chrome-extension://%EID%/"]
  echo }
) > "%NMH_DIR%\claude.silkwires.usage.json"
exit /b 0

:: Subroutine: write separate manifests for Chrome and Edge (different IDs)
:write_manifest_both
set CID=%~1
set EID=%~2
set CHROME_NMH=%LOCALAPPDATA%\Google\Chrome\User Data\NativeMessagingHosts
set EDGE_NMH=%LOCALAPPDATA%\Microsoft\Edge\User Data\NativeMessagingHosts
if not exist "%CHROME_NMH%" mkdir "%CHROME_NMH%"
if not exist "%EDGE_NMH%" mkdir "%EDGE_NMH%"
(
  echo {
  echo   "name": "claude.silkwires.usage",
  echo   "description": "Claude Usage Monitor native host",
  echo   "path": "%HOST_DIR:\=\\%\\launch_host.bat",
  echo   "type": "stdio",
  echo   "allowed_origins": ["chrome-extension://%CID%/"]
  echo }
) > "%CHROME_NMH%\claude.silkwires.usage.json"
(
  echo {
  echo   "name": "claude.silkwires.usage",
  echo   "description": "Claude Usage Monitor native host",
  echo   "path": "%HOST_DIR:\=\\%\\launch_host.bat",
  echo   "type": "stdio",
  echo   "allowed_origins": ["chrome-extension://%EID%/"]
  echo }
) > "%EDGE_NMH%\claude.silkwires.usage.json"
exit /b 0
