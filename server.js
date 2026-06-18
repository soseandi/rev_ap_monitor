// server.js — Express API untuk monitoring AP NOZ.ID
const express = require("express");
const path = require("path");
const db = require("./db");
const { pingMany } = require("./mikrotik");

const app = express();
const PORT = process.env.PORT || 3005;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- Helper ----------
function isValidIp(ip) {
  return /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(ip);
}

// Ambil daftar AP + nama site untuk keperluan ping
function getApsForPing(where, params) {
  return db.prepare(`
    SELECT ap.id, ap.ip_address, ap.enabled, s.name AS site_name
    FROM access_points ap
    JOIN areas a ON ap.area_id = a.id
    JOIN sites s ON a.site_id = s.id
    ${where}
  `).all(...params);
}

// ---------- SITES ----------
app.get("/api/sites", (req, res) => {
  res.json(db.prepare("SELECT * FROM sites ORDER BY name").all());
});

// ---------- AREAS ----------
app.get("/api/areas", (req, res) => {
  const { site_id } = req.query;
  if (site_id) {
    res.json(db.prepare("SELECT * FROM areas WHERE site_id = ? ORDER BY name").all(site_id));
  } else {
    res.json(db.prepare("SELECT * FROM areas ORDER BY name").all());
  }
});

app.post("/api/areas", (req, res) => {
  const { site_id, name } = req.body;
  if (!site_id || !name) return res.status(400).json({ error: "Site dan nama wilayah wajib diisi." });
  try {
    const info = db.prepare("INSERT INTO areas (site_id, name) VALUES (?, ?)").run(site_id, name.trim());
    res.json({ id: info.lastInsertRowid, site_id, name: name.trim() });
  } catch (e) {
    res.status(400).json({ error: "Wilayah dengan nama itu sudah ada di site ini." });
  }
});

app.put("/api/areas/:id", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Nama wilayah wajib diisi." });
  db.prepare("UPDATE areas SET name = ? WHERE id = ?").run(name.trim(), req.params.id);
  res.json({ ok: true });
});

app.delete("/api/areas/:id", (req, res) => {
  const count = db.prepare("SELECT COUNT(*) AS n FROM access_points WHERE area_id = ?").get(req.params.id).n;
  if (count > 0) {
    return res.status(409).json({
      error: `Wilayah masih berisi ${count} access point. Pindahkan atau hapus AP-nya dulu.`
    });
  }
  db.prepare("DELETE FROM areas WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- ACCESS POINTS ----------
app.get("/api/aps", (req, res) => {
  const { site_id, area_id } = req.query;
  const conds = [];
  const params = [];
  if (area_id) { conds.push("a.id = ?"); params.push(area_id); }
  if (site_id) { conds.push("s.id = ?"); params.push(site_id); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const rows = db.prepare(`
    SELECT ap.*, a.name AS area_name, a.site_id, s.name AS site_name
    FROM access_points ap
    JOIN areas a ON ap.area_id = a.id
    JOIN sites s ON a.site_id = s.id
    ${where}
    ORDER BY s.name, a.name, ap.name
  `).all(...params);
  res.json(rows);
});

app.post("/api/aps", (req, res) => {
  const { name, ip_address, latitude, longitude, area_id } = req.body;
  if (!name || !ip_address || !area_id)
    return res.status(400).json({ error: "Nama, IP, dan wilayah wajib diisi." });
  if (!isValidIp(ip_address))
    return res.status(400).json({ error: "Format IP address tidak valid." });
  const info = db.prepare(`
    INSERT INTO access_points (name, ip_address, latitude, longitude, area_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(name.trim(), ip_address.trim(), latitude || null, longitude || null, area_id);
  res.json({ id: info.lastInsertRowid });
});

app.put("/api/aps/:id", (req, res) => {
  const { name, ip_address, latitude, longitude, area_id } = req.body;
  if (ip_address && !isValidIp(ip_address))
    return res.status(400).json({ error: "Format IP address tidak valid." });
  db.prepare(`
    UPDATE access_points
    SET name = ?, ip_address = ?, latitude = ?, longitude = ?, area_id = ?
    WHERE id = ?
  `).run(name.trim(), ip_address.trim(), latitude || null, longitude || null, area_id, req.params.id);
  res.json({ ok: true });
});

app.delete("/api/aps/:id", (req, res) => {
  db.prepare("DELETE FROM access_points WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.patch("/api/aps/:id/toggle", (req, res) => {
  const ap = db.prepare("SELECT enabled FROM access_points WHERE id = ?").get(req.params.id);
  if (!ap) return res.status(404).json({ error: "AP tidak ditemukan." });
  const next = ap.enabled ? 0 : 1;
  const status = next ? "unknown" : "disabled";
  db.prepare("UPDATE access_points SET enabled = ?, last_status = ? WHERE id = ?")
    .run(next, status, req.params.id);
  res.json({ enabled: next, last_status: status });
});

// ---------- PING ----------
// body: { mode: "ap"|"site"|"area", target_id, only_down? }
app.post("/api/ping", async (req, res) => {
  const { mode, target_id, only_down } = req.body;
  let where = "WHERE ap.enabled = 1";
  const params = [];

  if (mode === "ap")   { where += " AND ap.id = ?";   params.push(target_id); }
  if (mode === "site") { where += " AND s.id = ?";    params.push(target_id); }
  if (mode === "area") { where += " AND a.id = ?";    params.push(target_id); }
  if (only_down)       { where += " AND ap.last_status = 'down'"; }

  const aps = getApsForPing(where, params);
  if (!aps.length) return res.json({ results: [], message: "Tidak ada AP aktif yang cocok." });

  const now = new Date().toISOString();
  const upd = db.prepare(`
    UPDATE access_points
    SET last_status = ?, last_loss = ?, last_rtt = ?, last_checked = ?
    WHERE id = ?
  `);

  const results = await pingMany(aps, (apId, r) => {
    upd.run(r.status, r.loss, r.rtt, now, apId);
  });

  res.json({ results, checked: now, total: aps.length });
});

app.listen(PORT, () => console.log(`AP Monitor berjalan di port ${PORT}`));
