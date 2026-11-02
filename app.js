import { titikTengah, jarak, formatJarak, titikTengahRute, jarakRute } from './geo.js';
import { FIREBASE_CONFIG } from './config.js';

const BATAS_SESI = 2 * 60 * 60 * 1000;
const modeServer = Boolean(FIREBASE_CONFIG.databaseURL);
const parameter = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const teksPeran = { penjual: 'Penjual', pembeli: 'Pembeli' };

const state = {
  id: null,
  peran: 'pembeli',
  penjual: null,
  pembeli: null,
  titik: null,
  ruteTengah: null,
  ruteKey: null,
  ruteGagal: false,
  alamat: '',
  mencari: false,
  geser: false,
  selesai: false,
};

let saya = null;
let idLacak = null;
let server = null;
let dataTerakhir = null;
let terakhirKirim = null;
let peta = null;
let sedangGeser = false;
let sigAksi = '';
let kunciFit = '';
let urlTerakhir = 0;
let geoTerakhir = null;
let geoJalan = false;
let sekitarPosisi = null;
let sekitarJalan = false;
let sekitarData = [];
let sekitarGagal = false;
let ruteJalan = false;
let ruteKoordinat = null;
const penanda = {};
const lapis = {};

/* utilitas */

const simpan = (k, v) => { try { localStorage.setItem(k, v); } catch { /* penyimpanan diblokir */ } };
const baca = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lain = () => (state.peran === 'penjual' ? 'pembeli' : 'penjual');
const tulisTitik = (t) => `${t.lat.toFixed(5)},${t.lng.toFixed(5)}`;
const gmaps = (t) => `https://www.google.com/maps/dir/?api=1&destination=${t.lat.toFixed(6)},${t.lng.toFixed(6)}`;
const posisiDari = (p) => ({ lat: p.coords.latitude, lng: p.coords.longitude, akurasi: Math.round(p.coords.accuracy), t: Date.now() });

function parseTitik(s) {
  if (!s) return null;
  const [lat, lng] = s.split(',').map(Number);
  const sah = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  return sah ? { lat, lng } : null;
}

function buatId() {
  const abjad = 'abcdefghjkmnpqrstuvwxyz23456789';
  const acak = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(acak, (x) => abjad[x % abjad.length]).join('');
}

function lalu(t) {
  const d = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (d < 10) return 'baru saja';
  if (d < 60) return `${d} detik lalu`;
  if (d < 3600) return `${Math.round(d / 60)} menit lalu`;
  return `${Math.round(d / 3600)} jam lalu`;
}

function titikAktif() {
  if (state.titik) return state.titik;
  if (state.ruteTengah) return state.ruteTengah;
  if (state.penjual && state.pembeli) return titikTengah(state.penjual, state.pembeli);
  return null;
}

function pesanGps(kode) {
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent);
  if (kode === 1) {
    return {
      judul: 'Izin lokasi ditolak',
      teks: ios
        ? 'Buka Pengaturan, pilih Privasi & Keamanan, lalu Layanan Lokasi. Aktifkan untuk Safari, kemudian muat ulang halaman ini.'
        : 'Ketuk ikon gembok di sebelah alamat, pilih Izin, lalu izinkan Lokasi. Setelah itu muat ulang halaman ini.',
    };
  }
  if (kode === 3) return { judul: 'Sinyal GPS lemah', teks: 'Pindah ke tempat terbuka lalu coba lagi.' };
  if (kode === 0) return { judul: 'GPS tidak didukung', teks: 'Buka link ini lewat Chrome atau Safari.' };
  return { judul: 'GPS belum aktif', teks: 'Nyalakan Lokasi di pengaturan HP, lalu coba lagi.' };
}

function tulisPesan(el, { judul, teks }) {
  el.replaceChildren();
  const b = document.createElement('b');
  b.textContent = judul;
  el.append(b, teks);
  el.hidden = false;
}

function tombol(teks, kelas, aksi, mati) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `tombol ${kelas.split(' ').map((k) => `tombol--${k}`).join(' ')}`;
  b.textContent = teks;
  b.disabled = Boolean(mati);
  b.addEventListener('click', aksi);
  return b;
}

/* server */

async function mulaiServer() {
  if (server) return;
  const versi = '10.14.1';
  const [{ initializeApp }, fb] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${versi}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${versi}/firebase-database.js`),
  ]);
  server = { fb, db: fb.getDatabase(initializeApp(FIREBASE_CONFIG)) };
}

const rujukan = (jalur) => server.fb.ref(server.db, `sesi/${state.id}${jalur}`);

function dengar() {
  server.fb.onValue(
    rujukan(''),
    (snap) => {
      dataTerakhir = snap.val();
      terapkanData(dataTerakhir);
    },
    () => sesiBerakhir('Sesi tidak ditemukan', 'Sesi sudah berakhir atau linknya salah. Minta penjual mengirim link baru.'),
  );
}

function terapkanData(d) {
  if (!d || !d.dibuat) {
    sesiBerakhir('Sesi tidak ditemukan', 'Sesi sudah berakhir atau linknya salah. Minta penjual mengirim link baru.');
    return;
  }
  if (Date.now() - d.dibuat > BATAS_SESI) {
    sesiBerakhir('Sesi sudah berakhir', 'Sesi berlaku 2 jam. Minta penjual membuat sesi baru.');
    return;
  }
  for (const p of ['penjual', 'pembeli']) {
    state[p] = p === state.peran && saya ? saya : d[p] || null;
  }
  state.titik = d.titik || null;
  render();
}

function kirimJikaPerlu(paksa) {
  if (!modeServer || !server || !saya) return;
  if (!paksa && terakhirKirim && jarak(terakhirKirim, saya) * 1000 < 10 && saya.t - terakhirKirim.t < 20000) return;
  terakhirKirim = { ...saya };
  server.fb.set(rujukan(`/${state.peran}`), saya).catch(galatServer);
}

function galatServer() {
  tulisPesan($('pesan'), { judul: 'Server tidak bisa dihubungi', teks: 'Periksa koneksi internet, lalu muat ulang halaman.' });
}

/* GPS */

function ambilSekali() {
  return new Promise((ok, gagal) => {
    if (!('geolocation' in navigator)) { gagal({ code: 0 }); return; }
    navigator.geolocation.getCurrentPosition((p) => ok(posisiDari(p)), gagal, {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 10000,
    });
  });
}

function mulaiLacak() {
  if (state.selesai || idLacak !== null) return;
  if (!('geolocation' in navigator)) {
    tulisPesan($('pesan'), pesanGps(0));
    return;
  }
  state.mencari = !saya;
  renderAksi();
  idLacak = navigator.geolocation.watchPosition(onPosisi, onGalatGps, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 20000,
  });
}

function berhentiLacak() {
  if (idLacak !== null) navigator.geolocation.clearWatch(idLacak);
  idLacak = null;
}

function onPosisi(p) {
  $('pesan').hidden = true;
  saya = posisiDari(p);
  state[state.peran] = saya;
  state.mencari = false;
  render();
  kirimJikaPerlu(false);
}

function onGalatGps(e) {
  state.mencari = false;
  if (e.code === 1) berhentiLacak();
  tulisPesan($('pesan'), pesanGps(e.code));
  renderAksi();
}

function cekIzin() {
  if (!navigator.permissions) return;
  navigator.permissions.query({ name: 'geolocation' })
    .then((r) => { if (r.state === 'granted') mulaiLacak(); })
    .catch(() => {});
}

/* alamat dan tempat sekitar */

function namaAlamat(j) {
  const a = j.address || {};
  const bagian = [a.road, a.village || a.suburb || a.neighbourhood, a.city_district || a.town || a.city || a.county];
  const unik = bagian.filter((x, i) => x && bagian.indexOf(x) === i);
  if (unik.length) return unik.join(', ');
  return (j.display_name || '').split(',').slice(0, 2).join(',').trim();
}

async function cariAlamat(t) {
  if (geoJalan) return;
  const tenggang = state.alamat ? 600000 : 30000;
  if (geoTerakhir && jarak(geoTerakhir, t) < 0.15 && Date.now() - geoTerakhir.waktu < tenggang) return;
  geoJalan = true;
  geoTerakhir = { lat: t.lat, lng: t.lng, waktu: Date.now() };
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&accept-language=id&lat=${t.lat}&lon=${t.lng}`);
    state.alamat = namaAlamat(await r.json());
  } catch {
    state.alamat = '';
  }
  geoJalan = false;
  renderPapan(titikAktif());
}

function jenisDari(tag) {
  if (tag.amenity === 'fuel') return 'SPBU';
  if (tag.shop === 'convenience') return 'Minimarket';
  if (tag.amenity === 'place_of_worship') return 'Masjid atau musala';
  if (tag.amenity === 'police') return 'Kantor polisi';
  return 'Tempat umum';
}

async function cariSekitar() {
  const t = titikAktif();
  if (!t || !$('sekitar').open || sekitarJalan) return;
  if (sekitarPosisi && jarak(sekitarPosisi, t) < 0.3) return;
  sekitarJalan = true;
  sekitarPosisi = { lat: t.lat, lng: t.lng };
  const a = `(around:1500,${t.lat},${t.lng})`;
  const kueri = `[out:json][timeout:20];(nwr${a}["amenity"="fuel"];nwr${a}["shop"="convenience"];nwr${a}["amenity"="place_of_worship"]["religion"="muslim"];nwr${a}["amenity"="police"];);out center 60;`;
  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(kueri)}`,
    });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    sekitarData = j.elements
      .map((e) => {
        const lat = e.lat ?? e.center?.lat;
        const lng = e.lon ?? e.center?.lon;
        if (lat == null || lng == null) return null;
        const jenis = jenisDari(e.tags || {});
        return { lat, lng, jenis, nama: (e.tags && e.tags.name) || jenis };
      })
      .filter(Boolean)
      .sort((x, y) => jarak(t, x) - jarak(t, y))
      .slice(0, 8);
    sekitarGagal = false;
  } catch {
    sekitarData = [];
    sekitarGagal = true;
  }
  sekitarJalan = false;
  renderSekitar();
}

function renderSekitar() {
  const ul = $('daftar-sekitar');
  ul.replaceChildren();
  lapis.sekitar.clearLayers();
  const t = titikAktif();
  if (!sekitarData.length) {
    const li = document.createElement('li');
    li.className = 'kosong';
    li.textContent = sekitarGagal
      ? 'Daftar tempat belum bisa dimuat. Tutup lalu buka lagi untuk mencoba.'
      : 'Tidak ada SPBU, minimarket, masjid, atau kantor polisi dalam 1,5 km.';
    ul.append(li);
    return;
  }
  for (const s of sekitarData) {
    const pin = L.circleMarker([s.lat, s.lng], { radius: 7, color: '#1d2225', weight: 2, fillColor: '#fff', fillOpacity: 1 })
      .bindTooltip(s.nama)
      .addTo(lapis.sekitar);
    const li = document.createElement('li');
    const nama = document.createElement('span');
    nama.className = 'nama';
    nama.textContent = s.nama;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${s.jenis} · ${t ? formatJarak(jarak(t, s)) : ''} dari titik temu`;
    const baris = document.createElement('div');
    baris.className = 'baris';
    baris.append(tombol('Lihat di peta', 'kedua', () => { peta.flyTo([s.lat, s.lng], 17); pin.openTooltip(); }));
    if (state.peran === 'penjual') {
      baris.append(tombol('Jadikan titik temu', 'kedua', () => setTitikManual({ lat: s.lat, lng: s.lng })));
    }
    li.append(nama, meta, baris);
    ul.append(li);
  }
}

/* peta */

function buatPeta() {
  if (peta) return;
  peta = L.map('peta', { attributionControl: false }).setView([-7.98, 112.2], 9);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(peta);
  L.control.attribution({ prefix: false }).addTo(peta);
  lapis.sekitar = L.layerGroup().addTo(peta);

  const Pusat = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const b = L.DomUtil.create('button', 'pusat');
      b.type = 'button';
      b.setAttribute('aria-label', 'Pusatkan peta');
      b.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
      L.DomEvent.disableClickPropagation(b);
      b.addEventListener('click', () => paskanPeta(true));
      return b;
    },
  });
  new Pusat().addTo(peta);
}

function tanda(kelas, teks) {
  return L.divIcon({
    className: '',
    iconSize: [0, 0],
    html: `<div class="tanda tanda--${kelas}"><span class="tanda__dot"></span><span class="tanda__label">${teks}</span></div>`,
  });
}

function taruh(kunci, pos, ikon) {
  if (!pos) {
    if (penanda[kunci]) { penanda[kunci].remove(); delete penanda[kunci]; }
    return;
  }
  if (penanda[kunci]) penanda[kunci].setLatLng([pos.lat, pos.lng]);
  else penanda[kunci] = L.marker([pos.lat, pos.lng], { icon: ikon, interactive: false, keyboard: false }).addTo(peta);
}

function renderMarka(t) {
  taruh('penjual', state.penjual, tanda('penjual', 'Penjual'));
  taruh('pembeli', state.pembeli, tanda('pembeli', 'Pembeli'));

  if (t) {
    if (!penanda.titik) {
      const m = L.marker([t.lat, t.lng], { icon: tanda('titik', 'Titik temu'), draggable: true, keyboard: false }).addTo(peta);
      m.on('dragstart', () => { sedangGeser = true; });
      m.on('dragend', () => {
        sedangGeser = false;
        const p = m.getLatLng();
        setTitikManual({ lat: p.lat, lng: p.lng });
      });
      penanda.titik = m;
    } else if (!sedangGeser) {
      penanda.titik.setLatLng([t.lat, t.lng]);
    }
    const aktif = state.geser && state.peran === 'penjual';
    if (aktif) penanda.titik.dragging.enable();
    else penanda.titik.dragging.disable();
    penanda.titik.getElement()?.firstElementChild?.classList.toggle('geser', aktif);
  } else if (penanda.titik) {
    penanda.titik.remove();
    delete penanda.titik;
  }

  if (saya) {
    const warna = state.peran === 'penjual' ? '#1d5cb8' : '#b58f00';
    const r = Math.min(saya.akurasi || 0, 500);
    if (!lapis.akurasi) {
      lapis.akurasi = L.circle([saya.lat, saya.lng], { radius: r, weight: 1, color: warna, fillColor: warna, fillOpacity: 0.12, interactive: false }).addTo(peta);
    } else {
      lapis.akurasi.setLatLng([saya.lat, saya.lng]).setRadius(r).setStyle({ color: warna, fillColor: warna });
    }
  } else if (lapis.akurasi) {
    lapis.akurasi.remove();
    delete lapis.akurasi;
  }

  const titikJalan = [state.penjual, t, state.pembeli].filter(Boolean).map((p) => [p.lat, p.lng]);
  if (titikJalan.length >= 2) {
    if (!lapis.jalan) {
      lapis.jalan = L.polyline(titikJalan, { color: '#1d2225', weight: 9, opacity: 0.85, lineCap: 'round', interactive: false }).addTo(peta);
      lapis.marka = L.polyline(titikJalan, { color: '#f4c20d', weight: 2.5, dashArray: '10 12', interactive: false }).addTo(peta);
    } else {
      lapis.jalan.setLatLngs(titikJalan);
      lapis.marka.setLatLngs(titikJalan);
    }
  } else if (lapis.jalan) {
    lapis.jalan.remove();
    lapis.marka.remove();
    delete lapis.jalan;
    delete lapis.marka;
  }

  if (ruteKoordinat && ruteKoordinat.length >= 2) {
    const latlngs = ruteKoordinat.map((p) => [p.lat, p.lng]);
    if (!lapis.rute) {
      lapis.rute = L.polyline(latlngs, { color: '#1d5cb8', weight: 4, opacity: 0.7, interactive: false }).addTo(peta);
    } else {
      lapis.rute.setLatLngs(latlngs);
    }
  } else if (lapis.rute) {
    lapis.rute.remove();
    delete lapis.rute;
  }
}

function paskanPeta(paksa) {
  const t = titikAktif();
  const kunci = [state.penjual ? 'p' : '', state.pembeli ? 'b' : '', t ? 't' : ''].join('');
  if (!paksa && kunci === kunciFit) return;
  kunciFit = kunci;
  const titik = [state.penjual, state.pembeli, t].filter(Boolean).map((p) => [p.lat, p.lng]);
  if (!titik.length) return;
  const lebar = innerWidth >= 860;
  const panel = $('panel').getBoundingClientRect();
  peta.fitBounds(L.latLngBounds(titik), {
    paddingTopLeft: [lebar ? panel.width + 40 : 40, 80],
    paddingBottomRight: [60, lebar ? 40 : panel.height + 30],
    maxZoom: 16,
  });
}

/* tampilan */

function teksStatus() {
  if (modeServer && !dataTerakhir) return 'Memuat sesi…';
  if (!saya) return 'Lokasimu belum dibagikan';
  const l = lain();
  if (!state[l]) {
    if (modeServer) return `Menunggu ${l} membagikan lokasi`;
    return state.peran === 'penjual' ? 'Menunggu pembeli mengirim balik link' : 'Menunggu lokasi penjual';
  }
  return state.titik ? 'Titik temu digeser penjual' : '';
}

function renderPapan(t) {
  $('tempat').textContent = t ? state.alamat || 'Mencari nama tempat…' : 'Titik temu belum tersedia';
  $('jarak-penjual').textContent = t && state.penjual ? formatJarak(jarak(state.penjual, t)) : '–';
  $('jarak-pembeli').textContent = t && state.pembeli ? formatJarak(jarak(state.pembeli, t)) : '–';
  const total = $('total');
  total.hidden = !(state.penjual && state.pembeli);
  if (!total.hidden) {
    const jarakTotal = ruteKoordinat ? jarakRute(ruteKoordinat) : jarak(state.penjual, state.pembeli);
    const catatan = ruteKoordinat ? 'jarak jalan' : 'jarak lurus, bukan jarak jalan';
    total.textContent = `Penjual ke pembeli ${formatJarak(jarakTotal)} (${catatan})`;
  }
  const status = $('status');
  const teks = state.selesai ? '' : teksStatus();
  status.textContent = teks;
  status.hidden = !teks;
  $('privasi-sesi').hidden = Boolean(saya);
}

function ketPosisi(p, pos) {
  if (!pos) return p === state.peran ? 'Belum membagikan lokasi' : 'Menunggu membagikan lokasi';
  if (!pos.t) return 'Lokasi dari link';
  return `${pos.akurasi ? `± ${pos.akurasi} m · ` : ''}${lalu(pos.t)}`;
}

function renderPihak() {
  const ul = $('pihak');
  ul.replaceChildren();
  for (const p of ['penjual', 'pembeli']) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = `warna warna--${p}${state[p] ? '' : ' warna--kosong'}`;
    const isi = document.createElement('div');
    const nama = document.createElement('b');
    nama.textContent = teksPeran[p] + (p === state.peran ? ' (kamu)' : '');
    const ket = document.createElement('span');
    ket.className = 'ket';
    ket.textContent = ketPosisi(p, state[p]);
    isi.append(nama, ket);
    li.append(dot, isi);
    ul.append(li);
  }
}

function renderAksi(paksa) {
  const t = titikAktif();
  const sig = [state.peran, Boolean(saya), state.mencari, Boolean(state.penjual), Boolean(state.pembeli), Boolean(t), state.geser, Boolean(state.titik)].join('|');
  if (!paksa && sig === sigAksi) return;
  sigAksi = sig;

  const penjual = state.peran === 'penjual';
  const maps = (kelas) => tombol('Buka di Google Maps', kelas, () => window.open(gmaps(titikAktif()), '_blank', 'noopener'));
  const kirim = (kelas) => tombol('Kirim titik temu lewat WhatsApp', kelas, kirimHasil);
  const isi = [];

  if (!saya) isi.push(tombol(state.mencari ? 'Mencari lokasi…' : 'Bagikan lokasi saya', 'utama', mulaiLacak, state.mencari));
  if (penjual && !state.pembeli) isi.push(tombol('Kirim link ke pembeli lewat WhatsApp', saya ? 'utama' : 'kedua', kirimLinkPembeli));
  if (t) {
    if (!modeServer && !penjual) isi.push(kirim('utama'), maps('kedua'));
    else isi.push(maps('utama'), kirim('kedua'));
  }
  if (penjual) {
    if (t) isi.push(tombol(state.geser ? 'Selesai geser' : 'Geser titik temu', 'kedua', alihGeser));
    if (state.titik) isi.push(tombol('Kembalikan ke tengah', 'teks', kembalikanTengah));
    isi.push(tombol('Salin link', 'teks', salinLink));
  }
  $('aksi').replaceChildren(...isi);

  const info = document.createElement('span');
  info.textContent = `Kamu sebagai ${teksPeran[state.peran].toLowerCase()}`;
  const kaki = [info, tombol('Ganti peran', 'teks kecil', gantiPeran)];
  if (penjual && modeServer) kaki.push(tombol('Akhiri sesi', 'teks kecil', akhiri));
  $('kaki').replaceChildren(...kaki);
}

function ruteCacheKey(a, b) {
  return `${a.lat.toFixed(4)},${a.lng.toFixed(4)};${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;
}

async function ambilRute(a, b) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    const coords = j.routes?.[0]?.geometry?.coordinates;
    if (!coords) throw new Error('no route');
    return coords.map(([lng, lat]) => ({ lat, lng }));
  } finally {
    clearTimeout(timer);
  }
}

async function hitungTengahRute() {
  if (state.titik) {
    state.ruteTengah = null;
    ruteKoordinat = null;
    return;
  }
  if (!state.penjual || !state.pembeli) return;
  const key = ruteCacheKey(state.penjual, state.pembeli);
  if (state.ruteKey === key) return;
  if (ruteJalan) return;
  ruteJalan = true;
  try {
    const coords = await ambilRute(state.penjual, state.pembeli);
    ruteKoordinat = coords;
    state.ruteTengah = titikTengahRute(coords);
    state.ruteGagal = false;
    state.ruteKey = key;
  } catch {
    ruteKoordinat = null;
    state.ruteTengah = null;
    state.ruteGagal = true;
    state.ruteKey = key;
  } finally {
    ruteJalan = false;
    render();
  }
}

function render() {
  if (!peta || state.selesai) return;
  const t = titikAktif();
  renderMarka(t);
  renderPapan(t);
  renderPihak();
  renderAksi();
  paskanPeta(false);
  if (t) {
    cariAlamat(t);
    cariSekitar();
  }
  simpanUrl(false);
  if (!state.titik && state.penjual && state.pembeli) hitungTengahRute();
}

/* aksi */

function buatLink() {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('s', state.id);
  if (!modeServer) {
    if (state.penjual) u.searchParams.set('p', tulisTitik(state.penjual));
    if (state.pembeli) u.searchParams.set('b', tulisTitik(state.pembeli));
    if (state.titik) u.searchParams.set('t', tulisTitik(state.titik));
  }
  return u.toString();
}

function simpanUrl(paksa) {
  if (modeServer) return;
  if (!paksa && Date.now() - urlTerakhir < 5000) return;
  urlTerakhir = Date.now();
  history.replaceState(null, '', buatLink());
}

const wa = (teks) => window.open(`https://wa.me/?text=${encodeURIComponent(teks)}`, '_blank', 'noopener');

function kirimLinkPembeli() {
  wa(`Halo, ini link COD kita. Buka, lalu ketuk "Bagikan lokasi saya" supaya titik temunya muncul:\n${buatLink()}`);
}

function kirimHasil() {
  const t = titikAktif();
  if (!t) return;
  wa(`Titik temu COD kita: ${state.alamat || tulisTitik(t)}\nPeta: ${buatLink()}\nNavigasi: ${gmaps(t)}`);
}

async function salinLink(e) {
  const b = e.currentTarget;
  const awal = b.textContent;
  try {
    await navigator.clipboard.writeText(buatLink());
    b.textContent = 'Link disalin';
    setTimeout(() => { b.textContent = awal; }, 1800);
  } catch {
    window.prompt('Salin link ini:', buatLink());
  }
}

function setTitikManual(t) {
  state.titik = t;
  if (modeServer) server.fb.set(rujukan('/titik'), t).catch(galatServer);
  else simpanUrl(true);
  render();
}

function kembalikanTengah() {
  state.titik = null;
  state.ruteTengah = null;
  state.ruteKey = null;
  state.ruteGagal = false;
  ruteKoordinat = null;
  state.geser = false;
  if (modeServer) server.fb.remove(rujukan('/titik')).catch(galatServer);
  else simpanUrl(true);
  render();
}

function alihGeser() {
  state.geser = !state.geser;
  render();
}

function gantiPeran() {
  berhentiLacak();
  saya = null;
  terakhirKirim = null;
  state.mencari = false;
  state.geser = false;
  state.peran = lain();
  simpan(`tt:${state.id}`, state.peran);
  if (modeServer && dataTerakhir) terapkanData(dataTerakhir);
  else render();
  renderAksi(true);
  cekIzin();
}

function sesiBerakhir(judul, teks) {
  berhentiLacak();
  state.selesai = true;
  $('panel').hidden = true;
  $('status').hidden = true;
  $('selesai-judul').textContent = judul;
  $('selesai-teks').textContent = teks;
  $('selesai').hidden = false;
}

async function akhiri() {
  if (!window.confirm('Akhiri sesi ini? Lokasi di server akan dihapus.')) return;
  try { await server.fb.remove(rujukan('')); } catch { /* sesi tetap kedaluwarsa otomatis */ }
  sesiBerakhir('Sesi diakhiri', 'Lokasi sudah dihapus dari server. Buat sesi baru untuk transaksi berikutnya.');
}

/* alur awal */

async function bukaSesi() {
  $('beranda').hidden = true;
  $('sesi').hidden = false;
  buatPeta();
  peta.invalidateSize();
  if (modeServer) {
    try {
      await mulaiServer();
      dengar();
    } catch {
      galatServer();
    }
  }
  render();
}

async function buatSesi() {
  const b = $('buat');
  const pesan = $('pesan-beranda');
  pesan.hidden = true;
  b.disabled = true;
  b.textContent = 'Mencari lokasi…';
  try {
    const pos = await ambilSekali();
    state.id = buatId();
    if (modeServer) {
      await mulaiServer();
      await server.fb.set(rujukan(''), { dibuat: server.fb.serverTimestamp() });
    }
    simpan(`tt:${state.id}`, 'penjual');
    history.replaceState(null, '', `?s=${state.id}`);
    state.peran = 'penjual';
    saya = pos;
    state.penjual = pos;
    await bukaSesi();
    mulaiLacak();
    kirimJikaPerlu(true);
  } catch (e) {
    if (typeof e?.code === 'number') tulisPesan(pesan, pesanGps(e.code));
    else tulisPesan(pesan, { judul: 'Sesi belum bisa dibuat', teks: 'Periksa koneksi internet, isi config.js, dan aturan database Firebase.' });
    b.disabled = false;
    b.textContent = 'Buat sesi COD';
  }
}

function init() {
  $('privasi').textContent = modeServer
    ? 'Lokasimu hanya bisa dibaca pemegang link sesi dan terhapus otomatis setelah 2 jam.'
    : 'Lokasimu tidak disimpan di server. Lokasi hanya ikut di link yang kamu kirim.';
  $('privasi-sesi').textContent = $('privasi').textContent;
  $('buat').addEventListener('click', buatSesi);
  $('sekitar').addEventListener('toggle', () => {
    if ($('sekitar').open) {
      sekitarPosisi = null;
      $('daftar-sekitar').replaceChildren(Object.assign(document.createElement('li'), { className: 'kosong', textContent: 'Mencari tempat…' }));
      cariSekitar();
    } else if (lapis.sekitar) {
      lapis.sekitar.clearLayers();
    }
  });
  addEventListener('resize', () => peta && peta.invalidateSize());
  setInterval(() => { if (peta && !state.selesai) renderPihak(); }, 10000);

  if (!window.isSecureContext) {
    tulisPesan($('pesan-beranda'), { judul: 'Halaman belum aman', teks: 'GPS hanya berjalan lewat HTTPS. Buka alamat yang diawali https://.' });
  }

  const id = parameter.get('s');
  if (!id) return;
  if (!/^[a-z0-9]{10,24}$/.test(id)) {
    tulisPesan($('pesan-beranda'), { judul: 'Link tidak valid', teks: 'Minta penjual mengirim ulang link sesi.' });
    return;
  }
  state.id = id;
  state.peran = baca(`tt:${id}`) === 'penjual' ? 'penjual' : 'pembeli';
  if (!modeServer) {
    state.penjual = parseTitik(parameter.get('p'));
    state.pembeli = parseTitik(parameter.get('b'));
    state.titik = parseTitik(parameter.get('t'));
  }
  bukaSesi().then(cekIzin);
}

init();
