# VLANesia — Telkom-style UI + Supabase Global Database

Versi ini mempertahankan seluruh fungsi VLANesia (login/sesi siswa, CLI terbimbing, simulasi VLAN, Uji Ping dengan amplop, diagnostik, submit evaluasi/refleksi, dan dashboard guru), memakai UI wide-corporate sesuai referensi screenshot yang diberikan, dan mengganti penyimpanan SQLite lokal menjadi **Supabase PostgreSQL cloud**.

## 1. Yang berubah
- UI: header putih lebar, logo kiri, navbar horizontal, hero besar kiri + visual jaringan kanan, ruang putih luas, aksen VLANesia merah/coral.
- Database: tidak lagi memakai `data/vlanesia.db`.
- Data sekarang tersimpan pada Supabase dan dapat dipakai dari backend yang di-host di internet.
- Secret key Supabase hanya dibaca oleh `server.js`, tidak pernah dikirim ke browser.

## 2. Buat database Supabase
1. Buat project di https://supabase.com/.
2. Buka **SQL Editor**.
3. Buat query baru.
4. Copy seluruh isi `supabase_setup.sql` lalu klik **Run**.
5. Pastikan tabel berikut muncul di Table Editor:
   - `sessions`
   - `attempts`
   - `evaluations`
   - `activity_logs`

## 3. Isi koneksi database
1. Di folder VLANesia, copy `.env.example` lalu rename menjadi `.env`.
2. Dari Dashboard Supabase ambil:
   - Project URL → `SUPABASE_URL`
   - Secret/server-side key → `SUPABASE_SECRET_KEY`
3. Isi `.env` seperti:

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SECRET_KEY=sb_secret_xxxxxxxxx
PORT=3000
```

**Jangan upload `.env` ke GitHub dan jangan menaruh secret key di `public/app.js`.**

## 4. Jalankan di laptop
Pastikan Node.js 22+ tersedia (`node -v`). Lalu klik dua kali `start.bat`.

Launcher akan:
1. mengecek Node.js,
2. mengecek `.env`,
3. menjalankan server,
4. menguji `/api/health` sampai Supabase siap,
5. membuka `http://127.0.0.1:3000`.

## 5. Agar website juga bisa dibuka global
Supabase membuat **database** global, tetapi jika Node.js masih berjalan di laptop, website tetap hanya tersedia dari laptop/jaringanmu. Agar siswa dapat membuka VLANesia dari internet, deploy folder ini ke Render/Railway/VPS/hosting Node lainnya.

File `render.yaml` sudah disertakan untuk mempermudah Render. Saat deploy, tambahkan environment variables:
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `NODE_ENV=production`

Jangan commit file `.env`.

## 6. Data yang tersimpan
### sessions
Alias siswa, kelas, waktu mulai, dan last seen.

### attempts
Skenario/level, berhasil atau tidak, skor, jumlah petunjuk, jenis error, dan diagnosis.

### evaluations
Skor evaluasi, jumlah benar, refleksi kesulitan, dan manfaat.

### activity_logs
Aktivitas penting seperti perintah CLI dan penggunaan petunjuk.

Dashboard guru membaca rekap seluruh data cloud tersebut melalui backend VLANesia.

## 7. Catatan keamanan
RLS diaktifkan pada tabel tanpa policy public. Browser tidak terhubung langsung ke tabel Supabase. Backend memakai secret/service-role key yang dapat melewati RLS, sehingga key tersebut wajib disimpan hanya sebagai environment variable pada server.
