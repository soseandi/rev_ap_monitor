# NOZ.ID — AP Monitor

Monitoring ping Access Point lewat MikroTik API. VPS memerintahkan MikroTik
(`/ping`) untuk ping AP lokal, hasil ditampilkan di dashboard + peta satelit.

## Arsitektur

```
Browser (dashboard + peta Leaflet)
   |  REST API
VPS Node.js/Express  --(RouterOS API via WireGuard)-->  MikroTik  --ping-->  AP lokal
   |
SQLite (sites / areas / access_points)
```

- Ping manual: per AP / per site / per wilayah / semua / hanya yang down.
- Concurrency 12 ping paralel per site, timeout 4 dtk per AP.
- AP nonaktif di-skip saat ping, tetap tampil (abu-abu) di peta.
- Hapus wilayah yang masih berisi AP ditolak.

## Hierarki data

Site (NOZ.ID1 / NOZ.ID2) → Wilayah → Access Point. Tiap wilayah milik satu site.

## Setup di VPS (Ubuntu)

```bash
# 1. salin folder ap-monitor ke VPS, lalu:
cd ap-monitor
npm install                 # better-sqlite3 dikompilasi di sini (butuh build-essential, python3)
# jika gagal kompilasi: sudo apt install -y build-essential python3

# 2. set kredensial MikroTik lewat environment (jangan taruh password di kode)
export MT_NOZ1_HOST=192.168.100.1   # IP MikroTik NOZ.ID1 di jaringan WireGuard
export MT_NOZ1_USER=apimonitor
export MT_NOZ1_PASS=xxxxx
export MT_NOZ2_HOST=192.168.100.2
export MT_NOZ2_USER=apimonitor
export MT_NOZ2_PASS=xxxxx
# port default 8728 (plain). Untuk TLS: MT_NOZ1_PORT=8729 MT_NOZ1_TLS=true

# 3. jalankan dengan PM2
pm2 start server.js --name ap-monitor
pm2 save
```

Default port server: 3005 (ubah dengan `PORT=...`).

## Persiapan di MikroTik

1. Aktifkan service API:
   `/ip service enable api` (atau `api-ssl` untuk TLS)
2. Buat user khusus read + test (untuk perintah `/ping`):
   `/user add name=apimonitor password=xxxxx group=read`
   (group `read` sudah cukup untuk `/ping`; sesuaikan jika perlu)
3. Pastikan MikroTik bisa ping ke tiap AP, dan VPS terhubung ke MikroTik
   lewat WireGuard (gunakan IP WireGuard MikroTik sebagai `MT_*_HOST`).

## Cocokkan nama site

Kolom `sites.name` di database (`NOZ.ID1`, `NOZ.ID2`) harus sama dengan key di
`config/sites.js`. Itulah yang memetakan AP ke koneksi MikroTik yang benar.

## Peta

Leaflet + tile satelit Esri World Imagery (gratis) + markercluster untuk 300+ AP.
Pusat peta default di `public/app.js` (`DEFAULT_CENTER`) — sesuaikan ke area Anda.

## Catatan

- Kredensial MikroTik tidak pernah disimpan di database/frontend, hanya di
  environment server.
- Untuk performa 300 AP, ping per wilayah/site lebih ringan daripada ping semua
  sekaligus.
