import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';

const UNKNOWN_FLOOR_ID = '__unknown_floor__';

function getFloorSortValue(floor) {
  const match = String(floor?.name || floor?.id || '').match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
}

function compareFloors(a, b) {
  const numberDifference = getFloorSortValue(a.floor) - getFloorSortValue(b.floor);
  if (numberDifference !== 0) return numberDifference;

  const nameComparison = a.floorName.localeCompare(b.floorName, undefined, { numeric: true, sensitivity: 'base' });
  if (nameComparison !== 0) return nameComparison;

  return a.floorId.localeCompare(b.floorId);
}

// Voice search rarely produces the exact word an admin typed into a POI
// name — speech-to-text often converts spoken ordinals to numerals
// ("eighth" -> "8th"), and everyday phrasing differs from the posted name
// ("bathroom" for a POI named "Restroom"). This is a small, curated set of
// synonyms for common indoor-wayfinding terms, not a general thesaurus.
const DESTINATION_SYNONYMS = {
  bathroom: ['restroom', 'washroom', 'toilet', 'lavatory'],
  restroom: ['bathroom', 'washroom', 'toilet', 'lavatory'],
  washroom: ['bathroom', 'restroom'],
  toilet: ['bathroom', 'restroom'],
  lavatory: ['bathroom', 'restroom'],
  elevator: ['lift'],
  lift: ['elevator'],
  stairs: ['staircase', 'stairwell', 'steps'],
  staircase: ['stairs', 'stairwell'],
  stairwell: ['stairs', 'staircase'],
  kitchen: ['breakroom', 'lunchroom'],
  breakroom: ['kitchen', 'lunchroom'],
  lunchroom: ['kitchen', 'breakroom'],
  conference: ['meeting'],
  meeting: ['conference'],
  reception: ['lobby', 'frontdesk'],
  lobby: ['reception'],
};

const CARDINAL_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

const ORDINAL_WORDS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8,
  ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14,
  fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20,
};

const SEARCH_STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'for', 'at', 'in', 'on', 'of', 'go', 'take', 'me', 'find',
  'where', 'is', 'are', 'please', 'can', 'you', 'i', 'need', 'want', 'looking',
]);

// Collapses "eighth"/"8th"/"eight" down to a bare "8" so a spoken ordinal
// matches a numeral typed into a POI name (or vice versa).
function normalizeSearchWord(word) {
  if (CARDINAL_WORDS[word] !== undefined) return String(CARDINAL_WORDS[word]);
  if (ORDINAL_WORDS[word] !== undefined) return String(ORDINAL_WORDS[word]);
  const ordinalDigits = word.match(/^(\d+)(st|nd|rd|th)$/);
  if (ordinalDigits) return ordinalDigits[1];
  return word;
}

function tokenizeSearchText(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).map(normalizeSearchWord);
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i += 1) {
    const curr = [i];
    for (let j = 1; j <= lb; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[lb];
}

// Exact match, a prefix match either direction, or — for words long enough
// that a stray letter is meaningful rather than noise — a small edit
// distance, to tolerate near-misses from speech-to-text transcription.
function searchWordsMatch(queryWord, targetWord) {
  if (queryWord === targetWord) return true;
  if (queryWord.length < 3 || targetWord.length < 3) return false;
  if (targetWord.startsWith(queryWord) || queryWord.startsWith(targetWord)) return true;
  const maxDistance = queryWord.length <= 4 ? 1 : 2;
  return levenshteinDistance(queryWord, targetWord) <= maxDistance;
}

// True when every meaningful word in the (voice or typed) search phrase is
// present in the target text — via synonym, number-word normalization, or a
// close-enough spelling — rather than requiring an exact substring.
function matchesDestinationSearch(searchPhrase, targetText) {
  const queryWords = tokenizeSearchText(searchPhrase).filter((word) => !SEARCH_STOPWORDS.has(word));
  if (queryWords.length === 0) return true;
  const targetWords = tokenizeSearchText(targetText);
  if (targetWords.length === 0) return false;

  return queryWords.every((queryWord) => {
    const candidates = [queryWord, ...(DESTINATION_SYNONYMS[queryWord] || [])];
    return candidates.some((candidate) => targetWords.some((targetWord) => searchWordsMatch(candidate, targetWord)));
  });
}

function getRouteBounds(points, imageSize) {
  if (!points.length || !imageSize) return null;

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const routeWidth = Math.max(maxX - minX, 1);
  const routeHeight = Math.max(maxY - minY, 1);
  const padding = Math.max(80, Math.max(routeWidth, routeHeight) * 0.35);

  const x = Math.max(0, minX - padding);
  const y = Math.max(0, minY - padding);
  const right = Math.min(imageSize.width, maxX + padding);
  const bottom = Math.min(imageSize.height, maxY + padding);

  return {
    x,
    y,
    width: Math.max(right - x, 1),
    height: Math.max(bottom - y, 1),
  };
}

function RouteMap({ routeMap }) {
  if (!routeMap?.length) return null;

  return (
    <div className="route-map">
      <h3>Route map</h3>
      {routeMap.map((segment) => (
        <RouteMapSegment key={`${segment.floorId}-${segment.segmentIndex}`} segment={segment} />
      ))}
    </div>
  );
}

function RouteMapSegment({ segment }) {
  const [imageSize, setImageSize] = useState(null);
  const bounds = getRouteBounds(segment.points || [], imageSize);
  const pathData = segment.points?.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ') || '';
  const startPoint = segment.points?.[0];
  const endPoint = segment.points?.[segment.points.length - 1];
  const imageStyle =
    bounds && imageSize
      ? {
          width: `${(imageSize.width / bounds.width) * 100}%`,
          height: `${(imageSize.height / bounds.height) * 100}%`,
          left: `${(-bounds.x / bounds.width) * 100}%`,
          top: `${(-bounds.y / bounds.height) * 100}%`,
        }
      : undefined;
  const viewportStyle = bounds ? { aspectRatio: `${bounds.width} / ${bounds.height}` } : undefined;

  return (
    <figure className="route-map__segment">
      <figcaption>{segment.floorName}</figcaption>
      <div className="route-map__viewport" style={viewportStyle}>
        <img
          src={segment.imagePath}
          alt={`${segment.floorName} route map`}
          style={imageStyle}
          onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        />
        {bounds && (
          <svg className="route-map__overlay" viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} aria-hidden="true">
            {pathData && <path d={pathData} />}
            {startPoint && <circle className="route-map__point route-map__point--start" cx={startPoint.x} cy={startPoint.y} r="10" />}
            {endPoint && <circle className="route-map__point route-map__point--end" cx={endPoint.x} cy={endPoint.y} r="10" />}
          </svg>
        )}
      </div>
    </figure>
  );
}

function DestinationMap({ groups, originNode, originFloor, onSelectDestination }) {
  const visibleGroups = groups.filter((group) => group.floor?.imagePath);
  const hasOriginFloor = originNode && visibleGroups.some((group) => group.floorId === originNode.floorId);
  const mapGroups =
    originNode && originFloor?.imagePath && !hasOriginFloor
      ? [{ floorId: originNode.floorId, floor: originFloor, floorName: originFloor.name || 'Current floor', pois: [] }, ...visibleGroups]
      : visibleGroups;

  if (mapGroups.length === 0) {
    return <p className="muted">No floor maps are available for these destinations.</p>;
  }

  return (
    <div className="destination-map">
      {mapGroups.map((group) => (
        <DestinationMapFloor
          key={group.floorId}
          group={group}
          originNode={originNode?.floorId === group.floorId ? originNode : null}
          onSelectDestination={onSelectDestination}
        />
      ))}
    </div>
  );
}

function DestinationMapFloor({ group, originNode, onSelectDestination }) {
  const [imageSize, setImageSize] = useState(null);
  const [selectedPoi, setSelectedPoi] = useState(null);

  return (
    <figure className="destination-map__floor">
      <figcaption>{group.floorName}</figcaption>
      <div className="destination-map__viewport">
        <img
          src={group.floor.imagePath}
          alt={`${group.floorName} destination map`}
          onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        />
        {imageSize && (
          <div className="destination-map__overlay">
            {originNode && (
              <div
                className="destination-map__marker destination-map__marker--origin"
                style={{ left: `${(originNode.x / imageSize.width) * 100}%`, top: `${(originNode.y / imageSize.height) * 100}%` }}
              >
                <span className="sr-only">You are here</span>
              </div>
            )}
            {group.pois.map((poi) => {
              const node = poi.node;
              if (!node) return null;
              return (
                <button
                  key={poi.id}
                  type="button"
                  className="destination-map__marker destination-map__marker--destination"
                  style={{ left: `${(node.x / imageSize.width) * 100}%`, top: `${(node.y / imageSize.height) * 100}%` }}
                  onClick={() => setSelectedPoi(poi)}
                  aria-label={`Show ${poi.name}`}
                >
                  <span className="sr-only">{poi.name}</span>
                </button>
              );
            })}
            {selectedPoi?.node && (
              <div
                className="destination-map__callout"
                style={{
                  left: `${(selectedPoi.node.x / imageSize.width) * 100}%`,
                  top: `${(selectedPoi.node.y / imageSize.height) * 100}%`,
                }}
              >
                <strong>{selectedPoi.name}</strong>
                {selectedPoi.description && <span>{selectedPoi.description}</span>}
                <button type="button" className="primary" onClick={() => onSelectDestination(selectedPoi)}>
                  Get directions
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </figure>
  );
}

export default function Wayfind() {
  const { buildingId } = useParams();
  const [searchParams] = useSearchParams();
  const originNodeId = searchParams.get('from');

  const [showQrSplash, setShowQrSplash] = useState(Boolean(originNodeId));
  const [building, setBuilding] = useState(null);
  const [originNode, setOriginNode] = useState(null);
  const [originQrCode, setOriginQrCode] = useState(null);
  const [pois, setPois] = useState(null);
  const [floors, setFloors] = useState(null);
  const [nodes, setNodes] = useState(null);
  const [destinationSearch, setDestinationSearch] = useState('');
  const [destinationViewMode, setDestinationViewMode] = useState('list');
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechListening, setSpeechListening] = useState(false);
  const [speechError, setSpeechError] = useState('');
  const speechRecognitionRef = useRef(null);
  const [loadError, setLoadError] = useState(null);

  const [selectedPoiId, setSelectedPoiId] = useState(null);
  const [directions, setDirections] = useState(null);
  const [directionsLoading, setDirectionsLoading] = useState(false);
  const [directionsError, setDirectionsError] = useState(null);

  useEffect(() => {
    if (!originNodeId) {
      setShowQrSplash(false);
      return;
    }

    setShowQrSplash(true);
    const splashTimer = window.setTimeout(() => {
      setShowQrSplash(false);
    }, 2000);

    return () => window.clearTimeout(splashTimer);
  }, [originNodeId]);

  useEffect(() => {
    api.getBuilding(buildingId).then(setBuilding).catch((err) => setLoadError(err.message));
    api.listPois(buildingId).then(setPois).catch((err) => setLoadError(err.message));
    api.listFloors(buildingId).then(setFloors).catch((err) => setLoadError(err.message));
    api.listNodes(buildingId).then(setNodes).catch((err) => setLoadError(err.message));
    if (originNodeId) {
      api
        .listQrCodes(buildingId)
        .then((qrcodes) => setOriginQrCode(qrcodes.find((qr) => qr.originNodeId === originNodeId) || null))
        .catch((err) => setLoadError(err.message));
    }
  }, [buildingId, originNodeId]);

  useEffect(() => {
    setOriginNode(nodes?.find((n) => n.id === originNodeId) || null);
  }, [nodes, originNodeId]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSpeechSupported(Boolean(SpeechRecognition));
    return () => {
      speechRecognitionRef.current?.abort();
    };
  }, []);

  const originLabel = originQrCode?.label || originNode?.label || 'your current location';
  const originFloor = floors?.find((floor) => floor.id === originNode?.floorId) || null;
  const originFloorLabel = originFloor?.name ? originFloor.name.toUpperCase() : null;
  const destinationGroups = useMemo(() => {
    if (!pois || !floors || !nodes) return [];

    const normalizedSearch = destinationSearch.trim();
    const floorById = new Map(floors.map((floor) => [floor.id, floor]));
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const groupsByFloorId = new Map();

    for (const poi of pois) {
      const searchText = `${poi.name || ''} ${poi.description || ''}`;
      if (normalizedSearch && !matchesDestinationSearch(normalizedSearch, searchText)) continue;

      const node = nodeById.get(poi.nodeId);
      const floorId = node?.floorId || UNKNOWN_FLOOR_ID;
      const floor = floorById.get(floorId) || null;
      const floorName = floor?.name || (floorId === UNKNOWN_FLOOR_ID ? 'Floor not assigned' : floorId);

      if (!groupsByFloorId.has(floorId)) {
        groupsByFloorId.set(floorId, { floorId, floor, floorName, pois: [] });
      }

      groupsByFloorId.get(floorId).pois.push({ ...poi, node });
    }

    const originFloorId = originNode?.floorId || null;
    return [...groupsByFloorId.values()]
      .map((group) => ({
        ...group,
        pois: group.pois.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
      }))
      .sort((a, b) => {
        if (originFloorId) {
          if (a.floorId === originFloorId && b.floorId !== originFloorId) return -1;
          if (b.floorId === originFloorId && a.floorId !== originFloorId) return 1;
        }
        if (a.floorId === UNKNOWN_FLOOR_ID && b.floorId !== UNKNOWN_FLOOR_ID) return 1;
        if (b.floorId === UNKNOWN_FLOOR_ID && a.floorId !== UNKNOWN_FLOOR_ID) return -1;
        return compareFloors(a, b);
      });
  }, [destinationSearch, floors, nodes, originNode?.floorId, pois]);

  const destinationCount = destinationGroups.reduce((count, group) => count + group.pois.length, 0);

  async function handleSelectDestination(poi) {
    setSelectedPoiId(poi.id);
    setDirections(null);
    setDirectionsError(null);
    setDirectionsLoading(true);
    try {
      const result = await api.wayfind(buildingId, originNodeId, poi.id);
      setDirections(result);
    } catch (err) {
      setDirectionsError(err.message);
    } finally {
      setDirectionsLoading(false);
    }
  }

  function handleChooseAnother() {
    setSelectedPoiId(null);
    setDirections(null);
    setDirectionsError(null);
  }

  function handleVoiceSearch() {
    if (typeof window === 'undefined') return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (speechListening) {
      speechRecognitionRef.current?.stop();
      return;
    }

    const recognition = new SpeechRecognition();
    speechRecognitionRef.current = recognition;
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      setSpeechError('');
      setSpeechListening(true);
    };
    recognition.onresult = (event) => {
      const phrase = event.results?.[0]?.[0]?.transcript?.trim();
      if (phrase) setDestinationSearch(phrase);
    };
    recognition.onerror = () => {
      setSpeechError('Voice search was not available. You can still type your destination.');
    };
    recognition.onend = () => {
      setSpeechListening(false);
    };
    recognition.start();
  }

  if (!originNodeId) {
    return (
      <div className="page wayfind-page">
        <p className="error">
          This QR code is missing location information. Please scan the code posted at your location again, or ask
          for assistance.
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="page wayfind-page">
        <p className="error">{loadError}</p>
      </div>
    );
  }

  if (showQrSplash) {
    return (
      <div className="qr-splash" role="status" aria-live="polite" aria-label="QR code captured">
        <svg className="qr-splash__pin" viewBox="0 0 96 120" aria-hidden="true">
          <path d="M26,116 A22,5 0 1,0 70,116 A22,5 0 1,0 26,116 Z" fill="rgba(0,0,0,0.25)" />
          <path
            d="M48,0C21.5,0 0,21.5 0,48C0,80 48,120 48,120C48,120 96,80 96,48C96,21.5 74.5,0 48,0Z"
            fill="var(--gk-gold)"
          />
          <path
            d="M19,26 A14,9 0 1,0 47,26 A14,9 0 1,0 19,26 Z"
            fill="rgba(255,255,255,0.18)"
            transform="rotate(-25 33 26)"
          />
          <path d="M34,42 A14,14 0 1,0 62,42 A14,14 0 1,0 34,42 Z" fill="var(--gk-navy)" />
          <path
            d="M45,53 L51,53 Q54,53 54,56 L54,70 Q54,73 51,73 L45,73 Q42,73 42,70 L42,56 Q42,53 45,53 Z"
            fill="var(--gk-navy)"
          />
        </svg>
        <p className="qr-splash__wordmark">goldenkey</p>
        <h1>QR code captured</h1>
        <p className="qr-splash__message">
          Preparing destinations from {originLabel}
          {originFloorLabel ? ` — ${originFloorLabel}` : ''}.
        </p>
        <div className="qr-splash__dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  return (
    <div className="page wayfind-page">
      <h1>{building?.name || 'Loading...'}</h1>
      <p className="muted">
        You are at: <strong>{originLabel}</strong>
        {originFloorLabel && <span className="wayfind-floor-badge">{originFloorLabel}</span>}
      </p>

      {selectedPoiId && (directionsLoading || directions || directionsError) ? (
        <div className="card">
          {directionsLoading && (
            <div className="gk-spinner" role="status" aria-live="polite">
              <span className="gk-spinner__ring" aria-hidden="true" />
              <p className="gk-spinner__label">
                GoldenKey
                <span>Finding the best route...</span>
              </p>
            </div>
          )}
          {directionsError && <p className="error">{directionsError}</p>}
          {directions && (
            <>
              <h2>Directions to {directions.destination.name}</h2>
              {directions.destination.description && <p className="muted">{directions.destination.description}</p>}
              <RouteMap routeMap={directions.routeMap} />
              <ol className="wayfind-steps">
                {directions.instructions.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
              <div className="row no-print">
                <button type="button" onClick={handleChooseAnother}>
                  Choose a different destination
                </button>
              </div>
            </>
          )}
          {directionsError && (
            <div className="row no-print">
              <button type="button" onClick={handleChooseAnother}>
                Choose a different destination
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <h2>Where would you like to go?</h2>
          {pois === null || floors === null || nodes === null ? (
            <p className="muted">Loading destinations...</p>
          ) : pois.length === 0 ? (
            <p className="muted">No destinations have been configured for this building yet.</p>
          ) : (
            <>
              <div className="wayfind-search">
                <label className="sr-only" htmlFor="destination-search">Search destinations</label>
                <span className="wayfind-search__icon" aria-hidden="true" />
                <input
                  id="destination-search"
                  type="search"
                  value={destinationSearch}
                  onChange={(event) => {
                    setDestinationSearch(event.target.value);
                    setSpeechError('');
                  }}
                  placeholder="Search destinations"
                  autoComplete="off"
                />
                {speechSupported && (
                  <button
                    type="button"
                    className={`wayfind-search__mic${speechListening ? ' wayfind-search__mic--listening' : ''}`}
                    onClick={handleVoiceSearch}
                    aria-label={speechListening ? 'Stop voice search' : 'Search destinations by voice'}
                    aria-pressed={speechListening}
                  >
                    <span aria-hidden="true" />
                  </button>
                )}
              </div>
              <p className="sr-only" aria-live="polite">
                {speechListening ? 'Listening for a destination.' : speechError}
              </p>
              <button
                type="button"
                className="wayfind-map-toggle"
                onClick={() => setDestinationViewMode((mode) => (mode === 'map' ? 'list' : 'map'))}
                aria-pressed={destinationViewMode === 'map'}
              >
                {destinationViewMode === 'map' ? 'Show destination list' : 'Show destination map'}
              </button>
              {destinationCount === 0 ? (
                <p className="muted">No destinations match your search.</p>
              ) : destinationViewMode === 'map' ? (
                <DestinationMap
                  groups={destinationGroups}
                  originNode={originNode}
                  originFloor={originFloor}
                  onSelectDestination={handleSelectDestination}
                />
              ) : (
                <div className="destination-groups">
                  {destinationGroups.map((group) => (
                    <section key={group.floorId} className="destination-group" aria-labelledby={`floor-${group.floorId}`}>
                      <h3 id={`floor-${group.floorId}`}>{group.floorName}</h3>
                      <ul className="list">
                        {group.pois.map((poi) => (
                          <li key={poi.id} className="list-item destination-list-item">
                            <button type="button" className="destination-button" onClick={() => handleSelectDestination(poi)}>
                              <span>
                                <span className="destination-button__name">{poi.name}</span>
                                {poi.description && <span className="muted destination-button__description">{poi.description}</span>}
                              </span>
                              <span aria-hidden="true">&rsaquo;</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
