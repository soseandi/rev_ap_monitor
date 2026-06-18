// mikrotik.js — koneksi RouterOS API + ping dengan batas concurrency
const { RouterOSAPI } = require("node-routeros");
const sitesConfig = require("./config/sites");

const PING_COUNT = 3;        // jumlah paket per ping
const CONCURRENCY = 12;      // ping paralel per batch
const PING_TIMEOUT_MS = 4000; // batas waktu satu ping

// Cache koneksi per site supaya tidak connect berulang
const connCache = {};

async function getConnection(siteName) {
  const cfg = sitesConfig[siteName];
  if (!cfg) throw new Error(`Konfigurasi MikroTik untuk site "${siteName}" tidak ditemukan`);

  if (connCache[siteName] && connCache[siteName].connected) {
    return connCache[siteName];
  }

  const conn = new RouterOSAPI({
    host: cfg.host,
    user: cfg.user,
    password: cfg.password,
    port: cfg.port,
    tls: cfg.tls ? {} : undefined,
    timeout: 10
  });

  await conn.connect();
  connCache[siteName] = conn;
  return conn;
}

// Jalankan satu ping lewat MikroTik milik site tertentu
async function pingOne(siteName, ip) {
  try {
    const conn = await getConnection(siteName);
    const res = await conn.write("/ping", [
      `=address=${ip}`,
      `=count=${PING_COUNT}`
    ]);

    // node-routeros mengembalikan tiap balasan ping sebagai 1 baris.
    // Ambil ringkasan dari baris terakhir / agregasi.
    let received = 0;
    let rttSum = 0;
    let rttCount = 0;

    for (const row of res) {
      // row.received bisa muncul di baris ringkasan; fallback hitung manual
      if (row.time) {
        rttSum += parseFloat(row.time); // mis. "12ms" -> NaN; bersihkan
        rttCount++;
      }
      if (row.status === undefined && row.host) received++;
    }

    // Cara aman: hitung dari field "received" pada baris terakhir bila ada
    const last = res[res.length - 1] || {};
    const sent = parseInt(last.sent || PING_COUNT, 10);
    const recv = parseInt(last.received !== undefined ? last.received : received, 10);
    const loss = sent > 0 ? Math.round(((sent - recv) / sent) * 100) : 100;

    // avg-rtt kadang tersedia di ringkasan (mis. "avg-rtt":"5ms")
    let rtt = null;
    if (last["avg-rtt"]) rtt = parseFloat(last["avg-rtt"]);
    else if (rttCount > 0) rtt = rttSum / rttCount;

    const status = recv > 0 ? "up" : "down";
    return { status, loss, rtt: isNaN(rtt) ? null : rtt };
  } catch (err) {
    return { status: "down", loss: 100, rtt: null, error: err.message };
  }
}

// Ping banyak AP dengan batas concurrency.
// aps = [{ id, ip_address, site_name }]
// onResult(apId, result) dipanggil setiap satu AP selesai (untuk progress).
async function pingMany(aps, onResult) {
  const queue = [...aps];
  const results = {};

  async function worker() {
    while (queue.length) {
      const ap = queue.shift();
      const r = await Promise.race([
        pingOne(ap.site_name, ap.ip_address),
        new Promise((resolve) =>
          setTimeout(() => resolve({ status: "down", loss: 100, rtt: null, error: "timeout" }), PING_TIMEOUT_MS)
        )
      ]);
      results[ap.id] = r;
      if (onResult) onResult(ap.id, r);
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, aps.length) }, worker);
  await Promise.all(workers);
  return results;
}

module.exports = { pingOne, pingMany };
