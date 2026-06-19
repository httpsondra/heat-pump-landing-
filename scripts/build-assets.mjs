/**
 * build-assets.mjs
 * --------------------------------------------------------------------------
 * Připraví všechny media assety pro landing page z jediného zdrojového videa.
 *
 * Zdroj:  ../Vaillant - tepelne cerpadlo video.mp4  (10 s, H.264, bílé studio)
 *
 * Výstup:
 *   videos/heat-pump-exploded.mp4          – re-encode + faststart (mobil fallback)
 *   images/sequence/heat-pump-0001.jpg …   – snímky pro scroll-scrub na canvasu
 *   images/sequence/manifest.json          – { count, pattern, width, height }
 *   images/heat-pump-fallback.jpg          – statický fallback (reduced-motion)
 *
 * Spuštění:  npm install && npm run build
 * --------------------------------------------------------------------------
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readdir, rm, access, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const run = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Zdrojové video leží o úroveň výš (Táta - web/), ne v site/.
const SOURCE_CANDIDATES = [
  path.resolve(ROOT, '..', 'New-tepelne cerpadlo.mp4'),
  path.resolve(ROOT, '..', 'Vaillant - tepelne cerpadlo video_gwr_video_mvp.mp4'),
  path.resolve(ROOT, '..', 'Vaillant - tepelne cerpadlo video.mp4'),
  path.resolve(ROOT, 'videos', 'source.mp4'),
];

// --- konfigurace ----------------------------------------------------------
const FPS = 15;          // 10 s × 15 fps ≈ 150 snímků – plynulý scrub, rozumná váha
const WIDTH = 1280;      // šířka snímků i fallback videa (výška dopočítána, sudá)
const JPEG_Q = 5;        // ffmpeg -q:v (2 = nejlepší, 31 = nejhorší)

const SEQ_DIR = path.join(ROOT, 'images', 'sequence');
const VIDEO_OUT = path.join(ROOT, 'videos', 'heat-pump-exploded.mp4');
const FALLBACK_OUT = path.join(ROOT, 'images', 'heat-pump-fallback.jpg');

function log(step, msg) {
  console.log(`\x1b[36m[${step}]\x1b[0m ${msg}`);
}

async function ffmpeg(args) {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static nevrátil cestu k binárce. Spusť `npm install`.');
  }
  return run(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 64 });
}

async function findSource() {
  for (const p of SOURCE_CANDIDATES) {
    try {
      await access(p);
      return p;
    } catch {
      /* zkus další */
    }
  }
  throw new Error(
    'Nenašel jsem zdrojové video. Očekávám:\n  ' + SOURCE_CANDIDATES.join('\n  ')
  );
}

async function main() {
  const SOURCE = await findSource();
  log('zdroj', SOURCE);

  // 1) Re-encode videa pro web (faststart) – použije se jako mobil/loop fallback.
  await mkdir(path.dirname(VIDEO_OUT), { recursive: true });
  log('video', 'Re-encode + faststart → ' + path.relative(ROOT, VIDEO_OUT));
  await ffmpeg([
    '-y',
    '-i', SOURCE,
    '-vf', `scale=${WIDTH}:-2`,
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    '-crf', '23',
    '-an',                       // landing page video je bez zvuku
    '-movflags', '+faststart',
    VIDEO_OUT,
  ]);

  // 2) Extrakce snímkové sekvence pro scroll-scrub.
  if (existsSync(SEQ_DIR)) await rm(SEQ_DIR, { recursive: true, force: true });
  await mkdir(SEQ_DIR, { recursive: true });
  log('sekvence', `Extrakce snímků @ ${FPS} fps, šířka ${WIDTH}px …`);
  await ffmpeg([
    '-y',
    '-i', SOURCE,
    '-vf', `fps=${FPS},scale=${WIDTH}:-2`,
    '-q:v', String(JPEG_Q),
    path.join(SEQ_DIR, 'heat-pump-%04d.jpg'),
  ]);

  const frames = (await readdir(SEQ_DIR))
    .filter((f) => /^heat-pump-\d+\.jpg$/.test(f))
    .sort();
  if (frames.length === 0) throw new Error('Extrakce snímků selhala – žádné soubory.');

  // Zjisti reálné rozměry prvního snímku (kvůli canvas poměru stran).
  const probe = await ffmpeg([
    '-i', path.join(SEQ_DIR, frames[0]),
    '-hide_banner',
  ]).catch((e) => ({ stderr: String(e.stderr || e) }));
  const dim = /,\s(\d+)x(\d+)/.exec(probe.stderr || '');
  const width = dim ? Number(dim[1]) : WIDTH;
  const height = dim ? Number(dim[2]) : Math.round((WIDTH * 9) / 16);

  const manifest = {
    count: frames.length,
    pattern: 'heat-pump-{n}.jpg', // {n} = 4místné číslo od 0001
    pad: 4,
    width,
    height,
    fps: FPS,
  };
  await writeFile(
    path.join(SEQ_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  log('sekvence', `${frames.length} snímků, ${width}×${height}, manifest.json zapsán`);

  // 3) Statický fallback – snímek z konce (rozložený stav) působí nejzajímavěji.
  const fallbackFrame = frames[Math.min(frames.length - 1, Math.round(frames.length * 0.92))];
  await copyFile(path.join(SEQ_DIR, fallbackFrame), FALLBACK_OUT);
  log('fallback', `${fallbackFrame} → ` + path.relative(ROOT, FALLBACK_OUT));

  console.log('\n\x1b[32m✓ Hotovo.\x1b[0m Assety jsou připravené, web je teď čistě statický.');
}

main().catch((err) => {
  console.error('\n\x1b[31m✗ Build selhal:\x1b[0m', err.message);
  process.exit(1);
});
