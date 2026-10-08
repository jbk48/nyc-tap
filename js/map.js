// Satellite map locked to a region (NYC, Westchester, the continental US or the whole world),
// with its outline and an inside-the-region test.
const NycMap = (() => {
  const ESRI_TILES =
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

  // Each game picks a region with "region" in its file; NYC is the default.
  const REGIONS = {
    nyc: {
      label: "NYC",
      boundary: "data/nyc-boundary.json",
      tiles: "https://tiles.arcgis.com/tiles/yG5s3afENB5iO9fj/arcgis/rest/services/NYC_Orthos_2024/MapServer/tile/{z}/{y}/{x}",
      maxNativeZoom: 20,
      attribution: "Imagery: NYC OTI (2024)",
    },
    westchester: {
      label: "Westchester",
      boundary: "data/westchester-boundary.json",
      tiles: "https://orthos.its.ny.gov/arcgis/rest/services/wms/2025/MapServer/tile/{z}/{y}/{x}",
      maxNativeZoom: 19,
      attribution: "Imagery: NYS ITS (2025)",
      scoreScale: 2, // suburban distances: scoring is twice as forgiving as NYC
    },
    usa: {
      label: "USA",
      boundary: "data/usa-boundary.json",
      tiles: null, // Esri World Imagery (the base layer) covers the whole country
      attribution: "",
      scoreScale: 100, // continental distances: 120 km off scores what 1.2 km does in NYC
    },
    world: {
      label: "World",
      boundary: null, // no outline: anywhere on Earth counts
      bounds: [[-60, -180], [80, 180]],
      tiles: null,
      attribution: "",
      // Fitted to MapTap's published points: 100 within ~20 km, 98 at 100 km, 81 at 1,000 km, 0 past 16,250 km.
      scoring: { plateau: 20000, lambda: 4650000, dMax: 16250000, strict: true },
    },
  };
  const region = (key) => REGIONS[key] || REGIONS.nyc;

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

  async function create(elementId, regionKey) {
    const R = region(regionKey);
    // A region without a boundary (the world) accepts every tap and has no outline.
    const boundary = R.boundary ? await fetch(R.boundary).then((r) => r.json()) : null;
    const polys = !boundary ? []
      : boundary.geometry.type === "Polygon" ? [boundary.geometry.coordinates] : boundary.geometry.coordinates;

    const inCity = ({ lat, lng }) =>
      !boundary ||
      polys.some(([outer, ...holes]) => inRing(lng, lat, outer) && !holes.some((h) => inRing(lng, lat, h)));

    let [[minLat, minLng], [maxLat, maxLng]] = R.bounds || [[90, 180], [-90, -180]];
    for (const [outer] of polys) {
      for (const [lng, lat] of outer) {
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
        minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
      }
    }
    Scoring.configure(minLat, minLng, maxLat, maxLng, R.scoreScale || 1, R.scoring);
    const cityBounds = L.latLngBounds([minLat, minLng], [maxLat, maxLng]);

    const map = L.map(elementId, {
      zoomControl: false,
      doubleClickZoom: false, // a tap is a guess, so double-tap can't zoom
      maxBounds: boundary ? cityBounds.pad(0.15) : [[-85, -180], [85, 180]],
      maxBoundsViscosity: 1.0,
      zoomSnap: 0.25,
      maxZoom: 20,
    });
    map.fitBounds(cityBounds);
    map.setMinZoom(map.getZoom());
    map.attributionControl.setPrefix(false);

    L.tileLayer(ESRI_TILES, { maxZoom: 20, maxNativeZoom: 18, attribution: "Esri World Imagery" }).addTo(map);
    if (R.tiles) {
      L.tileLayer(R.tiles, {
        maxZoom: 20,
        maxNativeZoom: R.maxNativeZoom,
        bounds: cityBounds.pad(0.05),
        attribution: R.attribution,
      }).addTo(map);
    }

    // Dim everything outside the region, then trace the outline.
    if (boundary) {
      const world = [[-89, -179], [-89, 179], [89, 179], [89, -179]];
      const toLatLngs = (ring) => ring.map(([lng, lat]) => [lat, lng]);
      L.polygon([world, ...polys.map(([outer]) => toLatLngs(outer))], {
        stroke: false, fillColor: "#000", fillOpacity: 0.55, interactive: false,
      }).addTo(map);
      L.polygon(polys.map((p) => p.map(toLatLngs)), {
        color: "#fff", weight: 2, opacity: 0.85, fill: false, interactive: false,
      }).addTo(map);
    }

    return { map, inCity, cityBounds, label: R.label };
  }

  const pinIcon = (cls, label = "") =>
    L.divIcon({ className: "", html: `<div class="pin ${cls}">${label}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] });

  return { create, pinIcon, region };
})();
