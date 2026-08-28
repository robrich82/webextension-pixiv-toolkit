const PostParser = require('../src/modules/Parser/Fanbox/PostParser').default;
const browser = require('./doubles/browser').default;
const { localDateParts } = require('./helpers/localDate');

const article = require('./fixtures/fanbox/post-article.json');
const legacyImagePost = require('./fixtures/fanbox/post-image-legacy-body.json');

const clone = fixture => JSON.parse(JSON.stringify(fixture));

/**
 * Stand in for the background service worker. The parser doesn't fetch the
 * fanbox api itself — a direct request from the page is cross-origin and dies
 * on CORS under manifest v3 — so it asks the worker over runtime messaging and
 * the response is what the fixtures stand in for.
 */
const backgroundReplies = response => {
  const listener = jest.fn((message, sender, sendResponse) => {
    sendResponse(response);
    return true;
  });

  browser.runtime.onMessage.addListener(listener);

  return listener;
};

const parse = async (url, response) => {
  const listener = backgroundReplies(response);
  const parser = PostParser.create(url);

  await parser.parseContext();

  return { context: parser.getContext(), listener };
};

const articleUrl = 'https://www.fanbox.cc/@sketchbook/posts/60000001';

describe('parseUrl', () => {
  test('reads the creator and post id out of a /@creator/posts/ url', () => {
    const parser = PostParser.create(articleUrl);

    parser.parseUrl(parser.url);

    expect(parser.getContext()).toEqual({ creatorId: 'sketchbook', postId: '60000001' });
  });

  test('reads them out of a creator subdomain url too', () => {
    const parser = PostParser.create('https://sketchbook.fanbox.cc/posts/60000001');

    parser.parseUrl(parser.url);

    expect(parser.getContext().postId).toBe('60000001');
  });

  test('throws when the url is not a post url', () => {
    const parser = PostParser.create('https://www.fanbox.cc/@sketchbook');

    expect(() => parser.parseUrl(parser.url)).toThrow("Can't parse the post id and creator id out");
  });
});

describe('an article post', () => {
  test('asks the background worker for the post it parsed out of the url', async () => {
    const { listener } = await parse(articleUrl, clone(article));

    expect(listener).toHaveBeenCalledWith(
      { to: 'ws', action: 'fanbox:postInfo', args: { postId: '60000001' } },
      expect.anything(),
      expect.any(Function)
    );
  });

  test('produces the context the name formatter reads', async () => {
    const { context } = await parse(articleUrl, clone(article));

    expect(context).toMatchObject({
      id: '60000001',
      title: 'february sketch dump',
      userId: '20000007',
      userName: 'sketchbook',
      cover: article.body.post.coverImageUrl,
      r: false,
      totalPages: 2,
    });
  });

  test('collects the images the blocks reference, in block order', async () => {
    // The images live in imageMap, keyed by id; the order they appear in is
    // the order of the blocks, not of the map.
    const { context } = await parse(articleUrl, clone(article));

    expect(context.pages).toEqual([
      'https://downloads.fanbox.cc/images/post/60000001/img1.png',
      'https://downloads.fanbox.cc/images/post/60000001/img2.png',
    ]);
  });

  test('ignores blocks that are not images', async () => {
    const { context } = await parse(articleUrl, clone(article));

    // The fixture also carries text blocks and a psd attachment.
    expect(context.pages).toHaveLength(2);
  });

  test('skips an image block whose id is missing from the map', async () => {
    const response = clone(article);

    delete response.body.post.body.imageMap.img2;

    const { context } = await parse(articleUrl, response);

    expect(context.pages).toEqual(['https://downloads.fanbox.cc/images/post/60000001/img1.png']);
    expect(context.totalPages).toBe(1);
  });

  test('dates the post from publishedDatetime', async () => {
    const { context } = await parse(articleUrl, clone(article));

    const { year, month, day } = localDateParts(article.body.post.publishedDatetime);

    expect({ year: context.year, month: context.month, day: context.day })
      .toEqual({ year, month, day });
  });
});

describe('an image post in the older, flat response shape', () => {
  const imageUrl = 'https://wallpapers.fanbox.cc/posts/60000002';

  test('reads a post that sits directly on body, not under body.post', async () => {
    const { context } = await parse(imageUrl, clone(legacyImagePost));

    expect(context.id).toBe('60000002');
  });

  test('collects the images from the images array', async () => {
    const { context } = await parse(imageUrl, clone(legacyImagePost));

    expect(context.pages).toEqual([
      'https://downloads.fanbox.cc/images/post/60000002/img1.png',
      'https://downloads.fanbox.cc/images/post/60000002/img2.png',
    ]);
    expect(context.totalPages).toBe(2);
  });

  test('carries hasAdultContent through as r', async () => {
    const { context } = await parse(imageUrl, clone(legacyImagePost));

    expect(context.r).toBe(true);
  });
});

describe('a response missing a field we depend on', () => {
  test('formats a missing publishedDatetime as NaN instead of throwing', async () => {
    // Unlike the pixiv parsers, this one builds the formatter with `new
    // DateFormatter(...)` rather than `getDefault`, so an absent date is never
    // validated and reaches the filename as the string "NaN". Pinned as the
    // behaviour that exists, not the behaviour that is wanted.
    const response = clone(article);

    delete response.body.post.publishedDatetime;

    const { context } = await parse(articleUrl, response);

    expect({ year: context.year, month: context.month, day: context.day })
      .toEqual({ year: 'NaN', month: 'NaN', day: 'NaN' });
  });

  test('throws on a post type it has no image path for', async () => {
    const response = clone(article);

    response.body.post.type = 'video';

    backgroundReplies(response);

    await expect(PostParser.create(articleUrl).parseContext())
      .rejects.toThrow('Invalid post type. type: video');
  });

  test('throws when the worker reports an error', async () => {
    backgroundReplies({ error: 'not authorised' });

    await expect(PostParser.create(articleUrl).parseContext())
      .rejects.toThrow("Can't fetch fanbox post 60000001 context: not authorised");
  });

  test('throws when the worker answers with nothing', async () => {
    backgroundReplies(undefined);

    await expect(PostParser.create(articleUrl).parseContext())
      .rejects.toThrow("Can't fetch fanbox post 60000001 context");
  });
});

describe('abort', () => {
  test('drops a response that arrives after the parse was aborted', async () => {
    // The background request itself can't be cancelled, so the late reply has
    // to be ignored rather than overwriting the context of whatever the user
    // navigated to next.
    backgroundReplies(clone(article));

    const parser = PostParser.create(articleUrl);
    const parsing = parser.parseContext();

    parser.abort();

    await parsing;

    expect(parser.getContext()).toEqual({ creatorId: 'sketchbook', postId: '60000001' });
  });
});
