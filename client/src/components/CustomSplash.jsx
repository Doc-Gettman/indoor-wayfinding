// A building group's custom post-scan splash screen (image + text on a chosen
// background). Used by the visitor Wayfind page and by the admin preview on
// the Groups page, so what admins preview is exactly what visitors see.

function readableTextColor(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!match) return '#111111';
  const n = parseInt(match[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? '#111111' : '#ffffff';
}

export default function CustomSplash({ splash, onImageSettled, onContinue, preview = false }) {
  const backgroundColor = splash.backgroundColor || '#ffffff';
  const color = readableTextColor(backgroundColor);
  return (
    <div
      className={`custom-splash${preview ? ' custom-splash--preview' : ''}`}
      style={{ backgroundColor, color }}
      role={preview ? undefined : 'status'}
      aria-live={preview ? undefined : 'polite'}
    >
      {splash.imageUrl && (
        <img
          className="custom-splash__image"
          src={splash.imageUrl}
          alt=""
          onLoad={onImageSettled}
          onError={onImageSettled}
        />
      )}
      {splash.text && <p className="custom-splash__text">{splash.text}</p>}
      <div className="custom-splash__dots" aria-hidden="true">
        <span style={{ background: color }} />
        <span style={{ background: color }} />
        <span style={{ background: color }} />
      </div>
      {onContinue && (
        <button type="button" className="custom-splash__continue" style={{ color, borderColor: color }} onClick={onContinue}>
          Continue
        </button>
      )}
    </div>
  );
}
