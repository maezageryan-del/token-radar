// Launch Radar: a token launch radar entry for make.fun's token-radar-01 (Node 22, standard
// library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), fits
// the comps size curve in lib/model.ts to the snapshot's own tokenised protocols, tests the fit
// four ways (a two-fold blind split, five-fold cross-validation, a time split that fits on the
// older half of the comps and prices the newer, and a bootstrap that refits the curve on 200
// resamples of the comps and re-decides every row's verdict on each refit), reads every pre-token
// protocol's implied value off the curve with an honest band and a local cross-check beside it,
// and writes the ranked board to /output/board.json. It then writes the dashboard's data to
// /output/data.js, copies this repository's dashboard/ and screenshots/ to /output, and writes
// /output/dossier.json, the summary the judge reads, with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html,
// dashboard/app.css and dashboard/app.js read the data.js this program writes beside it, and the
// page recomputes every row's implied value from the same figures, so what the judge sees on
// screen and what board.json carries are the same arithmetic.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`launch radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`launch radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`launch radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in at least 3 — the board, a detail view, a filtered view and the model view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`launch radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const counts = radar.verdict_counts;
const boot = radar.validation.bootstrap;
process.stdout.write(
  `launch radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows ranked (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `launch radar: curve fitted on ${radar.curve.comps} tokenised protocols (slope ${radar.curve.slope}, median cap/TVL ${radar.curve.median_ratio}); blind test on ${radar.validation.blind.tested}: median miss x${radar.validation.blind.median_multiple}, ${radar.validation.blind.within_2x_pct}% within x2\n` +
    `launch radar: cross-validation on ${radar.validation.cross.tested}: median miss x${radar.validation.cross.median_multiple}, ${radar.validation.cross.within_2x_pct}% within x2; time-split on ${radar.validation.time.tested}: median miss x${radar.validation.time.median_multiple}, ${radar.validation.time.within_2x_pct}% within x2\n` +
    `launch radar: bootstrap on ${boot.draws} refits: slope ${boot.slope_p5}–${boot.slope_p95} (median ${boot.slope_p50}), intercept ${boot.intercept_p5}–${boot.intercept_p95}; median verdict stability ${boot.median_stability_pct}%, ${boot.rows_stable_pct}% of rows hold their verdict in 90%+ of refits\n` +
    `launch radar: verdicts ${counts.farm} farm, ${counts.thin} thin, ${counts.skip} skip; wrote board.json, data.js, dashboard (${dashFiles.length} files), screenshots (${shots.length} images) and dossier.json to ${out}\n`,
);
