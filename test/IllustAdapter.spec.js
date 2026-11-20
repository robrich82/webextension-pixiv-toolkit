/**
 * Which ugoira conversion IllustAdapter hands the download task: WebCodecs containers get no FFmpeg
 * command but their codec setting, the rest their preset.
 */
import { codecSettingKey } from '@/options_page/modules/UgoiraEncoders/video';
import IllustAdapter from '@/options_page/modules/DownloadAdapters/Pixiv/IllustAdapter';
import UgoiraDownloadTask from '@/options_page/modules/DownloadTasks/Pixiv/UgoiraDownloadTask';
import IllustResource from '@/modules/PageResource/Pixiv/IllustResource';

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
  window.$app = { settings: { ugoiraRenameRule: '{id}' } };
  vi.spyOn(UgoiraDownloadTask, 'create').mockReturnValue({});
});

afterEach(() => {
  delete window.$app;
  vi.restoreAllMocks();
});

describe('createUgoiraDownloadTask', () => {
  it.each(['webm', 'mp4', 'mov', 'mkv'])('encodes %s through WebCodecs, without an FFmpeg command', type => {
    expect(taskOptions(type)).toMatchObject({
      id: `pixiv_illust:10000003:${type}`, convertType: type, ffmpegCommandArgs: ''
    });
  });

  it('saves only the frames zip for DL Zip, without an FFmpeg command', () => {
    expect(taskOptions('zip')).toMatchObject({ convertType: 'zip', ffmpegCommandArgs: '' });
  });

  it.each(['gif', 'apng'])('encodes %s in the browser, without an FFmpeg command', type => {
    expect(taskOptions(type)).toMatchObject({ id: `pixiv_illust:10000003:${type}`, convertType: type, ffmpegCommandArgs: '' });
  });

  it.each(['webm', 'mp4', 'mov', 'mkv'])('hands a %s task the codec its setting names', type => {
    window.$app.settings[codecSettingKey(type)] = 'vp8';

    expect(taskOptions(type)).toMatchObject({ convertType: type, codec: 'vp8' });
  });

  // An inherited key such as 'constructor' is not a container.
  it.each([undefined, 'constructor', 'toString'])('refuses %s, which names no format', type => {
    expect(() => taskOptions(type)).toThrow(`Unknown ugoira convert type: ${type}`);
  });
});
