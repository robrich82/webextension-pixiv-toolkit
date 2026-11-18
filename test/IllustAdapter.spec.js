/**
 * Which ugoira conversion IllustAdapter hands the download task: WebCodecs containers get no FFmpeg
 * command, the rest their preset.
 */
import IllustAdapter, { UGOIRA_FFMPEG_CLI_ARGS } from '@/options_page/modules/DownloadAdapters/Pixiv/IllustAdapter';
import UgoiraDownloadTask from '@/options_page/modules/DownloadTasks/Pixiv/UgoiraDownloadTask';
import IllustResource from '@/modules/PageResource/Pixiv/IllustResource';

const CUSTOM = '-f concat -i input.txt custom.gif';

/** The options the adapter creates the ugoira task with, for a click on `ugoiraConvertType`. */
function taskOptions(ugoiraConvertType) {
  const context = {
    id: '10000003',
    illustType: IllustResource.UGOIRA_TYPE,
    illustOriginalSrc: 'https://i.pximg.net/frames.zip',
    illustFrames: [{ file: '000000.jpg', delay: 100 }]
  };
  const adapter = new IllustAdapter('https://www.pixiv.net/artworks/10000003');
  adapter.context = context;

  adapter.createUgoiraDownloadTask(IllustResource.create(context), { ugoiraConvertType });

  return UgoiraDownloadTask.create.mock.calls[0][0];
}

beforeEach(() => {
  window.$app = { settings: { ugoiraCustomFFmpegCommand: CUSTOM, ugoiraRenameRule: '{id}' } };
  vi.spyOn(UgoiraDownloadTask, 'create').mockReturnValue({});
});

afterEach(() => {
  delete window.$app;
  vi.restoreAllMocks();
});

describe('createUgoiraDownloadTask', () => {
  it('encodes WEBM through WebCodecs, without an FFmpeg command', () => {
    expect(taskOptions('webm')).toMatchObject({
      id: 'pixiv_illust:10000003:webm', convertType: 'webm', ffmpegCommandArgs: ''
    });
  });

  it('still converts MP4 with its FFmpeg preset', () => {
    expect(taskOptions('mp4')).toMatchObject({
      convertType: 'mp4', ffmpegCommandArgs: UGOIRA_FFMPEG_CLI_ARGS.ugoiraFFmpegMP4CliArgs
    });
  });

  it.each([undefined, 'constructor', 'toString'])('runs the custom command for %s', type => {
    expect(taskOptions(type)).toMatchObject({
      id: 'pixiv_illust:10000003:custom', convertType: 'CUSTOM', ffmpegCommandArgs: CUSTOM
    });
  });
});
