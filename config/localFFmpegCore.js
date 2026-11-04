'use strict'

/**
 * @ffmpeg/ffmpeg's worker defaults coreURL to a CDN copy on unpkg. We always
 * pass a local coreURL, but the Chrome Web Store flags the URL itself as
 * remotely hosted code, so point the default at the packaged core instead.
 * importScripts resolves it relative to the worker, i.e. lib/ffmpeg/.
 */
const CDN_CORE_URL = /https:\/\/unpkg\.com\/@ffmpeg\/core@[^"'`]+\/dist\/umd\/ffmpeg-core\.js/g;

function localFFmpegCore(content) {
  return content.toString().replace(CDN_CORE_URL, 'ffmpeg-core.js');
}

module.exports = { localFFmpegCore };
