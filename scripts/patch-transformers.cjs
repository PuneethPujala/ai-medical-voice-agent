/**
 * Automated Postinstall Compatibility Patch for @huggingface/transformers
 *
 * Problem:
 * In @huggingface/transformers@3.x (specifically v3.8.1), package.json exports:
 *   "node": { "import": "./dist/transformers.node.mjs", "require": "./dist/transformers.node.cjs" }
 * However, the npm package distribution omits transformers.node.mjs, causing Node ESM / Turbopack
 * to throw ERR_MODULE_NOT_FOUND when kokoro-js imports @huggingface/transformers.
 *
 * This script provides an idempotent, version-checked compatibility wrapper
 * that forwards ESM named exports to the distributed CommonJS bundle.
 */

const fs = require('fs');
const path = require('path');

const pkgJsonPath = path.resolve(
  __dirname,
  '../node_modules/@huggingface/transformers/package.json'
);

const targetPath = path.resolve(
  __dirname,
  '../node_modules/@huggingface/transformers/dist/transformers.node.mjs'
);

const cjsPath = path.resolve(
  __dirname,
  '../node_modules/@huggingface/transformers/dist/transformers.node.cjs'
);

const EXPECTED_WRAPPER_HEADER = '// @medvoice/kokoro-esm-compat-wrapper';

const WRAPPER_CONTENT = `${EXPECTED_WRAPPER_HEADER}
import mod from "./transformers.node.cjs";

export const {
  AutoTokenizer,
  AutoModel,
  StyleTextToSpeech2Model,
  StyleTextToSpeech2PreTrainedModel,
  Tensor,
  RawAudio,
  env,
  pipeline,
  AutoProcessor,
} = mod;

export default mod;
`;

function runPatch() {
  // If package is not installed (e.g. before initial npm install), exit gracefully
  if (!fs.existsSync(pkgJsonPath)) {
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  const version = pkg.version || 'unknown';

  // Verify package version compatibility (3.x line)
  if (!version.startsWith('3.')) {
    console.warn(`[patch-transformers] Warning: Installed @huggingface/transformers is version ${version} (expected 3.x). Skipping patch.`);
    return;
  }

  // If upstream fixed the bug and distributed real ESM, do not overwrite
  if (fs.existsSync(targetPath)) {
    const existing = fs.readFileSync(targetPath, 'utf8');
    if (existing.startsWith(EXPECTED_WRAPPER_HEADER)) {
      // Already patched idempotently
      return;
    }
    // File exists from upstream or custom build; do not clobber
    console.log(`[patch-transformers] transformers.node.mjs already exists (native upstream). No patch needed.`);
    return;
  }

  // Verify source CJS exists
  if (!fs.existsSync(cjsPath)) {
    console.error(`[patch-transformers] ERROR: Missing expected ${cjsPath}. Cannot apply ESM wrapper.`);
    process.exit(1);
  }

  // Verify expected CJS exports exist in transformers.node.cjs
  try {
    const cjsMod = require(cjsPath);
    const requiredExports = ['AutoTokenizer', 'StyleTextToSpeech2Model', 'Tensor', 'RawAudio', 'env'];
    const missing = requiredExports.filter((k) => !(k in cjsMod));
    if (missing.length > 0) {
      console.error(`[patch-transformers] ERROR: Missing critical exports in ${cjsPath}: ${missing.join(', ')}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`[patch-transformers] ERROR: Failed to load ${cjsPath}:`, err.message);
    process.exit(1);
  }

  // Write verified wrapper
  try {
    fs.writeFileSync(targetPath, WRAPPER_CONTENT, 'utf8');
    console.log(`✓ [patch-transformers] Successfully synthesized ESM compatibility wrapper for @huggingface/transformers@${version}`);
  } catch (err) {
    console.error(`[patch-transformers] ERROR: Failed to write ${targetPath}:`, err.message);
    process.exit(1);
  }
}

runPatch();
