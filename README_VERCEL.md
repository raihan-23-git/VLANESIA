# VLANesia — Vercel + Supabase

Paket ini adalah versi Premium UI dengan backend yang telah disiapkan untuk Vercel Functions.

## Cara deploy

1. Ekstrak ZIP dan buka folder `VLANesia_GLOBAL_FINAL`. Upload **isi folder tersebut** ke root repository GitHub (jadi `vercel.json`, `package.json`, `public/`, `api/` langsung ada di root repo).
2. Supabase > SQL Editor > jalankan `supabase_setup.sql`.
3. Vercel > Add New > Project > Import repository GitHub. Framework Preset: **Other**, Root Directory: folder yang berisi `vercel.json` (biasanya `./`). Build Command biarkan kosong / Override nonaktif. Output Directory biarkan default.
4. Environment Variables di Vercel: `SUPABASE_URL` (URL project), `SUPABASE_SECRET_KEY` (secret/service_role key, jangan diunggah ke repo), `NODE_ENV=production`. Setidaknya pilih Production; Preview juga jika perlu testing.
5. Deploy, buka `https://domainmu.vercel.app/api/health`: `database: Supabase PostgreSQL`, `global: true` menandakan koneksi aktif.
6. Buka website, login alias, coba ping dan evaluasi, lalu cek tabel `sessions`, `attempts`, `evaluations` di Supabase.

**Penting:** `api/index.mjs` adalah Vercel Function yang mengadaptasi API Node.js lama. Vercel tidak menyimpan data ke file lokal. Jika Supabase belum disiapkan, API menolak permintaan. Desain UI, terminal simulasi, dan dashboard tetap dari ZIP versi premium.

## Menjalankan di laptop

`node server.js` atau klik `start.bat`; buka `http://127.0.0.1:3000`. Tanpa `.env`, mode lokal dipakai **hanya di laptop**. Untuk tes Supabase lokal, buat `.env` dari `.env.example`, jangan unggah ke GitHub.

## Catatan

- Login masih memakai alias sesi, **bukan autentikasi akun/password**. Dashboard guru belum memiliki pembatasan role. Jangan gunakan untuk data pribadi/sensitif sebelum menambah autentikasi dan otorisasi.
- Tidak ada validasi deploy live ke akun Vercel/Supabase; periksa log deploy apabila ada error.
