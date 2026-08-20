import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';

export default function BuildingDetail() {
  const { buildingId } = useParams();
  const navigate = useNavigate();
  const [building, setBuilding] = useState(null);
  const [floors, setFloors] = useState(null);
  const [groups, setGroups] = useState([]);
  const [buildingName, setBuildingName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [floorName, setFloorName] = useState('');
  const [floorSortOrder, setFloorSortOrder] = useState('');
  const [pixelsPerFoot, setPixelsPerFoot] = useState(10);
  const [savingBuilding, setSavingBuilding] = useState(false);
  const [floorNameEdits, setFloorNameEdits] = useState({});
  const [floorSortOrderEdits, setFloorSortOrderEdits] = useState({});
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
      await api.createFloor(buildingId, {
        name: floorName,
        pixelsPerFoot: Number(pixelsPerFoot) || null,
        sortOrder: floorSortOrder.trim() === '' ? null : Number(floorSortOrder),
      });
      setFloorName('');
      setFloorSortOrder('');
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSaveFloor(floorId, name, sortOrderText) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSavingFloorId(floorId);
    setError(null);
    try {
      const updated = await api.updateFloor(buildingId, floorId, {
        name: trimmed,
        sortOrder: sortOrderText.trim() === '' ? null : Number(sortOrderText),
      });
      setFloors((prev) => prev.map((f) => (f.id === floorId ? updated : f)));
      setFloorNameEdits((prev) => {
        const next = { ...prev };
        delete next[floorId];
        return next;
      });
      setFloorSortOrderEdits((prev) => {
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
        <Link to="/admin/groups">Manage groups</Link> |{' '}
        <Link to={`/admin/buildings/${buildingId}/destination-types`}>Manage destination types</Link>
      </p>

      <h2>Floors</h2>
      <form onSubmit={handleCreate} className="card row">
        <input placeholder="Floor name (e.g. 1st Floor)" value={floorName} onChange={(e) => setFloorName(e.target.value)} style={{ flex: 1 }} />
        <label className="row" style={{ gap: 4 }}>
          <span className="muted">Sort order</span>
          <input
            type="number"
            step="any"
            placeholder="e.g. 1"
            value={floorSortOrder}
            onChange={(e) => setFloorSortOrder(e.target.value)}
            style={{ width: 80 }}
          />
        </label>
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
      <p className="muted" style={{ marginTop: -8 }}>
        Sort order decides floor sequence for routing (which way is "up", how many flights of stairs) and doesn't
        need to match the floor's real number — use a fraction like 1.5 to place a mezzanine between floors 1 and 2.
        Leave blank to guess from the name.
      </p>
      {error && <div className="error">{error}</div>}

      {floors === null ? (
        <p className="muted">Loading...</p>
      ) : floors.length === 0 ? (
        <p className="muted">No floors yet. Add one above.</p>
      ) : (
        <ul className="list">
          {[...floors]
            .sort((a, b) => {
              if (a.sortOrder != null && b.sortOrder != null) return a.sortOrder - b.sortOrder;
              if (a.sortOrder != null) return -1;
              if (b.sortOrder != null) return 1;
              return a.name.localeCompare(b.name);
            })
            .map((f) => {
              const nameValue = floorNameEdits[f.id] ?? f.name;
              const sortOrderValue = floorSortOrderEdits[f.id] ?? (f.sortOrder ?? '');
              const dirty =
                (nameValue.trim() !== '' && nameValue.trim() !== f.name) ||
                String(sortOrderValue) !== String(f.sortOrder ?? '');
              return (
                <li key={f.id} className="list-item">
                  <form
                    className="row"
                    style={{ flex: 1, gap: 8 }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSaveFloor(f.id, nameValue, String(sortOrderValue));
                    }}
                  >
                    <button type="button" onClick={() => navigate(`/admin/buildings/${buildingId}/floors/${f.id}`)}>
                      Open floorplan{!f.imagePath && <span className="muted"> (none uploaded)</span>}
                    </button>
                    <input
                      aria-label={`Name for ${f.name}`}
                      value={nameValue}
                      onChange={(e) => setFloorNameEdits((prev) => ({ ...prev, [f.id]: e.target.value }))}
                      style={{ flex: 1 }}
                    />
                    <input
                      aria-label={`Sort order for ${f.name}`}
                      type="number"
                      step="any"
                      placeholder="e.g. 1"
                      value={sortOrderValue}
                      onChange={(e) => setFloorSortOrderEdits((prev) => ({ ...prev, [f.id]: e.target.value }))}
                      style={{ width: 80 }}
                    />
                    <button type="submit" disabled={!dirty || savingFloorId === f.id}>
                      {savingFloorId === f.id ? 'Saving...' : 'Save'}
                    </button>
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
