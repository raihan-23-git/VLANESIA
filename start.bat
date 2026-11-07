@echo off
setlocal
title VLANesia - Supabase Cloud
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js belum terpasang atau belum masuk PATH.
  echo Jalankan: node -v
  pause
  exit /b 1
)

if not exist ".env" echo [INFO] File .env tidak ada: VLANesia jalan dalam MODE LOKAL tanpa Supabase.

echo Menjalankan VLANesia...
start "VLANesia Server" /min cmd /c "cd /d "%~dp0" && node server.js"

echo Menunggu server dan Supabase siap...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; for($i=0;$i -lt 40;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/api/health -TimeoutSec 2; if($r.StatusCode -eq 200){$ok=$true;break} } catch {}; Start-Sleep -Milliseconds 500 }; if(-not $ok){exit 1}"
if errorlevel 1 (
  echo.
  echo [ERROR] Server aktif, tetapi koneksi Supabase belum siap.
  echo Cek isi .env, lalu pastikan supabase_setup.sql sudah dijalankan.
  echo Buka http://127.0.0.1:3000/api/health untuk melihat status.
  pause
  exit /b 1
)

echo Supabase terhubung. Membuka VLANesia...
start "" http://127.0.0.1:3000
exit /b 0
