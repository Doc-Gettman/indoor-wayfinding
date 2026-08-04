import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function Groups() {
  const [groups, setGroups] = useState(null);
  const [buildings, setBuildings] = useState(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [groupNameEdits, setGroupNameEdits] = useState({});
  const [savingGroupId, setSavingGroupId] = useState(null);
  const [assignSelection, setAssignSelection] = useState({});
  const [newBuildingNames, setNewBuildingNames] = useState({});
  const [error, setError] = useState(null);

  function refresh() {
    api.listGroups().then(setGroups).catch((err) => setError(err.message));
    api.listBuildings().then(setBuildings).catch((err) => setError(err.message));
  }

  useEffect(refresh, []);

  async function handleCreateGroup(e) {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    setError(null);
    try {
      await api.createGroup(newGroupName.trim());
      setNewGroupName('');
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRenameGroup(groupId, name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSavingGroupId(groupId);
    setError(null);
    try {
      await api.updateGroup(groupId, trimmed);
      setGroupNameEdits((prev) => {
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingGroupId(null);
    }
  }

  async function handleDeleteGroup(groupId) {
    if (!confirm('Delete this group? Buildings in it will become ungrouped, not deleted.')) return;
    setError(null);
    try {
      await api.deleteGroup(groupId);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAssignBuilding(groupId) {
    const buildingId = assignSelection[groupId];
    if (!buildingId) return;
    setError(null);
    try {
      await api.updateBuilding(buildingId, { groupId });
      setAssignSelection((prev) => ({ ...prev, [groupId]: '' }));
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRemoveFromGroup(buildingId) {
    setError(null);
    try {
      await api.updateBuilding(buildingId, { groupId: null });
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCreateBuildingInGroup(e, groupId) {
    e.preventDefault();
    const name = (newBuildingNames[groupId] || '').trim();
    if (!name) return;
    setError(null);
    try {
      await api.createBuilding({ name, groupId });
      setNewBuildingNames((prev) => ({ ...prev, [groupId]: '' }));
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  const ungroupedBuildings = buildings?.filter((b) => !b.groupId) || [];

  return (
    <div className="page">
      <div className="breadcrumbs">
        <Link to="/admin/buildings">Buildings</Link> / Groups
      </div>
      <h1>Building groups</h1>
      <p className="muted">
        Groups keep the buildings list organized by client/account. Assigning a building to a group always picks
        from this list, so it can't drift from a typo.
      </p>

      <form onSubmit={handleCreateGroup} className="card row">
        <input
          placeholder="New group name (e.g. Walmart)"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="submit" className="primary" disabled={!newGroupName.trim()}>
          Add group
        </button>
      </form>
      {error && <div className="error">{error}</div>}

      {groups === null || buildings === null ? (
        <p className="muted">Loading...</p>
      ) : groups.length === 0 ? (
        <p className="muted">No groups yet. Add one above.</p>
      ) : (
        groups.map((group) => {
          const nameValue = groupNameEdits[group.id] ?? group.name;
          const dirty = nameValue.trim() !== '' && nameValue.trim() !== group.name;
          const groupBuildings = buildings.filter((b) => b.groupId === group.id);
          const otherBuildings = buildings.filter((b) => b.groupId !== group.id);

          return (
            <div key={group.id} className="card">
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleRenameGroup(group.id, nameValue);
                }}
              >
                <input
                  aria-label={`Name for ${group.name}`}
                  value={nameValue}
                  onChange={(e) => setGroupNameEdits((prev) => ({ ...prev, [group.id]: e.target.value }))}
                  style={{ flex: 1, fontWeight: 600 }}
                />
                <button type="submit" disabled={!dirty || savingGroupId === group.id}>
                  {savingGroupId === group.id ? 'Saving...' : 'Save'}
                </button>
                <button type="button" className="danger" onClick={() => handleDeleteGroup(group.id)}>
                  Delete group
                </button>
              </form>

              {groupBuildings.length === 0 ? (
                <p className="muted">No buildings in this group yet.</p>
              ) : (
                <ul className="list">
                  {groupBuildings.map((b) => (
                    <li key={b.id} className="list-item">
                      <Link to={`/admin/buildings/${b.id}`}>{b.name}</Link>
                      <button type="button" onClick={() => handleRemoveFromGroup(b.id)}>
                        Remove from group
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="row" style={{ marginTop: 8 }}>
                <select
                  aria-label={`Assign an existing building to ${group.name}`}
                  value={assignSelection[group.id] || ''}
                  onChange={(e) => setAssignSelection((prev) => ({ ...prev, [group.id]: e.target.value }))}
                  style={{ flex: 1 }}
                >
                  <option value="">Assign an existing building...</option>
                  {otherBuildings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.groupName ? ` (currently in ${b.groupName})` : ''}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => handleAssignBuilding(group.id)} disabled={!assignSelection[group.id]}>
                  Assign
                </button>
              </div>

              <form className="row" style={{ marginTop: 8 }} onSubmit={(e) => handleCreateBuildingInGroup(e, group.id)}>
                <input
                  placeholder="New building name"
                  value={newBuildingNames[group.id] || ''}
                  onChange={(e) => setNewBuildingNames((prev) => ({ ...prev, [group.id]: e.target.value }))}
                  style={{ flex: 1 }}
                />
                <button type="submit" className="primary" disabled={!(newBuildingNames[group.id] || '').trim()}>
                  Create building in this group
                </button>
              </form>
            </div>
          );
        })
      )}

      {buildings && ungroupedBuildings.length > 0 && (
        <>
          <h2>Ungrouped buildings</h2>
          <ul className="list">
            {ungroupedBuildings.map((b) => (
              <li key={b.id} className="list-item">
                <Link to={`/admin/buildings/${b.id}`}>{b.name}</Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
