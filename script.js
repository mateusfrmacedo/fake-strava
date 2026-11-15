"use strict";

/* Fake Strava: planejador de rotas.
   Estado = lista de pontos de passagem (waypoints). A geometria de cada trecho
   vem de um cache indexado pelas coordenadas, então a tela é sempre derivada de
   "waypoints + cache" e respostas atrasadas da rede nunca bagunçam a rota. */

const $ = (selector) => document.querySelector(selector);

const STORAGE_KEY = "tracado-gpx-rascunho-v1";
const DEFAULT_VIEW = { lat: -23.5617, lng: -46.6918, zoom: 14 };
const MAX_HISTORY = 100;
const MAX_FREEHAND_POINTS = 40;
const MAX_IMPORT_POINTS = 60;

/* climb: segundos a mais por metro de subida (quando a opção está ligada).
   kcalPerKgKm: gasto aproximado a pé; met: gasto fixo; sem os dois, o MET do
   pedal vem da velocidade média. */
const PACE_LABEL = "Ritmo (min/km)";
const SPEED_LABEL = "Velocidade (km/h)";
const ACTIVITIES = {
  run: { profile: "foot", gpxType: "running", label: PACE_LABEL, kind: "pace", fallback: "5:30", climb: 2.3, kcalPerKgKm: 1.0 },
  trail: { profile: "foot", gpxType: "trail running", label: PACE_LABEL, kind: "pace", fallback: "6:30", climb: 2.6, kcalPerKgKm: 1.1 },
  walk: { profile: "foot", gpxType: "walking", label: PACE_LABEL, kind: "pace", fallback: "10:00", climb: 6, kcalPerKgKm: 0.6, heartRate: 105 },
  hike: { profile: "foot", gpxType: "hiking", label: PACE_LABEL, kind: "pace", fallback: "13:00", climb: 6, kcalPerKgKm: 0.8, heartRate: 120 },
  ride: { profile: "bike", gpxType: "cycling", label: SPEED_LABEL, kind: "speed", fallback: "25", climb: 3 },
  gravel: { profile: "bike", gpxType: "gravel cycling", label: SPEED_LABEL, kind: "speed", fallback: "20", climb: 3.5 },
  mtb: { profile: "bike", gpxType: "mountain biking", label: SPEED_LABEL, kind: "speed", fallback: "15", climb: 4, met: 8.5 },
  ebike: { profile: "bike", gpxType: "e-bike ride", label: SPEED_LABEL, kind: "speed", fallback: "23", climb: 1, met: 5 },
  swim: { gpxType: "open water swimming", label: "Ritmo (min/100 m)", kind: "pace", fallback: "2:15", paceDistance: 0.1, met: 7 },
  kayak: { gpxType: "kayaking", label: SPEED_LABEL, kind: "speed", fallback: "6", met: 5 },
  row: { gpxType: "rowing", label: SPEED_LABEL, kind: "speed", fallback: "8", met: 7 },
  sup: { gpxType: "stand up paddleboarding", label: SPEED_LABEL, kind: "speed", fallback: "5", met: 5 },
  skate: { profile: "foot", gpxType: "inline skating", label: SPEED_LABEL, kind: "speed", fallback: "14", climb: 4, met: 7 },
  wheelchair: { profile: "foot", gpxType: "wheelchair", label: SPEED_LABEL, kind: "speed", fallback: "8", climb: 5, met: 5 },
  indoorRun: { gpxType: "treadmill running", label: PACE_LABEL, kind: "pace", fallback: "6:00", kcalPerKgKm: 1 },
  indoorRide: { gpxType: "indoor cycling", label: SPEED_LABEL, kind: "speed", fallback: "22", met: 7 },
};

const ACTIVITY_GROUPS = {
  "A pé": { run: "Corrida", trail: "Corrida em trilha", walk: "Caminhada", hike: "Trilha a pé", indoorRun: "Corrida em esteira", nordicWalk: "Caminhada nórdica", stairs: "Subida de escadas" },
  "Ciclismo": { ride: "Pedal de estrada", gravel: "Gravel", mtb: "Mountain bike", ebike: "Bicicleta elétrica", indoorRide: "Ciclismo indoor", emtb: "Mountain bike elétrica", handcycle: "Handbike", velomobile: "Velomóvel", trackBike: "Ciclismo de pista", bmx: "BMX" },
  "Aquáticos": { swim: "Natação em águas abertas", pool: "Natação em piscina", kayak: "Caiaque", row: "Remo", sup: "Stand up paddle", canoe: "Canoagem", surf: "Surfe", sail: "Vela", windsurf: "Windsurfe", kitesurf: "Kitesurfe", waterPolo: "Polo aquático", indoorRow: "Remo indoor" },
  "Coletivos": { soccer: "Futebol", futsal: "Futsal", basketball: "Basquete", volleyball: "Vôlei", handball: "Handebol", rugby: "Rúgbi", baseball: "Beisebol", cricket: "Críquete", hockey: "Hóquei" },
  "Raquete": { tennis: "Tênis", tableTennis: "Tênis de mesa", badminton: "Badminton", padel: "Padel", pickleball: "Pickleball", squash: "Squash", racquetball: "Racquetball", beachTennis: "Beach tennis" },
  "Inverno": { alpineSki: "Esqui alpino", nordicSki: "Esqui de fundo", backcountrySki: "Esqui de montanha", snowboard: "Snowboard", iceSkate: "Patinação no gelo", snowshoe: "Caminhada com raquetes de neve", rollerSki: "Roller ski" },
  "Força e treino": { strength: "Musculação", crossfit: "CrossFit", hiit: "HIIT", workout: "Treino funcional", elliptical: "Elíptico", yoga: "Yoga", pilates: "Pilates", climbing: "Escalada", martialArts: "Artes marciais", boxing: "Boxe" },
  "Dança e outras": { dance: "Dança", skate: "Patinação", skateboard: "Skate", wheelchair: "Cadeira de rodas", golf: "Golfe", therapy: "Fisioterapia", custom: "Personalizada" },
};

const DISTANCE_SPORTS = {
  nordicWalk: { ...ACTIVITIES.walk, gpxType: "nordic walking" },
  handcycle: { ...ACTIVITIES.ride, fallback: "18", gpxType: "handcycle", met: 6 },
  velomobile: { ...ACTIVITIES.ride, fallback: "32", gpxType: "velomobile", met: 8 },
  trackBike: { ...ACTIVITIES.indoorRide, fallback: "32", gpxType: "track cycling" },
  emtb: { ...ACTIVITIES.ebike, fallback: "17", gpxType: "electric mountain biking" },
  pool: { ...ACTIVITIES.swim, gpxType: "pool swimming" },
  canoe: { ...ACTIVITIES.kayak, gpxType: "canoeing" },
  sail: { ...ACTIVITIES.kayak, fallback: "12", gpxType: "sailing", met: 3 },
  windsurf: { ...ACTIVITIES.row, fallback: "18", gpxType: "windsurfing" },
  kitesurf: { ...ACTIVITIES.row, fallback: "22", gpxType: "kitesurfing" },
  indoorRow: { ...ACTIVITIES.row, gpxType: "indoor rowing" },
  alpineSki: { ...ACTIVITIES.row, fallback: "28", gpxType: "alpine skiing" },
  nordicSki: { ...ACTIVITIES.row, fallback: "10", gpxType: "nordic skiing" },
  backcountrySki: { ...ACTIVITIES.row, fallback: "9", gpxType: "backcountry skiing" },
  snowboard: { ...ACTIVITIES.row, fallback: "25", gpxType: "snowboarding" },
  iceSkate: { ...ACTIVITIES.row, fallback: "12", gpxType: "ice skating" },
  snowshoe: { ...ACTIVITIES.hike, profile: undefined, gpxType: "snowshoeing" },
  rollerSki: { ...ACTIVITIES.skate, gpxType: "roller skiing" },
  skateboard: { ...ACTIVITIES.skate, fallback: "12", gpxType: "skateboarding" },
};

const TIMED_SPORTS = {
  stairs: ["stair stepper", 8], bmx: ["BMX", 8], surf: ["surfing", 4], waterPolo: ["water polo", 8],
  soccer: ["soccer", 7], futsal: ["futsal", 7], basketball: ["basketball", 6], volleyball: ["volleyball", 4],
  handball: ["handball", 8], rugby: ["rugby", 8], baseball: ["baseball", 5], cricket: ["cricket", 5], hockey: ["hockey", 8],
  tennis: ["tennis", 7], tableTennis: ["table tennis", 4], badminton: ["badminton", 5], padel: ["padel", 6],
  pickleball: ["pickleball", 5], squash: ["squash", 9], racquetball: ["racquetball", 7], beachTennis: ["beach tennis", 6],
  strength: ["weight training", 4], crossfit: ["crossfit", 8], hiit: ["HIIT", 8], workout: ["workout", 5],
  elliptical: ["elliptical", 5], yoga: ["yoga", 3], pilates: ["pilates", 3], climbing: ["rock climbing", 7],
  martialArts: ["martial arts", 7], boxing: ["boxing", 8], dance: ["dance", 5], golf: ["golf", 4],
  therapy: ["physical therapy", 3], custom: ["custom", 0],
};

Object.assign(ACTIVITIES, DISTANCE_SPORTS);
for (const [key, [gpxType, met]] of Object.entries(TIMED_SPORTS)) {
  ACTIVITIES[key] = { gpxType: gpxType.toLowerCase(), met, kind: "time", fallback: "" };
}

const els = {
  map: $("#routeMap"),
  status: $("#statusText"),
  searchPanel: $("#mapSearch"),
  searchToggle: $("#searchToggle"),
  searchForm: $("#searchForm"),
  search: $("#locationSearch"),
  suggestions: $("#suggestions"),
  snap: $("#snapToggle"),
  targetKm: $("#targetKm"),
  targetRange: $("#targetRange"),
  autoLoop: $("#autoLoop"),
  routeName: $("#routeName"),
  activity: $("#activity"),
  customActivity: $("#customActivity"),
  pace: $("#paceInput"),
  time: $("#timeInput"),
  weight: $("#weightInput"),
  climb: $("#climbToggle"),
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
const simulationFields = {
  distance: $("#simulationDistance"),
  gain: $("#simulationGain"),
  calories: $("#simulationCalories"),
  heartRate: $("#simulationHeartRate"),
  date: $("#simulationDate"),
  time: els.time,
};
const modeButtons = [...document.querySelectorAll("[data-mode]")];
const shapeButtons = [...document.querySelectorAll("[data-shape]")];

const state = { waypoints: [], mode: "click" };
const paceByActivity = Object.fromEntries(Object.entries(ACTIVITIES).map(([key, config]) => [key, config.fallback]));
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

const pad2 = (value) => String(value).padStart(2, "0");
const paceDistance = () => activityConfig().paceDistance || 1;

function readNumber(text) {
  const raw = text.trim().replace(",", ".");
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function readPace(text) {
  if (activityConfig().kind === "speed") {
    const speed = readNumber(text);
    return speed > 0 ? 3600 / speed : null;
  }
  const match = text.trim().match(/^(\d+):([0-5]?\d)$/);
  const seconds = match ? Number(match[1]) * 60 + Number(match[2]) : readNumber(text) * 60;
  return seconds > 0 ? seconds / paceDistance() : null;
}

function secondsPerKm() {
  if (activityConfig().kind === "time") return 0;
  return readPace(paceByActivity[els.activity.value]) || readPace(activityConfig().fallback);
}

function climbSeconds(gain) {
  return els.climb.checked ? (gain || 0) * (activityConfig().climb || 0) : 0;
}

function formatClock(totalSeconds) {
  const seconds = Math.round(totalSeconds);
  return `${Math.floor(seconds / 3600)}:${pad2(Math.floor((seconds % 3600) / 60))}:${pad2(seconds % 60)}`;
}

/* Aceita horas:minutos:segundos, minutos:segundos ou minutos decimais. */
function parseClock(text) {
  const raw = text.trim();
  if (!raw.includes(":")) {
    const minutes = readNumber(raw);
    return minutes > 0 ? minutes * 60 : null;
  }
  if (!/^\d+(?::[0-5]?\d){1,2}$/.test(raw)) return null;
  const seconds = raw.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  return seconds > 0 ? seconds : null;
}

function formatPaceInput(perKmSeconds) {
  if (activityConfig().kind === "speed") return (3600 / perKmSeconds).toFixed(1);
  const total = Math.round(perKmSeconds * paceDistance());
  return `${Math.floor(total / 60)}:${pad2(total % 60)}`;
}

function formatAverage(perKmSeconds) {
  const pace = formatPaceInput(perKmSeconds);
  if (activityConfig().kind === "speed") return `${pace.replace(".", ",")} km/h`;
  return `${pace} ${paceDistance() === 1 ? "/km" : "/100 m"}`;
}

function estimateCalories(km, seconds, gain) {
  const kg = Number(els.weight.value);
  if (!(kg > 0) || !(seconds > 0)) return null;
  const config = activityConfig();
  if (config.kcalPerKgKm) {
    return km > 0 ? kg * (km * config.kcalPerKgKm + (gain || 0) * 0.0094) : null;
  }
  if (config.kind === "time") return config.met ? config.met * kg * seconds / 3600 : null;
  const speed = km / (seconds / 3600);
  const met = config.met || (speed < 16 ? 4 : speed < 19 ? 6.8 : speed < 22.5 ? 8 : speed < 25.5 ? 10 : speed < 30.5 ? 12 : 15.8);
  return met * kg * seconds / 3600;
}

function readSimulationField(input, parse) {
  const value = parse(input.value);
  input.setAttribute("aria-invalid", String(Boolean(input.value.trim()) && value === null));
  return value;
}

function renderSimulation(totals = elevationTotals()) {
  const activity = activityConfig();
  const routeKm = route.distance / 1000;
  const manualDistance = readSimulationField(simulationFields.distance, readNumber);
  const distance = manualDistance ?? routeKm;
  const automaticGain = totals?.gain ?? null;
  const gain = readSimulationField(simulationFields.gain, readNumber) ?? automaticGain;
  const manualTime = readSimulationField(els.time, parseClock);
  const basePace = secondsPerKm();
  const ascentTime = climbSeconds(gain);
  const automaticTime = distance > 0 && basePace > 0 ? distance * basePace + ascentTime : null;
  const seconds = manualTime ?? automaticTime;
  const average = activity.kind !== "time" && distance > 0 && seconds > 0 ? seconds / distance : null;
  const automaticCalories = estimateCalories(distance, seconds, gain);
  const calories = readSimulationField(simulationFields.calories, readNumber) ?? automaticCalories;
  const automaticHeartRate = seconds > 0 && activity.kind !== "time" ? (activity.heartRate || (activity.kind === "speed" ? 135 : 150)) : null;
  const heartRate = readSimulationField(simulationFields.heartRate, readNumber) ?? automaticHeartRate;
  const date = simulationFields.date.value;

  simulationFields.distance.placeholder = routeKm > 0 ? routeKm.toFixed(2).replace(".", ",") : "0,00";
  simulationFields.gain.placeholder = automaticGain === null ? "Automático" : String(Math.round(automaticGain));
  simulationFields.calories.placeholder = automaticCalories === null ? "Automático" : String(Math.round(automaticCalories));
  simulationFields.heartRate.placeholder = automaticHeartRate === null ? "Automático" : String(automaticHeartRate);
  els.time.placeholder = automaticTime === null ? "h:mm:ss" : formatClock(automaticTime);
  els.pace.placeholder = manualTime && average ? formatPaceInput(average).replace(".", ",") : activity.fallback;
  els.paceLabel.textContent = !manualTime && activity.climb && els.climb.checked ? `${activity.label} · base` : activity.label || PACE_LABEL;
  $("#distanceStat").textContent = manualDistance !== null || routeKm > 0 ? formatDistance(distance * 1000) : "—";
  $("#durationStat").textContent = seconds === null ? "—" : formatClock(seconds);
  $("#gainStat").textContent = gain === null ? "—" : `${Math.round(gain)} m`;
  $("#avgStat").parentElement.hidden = activity.kind === "time";
  $("#activitySummary").textContent = activityName();
  $("#avgLabel").textContent = activity.kind === "speed" ? "Velocidade média" : "Ritmo médio";
  $("#avgStat").textContent = average ? formatAverage(average) : "—";
  $("#kcalStat").textContent = calories === null ? "—" : `${Math.round(calories)} kcal`;
  $("#heartRateStat").textContent = heartRate === null ? "—" : `${Math.round(heartRate)} bpm`;
  $("#simulationDateCard").hidden = !date;
  $("#dateStat").textContent = date.split("-").reverse().join("/");

  const adjustedPace = manualTime && distance > 0 ? (manualTime - ascentTime) / distance : 0;
  return adjustedPace > 0 ? adjustedPace : basePace;
}

function renderSplits(perKm) {
  const body = $("#splitsBody");
  const note = $("#splitsNote");
  const km = route.distance / 1000;
  if (km < 1) {
    body.innerHTML = "";
    note.textContent = "Aparecem em rotas com 1 km ou mais.";
    return;
  }
  note.textContent = elevation ? "Estimativa por trecho" : "Subida e descida aparecem quando a altimetria carregar.";
  const rows = [];
  const count = Math.ceil(km - 1e-9);
  for (let i = 0; i < count; i += 1) {
    const from = i * 1000;
    const to = Math.min(route.distance, from + 1000);
    let gain = null;
    let loss = null;
    if (elevation) {
      gain = 0;
      loss = 0;
      let previous = elevationAt(from);
      for (let step = 1; step <= 10; step += 1) {
        const current = elevationAt(from + ((to - from) * step) / 10);
        if (current > previous) gain += current - previous;
        else loss += previous - current;
        previous = current;
      }
    }
    const seconds = ((to - from) / 1000) * perKm + climbSeconds(gain || 0);
    const partial = to - from < 995;
    const label = partial
      ? `${i + 1} (${((to - from) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km)`
      : `${i + 1}`;
    rows.push(`<tr><td>${label}</td><td>${gain === null ? "\u2014" : `+${Math.round(gain)} m`}</td><td>${
      loss === null ? "\u2014" : `\u2212${Math.round(loss)} m`
    }</td><td>${seconds > 0 ? formatDuration(seconds) : "—"}</td></tr>`);
  }
  body.innerHTML = rows.join("");
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
function followsStreets() {
  return els.snap.checked && Boolean(activityConfig().profile);
}

async function ensureRouting() {
  if (!followsStreets() || state.waypoints.length < 2) return;
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
  const snap = followsStreets();
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
  return { waypoints: state.waypoints.map(copyPoint), snap: els.snap.checked };
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
  const previous = undoStack.pop();
  state.waypoints = previous.waypoints;
  els.snap.checked = previous.snap;
  afterChange();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  const next = redoStack.pop();
  state.waypoints = next.waypoints;
  els.snap.checked = next.snap;
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
  if (route.coords.length >= 2) {
    const paddingLimit = Math.floor(map.getSize().y * 0.42);
    const top = Math.min(paddingLimit, els.searchPanel.offsetHeight + 22);
    const bottom = Math.min(paddingLimit, $(".map-dock").offsetHeight + 32);
    map.fitBounds(L.latLngBounds(route.coords), {
      paddingTopLeft: [64, top],
      paddingBottomRight: [24, bottom],
      maxZoom: 17,
    });
  } else if (route.coords.length === 1) {
    map.setView(route.coords[0], 15);
  }
}

/* ---------- modos de desenho ---------- */

function setMode(mode) {
  state.mode = mode;
  modeButtons.forEach((button) => {
    const selected = button.dataset.mode === mode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", selected);
  });
  $("#drawOnMap").setAttribute("aria-pressed", mode === "free");
  els.map.setAttribute("aria-label", mode === "free" ? "Mapa: arraste para desenhar a rota" : "Mapa: clique para adicionar pontos");
  els.map.classList.toggle("freehand", mode === "free");
  if (mode === "free") map.dragging.disable();
  else map.dragging.enable();
  setStatus(defaultHint());
}

function setupFreehand() {
  let pointerId = null;
  let stroke = null;
  let lastPixel = null;

  els.map.addEventListener("pointerdown", (event) => {
    if (state.mode !== "free" || event.button !== 0 || !event.isPrimary) return;
    if (event.target.closest(".leaflet-marker-icon, .leaflet-control")) return;
    pointerId = event.pointerId;
    stroke = [map.mouseEventToLatLng(event)];
    lastPixel = { x: event.clientX, y: event.clientY };
    els.map.setPointerCapture(event.pointerId);
    sketchLine.setLatLngs(stroke);
    event.preventDefault();
  });

  els.map.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId || !stroke) return;
    if (Math.hypot(event.clientX - lastPixel.x, event.clientY - lastPixel.y) < 4) return;
    lastPixel = { x: event.clientX, y: event.clientY };
    stroke.push(map.mouseEventToLatLng(event));
    sketchLine.setLatLngs(stroke);
  });

  const finish = (event) => {
    if (event.pointerId !== pointerId || !stroke) return;
    const drawn = stroke;
    stroke = null;
    pointerId = null;
    sketchLine.setLatLngs([]);
    if (event.type !== "pointerup" || state.mode !== "free" || drawn.length < 2) return;
    const metersPerPixel = (40_075_016 * Math.cos(toRad(map.getCenter().lat))) / (256 * 2 ** map.getZoom());
    const points = simplifyToLimit(drawn, MAX_FREEHAND_POINTS, metersPerPixel * 5);
    if (points.length < 2) return;
    commit(() => state.waypoints.push(...points));
    setStatus(`Traço convertido em ${points.length} pontos editáveis.`, "success");
  };
  els.map.addEventListener("pointerup", finish);
  els.map.addEventListener("pointercancel", finish);
  els.map.addEventListener("lostpointercapture", finish);
}

/* ---------- criação automática ---------- */

function targetMeters() {
  const km = Number(String(els.targetKm.value).replace(",", "."));
  return Math.min(60, Math.max(1, Number.isFinite(km) && km > 0 ? km : 5)) * 1000;
}

function setBusy(value) {
  busy = value;
  els.autoLoop.disabled = value;
  $("#writeRoute").disabled = value;
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
  const snap = followsStreets();
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
  const polygon = ROUTE_POLYGONS[kind];
  if (polygon) return [...polygon, polygon[0]];
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

function createDesign(shape, message) {
  if (busy) return;
  let length = 0;
  for (let i = 1; i < shape.length; i += 1) {
    length += Math.hypot(shape[i][0] - shape[i - 1][0], shape[i][1] - shape[i - 1][1]);
  }
  const target = targetMeters();
  const scale = target / length;
  const xs = shape.map(([x]) => x);
  const ys = shape.map(([, y]) => y);
  const midX = (Math.max(...xs) + Math.min(...xs)) / 2;
  const midY = (Math.max(...ys) + Math.min(...ys)) / 2;
  const center = map.getCenter();
  const project = (ratio) => shape.map(([x, y]) => offsetPoint(center, (y - midY) * ratio, (x - midX) * ratio));
  const distance = pathLength(project(scale));
  const points = project(scale * target / distance);
  commit(() => {
    els.snap.checked = false;
    state.waypoints = points;
  });
  fitRoute();
  setStatus(message, "success");
}

function writeRoute(event) {
  event.preventDefault();
  const input = $("#routeText");
  const points = routeTextPoints(input.value);
  if (!points.length) {
    input.setCustomValidity("Use até 16 letras, números ou espaços.");
    input.reportValidity();
    return;
  }
  createDesign(points, "Texto traçado no mapa. As letras ficam ligadas na mesma rota.");
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
  const totals = elevationTotals();
  const perKm = renderSimulation(totals);
  const seconds = route.distance / 1000 * perKm + climbSeconds(totals?.gain);
  renderSplits(perKm);
  const meters = (value) => `${Math.round(value)} m`;
  $("#lossStat").textContent = totals ? meters(totals.loss) : "—";
  $("#maxElevStat").textContent = totals ? meters(totals.max) : "—";
  $("#minElevStat").textContent = totals ? meters(totals.min) : "—";
  $("#dockDistance").textContent = formatDistance(route.distance);
  $("#dockTime").textContent = seconds > 0 ? formatDuration(seconds) : "—";
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
  $("#stravaRoutes").disabled = els.download.disabled;
}

function populateActivities() {
  for (const [label, options] of Object.entries(ACTIVITY_GROUPS)) {
    const group = document.createElement("optgroup");
    group.label = label;
    for (const [value, name] of Object.entries(options)) group.append(new Option(name, value));
    els.activity.append(group);
  }
}

function activityName() {
  const custom = els.activity.value === "custom" ? els.customActivity.value.trim() : "";
  return custom || els.activity.selectedOptions[0]?.textContent || "Atividade";
}

function applyActivity() {
  const config = activityConfig();
  $("#customActivityField").hidden = els.activity.value !== "custom";
  $("#paceField").hidden = config.kind === "time";
  els.pace.inputMode = config.kind === "speed" ? "decimal" : "text";
  els.pace.value = parseClock(els.time.value) ? "" : paceByActivity[els.activity.value];
  els.pace.removeAttribute("aria-invalid");
  els.snap.disabled = !config.profile;
  els.climb.disabled = !config.climb;
}

/* ---------- busca ---------- */

let suggestTimer = 0;
let suggestToken = 0;
let searchMode = "city";

const BRAZILIAN_STATES = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará",
  DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso",
  MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná",
  PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina",
  SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

function normalizePlace(text) {
  return (text || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

function expandCityQuery(query) {
  const match = query.match(/^(.+?)(?:[,\s-]+)([a-z]{2})$/i);
  if (!match) return { query, state: "" };
  const state = BRAZILIAN_STATES[match[2].toUpperCase()];
  return state ? { query: `${match[1].trim()}, ${state}`, state } : { query, state: "" };
}

function placeLabel(properties, mode) {
  const parts = mode === "city"
    ? [properties.name, properties.state, properties.country]
    : [properties.name, properties.street, properties.city, properties.state, properties.country];
  return [...new Set(parts.filter(Boolean))].join(", ");
}

function setSearchMode(mode) {
  searchMode = mode;
  $("#searchCity").setAttribute("aria-pressed", mode === "city");
  $("#searchAddress").setAttribute("aria-pressed", mode === "address");
  els.search.placeholder = mode === "city" ? "Ex.: Campinas, SP" : "Rua, número, bairro ou CEP";
  hideSuggestions();
  onSearchInput();
  els.search.focus({ preventScroll: true });
}

function hideSuggestions() {
  els.suggestions.hidden = true;
  els.suggestions.innerHTML = "";
}

function setSearchOpen(open, focus = false) {
  els.searchForm.hidden = !open;
  els.searchPanel.classList.toggle("is-open", open);
  els.searchToggle.setAttribute("aria-expanded", open);
  if (open) {
    els.search.focus({ preventScroll: true });
  } else {
    clearTimeout(suggestTimer);
    hideSuggestions();
    if (focus) els.searchToggle.focus({ preventScroll: true });
  }
}

function goToPlace(lat, lng, label, zoom = 15) {
  map.setView([lat, lng], zoom);
  setSearchOpen(false, els.searchForm.contains(document.activeElement));
  setStatus(`Mapa em ${label}. ${defaultHint()}`, "success");
}

async function loadSuggestions(text, mode) {
  const city = mode === "city";
  const { query, state } = city ? expandCityQuery(text) : { query: text, state: "" };
  const params = new URLSearchParams({ q: query, limit: "5" });
  if (city) {
    params.set("layer", "city");
    if (state) params.set("countrycode", "BR");
  } else {
    const center = map.getCenter();
    params.set("lat", center.lat.toFixed(3));
    params.set("lon", center.lng.toFixed(3));
  }
  const data = await fetchJson(`https://photon.komoot.io/api/?${params}`, 6000);
  const features = (data.features || []).filter(({ properties }) =>
    !city || (properties.type === "city" && (!state || normalizePlace(properties.state) === normalizePlace(state)))
  );
  if (city) {
    const name = normalizePlace(query.split(",")[0]);
    const exact = (feature) => Number(normalizePlace(feature.properties.name) === name);
    features.sort((left, right) => exact(right) - exact(left));
  }
  return features.map((feature) => ({
    label: placeLabel(feature.properties, mode),
    lat: feature.geometry.coordinates[1],
    lng: feature.geometry.coordinates[0],
    zoom: city ? 12 : 15,
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
      goToPlace(item.lat, item.lng, item.label, item.zoom);
    });
  });
}

function onSearchInput() {
  clearTimeout(suggestTimer);
  const token = ++suggestToken;
  const query = els.search.value.trim();
  const mode = searchMode;
  if (query.length < 3) {
    hideSuggestions();
    return;
  }
  suggestTimer = setTimeout(async () => {
    try {
      const items = await loadSuggestions(query, mode);
      if (token === suggestToken && !els.searchForm.hidden) showSuggestions(items);
    } catch (error) {
      if (token === suggestToken) hideSuggestions();
    }
  }, 320);
}

async function onSearchSubmit(event) {
  event.preventDefault();
  clearTimeout(suggestTimer);
  const token = ++suggestToken;
  const text = els.search.value.trim();
  if (!text) return;
  const mode = searchMode;
  const city = mode === "city";
  setStatus(city ? "Procurando a cidade..." : "Procurando o endereço...", "loading");
  try {
    const items = await loadSuggestions(text, mode);
    if (token !== suggestToken) return;
    if (items.length) {
      const first = items[0];
      goToPlace(first.lat, first.lng, first.label, first.zoom);
      return;
    }
  } catch (error) {
    /* tenta o segundo serviço abaixo */
  }
  if (token !== suggestToken) return;
  const params = new URLSearchParams({ format: "jsonv2", limit: "1", q: city ? expandCityQuery(text).query : text });
  if (city) params.set("featureType", "city");
  try {
    const results = await fetchJson(`https://nominatim.openstreetmap.org/search?${params}`);
    if (token !== suggestToken) return;
    if (!results.length) {
      setStatus(city ? "Cidade não encontrada. Tente incluir o estado." : "Endereço não encontrado. Tente incluir a cidade.", "error");
      return;
    }
    const first = results[0];
    goToPlace(Number(first.lat), Number(first.lon), first.display_name.split(",").slice(0, 2).join(","), city ? 12 : 15);
  } catch (error) {
    if (token === suggestToken) setStatus("Busca indisponível agora. Verifique a conexão.", "error");
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
  const custom = els.activity.value === "custom" ? els.customActivity.value.trim() : "";
  const routeName = els.routeName.value.trim();
  const name = escapeXml(custom && routeName === els.routeName.defaultValue ? custom : routeName || custom || "Minha rota");
  const type = escapeXml(custom || activityConfig().gpxType);
  const desc = els.description.value.trim();
  const points = route.coords
    .map((coord, index) => {
      const ele = elevationAt(route.cum[index]);
      const eleTag = ele === null ? "" : `<ele>${ele.toFixed(1)}</ele>`;
      return `      <trkpt lat="${coord.lat.toFixed(6)}" lon="${coord.lng.toFixed(6)}">${eleTag}</trkpt>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Fake Strava" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${name}</name>${desc ? `\n    <desc>${escapeXml(desc)}</desc>` : ""}
  </metadata>
  <trk>
    <name>${name}</name>
    <type>${type}</type>
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
  const customName = els.activity.value === "custom" ? els.customActivity.value.trim() : "";
  const routeName = els.routeName.value.trim();
  const safeName = (customName && routeName === els.routeName.defaultValue ? customName : routeName || customName || "rota")
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
    const ownRoute = xml.documentElement.getAttribute("creator") === "Fake Strava";
    const simplified = ownRoute && points.length <= 275 ? points : simplifyToLimit(points, MAX_IMPORT_POINTS, 15);
    const name = xml.querySelector("trk > name, rte > name, metadata > name")?.textContent?.trim();
    if (name) els.routeName.value = name;
    const type = xml.querySelector("trk > type, rte > type")?.textContent?.trim();
    if (type) {
      const match = Object.keys(ACTIVITIES).find((key) => ACTIVITIES[key].gpxType === type.toLowerCase());
      els.activity.value = match || "custom";
      if (!match) els.customActivity.value = type.slice(0, 60);
      applyActivity();
    }
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
        customActivity: els.customActivity.value,
        pace: paceByActivity,
        simulation: Object.fromEntries(Object.entries(simulationFields).map(([key, input]) => [key, input.value])),
        weight: els.weight.value,
        climb: els.climb.checked,
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
    if (typeof draft.customActivity === "string") els.customActivity.value = draft.customActivity;
    if (Object.hasOwn(ACTIVITIES, draft.activity)) els.activity.value = draft.activity;
    if (draft.pace && typeof draft.pace === "object") {
      Object.keys(paceByActivity).forEach((key) => {
        if (typeof draft.pace[key] === "string") paceByActivity[key] = draft.pace[key];
      });
    }
    Object.entries(simulationFields).forEach(([key, input]) => {
      if (typeof draft.simulation?.[key] === "string") input.value = draft.simulation[key];
    });
    if (Number(draft.weight) > 0) els.weight.value = draft.weight;
    if (typeof draft.climb === "boolean") els.climb.checked = draft.climb;
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

  populateActivities();
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
  shapeButtons.forEach((button) => button.addEventListener("click", () => {
    createDesign(unitShape(button.dataset.shape), "Forma traçada no mapa.");
  }));
  $("#routeTextForm").addEventListener("submit", writeRoute);
  $("#routeText").addEventListener("input", (event) => event.target.setCustomValidity(""));
  $("#drawOnMap").addEventListener("click", () => setMode(state.mode === "free" ? "click" : "free"));
  $("#resizeMap").addEventListener("click", (event) => {
    const button = event.currentTarget;
    const expanded = $(".map-area").classList.toggle("is-expanded");
    const label = expanded ? "Reduzir mapa" : "Ampliar mapa";
    button.setAttribute("aria-pressed", expanded);
    button.setAttribute("aria-label", label);
    button.title = label;
    map.invalidateSize({ animate: false });
  });
  els.autoLoop.addEventListener("click", generateLoop);
  els.undo.addEventListener("click", undo);
  els.redo.addEventListener("click", redo);
  els.loop.addEventListener("click", closeLoop);
  els.back.addEventListener("click", outAndBack);
  els.reverse.addEventListener("click", reverseRoute);
  els.clear.addEventListener("click", clearRoute);
  els.download.addEventListener("click", downloadGpx);
  $("#stravaRoutes").addEventListener("click", () => {
    downloadGpx();
    window.open("https://www.strava.com/maps/create", "_blank", "noopener");
  });

  els.snap.addEventListener("change", () => {
    afterChange();
    if (!els.snap.checked) setStatus("Linhas retas entre os pontos.");
  });
  els.activity.addEventListener("change", () => {
    applyActivity();
    afterChange();
  });
  function updateSimulation() {
    renderStats();
    saveDraft();
  }

  els.pace.addEventListener("input", () => {
    const pace = readSimulationField(els.pace, readPace);
    if (pace !== null || !els.pace.value.trim()) {
      paceByActivity[els.activity.value] = els.pace.value;
      els.time.value = "";
    }
    updateSimulation();
  });
  els.time.addEventListener("input", () => {
    if (parseClock(els.time.value)) {
      els.pace.value = "";
      els.pace.removeAttribute("aria-invalid");
    } else if (!els.time.value.trim()) {
      applyActivity();
    }
    updateSimulation();
  });
  Object.values(simulationFields).filter((input) => input !== els.time).forEach((input) => {
    input.addEventListener("input", updateSimulation);
  });
  [els.weight, els.climb, els.customActivity].forEach((input) => input.addEventListener("input", updateSimulation));
  $("#resetSimulation").addEventListener("click", () => {
    Object.values(simulationFields).forEach((input) => { input.value = ""; });
    paceByActivity[els.activity.value] = activityConfig().fallback;
    els.weight.value = els.weight.defaultValue;
    els.climb.checked = false;
    applyActivity();
    updateSimulation();
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

  $("#searchCity").addEventListener("click", () => setSearchMode("city"));
  $("#searchAddress").addEventListener("click", () => setSearchMode("address"));
  els.searchToggle.addEventListener("click", () => setSearchOpen(els.searchForm.hidden));
  els.searchForm.addEventListener("submit", onSearchSubmit);
  els.search.addEventListener("input", onSearchInput);
  document.addEventListener("click", (event) => {
    if (!els.searchForm.hidden && !els.searchPanel.contains(event.target)) setSearchOpen(false);
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
    if (event.key === "Escape" && !els.searchForm.hidden) {
      event.preventDefault();
      setSearchOpen(false, true);
      return;
    }
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
