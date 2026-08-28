const NovelParser = require('../src/modules/Parser/Pixiv/NovelParser').default;
const { installFetch } = require('./doubles/fetch');
const { localDateParts } = require('./helpers/localDate');

const single = require('./fixtures/pixiv/novel-single.json');
const series = require('./fixtures/pixiv/novel-series.json');
const missingCreateDate = require('./fixtures/pixiv/novel-missing-create-date.json');

const clone = fixture => JSON.parse(JSON.stringify(fixture));

const contextUrl = id => `https://www.pixiv.net/ajax/novel/${id}`;
const pageUrl = id => `https://www.pixiv.net/novel/show.php?id=${id}`;

const parse = async (id, body) => {
  const fetchFake = installFetch({ [contextUrl(id)]: body });
  const parser = NovelParser.create(pageUrl(id));

  await parser.parseContext();

  return { context: parser.getContext(), fetchFake };
};

describe('parseUrl', () => {
  test('takes the id out of a novel url', () => {
    const parser = NovelParser.create(pageUrl('40000001'));

    parser.parseUrl(parser.url);

    expect(parser.getContext().id).toBe('40000001');
  });

  test('throws when the url carries no novel id', () => {
    const parser = NovelParser.create('https://www.pixiv.net/novel/series/50000001');

    expect(() => parser.parseUrl(parser.url)).toThrow("Can't parse the novel id out");
  });
});

describe('a standalone novel', () => {
  test('asks the novel endpoint for the id in the url', async () => {
    const { fetchFake } = await parse('40000001', clone(single));

    expect(fetchFake.mock.calls.map(call => call[0])).toEqual([contextUrl('40000001')]);
  });

  test('produces the context the name formatter reads', async () => {
    const { context } = await parse('40000001', clone(single));

    expect(context).toMatchObject({
      id: '40000001',
      title: 'the tide comes in',
      userId: '20000006',
      userName: 'tidewriter',
      type: 'Novel',
      r: 0,
      cover: single.body.coverUrl,
    });
  });

  test('dates the novel from createDate', async () => {
    const { context } = await parse('40000001', clone(single));

    const { year, month, day } = localDateParts(single.body.createDate);

    expect({ year: context.year, month: context.month, day: context.day })
      .toEqual({ year, month, day });
  });

  test('keeps a novel without page breaks as one section', async () => {
    const { context } = await parse('40000001', clone(single));

    expect(context.sections).toEqual(['The tide comes in.<br />It goes out again.']);
  });

  test('leaves the series placeholders unset', async () => {
    const { context } = await parse('40000001', clone(single));

    expect(context.seriesId).toBeUndefined();
    expect(context.seriesTitle).toBeUndefined();
    expect(context.seriesOrder).toBeUndefined();
  });

  test('drops the raw body, unlike the illust parser', async () => {
    // Nothing downstream of a novel reads __raw, and standardContext never
    // sets it. Pinned so the difference between the two parsers is deliberate.
    const { context } = await parse('40000001', clone(single));

    expect(context.__raw).toBeUndefined();
  });
});

describe('a novel in a series', () => {
  test('lifts the series data up for {seriesId}, {seriesTitle} and {seriesOrder}', async () => {
    const { context } = await parse('40000002', clone(series));

    expect(context).toMatchObject({
      seriesId: '50000001',
      seriesTitle: 'salt and rope',
      seriesOrder: 3,
    });
  });

  test('splits the content on [newpage]', async () => {
    const { context } = await parse('40000002', clone(series));

    expect(context.sections).toEqual(['Page one.', 'Page two.', 'Page three.']);
  });

  test('carries xRestrict through as r', async () => {
    const { context } = await parse('40000002', clone(series));

    expect(context.r).toBe(1);
  });
});

describe('a response missing a field we depend on', () => {
  test('rejects when createDate is gone', async () => {
    const parser = NovelParser.create(pageUrl('40000003'));

    installFetch({ [contextUrl('40000003')]: clone(missingCreateDate) });

    await expect(parser.parseContext()).rejects.toThrow('Invalid date time');
  });

  test('rejects when the response carries no body', async () => {
    const parser = NovelParser.create(pageUrl('40000001'));

    installFetch({
      [contextUrl('40000001')]: { error: true, message: 'novel not found', body: null },
    });

    await expect(parser.parseContext()).rejects.toThrow("Can't parse novel context out");
  });

  test('rejects when content is gone, since the sections are split out of it', async () => {
    const body = clone(single);

    delete body.body.content;

    const parser = NovelParser.create(pageUrl('40000001'));

    installFetch({ [contextUrl('40000001')]: body });

    await expect(parser.parseContext()).rejects.toThrow(TypeError);
  });

  test('rejects when the network request itself fails', async () => {
    const parser = NovelParser.create(pageUrl('40000001'));

    installFetch({ [contextUrl('40000001')]: new Error('network down') });

    await expect(parser.parseContext()).rejects.toThrow('network down');
  });
});
