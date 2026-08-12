import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import FloorCanvas from '../components/FloorCanvas.jsx';

function refEquals(a, b) {
  if (!a || !b) return a === b;
  if (a.type !== b.type) return false;
  return a.type === 'existing' ? a.id === b.id : a.tempId === b.tempId;
}

function getNodeDisplayLabel(node, poiByNodeId) {
  if (!node) return '';
  return poiByNodeId.get(node.id)?.name || (node.nodeType === 'door' ? node.doorDescription : null) || node.label || node.id;
}

export default function FloorEditor() {
  const { buildingId, floorId } = useParams();

  const [building, setBuilding] = useState(null);
  const [floors, setFloors] = useState([]);
  const [buildingNodes, setBuildingNodes] = useState([]);
  const [buildingEdges, setBuildingEdges] = useState([]);
  const [pois, setPois] = useState([]);
  const [landmarks, setLandmarks] = useState([]);
  const [qrcodes, setQrcodes] = useState([]);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);

  const [mode, setMode] = useState('select');
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [edgeFocusNonce, setEdgeFocusNonce] = useState(0);
  const [edgeSplitPoint, setEdgeSplitPoint] = useState(null);
  const selectedEdgeRowRef = useRef(null);
  const [selectedLandmarkId, setSelectedLandmarkId] = useState(null);
  const [qrOriginNodeId, setQrOriginNodeId] = useState('');
  const [qrLabel, setQrLabel] = useState('');
  const [highlightedQrId, setHighlightedQrId] = useState(null);

  const [seedAnchor, setSeedAnchor] = useState(null);
  const [chainAnchor, setChainAnchor] = useState(null);
  const [draftPoints, setDraftPoints] = useState([]);
  const [draftEdges, setDraftEdges] = useState([]);
  const [selectedDraftId, setSelectedDraftId] = useState(null);
  const [saving, setSaving] = useState(false);

  const [calibrationPoints, setCalibrationPoints] = useState([]);
  const [calibrationFeet, setCalibrationFeet] = useState('');
  const [calibrationSaving, setCalibrationSaving] = useState(false);

  const refresh = useCallback(() => {
    api.getBuilding(buildingId).then(setBuilding).catch((err) => setError(err.message));
    api.listFloors(buildingId).then(setFloors).catch((err) => setError(err.message));
    api.listNodes(buildingId).then(setBuildingNodes).catch((err) => setError(err.message));
    api.listEdges(buildingId).then(setBuildingEdges).catch((err) => setError(err.message));
    api.listPois(buildingId).then(setPois).catch((err) => setError(err.message));
    api.listLandmarks(buildingId).then(setLandmarks).catch((err) => setError(err.message));
    api.listQrCodes(buildingId).then(setQrcodes).catch((err) => setError(err.message));
  }, [buildingId]);

  useEffect(refresh, [refresh]);
  useEffect(() => {
    setQrOriginNodeId('');
    setQrLabel('');
    setHighlightedQrId(null);
    setSelectedEdgeId(null);
  }, [floorId]);

  const floor = floors.find((f) => f.id === floorId);
  const floorNodes = useMemo(() => buildingNodes.filter((n) => n.floorId === floorId), [buildingNodes, floorId]);
  const floorNodeIds = useMemo(() => new Set(floorNodes.map((n) => n.id)), [floorNodes]);
  const floorEdges = useMemo(
    () => buildingEdges.filter((e) => floorNodeIds.has(e.from) && floorNodeIds.has(e.to)),
    [buildingEdges, floorNodeIds],
  );
  const floorLandmarks = useMemo(() => landmarks.filter((l) => l.floorId === floorId), [landmarks, floorId]);
  const poiByNodeId = useMemo(() => new Map(pois.map((p) => [p.nodeId, p])), [pois]);
  const poiNodeIds = useMemo(() => new Set(pois.map((p) => p.nodeId)), [pois]);
  const qrNodeIds = useMemo(() => new Set(qrcodes.map((qr) => qr.originNodeId)), [qrcodes]);
  const floorCanvasNodes = useMemo(
    () =>
      floorNodes.map((node) => {
        const poiName = poiByNodeId.get(node.id)?.name;
        if (node.nodeType === 'door' && node.doorDescription) return { ...node, label: node.doorDescription };
        return poiName ? { ...node, label: poiName } : node;
      }),
    [floorNodes, poiByNodeId],
  );
  const canvasDraftPoints = useMemo(
    () =>
      draftPoints.map((point) => {
        if (point.nodeType === 'destination') return { ...point, label: point.poiName };
        if (point.nodeType === 'door' && point.doorDescription) return { ...point, label: point.doorDescription };
        return point;
      }),
    [draftPoints],
  );

  const selectedNode = buildingNodes.find((n) => n.id === selectedNodeId) || null;
  const selectedEdge = buildingEdges.find((e) => e.id === selectedEdgeId) || null;
  const selectedEdgeFrom = selectedEdge ? buildingNodes.find((n) => n.id === selectedEdge.from) || null : null;
  const selectedEdgeTo = selectedEdge ? buildingNodes.find((n) => n.id === selectedEdge.to) || null : null;
  const activeEdgeSplitPoint = edgeSplitPoint && edgeSplitPoint.edgeId === selectedEdgeId ? edgeSplitPoint : null;
  const selectedFloorEdgeIndex = floorEdges.findIndex((edge) => edge.id === selectedEdgeId);
  const selectedLandmark = landmarks.find((l) => l.id === selectedLandmarkId) || null;
  const selectedDraftPoint = draftPoints.find((p) => p.tempId === selectedDraftId) || null;
  const qrOriginNode = buildingNodes.find((n) => n.id === qrOriginNodeId) || null;
  const qrOriginLabel = getNodeDisplayLabel(qrOriginNode, poiByNodeId);
  const floorQrCodes = useMemo(
    () => qrcodes.filter((qr) => floorNodeIds.has(qr.originNodeId)),
    [floorNodeIds, qrcodes],
  );
  const highlightedQrNodeId = floorQrCodes.find((qr) => qr.id === highlightedQrId)?.originNodeId || null;
  const calibrationPixelDistance =
    calibrationPoints.length === 2
      ? Math.hypot(calibrationPoints[1].x - calibrationPoints[0].x, calibrationPoints[1].y - calibrationPoints[0].y)
      : null;

  function resolveRefXY(ref) {
    if (!ref) return null;
    if (ref.type === 'existing') {
      const n = buildingNodes.find((x) => x.id === ref.id);
      return n ? { x: n.x, y: n.y } : null;
    }
    const p = draftPoints.find((x) => x.tempId === ref.tempId);
    return p ? { x: p.x, y: p.y } : null;
  }

  const resolvedDraftEdges = useMemo(
    () =>
      draftEdges
        .map((e) => ({ from: resolveRefXY(e.from), to: resolveRefXY(e.to) }))
        .filter((e) => e.from && e.to),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draftEdges, draftPoints, buildingNodes],
  );

  function resetChain() {
    setMode('select');
    setSeedAnchor(null);
    setChainAnchor(null);
    setDraftPoints([]);
    setDraftEdges([]);
    setSelectedDraftId(null);
    setSelectedEdgeId(null);
  }

  function handleStartFreshChain() {
    if (draftPoints.length > 0 && !confirm('Discard the waypoints you have not saved yet?')) return;
    setMode('chain');
    setSeedAnchor(null);
    setChainAnchor(null);
    setDraftPoints([]);
    setDraftEdges([]);
    setSelectedDraftId(null);
    setSelectedLandmarkId(null);
    setSelectedEdgeId(null);
  }

  function handleStartChainFromNode(nodeId) {
    const anchor = { type: 'existing', id: nodeId };
    setMode('chain');
    setSeedAnchor(anchor);
    setChainAnchor(anchor);
    setDraftPoints([]);
    setDraftEdges([]);
    setSelectedDraftId(null);
    setSelectedNodeId(null);
    setSelectedLandmarkId(null);
    setSelectedEdgeId(null);
  }

  function handleStartLandmarkMode() {
    if (draftPoints.length > 0 && !confirm('Discard the waypoints you have not saved yet?')) return;
    setMode('landmark');
    setSeedAnchor(null);
    setChainAnchor(null);
    setDraftPoints([]);
    setDraftEdges([]);
    setSelectedDraftId(null);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }

  function handleStartQrMode() {
    if (draftPoints.length > 0 && !confirm('Discard the waypoints you have not saved yet?')) return;
    setMode('qr');
    setSeedAnchor(null);
    setChainAnchor(null);
    setDraftPoints([]);
    setDraftEdges([]);
    setSelectedDraftId(null);
    setSelectedNodeId(null);
    setSelectedLandmarkId(null);
    setSelectedEdgeId(null);
    setHighlightedQrId(null);
  }

  function handleStartCalibrateMode() {
    if (draftPoints.length > 0 && !confirm('Discard the waypoints you have not saved yet?')) return;
    setMode('calibrate');
    setSeedAnchor(null);
    setChainAnchor(null);
    setDraftPoints([]);
    setDraftEdges([]);
    setSelectedDraftId(null);
    setSelectedNodeId(null);
    setSelectedLandmarkId(null);
    setSelectedEdgeId(null);
    setCalibrationPoints([]);
    setCalibrationFeet('');
  }

  function handleCalibratePoint(x, y) {
    setCalibrationPoints((prev) => (prev.length >= 2 ? [{ x, y }] : [...prev, { x, y }]));
  }

  function handleResetCalibrationPoints() {
    setCalibrationPoints([]);
    setCalibrationFeet('');
  }

  async function handleSaveCalibration() {
    const feet = Number(calibrationFeet);
    if (!calibrationPixelDistance || !feet || feet <= 0) return;
    setCalibrationSaving(true);
    setError(null);
    try {
      await api.updateFloor(buildingId, floorId, { pixelsPerFoot: calibrationPixelDistance / feet });
      setMode('select');
      setCalibrationPoints([]);
      setCalibrationFeet('');
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setCalibrationSaving(false);
    }
  }

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await api.uploadFloorImage(buildingId, floorId, file);
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function handleCanvasClick(x, y) {
    const tempId = crypto.randomUUID();
    const newPoint = {
      tempId,
      x,
      y,
      label: '',
      nodeType: 'waypoint',
      transitionSubtype: 'elevator',
      transitionGroupId: null,
      transitionGroupName: '',
      transitionRequiresBadgeAccess: false,
      doorDescription: '',
      doorRequiresBadgeAccess: false,
      poiName: '',
      poiDescription: '',
    };
    setDraftPoints((prev) => [...prev, newPoint]);
    const to = { type: 'draft', tempId };
    if (chainAnchor) {
      setDraftEdges((prev) => [...prev, { from: chainAnchor, to }]);
    }
    setChainAnchor(to);
    setSelectedDraftId(tempId);
  }

  function handleNodeClick(nodeId) {
    if (mode === 'qr') {
      setQrOriginNodeId(nodeId);
      setHighlightedQrId(null);
      return;
    }
    if (mode === 'chain') {
      const to = { type: 'existing', id: nodeId };
      if (chainAnchor && !refEquals(chainAnchor, to)) {
        setDraftEdges((prev) => [...prev, { from: chainAnchor, to }]);
      }
      setChainAnchor(to);
      return;
    }
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    setSelectedDraftId(null);
    setSelectedLandmarkId(null);
  }

  async function handleLandmarkPlace(x, y) {
    try {
      const landmark = await api.createLandmark(buildingId, { floorId, x, y, name: '', description: '' });
      refresh();
      setSelectedLandmarkId(landmark.id);
      setMode('select');
    } catch (err) {
      setError(err.message);
    }
  }

  function handleLandmarkClick(landmarkId) {
    if (mode !== 'select') return;
    setSelectedLandmarkId(landmarkId);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setSelectedDraftId(null);
  }

  function handleSelectEdge(edgeId, point = null) {
    setMode('select');
    // Re-clicking the line of the edge that's already selected is how the
    // split point gets fine-tuned — don't re-center/re-zoom on every one of
    // those clicks, only when actually switching to a different edge.
    if (edgeId !== selectedEdgeId) {
      setEdgeFocusNonce((n) => n + 1);
      setSelectedNodeId(null);
      setSelectedLandmarkId(null);
      setSelectedDraftId(null);
    }
    setSelectedEdgeId(edgeId);
    setEdgeSplitPoint(point ? { edgeId, x: point.x, y: point.y } : null);
  }

  function handleSelectEdgeByIndex(index) {
    const edge = floorEdges[index];
    if (edge) handleSelectEdge(edge.id);
  }

  useEffect(() => {
    selectedEdgeRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedEdgeId]);

  function handleUndoLastPoint() {
    if (draftPoints.length === 0) return;
    const removed = draftPoints[draftPoints.length - 1];
    const remaining = draftPoints.slice(0, -1);
    setDraftPoints(remaining);
    setDraftEdges((prev) => prev.filter((e) => !(e.to.type === 'draft' && e.to.tempId === removed.tempId)));
    setChainAnchor(remaining.length > 0 ? { type: 'draft', tempId: remaining[remaining.length - 1].tempId } : seedAnchor);
    setSelectedDraftId(remaining.length > 0 ? remaining[remaining.length - 1].tempId : null);
  }

  function handleUpdateDraftPoint(tempId, patch) {
    setDraftPoints((prev) => prev.map((p) => (p.tempId === tempId ? { ...p, ...patch } : p)));
  }

  async function handleSaveChain() {
    setSaving(true);
    setError(null);
    try {
      const idMap = new Map();
      for (const point of draftPoints) {
        const transitionGroupId = point.nodeType === 'transition' ? point.transitionGroupId || crypto.randomUUID() : null;
        const created = await api.createNode(buildingId, {
          floorId,
          x: point.x,
          y: point.y,
          label: point.nodeType === 'destination' ? point.poiName : point.label,
          nodeType: point.nodeType,
          transitionSubtype: point.nodeType === 'transition' ? point.transitionSubtype : null,
          transitionGroupId,
          transitionGroupName: point.nodeType === 'transition' ? point.transitionGroupName || point.label || '' : null,
          transitionRequiresBadgeAccess: point.nodeType === 'transition' ? point.transitionRequiresBadgeAccess : false,
          doorDescription: point.nodeType === 'door' ? point.doorDescription : null,
          doorRequiresBadgeAccess: point.nodeType === 'door' ? point.doorRequiresBadgeAccess : false,
        });
        idMap.set(point.tempId, created.id);
        if (point.nodeType === 'destination') {
          await api.createPoi(buildingId, { nodeId: created.id, name: point.poiName, description: point.poiDescription });
        }
      }
      function resolveRealId(ref) {
        return ref.type === 'existing' ? ref.id : idMap.get(ref.tempId);
      }
      for (const edge of draftEdges) {
        await api.createEdge(buildingId, { from: resolveRealId(edge.from), to: resolveRealId(edge.to), type: 'hallway' });
      }
      resetChain();
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleCancelChain() {
    if (draftPoints.length > 0 && !confirm('Discard these unsaved waypoints?')) return;
    resetChain();
  }

  async function handleDeleteEdge(edgeId) {
    try {
      await api.deleteEdge(buildingId, edgeId);
      setSelectedEdgeId((id) => (id === edgeId ? null : id));
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUpdateEdge(edgeId, patch) {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateEdge(buildingId, edgeId, patch);
      setBuildingEdges((prev) => prev.map((edge) => (edge.id === edgeId ? updated : edge)));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleInsertWaypointOnEdge(edgeId, point) {
    const edge = buildingEdges.find((e) => e.id === edgeId);
    if (!edge || edge.generatedByTransitionGroup) return;

    const from = buildingNodes.find((n) => n.id === edge.from);
    const to = buildingNodes.find((n) => n.id === edge.to);
    if (!from || !to) return;

    setSaving(true);
    setError(null);
    try {
      const created = await api.createNode(buildingId, {
        floorId: from.floorId,
        x: point?.x ?? Math.round((from.x + to.x) / 2),
        y: point?.y ?? Math.round((from.y + to.y) / 2),
        label: '',
        nodeType: 'waypoint',
      });
      const type = from.nodeType === 'door' || to.nodeType === 'door' ? 'hallway' : edge.type;
      await api.createEdge(buildingId, { from: from.id, to: created.id, type });
      await api.createEdge(buildingId, { from: created.id, to: to.id, type });
      await api.deleteEdge(buildingId, edge.id);
      setSelectedEdgeId(null);
      setEdgeSplitPoint(null);
      setSelectedNodeId(created.id);
      setSelectedLandmarkId(null);
      setSelectedDraftId(null);
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateQr(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.createQrCode(buildingId, { originNodeId: qrOriginNodeId, label: qrLabel || qrOriginLabel || undefined });
      setQrOriginNodeId('');
      setQrLabel('');
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteQr(qrId) {
    if (!confirm('Delete this QR code?')) return;
    try {
      await api.deleteQrCode(buildingId, qrId);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!building) return <div className="page">Loading...</div>;

  return (
    <div className={`page ${floor?.imagePath ? 'page--wide' : ''}`}>
      {!floor?.imagePath ? (
        <>
          <div className="breadcrumbs">
            <Link to="/admin/buildings">Buildings</Link> / <Link to={`/admin/buildings/${buildingId}`}>{building.name}</Link> /{' '}
            {floor?.name || '...'}
          </div>
          <h1>{floor?.name}</h1>
          <div className="card">
            <h2>Upload a floorplan image</h2>
            <p className="muted">PNG, JPEG, or WEBP. Place waypoints and connect them after uploading.</p>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleUpload} disabled={uploading} />
            {error && <div className="error">{error}</div>}
          </div>
        </>
      ) : (
        <div className="floor-editor-layout">
          <div className="floor-editor-sidebar floor-editor-sidebar--left">
            <div className="breadcrumbs">
              <Link to="/admin/buildings">Buildings</Link> / <Link to={`/admin/buildings/${buildingId}`}>{building.name}</Link> /{' '}
              {floor?.name || '...'}
            </div>
            <h1 style={{ marginTop: 4 }}>{floor?.name}</h1>
            <p className="muted">Scale: {floor.pixelsPerFoot ? `${floor.pixelsPerFoot.toFixed(2)} px/ft` : 'not calibrated'}</p>

            <div className="row card" style={{ flexWrap: 'wrap' }}>
              <button
                type="button"
                className={mode === 'select' ? 'primary' : ''}
                onClick={() => {
                  if (mode === 'chain') handleCancelChain();
                  else setMode('select');
                }}
              >
                Select
              </button>
              <button type="button" className={mode === 'chain' ? 'primary' : ''} onClick={handleStartFreshChain}>
                Draw waypoints
              </button>
              <button type="button" className={mode === 'landmark' ? 'primary' : ''} onClick={handleStartLandmarkMode}>
                Place landmark
              </button>
              <button type="button" className={mode === 'qr' ? 'primary' : ''} onClick={handleStartQrMode}>
                QR codes
              </button>
              <button type="button" className={mode === 'calibrate' ? 'primary' : ''} onClick={handleStartCalibrateMode}>
                Calibrate scale
              </button>
            </div>

            {mode === 'chain' ? (
              <ChainPanel
                draftPoints={draftPoints}
                selectedDraftPoint={selectedDraftPoint}
                floors={floors}
                buildingNodes={buildingNodes}
                currentFloorId={floorId}
                onSelectPoint={setSelectedDraftId}
                onUpdatePoint={handleUpdateDraftPoint}
                onUndoLast={handleUndoLastPoint}
                onSave={handleSaveChain}
                onCancel={handleCancelChain}
                saving={saving}
                invalid={draftPoints.some((p) => p.nodeType === 'destination' && !p.poiName?.trim())}
                canSave={draftPoints.length > 0 || draftEdges.length > 0}
              />
            ) : mode === 'landmark' ? (
              <div className="card muted">Click the map to place a landmark.</div>
            ) : mode === 'qr' ? (
              <QrCodePanel
                buildingId={buildingId}
                qrcodes={floorQrCodes}
                originNode={qrOriginNode}
                originLabel={qrOriginLabel}
                label={qrLabel}
                onLabelChange={setQrLabel}
                onCreate={handleCreateQr}
                onDelete={handleDeleteQr}
                highlightedQrId={highlightedQrId}
                onSelect={setHighlightedQrId}
              />
            ) : mode === 'calibrate' ? (
              <CalibratePanel
                floor={floor}
                points={calibrationPoints}
                pixelDistance={calibrationPixelDistance}
                feet={calibrationFeet}
                onFeetChange={setCalibrationFeet}
                onSave={handleSaveCalibration}
                onResetPoints={handleResetCalibrationPoints}
                saving={calibrationSaving}
              />
            ) : selectedLandmark ? (
              <LandmarkPanel
                key={selectedLandmark.id}
                landmark={selectedLandmark}
                floor={floor}
                buildingId={buildingId}
                onChanged={refresh}
                onDeleted={() => {
                  setSelectedLandmarkId(null);
                  refresh();
                }}
              />
            ) : selectedNode ? (
              <NodePanel
                key={selectedNode.id}
                node={selectedNode}
                poi={poiByNodeId.get(selectedNode.id)}
                floors={floors}
                buildingNodes={buildingNodes}
                buildingEdges={buildingEdges}
                poiByNodeId={poiByNodeId}
                buildingId={buildingId}
                onChanged={refresh}
                onDeleted={() => {
                  setSelectedNodeId(null);
                  refresh();
                }}
                onStartChain={() => handleStartChainFromNode(selectedNode.id)}
              />
            ) : selectedEdge ? (
              <EdgePanel
                edge={selectedEdge}
                from={selectedEdgeFrom}
                to={selectedEdgeTo}
                saving={saving}
                splitPoint={activeEdgeSplitPoint}
                onUpdate={(patch) => handleUpdateEdge(selectedEdge.id, patch)}
                onInsertWaypoint={() => handleInsertWaypointOnEdge(selectedEdge.id, activeEdgeSplitPoint)}
                onDelete={() => handleDeleteEdge(selectedEdge.id)}
              />
            ) : (
              <div className="card muted">Select a waypoint, destination, edge, or landmark to edit its details.</div>
            )}

            {error && <div className="error">{error}</div>}
          </div>

          <div className="map-panel floor-editor-map">
            <FloorCanvas
              imageUrl={floor.imagePath}
              nodes={floorCanvasNodes}
              edges={floorEdges}
              poiNodeIds={poiNodeIds}
              qrNodeIds={qrNodeIds}
              selectedEdgeId={selectedEdgeId}
              selectedNodeId={
                mode === 'qr'
                  ? highlightedQrNodeId || qrOriginNodeId
                  : mode === 'select'
                    ? selectedNodeId
                    : chainAnchor?.type === 'existing'
                      ? chainAnchor.id
                      : null
              }
              draftPoints={canvasDraftPoints}
              draftEdges={resolvedDraftEdges}
              selectedDraftId={selectedDraftId}
              landmarks={floorLandmarks}
              selectedLandmarkId={selectedLandmarkId}
              calibrationPoints={calibrationPoints}
              focusNodeId={mode === 'qr' ? highlightedQrNodeId : null}
              focusEdgeId={selectedEdgeId}
              focusEdgeNonce={edgeFocusNonce}
              edgeSplitPoint={activeEdgeSplitPoint}
              mode={mode === 'qr' ? 'select' : mode}
              onCanvasClick={handleCanvasClick}
              onNodeClick={handleNodeClick}
              onEdgeClick={handleSelectEdge}
              onDraftPointClick={setSelectedDraftId}
              onLandmarkPlace={handleLandmarkPlace}
              onLandmarkClick={handleLandmarkClick}
              onCalibratePoint={handleCalibratePoint}
            />

            <h2 style={{ marginTop: 16 }}>Edges on this floor</h2>
            {floorEdges.length === 0 ? (
              <p className="muted">None yet.</p>
            ) : (
              <ul className="list">
                {floorEdges.map((e) => (
                  <li
                    key={e.id}
                    className="list-item"
                    onClick={() => handleSelectEdge(e.id)}
                    style={{
                      cursor: 'pointer',
                      background: selectedEdgeId === e.id ? '#fff7ed' : undefined,
                      borderColor: selectedEdgeId === e.id ? '#fdba74' : undefined,
                    }}
                  >
                    <span>
                      {e.type} ({Math.round(e.weight)}px)
                      {e.generatedByTransitionGroup && (
                        <span className="muted"> — managed by the elevator/stairs group, edit via the linked landings</span>
                      )}
                    </span>
                    {!e.generatedByTransitionGroup && (
                      <button
                        type="button"
                        className="danger"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDeleteEdge(e.id);
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <EdgeListPanel
            edges={floorEdges}
            selectedEdgeId={selectedEdgeId}
            selectedEdgeIndex={selectedFloorEdgeIndex}
            selectedEdgeRowRef={selectedEdgeRowRef}
            onSelectEdge={handleSelectEdge}
            onSelectEdgeByIndex={handleSelectEdgeByIndex}
            onDeleteEdge={handleDeleteEdge}
          />
        </div>
      )}
    </div>
  );
}

function EdgeListPanel({ edges, selectedEdgeId, selectedEdgeIndex, selectedEdgeRowRef, onSelectEdge, onSelectEdgeByIndex, onDeleteEdge }) {
  const sliderValue = selectedEdgeIndex >= 0 ? selectedEdgeIndex : 0;

  return (
    <aside className="floor-editor-sidebar floor-editor-sidebar--right">
      <div className="card edge-list-panel">
        <h2>Edges on this floor</h2>
        {edges.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <>
            <label className="muted" htmlFor="edge-selector">Selected edge</label>
            <input
              id="edge-selector"
              className="edge-slider"
              type="range"
              min="0"
              max={edges.length - 1}
              step="1"
              value={sliderValue}
              onChange={(event) => onSelectEdgeByIndex(Number(event.target.value))}
            />
            <p className="muted" style={{ marginTop: 0 }}>
              {selectedEdgeIndex >= 0 ? `${selectedEdgeIndex + 1} of ${edges.length}` : `Select one of ${edges.length} edges`}
            </p>
            <ul className="list edge-list">
              {edges.map((edge, index) => {
                const selected = edge.id === selectedEdgeId;
                return (
                  <li
                    key={edge.id}
                    ref={selected ? selectedEdgeRowRef : null}
                    className={`list-item edge-list__item${selected ? ' edge-list__item--selected' : ''}`}
                    onClick={() => onSelectEdge(edge.id)}
                  >
                    <span>
                      <strong>#{index + 1}</strong> {edge.type} ({Math.round(edge.weight)}px)
                      {edge.requiresBadgeAccess && <span className="muted"> - badge access</span>}
                      {edge.generatedByTransitionGroup && (
                        <span className="muted"> - managed by the elevator/stairs group</span>
                      )}
                    </span>
                    {!edge.generatedByTransitionGroup && (
                      <button
                        type="button"
                        className="danger"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteEdge(edge.id);
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </aside>
  );
}

function EdgePanel({ edge, from, to, saving, splitPoint, onUpdate, onInsertWaypoint, onDelete }) {
  const [type, setType] = useState(edge.type || 'hallway');
  const canEdit = edge && !edge.generatedByTransitionGroup && (edge.type === 'hallway' || edge.type === 'door') && from && to;
  const hasTypeChange = type !== edge.type;

  useEffect(() => {
    setType(edge.type || 'hallway');
  }, [edge.id, edge.type]);

  return (
    <div className="card">
      <h2>Edge details</h2>
      <p className="muted" style={{ marginBottom: 8 }}>
        {edge.type} connection
        {edge.weight ? ` - ${Math.round(edge.weight)}px` : ''}
        {edge.requiresBadgeAccess ? ' - badge access' : ''}
      </p>
      {from && to && (
        <p className="muted" style={{ marginBottom: 12 }}>
          Between {from.label || from.id} and {to.label || to.id}.
        </p>
      )}
      {edge.generatedByTransitionGroup ? (
        <p className="muted">
          This edge is managed by an elevator/stairs group. Edit the linked landings instead.
        </p>
      ) : (
        <>
          <label className="muted" htmlFor="edge-type">Type</label>
          <div className="row" style={{ marginBottom: 12 }}>
            <select
              id="edge-type"
              value={type}
              onChange={(event) => setType(event.target.value)}
              disabled={saving}
              style={{ flex: 1 }}
            >
              <option value="hallway">Hallway</option>
              <option value="door">Door threshold</option>
            </select>
            <button
              type="button"
              className="primary"
              onClick={() => onUpdate({ type })}
              disabled={!canEdit || !hasTypeChange || saving}
            >
              Save type
            </button>
          </div>
          <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>
            Use door threshold only for very short links between a door and the hallway centerline.
          </p>
          <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>
            {splitPoint
              ? 'Click "Add waypoint at selection" to split the edge at the marked point, or click elsewhere on the line to move it.'
              : 'Click a point on this edge\'s line in the map to choose where to split it.'}
          </p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="primary" onClick={onInsertWaypoint} disabled={!canEdit || !splitPoint || saving}>
              Add waypoint at selection
            </button>
            <button type="button" className="danger" onClick={onDelete} disabled={saving}>
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function QrCodePanel({ buildingId, qrcodes, originNode, originLabel, label, onLabelChange, onCreate, onDelete, highlightedQrId, onSelect }) {
  return (
    <div className="card">
      <h2>QR codes</h2>
      <form onSubmit={onCreate} style={{ marginBottom: 16 }}>
        <label className="muted">Origin</label>
        <p style={{ margin: '4px 0 12px', fontWeight: 600 }}>
          {originNode ? originLabel : <span className="muted" style={{ fontWeight: 400 }}>Click a waypoint, destination, or transition on the map.</span>}
        </p>

        <label className="muted" htmlFor="qr-label">Printed label</label>
        <input
          id="qr-label"
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          placeholder={originLabel || 'Optional'}
          style={{ width: '100%', marginBottom: 12 }}
        />

        <button type="submit" className="primary" disabled={!originNode}>
          Generate QR code
        </button>
      </form>

      <h3>Existing on this floor</h3>
      {qrcodes.length === 0 ? (
        <p className="muted">No QR codes yet.</p>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {qrcodes.map((qr) => (
            <div
              key={qr.id}
              onClick={() => onSelect(qr.id)}
              style={{
                borderTop: '1px solid var(--border)',
                paddingTop: 12,
                cursor: 'pointer',
                outline: qr.id === highlightedQrId ? '2px solid var(--accent)' : 'none',
                outlineOffset: 4,
              }}
            >
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <img src={api.qrCodeImageUrl(buildingId, qr.id)} alt={qr.label} width={96} height={96} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{qr.label}</div>
                  <div className="muted" style={{ wordBreak: 'break-all', fontSize: 12, marginBottom: 8 }}>
                    {qr.url}
                  </div>
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <a href={api.qrCodeImageUrl(buildingId, qr.id)} download={`${qr.label}.svg`} onClick={(e) => e.stopPropagation()}>
                      <button type="button">Download</button>
                    </a>
                    <button
                      type="button"
                      className="danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(qr.id);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CalibratePanel({ floor, points, pixelDistance, feet, onFeetChange, onSave, onResetPoints, saving }) {
  return (
    <div className="card">
      <h2>Calibrate scale</h2>
      <p className="muted" style={{ marginBottom: 8 }}>
        Click two points on the map that are a known real-world distance apart (e.g. opposite ends of a hallway tile
        or a marked dimension on the floorplan), then enter that distance below.
      </p>
      <p className="muted" style={{ marginBottom: 8 }}>
        Current scale: {floor?.pixelsPerFoot ? `${floor.pixelsPerFoot.toFixed(2)} px/ft` : 'not set'}
      </p>
      <p className="muted" style={{ marginBottom: 12 }}>
        {points.length === 0 && 'Click the first point.'}
        {points.length === 1 && 'Click the second point.'}
        {points.length === 2 && `${Math.round(pixelDistance)}px selected.`}
      </p>

      {points.length === 2 && (
        <>
          <label className="muted" htmlFor="calibration-feet">Real-world distance (feet)</label>
          <input
            id="calibration-feet"
            type="number"
            min="0.1"
            step="0.1"
            value={feet}
            onChange={(e) => onFeetChange(e.target.value)}
            style={{ width: '100%', marginBottom: 8 }}
          />
          {Number(feet) > 0 && (
            <p className="muted" style={{ marginBottom: 8 }}>
              New scale: {(pixelDistance / Number(feet)).toFixed(2)} px/ft
            </p>
          )}
        </>
      )}

      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="button" onClick={onResetPoints} disabled={points.length === 0 || saving}>
          Start over
        </button>
        <button type="button" className="primary" onClick={onSave} disabled={points.length !== 2 || !Number(feet) || saving}>
          {saving ? 'Saving...' : 'Save scale'}
        </button>
      </div>
    </div>
  );
}

function ChainPanel({
  draftPoints,
  selectedDraftPoint,
  floors,
  buildingNodes,
  currentFloorId,
  onSelectPoint,
  onUpdatePoint,
  onUndoLast,
  onSave,
  onCancel,
  saving,
  invalid,
  canSave,
}) {
  return (
    <div className="card">
      <h2>Draw waypoints</h2>
      <p className="muted" style={{ marginBottom: 8 }}>
        Click the map to add the next waypoint. Click an existing waypoint or destination to connect the chain to it.
      </p>
      <p className="muted" style={{ marginBottom: 12 }}>
        {draftPoints.length === 0 ? 'No unsaved waypoints yet.' : `${draftPoints.length} unsaved waypoint${draftPoints.length === 1 ? '' : 's'}.`}
      </p>

      {draftPoints.length > 0 && (
        <ul className="list" style={{ marginBottom: 12 }}>
          {draftPoints.map((p, i) => (
            <li
              key={p.tempId}
              className="list-item"
              style={{ cursor: 'pointer', borderColor: p.tempId === selectedDraftPoint?.tempId ? 'var(--accent)' : undefined }}
              onClick={() => onSelectPoint(p.tempId)}
            >
              <span>
                {i + 1}. {(p.nodeType === 'destination' ? p.poiName : p.label) || '(unlabeled)'} — {p.nodeType}
              </span>
            </li>
          ))}
        </ul>
      )}

      {selectedDraftPoint && (
        <DraftPointFields
          key={selectedDraftPoint.tempId}
          point={selectedDraftPoint}
          floors={floors}
          buildingNodes={buildingNodes}
          currentFloorId={currentFloorId}
          onUpdate={onUpdatePoint}
        />
      )}

      <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" onClick={onUndoLast} disabled={draftPoints.length === 0 || saving}>
          Undo last waypoint
        </button>
        <button type="button" className="primary" onClick={onSave} disabled={!canSave || saving || invalid}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button type="button" className="danger" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
      {invalid && <p className="error">Every destination waypoint needs a name before you can save.</p>}
    </div>
  );
}

function DraftPointFields({ point, floors, buildingNodes, currentFloorId, onUpdate }) {
  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <label className="muted" htmlFor="draft-type">Type</label>
      <select
        id="draft-type"
        value={point.nodeType}
        onChange={(e) => onUpdate(point.tempId, { nodeType: e.target.value })}
        style={{ width: '100%', marginBottom: 8 }}
      >
        <option value="waypoint">Waypoint</option>
        <option value="door">Door</option>
        <option value="transition">Elevator / Stairs landing</option>
        <option value="destination">Destination</option>
      </select>

      {point.nodeType !== 'destination' && (
        <>
          <label className="muted" htmlFor="draft-label">Label</label>
          <input
            id="draft-label"
            value={point.label}
            onChange={(e) => onUpdate(point.tempId, { label: e.target.value })}
            style={{ width: '100%', marginBottom: 8 }}
          />
        </>
      )}

      {point.nodeType === 'destination' && (
        <>
          <label className="muted" htmlFor="draft-destination-name">Destination name</label>
          <input
            id="draft-destination-name"
            value={point.poiName}
            onChange={(e) => onUpdate(point.tempId, { poiName: e.target.value })}
            style={{ width: '100%', marginBottom: 8 }}
          />
          <label className="muted" htmlFor="draft-destination-description">Description</label>
          <input
            id="draft-destination-description"
            value={point.poiDescription}
            onChange={(e) => onUpdate(point.tempId, { poiDescription: e.target.value })}
            style={{ width: '100%', marginBottom: 8 }}
          />
        </>
      )}

      {point.nodeType === 'door' && (
        <>
          <label className="muted" htmlFor="draft-door-description">Door description</label>
          <input
            id="draft-door-description"
            value={point.doorDescription}
            onChange={(e) => onUpdate(point.tempId, { doorDescription: e.target.value })}
            placeholder="e.g. glass double doors"
            style={{ width: '100%', marginBottom: 8 }}
          />
          <label className="row" style={{ gap: 6, marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={Boolean(point.doorRequiresBadgeAccess)}
              onChange={(e) => onUpdate(point.tempId, { doorRequiresBadgeAccess: e.target.checked })}
            />
            <span>Requires badge access</span>
          </label>
          <p className="muted" style={{ marginTop: 0 }}>
            Routes avoid badge-required doors when a reasonable no-badge option exists.
          </p>
        </>
      )}

      {point.nodeType === 'transition' && (
        <>
          <label className="muted" htmlFor="draft-subtype">Subtype</label>
          <select
            id="draft-subtype"
            value={point.transitionSubtype}
            onChange={(e) => onUpdate(point.tempId, { transitionSubtype: e.target.value })}
            style={{ width: '100%', marginBottom: 8 }}
          >
            <option value="elevator">Elevator</option>
            <option value="stairs">Stairs</option>
          </select>

          <label className="muted">Links to</label>
          <TransitionLinkPicker
            floors={floors}
            buildingNodes={buildingNodes}
            excludeNodeId={null}
            currentFloorId={currentFloorId}
            transitionSubtype={point.transitionSubtype}
            currentGroupId={point.transitionGroupId}
            currentGroupName={point.transitionGroupName}
            onChange={(groupId, groupName) => onUpdate(point.tempId, { transitionGroupId: groupId, transitionGroupName: groupName })}
          />
          <label className="row" style={{ gap: 6, marginTop: 8, marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={Boolean(point.transitionRequiresBadgeAccess)}
              onChange={(e) => onUpdate(point.tempId, { transitionRequiresBadgeAccess: e.target.checked })}
            />
            <span>Requires badge access on this landing</span>
          </label>
          <p className="muted" style={{ marginTop: 0 }}>
            Routes avoid badge-required stair/elevator landings when a reasonable no-badge option exists.
          </p>
        </>
      )}
    </div>
  );
}

// Lets the admin link a new elevator/stairs landing to an existing one
// elsewhere in the building by picking a floor, then the specific waypoint
// on that floor — rather than choosing a group by name, which gives no clue
// which physical floor/elevator it belongs to.
function groupDisplayName(group, transitionSubtype) {
  if (!group) return transitionSubtype === 'stairs' ? 'Stairwell group' : 'Elevator group';
  if (group.name) return group.name;
  const floors = group.members.map((member) => member.floorName).filter(Boolean).join(', ');
  const type = transitionSubtype === 'stairs' ? 'Stairwell' : 'Elevator';
  return floors ? `${type} serving ${floors}` : `${type} group`;
}

function TransitionLinkPicker({ floors, buildingNodes, excludeNodeId, currentFloorId, transitionSubtype, currentGroupId, currentGroupName, onChange }) {
  const floorById = new Map(floors.map((floor) => [floor.id, floor]));
  const groupById = new Map();
  for (const node of buildingNodes) {
    if (node.nodeType !== 'transition' || node.transitionSubtype !== transitionSubtype || node.id === excludeNodeId || !node.transitionGroupId) continue;
    if (!groupById.has(node.transitionGroupId)) {
      groupById.set(node.transitionGroupId, {
        id: node.transitionGroupId,
        name: node.transitionGroupName || '',
        members: [],
      });
    }
    if (!groupById.get(node.transitionGroupId).name && node.transitionGroupName) {
      groupById.get(node.transitionGroupId).name = node.transitionGroupName;
    }
    groupById.get(node.transitionGroupId).members.push({
      floorId: node.floorId,
      floorName: floorById.get(node.floorId)?.name || node.floorId,
      label: node.label || '',
    });
  }
  const groups = [...groupById.values()];
  const currentGroup = currentGroupId ? groupById.get(currentGroupId) : null;
  const sameFloorMemberExists = Boolean(currentGroup?.members.some((member) => member.floorId === currentFloorId));
  const availableLandings = buildingNodes
    .filter((node) => node.nodeType === 'transition' && node.transitionSubtype === transitionSubtype && node.id !== excludeNodeId && node.transitionGroupId)
    .map((node) => {
      const group = groupById.get(node.transitionGroupId);
      return {
        id: node.id,
        label: node.label || `${transitionSubtype === 'stairs' ? 'Stairs' : 'Elevator'} landing`,
        floorName: floorById.get(node.floorId)?.name || node.floorId,
        groupId: node.transitionGroupId,
        groupName: groupDisplayName(group, transitionSubtype),
      };
    });
  const [mode, setMode] = useState(currentGroup ? 'existing' : 'new');
  const [newGroupName, setNewGroupName] = useState(currentGroupName || '');

  function handleModeNew() {
    setMode('new');
    onChange(null, newGroupName);
  }

  function handleNewGroupName(name) {
    setNewGroupName(name);
    if (mode === 'new') onChange(null, name);
  }

  function handleExistingGroup(groupId) {
    const group = groupById.get(groupId);
    if (group) onChange(group.id, groupDisplayName(group, transitionSubtype));
  }

  function handleExistingLanding(landing) {
    onChange(landing.groupId, landing.groupName);
  }

  return (
    <div style={{ marginBottom: 8 }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <label className="row" style={{ gap: 4 }}>
          <input type="radio" name={`link-mode-${excludeNodeId || 'draft'}`} checked={mode === 'new'} onChange={handleModeNew} />
          New group
        </label>
        <label className="row" style={{ gap: 4 }}>
          <input
            type="radio"
            name={`link-mode-${excludeNodeId || 'draft'}`}
            checked={mode === 'existing'}
            onChange={() => setMode('existing')}
          />
          Link to existing landing
        </label>
      </div>

      {mode === 'new' && (
        <>
          <label className="muted" htmlFor={`transition-group-name-${excludeNodeId || 'draft'}`}>Group name</label>
          <input
            id={`transition-group-name-${excludeNodeId || 'draft'}`}
            value={newGroupName}
            onChange={(e) => handleNewGroupName(e.target.value)}
            placeholder={transitionSubtype === 'stairs' ? 'e.g. West stairwell' : 'e.g. Main elevators'}
            style={{ width: '100%', marginBottom: 8 }}
          />
        </>
      )}

      {mode === 'existing' && (
        <>
          <label className="muted" htmlFor={`transition-group-${excludeNodeId || 'draft'}`}>Existing landing group</label>
          <select
            id={`transition-group-${excludeNodeId || 'draft'}`}
            value={currentGroupId || ''}
            onChange={(e) => handleExistingGroup(e.target.value)}
            disabled={groups.length === 0}
            style={{ width: '100%', marginBottom: 8 }}
          >
            <option value="">Select a group...</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {groupDisplayName(group, transitionSubtype)}
              </option>
            ))}
          </select>
          {groups.length === 0 ? (
            <p className="muted">No saved {transitionSubtype} groups yet. Save one landing as a new group first.</p>
          ) : currentGroup ? (
            <>
              <label className="muted">Landings in selected group</label>
              <ul className="list" style={{ marginTop: 6, marginBottom: 8 }}>
                {currentGroup.members.map((member, index) => (
                  <li key={`${member.floorName}-${member.label}-${index}`} className="list-item">
                    <span>
                      {member.floorName}
                      {member.label && <span className="muted"> - {member.label}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="muted">
                This landing will be assigned to {groupDisplayName(currentGroup, transitionSubtype)} when saved.
              </p>
              {sameFloorMemberExists && (
                <p className="muted">
                  This group already has a landing on this floor — saving will add a second, alternate landing here
                  (e.g. the other side of the lobby), connected to it by a normal walk, not a second ride. Give each a
                  distinct label (e.g. "East elevator landing") so directions can tell visitors which one they're near.
                </p>
              )}
            </>
          ) : (
            <>
              <label className="muted">Available landings</label>
              <ul className="list" style={{ marginTop: 6, marginBottom: 8 }}>
                {availableLandings.map((landing) => (
                  <li key={landing.id} className="list-item" style={{ cursor: 'pointer' }} onClick={() => handleExistingLanding(landing)}>
                    <span>
                      <strong>{landing.groupName}</strong>
                      <br />
                      <span className="muted">
                        {landing.floorName} - {landing.label}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

function NodePanel({ node, poi, floors, buildingNodes, buildingEdges, poiByNodeId, buildingId, onChanged, onDeleted, onStartChain }) {
  const [label, setLabel] = useState(node.label || '');
  const [nodeType, setNodeType] = useState(node.nodeType || 'waypoint');
  const [transitionSubtype, setTransitionSubtype] = useState(node.transitionSubtype || 'elevator');
  const [groupChoice, setGroupChoice] = useState(node.transitionGroupId || null);
  const [groupName, setGroupName] = useState(node.transitionGroupName || '');
  const [transitionRequiresBadgeAccess, setTransitionRequiresBadgeAccess] = useState(Boolean(node.transitionRequiresBadgeAccess));
  const [doorDescription, setDoorDescription] = useState(node.doorDescription || '');
  const [doorRequiresBadgeAccess, setDoorRequiresBadgeAccess] = useState(Boolean(node.doorRequiresBadgeAccess));
  const [doorBadgeAccessFromNodeIds, setDoorBadgeAccessFromNodeIds] = useState(node.doorBadgeAccessFromNodeIds || []);
  const [error, setError] = useState(null);

  const [poiName, setPoiName] = useState(poi?.name || '');
  const [poiDescription, setPoiDescription] = useState(poi?.description || '');

  // Tracks what THIS component has itself persisted so far, independent of
  // the `node`/`poi` props (which only advance once the parent's async
  // refresh() round-trips back down). Reading the props directly here would
  // let a second rapid save see stale "was this a destination / does a poi
  // exist yet" state and skip creating/deleting the poi.
  const [committedType, setCommittedType] = useState(node.nodeType || 'waypoint');
  const [committedPoiId, setCommittedPoiId] = useState(poi?.id || null);

  async function handleSave() {
    setError(null);
    try {
      const patch = {
        label: nodeType === 'destination' ? poiName : label,
        nodeType,
        doorDescription: nodeType === 'door' ? doorDescription : null,
        doorRequiresBadgeAccess: nodeType === 'door' ? doorRequiresBadgeAccess : false,
        doorBadgeAccessFromNodeIds: nodeType === 'door' && doorRequiresBadgeAccess ? doorBadgeAccessFromNodeIds : [],
      };
      if (nodeType === 'transition') {
        patch.transitionSubtype = transitionSubtype;
        patch.transitionGroupId = groupChoice || crypto.randomUUID();
        patch.transitionGroupName = groupName || label || '';
        patch.transitionRequiresBadgeAccess = transitionRequiresBadgeAccess;
      } else {
        patch.transitionSubtype = null;
        patch.transitionGroupId = null;
        patch.transitionGroupName = null;
        patch.transitionRequiresBadgeAccess = false;
      }
      await api.updateNode(buildingId, node.id, patch);

      let nextPoiId = committedPoiId;
      if (nodeType === 'destination') {
        if (committedPoiId) {
          await api.updatePoi(buildingId, committedPoiId, { name: poiName, description: poiDescription });
        } else {
          const created = await api.createPoi(buildingId, { nodeId: node.id, name: poiName, description: poiDescription });
          nextPoiId = created.id;
        }
      } else if (committedType === 'destination' && committedPoiId) {
        await api.deletePoi(buildingId, committedPoiId);
        nextPoiId = null;
      }
      setCommittedPoiId(nextPoiId);
      setCommittedType(nodeType);

      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this waypoint?')) return;
    try {
      await api.deleteNode(buildingId, node.id);
      onDeleted();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSavePoi() {
    setError(null);
    try {
      if (committedPoiId) {
        await api.updatePoi(buildingId, committedPoiId, { name: poiName, description: poiDescription });
      } else {
        const created = await api.createPoi(buildingId, { nodeId: node.id, name: poiName, description: poiDescription });
        setCommittedPoiId(created.id);
      }
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeletePoi() {
    if (!committedPoiId) return;
    try {
      await api.deletePoi(buildingId, committedPoiId);
      setCommittedPoiId(null);
      setPoiName('');
      setPoiDescription('');
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card">
      <h2>Waypoint details</h2>
      <label className="muted" htmlFor="node-type">Type</label>
      <select id="node-type" value={nodeType} onChange={(e) => setNodeType(e.target.value)} style={{ width: '100%', marginBottom: 8 }}>
        <option value="waypoint">Waypoint</option>
        <option value="door">Door</option>
        <option value="transition">Elevator / Stairs landing</option>
        <option value="destination">Destination</option>
      </select>

      {nodeType !== 'destination' && (
        <>
          <label className="muted" htmlFor="node-label">Label</label>
          <input id="node-label" value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
        </>
      )}

      {nodeType === 'door' && (
        <>
          <label className="muted" htmlFor="node-door-description">Door description</label>
          <input
            id="node-door-description"
            value={doorDescription}
            onChange={(e) => setDoorDescription(e.target.value)}
            placeholder="e.g. glass double doors"
            style={{ width: '100%', marginBottom: 8 }}
          />
          <label className="row" style={{ gap: 6, marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={doorRequiresBadgeAccess}
              onChange={(e) => setDoorRequiresBadgeAccess(e.target.checked)}
            />
            <span>Requires badge access</span>
          </label>
          <p className="muted" style={{ marginTop: 0, marginBottom: 8 }}>
            Routes avoid badge-required doors when a reasonable no-badge option exists.
          </p>
          {doorRequiresBadgeAccess && (
            <DoorBadgeDirectionPicker
              node={node}
              buildingEdges={buildingEdges}
              buildingNodes={buildingNodes}
              poiByNodeId={poiByNodeId}
              value={doorBadgeAccessFromNodeIds}
              onChange={setDoorBadgeAccessFromNodeIds}
            />
          )}
        </>
      )}

      {nodeType === 'transition' && (
        <>
          <label className="muted" htmlFor="node-transition-subtype">Subtype</label>
          <select
            id="node-transition-subtype"
            value={transitionSubtype}
            onChange={(e) => setTransitionSubtype(e.target.value)}
            style={{ width: '100%', marginBottom: 8 }}
          >
            <option value="elevator">Elevator</option>
            <option value="stairs">Stairs</option>
          </select>

          <label className="muted">Links to</label>
          <TransitionLinkPicker
            floors={floors}
            buildingNodes={buildingNodes}
            excludeNodeId={node.id}
            currentFloorId={node.floorId}
            transitionSubtype={transitionSubtype}
            currentGroupId={groupChoice}
            currentGroupName={groupName}
            onChange={(groupId, nextGroupName) => {
              setGroupChoice(groupId);
              setGroupName(nextGroupName);
            }}
          />
          <p className="muted" style={{ marginBottom: 8 }}>
            Nodes sharing a group are treated as landings of the same elevator/stairwell; every pair connects directly.
          </p>
          <label className="row" style={{ gap: 6, marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={transitionRequiresBadgeAccess}
              onChange={(e) => setTransitionRequiresBadgeAccess(e.target.checked)}
            />
            <span>Requires badge access on this landing</span>
          </label>
          <p className="muted" style={{ marginTop: 0, marginBottom: 8 }}>
            Routes avoid badge-required stair/elevator landings when a reasonable no-badge option exists.
          </p>
          {groupChoice && (
            <>
              <label className="muted" htmlFor="node-transition-group-name">Group name</label>
              <input
                id="node-transition-group-name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder={transitionSubtype === 'stairs' ? 'e.g. West stairwell' : 'e.g. Main elevators'}
                style={{ width: '100%', marginBottom: 8 }}
              />
            </>
          )}
        </>
      )}

      {nodeType === 'destination' && (
        <>
          <label className="muted" htmlFor="node-destination-name">Destination name</label>
          <input
            id="node-destination-name"
            value={poiName}
            onChange={(e) => setPoiName(e.target.value)}
            style={{ width: '100%', marginBottom: 8 }}
          />
          <label className="muted" htmlFor="node-destination-description">Description</label>
          <input
            id="node-destination-description"
            value={poiDescription}
            onChange={(e) => setPoiDescription(e.target.value)}
            style={{ width: '100%', marginBottom: 8 }}
          />
          <p className="muted" style={{ marginBottom: 8 }}>
            Destinations appear in the list a visitor picks from after scanning a QR code.
          </p>
        </>
      )}

      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="primary" onClick={handleSave} disabled={nodeType === 'destination' && !poiName.trim()}>
          Save
        </button>
        <button type="button" onClick={onStartChain}>
          Continue chain from here
        </button>
        <button type="button" className="danger" onClick={handleDelete}>
          Delete
        </button>
      </div>

      {nodeType !== 'destination' && (
        <>
          <h2 style={{ marginTop: 20 }}>Also tag as a destination</h2>
          <label className="muted" htmlFor="poi-name">Name</label>
          <input id="poi-name" value={poiName} onChange={(e) => setPoiName(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
          <label className="muted" htmlFor="poi-description">Description</label>
          <input
            id="poi-description"
            value={poiDescription}
            onChange={(e) => setPoiDescription(e.target.value)}
            style={{ width: '100%', marginBottom: 8 }}
          />
          <div className="row">
            <button type="button" className="primary" onClick={handleSavePoi} disabled={!poiName.trim()}>
              {committedPoiId ? 'Update' : 'Tag as destination'}
            </button>
            {committedPoiId && (
              <button type="button" className="danger" onClick={handleDeletePoi}>
                Remove destination
              </button>
            )}
          </div>
        </>
      )}

      {error && <div className="error">{error}</div>}
    </div>
  );
}

// Real badge doors are usually one-directional: a reader on the public
// side, free egress on the secure side. Lets the admin pick which of this
// door's current neighbors sit on the public side the badge is required
// from — a physical "side" can be more than one graph node (e.g. an
// elevator landing and a separate pass-by waypoint in the same lobby), so
// this is a multi-select, not a single choice. Leaving every box unchecked
// keeps the old behavior of gating both directions.
function DoorBadgeDirectionPicker({ node, buildingEdges, buildingNodes, poiByNodeId, value, onChange }) {
  const nodeById = useMemo(() => new Map(buildingNodes.map((n) => [n.id, n])), [buildingNodes]);
  const neighbors = useMemo(() => {
    const ids = (buildingEdges || [])
      .filter((e) => e.from === node.id || e.to === node.id)
      .map((e) => (e.from === node.id ? e.to : e.from));
    return [...new Set(ids)].map((id) => nodeById.get(id)).filter(Boolean);
  }, [buildingEdges, node.id, nodeById]);

  function toggle(neighborId, checked) {
    onChange(checked ? [...value, neighborId] : value.filter((id) => id !== neighborId));
  }

  return (
    <>
      <label className="muted">Badge required entering from</label>
      {neighbors.length === 0 ? (
        <p className="muted" style={{ marginTop: 0, marginBottom: 8 }}>
          This door isn't connected to any other point yet.
        </p>
      ) : (
        <ul className="list" style={{ marginTop: 6, marginBottom: 8 }}>
          {neighbors.map((neighbor) => (
            <li key={neighbor.id} className="list-item">
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={value.includes(neighbor.id)}
                  onChange={(e) => toggle(neighbor.id, e.target.checked)}
                />
                <span>{getNodeDisplayLabel(neighbor, poiByNodeId)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="muted" style={{ marginTop: 0, marginBottom: 8 }}>
        Leave everything unchecked unless this door only badges you in from one side. Entering from a checked side
        requires a badge; walking out an unchecked side is free.
      </p>
    </>
  );
}

function LandmarkPanel({ landmark, floor, buildingId, onChanged, onDeleted }) {
  const [name, setName] = useState(landmark.name || '');
  const [description, setDescription] = useState(landmark.description || '');
  const [visibilityRadiusFeet, setVisibilityRadiusFeet] = useState(String(landmark.visibilityRadiusFeet || 30));
  const [error, setError] = useState(null);

  async function handleSave() {
    setError(null);
    try {
      await api.updateLandmark(buildingId, landmark.id, {
        name,
        description,
        visibilityRadiusFeet: Math.max(1, Number(visibilityRadiusFeet) || 30),
      });
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this landmark?')) return;
    try {
      await api.deleteLandmark(buildingId, landmark.id);
      onDeleted();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card">
      <h2>Landmark details</h2>
      <p className="muted" style={{ marginBottom: 8 }}>
        Landmarks are visual references (a sign, a distinctive door, a desk) used to make generated directions sound
        natural — they aren't part of the walking route itself.
      </p>
      <label className="muted" htmlFor="landmark-name">Name</label>
      <input id="landmark-name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
      <label className="muted" htmlFor="landmark-description">Description</label>
      <input
        id="landmark-description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder='e.g. "Glass doors with the Kimley-Horn logo"'
        style={{ width: '100%', marginBottom: 8 }}
      />
      <label className="muted" htmlFor="landmark-visibility">Visibility distance (ft)</label>
      <input
        id="landmark-visibility"
        type="number"
        min="1"
        step="1"
        value={visibilityRadiusFeet}
        onChange={(e) => setVisibilityRadiusFeet(e.target.value)}
        style={{ width: '100%', marginBottom: 8 }}
      />
      <p className="muted" style={{ marginTop: 0 }}>
        Mention this landmark only when the route passes within this distance
        {floor?.pixelsPerFoot ? ` (${Math.round((Number(visibilityRadiusFeet) || 30) * floor.pixelsPerFoot)} map px)` : ''}.
      </p>
      <div className="row">
        <button type="button" className="primary" onClick={handleSave} disabled={!name.trim()}>
          Save
        </button>
        <button type="button" className="danger" onClick={handleDelete}>
          Delete
        </button>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
