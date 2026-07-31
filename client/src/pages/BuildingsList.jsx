import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function BuildingsList() {
  const [buildings, setBuildings] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState(null);

  function refresh() {
    api.listBuildings().then(setBuildings).catch((err) => setError(err.message));
  }

  useEffect(refresh, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.createBuilding(name);
      setName('');
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
        <ul className="list">
          {buildings.map((b) => (
            <li key={b.id} className="list-item">
              <Link to={`/admin/buildings/${b.id}`}>{b.name}</Link>
              <button type="button" className="danger" onClick={() => handleDelete(b.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
