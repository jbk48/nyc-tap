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

  const params = { lambda: 6800, plateau: 100, dMax: 48000 };

  function score(d, p = params) {
    if (d <= p.plateau) return 100;
    if (d >= p.dMax) return 0;
    return Math.round(100 * Math.exp(-(d - p.plateau) / p.lambda));
  }

  // dMax = smaller side of the boundary's bounding box, so scores match on every device.
  function setDMaxFromBounds(minLat, minLng, maxLat, maxLng) {
    const midLat = (minLat + maxLat) / 2;
    const ns = haversine({ lat: minLat, lng: minLng }, { lat: maxLat, lng: minLng });
    const ew = haversine({ lat: midLat, lng: minLng }, { lat: midLat, lng: maxLng });
    params.dMax = Math.min(ns, ew);
  }

  return { haversine, score, params, setDMaxFromBounds };
})();
