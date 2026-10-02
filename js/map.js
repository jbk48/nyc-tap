// Satellite map locked to NYC, with the city outline and an inside-the-city test.
const NycMap = (() => {
  const NYC_TILES =
    "https://tiles.arcgis.com/tiles/yG5s3afENB5iO9fj/arcgis/rest/services/NYC_Orthos_2024/MapServer/tile/{z}/{y}/{x}";
  const ESRI_TILES =
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

  // Coordinates are [lng, lat] (GeoJSON order).
  function inRing(lng, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  async function create(elementId) {
    const boundary = await fetch("data/nyc-boundary.json").then((r) => r.json());
    const polys =
      boundary.geometry.type === "Polygon" ? [boundary.geometry.coordinates] : boundary.geometry.coordinates;

    const inCity = ({ lat, lng }) =>
      polys.some(([outer, ...holes]) => inRing(lng, lat, outer) && !holes.some((h) => inRing(lng, lat, h)));

    let minLat = 90, minLng = 180, maxLat = -90, maxLng = -180;
    for (const [outer] of polys) {
      for (const [lng, lat] of outer) {
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
        minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
      }
    }
    Scoring.setDMaxFromBounds(minLat, minLng, maxLat, maxLng);
    const cityBounds = L.latLngBounds([minLat, minLng], [maxLat, maxLng]);

    const map = L.map(elementId, {
      zoomControl: false,
      doubleClickZoom: false, // a tap is a guess, so double-tap can't zoom
      maxBounds: cityBounds.pad(0.15),
      maxBoundsViscosity: 1.0,
      zoomSnap: 0.25,
      maxZoom: 20,
    });
    map.fitBounds(cityBounds);
    map.setMinZoom(map.getZoom());
    map.attributionControl.setPrefix(false);

    L.tileLayer(ESRI_TILES, { maxZoom: 20, maxNativeZoom: 18, attribution: "Esri World Imagery" }).addTo(map);
    L.tileLayer(NYC_TILES, {
      maxZoom: 20,
      bounds: cityBounds.pad(0.05),
      attribution: "Imagery: NYC OTI (2024)",
    }).addTo(map);

    // Dim everything outside the city, then trace the outline.
    const world = [[-89, -179], [-89, 179], [89, 179], [89, -179]];
    const toLatLngs = (ring) => ring.map(([lng, lat]) => [lat, lng]);
    L.polygon([world, ...polys.map(([outer]) => toLatLngs(outer))], {
      stroke: false, fillColor: "#000", fillOpacity: 0.55, interactive: false,
    }).addTo(map);
    L.polygon(polys.map((p) => p.map(toLatLngs)), {
      color: "#fff", weight: 2, opacity: 0.85, fill: false, interactive: false,
    }).addTo(map);

    return { map, inCity, cityBounds };
  }

  const pinIcon = (cls, label = "") =>
    L.divIcon({ className: "", html: `<div class="pin ${cls}">${label}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] });

  return { create, pinIcon };
})();
