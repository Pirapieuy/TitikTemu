const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const R_BUMI = 6371.0088;

export function titikTengah(a, b) {
  const p1 = rad(a.lat);
  const l1 = rad(a.lng);
  const p2 = rad(b.lat);
  const dl = rad(b.lng) - l1;
  const bx = Math.cos(p2) * Math.cos(dl);
  const by = Math.cos(p2) * Math.sin(dl);
  const p3 = Math.atan2(Math.sin(p1) + Math.sin(p2), Math.hypot(Math.cos(p1) + bx, by));
  const l3 = l1 + Math.atan2(by, Math.cos(p1) + bx);
  return { lat: deg(p3), lng: ((deg(l3) + 540) % 360) - 180 };
}

export function jarak(a, b) {
  const dp = rad(b.lat - a.lat);
  const dl = rad(b.lng - a.lng);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dl / 2) ** 2;
  return 2 * R_BUMI * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatJarak(km) {
  if (km < 0.95) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1).replace('.', ',')} km`;
}

export function jarakRute(koordinat) {
  if (!koordinat || koordinat.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < koordinat.length; i++) total += jarak(koordinat[i - 1], koordinat[i]);
  return total;
}

export function titikTengahRute(koordinat) {
  if (!koordinat || koordinat.length < 2) return null;
  const total = jarakRute(koordinat);
  const target = total / 2;
  let akum = 0;
  for (let i = 1; i < koordinat.length; i++) {
    const seg = jarak(koordinat[i - 1], koordinat[i]);
    if (akum + seg >= target || i === koordinat.length - 1) {
      const sisa = target - akum;
      const rasio = seg > 0 ? sisa / seg : 0;
      const a = koordinat[i - 1];
      const b = koordinat[i];
      return { lat: a.lat + (b.lat - a.lat) * rasio, lng: a.lng + (b.lng - a.lng) * rasio };
    }
    akum += seg;
  }
  return koordinat[koordinat.length - 1];
}
