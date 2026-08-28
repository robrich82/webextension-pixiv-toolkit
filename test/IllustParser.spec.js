const IllustParser = require('../src/modules/Parser/Pixiv/IllustParser').default;
const { installFetch } = require('./doubles/fetch');
const { localDateParts } = require('./helpers/localDate');

const single = require('./fixtures/pixiv/illust-single.json');
const singlePages = require('./fixtures/pixiv/illust-single-pages.json');
const manga = require('./fixtures/pixiv/illust-manga.json');
const mangaPages = require('./fixtures/pixiv/illust-manga-pages.json');
const ugoira = require('./fixtures/pixiv/illust-ugoira.json');
const ugoiraMeta = require('./fixtures/pixiv/illust-ugoira-meta.json');
const unlisted = require('./fixtures/pixiv/illust-unlisted.json');
const missingCreateDate = require('./fixtures/pixiv/illust-missing-create-date.json');

// `require` caches, and `standardContext` keeps a reference to the response
// body in `__raw`. A test that reaches into the context and mutates it would
// otherwise leak into every later test in the file.
const clone = fixture => JSON.parse(JSON.stringify(fixture));

const infoUrl = id => `https://www.pixiv.net/ajax/illust/${id}`;
const pagesUrl = id => `${infoUrl(id)}/pages`;

const parse = async (url, routes) => {
  const fetchFake = installFetch(routes);
  const parser = IllustParser.create(url);

  await parser.parseContext();

  return { context: parser.getContext(), fetchFake };
};

describe('parseUrl', () => {
  test('takes the id out of an artworks url', () => {
    const parser = IllustParser.create('https://www.pixiv.net/artworks/10000001');

    parser.parseUrl(parser.url);

    expect(parser.getContext().id).toBe('10000001');
  });

  test('still understands the legacy member_illust url', () => {
    const url = 'https://www.pixiv.net/member_illust.php?mode=medium&illust_id=10000001';
    const parser = IllustParser.create(url);

    parser.parseUrl(url);

    expect(parser.getContext().id).toBe('10000001');
  });

  test('takes the unlisted id out of an unlisted url, not the numeric id', () => {
    // The unlisted id is alphanumeric and the illust it points at has a
    // separate numeric id, so the two patterns must not be confused: an
    // unlisted work is fetched from a different endpoint entirely.
    const url = 'https://www.pixiv.net/artworks/unlisted/aBc123XyZ';
    const parser = IllustParser.create(url);

    parser.parseUrl(url);

    expect(parser.getContext()).toEqual({ unlistedId: 'aBc123XyZ' });
  });

  test('throws when the url carries no illust id', () => {
    const parser = IllustParser.create('https://www.pixiv.net/users/20000001');

    expect(() => parser.parseUrl(parser.url)).toThrow("Can't parse the illust id out");
  });
});

describe('a single image illust', () => {
  test('asks for the info and the pages of the id in the url', async () => {
    const { fetchFake } = await parse('https://www.pixiv.net/artworks/10000001', {
      [infoUrl('10000001')]: clone(single),
      [pagesUrl('10000001')]: clone(singlePages),
    });

    expect(fetchFake.mock.calls.map(call => call[0])).toEqual([
      infoUrl('10000001'),
      pagesUrl('10000001'),
    ]);
  });

  test('produces the context the name formatter reads', async () => {
    const { context } = await parse('https://www.pixiv.net/artworks/10000001', {
      [infoUrl('10000001')]: clone(single),
      [pagesUrl('10000001')]: clone(singlePages),
    });

    expect(context).toMatchObject({
      illustId: '10000001',
      illustTitle: 'harbour at dusk',
      illustType: 0,
      userName: 'harbourpainter',
      userId: '20000001',
      userAccount: 'harbourpainter',
      id: '10000001',
      title: 'harbour at dusk',
      type: 'Illust',
      r: 0,
      totalPages: 1,
    });
  });

  test('takes the cover from the thumbnail url', async () => {
    const { context } = await parse('https://www.pixiv.net/artworks/10000001', {
      [infoUrl('10000001')]: clone(single),
      [pagesUrl('10000001')]: clone(singlePages),
    });

    expect(context.cover).toBe(single.body.urls.thumb);
  });

  test('collects the original url of every page', async () => {
    const { context } = await parse('https://www.pixiv.net/artworks/10000001', {
      [infoUrl('10000001')]: clone(single),
      [pagesUrl('10000001')]: clone(singlePages),
    });

    expect(context.pages).toEqual([singlePages.body[0].urls.original]);
  });

  test('dates the work by createDate, not uploadDate', async () => {
    // The fixture deliberately uploads two days after creation, so a parser
    // reading the wrong field would show up here rather than passing by luck.
    const { context } = await parse('https://www.pixiv.net/artworks/10000001', {
      [infoUrl('10000001')]: clone(single),
      [pagesUrl('10000001')]: clone(singlePages),
    });

    const { year, month, day } = localDateParts(single.body.createDate);

    expect({ year: context.year, month: context.month, day: context.day })
      .toEqual({ year, month, day });
    expect(context.day).not.toBe(localDateParts(single.body.uploadDate).day);
  });

  test('keeps the untouched response body on __raw', async () => {
    // Downstream code reads fields that standardContext drops, so the raw body
    // has to survive the mapping intact.
    const { context } = await parse('https://www.pixiv.net/artworks/10000001', {
      [infoUrl('10000001')]: clone(single),
      [pagesUrl('10000001')]: clone(singlePages),
    });

    expect(context.__raw).toEqual(single.body);
  });
});

describe('a multi page manga', () => {
  const routes = {
    [infoUrl('10000002')]: clone(manga),
    [pagesUrl('10000002')]: clone(mangaPages),
  };

  test('counts the pages, which is what drives {pageNum} and {lastPageNum}', async () => {
    const { context } = await parse('https://www.pixiv.net/artworks/10000002', routes);

    expect(context.totalPages).toBe(3);
  });

  test('keeps the pages in the order the api returned them', async () => {
    const { context } = await parse('https://www.pixiv.net/artworks/10000002', routes);

    expect(context.pages).toEqual(mangaPages.body.map(page => page.urls.original));
  });

  test('carries xRestrict through as r', async () => {
    const { context } = await parse('https://www.pixiv.net/artworks/10000002', routes);

    expect(context.r).toBe(1);
  });

  test('does not lift the series data out of the response', async () => {
    // Unlike NovelParser, the illust parser leaves seriesNavData on __raw, so
    // {seriesTitle} and friends do not resolve for an illust. Pinned because it
    // is a real difference between the two parsers, not an accident of this
    // fixture.
    const { context } = await parse('https://www.pixiv.net/artworks/10000002', routes);

    expect(context.seriesId).toBeUndefined();
    expect(context.__raw.seriesNavData.seriesId).toBe('30000001');
  });
});

describe('an ugoira', () => {
  const routes = {
    [infoUrl('10000003')]: clone(ugoira),
    'https://www.pixiv.net/ajax/illust/10000003/ugoira_meta': clone(ugoiraMeta),
  };

  test('fetches the ugoira meta instead of the pages', async () => {
    const { fetchFake } = await parse('https://www.pixiv.net/artworks/10000003', routes);

    expect(fetchFake.mock.calls.map(call => call[0])).toEqual([
      infoUrl('10000003'),
      'https://www.pixiv.net/ajax/illust/10000003/ugoira_meta',
    ]);
  });

  test('picks up the zip sources and the frame mime type', async () => {
    const { context } = await parse('https://www.pixiv.net/artworks/10000003', routes);

    expect(context).toMatchObject({
      illustSrc: ugoiraMeta.body.src,
      illustOriginalSrc: ugoiraMeta.body.originalSrc,
      illustMimeType: 'image/jpeg',
      illustFrames: ugoiraMeta.body.frames,
    });
  });

  test('sums the frame delays into a duration', async () => {
    // The ffmpeg path in UgoiraDownloadTask builds its timing from this.
    const { context } = await parse('https://www.pixiv.net/artworks/10000003', routes);

    expect(context.illustDuration).toBe(350);
  });
});

describe('an unlisted illust', () => {
  const unlistedUrl = 'https://www.pixiv.net/ajax/illust/unlisted/aBc123XyZ';
  const routes = { [unlistedUrl]: clone(unlisted) };

  test('fetches the unlisted endpoint and nothing else', async () => {
    // There is no pages endpoint for an unlisted work; the single original url
    // comes back with the info.
    const { fetchFake } = await parse('https://www.pixiv.net/artworks/unlisted/aBc123XyZ', routes);

    expect(fetchFake.mock.calls.map(call => call[0])).toEqual([unlistedUrl]);
  });

  test('takes its one page from the info response', async () => {
    const { context } = await parse('https://www.pixiv.net/artworks/unlisted/aBc123XyZ', routes);

    expect(context.pages).toEqual([unlisted.body.urls.original]);
    expect(context.totalPages).toBe(1);
  });

  test('rejects an unlisted ugoira, which it has no path for', async () => {
    const body = clone(unlisted);

    body.body.illustType = IllustParser.UGOIRA_TYPE;

    const parser = IllustParser.create('https://www.pixiv.net/artworks/unlisted/aBc123XyZ');

    installFetch({ [unlistedUrl]: body });

    await expect(parser.parseContext()).rejects.toThrow('Invalid unlisted illust type 2');
  });
});

describe('a response missing a field we depend on', () => {
  test('rejects when createDate is gone', async () => {
    // The regression case: Pixiv renaming or dropping a key. Since #6 this
    // fails loudly rather than filing the download under a NaN date, and the
    // rejection surfaces through the parse promise.
    const parser = IllustParser.create('https://www.pixiv.net/artworks/10000005');

    installFetch({ [infoUrl('10000005')]: clone(missingCreateDate) });

    await expect(parser.parseContext()).rejects.toThrow('Invalid date time');
  });

  test('rejects an illust type it does not recognise', async () => {
    const body = clone(single);

    body.body.illustType = 9;

    const parser = IllustParser.create('https://www.pixiv.net/artworks/10000001');

    installFetch({ [infoUrl('10000001')]: body });

    await expect(parser.parseContext()).rejects.toThrow('Invalid illust type 9');
  });

  test('rejects when the pages request comes back as an error', async () => {
    // parsePages calls `reject()` with no argument, so there is nothing to
    // report upstream. Asserted as it stands rather than as it should be.
    const parser = IllustParser.create('https://www.pixiv.net/artworks/10000001');

    installFetch({
      [infoUrl('10000001')]: clone(single),
      [pagesUrl('10000001')]: { error: true, message: 'work not found', body: [] },
    });

    await expect(parser.parseContext()).rejects.toBeUndefined();
  });

  test('rejects when the network request itself fails', async () => {
    const parser = IllustParser.create('https://www.pixiv.net/artworks/10000001');

    installFetch({ [infoUrl('10000001')]: new Error('network down') });

    await expect(parser.parseContext()).rejects.toThrow('network down');
  });
});
