// Scoring: 100 inside the plateau, then exponential decay; 0 at or beyond dMax.
const Scoring = (() => {
  const R = 6371008.8; // mean Earth radius, meters
  const rad = (d) => (d * Math.PI) / 180;

  function haversine(a, b) {
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // Nearest point on segment a-b to p, using a flat local projection (accurate at city scale).
  function nearestOnSegment(p, a, b) {
    const kx = Math.cos(rad(p.lat));
    const ax = (a.lng - p.lng) * kx, ay = a.lat - p.lat;
    const bx = (b.lng - p.lng) * kx, by = b.lat - p.lat;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    return { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) };
  }

  // A target is either a point {lat, lng} or a route {lines: [[[lat, lng], ...], ...]}.
  // Returns the distance in meters and the closest spot on the target.
  function measure(guess, target) {
    if (!target.lines) return { d: haversine(guess, target), point: { lat: target.lat, lng: target.lng } };
    let best = { d: Infinity, point: null };
    for (const line of target.lines) {
      for (let i = 0; i < line.length - 1; i++) {
        const a = { lat: line[i][0], lng: line[i][1] };
        const b = { lat: line[i + 1][0], lng: line[i + 1][1] };
        const point = nearestOnSegment(guess, a, b);
        const d = haversine(guess, point);
        if (d < best.d) best = { d, point };
      }
    }
    return best;
  }

  // NYC tuning; a region can stretch every distance by a scale (Westchester uses 2).
  const BASE = { lambda: 6800, plateau: 100 };
  const params = { ...BASE, dMax: 48000, scale: 1 };

  function score(d, p = params) {
    if (d <= p.plateau) return 100;
    if (d >= p.dMax) return 0;
    return Math.round(100 * Math.exp(-(d - p.plateau) / p.lambda));
  }

  // dMax = smaller side of the boundary's bounding box (times the scale), so scores match on every device.
  function configure(minLat, minLng, maxLat, maxLng, scale = 1) {
    const midLat = (minLat + maxLat) / 2;
    const ns = haversine({ lat: minLat, lng: minLng }, { lat: maxLat, lng: minLng });
    // Measure east-west as twice the half-span, so a full 360° (the world) doesn't collapse to zero.
    const ew = 2 * haversine({ lat: midLat, lng: minLng }, { lat: midLat, lng: (minLng + maxLng) / 2 });
    params.lambda = BASE.lambda * scale;
    params.plateau = BASE.plateau * scale;
    params.dMax = Math.min(ns, ew) * scale;
    params.scale = scale;
  }

  return { haversine, measure, score, params, configure };
})();
