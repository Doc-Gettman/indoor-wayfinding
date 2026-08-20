import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';

export default function DestinationTypes() {
  const { buildingId } = useParams();
  const [building, setBuilding] = useState(null);
  const [destinationTypes, setDestinationTypes] = useState(null);
  const [newTypeName, setNewTypeName] = useState('');
  const [typeNameEdits, setTypeNameEdits] = useState({});
  const [savingTypeId, setSavingTypeId] = useState(null);
  const [error, setError] = useState(null);

  function refresh() {
    api.getBuilding(buildingId).then(setBuilding).catch((err) => setError(err.message));
    api.listDestinationTypes(buildingId).then(setDestinationTypes).catch((err) => setError(err.message));
  }

  useEffect(refresh, [buildingId]);

  async function handleCreateType(e) {
    e.preventDefault();
    if (!newTypeName.trim()) return;
    setError(null);
    try {
      await api.createDestinationType(buildingId, { name: newTypeName.trim() });
      setNewTypeName('');
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRenameType(typeId, name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSavingTypeId(typeId);
    setError(null);
    try {
      await api.updateDestinationType(buildingId, typeId, { name: trimmed });
      setTypeNameEdits((prev) => {
        const next = { ...prev };
        delete next[typeId];
        return next;
      });
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingTypeId(null);
    }
  }

  async function handleDeleteType(typeId) {
    if (!confirm('Delete this destination type? Existing destinations using it will keep their names but lose this type.')) return;
    setError(null);
    try {
      await api.deleteDestinationType(buildingId, typeId);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <div className="breadcrumbs">
        <Link to="/admin/buildings">Buildings</Link> /{' '}
        <Link to={`/admin/buildings/${buildingId}`}>{building?.name || '...'}</Link> / Destination types
      </div>
      <h1>Destination types</h1>
      <p className="muted">
        These values populate the destination type dropdown in the floor editor. Destination names remain freeform.
      </p>

      <form onSubmit={handleCreateType} className="card row">
        <input
          placeholder="New destination type (e.g. Conference Room)"
          value={newTypeName}
          onChange={(e) => setNewTypeName(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="submit" className="primary" disabled={!newTypeName.trim()}>
          Add type
        </button>
      </form>
      {error && <div className="error">{error}</div>}

      {destinationTypes === null ? (
        <p className="muted">Loading...</p>
      ) : destinationTypes.length === 0 ? (
        <p className="muted">No destination types yet. Add one above.</p>
      ) : (
        <ul className="list">
          {destinationTypes.map((type) => {
            const nameValue = typeNameEdits[type.id] ?? type.name;
            const dirty = nameValue.trim() !== '' && nameValue.trim() !== type.name;
            return (
              <li key={type.id} className="list-item">
                <form
                  className="row"
                  style={{ flex: 1, gap: 8 }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleRenameType(type.id, nameValue);
                  }}
                >
                  <input
                    aria-label={`Name for ${type.name}`}
                    value={nameValue}
                    onChange={(e) => setTypeNameEdits((prev) => ({ ...prev, [type.id]: e.target.value }))}
                    style={{ flex: 1 }}
                  />
                  <button type="submit" disabled={!dirty || savingTypeId === type.id}>
                    {savingTypeId === type.id ? 'Saving...' : 'Save'}
                  </button>
                </form>
                <button type="button" className="danger" onClick={() => handleDeleteType(type.id)}>
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
