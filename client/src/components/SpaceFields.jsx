import { useState } from 'react';
import { api } from '../api.js';

export function SpaceSelect({ spaces, value, onChange, label = 'Space', disabled = false, allowUnspecified = true }) {
  return <label className="space-field">{label}
    <select value={value || ''} onChange={(event) => onChange(event.target.value || null)} disabled={disabled}>
      {allowUnspecified && <option value="">Unspecified</option>}
      {!allowUnspecified && !value && <option value="" disabled>Choose a space</option>}
      {spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
    </select>
  </label>;
}

export function SpaceAssignment({ value, spaces, onChange, allowBoundary = true }) {
  const boundary = value.boundarySpaceIds || [];
  // An incomplete pair is local draft state only; save validation rejects it.
  const isBoundary = boundary.length > 0;
  return <div className="space-assignment">
    {isBoundary ? <>
      <SpaceSelect spaces={spaces} label="Space on this side" value={boundary[0]} allowUnspecified={false}
        onChange={(id) => onChange({ spaceId: null, boundarySpaceIds: [id, boundary[1]] })} />
      <SpaceSelect spaces={spaces.filter((space) => space.id !== boundary[0])} label="Space on the other side" value={boundary[1]} allowUnspecified={false}
        onChange={(id) => onChange({ spaceId: null, boundarySpaceIds: [boundary[0], id] })} />
    </> : <SpaceSelect spaces={spaces} value={value.spaceId} onChange={(spaceId) => onChange({ spaceId })} />}
    {allowBoundary && <label className="row">
      <input type="checkbox" checked={isBoundary} onChange={(event) => onChange(event.target.checked
        ? { spaceId: null, boundarySpaceIds: [value.spaceId || null, null] }
        : { spaceId: boundary[0] || null, boundarySpaceIds: [] })} />
      Connects to another space
    </label>}
    {isBoundary && <p className="muted">This point marks the boundary. No door is implied unless its type is Door.</p>}
  </div>;
}

const EMPTY = { name: '', environment: 'unspecified', layout: 'unspecified', descriptiveTerm: '' };

export default function SpacesPanel({ buildingId, spaces, activeSpaceId, onActiveChange, onChanged, nodes, landmarks, pois, onHighlightNodes }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [nodeIds, setNodeIds] = useState([]);
  const [landmarkIds, setLandmarkIds] = useState([]);
  const [targetSpaceId, setTargetSpaceId] = useState(null);
  const patch = (key, value) => setForm((old) => ({ ...old, [key]: value }));

  async function save(event) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      const space = editing === 'new' ? await api.createSpace(buildingId, form) : await api.updateSpace(buildingId, editing, form);
      onChanged(space);
      if (editing === 'new') onActiveChange(space.id);
      setEditing(null);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true); setError(null);
    try {
      await api.deleteSpace(buildingId, editing);
      if (activeSpaceId === editing) onActiveChange(null);
      setEditing(null); onChanged();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function assign() {
    setBusy(true); setError(null);
    try {
      await api.assignSpaces(buildingId, { nodeIds, landmarkIds, spaceId: targetSpaceId });
      setNodeIds([]); setLandmarkIds([]); onHighlightNodes?.([]); onChanged();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <div className="card">
    <h2>Spaces</h2>
    <SpaceSelect spaces={spaces} label="Active space for new points" value={activeSpaceId} onChange={onActiveChange} />
    <p className="muted" aria-live="polite">Drawing in: {spaces.find((space) => space.id === activeSpaceId)?.name || 'Unspecified'}.</p>
    <div className="row">
      <button type="button" onClick={() => { setEditing('new'); setForm(EMPTY); setError(null); }}>New space</button>
      <button type="button" disabled={!activeSpaceId} onClick={() => { setEditing(activeSpaceId); setForm(spaces.find((space) => space.id === activeSpaceId)); setError(null); }}>Edit active space</button>
    </div>
    {editing && <form onSubmit={save} className="space-form">
      <label className="space-field">Name<input required maxLength={120} value={form.name} onChange={(e) => patch('name', e.target.value)} placeholder="Entrance Lobby" /></label>
      <label className="space-field">Environment<select value={form.environment} onChange={(e) => patch('environment', e.target.value)}>
        <option value="unspecified">Unspecified</option><option value="indoor">Indoor</option><option value="outdoor">Outdoor</option>
      </select></label>
      <label className="space-field">Layout<select value={form.layout} onChange={(e) => patch('layout', e.target.value)}>
        <option value="unspecified">Unspecified</option><option value="open">Open area</option><option value="corridor">Corridor</option><option value="room">Room</option>
      </select></label>
      <label className="space-field">Descriptive term (optional)<input maxLength={80} value={form.descriptiveTerm} onChange={(e) => patch('descriptiveTerm', e.target.value)} placeholder="lobby, concourse, courtyard, walkway" /></label>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="submit" disabled={busy || !form.name.trim()}>Save space</button>
        <button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
        {editing !== 'new' && <button type="button" className="danger" disabled={busy} onClick={remove}>Delete unused space</button>}
      </div>
    </form>}
    <details style={{ marginTop: 12 }}>
      <summary>Assign existing points in bulk</summary>
      <p className="muted">Choose points on this floor. Connections update where unambiguous; others are marked for review. Edit boundary points individually.</p>
      <div className="space-bulk-list">
        {nodes.filter((node) => !node.boundarySpaceIds?.length).map((node) => <label className="row" key={node.id}>
          <input type="checkbox" checked={nodeIds.includes(node.id)} onChange={(e) => {
            const selected = e.target.checked ? [...nodeIds, node.id] : nodeIds.filter((id) => id !== node.id);
            setNodeIds(selected); onHighlightNodes?.(selected);
          }} />
          {pois.find((poi) => poi.nodeId === node.id)?.name || node.label || `${node.nodeType} (${Math.round(node.x)}, ${Math.round(node.y)})`}
        </label>)}
        {landmarks.map((landmark) => <label className="row" key={landmark.id}>
          <input type="checkbox" checked={landmarkIds.includes(landmark.id)} onChange={(e) => setLandmarkIds(e.target.checked ? [...landmarkIds, landmark.id] : landmarkIds.filter((id) => id !== landmark.id))} />
          Landmark: {landmark.name || '(unnamed)'}
        </label>)}
      </div>
      <SpaceSelect spaces={spaces} label="Assign selected points to" value={targetSpaceId} onChange={setTargetSpaceId} />
      <button type="button" disabled={busy || !(nodeIds.length + landmarkIds.length)} onClick={assign}>Assign {nodeIds.length + landmarkIds.length} points</button>
    </details>
    {error && <p className="error">{error}</p>}
  </div>;
}
