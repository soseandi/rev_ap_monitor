// config/sites.js
// Kredensial MikroTik per site. JANGAN commit file ini ke repo publik.
// Host = IP MikroTik di jaringan WireGuard (mis. 192.168.100.x).
// Cocokkan field "name" dengan kolom sites.name di database.
//
// Catatan keamanan: simpan kredensial di sini (server-side) atau lebih baik
// lewat environment variable. Frontend & database TIDAK menyimpan password.

module.exports = {
  // key = nama site (harus sama dengan kolom name di tabel sites)
  "NOZ.ID1": {
    host: process.env.MT_NOZ1_HOST || "192.168.100.1",
    user: process.env.MT_NOZ1_USER || "apimonitor",
    password: process.env.MT_NOZ1_PASS || "ganti-password-ini",
    port: Number(process.env.MT_NOZ1_PORT) || 8728, // 8728 plain, 8729 TLS
    tls: process.env.MT_NOZ1_TLS === "true" || false
  },
  "NOZ.ID2": {
    host: process.env.MT_NOZ2_HOST || "192.168.100.2",
    user: process.env.MT_NOZ2_USER || "apimonitor",
    password: process.env.MT_NOZ2_PASS || "ganti-password-ini",
    port: Number(process.env.MT_NOZ2_PORT) || 8728,
    tls: process.env.MT_NOZ2_TLS === "true" || false
  }
};
