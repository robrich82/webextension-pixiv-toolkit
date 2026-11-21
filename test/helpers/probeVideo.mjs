import fs from 'node:fs';
import { ALL_FORMATS, BufferSource, EncodedPacketSink, Input } from 'mediabunny';

/**
 * Reads a saved video's container in Node, for the e2e tests: its codec, how many frames it has
 * and when each starts, and its duration, in seconds.
 * @param {string} file
 * @returns {Promise<{ codec: string, timestamps: number[], duration: number }>}
 */
export async function probeVideo(file) {
  const input = new Input({ source: new BufferSource(fs.readFileSync(file)), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  const timestamps = [];

  for await (const packet of new EncodedPacketSink(track).packets()) {
    timestamps.push(packet.timestamp);
  }

  return { codec: track.codec, timestamps: timestamps.sort((a, b) => a - b), duration: await input.computeDuration() };
}
