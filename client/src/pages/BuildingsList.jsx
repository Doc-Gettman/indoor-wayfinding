import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const UNGROUPED_CLIENT = 'Ungrouped';

export default function BuildingsList() {
  const [buildings, setBuildings] = useState(null);
  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');
  const [error, setError] = useState(null);

  function refresh() {
    api.listBuildings().then(setBuildings).catch((err) => setError(err.message));
  }

  useEffect(refresh, []);

  const buildingGroups = useMemo(() => {
    if (!buildings) return [];
    const groups = new Map();
    for (const building of buildings) {
      const groupName = building.clientName?.trim() || UNGROUPED_CLIENT;
      if (!groups.has(groupName)) groups.set(groupName, []);
      groups.get(groupName).push(building);
    }
    return [...groups.entries()]
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
      await api.createBuilding({ name: name.trim(), clientName: clientName.trim() });
      setName('');
      setClientName('');
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
    const nextClientName = prompt('Client group for the copy:', building.clientName || '') ?? (building.clientName || '');
    setError(null);
    try {
      await api.copyBuilding(building.id, { name: nextName.trim(), clientName: nextClientName.trim() });
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <h1>Buildings</h1>

      <form onSubmit={handleCreate} className="card row">
        <input
          placeholder="New building name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ flex: 1 }}
        />
        <input
          placeholder="Client group (e.g. Walmart)"
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          style={{ flex: 1 }}
        />
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
