import EpisodeParser from '../src/modules/Parser/PixivComic/EpisodeParser';
import { decrypteImage } from '../src/modules/Parser/PixivComic/ImageDecrypte';
import { installFetch } from './doubles/fetch';

// A canvas job node can't run; decrypteImage.spec.js covers it.
vi.mock('../src/modules/Parser/PixivComic/ImageDecrypte', () => ({ decrypteImage: vi.fn() }));

import episode from './fixtures/pixivComic/episode.json';

const clone = fixture => JSON.parse(JSON.stringify(fixture));

const contextUrl = id => `https://comic.pixiv.net/api/app/episodes/${id}/read_v4`;
const viewerUrl = id => `https://comic.pixiv.net/viewer/stories/${id}`;

const parse = async (id, body) => {
  const fetchFake = installFetch({ [contextUrl(id)]: body });
  const parser = EpisodeParser.create(viewerUrl(id));

  await parser.parserContext();

  return { context: parser.getContext(), fetchFake };
};

describe('parseUrl', () => {
  test('takes the episode id out of a viewer url', () => {
    const parser = EpisodeParser.create(viewerUrl('70000001'));

    parser.parseUrl(parser.url);

    expect(parser.getContext().id).toBe('70000001');
  });

  test('throws on a comic url that is not an episode', () => {
    const parser = EpisodeParser.create('https://comic.pixiv.net/works/80000001');

    expect(() => parser.parseUrl(parser.url)).toThrow("Can't parse the episode id out");
  });
});

describe('an episode', () => {
  test('asks the read_v4 endpoint for the id in the url', async () => {
    const { fetchFake } = await parse('70000001', clone(episode));

    expect(fetchFake.mock.calls[0][0]).toBe(contextUrl('70000001'));
  });

  test('signs the request the way the comic api expects', async () => {
    // Without the hash, the time it was made from, and the pixivcomic marker,
    // the api answers with an error rather than the pages.
    const { fetchFake } = await parse('70000001', clone(episode));

    const { headers, credentials } = fetchFake.mock.calls[0][1];

    expect(credentials).toBe('include');
    expect(headers['x-requested-with']).toBe('pixivcomic');
    expect(headers['x-client-hash']).toMatch(/^[\da-f]{64}$/);
    expect(headers['x-client-time']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  test('produces the context the name formatter reads', async () => {
    const { context } = await parse('70000001', clone(episode));

    expect(context).toMatchObject({
      id: 70000001,
      title: 'the long walk home',
      subTitle: 'part two',
      numberingTitle: '#12',
      workId: 80000001,
      workTitle: 'the long walk',
      cover: episode.data.reading_episode.thumbnail_image_url,
      totalPages: 3,
    });
  });

  test('keeps each page whole, since the decrypter needs its key and grid', async () => {
    // Unlike the pixiv parsers, the pages here are objects rather than urls:
    // the images come back scrambled and the key, gridsize and dimensions are
    // what ImageDecrypte unscrambles them with.
    const { context } = await parse('70000001', clone(episode));

    expect(context.pages).toEqual(episode.data.reading_episode.pages);
  });

  test('appends a resolver so the page can preview the encrypted images', async () => {
    const { context } = await parse('70000001', clone(episode));

    expect(typeof context.pageResolver).toBe('function');
  });

  test('remembers the url it was asked to parse', async () => {
    const { context } = await parse('70000001', clone(episode));

    expect(context.targetUrl).toBe(viewerUrl('70000001'));
  });
});

describe('a response missing a field we depend on', () => {
  test('rejects when the response carries no data', async () => {
    const parser = EpisodeParser.create(viewerUrl('70000001'));

    installFetch({ [contextUrl('70000001')]: { error: { message: 'not found' } } });

    await expect(parser.parserContext()).rejects.toThrow('Fetch data error');
  });

  test('rejects when reading_episode is gone', async () => {
    const body = clone(episode);

    delete body.data.reading_episode;

    const parser = EpisodeParser.create(viewerUrl('70000001'));

    installFetch({ [contextUrl('70000001')]: body });

    await expect(parser.parserContext()).rejects.toThrow(TypeError);
  });

  test('rejects when the network request itself fails', async () => {
    const parser = EpisodeParser.create(viewerUrl('70000001'));

    installFetch({ [contextUrl('70000001')]: new Error('network down') });

    await expect(parser.parserContext()).rejects.toThrow('network down');
  });
});

describe('the preview resolver', () => {
  const [page] = episode.data.reading_episode.pages;

  const resolverFor = async pageBody => {
    const { context } = await parse('70000001', clone(episode));
    const fetchFake = installFetch({ [page.url]: pageBody });

    return { pageResolver: context.pageResolver, fetchFake };
  };

  beforeEach(() => {
    vi.mocked(decrypteImage).mockReset();
  });

  test('fetches the page with its gridshuffle key and resolves the decrypted image', async () => {
    vi.mocked(decrypteImage).mockResolvedValue('blob:decrypted');
    const { pageResolver, fetchFake } = await resolverFor('scrambled');

    await expect(pageResolver(page)).resolves.toBe('blob:decrypted');

    expect(fetchFake.mock.calls[0][1].headers['X-Cobalt-Thumber-Parameter-Gridshuffle-Key']).toBe(page.key);
    const [decryptedPage, blob] = vi.mocked(decrypteImage).mock.calls[0];
    expect(decryptedPage).toBe(page);
    expect(await blob.text()).toBe('scrambled');
  });

  test('rejects when the page cannot be decrypted', async () => {
    vi.mocked(decrypteImage).mockRejectedValue(new Error("Couldn't load the encrypted image"));
    const { pageResolver } = await resolverFor('scrambled');

    await expect(pageResolver(page)).rejects.toThrow("Couldn't load the encrypted image");
  });

  test('rejects when the page cannot be fetched', async () => {
    const { pageResolver } = await resolverFor(new Error('network down'));

    await expect(pageResolver(page)).rejects.toThrow('network down');
    expect(decrypteImage).not.toHaveBeenCalled();
  });
});
