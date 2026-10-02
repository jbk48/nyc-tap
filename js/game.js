// Five-round game: load a game file, play rounds, show results, copy a share string.
(async () => {
  const WEIGHTS = [1, 1, 2, 3, 3];
  const $ = (id) => document.getElementById(id);
  const devMode = new URLSearchParams(location.search).has("dev");

  // Game id comes from /g/<id>/ or ?g=<id>.
  const id =
    (location.pathname.match(/\/g\/([A-Za-z0-9_-]+)/) || [])[1] ||
    new URLSearchParams(location.search).get("g");

  const showMessage = (label, text) => {
    $("roundLabel").textContent = label;
    $("target").textContent = text;
  };

  let game;
  try {
    if (!id) throw new Error("no id");
    game = await fetch(`games/${id}.json`, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  } catch {
    showMessage("NYC Tap", "Game not found");
    return;
  }

  const { map, inCity, cityBounds } = await NycMap.create("map");
  const layer = L.layerGroup().addTo(map);

  // --- Saved progress (per device). Storage can be unavailable, so never depend on it. ---
  const storeKey = `nyctap:v1:${game.id}`;
  const load = () => {
    try { return JSON.parse(localStorage.getItem(storeKey)) || { results: [] }; } catch { return { results: [] }; }
  };
  const save = () => {
    try { localStorage.setItem(storeKey, JSON.stringify(state)); } catch {}
  };
  const state = load();

  // --- Helpers ---
  const fmtDist = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`);
  const emoji = (s) =>
    s >= 95 ? "⭐" : s >= 80 ? "🟢" : s >= 60 ? "🟡" : s >= 40 ? "🟠" : s >= 20 ? "🔴" : "😢";
  const total = () => state.results.reduce((sum, r, i) => sum + r.score * WEIGHTS[i], 0);

  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 1200);
  }

  // --- Rounds ---
  let round = 0;
  let answered = false;
  let pending = null; // guess pin placed but not yet confirmed

  function startRound(i) {
    round = i;
    answered = false;
    pending = null;
    layer.clearLayers();
    $("confirmBar").hidden = true;
    $("result").hidden = true;
    $("roundLabel").innerHTML = `Round ${i + 1} of 5 <span class="chip">×${WEIGHTS[i]}</span>`;
    $("target").textContent = game.locations[i].name;
    map.fitBounds(cityBounds, { animate: true });
  }

  function drawPair(r, loc, label = "") {
    L.polyline([r.guess, loc], { color: "#fff", weight: 2, dashArray: "6 6", interactive: false }).addTo(layer);
    L.marker(r.guess, { icon: NycMap.pinIcon("guess"), interactive: false }).addTo(layer);
    L.marker(loc, { icon: NycMap.pinIcon("answer", label), interactive: false }).addTo(layer);
  }

  // Tap drops (or moves) a pending pin; Confirm locks it in.
  // Leaflet only fires "click" for real taps, not after a drag or pinch.
  map.on("click", (e) => {
    if (answered || state.results.length >= 5) return;
    const guess = { lat: e.latlng.lat, lng: e.latlng.lng };
    if (!inCity(guess)) return toast("Outside NYC");

    if (pending) pending.setLatLng(guess);
    else pending = L.marker(guess, { icon: NycMap.pinIcon("guess"), interactive: false }).addTo(layer);
    $("confirmBar").hidden = false;
  });

  $("confirm").addEventListener("click", () => {
    if (!pending || answered) return;
    const guess = { lat: pending.getLatLng().lat, lng: pending.getLatLng().lng };
    layer.removeLayer(pending);
    pending = null;
    $("confirmBar").hidden = true;

    answered = true;
    const loc = game.locations[round];
    const d = Scoring.haversine(guess, loc);
    const r = { guess, d, score: Scoring.score(d) };
    state.results.push(r);
    save();

    drawPair(r, loc);
    map.fitBounds(L.latLngBounds([guess, loc]), {
      paddingTopLeft: [40, 120], paddingBottomRight: [40, 190], maxZoom: 17, animate: true,
    });

    $("score").textContent = r.score;
    $("distance").textContent = fmtDist(d);
    $("weighted").textContent = WEIGHTS[round] > 1 ? `×${WEIGHTS[round]} = ${r.score * WEIGHTS[round]} pts` : "";
    $("next").textContent = round < 4 ? "Next round" : "See results";
    $("result").hidden = false;
    renderDev();
  });

  $("next").addEventListener("click", () => {
    if (state.results.length >= 5) showSummary();
    else startRound(state.results.length);
  });

  // --- Results ---
  function showSummary() {
    $("result").hidden = true;
    $("roundLabel").textContent = game.title || "NYC Tap";
    $("target").textContent = "Final score";
    $("total").textContent = total();
    $("rounds").innerHTML = state.results
      .map((r, i) => `<tr>
          <td class="num">${i + 1}</td>
          <td>${emoji(r.score)}</td>
          <td class="name">${game.locations[i].name}<div class="sub">${fmtDist(r.d)}</div></td>
          <td class="pts">${r.score}${WEIGHTS[i] > 1 ? `<span class="sub"> ×${WEIGHTS[i]}</span>` : ""}</td>
        </tr>`)
      .join("");
    $("summary").hidden = false;

    layer.clearLayers();
    const pts = [];
    state.results.forEach((r, i) => {
      drawPair(r, game.locations[i], i + 1);
      pts.push(r.guess, game.locations[i]);
    });
    // Let the map zoom out further so every pin fits above the results sheet.
    map.setMaxBounds(cityBounds.pad(1));
    map.setMinZoom(map.getMinZoom() - 2);
    const sheetH = $("summary").offsetHeight;
    map.fitBounds(L.latLngBounds(pts), {
      paddingTopLeft: [30, 110], paddingBottomRight: [30, sheetH + 30], maxZoom: 15, animate: true,
    });
  }

  // Link sits in the middle (no https://) so chat apps show it as a link, not a big preview card.
  function shareText() {
    const link = location.href.replace(/[?#].*$/, "").replace(/^https?:\/\//, "").replace(/\/$/, "");
    return [
      `NYC Tap${game.title ? ` · ${game.title}` : ""}`,
      link,
      state.results.map((r) => `${emoji(r.score)} ${r.score}`).join("  "),
      `Score: ${total()}/1000`,
    ].join("\n");
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Older browsers and non-https pages: fall back to a hidden textarea.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    }
  }

  $("share").addEventListener("click", async () => {
    const ok = await copy(shareText());
    $("share").textContent = ok ? "Copied!" : "Couldn't copy";
    setTimeout(() => ($("share").textContent = "Copy result"), 1600);
  });

  // --- Dev panel: visible with ?dev in the URL ---
  const SAMPLE_DISTANCES = [100, 1200, 5000, 10000, 20000, 30000];
  function renderDev() {
    if (!devMode) return;
    const p = Scoring.params;
    $("lambdaVal").textContent = `${p.lambda} m`;
    $("plateauVal").textContent = `${p.plateau} m`;
    $("dmaxVal").textContent = fmtDist(p.dMax);
    $("sampleTable").innerHTML = SAMPLE_DISTANCES.map(
      (d) => `<tr><td>${fmtDist(d)}</td><td>${Scoring.score(d)}</td></tr>`
    ).join("");
    $("tapTable").innerHTML =
      state.results
        .map((r, i) => `<tr><td>${game.locations[i].name} · ${fmtDist(r.d)}</td><td>${Scoring.score(r.d)}</td></tr>`)
        .join("") || `<tr><td>None yet</td><td></td></tr>`;
  }

  if (devMode) {
    $("dev").hidden = false;
    window._map = map;
    $("devToggle").addEventListener("click", () => $("dev").classList.toggle("collapsed"));
    $("lambda").value = Scoring.params.lambda;
    $("plateau").value = Scoring.params.plateau;
    $("lambda").addEventListener("input", (e) => { Scoring.params.lambda = +e.target.value; renderDev(); });
    $("plateau").addEventListener("input", (e) => { Scoring.params.plateau = +e.target.value; renderDev(); });
    $("devReset").addEventListener("click", () => {
      try { localStorage.removeItem(storeKey); } catch {}
      location.reload();
    });
    renderDev();
  }

  // --- Start or resume ---
  if (state.results.length >= 5) showSummary();
  else startRound(state.results.length);
})();
