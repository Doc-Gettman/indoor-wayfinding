import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const UNGROUPED_CLIENT = 'Ungrouped';

export default function BuildingsList() {
  const [buildings, setBuildings] = useState(null);
  const [groups, setGroups] = useState([]);
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [error, setError] = useState(null);

  function refresh() {
    api.listBuildings().then(setBuildings).catch((err) => setError(err.message));
    api.listGroups().then(setGroups).catch((err) => setError(err.message));
  }

  useEffect(refresh, []);

  const buildingGroups = useMemo(() => {
    if (!buildings) return [];
    const groupedBy = new Map();
    for (const building of buildings) {
      const groupName = building.groupName || UNGROUPED_CLIENT;
      if (!groupedBy.has(groupName)) groupedBy.set(groupName, []);
      groupedBy.get(groupName).push(building);
    }
    return [...groupedBy.entries()]
      .map(([groupName, groupBuildings]) => ({
        groupName,
        buildings: groupBuildings.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
      }))
      .sort((a, b) => {
        if (a.groupName === UNGROUPED_CLIENT) return 1;
        if (b.groupName === UNGROUPED_CLIENT) return -1;
        return a.groupName.localeCompare(b.groupName, undefined, { sensitivity: 'base' });
      });
  }, [buildings]);

  async function handleCreate(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.createBuilding({ name: name.trim(), groupId: groupId || null });
      setName('');
      setGroupId('');
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(buildingId) {
    if (!confirm('Delete this building and all of its floors, nodes, and QR codes?')) return;
    try {
      await api.deleteBuilding(buildingId);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCopy(building) {
    const nextName = prompt('Name for the copied building/location:', `${building.name} Copy`);
    if (!nextName?.trim()) return;
    setError(null);
    try {
      // Stays in the same group as the source by default (server-side default).
      await api.copyBuilding(building.id, { name: nextName.trim() });
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Buildings</h1>
        <Link to="/admin/groups">Manage groups</Link>
      </div>

      <form onSubmit={handleCreate} className="card row">
        <input
          placeholder="New building name"
          value={name}
          onChange={(e) => setName(e.target.value)}
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
        <button type="submit" className="primary" disabled={!name.trim()}>
          Add building
        </button>
      </form>
      {error && <div className="error">{error}</div>}

      {buildings === null ? (
        <p className="muted">Loading...</p>
      ) : buildings.length === 0 ? (
        <p className="muted">No buildings yet. Add one above.</p>
      ) : (
        <div className="building-groups">
          {buildingGroups.map((group) => (
            <section key={group.groupName} className="building-group">
              <h2>{group.groupName}</h2>
              <ul className="list">
                {group.buildings.map((b) => (
                  <li key={b.id} className="list-item">
                    <Link to={`/admin/buildings/${b.id}`}>{b.name}</Link>
                    <div className="row">
                      <button type="button" onClick={() => handleCopy(b)}>
                        Copy
                      </button>
                      <button type="button" className="danger" onClick={() => handleDelete(b.id)}>
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
