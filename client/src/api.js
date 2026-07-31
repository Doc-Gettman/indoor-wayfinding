const BASE = '/api';
export const AUTH_EXPIRED_EVENT = 'wayfinding:auth-expired';

function notifyAuthExpired() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    ...options,
  });
  if (!res.ok) {
    if (res.status === 401) notifyAuthExpired();
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

const json = (data) => JSON.stringify(data);

export const api = {
  login: (password) => request('/auth/login', { method: 'POST', body: json({ password }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  session: () => request('/auth/session'),

  listBuildings: () => request('/buildings'),
  getBuilding: (buildingId) => request(`/buildings/${buildingId}`),
  createBuilding: (name) => request('/buildings', { method: 'POST', body: json({ name }) }),
  deleteBuilding: (buildingId) => request(`/buildings/${buildingId}`, { method: 'DELETE' }),

  listFloors: (buildingId) => request(`/buildings/${buildingId}/floors`),
  createFloor: (buildingId, data) => request(`/buildings/${buildingId}/floors`, { method: 'POST', body: json(data) }),
  updateFloor: (buildingId, floorId, data) =>
    request(`/buildings/${buildingId}/floors/${floorId}`, { method: 'PUT', body: json(data) }),
  deleteFloor: (buildingId, floorId) => request(`/buildings/${buildingId}/floors/${floorId}`, { method: 'DELETE' }),
  uploadFloorImage: async (buildingId, floorId, file) => {
    const form = new FormData();
    form.append('image', file);
    const res = await fetch(`${BASE}/buildings/${buildingId}/floors/${floorId}/image`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    if (!res.ok) {
      if (res.status === 401) notifyAuthExpired();
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed: ${res.status}`);
    }
    return res.json();
  },

  listNodes: (buildingId) => request(`/buildings/${buildingId}/nodes`),
  createNode: (buildingId, data) => request(`/buildings/${buildingId}/nodes`, { method: 'POST', body: json(data) }),
  updateNode: (buildingId, nodeId, data) =>
    request(`/buildings/${buildingId}/nodes/${nodeId}`, { method: 'PUT', body: json(data) }),
  deleteNode: (buildingId, nodeId) => request(`/buildings/${buildingId}/nodes/${nodeId}`, { method: 'DELETE' }),

  listEdges: (buildingId) => request(`/buildings/${buildingId}/edges`),
  createEdge: (buildingId, data) => request(`/buildings/${buildingId}/edges`, { method: 'POST', body: json(data) }),
  deleteEdge: (buildingId, edgeId) => request(`/buildings/${buildingId}/edges/${edgeId}`, { method: 'DELETE' }),

  listPois: (buildingId) => request(`/buildings/${buildingId}/pois`),
  createPoi: (buildingId, data) => request(`/buildings/${buildingId}/pois`, { method: 'POST', body: json(data) }),
  updatePoi: (buildingId, poiId, data) =>
    request(`/buildings/${buildingId}/pois/${poiId}`, { method: 'PUT', body: json(data) }),
  deletePoi: (buildingId, poiId) => request(`/buildings/${buildingId}/pois/${poiId}`, { method: 'DELETE' }),

  listLandmarks: (buildingId) => request(`/buildings/${buildingId}/landmarks`),
  createLandmark: (buildingId, data) => request(`/buildings/${buildingId}/landmarks`, { method: 'POST', body: json(data) }),
  updateLandmark: (buildingId, landmarkId, data) =>
    request(`/buildings/${buildingId}/landmarks/${landmarkId}`, { method: 'PUT', body: json(data) }),
  deleteLandmark: (buildingId, landmarkId) =>
    request(`/buildings/${buildingId}/landmarks/${landmarkId}`, { method: 'DELETE' }),

  listQrCodes: (buildingId) => request(`/buildings/${buildingId}/qrcodes`),
  createQrCode: (buildingId, data) => request(`/buildings/${buildingId}/qrcodes`, { method: 'POST', body: json(data) }),
  deleteQrCode: (buildingId, qrId) => request(`/buildings/${buildingId}/qrcodes/${qrId}`, { method: 'DELETE' }),
  qrCodeImageUrl: (buildingId, qrId) => `${BASE}/buildings/${buildingId}/qrcodes/${qrId}/image`,

  wayfind: (buildingId, from, to) =>
    request(`/buildings/${buildingId}/wayfind?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
};
