// Caches generated wayfind directions per building+from+to, since the LLM
// call in generateLLMDirections is by far the slowest part of a route query.
// Entries are invalidated whenever any collection for that building is saved
// (see db.js#saveCollection) — anything from a moved node to a relabeled POI
// can change the route or its wording, so the safest invalidation boundary is
// "any admin write to this building", not just edits to nodes/edges.
const TTL_MS = 60 * 60 * 1000;

const buildingCaches = new Map();

function cacheKey(from, to) {
  return `${from}::${to}`;
}

export function getCachedRoute(buildingId, from, to) {
  const bucket = buildingCaches.get(buildingId);
  if (!bucket) return null;
  const entry = bucket.get(cacheKey(from, to));
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    bucket.delete(cacheKey(from, to));
    return null;
  }
  return entry.value;
}

export function setCachedRoute(buildingId, from, to, value) {
  let bucket = buildingCaches.get(buildingId);
  if (!bucket) {
    bucket = new Map();
    buildingCaches.set(buildingId, bucket);
  }
  bucket.set(cacheKey(from, to), { value, expiresAt: Date.now() + TTL_MS });
}

export function invalidateRouteCache(buildingId) {
  buildingCaches.delete(buildingId);
}
