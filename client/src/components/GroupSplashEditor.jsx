import { useRef, useState } from 'react';
import { api } from '../api.js';
import CustomSplash from './CustomSplash.jsx';

const TEXT_MAX_LENGTH = 500;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DEFAULTS = { imageUrl: null, text: '', backgroundColor: '#ffffff', durationSeconds: 3 };
const GROUP_DEFAULT_PREVIEW = '__group_default__';

// Admin editor for a group's custom QR-scan splash screen. The group owns the
// shared look (image, background, duration) and default text; each building
// in the group can have its own text (e.g. "Dallas Office") that replaces
// the default. Includes a live phone-sized preview per building.
// Text/color/duration/building texts save together; the image uploads (and
// saves) immediately on selection.
export default function GroupSplashEditor({ group, buildings, onSaved, onBuildingsSaved }) {
  const saved = { ...DEFAULTS, ...group.splash };
  const [text, setText] = useState(saved.text);
  const [backgroundColor, setBackgroundColor] = useState(saved.backgroundColor);
  const [durationSeconds, setDurationSeconds] = useState(String(saved.durationSeconds));
  const [buildingTextEdits, setBuildingTextEdits] = useState({});
  const [previewId, setPreviewId] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const fileInputRef = useRef(null);

  const buildingText = (b) => buildingTextEdits[b.id] ?? (b.splashText || '');
  const dirtyBuildings = buildings.filter((b) => buildingText(b).trim() !== (b.splashText || ''));
  const duration = Number(durationSeconds);
  const durationValid = Number.isFinite(duration) && duration >= 1 && duration <= 15;
  const groupDirty =
    text.trim() !== saved.text || backgroundColor.toLowerCase() !== saved.backgroundColor || duration !== saved.durationSeconds;
  const dirty = groupDirty || dirtyBuildings.length > 0;
  const active = Boolean(saved.imageUrl || saved.text || buildings.some((b) => b.splashText));

  // Preview the first building by default: that's what most visitors see.
  const previewBuilding =
    previewId === GROUP_DEFAULT_PREVIEW ? null : buildings.find((b) => b.id === previewId) || buildings[0] || null;
  const previewText = (previewBuilding && buildingText(previewBuilding).trim()) || text.trim();
  const previewSplash = { imageUrl: saved.imageUrl, text: previewText, backgroundColor };
  const previewHasContent = Boolean(previewSplash.imageUrl || previewSplash.text);

  async function run(label, action, successMessage) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (successMessage) setNotice(successMessage);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  function handleSave(e) {
    e.preventDefault();
    run(
      'save',
      async () => {
        if (groupDirty) {
          onSaved(await api.updateGroupSplash(group.id, { text: text.trim(), backgroundColor, durationSeconds: duration }));
        }
        if (dirtyBuildings.length) {
          await Promise.all(dirtyBuildings.map((b) => api.updateBuildingSplashText(b.id, buildingText(b).trim())));
          setBuildingTextEdits({});
          onBuildingsSaved();
        }
      },
      'Saved.',
    );
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      setError('Choose a PNG, JPEG, or WEBP image.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('That image is over 5 MB. Please use a smaller image so it loads quickly on phones.');
      return;
    }
    run('upload', async () => onSaved(await api.uploadGroupSplashImage(group.id, file)), 'Image uploaded.');
  }

  function handleRemoveImage() {
    if (!confirm('Remove the splash image?')) return;
    run('remove', async () => onSaved(await api.removeGroupSplashImage(group.id)), 'Image removed.');
  }

  return (
    <details className="splash-editor">
      <summary>
        Splash screen{' '}
        <span className="muted">
          {active ? '— custom splash shown after scanning a QR code' : '— using the default GoldenKey splash'}
        </span>
      </summary>
      <div className="splash-editor__body">
        <form className="splash-editor__fields" onSubmit={handleSave}>
          <p className="muted" style={{ marginTop: 0 }}>
            Shown to visitors right after they scan a QR code in any building in this group. The image and colors are
            shared by every building; each building can have its own text. With no image and no text, visitors see the
            default GoldenKey splash.
          </p>

          <div className="splash-editor__field">
            <span className="splash-editor__label">Image (all buildings)</span>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={Boolean(busy)}>
                {busy === 'upload' ? 'Uploading...' : saved.imageUrl ? 'Replace image' : 'Upload image'}
              </button>
              {saved.imageUrl && (
                <button type="button" className="danger" onClick={handleRemoveImage} disabled={Boolean(busy)}>
                  {busy === 'remove' ? 'Removing...' : 'Remove image'}
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} hidden />
            </div>
            <span className="muted">PNG, JPEG, or WEBP, up to 5 MB. A logo or banner works best.</span>
          </div>

          <div className="splash-editor__field">
            <span className="splash-editor__label">Text for each building</span>
            {buildings.length === 0 ? (
              <span className="muted">No buildings in this group yet.</span>
            ) : (
              <div className="splash-editor__buildings">
                {buildings.map((b) => (
                  <label key={b.id} className="splash-editor__building">
                    <span>{b.name}</span>
                    <textarea
                      value={buildingText(b)}
                      onChange={(e) => setBuildingTextEdits((prev) => ({ ...prev, [b.id]: e.target.value }))}
                      onFocus={() => setPreviewId(b.id)}
                      maxLength={TEXT_MAX_LENGTH}
                      rows={2}
                      placeholder={text.trim() ? `Uses default text: ${text.trim()}` : 'e.g. Dallas Office'}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>

          <label className="splash-editor__field">
            <span className="splash-editor__label">Default text</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={() => setPreviewId(GROUP_DEFAULT_PREVIEW)}
              maxLength={TEXT_MAX_LENGTH}
              rows={2}
              placeholder="Optional, e.g. Welcome! Let's get you where you're going."
            />
            <span className="muted">Shown for any building above that's left blank, including buildings added later.</span>
          </label>

          <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
            <label className="row" style={{ gap: 6 }}>
              <span className="splash-editor__label">Background</span>
              <input type="color" value={backgroundColor} onChange={(e) => setBackgroundColor(e.target.value)} />
            </label>
            <label className="row" style={{ gap: 6 }}>
              <span className="splash-editor__label">Show for</span>
              <input
                type="number"
                min="1"
                max="15"
                step="0.5"
                value={durationSeconds}
                onChange={(e) => setDurationSeconds(e.target.value)}
                style={{ width: 70 }}
              />
              <span className="muted">seconds</span>
            </label>
          </div>
          {!durationValid && <div className="error">Show for must be between 1 and 15 seconds.</div>}

          <div className="row">
            <button type="submit" className="primary" disabled={!dirty || !durationValid || Boolean(busy)}>
              {busy === 'save' ? 'Saving...' : 'Save splash screen'}
            </button>
            {notice && !dirty && <span className="muted">{notice}</span>}
          </div>
          {error && <div className="error">{error}</div>}
        </form>

        <div className="splash-editor__preview">
          <label className="splash-editor__field">
            <span className="splash-editor__label">Preview as</span>
            <select
              value={previewBuilding ? previewBuilding.id : GROUP_DEFAULT_PREVIEW}
              onChange={(e) => setPreviewId(e.target.value)}
              style={{ maxWidth: 212 }}
            >
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
              <option value={GROUP_DEFAULT_PREVIEW}>Default text</option>
            </select>
          </label>
          <div className="splash-editor__phone">
            {previewHasContent ? (
              <CustomSplash splash={previewSplash} preview />
            ) : (
              <div className="splash-editor__empty muted">
                No image or text yet — this building shows the default GoldenKey splash.
              </div>
            )}
          </div>
        </div>
      </div>
    </details>
  );
}
