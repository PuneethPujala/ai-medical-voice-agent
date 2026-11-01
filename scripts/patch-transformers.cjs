const fs = require('fs');
const path = require('path');

const targetPath = path.resolve(
  __dirname,
  '../node_modules/@huggingface/transformers/dist/transformers.node.mjs'
);

const cjsPath = path.resolve(
  __dirname,
  '../node_modules/@huggingface/transformers/dist/transformers.node.cjs'
);

if (fs.existsSync(cjsPath) && !fs.existsSync(targetPath)) {
  const content = `import mod from "./transformers.node.cjs";

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
  try {
    fs.writeFileSync(targetPath, content, 'utf8');
    console.log('✓ Patched @huggingface/transformers/dist/transformers.node.mjs');
  } catch (err) {
    console.warn('Could not write transformers.node.mjs:', err.message);
  }
}
