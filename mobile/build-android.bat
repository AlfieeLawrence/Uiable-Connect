@echo off
rem Build Uiable Connect for Android (debug APK). Needs Node.js 20+, JDK 17 and the Android SDK.
rem Easiest: install Android Studio (it brings both), open it once, then double-click this file.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org & pause & exit /b 1)
if "%JAVA_HOME%"=="" if exist "%ProgramFiles%\Android\Android Studio\jbr" set "JAVA_HOME=%ProgramFiles%\Android\Android Studio\jbr"
if "%JAVA_HOME%"=="" (echo JDK 17 not found. Install Android Studio or Temurin 17 and set JAVA_HOME. & pause & exit /b 1)
if "%ANDROID_HOME%"=="" if exist "%LOCALAPPDATA%\Android\Sdk" set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
if "%ANDROID_HOME%"=="" (echo Android SDK not found. Install Android Studio or set ANDROID_HOME. & pause & exit /b 1)
> android\local.properties echo sdk.dir=%ANDROID_HOME:\=\\%
call npm install || goto :fail
call npm run web || goto :fail
call npx cap sync android || goto :fail
cd android
call gradlew.bat assembleDebug || goto :fail
copy /y app\build\outputs\apk\debug\app-debug.apk ..\Uiable-Connect-android-debug.apk >nul
echo.
echo Done: mobile\Uiable-Connect-android-debug.apk
echo Copy it to your phone and open it, or: adb install -r Uiable-Connect-android-debug.apk
echo For a signed release build see the Mobile section of README.md.
pause
exit /b 0
:fail
echo Build failed. & pause & exit /b 1
