import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';

export default function Wayfind() {
  const { buildingId } = useParams();
  const [searchParams] = useSearchParams();
  const originNodeId = searchParams.get('from');

  const [building, setBuilding] = useState(null);
  const [originNode, setOriginNode] = useState(null);
  const [originQrCode, setOriginQrCode] = useState(null);
  const [pois, setPois] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [selectedPoiId, setSelectedPoiId] = useState(null);
  const [directions, setDirections] = useState(null);
  const [directionsLoading, setDirectionsLoading] = useState(false);
  const [directionsError, setDirectionsError] = useState(null);

  useEffect(() => {
    api.getBuilding(buildingId).then(setBuilding).catch((err) => setLoadError(err.message));
    api.listPois(buildingId).then(setPois).catch((err) => setLoadError(err.message));
    if (originNodeId) {
      api
        .listNodes(buildingId)
        .then((nodes) => setOriginNode(nodes.find((n) => n.id === originNodeId) || null))
        .catch((err) => setLoadError(err.message));
      api
        .listQrCodes(buildingId)
        .then((qrcodes) => setOriginQrCode(qrcodes.find((qr) => qr.originNodeId === originNodeId) || null))
        .catch((err) => setLoadError(err.message));
    }
  }, [buildingId, originNodeId]);

  const originLabel = originQrCode?.label || originNode?.label || 'your current location';

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

  return (
    <div className="page wayfind-page">
      <h1>{building?.name || 'Loading...'}</h1>
      <p className="muted">
        You are at: <strong>{originLabel}</strong>
      </p>

      {selectedPoiId && (directionsLoading || directions || directionsError) ? (
        <div className="card">
          {directionsLoading && <p className="muted">Finding the best route...</p>}
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
          {pois === null ? (
            <p className="muted">Loading destinations...</p>
          ) : pois.length === 0 ? (
            <p className="muted">No destinations have been configured for this building yet.</p>
          ) : (
            <ul className="list">
              {pois.map((poi) => (
                <li key={poi.id} className="list-item" style={{ cursor: 'pointer' }} onClick={() => handleSelectDestination(poi)}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{poi.name}</div>
                    {poi.description && <div className="muted">{poi.description}</div>}
                  </div>
                  <span aria-hidden="true">›</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
