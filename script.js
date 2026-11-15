"use strict";

/* Traçado GPX: planejador de rotas.
   Estado = lista de pontos de passagem (waypoints). A geometria de cada trecho
   vem de um cache indexado pelas coordenadas, então a tela é sempre derivada de
   "waypoints + cache" e respostas atrasadas da rede nunca bagunçam a rota. */

const $ = (selector) => document.querySelector(selector);

const STORAGE_KEY = "tracado-gpx-rascunho-v1";
const DEFAULT_VIEW = { lat: -23.5617, lng: -46.6918, zoom: 14 };
const MAX_HISTORY = 100;
const MAX_FREEHAND_POINTS = 40;
const MAX_IMPORT_POINTS = 60;

const ACTIVITIES = {
  run: { profile: "foot", gpxType: "running", label: "Ritmo (min/km)", kind: "pace", fallback: "5:30" },
  walk: { profile: "foot", gpxType: "walking", label: "Ritmo (min/km)", kind: "pace", fallback: "10:00" },
  bike: { profile: "bike", gpxType: "cycling", label: "Velocidade (km/h)", kind: "speed", fallback: "22" },
};

const els = {
  map: $("#routeMap"),
  status: $("#statusText"),
  searchForm: $("#searchForm"),
  search: $("#locationSearch"),
  suggestions: $("#suggestions"),
  snap: $("#snapToggle"),
  targetKm: $("#targetKm"),
  targetRange: $("#targetRange"),
  autoLoop: $("#autoLoop"),
  routeName: $("#routeName"),
  activity: $("#activity"),
  pace: $("#paceInput"),
  paceLabel: $("#paceLabel"),
  description: $("#description"),
  download: $("#downloadButton"),
  importInput: $("#importInput"),
  undo: $("#undoButton"),
  redo: $("#redoButton"),
  loop: $("#loopButton"),
  back: $("#backButton"),
  reverse: $("#reverseButton"),
  clear: $("#clearButton"),
  chart: $("#elevChart"),
  elevNote: $("#elevNote"),
};
const modeButtons = [...document.querySelectorAll("[data-mode]")];
const shapeButtons = [...document.querySelectorAll("[data-shape]")];

const state = { waypoints: [], mode: "click" };
const paceByActivity = { run: "5:30", walk: "10:00", bike: "22" };
const undoStack = [];
const redoStack = [];
const legCache = new Map();
const pendingLegs = new Set();
const failedLegs = new Set();

let map;
let routeLine;
let hitLine;
let sketchLine;
let markersLayer;
let kmLayer;
let hoverMarker;
let route = { coords: [], cum: [], legOf: [], distance: 0 };
let elevation = null;
let elevationTimer = 0;
let elevationToken = 0;
let draggingMarker = false;
let busy = false;

/* ---------- geometria ---------- */

const toRad = (deg) => (deg * Math.PI) / 180;

function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

function offsetPoint(origin, northMeters, eastMeters) {
  return {
    lat: origin.lat + northMeters / 111_320,
    lng: origin.lng + eastMeters / (111_320 * Math.cos(toRad(origin.lat))),
  };
}

function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += haversine(points[i - 1], points[i]);
  return total;
}

function copyPoint(p) {
  return { lat: p.lat, lng: p.lng };
}

function isClosed(points = state.waypoints) {
  return points.length >= 3 && haversine(points[0], points[points.length - 1]) < 1;
}

function pointAtDistance(distance) {
  const { coords, cum } = route;
  if (!coords.length) return null;
  if (distance <= 0) return coords[0];
  if (distance >= route.distance) return coords[coords.length - 1];
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= distance) lo = mid;
    else hi = mid;
  }
  const span = cum[hi] - cum[lo] || 1;
  const t = (distance - cum[lo]) / span;
  return {
    lat: coords[lo].lat + (coords[hi].lat - coords[lo].lat) * t,
    lng: coords[lo].lng + (coords[hi].lng - coords[lo].lng) * t,
  };
}

/* Reduz uma linha a poucos pontos (Douglas-Peucker em metros). */
function simplifyToLimit(points, limit, startTolerance) {
  if (points.length <= 2) return points.map(copyPoint);
  const origin = points[0];
  const k = Math.cos(toRad(origin.lat)) * 111_320;
  const projected = points.map((p) => {
    const pt = L.point((p.lng - origin.lng) * k, (p.lat - origin.lat) * 111_320);
    pt.source = p;
    return pt;
  });
  let tolerance = startTolerance;
  let result = L.LineUtil.simplify(projected, tolerance);
  while (result.length > limit) {
    tolerance *= 1.5;
    result = L.LineUtil.simplify(projected, tolerance);
  }
  return result.map((pt) => copyPoint(pt.source));
}

/* ---------- formatação ---------- */

function formatDistance(meters) {
  return `${(meters / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
}

function formatDuration(totalSeconds) {
  const seconds = Math.round(totalSeconds);
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) return `${hrs}h${String(mins).padStart(2, "0")}`;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeHtml(value) {
  return escapeXml(value);
}

function setStatus(message, tone = "neutral") {
  els.status.textContent = message;
  els.status.dataset.tone = tone;
}

function defaultHint() {
  const count = state.waypoints.length;
  if (state.mode === "free") return "Segure e arraste no mapa para riscar o trajeto.";
  if (count === 0) return "Clique no mapa para marcar a largada.";
  if (count === 1) return "Agora clique no próximo ponto. A rota se liga sozinha.";
  return "Arraste um ponto para ajustar ou clique na linha para criar um desvio.";
}

/* ---------- ritmo e tempo ---------- */

function activityConfig() {
  return ACTIVITIES[els.activity.value] || ACTIVITIES.run;
}

/* Aceita "5:30", "5.5" ou "5,5" (min/km) e devolve segundos por km. */
function secondsPerKm() {
  const config = activityConfig();
  const raw = els.pace.value.trim().replace(",", ".");
  if (config.kind === "speed") {
    const speed = Number(raw) || Number(config.fallback);
    return 3600 / Math.max(1, speed);
  }
  const match = raw.match(/^(\d{1,2}):(\d{1,2})$/);
  const minutes = match ? Number(match[1]) + Number(match[2]) / 60 : Number(raw);
  const safe = Number.isFinite(minutes) && minutes > 0 ? minutes : 5.5;
  return safe * 60;
}

/* ---------- roteamento ---------- */

function legKey(a, b, profile = activityConfig().profile) {
  return `${profile}|${a.lat.toFixed(5)},${a.lng.toFixed(5)}|${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;
}

async function fetchJson(url, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/* Uma chamada para vários pontos; devolve a geometria de cada trecho. */
async function fetchLegs(points, profile) {
  const coordinates = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  const query = "?overview=false&steps=true&geometries=geojson&continue_straight=false";
  const servers = [
    `https://routing.openstreetmap.de/routed-${profile}/route/v1/driving/`,
    "https://router.project-osrm.org/route/v1/driving/",
  ];
  let lastError;
  for (const server of servers) {
    try {
      const data = await fetchJson(server + coordinates + query);
      const legs = data.routes?.[0]?.legs;
      if (data.code !== "Ok" || !legs || legs.length !== points.length - 1) throw new Error("Resposta sem rota");
      return legs.map((leg, index) => {
        const line = [];
        leg.steps.forEach((step) => {
          step.geometry.coordinates.forEach(([lng, lat]) => {
            const last = line[line.length - 1];
            if (!last || last.lat !== lat || last.lng !== lng) line.push({ lat, lng });
          });
        });
        return line.length >= 2 ? line : [copyPoint(points[index]), copyPoint(points[index + 1])];
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Roteamento indisponível");
}

function storeLegs(points, legs, profile) {
  legs.forEach((line, index) => legCache.set(legKey(points[index], points[index + 1], profile), line));
}

/* Busca só os trechos que ainda não estão no cache, agrupando vizinhos. */
async function ensureRouting() {
  if (!els.snap.checked || state.waypoints.length < 2) return;
  const profile = activityConfig().profile;
  const points = state.waypoints.map(copyPoint);
  const missing = (i) => {
    const key = legKey(points[i], points[i + 1], profile);
    return !legCache.has(key) && !pendingLegs.has(key) && !failedLegs.has(key);
  };

  const runs = [];
  let i = 0;
  while (i < points.length - 1) {
    if (!missing(i)) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < points.length - 1 && missing(j) && j - i < 24) j += 1;
    runs.push(points.slice(i, j + 1));
    i = j;
  }
  if (!runs.length) return;

  setStatus("Ligando os pontos pelas ruas...", "loading");
  let failed = false;
  await Promise.all(
    runs.map(async (run) => {
      const keys = run.slice(0, -1).map((p, index) => legKey(p, run[index + 1], profile));
      keys.forEach((key) => pendingLegs.add(key));
      try {
        storeLegs(run, await fetchLegs(run, profile), profile);
      } catch (error) {
        failed = true;
        keys.forEach((key) => failedLegs.add(key));
      } finally {
        keys.forEach((key) => pendingLegs.delete(key));
        refresh(draggingMarker);
      }
    })
  );

  if (failed) setStatus("Não consegui seguir as ruas em algum trecho; ele ficou em linha reta.", "error");
  else if (!pendingLegs.size) setStatus(defaultHint(), "success");
}

/* ---------- rota derivada ---------- */

function buildRoute() {
  const points = state.waypoints;
  const coords = [];
  const legOf = [];
  const snap = els.snap.checked;
  if (points.length === 1) {
    coords.push(points[0]);
    legOf.push(0);
  }
  for (let i = 0; i < points.length - 1; i += 1) {
    const cached = snap ? legCache.get(legKey(points[i], points[i + 1])) : null;
    const line = cached || [points[i], points[i + 1]];
    line.forEach((p, index) => {
      if (index === 0 && coords.length) return;
      coords.push(p);
      legOf.push(i);
    });
  }
  const cum = [0];
  for (let i = 1; i < coords.length; i += 1) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  route = { coords, cum, legOf, distance: cum[cum.length - 1] || 0 };
}

function refresh(light = false) {
  buildRoute();
  routeLine.setLatLngs(route.coords);
  hitLine.setLatLngs(route.coords);
  if (!light) {
    renderMarkers();
    renderKmMarkers();
    saveDraft();
    scheduleElevation();
  }
  renderStats();
  updateButtons();
}

/* ---------- histórico e edição ---------- */

function snapshot() {
  return state.waypoints.map(copyPoint);
}

function pushHistory() {
  undoStack.push(snapshot());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
}

function afterChange() {
  failedLegs.clear();
  refresh();
  if (!pendingLegs.size) setStatus(defaultHint());
  ensureRouting();
}

function commit(mutate) {
  pushHistory();
  mutate();
  afterChange();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  state.waypoints = undoStack.pop();
  afterChange();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  state.waypoints = redoStack.pop();
  afterChange();
}

function addWaypoint(latlng) {
  commit(() => state.waypoints.push({ lat: latlng.lat, lng: latlng.lng }));
}

function removeWaypoint(index) {
  commit(() => state.waypoints.splice(index, 1));
}

function closeLoop() {
  if (state.waypoints.length < 2 || isClosed()) return;
  commit(() => state.waypoints.push(copyPoint(state.waypoints[0])));
}

function outAndBack() {
  if (state.waypoints.length < 2) return;
  commit(() => {
    const back = state.waypoints.slice(0, -1).reverse().map(copyPoint);
    state.waypoints.push(...back);
  });
}

function reverseRoute() {
  if (state.waypoints.length < 2) return;
  commit(() => state.waypoints.reverse());
}

function clearRoute() {
  if (!state.waypoints.length) return;
  commit(() => {
    state.waypoints = [];
  });
  setStatus("Rota apagada. Use Desfazer se foi sem querer.");
}

/* Clique na linha: cria um ponto de desvio no trecho mais próximo. */
function insertOnLine(latlng) {
  const click = map.latLngToLayerPoint(latlng);
  let best = { distance: Infinity, leg: 0 };
  for (let i = 1; i < route.coords.length; i += 1) {
    const a = map.latLngToLayerPoint(route.coords[i - 1]);
    const b = map.latLngToLayerPoint(route.coords[i]);
    const distance = L.LineUtil.pointToSegmentDistance(click, a, b);
    if (distance < best.distance) best = { distance, leg: route.legOf[i] };
  }
  commit(() => state.waypoints.splice(best.leg + 1, 0, { lat: latlng.lat, lng: latlng.lng }));
  setStatus("Ponto de desvio criado. Arraste para mudar o caminho.");
}

/* ---------- marcadores ---------- */

function markerIcon(kind, label) {
  const size = kind === "mid" ? 16 : 28;
  return L.divIcon({
    className: `marker-pin ${kind}`,
    html: label ? `<span>${label}</span>` : "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function renderMarkers() {
  markersLayer.clearLayers();
  const points = state.waypoints;
  const closed = isClosed();
  const lastIndex = points.length - 1;

  points.forEach((point, index) => {
    if (closed && index === lastIndex) return;
    const isStart = index === 0;
    const isFinish = index === lastIndex && !closed && points.length > 1;
    const kind = isStart ? (closed ? "start loop" : "start") : isFinish ? "finish" : "mid";
    const title = isStart
      ? closed
        ? "Largada e chegada. Clique para reabrir o circuito."
        : "Largada. Clique para fechar o circuito."
      : "Arraste para mover, clique para remover.";
    const marker = L.marker(point, {
      draggable: true,
      icon: markerIcon(kind, isStart ? "L" : isFinish ? "C" : ""),
      title,
      zIndexOffset: isStart || isFinish ? 500 : 0,
    });

    let moveTwin = false;
    marker.on("dragstart", () => {
      pushHistory();
      draggingMarker = true;
      moveTwin = isStart && closed;
    });
    marker.on("drag", () => {
      const next = marker.getLatLng();
      state.waypoints[index] = { lat: next.lat, lng: next.lng };
      if (moveTwin) state.waypoints[state.waypoints.length - 1] = { lat: next.lat, lng: next.lng };
      refresh(true);
    });
    marker.on("dragend", () => {
      draggingMarker = false;
      afterChange();
    });
    marker.on("click", () => {
      if (state.mode !== "click") return;
      if (isStart && closed) removeWaypoint(lastIndex);
      else if (isStart && points.length >= 3) closeLoop();
      else removeWaypoint(index);
    });
    markersLayer.addLayer(marker);
  });
}

function renderKmMarkers() {
  kmLayer.clearLayers();
  const km = route.distance / 1000;
  if (km < 1) return;
  const step = km > 40 ? 5 : km > 15 ? 2 : 1;
  for (let mark = step; mark < km; mark += step) {
    const point = pointAtDistance(mark * 1000);
    L.marker(point, {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({ className: "km-label", html: `<span>${mark}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
    }).addTo(kmLayer);
  }
}

function fitRoute() {
  if (route.coords.length >= 2) map.fitBounds(L.latLngBounds(route.coords), { padding: [70, 70], maxZoom: 17 });
  else if (route.coords.length === 1) map.setView(route.coords[0], 15);
}

/* ---------- modos de desenho ---------- */

function setMode(mode) {
  state.mode = mode;
  modeButtons.forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  els.map.classList.toggle("freehand", mode === "free");
  if (mode === "free") map.dragging.disable();
  else map.dragging.enable();
  setStatus(defaultHint());
}

function setupFreehand() {
  let stroke = null;
  let lastPixel = null;

  els.map.addEventListener("pointerdown", (event) => {
    if (state.mode !== "free" || event.button !== 0) return;
    if (event.target.closest(".leaflet-marker-icon, .leaflet-control")) return;
    stroke = [map.mouseEventToLatLng(event)];
    lastPixel = { x: event.clientX, y: event.clientY };
    els.map.setPointerCapture(event.pointerId);
    sketchLine.setLatLngs(stroke);
    event.preventDefault();
  });

  els.map.addEventListener("pointermove", (event) => {
    if (!stroke) return;
    if (Math.hypot(event.clientX - lastPixel.x, event.clientY - lastPixel.y) < 4) return;
    lastPixel = { x: event.clientX, y: event.clientY };
    stroke.push(map.mouseEventToLatLng(event));
    sketchLine.setLatLngs(stroke);
  });

  const finish = () => {
    if (!stroke) return;
    const drawn = stroke.map((p) => ({ lat: p.lat, lng: p.lng }));
    stroke = null;
    sketchLine.setLatLngs([]);
    const metersPerPixel = (40_075_016 * Math.cos(toRad(map.getCenter().lat))) / (256 * 2 ** map.getZoom());
    const points = simplifyToLimit(drawn, MAX_FREEHAND_POINTS, metersPerPixel * 8);
    commit(() => state.waypoints.push(...points));
    if (points.length > 1) setStatus(`Traço convertido em ${points.length} pontos editáveis.`, "success");
  };
  els.map.addEventListener("pointerup", finish);
  els.map.addEventListener("pointercancel", finish);
}

/* ---------- criação automática ---------- */

function targetMeters() {
  const km = Number(String(els.targetKm.value).replace(",", "."));
  return Math.min(60, Math.max(1, Number.isFinite(km) && km > 0 ? km : 5)) * 1000;
}

function setBusy(value) {
  busy = value;
  els.autoLoop.disabled = value;
  shapeButtons.forEach((button) => {
    button.disabled = value;
  });
}

/* Circuito com a distância pedida: distribui pontos num círculo que passa
   pela largada e ajusta o raio até a rota real chegar perto do alvo. */
async function generateLoop() {
  if (busy) return;
  const target = targetMeters();
  const center = map.getCenter();
  const start = state.waypoints[0] ? copyPoint(state.waypoints[0]) : { lat: center.lat, lng: center.lng };
  const snap = els.snap.checked;
  const profile = activityConfig().profile;
  const bearing = Math.random() * Math.PI * 2;
  const direction = Math.random() < 0.5 ? 1 : -1;
  const count = snap ? 4 : 24;

  const ring = (radius) => {
    const middle = offsetPoint(start, Math.cos(bearing) * radius, Math.sin(bearing) * radius);
    const points = [copyPoint(start)];
    for (let k = 1; k < count; k += 1) {
      const angle = bearing + Math.PI + (direction * k * Math.PI * 2) / count;
      points.push(offsetPoint(middle, Math.cos(angle) * radius, Math.sin(angle) * radius));
    }
    points.push(copyPoint(start));
    return points;
  };

  setBusy(true);
  setStatus("Montando um circuito com essa distância...", "loading");
  try {
    let radius = (target / (2 * Math.PI)) * (snap ? 0.72 : 1);
    let best = null;
    for (let attempt = 0; attempt < (snap ? 4 : 1); attempt += 1) {
      const points = ring(radius);
      if (!snap) {
        best = { points, distance: pathLength(points) };
        break;
      }
      const legs = await fetchLegs(points, profile);
      const distance = legs.reduce((sum, line) => sum + pathLength(line), 0);
      if (!best || Math.abs(distance - target) < Math.abs(best.distance - target)) best = { points, legs, distance };
      if (Math.abs(distance - target) / target < 0.06) break;
      radius *= Math.min(1.7, Math.max(0.5, target / Math.max(1, distance)));
    }
    if (best.legs) storeLegs(best.points, best.legs, profile);
    commit(() => {
      state.waypoints = best.points;
    });
    fitRoute();
    setStatus(`Circuito de ${formatDistance(best.distance)} criado. Clique de novo para outra opção.`, "success");
  } catch (error) {
    setStatus("Não consegui calcular o circuito agora. Verifique a conexão e tente de novo.", "error");
  } finally {
    setBusy(false);
  }
}

function unitShape(kind) {
  const points = [];
  if (kind === "heart") {
    for (let i = 0; i < 28; i += 1) {
      const t = (Math.PI * 2 * i) / 28;
      points.push([
        16 * Math.sin(t) ** 3,
        13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t),
      ]);
    }
  } else if (kind === "star") {
    for (let i = 0; i < 10; i += 1) {
      const angle = (Math.PI * 2 * i) / 10;
      const radius = i % 2 === 0 ? 1 : 0.42;
      points.push([Math.sin(angle) * radius, Math.cos(angle) * radius]);
    }
  } else {
    for (let i = 0; i < 20; i += 1) {
      const angle = (Math.PI * 2 * i) / 20;
      points.push([Math.sin(angle), Math.cos(angle)]);
    }
  }
  points.push(points[0]);
  return points;
}

function createShape(kind) {
  if (busy) return;
  const shape = unitShape(kind);
  let perimeter = 0;
  for (let i = 1; i < shape.length; i += 1) {
    perimeter += Math.hypot(shape[i][0] - shape[i - 1][0], shape[i][1] - shape[i - 1][1]);
  }
  const scale = targetMeters() / perimeter;
  const midY = (Math.max(...shape.map((p) => p[1])) + Math.min(...shape.map((p) => p[1]))) / 2;
  const center = map.getCenter();
  const points = shape.map(([x, y]) => offsetPoint(center, (y - midY) * scale, x * scale));
  commit(() => {
    state.waypoints = points;
  });
  fitRoute();
  if (els.snap.checked) setStatus("Forma criada. Seguindo ruas, a distância final pode ficar maior que a desejada.", "loading");
}

/* ---------- elevação ---------- */

function scheduleElevation() {
  clearTimeout(elevationTimer);
  elevationToken += 1;
  elevation = null;
  if (route.distance < 30) {
    renderElevation();
    return;
  }
  els.elevNote.textContent = "Buscando altimetria...";
  elevationTimer = setTimeout(loadElevation, 700);
}

async function loadElevation() {
  if (pendingLegs.size) {
    elevationTimer = setTimeout(loadElevation, 500);
    return;
  }
  const token = elevationToken;
  const total = route.distance;
  const count = Math.min(100, Math.max(12, Math.round(total / 40)));
  const distances = Array.from({ length: count }, (_, i) => (total * i) / (count - 1));
  const samples = distances.map(pointAtDistance);
  const lat = samples.map((p) => p.lat.toFixed(5)).join(",");
  const lng = samples.map((p) => p.lng.toFixed(5)).join(",");
  try {
    const data = await fetchJson(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`);
    if (token !== elevationToken) return;
    const raw = data.elevation;
    if (!Array.isArray(raw) || raw.length !== count) throw new Error("Elevação incompleta");
    const smooth = raw.map((value, i) => {
      const slice = raw.slice(Math.max(0, i - 1), i + 2);
      return slice.reduce((sum, v) => sum + v, 0) / slice.length;
    });
    elevation = { distances, values: smooth };
  } catch (error) {
    if (token !== elevationToken) return;
    elevation = null;
    els.elevNote.textContent = "Altimetria indisponível no momento.";
    renderStats();
    drawChart();
    return;
  }
  renderElevation();
}

function elevationAt(distance) {
  if (!elevation) return null;
  const { distances, values } = elevation;
  if (distance <= 0) return values[0];
  const last = distances.length - 1;
  if (distance >= distances[last]) return values[last];
  const step = distances[1] - distances[0];
  const i = Math.min(last - 1, Math.floor(distance / step));
  const t = (distance - distances[i]) / step;
  return values[i] + (values[i + 1] - values[i]) * t;
}

function elevationTotals() {
  if (!elevation) return null;
  let gain = 0;
  let loss = 0;
  const { values } = elevation;
  for (let i = 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    if (delta > 0) gain += delta;
    else loss -= delta;
  }
  return { gain, loss, max: Math.max(...values), min: Math.min(...values) };
}

function renderElevation() {
  renderStats();
  drawChart();
  if (elevation) els.elevNote.textContent = "Passe o cursor no gráfico para localizar o ponto no mapa.";
  else if (route.distance < 30) els.elevNote.textContent = "Monte uma rota para ver a altimetria.";
}

const CHART = { width: 1000, height: 230, left: 58, right: 16, top: 16, bottom: 34 };

function drawChart() {
  const svg = els.chart;
  const { width, height, left, right, top, bottom } = CHART;
  const baseline = height - bottom;
  if (!elevation) {
    svg.innerHTML = `<path d="M ${left} ${baseline} H ${width - right}" class="chart-axis"></path>`;
    return;
  }
  const { distances, values } = elevation;
  const total = distances[distances.length - 1];
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 20) {
    const middle = (max + min) / 2;
    min = middle - 10;
    max = middle + 10;
  }
  const x = (d) => left + (d / total) * (width - left - right);
  const y = (v) => baseline - ((v - min) / (max - min)) * (baseline - top);
  const line = values.map((v, i) => `${i ? "L" : "M"} ${x(distances[i]).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(total).toFixed(1)} ${baseline} L ${left} ${baseline} Z`;

  const yTicks = [min, (min + max) / 2, max]
    .map((v) => `<path d="M ${left} ${y(v).toFixed(1)} H ${width - right}" class="chart-grid"></path>
      <text x="${left - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${Math.round(v)} m</text>`)
    .join("");
  const xTicks = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const label = ((total * f) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
      const anchor = f === 0 ? "start" : f === 1 ? "end" : "middle";
      return `<text x="${x(total * f).toFixed(1)}" y="${height - 10}" text-anchor="${anchor}">${label} km</text>`;
    })
    .join("");

  svg.innerHTML = `${yTicks}${xTicks}
    <path d="${area}" class="chart-area"></path>
    <path d="${line}" class="chart-line"></path>
    <g id="chartCursor" visibility="hidden">
      <path d="M 0 ${top} V ${baseline}" class="chart-cursor"></path>
      <circle r="5" class="chart-dot"></circle>
      <text class="chart-tip" y="${top + 12}"></text>
    </g>`;
}

function setupChartHover() {
  const svg = els.chart;
  const hide = () => {
    svg.querySelector("#chartCursor")?.setAttribute("visibility", "hidden");
    hoverMarker.remove();
  };
  svg.addEventListener("pointermove", (event) => {
    const cursor = svg.querySelector("#chartCursor");
    if (!elevation || !cursor) return;
    const box = svg.getBoundingClientRect();
    const { width, left, right, top, bottom, height } = CHART;
    const px = ((event.clientX - box.left) / box.width) * width;
    const fraction = Math.min(1, Math.max(0, (px - left) / (width - left - right)));
    const total = elevation.distances[elevation.distances.length - 1];
    const distance = total * fraction;
    const value = elevationAt(distance);
    const values = elevation.values;
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (max - min < 20) {
      const middle = (max + min) / 2;
      min = middle - 10;
      max = middle + 10;
    }
    const cx = left + fraction * (width - left - right);
    const cy = height - bottom - ((value - min) / (max - min)) * (height - bottom - top);
    cursor.setAttribute("visibility", "visible");
    cursor.querySelector("path").setAttribute("transform", `translate(${cx.toFixed(1)} 0)`);
    const dot = cursor.querySelector("circle");
    dot.setAttribute("cx", cx.toFixed(1));
    dot.setAttribute("cy", cy.toFixed(1));
    const tip = cursor.querySelector("text");
    tip.textContent = `${formatDistance(distance)} · ${Math.round(value)} m`;
    tip.setAttribute("x", cx.toFixed(1));
    tip.setAttribute("text-anchor", fraction > 0.8 ? "end" : fraction < 0.2 ? "start" : "middle");
    tip.setAttribute("dx", fraction > 0.8 ? -10 : fraction < 0.2 ? 10 : 0);
    const point = pointAtDistance(distance);
    if (point) hoverMarker.setLatLng(point).addTo(map);
  });
  svg.addEventListener("pointerleave", hide);
}

/* ---------- painel ---------- */

function renderStats() {
  const seconds = (route.distance / 1000) * secondsPerKm();
  const totals = elevationTotals();
  const meters = (value) => `${Math.round(value)} m`;
  $("#distanceStat").textContent = formatDistance(route.distance);
  $("#durationStat").textContent = formatDuration(seconds);
  $("#gainStat").textContent = totals ? meters(totals.gain) : "—";
  $("#lossStat").textContent = totals ? meters(totals.loss) : "—";
  $("#maxElevStat").textContent = totals ? meters(totals.max) : "—";
  $("#minElevStat").textContent = totals ? meters(totals.min) : "—";
  $("#dockDistance").textContent = formatDistance(route.distance);
  $("#dockTime").textContent = formatDuration(seconds);
  $("#dockGain").textContent = totals ? `subida ${meters(totals.gain)}` : "subida —";
}

function updateButtons() {
  const count = state.waypoints.length;
  els.undo.disabled = !undoStack.length;
  els.redo.disabled = !redoStack.length;
  els.loop.disabled = count < 2 || isClosed();
  els.back.disabled = count < 2;
  els.reverse.disabled = count < 2;
  els.clear.disabled = count === 0;
  els.download.disabled = route.coords.length < 2;
}

function applyActivity() {
  const config = activityConfig();
  els.paceLabel.textContent = config.label;
  els.pace.value = paceByActivity[els.activity.value] || config.fallback;
}

/* ---------- busca ---------- */

let suggestTimer = 0;
let suggestToken = 0;

function placeLabel(properties) {
  const parts = [properties.name, properties.street, properties.city, properties.state, properties.country];
  return [...new Set(parts.filter(Boolean))].join(", ");
}

function hideSuggestions() {
  els.suggestions.hidden = true;
  els.suggestions.innerHTML = "";
}

function goToPlace(lat, lng, label) {
  map.setView([lat, lng], 15);
  hideSuggestions();
  setStatus(`Mapa em ${label}. ${defaultHint()}`, "success");
}

async function loadSuggestions(query) {
  const token = ++suggestToken;
  const center = map.getCenter();
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&lat=${center.lat.toFixed(3)}&lon=${center.lng.toFixed(3)}`;
  const data = await fetchJson(url, 6000);
  if (token !== suggestToken) return [];
  return (data.features || []).map((feature) => ({
    label: placeLabel(feature.properties),
    lat: feature.geometry.coordinates[1],
    lng: feature.geometry.coordinates[0],
  }));
}

function showSuggestions(items) {
  if (!items.length) {
    hideSuggestions();
    return;
  }
  els.suggestions.innerHTML = items
    .map((item, index) => `<li><button type="button" data-index="${index}">${escapeHtml(item.label)}</button></li>`)
    .join("");
  els.suggestions.hidden = false;
  els.suggestions.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const item = items[Number(button.dataset.index)];
      els.search.value = item.label;
      goToPlace(item.lat, item.lng, item.label);
    });
  });
}

function onSearchInput() {
  clearTimeout(suggestTimer);
  const query = els.search.value.trim();
  if (query.length < 3) {
    hideSuggestions();
    return;
  }
  suggestTimer = setTimeout(async () => {
    try {
      showSuggestions(await loadSuggestions(query));
    } catch (error) {
      hideSuggestions();
    }
  }, 320);
}

async function onSearchSubmit(event) {
  event.preventDefault();
  clearTimeout(suggestTimer);
  const query = els.search.value.trim();
  if (!query) return;
  setStatus("Procurando o lugar...", "loading");
  try {
    const items = await loadSuggestions(query);
    if (items.length) {
      goToPlace(items[0].lat, items[0].lng, items[0].label);
      return;
    }
  } catch (error) {
    /* tenta o segundo serviço abaixo */
  }
  try {
    const results = await fetchJson(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`
    );
    if (!results.length) {
      setStatus("Lugar não encontrado. Tente cidade, bairro ou endereço.", "error");
      return;
    }
    goToPlace(Number(results[0].lat), Number(results[0].lon), results[0].display_name.split(",").slice(0, 2).join(","));
  } catch (error) {
    setStatus("Busca indisponível agora. Verifique a conexão.", "error");
  }
}

function locateMe() {
  if (!navigator.geolocation) {
    setStatus("Este navegador não informa a localização.", "error");
    return;
  }
  setStatus("Procurando sua localização...", "loading");
  navigator.geolocation.getCurrentPosition(
    (position) => goToPlace(position.coords.latitude, position.coords.longitude, "sua localização"),
    () => setStatus("Não foi possível obter a localização. Use a busca.", "error"),
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

/* ---------- GPX ---------- */

function createGpx() {
  const name = escapeXml(els.routeName.value.trim() || "Minha rota");
  const desc = els.description.value.trim();
  const points = route.coords
    .map((coord, index) => {
      const ele = elevationAt(route.cum[index]);
      const eleTag = ele === null ? "" : `<ele>${ele.toFixed(1)}</ele>`;
      return `      <trkpt lat="${coord.lat.toFixed(6)}" lon="${coord.lng.toFixed(6)}">${eleTag}</trkpt>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Traçado GPX" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${name}</name>${desc ? `\n    <desc>${escapeXml(desc)}</desc>` : ""}
  </metadata>
  <trk>
    <name>${name}</name>
    <type>${activityConfig().gpxType}</type>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`;
}

function downloadGpx() {
  if (route.coords.length < 2) return;
  const blob = new Blob([createGpx()], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeName = (els.routeName.value || "rota")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  link.href = url;
  link.download = `${safeName || "rota"}.gpx`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus(elevation ? "Rota baixada com traçado e altimetria." : "Rota baixada (sem altimetria).", "success");
}

async function importGpx(file) {
  try {
    const xml = new DOMParser().parseFromString(await file.text(), "application/xml");
    let nodes = [...xml.querySelectorAll("trkpt, rtept")];
    if (nodes.length < 2) nodes = [...xml.querySelectorAll("wpt")];
    const points = nodes
      .map((node) => ({ lat: Number(node.getAttribute("lat")), lng: Number(node.getAttribute("lon")) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (points.length < 2) throw new Error("Sem pontos");
    const simplified = simplifyToLimit(points, MAX_IMPORT_POINTS, 15);
    const name = xml.querySelector("trk > name, rte > name, metadata > name")?.textContent?.trim();
    if (name) els.routeName.value = name;
    els.snap.checked = false;
    commit(() => {
      state.waypoints = simplified;
    });
    fitRoute();
    setStatus(`Rota importada com ${simplified.length} pontos editáveis. "Seguir ruas" foi desligado para manter o traçado.`, "success");
  } catch (error) {
    setStatus("Não consegui ler esse arquivo. Ele precisa ser um GPX com trilha ou rota.", "error");
  }
}

/* ---------- rascunho ---------- */

function saveDraft() {
  try {
    const center = map.getCenter();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        waypoints: state.waypoints,
        snap: els.snap.checked,
        activity: els.activity.value,
        pace: paceByActivity,
        name: els.routeName.value,
        description: els.description.value,
        target: els.targetKm.value,
        view: { lat: center.lat, lng: center.lng, zoom: map.getZoom() },
      })
    );
  } catch (error) {
    /* armazenamento indisponível: segue sem rascunho */
  }
}

function loadDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!draft || typeof draft !== "object") return null;
    if (Array.isArray(draft.waypoints)) {
      state.waypoints = draft.waypoints
        .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
        .map(copyPoint);
    }
    if (typeof draft.snap === "boolean") els.snap.checked = draft.snap;
    if (ACTIVITIES[draft.activity]) els.activity.value = draft.activity;
    if (draft.pace && typeof draft.pace === "object") {
      Object.keys(paceByActivity).forEach((key) => {
        if (typeof draft.pace[key] === "string") paceByActivity[key] = draft.pace[key];
      });
    }
    if (typeof draft.name === "string" && draft.name) els.routeName.value = draft.name;
    if (typeof draft.description === "string") els.description.value = draft.description;
    if (draft.target) setTarget(draft.target);
    return draft.view && Number.isFinite(draft.view.lat) && Number.isFinite(draft.view.lng) ? draft.view : null;
  } catch (error) {
    return null;
  }
}

function setTarget(value) {
  els.targetKm.value = value;
  els.targetRange.value = Math.min(Number(els.targetRange.max), Number(value) || 5);
}

/* ---------- inicialização ---------- */

function init() {
  if (!window.L) {
    els.map.innerHTML = '<div class="map-unavailable">O mapa não carregou. Confira a conexão e recarregue a página.</div>';
    setStatus("O mapa precisa de internet para carregar.", "error");
    return;
  }

  const view = loadDraft() || DEFAULT_VIEW;
  applyActivity();

  map = L.map(els.map, { zoomControl: false }).setView([view.lat, view.lng], view.zoom || 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  routeLine = L.polyline([], { color: "#e2470a", weight: 6, opacity: 0.95, lineJoin: "round", lineCap: "round", interactive: false }).addTo(map);
  hitLine = L.polyline([], { color: "#000", weight: 22, opacity: 0, className: "route-hit" }).addTo(map);
  sketchLine = L.polyline([], { color: "#1f2937", weight: 3, opacity: 0.8, dashArray: "4 7", interactive: false }).addTo(map);
  kmLayer = L.layerGroup().addTo(map);
  markersLayer = L.layerGroup().addTo(map);
  hoverMarker = L.circleMarker([0, 0], { radius: 7, color: "#fff", weight: 3, fillColor: "#1f2937", fillOpacity: 1, interactive: false });

  map.on("click", (event) => {
    if (state.mode === "click") addWaypoint(event.latlng);
  });
  hitLine.on("click", (event) => {
    L.DomEvent.stopPropagation(event);
    if (state.mode === "click" && state.waypoints.length >= 2) insertOnLine(event.latlng);
  });
  map.on("moveend", saveDraft);

  setupFreehand();
  setupChartHover();

  modeButtons.forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
  shapeButtons.forEach((button) => button.addEventListener("click", () => createShape(button.dataset.shape)));
  els.autoLoop.addEventListener("click", generateLoop);
  els.undo.addEventListener("click", undo);
  els.redo.addEventListener("click", redo);
  els.loop.addEventListener("click", closeLoop);
  els.back.addEventListener("click", outAndBack);
  els.reverse.addEventListener("click", reverseRoute);
  els.clear.addEventListener("click", clearRoute);
  els.download.addEventListener("click", downloadGpx);

  els.snap.addEventListener("change", () => {
    afterChange();
    if (!els.snap.checked) setStatus("Linhas retas entre os pontos.");
  });
  els.activity.addEventListener("change", () => {
    applyActivity();
    afterChange();
  });
  els.pace.addEventListener("input", () => {
    paceByActivity[els.activity.value] = els.pace.value;
    renderStats();
    saveDraft();
  });
  els.targetKm.addEventListener("input", () => {
    setTarget(els.targetKm.value);
    saveDraft();
  });
  els.targetRange.addEventListener("input", () => {
    els.targetKm.value = els.targetRange.value;
    saveDraft();
  });
  [els.routeName, els.description].forEach((input) => input.addEventListener("input", saveDraft));

  els.searchForm.addEventListener("submit", onSearchSubmit);
  els.search.addEventListener("input", onSearchInput);
  document.addEventListener("click", (event) => {
    if (!els.searchForm.contains(event.target)) hideSuggestions();
  });

  $("#zoomIn").addEventListener("click", () => map.zoomIn());
  $("#zoomOut").addEventListener("click", () => map.zoomOut());
  $("#fitButton").addEventListener("click", fitRoute);
  $("#locateButton").addEventListener("click", locateMe);
  $("#helpButton").addEventListener("click", () => $("#helpDialog").showModal());
  els.importInput.addEventListener("change", () => {
    const file = els.importInput.files?.[0];
    if (file) importGpx(file);
    els.importInput.value = "";
  });

  document.addEventListener("keydown", (event) => {
    if (event.target.closest("input, textarea, select")) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if ((event.ctrlKey || event.metaKey) && key === "y") {
      event.preventDefault();
      redo();
    } else if (key === "escape" && state.mode === "free") {
      setMode("click");
    }
  });

  refresh();
  setStatus(defaultHint());
  ensureRouting();
}

init();
