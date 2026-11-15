"use strict";

const ROUTE_SURFACES = {
  both: "Ambos",
  paved: "Ruas pavimentadas",
  dirt: "Estradas de terra",
};

const PAVED_SURFACES = new Set([
  "paved", "asphalt", "concrete", "concrete:lanes", "concrete:plates",
  "paving_stones", "sett", "cobblestone", "unhewn_cobblestone", "metal", "wood",
]);
const DIRT_SURFACES = new Set([
  "unpaved", "gravel", "fine_gravel", "pebblestone", "compacted", "dirt",
  "earth", "ground", "mud", "sand", "grass", "grass_paver", "clay",
]);

function hasOnlySurface(messages, surface) {
  if (!Array.isArray(messages) || messages.length < 2) return false;
  const [header, ...rows] = messages;
  const wayTags = header.indexOf("WayTags");
  const distance = header.indexOf("Distance");
  if (wayTags < 0 || distance < 0) return false;
  const allowed = surface === "paved" ? PAVED_SURFACES : DIRT_SURFACES;
  const segments = rows.filter((row) => Number(row[distance]) > 0);
  return segments.length > 0 && segments.every((row) => {
    const tag = row[wayTags]?.match(/(?:^|\s)surface=([^\s]+)/)?.[1];
    return tag && tag.split(";").every((value) => allowed.has(value));
  });
}

async function fetchSurfaceLegs(points, profile, surface) {
  const walking = profile === "foot";
  const paved = surface === "paved";
  const params = new URLSearchParams({
    lonlats: points.map(({ lat, lng }) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join("|"),
    profile: walking ? (paved ? "hiking-beta" : "hiking-mountain") : (paved ? "fastbike" : "gravel"),
    alternativeidx: "0",
    format: "geojson",
  });
  if (!paved) {
    if (walking) params.set("profile:path_preference", "20");
    else params.set("profile:prefer_unpaved_paths", "true");
  }
  const data = await fetchJson(`https://brouter.de/brouter?${params}`, 9000);
  const feature = data.features?.[0];
  if (feature?.geometry?.type !== "LineString" || !hasOnlySurface(feature.properties?.messages, surface)) {
    throw new Error("Não encontrei um caminho com esse piso.");
  }
  const line = feature.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  if (line.length < points.length || haversine(points[0], line[0]) > 50 || haversine(points.at(-1), line.at(-1)) > 50) {
    throw new Error("Os pontos estão longe dos caminhos com esse piso.");
  }
  const legs = [];
  let start = 0;
  for (let index = 1; index < points.length; index += 1) {
    let end = line.length - 1;
    if (index < points.length - 1) {
      let nearest = Infinity;
      const last = line.length - (points.length - index);
      for (let candidate = start + 1; candidate <= last; candidate += 1) {
        const distance = haversine(points[index], line[candidate]);
        if (distance < nearest) {
          nearest = distance;
          end = candidate;
        }
      }
      if (nearest > 50) throw new Error("Não encontrei um trecho que passe pelos pontos marcados.");
    }
    legs.push(line.slice(start, end + 1));
    start = end;
  }
  return legs;
}
