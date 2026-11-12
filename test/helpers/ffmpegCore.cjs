/**
 * Runs the bundled FFmpeg.wasm core in a plain Node process, for test/ugoiraFrameTiming.spec.js.
 * The core is a web/worker build: the globals it looks for would confuse Vitest's own worker, so
 * the spec spawns this script instead of loading the core itself.
 *
 * stdin: { frames: number, conversions: [{ input: string, args: string[] }] }. Writes `frames`
 * 16x16 JPEGs named 000000.jpg, 000001.jpg, …, then runs each conversion on its input.txt.
 * stdout: one { code, starts, total } per conversion: the exit code, each video frame's start
 * and the output's length, in ms, from the core's ffprobe.
 */
const fs = require('fs');
const path = require('path');

Object.assign(globalThis, { self: globalThis, importScripts: () => {}, location: { href: 'file:///core/' } });

const COLORS = ['red', 'green', 'blue', 'yellow', 'magenta', 'cyan', 'white', 'black'];

const createFFmpegCore = require('@ffmpeg/core');
const wasmBinary = fs.readFileSync(path.join(path.dirname(require.resolve('@ffmpeg/core')), 'ffmpeg-core.wasm'));

/**
 * A fresh core, and the lines it prints. A core crashes after a few execs, so each job gets its own.
 * @template T
 * @param {(core: object, output: string[]) => T} job
 * @returns {Promise<T>}
 */
async function withCore(job) {
  const output = [];
  const core = await createFFmpegCore({
    wasmBinary,
    print: line => output.push(line),
    printErr: line => output.push(line)
  });
  core.setLogger(({ message }) => output.push(message));

  return job(core, output);
}

(async () => {
  const { frames, conversions } = JSON.parse(fs.readFileSync(0, 'utf8'));
  const names = Array.from({ length: frames }, (_, i) => `${String(i).padStart(6, '0')}.jpg`);
  const jpegs = await Promise.all(names.map((name, i) => withCore(core => {
    core.exec('-f', 'lavfi', '-i', `color=c=${COLORS[i % COLORS.length]}:s=16x16`, '-frames:v', '1', name);
    return core.FS.readFile(name);
  })));

  const results = [];
  for (const { input, args } of conversions) {
    results.push(await withCore((core, output) => {
      names.forEach((name, i) => core.FS.writeFile(name, jpegs[i]));
      core.FS.writeFile('input.txt', input);
      const code = core.exec(...args);

      if (code !== 0) {
        return { code, starts: [], total: null };
      }

      core.reset();
      output.length = 0;
      core.ffprobe('-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=pts_time,duration_time:format=duration',
        '-of', 'csv=p=0', args[args.length - 1]);
      const packets = [];
      let duration = NaN;
      for (const line of output.map(text => text.trim()).filter(Boolean)) {
        if (/^[^,]+,[^,]+$/.test(line)) {
          packets.push(line.split(',').map(value => Number(value) * 1000)); // N/A is NaN, which fails the spec
        } else if (/^([0-9.]+|N\/A)$/.test(line)) {
          duration = Number(line) * 1000;
        } else {
          throw new Error(`Unexpected ffprobe line: ${line}`);
        }
      }

      return {
        code,
        starts: packets.map(([pts]) => Math.round(pts)).sort((a, b) => a - b),
        // An APNG has no format duration (N/A), so its length is where its last frame ends.
        total: Math.round(Number.isNaN(duration) ? Math.max(...packets.map(([pts, length]) => pts + length)) : duration)
      };
    }));
  }

  process.stdout.write(JSON.stringify(results));
})().catch(error => {
  console.error(error);
  process.exit(1);
});
