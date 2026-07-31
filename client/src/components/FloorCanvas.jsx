import { useEffect, useRef, useState } from 'react';

const NODE_COLORS = {
  waypoint: '#6d28d9',
  door: '#2563eb',
  transition: '#d97706',
  destination: '#dc2626',
};

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;
const DRAG_THRESHOLD_PX = 3;
const PAN_PADDING_FACTOR = 0.5;
const FOCUS_ZOOM = 1;

function clampZoom(z) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

function screenPx(px, zoom) {
  return px / zoom;
}

// Small badge that looks like a corner of a QR code (finder-pattern squares),
// drawn at the top-right of a node marker to flag "a QR code starts here"
// without needing a separate legend entry.
function QrBadge({ x, y, zoom }) {
  const size = screenPx(11, zoom);
  const half = size / 2;
  const pad = screenPx(1.5, zoom);
  const finder = (size - pad * 3) / 2;
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x={-half} y={-half} width={size} height={size} rx={screenPx(2, zoom)} fill="#fff" stroke="#111" strokeWidth={screenPx(1.25, zoom)} />
      <rect x={-half + pad} y={-half + pad} width={finder} height={finder} fill="#111" />
      <rect x={half - finder - pad} y={-half + pad} width={finder} height={finder} fill="#111" />
      <rect x={-half + pad} y={half - finder - pad} width={finder} height={finder} fill="#111" />
    </g>
  );
}

export default function FloorCanvas({
  imageUrl,
  nodes,
  edges,
  poiNodeIds,
  qrNodeIds = new Set(),
  selectedNodeId,
  draftPoints = [],
  draftEdges = [],
  selectedDraftId,
  landmarks = [],
  selectedLandmarkId,
  calibrationPoints = [],
  focusNodeId,
  mode,
  onCanvasClick,
  onNodeClick,
  onDraftPointClick,
  onLandmarkPlace,
  onLandmarkClick,
  onCalibratePoint,
}) {
  const [size, setSize] = useState(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const scrollRef = useRef(null);
  const dragRef = useRef(null);
  const fittedImageRef = useRef(null);
  const zoomRef = useRef(zoom);
  const pendingScrollRef = useRef(null);
  const suppressClickRef = useRef(false);

  const panEnabled = true;

  function handleImageLoad(e) {
    setSize({ width: e.target.naturalWidth, height: e.target.naturalHeight });
  }

  function fitToImageExtent() {
    const container = scrollRef.current;
    if (!container || !size || viewportSize.width === 0 || viewportSize.height === 0) return false;

    const fitWidth = viewportSize.width / size.width;
    const fitHeight = viewportSize.height / size.height;
    const fitZoom = clampZoom(Math.min(fitWidth, fitHeight, 1));
    const paddingX = viewportSize.width * PAN_PADDING_FACTOR;
    const paddingY = viewportSize.height * PAN_PADDING_FACTOR;
    setZoom(fitZoom);
    pendingScrollRef.current = { left: paddingX, top: paddingY };
    return true;
  }

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  function zoomAtViewportPoint(clientX, clientY, factor) {
    const el = scrollRef.current;
    if (!el || !size) return;

    const rect = el.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;
    const currentZoom = zoomRef.current;
    const newZoom = clampZoom(currentZoom * factor);
    if (newZoom === currentZoom) return;

    const actualFactor = newZoom / currentZoom;
    const paddingX = el.clientWidth * PAN_PADDING_FACTOR;
    const paddingY = el.clientHeight * PAN_PADDING_FACTOR;
    const nextScrollLeft = (el.scrollLeft + mouseX - paddingX) * actualFactor + paddingX - mouseX;
    const nextScrollTop = (el.scrollTop + mouseY - paddingY) * actualFactor + paddingY - mouseY;

    setZoom(newZoom);
    requestAnimationFrame(() => {
      el.scrollLeft = nextScrollLeft;
      el.scrollTop = nextScrollTop;
    });
  }

  function zoomAtViewportCenter(factor) {
    const el = scrollRef.current;
    if (!el) {
      setZoom((z) => clampZoom(z * factor));
      return;
    }
    const rect = el.getBoundingClientRect();
    zoomAtViewportPoint(rect.left + el.clientWidth / 2, rect.top + el.clientHeight / 2, factor);
  }

  // Pans and zooms so that image point (x, y) lands at the center of the
  // viewport — used to jump to a QR code's origin node when it's picked from
  // the list, rather than requiring the admin to hunt for it manually.
  function centerOnPoint(x, y, targetZoom) {
    const el = scrollRef.current;
    if (!el || viewportSize.width === 0 || viewportSize.height === 0) return;
    const newZoom = clampZoom(targetZoom);
    const paddingX = viewportSize.width * PAN_PADDING_FACTOR;
    const paddingY = viewportSize.height * PAN_PADDING_FACTOR;
    setZoom(newZoom);
    pendingScrollRef.current = {
      left: paddingX + x * newZoom - viewportSize.width / 2,
      top: paddingY + y * newZoom - viewportSize.height / 2,
    };
  }

  useEffect(() => {
    if (!focusNodeId || !size) return;
    const node = nodes.find((n) => n.id === focusNodeId);
    if (!node) return;
    centerOnPoint(node.x, node.y, Math.max(zoomRef.current, FOCUS_ZOOM));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNodeId, size, viewportSize.width, viewportSize.height]);

  useEffect(() => {
    fittedImageRef.current = null;
    setSize(null);
  }, [imageUrl]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !size || fittedImageRef.current === imageUrl) return;

    // Only record this image as "fitted" once fitToImageExtent actually ran a
    // fit — if viewportSize is still {0,0} (ResizeObserver hasn't reported the
    // real size yet), it no-ops, and marking it fitted anyway would permanently
    // skip the retry once the real size arrives, leaving the view stuck.
    if (fitToImageExtent()) {
      fittedImageRef.current = imageUrl;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, size, viewportSize.width, viewportSize.height]);

  // Measure only via ResizeObserver's own initial callback, not a synchronous
  // read right after mount — on the very first route load (fonts/layout not
  // yet settled), a synchronous clientWidth/clientHeight read can catch the
  // container mid-layout and report a too-small size. That bogus size then
  // drives fitToImageExtent to a wrong zoom/scroll before the real size
  // arrives, and since the fit is only applied once per image, the correct
  // size update that follows is ignored, leaving the view stuck. The
  // observer's own initial invocation (guaranteed by spec) reports the
  // post-layout size instead.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return undefined;
    function updateViewportSize() {
      setViewportSize({ width: container.clientWidth, height: container.clientHeight });
    }
    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  function handleSvgClick(e) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (mode !== 'chain' && mode !== 'landmark' && mode !== 'calibrate') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) / zoom);
    const y = Math.round((e.clientY - rect.top) / zoom);
    if (mode === 'chain') onCanvasClick(x, y);
    else if (mode === 'landmark') onLandmarkPlace(x, y);
    else onCalibratePoint(x, y);
  }

  function handleNodeClick(id) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onNodeClick(id);
  }

  function handleDraftPointClick(tempId) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onDraftPointClick(tempId);
  }

  function handleLandmarkClick(id) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onLandmarkClick(id);
  }

  // Plain window-level listeners (not Pointer Capture) so a no-movement click
  // still dispatches its native click event to the actual element under the
  // cursor — setPointerCapture retargets that click to the capturing element,
  // which silently broke node/waypoint selection in Select mode.
  function handleMouseDown(e) {
    if (!panEnabled || e.button !== 0) return;
    const container = scrollRef.current;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startScrollLeft: container.scrollLeft,
      startScrollTop: container.scrollTop,
      moved: false,
    };
    setIsDragging(true);
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
  }

  function handleWindowMouseMove(e) {
    const drag = dragRef.current;
    if (!drag) return;
    const container = scrollRef.current;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) drag.moved = true;
    container.scrollLeft = drag.startScrollLeft - dx;
    container.scrollTop = drag.startScrollTop - dy;
  }

  function handleWindowMouseUp() {
    const drag = dragRef.current;
    if (drag && drag.moved) suppressClickRef.current = true;
    window.removeEventListener('mousemove', handleWindowMouseMove);
    window.removeEventListener('mouseup', handleWindowMouseUp);
    dragRef.current = null;
    setIsDragging(false);
  }

  // Capture wheel events with a non-passive listener so the map pane treats
  // wheel input as zoom rather than native horizontal/vertical scrolling.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    function handleWheel(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.deltaY === 0) return;
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      zoomAtViewportPoint(e.clientX, e.clientY, factor);
    }
    el.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    return () => el.removeEventListener('wheel', handleWheel, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edgeStrokeWidth = screenPx(3, zoom);
  const markerStrokeWidth = screenPx(2, zoom);
  const labelFontSize = screenPx(12, zoom);
  const labelOffset = screenPx(11, zoom);
  const labelStrokeWidth = screenPx(3, zoom);
  const draftDash = `${screenPx(6, zoom)} ${screenPx(4, zoom)}`;
  const markerDash = `${screenPx(3, zoom)} ${screenPx(2, zoom)}`;
  const panPaddingX = viewportSize.width * PAN_PADDING_FACTOR;
  const panPaddingY = viewportSize.height * PAN_PADDING_FACTOR;
  const imageWidth = size ? size.width * zoom : 'auto';
  const imageHeight = size ? size.height * zoom : 'auto';
  const contentWidth = size ? size.width * zoom + panPaddingX * 2 : 'auto';
  const contentHeight = size ? size.height * zoom + panPaddingY * 2 : 'auto';

  useEffect(() => {
    const container = scrollRef.current;
    const pending = pendingScrollRef.current;
    if (!container || !pending) return;
    pendingScrollRef.current = null;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        container.scrollLeft = pending.left;
        container.scrollTop = pending.top;
      });
    });
  }, [zoom, contentWidth, contentHeight]);

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button type="button" onClick={() => zoomAtViewportCenter(1 / ZOOM_STEP)} title="Zoom out">
          −
        </button>
        <span className="muted" style={{ minWidth: 44, textAlign: 'center' }}>
          {Math.round(zoom * 100)}%
        </span>
        <button type="button" onClick={() => zoomAtViewportCenter(ZOOM_STEP)} title="Zoom in">
          +
        </button>
        <button type="button" onClick={fitToImageExtent} title="Reset view">
          Reset view
        </button>
        <span className="muted">Scroll to zoom, click-drag to pan.</span>
      </div>
      <div
        ref={scrollRef}
        onMouseDown={handleMouseDown}
        style={{
          overflow: 'auto',
          border: '1px solid var(--border)',
          borderRadius: 8,
          maxHeight: '75vh',
          overscrollBehavior: 'contain',
          userSelect: isDragging ? 'none' : 'auto',
        }}
      >
        <div style={{ position: 'relative', width: contentWidth, height: contentHeight }}>
          <div style={{ position: size ? 'absolute' : 'relative', left: size ? panPaddingX : 0, top: size ? panPaddingY : 0, width: imageWidth, height: imageHeight }}>
            <img
              src={imageUrl}
              onLoad={handleImageLoad}
              alt="Floorplan"
              style={{ display: 'block', width: imageWidth, height: imageHeight }}
              draggable={false}
            />
            {size && (
              <svg
                width={imageWidth}
                height={imageHeight}
                viewBox={`0 0 ${size.width} ${size.height}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  overflow: 'visible',
                  cursor:
                    mode === 'chain' || mode === 'landmark' || mode === 'calibrate'
                      ? 'crosshair'
                      : isDragging
                        ? 'grabbing'
                        : 'grab',
                }}
                onClick={handleSvgClick}
              >
              {edges.map((edge) => {
                const from = nodeById.get(edge.from);
                const to = nodeById.get(edge.to);
                if (!from || !to) return null;
                return <line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#4b5563" strokeWidth={edgeStrokeWidth} />;
              })}

              {draftEdges.map((edge, i) => (
                <line
                  key={i}
                  x1={edge.from.x}
                  y1={edge.from.y}
                  x2={edge.to.x}
                  y2={edge.to.y}
                  stroke="#16a34a"
                  strokeWidth={edgeStrokeWidth}
                  strokeDasharray={draftDash}
                />
              ))}

              {nodes.map((node) => {
                const isSelected = node.id === selectedNodeId;
                const isPoi = poiNodeIds.has(node.id);
                const hasQrCode = qrNodeIds.has(node.id);
                return (
                  <g
                    key={node.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleNodeClick(node.id);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={screenPx(isSelected ? 9 : 7, zoom)}
                      fill={NODE_COLORS[node.nodeType] || NODE_COLORS.waypoint}
                      stroke={isSelected ? '#000' : '#fff'}
                      strokeWidth={markerStrokeWidth}
                    />
                    {isPoi && <circle cx={node.x} cy={node.y} r={screenPx(3, zoom)} fill="#fff" />}
                    {hasQrCode && (
                      <QrBadge x={node.x + screenPx(11, zoom)} y={node.y - screenPx(11, zoom)} zoom={zoom} />
                    )}
                    {node.label && (
                      <text
                        x={node.x + labelOffset}
                        y={node.y + screenPx(4, zoom)}
                        fontSize={labelFontSize}
                        fill="#111"
                        stroke="#fff"
                        strokeWidth={labelStrokeWidth}
                        paintOrder="stroke"
                      >
                        {node.label}
                      </text>
                    )}
                  </g>
                );
              })}

              {draftPoints.map((point) => {
                const isSelected = point.tempId === selectedDraftId;
                return (
                  <g
                    key={point.tempId}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDraftPointClick(point.tempId);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={screenPx(isSelected ? 9 : 7, zoom)}
                      fill={NODE_COLORS[point.nodeType] || NODE_COLORS.waypoint}
                      stroke={isSelected ? '#000' : '#16a34a'}
                      strokeWidth={markerStrokeWidth}
                      strokeDasharray={markerDash}
                    />
                    {point.label && (
                      <text
                        x={point.x + labelOffset}
                        y={point.y + screenPx(4, zoom)}
                        fontSize={labelFontSize}
                        fill="#111"
                        stroke="#fff"
                        strokeWidth={labelStrokeWidth}
                        paintOrder="stroke"
                      >
                        {point.label}
                      </text>
                    )}
                  </g>
                );
              })}

              {landmarks.map((landmark) => {
                const isSelected = landmark.id === selectedLandmarkId;
                const r = screenPx(isSelected ? 8 : 6.5, zoom);
                return (
                  <g
                    key={landmark.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLandmarkClick(landmark.id);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <rect
                      x={landmark.x - r}
                      y={landmark.y - r}
                      width={r * 2}
                      height={r * 2}
                      fill="#0d9488"
                      stroke={isSelected ? '#000' : '#fff'}
                      strokeWidth={markerStrokeWidth}
                      transform={`rotate(45 ${landmark.x} ${landmark.y})`}
                    />
                    {landmark.name && (
                      <text
                        x={landmark.x + labelOffset}
                        y={landmark.y + screenPx(4, zoom)}
                        fontSize={labelFontSize}
                        fontStyle="italic"
                        fill="#0d9488"
                        stroke="#fff"
                        strokeWidth={labelStrokeWidth}
                        paintOrder="stroke"
                      >
                        {landmark.name}
                      </text>
                    )}
                  </g>
                );
              })}

              {mode === 'calibrate' && calibrationPoints.length === 2 && (
                <line
                  x1={calibrationPoints[0].x}
                  y1={calibrationPoints[0].y}
                  x2={calibrationPoints[1].x}
                  y2={calibrationPoints[1].y}
                  stroke="#eab308"
                  strokeWidth={edgeStrokeWidth}
                  strokeDasharray={draftDash}
                />
              )}
              {mode === 'calibrate' &&
                calibrationPoints.map((point, i) => (
                  <circle
                    key={i}
                    cx={point.x}
                    cy={point.y}
                    r={screenPx(7, zoom)}
                    fill="#eab308"
                    stroke="#000"
                    strokeWidth={markerStrokeWidth}
                  />
                ))}
              </svg>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
