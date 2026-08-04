import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';

export default function BuildingDetail() {
  const { buildingId } = useParams();
  const [building, setBuilding] = useState(null);
  const [floors, setFloors] = useState(null);
  const [groups, setGroups] = useState([]);
  const [buildingName, setBuildingName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [floorName, setFloorName] = useState('');
  const [pixelsPerFoot, setPixelsPerFoot] = useState(10);
  const [savingBuilding, setSavingBuilding] = useState(false);
  const [floorNameEdits, setFloorNameEdits] = useState({});
  const [savingFloorId, setSavingFloorId] = useState(null);
  const [error, setError] = useState(null);

  function refresh() {
    api
      .getBuilding(buildingId)
      .then((nextBuilding) => {
        setBuilding(nextBuilding);
        setBuildingName(nextBuilding.name || '');
        setGroupId(nextBuilding.groupId || '');
      })
      .catch((err) => setError(err.message));
    api.listFloors(buildingId).then(setFloors).catch((err) => setError(err.message));
    api.listGroups().then(setGroups).catch((err) => setError(err.message));
  }

  useEffect(refresh, [buildingId]);

  async function handleSaveBuildingName(e) {
    e.preventDefault();
    if (!buildingName.trim()) return;
    setSavingBuilding(true);
    setError(null);
    try {
      const updated = await api.updateBuilding(buildingId, { name: buildingName.trim(), groupId: groupId || null });
      setBuilding(updated);
      setBuildingName(updated.name || '');
      setGroupId(updated.groupId || '');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingBuilding(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.createFloor(buildingId, { name: floorName, pixelsPerFoot: Number(pixelsPerFoot) || null });
      setFloorName('');
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRenameFloor(floorId, name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSavingFloorId(floorId);
    setError(null);
    try {
      const updated = await api.updateFloor(buildingId, floorId, { name: trimmed });
      setFloors((prev) => prev.map((f) => (f.id === floorId ? updated : f)));
      setFloorNameEdits((prev) => {
        const next = { ...prev };
        delete next[floorId];
        return next;
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingFloorId(null);
    }
  }

  async function handleDelete(floorId) {
    if (!confirm('Delete this floor and all of its nodes/edges?')) return;
    try {
      await api.deleteFloor(buildingId, floorId);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <div className="breadcrumbs">
        <Link to="/admin/buildings">Buildings</Link> / {building?.name || '...'}
      </div>
      <h1>{building?.name}</h1>

      <form onSubmit={handleSaveBuildingName} className="card row">
        <input
          aria-label="Building name"
          value={buildingName}
          onChange={(e) => setBuildingName(e.target.value)}
          style={{ flex: 1 }}
        />
        <select aria-label="Group" value={groupId} onChange={(e) => setGroupId(e.target.value)} style={{ flex: 1 }}>
          <option value="">No group</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="primary"
          disabled={
            !buildingName.trim() ||
            savingBuilding ||
            (buildingName.trim() === building?.name && groupId === (building?.groupId || ''))
          }
        >
          {savingBuilding ? 'Saving...' : 'Save name'}
        </button>
      </form>
      <p className="muted" style={{ marginTop: -8 }}>
        <Link to="/admin/groups">Manage groups</Link>
      </p>

      <h2>Floors</h2>
      <form onSubmit={handleCreate} className="card row">
        <input placeholder="Floor name (e.g. 1st Floor)" value={floorName} onChange={(e) => setFloorName(e.target.value)} style={{ flex: 1 }} />
        <label className="row" style={{ gap: 4 }}>
          <span className="muted">px/ft</span>
          <input
            type="number"
            min="1"
            value={pixelsPerFoot}
            onChange={(e) => setPixelsPerFoot(e.target.value)}
            style={{ width: 70 }}
          />
        </label>
        <button type="submit" className="primary" disabled={!floorName.trim()}>
          Add floor
        </button>
      </form>
      {error && <div className="error">{error}</div>}

      {floors === null ? (
        <p className="muted">Loading...</p>
      ) : floors.length === 0 ? (
        <p className="muted">No floors yet. Add one above.</p>
      ) : (
        <ul className="list">
          {floors.map((f) => {
            const nameValue = floorNameEdits[f.id] ?? f.name;
            const dirty = nameValue.trim() !== '' && nameValue.trim() !== f.name;
            return (
              <li key={f.id} className="list-item">
                <form
                  className="row"
                  style={{ flex: 1, gap: 8 }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleRenameFloor(f.id, nameValue);
                  }}
                >
                  <input
                    aria-label={`Name for ${f.name}`}
                    value={nameValue}
                    onChange={(e) => setFloorNameEdits((prev) => ({ ...prev, [f.id]: e.target.value }))}
                    style={{ flex: 1 }}
                  />
                  <button type="submit" disabled={!dirty || savingFloorId === f.id}>
                    {savingFloorId === f.id ? 'Saving...' : 'Save'}
                  </button>
                  <Link to={`/admin/buildings/${buildingId}/floors/${f.id}`}>
                    Open floorplan {!f.imagePath && <span className="muted">(none uploaded)</span>} &rsaquo;
                  </Link>
                </form>
                <button type="button" className="danger" onClick={() => handleDelete(f.id)}>
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
