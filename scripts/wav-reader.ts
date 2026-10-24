import * as fs from "fs";

export function readWavFile(filePath: string): { samples: Float32Array; sampleRate: number } {
  const buffer = fs.readFileSync(filePath);

  // Validate RIFF header
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`Invalid WAV file: ${filePath}`);
  }

  let offset = 12;
  let audioFormat = 1; // 1 = PCM integer, 3 = IEEE float
  let numChannels = 1;
  let sampleRate = 16000;
  let bitsPerSample = 16;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset < buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    offset += 8;

    if (chunkId === "fmt ") {
      audioFormat = buffer.readUInt16LE(offset);
      numChannels = buffer.readUInt16LE(offset + 2);
      sampleRate = buffer.readUInt32LE(offset + 4);
      bitsPerSample = buffer.readUInt16LE(offset + 14);
      offset += chunkSize;
    } else if (chunkId === "data") {
      dataOffset = offset;
      dataSize = chunkSize;
      break;
    } else {
      offset += chunkSize;
    }
  }

  if (dataOffset === 0) {
    throw new Error(`No data chunk found in WAV: ${filePath}`);
  }

  let samples: Float32Array;

  if (audioFormat === 3 && bitsPerSample === 32) {
    // 32-bit float
    const floatCount = Math.floor(dataSize / 4);
    const rawFloats = new Float32Array(
      buffer.buffer,
      buffer.byteOffset + dataOffset,
      floatCount
    );
    if (numChannels === 1) {
      samples = new Float32Array(rawFloats);
    } else {
      // Average channels to mono
      samples = new Float32Array(floatCount / numChannels);
      for (let i = 0, j = 0; i < samples.length; i++, j += numChannels) {
        let sum = 0;
        for (let ch = 0; ch < numChannels; ch++) sum += rawFloats[j + ch];
        samples[i] = sum / numChannels;
      }
    }
  } else if (audioFormat === 1 && bitsPerSample === 16) {
    // 16-bit integer PCM
    const intCount = Math.floor(dataSize / 2);
    const rawInts = new Int16Array(
      buffer.buffer,
      buffer.byteOffset + dataOffset,
      intCount
    );
    if (numChannels === 1) {
      samples = new Float32Array(intCount);
      for (let i = 0; i < intCount; i++) {
        samples[i] = rawInts[i] / 32768.0;
      }
    } else {
      samples = new Float32Array(intCount / numChannels);
      for (let i = 0, j = 0; i < samples.length; i++, j += numChannels) {
        let sum = 0;
        for (let ch = 0; ch < numChannels; ch++) sum += rawInts[j + ch];
        samples[i] = (sum / numChannels) / 32768.0;
      }
    }
  } else {
    throw new Error(`Unsupported WAV encoding: format=${audioFormat}, bits=${bitsPerSample}`);
  }

  return { samples, sampleRate };
}
