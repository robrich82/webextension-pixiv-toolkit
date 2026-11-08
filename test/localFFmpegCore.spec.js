import fs from 'fs';
import path from 'path';
import { localFFmpegCore } from '../config/localFFmpegCore';

// Mirrors the CopyPlugin pattern in config/webpack.background.config.js.
const dir = path.resolve(__dirname, '../node_modules/@ffmpeg/ffmpeg/dist/umd');
const shipped = fs.readdirSync(dir).filter(f => !f.endsWith('.map'));

describe('localFFmpegCore', () => {
  it('leaves no remote URL in the shipped @ffmpeg/ffmpeg files (Chrome Web Store MV3 policy)', () => {
    const out = shipped.map(f => localFFmpegCore(fs.readFileSync(path.join(dir, f)))).join('\n');

    expect(out).not.toMatch(/https?:\/\/(?!github\.com\/)/);
    expect(out).toContain('"ffmpeg-core.js"');
  });
});
