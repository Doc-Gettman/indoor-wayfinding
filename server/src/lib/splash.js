// QR-scan splash screens. A building group owns the shared look (image,
// background, duration) plus default text; each building may override the
// text with its own (e.g. "Dallas Office" under the Kimley-Horn logo).

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
  const text = buildingSplashText || splash.text || '';
  if (!splash.imageUrl && !text) return null;
  return {
    imageUrl: splash.imageUrl || null,
    text,
    backgroundColor: splash.backgroundColor,
    durationSeconds: splash.durationSeconds,
  };
}
