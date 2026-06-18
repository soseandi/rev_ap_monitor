// db.js — inisialisasi SQLite + helper query
const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "ap_monitor.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS sites (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS areas (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER NOT NULL,
    name    TEXT NOT NULL,
    FOREIGN KEY (site_id) REFERENCES sites(id),
    UNIQUE (site_id, name)
  );

  CREATE TABLE IF NOT EXISTS access_points (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    ip_address   TEXT NOT NULL,
    latitude     REAL,
    longitude    REAL,
    area_id      INTEGER NOT NULL,
    enabled      INTEGER NOT NULL DEFAULT 1,
    last_status  TEXT DEFAULT 'unknown',   -- up | down | disabled | unknown
    last_loss    INTEGER,                   -- packet loss %
    last_rtt     REAL,                      -- avg rtt ms
    last_checked TEXT,
    FOREIGN KEY (area_id) REFERENCES areas(id)
  );
`);

// Seed dua site jika belum ada
const seedSite = db.prepare("INSERT OR IGNORE INTO sites (name) VALUES (?)");
seedSite.run("NOZ.ID1");
seedSite.run("NOZ.ID2");

module.exports = db;
