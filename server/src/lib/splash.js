// QR-scan splash screens. A building group owns the shared look (image,
// background, duration) plus common text shown for every building (e.g. a
// company slogan); each building adds its own text shown beneath it (e.g.
// "Dallas Office"). Visitors see: image, then group text, then building text.

export const SPLASH_TEXT_MAX_LENGTH = 500;
export const SPLASH_DURATION_MIN = 1;
export const SPLASH_DURATION_MAX = 15;
export const SPLASH_DURATION_DEFAULT = 3;
export const DEFAULT_GROUP_SPLASH = {
  imageUrl: null,
  text: '',
  backgroundColor: '#ffffff',
  durationSeconds: SPLASH_DURATION_DEFAULT,
};

// The splash a visitor sees for a building, or null for the default
// GoldenKey splash (ungrouped building, or nothing to show).
export function effectiveSplash(group, buildingSplashText) {
  if (!group) return null;
  const splash = { ...DEFAULT_GROUP_SPLASH, ...group.splash };
  const groupText = splash.text || '';
  const buildingText = buildingSplashText || '';
  if (!splash.imageUrl && !groupText && !buildingText) return null;
  return {
    imageUrl: splash.imageUrl || null,
    groupText,
    buildingText,
    backgroundColor: splash.backgroundColor,
    durationSeconds: splash.durationSeconds,
  };
}
