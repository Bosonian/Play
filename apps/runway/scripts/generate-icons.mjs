// Rasterizes assets/icon-foreground.svg + assets/icon-background.svg into
// every Android icon/splash PNG the Capacitor template layout expects.
// Run with: node scripts/generate-icons.mjs (from apps/runway/).
//
// Why a script instead of a one-off image tool: the SVGs in assets/ are the
// only committed source of truth for Runway's icon. Regenerating from them
// is what keeps every density in sync after a motif tweak, instead of
// hand-exporting ~25 PNGs one at a time.
//
// sharp renders SVG at a given `density` (DPI). An SVG authored with
// viewBox="0 0 108 108" is 108 CSS px wide at the SVG-standard 96 DPI, so to
// rasterize it at N output pixels we ask for density = 96 * (N / 108) and
// then resize precisely to N — the density step keeps strokes crisp instead
// of upscaling a low-res raster.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(ROOT, 'assets');
const RES_DIR = path.join(ROOT, 'android/app/src/main/res');

const FOREGROUND_SVG = path.join(ASSETS_DIR, 'icon-foreground.svg');
const BACKGROUND_SVG = path.join(ASSETS_DIR, 'icon-background.svg');
const SOURCE_VIEWBOX = 108;

// Must match the <rect fill="..."> in assets/icon-background.svg — used for
// the splash canvas, which is generated directly (a plain filled rectangle)
// rather than by rasterizing the background SVG a second time.
const BG_COLOR = '#020617';

// Adaptive-icon foreground layer: mipmap-<density>/ic_launcher_foreground.png.
// Standard Android export sizes for a 108dp canvas at each density bucket.
const ADAPTIVE_FOREGROUND_PX = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

// Legacy (pre-Android-8) launcher icon: mipmap-<density>/ic_launcher.png and
// ic_launcher_round.png. Rendering the same 108-viewBox SVGs at these
// smaller sizes reproduces the template's existing padding (the motif sits
// inside its safe zone either way), so legacy icons look like a scaled-down
// version of the adaptive one rather than a separately-composed asset.
const LEGACY_ICON_PX = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

// drawable-port-<density>/splash.png — matches the dimensions already
// present in the Capacitor template (verified against the existing PNGs
// before this script replaced them). drawable-land-<density> is the same
// pair swapped (device rotated). drawable/splash.png (no qualifier) is the
// density-less fallback Android falls back to; the template's copy was
// 480x320, i.e. the land-mdpi size, so that's reused here too.
const SPLASH_PORTRAIT_PX = {
  mdpi: [320, 480],
  hdpi: [480, 800],
  xhdpi: [720, 1280],
  xxhdpi: [960, 1600],
  xxxhdpi: [1280, 1920],
};
const SPLASH_DEFAULT_PX = [480, 320];

// Fraction of the splash canvas's shorter side the motif occupies. The
// foreground SVG's own drawn strokes already sit inside ~66% of its 108
// viewBox (the adaptive-icon safe zone), so rendering it into a box this
// size keeps the on-screen motif a similar, centered, non-overwhelming size
// rather than filling the whole splash screen edge to edge.
const SPLASH_MOTIF_FRACTION = 0.45;

function densityFor(targetPx) {
  return 96 * (targetPx / SOURCE_VIEWBOX);
}

async function rasterizeSvg(svgPath, targetPx) {
  const svg = await readFile(svgPath);
  return sharp(svg, { density: densityFor(targetPx) })
    .resize(targetPx, targetPx, { fit: 'fill' })
    .png()
    .toBuffer();
}

async function circleMask(px) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"><circle cx="${px / 2}" cy="${px / 2}" r="${px / 2}" fill="#fff"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function writePng(buffer, relativePath) {
  const outPath = path.join(RES_DIR, relativePath);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, buffer);
  const meta = await sharp(buffer).metadata();
  console.log(`  ${relativePath}  (${meta.width}x${meta.height})`);
}

async function generateAdaptiveForeground() {
  console.log('Adaptive icon foreground (mipmap-*/ic_launcher_foreground.png):');
  for (const [density, px] of Object.entries(ADAPTIVE_FOREGROUND_PX)) {
    const buffer = await rasterizeSvg(FOREGROUND_SVG, px);
    await writePng(buffer, `mipmap-${density}/ic_launcher_foreground.png`);
  }
}

async function generateLegacyIcons() {
  console.log('Legacy icons (mipmap-*/ic_launcher.png, ic_launcher_round.png):');
  for (const [density, px] of Object.entries(LEGACY_ICON_PX)) {
    const [bg, fg] = await Promise.all([rasterizeSvg(BACKGROUND_SVG, px), rasterizeSvg(FOREGROUND_SVG, px)]);
    const square = await sharp(bg).composite([{ input: fg }]).png().toBuffer();
    await writePng(square, `mipmap-${density}/ic_launcher.png`);

    const mask = await circleMask(px);
    const round = await sharp(square).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    await writePng(round, `mipmap-${density}/ic_launcher_round.png`);
  }
}

async function makeSplash(width, height) {
  const motifPx = Math.round(Math.min(width, height) * SPLASH_MOTIF_FRACTION);
  const motif = await rasterizeSvg(FOREGROUND_SVG, motifPx);
  const left = Math.round((width - motifPx) / 2);
  const top = Math.round((height - motifPx) / 2);
  return sharp({ create: { width, height, channels: 4, background: BG_COLOR } })
    .composite([{ input: motif, left, top }])
    .png()
    .toBuffer();
}

async function generateSplashScreens() {
  console.log('Splash screens (drawable*/splash.png):');
  for (const [density, [w, h]] of Object.entries(SPLASH_PORTRAIT_PX)) {
    const portrait = await makeSplash(w, h);
    await writePng(portrait, `drawable-port-${density}/splash.png`);

    const landscape = await makeSplash(h, w);
    await writePng(landscape, `drawable-land-${density}/splash.png`);
  }
  const [dw, dh] = SPLASH_DEFAULT_PX;
  const fallback = await makeSplash(dw, dh);
  await writePng(fallback, 'drawable/splash.png');
}

async function main() {
  console.log(`Reading source SVGs from ${path.relative(ROOT, ASSETS_DIR)}/`);
  await generateAdaptiveForeground();
  await generateLegacyIcons();
  await generateSplashScreens();
  console.log('Done. Background color for the adaptive icon (values/ic_launcher_background.xml) is edited by hand, not by this script — verify it still matches BG_COLOR above.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
