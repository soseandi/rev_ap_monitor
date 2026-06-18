// app.js — NOZ.ID AP Monitor (dashboard) — versi tahan-error
(function () {
  const $ = (s) => document.querySelector(s);

  function fatal(msg) {
    document.body.innerHTML =
      '<div style="font-family:system-ui;max-width:600px;margin:60px auto;padding:24px;' +
      'background:#fff;border-radius:14px;box-shadow:0 2px 14px rgba(0,0,0,.1);color:#1f2733">' +
      '<h2 style="color:#ef4d63;margin-bottom:10px">Gagal memuat dashboard</h2>' +
      '<p style="line-height:1.6">' + msg + '</p></div>';
  }

  function start() {
    if (typeof L === "undefined") {
      fatal("Library peta (Leaflet) tidak termuat. Biasanya karena VPS/browser tidak bisa " +
            "mengakses CDN. Pastikan ada koneksi internet, atau gunakan versi self-hosted Leaflet.");
      return;
    }

    const api = (url, opt) => fetch(url, opt).then(r => r.json());

    // ====== BRANDING (ubah di sini) ======
    const BRAND = { name: "NOZ.ID", sub: "AP Monitor", greeting: "Selamat datang" };
    const DEFAULT_CENTER = [-4.55, 121.9];
    const DEFAULT_ZOOM = 12;

    let state = { sites: [], areas: [], aps: [], markers: {} };

    if ($("#brandName")) $("#brandName").textContent = BRAND.name;
    if ($("#brandSub")) $("#brandSub").textContent = BRAND.sub;
    if ($("#greetTitle")) $("#greetTitle").textContent = BRAND.greeting;

    // ---------- Map ----------
    const satTile = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, maxNativeZoom: 17, attribution: "Tiles © Esri" }
    );
    const map = L.map("map", { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, layers: [satTile] });

    const hasCluster = typeof L.markerClusterGroup === "function";
    const cluster = hasCluster ? L.markerClusterGroup({ maxClusterRadius: 45 }) : L.layerGroup();
    map.addLayer(cluster);

    const makeIcon = (st) => L.divIcon({ className: "", html: '<div class="ap-marker ' + st + '"></div>', iconSize: [16,16], iconAnchor: [8,8] });

    // ---------- Toast ----------
    function toast(msg, isErr) {
      const t = document.createElement("div");
      t.className = "toast" + (isErr ? " err" : "");
      t.textContent = msg;
      $("#toasts").appendChild(t);
      setTimeout(() => t.remove(), 3500);
    }

    // ---------- Loaders ----------
    async function loadSites() {
      state.sites = await api("/api/sites");
      const opts = state.sites.map(s => '<option value="' + s.id + '">' + s.name + '</option>').join("");
      $("#fSite").innerHTML = '<option value="">Semua site</option>' + opts;
      $("#areaSite").innerHTML = opts;
      $("#apSite").innerHTML = opts;
    }
    async function loadAreas() {
      state.areas = await api("/api/areas");
      renderAreaList();
    }
    async function loadAps() {
      const site = $("#fSite").value, area = $("#fArea").value;
      let url = "/api/aps?";
      if (site) url += "site_id=" + site + "&";
      if (area) url += "area_id=" + area;
      state.aps = await api(url);
      renderTable(); renderMarkers(); renderCounts();
    }

    // ---------- Counts ----------
    function renderCounts() {
      const a = state.aps;
      $("#cUp").textContent = a.filter(x => x.enabled && x.last_status === "up").length;
      $("#cDown").textContent = a.filter(x => x.enabled && x.last_status === "down").length;
      $("#cDis").textContent = a.filter(x => !x.enabled).length;
      $("#cUnk").textContent = a.filter(x => x.enabled && (x.last_status === "unknown" || !x.last_status)).length;
    }

    // ---------- Table ----------
    const statusOf = (ap) => !ap.enabled ? "disabled" : (ap.last_status || "unknown");
    const statusLabel = { up: "Online", down: "Offline", disabled: "Nonaktif", unknown: "Belum dicek" };
    function renderTable() {
      const q = $("#search").value.toLowerCase();
      const list = state.aps.filter(a => a.name.toLowerCase().includes(q) || a.ip_address.includes(q));
      if (!list.length) { $("#apBody").innerHTML = '<tr><td colspan="5"><div class="empty">Belum ada access point.</div></td></tr>'; return; }
      $("#apBody").innerHTML = list.map(ap => {
        const st = statusOf(ap);
        const rtt = (ap.last_status === "up" && ap.last_rtt != null) ? ap.last_rtt.toFixed(0) + " ms" : "—";
        return '<tr>' +
          '<td><div class="ap-name">' + ap.name + '</div><div class="ap-sub">' + ap.ip_address + '</div></td>' +
          '<td>' + ap.area_name + '<div class="ap-sub" style="font-family:var(--sans)">' + ap.site_name + '</div></td>' +
          '<td><span class="badge ' + st + '"><span class="d"></span>' + statusLabel[st] + '</span></td>' +
          '<td class="rtt">' + rtt + '</td>' +
          '<td><div class="row-acts">' +
            '<button class="icon-btn" title="Ping" onclick="pingSingle(' + ap.id + ')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>' +
            '<button class="icon-btn" title="Edit" onclick="editAp(' + ap.id + ')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' +
            '<button class="icon-btn" title="' + (ap.enabled?"Nonaktifkan":"Aktifkan") + '" onclick="toggleAp(' + ap.id + ')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg></button>' +
          '</div></td>' +
        '</tr>';
      }).join("");
    }

    // ---------- Markers ----------
    let mapFitted = false;
    function renderMarkers() {
      cluster.clearLayers(); state.markers = {};
      const coords = [];
      state.aps.forEach(ap => {
        if (ap.latitude == null || ap.longitude == null) return;
        const m = L.marker([ap.latitude, ap.longitude], { icon: makeIcon(statusOf(ap)) });
        m.bindPopup(popupHtml(ap));
        cluster.addLayer(m); state.markers[ap.id] = m;
        coords.push([ap.latitude, ap.longitude]);
      });
      // auto-zoom ke sebaran pin (sekali, saat pertama ada data)
      if (coords.length && !mapFitted) {
        map.fitBounds(coords, { padding: [40, 40], maxZoom: 16 });
        mapFitted = true;
      }
    }
    function popupHtml(ap) {
      const st = statusOf(ap);
      const rttTxt = (ap.last_rtt != null && st === "up") ? "· " + ap.last_rtt.toFixed(0) + "ms" : "";
      return '<div style="font-family:system-ui;min-width:170px">' +
        '<strong>' + ap.name + '</strong><br>' +
        '<span style="font-family:monospace;font-size:12px">' + ap.ip_address + '</span><br>' +
        ap.site_name + ' · ' + ap.area_name + '<br>' +
        'Status: <b>' + statusLabel[st] + '</b> ' + rttTxt + '<br>' +
        '<button onclick="pingSingle(' + ap.id + ')" style="margin-top:7px;cursor:pointer;background:#18c07a;color:#fff;border:none;padding:5px 10px;border-radius:6px">Ping</button> ' +
        '<button onclick="editAp(' + ap.id + ')" style="margin-top:7px;cursor:pointer;background:#eef1f4;border:none;padding:5px 10px;border-radius:6px">Edit</button>' +
      '</div>';
    }

    // ---------- Area list ----------
    function renderAreaList() {
      if (!state.areas.length) { $("#areaList").innerHTML = '<div class="empty">Belum ada wilayah.</div>'; return; }
      const siteName = (id) => (state.sites.find(s => s.id === id) || {}).name || "";
      $("#areaList").innerHTML = state.areas.map(a =>
        '<div class="area-item">' +
          '<div class="info"><div class="nm">' + a.name + '</div><div class="meta">' + siteName(a.site_id) + '</div></div>' +
          '<button class="icon-btn" title="Hapus" onclick="deleteArea(' + a.id + ')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +
        '</div>').join("");
    }

    // ---------- Filters ----------
    const areasForSite = (sid) => state.areas.filter(a => String(a.site_id) === String(sid));
    $("#fSite").addEventListener("change", () => {
      const opts = areasForSite($("#fSite").value).map(a => '<option value="' + a.id + '">' + a.name + '</option>').join("");
      $("#fArea").innerHTML = '<option value="">Semua wilayah</option>' + opts;
      loadAps();
    });
    $("#fArea").addEventListener("change", loadAps);
    $("#search").addEventListener("input", renderTable);

    // ---------- Ping ----------
    $("#pingMode").addEventListener("change", () => {
      const mode = $("#pingMode").value, wrap = $("#pingTargetWrap"), sel = $("#pingTarget");
      if (mode === "all") { wrap.style.display = "none"; return; }
      wrap.style.display = "block";
      if (mode === "site") { $("#pingTargetLabel").textContent = "Pilih site"; sel.innerHTML = state.sites.map(s => '<option value="' + s.id + '">' + s.name + '</option>').join(""); }
      else if (mode === "area") { $("#pingTargetLabel").textContent = "Pilih wilayah"; sel.innerHTML = state.areas.map(a => '<option value="' + a.id + '">' + a.name + '</option>').join(""); }
      else if (mode === "ap") { $("#pingTargetLabel").textContent = "Pilih AP"; sel.innerHTML = state.aps.map(a => '<option value="' + a.id + '">' + a.name + ' (' + a.ip_address + ')</option>').join(""); }
    });
    async function runPing(body) {
      $("#progress").classList.add("show"); $("#progBar").style.width = "12%";
      $("#progLbl").textContent = "Mengirim perintah ke MikroTik...";
      try {
        const res = await api("/api/ping", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
        $("#progBar").style.width = "100%";
        $("#progLbl").textContent = "Selesai · " + (res.total || 0) + " AP diperiksa";
        await loadAps();
        setTimeout(() => { $("#progress").classList.remove("show"); $("#progBar").style.width = "0"; }, 1600);
      } catch (e) { $("#progLbl").textContent = "Gagal menjalankan ping."; toast("Gagal menjalankan ping.", true); }
    }
    $("#btnPing").addEventListener("click", () => {
      const mode = $("#pingMode").value;
      if (mode === "all") return runPing({ mode: "all" });
      const target = $("#pingTarget").value;
      if (!target) return toast("Pilih target dulu.", true);
      runPing({ mode: mode, target_id: target });
    });
    $("#btnPingDown").addEventListener("click", () => runPing({ mode: "all", only_down: true }));
    window.pingSingle = (id) => runPing({ mode: "ap", target_id: id });

    // ---------- Toggle ----------
    window.toggleAp = async (id) => { await api("/api/aps/" + id + "/toggle", { method:"PATCH" }); loadAps(); };

    // ---------- Area add/del ----------
    $("#btnAddArea").addEventListener("click", async () => {
      const site_id = $("#areaSite").value, name = $("#areaName").value.trim();
      if (!name) return toast("Isi nama wilayah.", true);
      const r = await api("/api/areas", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ site_id: site_id, name: name }) });
      if (r.error) return toast(r.error, true);
      $("#areaName").value = ""; toast("Wilayah ditambahkan."); await loadAreas();
    });
    window.deleteArea = async (id) => {
      if (!confirm("Hapus wilayah ini?")) return;
      const r = await api("/api/areas/" + id, { method:"DELETE" });
      if (r.error) return toast(r.error, true);
      toast("Wilayah dihapus."); loadAreas();
    };

    // ---------- Modal AP ----------
    let miniMap, miniMarker;
    function openModal(ap) {
      $("#apModal").classList.add("show");
      $("#apModalTitle").textContent = ap ? "Edit Access Point" : "Tambah Access Point";
      $("#apDelete").style.display = ap ? "block" : "none";
      $("#apId").value = ap ? ap.id : "";
      $("#apName").value = ap ? ap.name : "";
      $("#apIp").value = ap ? ap.ip_address : "";
      $("#apLat").value = ap && ap.latitude != null ? ap.latitude : "";
      $("#apLng").value = ap && ap.longitude != null ? ap.longitude : "";
      $("#apSite").value = ap ? ap.site_id : (state.sites[0] && state.sites[0].id);
      refreshModalAreas(ap ? ap.area_id : null);
      setTimeout(initMiniMap, 80);
    }
    function refreshModalAreas(selected) {
      const opts = areasForSite($("#apSite").value).map(a => '<option value="' + a.id + '">' + a.name + '</option>').join("");
      $("#apArea").innerHTML = opts || '<option value="">(buat wilayah dulu)</option>';
      if (selected) $("#apArea").value = selected;
    }
    $("#apSite").addEventListener("change", () => refreshModalAreas());
    function initMiniMap() {
      const lat = parseFloat($("#apLat").value) || DEFAULT_CENTER[0];
      const lng = parseFloat($("#apLng").value) || DEFAULT_CENTER[1];
      if (!miniMap) {
        miniMap = L.map("miniMap", { center: [lat,lng], zoom: DEFAULT_ZOOM });
        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, maxNativeZoom: 17 }).addTo(miniMap);
        miniMap.on("click", (e) => setMiniMarker(e.latlng.lat, e.latlng.lng));
      } else { miniMap.setView([lat,lng]); }
      setTimeout(() => miniMap.invalidateSize(), 100);
      if ($("#apLat").value) setMiniMarker(lat, lng);
    }
    function setMiniMarker(lat, lng) {
      $("#apLat").value = lat.toFixed(6); $("#apLng").value = lng.toFixed(6);
      if (miniMarker) miniMarker.setLatLng([lat,lng]); else miniMarker = L.marker([lat,lng]).addTo(miniMap);
    }
    const closeModal = () => $("#apModal").classList.remove("show");
    $("#apModalClose").addEventListener("click", closeModal);
    $("#apCancel").addEventListener("click", closeModal);
    $("#btnAdd").addEventListener("click", () => openModal(null));

    // ---------- Import Excel ----------
    $("#btnImport").addEventListener("click", () => $("#importFile").click());
    $("#importFile").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (typeof XLSX === "undefined") { toast("Library Excel belum termuat.", true); return; }
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const wb = XLSX.read(new Uint8Array(ev.target.result), { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const raw = XLSX.utils.sheet_to_json(ws, { defval: "" });
          // buang baris contoh/catatan: ambil hanya yang punya kolom nama & ip_address
          const rows = raw
            .filter(r => (r.nama || r.Nama) && (r.ip_address || r.IP || r.ip))
            .map(r => ({
              nama: r.nama || r.Nama || "",
              site: r.site || r.Site || "",
              wilayah: r.wilayah || r.Wilayah || "",
              ip_address: r.ip_address || r.IP || r.ip || "",
              latitude: r.latitude || r.Latitude || "",
              longitude: r.longitude || r.Longitude || ""
            }));
          if (!rows.length) { toast("Tidak ada baris data valid di file.", true); return; }
          const res = await api("/api/import", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows })
          });
          if (res.error) { toast(res.error, true); return; }
          let msg = res.added + " AP berhasil diimpor dari " + res.total + " baris.";
          toast(msg, res.added === 0);
          if (res.errors && res.errors.length) {
            // tampilkan ringkasan error
            res.errors.slice(0, 5).forEach(er => toast(er, true));
            if (res.errors.length > 5) toast("...dan " + (res.errors.length - 5) + " kesalahan lain.", true);
          }
          await loadAreas(); await loadAps();
        } catch (err) {
          toast("Gagal membaca file: " + err.message, true);
        }
        e.target.value = ""; // reset agar bisa pilih file sama lagi
      };
      reader.readAsArrayBuffer(file);
    });
    window.editAp = (id) => openModal(state.aps.find(a => a.id === id));
    $("#apSave").addEventListener("click", async () => {
      const id = $("#apId").value;
      const body = { name: $("#apName").value.trim(), ip_address: $("#apIp").value.trim(),
        latitude: parseFloat($("#apLat").value) || null, longitude: parseFloat($("#apLng").value) || null, area_id: $("#apArea").value };
      if (!body.name || !body.ip_address || !body.area_id) return toast("Nama, IP, dan wilayah wajib diisi.", true);
      const r = id
        ? await api("/api/aps/" + id, { method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) })
        : await api("/api/aps", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
      if (r.error) return toast(r.error, true);
      toast(id ? "AP diperbarui." : "AP ditambahkan."); closeModal(); loadAps();
    });
    $("#apDelete").addEventListener("click", async () => {
      const id = $("#apId").value;
      if (!confirm("Hapus access point ini?")) return;
      await api("/api/aps/" + id, { method:"DELETE" });
      toast("AP dihapus."); closeModal(); loadAps();
    });

    // ---------- Sidebar nav ----------
    document.querySelectorAll(".nav a").forEach(a => {
      a.addEventListener("click", () => {
        document.querySelectorAll(".nav a").forEach(x => x.classList.remove("active"));
        a.classList.add("active");
        const v = a.dataset.view;
        const sec = { dashboard: ".stats", map: ".map-card", aps: ".grid", areas: "#areaList" };
        const el = document.querySelector(sec[v]);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        closeSidebar();
      });
    });

    // ---------- Mobile sidebar ----------
    const openSidebar = () => { $("#sidebar").classList.add("open"); $("#scrim").classList.add("show"); };
    const closeSidebar = () => { $("#sidebar").classList.remove("open"); $("#scrim").classList.remove("show"); };
    $("#hamburger").addEventListener("click", openSidebar);
    $("#scrim").addEventListener("click", closeSidebar);

    // ---------- Init ----------
    (async function init() {
      try {
        await loadSites(); await loadAreas(); await loadAps();
        setTimeout(() => map.invalidateSize(), 200);
      } catch (e) {
        fatal("Gagal memuat data dari server: " + e.message +
              "<br><br>Pastikan server berjalan dan endpoint /api/sites bisa diakses.");
      }
    })();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
