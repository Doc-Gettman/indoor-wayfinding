import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';

const UNKNOWN_FLOOR_ID = '__unknown_floor__';

function getFloorSortValue(floor) {
  const match = String(floor?.name || floor?.id || '').match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
}

function compareFloors(a, b) {
  const numberDifference = getFloorSortValue(a.floor) - getFloorSortValue(b.floor);
  if (numberDifference !== 0) return numberDifference;

  const nameComparison = a.floorName.localeCompare(b.floorName, undefined, { numeric: true, sensitivity: 'base' });
  if (nameComparison !== 0) return nameComparison;

  return a.floorId.localeCompare(b.floorId);
}

export default function Wayfind() {
  const { buildingId } = useParams();
  const [searchParams] = useSearchParams();
  const originNodeId = searchParams.get('from');

  const [showQrSplash, setShowQrSplash] = useState(Boolean(originNodeId));
  const [building, setBuilding] = useState(null);
  const [originNode, setOriginNode] = useState(null);
  const [originQrCode, setOriginQrCode] = useState(null);
  const [pois, setPois] = useState(null);
  const [floors, setFloors] = useState(null);
  const [nodes, setNodes] = useState(null);
  const [destinationSearch, setDestinationSearch] = useState('');
  const [loadError, setLoadError] = useState(null);

  const [selectedPoiId, setSelectedPoiId] = useState(null);
  const [directions, setDirections] = useState(null);
  const [directionsLoading, setDirectionsLoading] = useState(false);
  const [directionsError, setDirectionsError] = useState(null);

  useEffect(() => {
    if (!originNodeId) {
      setShowQrSplash(false);
      return;
    }

    setShowQrSplash(true);
    const splashTimer = window.setTimeout(() => {
      setShowQrSplash(false);
    }, 2000);

    return () => window.clearTimeout(splashTimer);
  }, [originNodeId]);

  useEffect(() => {
    api.getBuilding(buildingId).then(setBuilding).catch((err) => setLoadError(err.message));
    api.listPois(buildingId).then(setPois).catch((err) => setLoadError(err.message));
    api.listFloors(buildingId).then(setFloors).catch((err) => setLoadError(err.message));
    api.listNodes(buildingId).then(setNodes).catch((err) => setLoadError(err.message));
    if (originNodeId) {
      api
        .listQrCodes(buildingId)
        .then((qrcodes) => setOriginQrCode(qrcodes.find((qr) => qr.originNodeId === originNodeId) || null))
        .catch((err) => setLoadError(err.message));
    }
  }, [buildingId, originNodeId]);

  useEffect(() => {
    setOriginNode(nodes?.find((n) => n.id === originNodeId) || null);
  }, [nodes, originNodeId]);

  const originLabel = originQrCode?.label || originNode?.label || 'your current location';
  const destinationGroups = useMemo(() => {
    if (!pois || !floors || !nodes) return [];

    const normalizedSearch = destinationSearch.trim().toLowerCase();
    const floorById = new Map(floors.map((floor) => [floor.id, floor]));
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const groupsByFloorId = new Map();

    for (const poi of pois) {
      const searchText = `${poi.name || ''} ${poi.description || ''}`.toLowerCase();
      if (normalizedSearch && !searchText.includes(normalizedSearch)) continue;

      const node = nodeById.get(poi.nodeId);
      const floorId = node?.floorId || UNKNOWN_FLOOR_ID;
      const floor = floorById.get(floorId) || null;
      const floorName = floor?.name || (floorId === UNKNOWN_FLOOR_ID ? 'Floor not assigned' : floorId);

      if (!groupsByFloorId.has(floorId)) {
        groupsByFloorId.set(floorId, { floorId, floor, floorName, pois: [] });
      }

      groupsByFloorId.get(floorId).pois.push(poi);
    }

    const originFloorId = originNode?.floorId || null;
    return [...groupsByFloorId.values()]
      .map((group) => ({
        ...group,
        pois: group.pois.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
      }))
      .sort((a, b) => {
        if (originFloorId) {
          if (a.floorId === originFloorId && b.floorId !== originFloorId) return -1;
          if (b.floorId === originFloorId && a.floorId !== originFloorId) return 1;
        }
        if (a.floorId === UNKNOWN_FLOOR_ID && b.floorId !== UNKNOWN_FLOOR_ID) return 1;
        if (b.floorId === UNKNOWN_FLOOR_ID && a.floorId !== UNKNOWN_FLOOR_ID) return -1;
        return compareFloors(a, b);
      });
  }, [destinationSearch, floors, nodes, originNode?.floorId, pois]);

  const destinationCount = destinationGroups.reduce((count, group) => count + group.pois.length, 0);

  async function handleSelectDestination(poi) {
    setSelectedPoiId(poi.id);
    setDirections(null);
    setDirectionsError(null);
    setDirectionsLoading(true);
    try {
      const result = await api.wayfind(buildingId, originNodeId, poi.id);
      setDirections(result);
    } catch (err) {
      setDirectionsError(err.message);
    } finally {
      setDirectionsLoading(false);
    }
  }

  function handleChooseAnother() {
    setSelectedPoiId(null);
    setDirections(null);
    setDirectionsError(null);
  }

  if (!originNodeId) {
    return (
      <div className="page wayfind-page">
        <p className="error">
          This QR code is missing location information. Please scan the code posted at your location again, or ask
          for assistance.
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="page wayfind-page">
        <p className="error">{loadError}</p>
      </div>
    );
  }

  if (showQrSplash) {
    return (
      <div className="qr-splash" role="status" aria-live="polite" aria-label="QR code captured">
        <div className="qr-splash__mark" aria-hidden="true">
          <span className="qr-splash__qr" />
          <span className="qr-splash__key" />
        </div>
        <p className="qr-splash__eyebrow">GoldenKey</p>
        <h1>QR code captured</h1>
        <p className="qr-splash__message">Preparing destinations from {originLabel}.</p>
        <div className="qr-splash__route" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  return (
    <div className="page wayfind-page">
      <h1>{building?.name || 'Loading...'}</h1>
      <p className="muted">
        You are at: <strong>{originLabel}</strong>
      </p>

      {selectedPoiId && (directionsLoading || directions || directionsError) ? (
        <div className="card">
          {directionsLoading && (
            <div className="gk-spinner" role="status" aria-live="polite">
              <span className="gk-spinner__ring" aria-hidden="true" />
              <p className="gk-spinner__label">
                GoldenKey
                <span>Finding the best route...</span>
              </p>
            </div>
          )}
          {directionsError && <p className="error">{directionsError}</p>}
          {directions && (
            <>
              <h2>Directions to {directions.destination.name}</h2>
              {directions.destination.description && <p className="muted">{directions.destination.description}</p>}
              <ol className="wayfind-steps">
                {directions.instructions.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
              <div className="row no-print">
                <button type="button" onClick={handleChooseAnother}>
                  Choose a different destination
                </button>
              </div>
            </>
          )}
          {directionsError && (
            <div className="row no-print">
              <button type="button" onClick={handleChooseAnother}>
                Choose a different destination
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <h2>Where would you like to go?</h2>
          {pois === null || floors === null || nodes === null ? (
            <p className="muted">Loading destinations...</p>
          ) : pois.length === 0 ? (
            <p className="muted">No destinations have been configured for this building yet.</p>
          ) : (
            <>
              <label className="wayfind-search" htmlFor="destination-search">
                <span className="wayfind-search__icon" aria-hidden="true" />
                <input
                  id="destination-search"
                  type="search"
                  value={destinationSearch}
                  onChange={(event) => setDestinationSearch(event.target.value)}
                  placeholder="Search destinations"
                  autoComplete="off"
                />
              </label>
              {destinationCount === 0 ? (
                <p className="muted">No destinations match your search.</p>
              ) : (
                <div className="destination-groups">
                  {destinationGroups.map((group) => (
                    <section key={group.floorId} className="destination-group" aria-labelledby={`floor-${group.floorId}`}>
                      <h3 id={`floor-${group.floorId}`}>{group.floorName}</h3>
                      <ul className="list">
                        {group.pois.map((poi) => (
                          <li
                            key={poi.id}
                            className="list-item"
                            style={{ cursor: 'pointer' }}
                            onClick={() => handleSelectDestination(poi)}
                          >
                            <div>
                              <div style={{ fontWeight: 600 }}>{poi.name}</div>
                              {poi.description && <div className="muted">{poi.description}</div>}
                            </div>
                            <span aria-hidden="true">&rsaquo;</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
