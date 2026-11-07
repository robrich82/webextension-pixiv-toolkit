import { toHistoryItem } from '@/modules/HistoryItem';

const current = overrides => ({
  id: 7, uid: 'pixiv_illust:1', title: 'Work', userName: 'Artist',
  url: 'https://www.pixiv.net/artworks/1', cover: 'https://i.pximg.net/1.jpg',
  type: 'pixiv_illust', r: false, visited_at: 1700000000, ...overrides
});

const legacy = overrides => ({
  id: '100', title: 'Old work', userId: '9', userName: 'Old artist', type: 1, r: true,
  images: { thumb: 'https://i.pximg.net/100.jpg' }, viewed_at: 1600000000, _rev: '1-abc', ...overrides
});

describe('toHistoryItem', () => {
  describe('current shape', () => {
    test('keeps the stored fields and drops the database id', () => {
      expect(toHistoryItem(current({ downloaded_at: 1700000100 }))).toEqual({
        uid: 'pixiv_illust:1', title: 'Work', userName: 'Artist',
        url: 'https://www.pixiv.net/artworks/1', cover: 'https://i.pximg.net/1.jpg',
        type: 'pixiv_illust', r: false, visited_at: 1700000000, downloaded_at: 1700000100
      });
    });

    test('a download-only entry is visited when it was downloaded', () => {
      expect(toHistoryItem(current({ visited_at: undefined, downloaded_at: 1700000100 })))
        .toMatchObject({ visited_at: 1700000100, downloaded_at: 1700000100 });
    });

    test.each([
      ['no timestamp', { visited_at: undefined }],
      ['a non-numeric timestamp', { visited_at: 'yesterday' }],
      ['a javascript: url', { url: 'javascript:alert(1)' }],
      ['no url', { url: undefined }],
      ['an empty uid', { uid: '' }]
    ])('rejects an entry with %s', (_, overrides) => {
      expect(toHistoryItem(current(overrides))).toBeNull();
    });

    test('blanks a cover that is not a web url', () => {
      expect(toHistoryItem(current({ cover: 'javascript:alert(1)' })).cover).toBe('');
    });
  });

  describe('v5 shape', () => {
    test('maps an illust to its uid, url, cover and type', () => {
      expect(toHistoryItem(legacy())).toEqual({
        uid: 'pixiv_illust:100', title: 'Old work', userName: 'Old artist',
        url: 'https://www.pixiv.net/artworks/100', cover: 'https://i.pximg.net/100.jpg',
        type: 'pixiv_manga', r: true, visited_at: 1600000000
      });
    });

    test.each([[0, 'pixiv_illust'], [1, 'pixiv_manga'], [2, 'pixiv_ugoira'], [9, 'pixiv_illust']])(
      'illust type %s becomes %s', (type, expected) => {
        expect(toHistoryItem(legacy({ type })).type).toBe(expected);
      }
    );

    test('maps a novel, whose id carries an N prefix', () => {
      expect(toHistoryItem(legacy({ id: 'N55', isNovel: true, images: undefined, image: 'https://i.pximg.net/n55.jpg' })))
        .toMatchObject({
          uid: 'pixiv_novel:55', url: 'https://www.pixiv.net/novel/show.php?id=55',
          cover: 'https://i.pximg.net/n55.jpg', type: 'pixiv_novel'
        });
    });

    test('reads a millisecond viewed_at as seconds', () => {
      expect(toHistoryItem(legacy({ viewed_at: 1600000000123 })).visited_at).toBe(1600000000);
    });

    test('a missing thumbnail leaves the cover blank', () => {
      expect(toHistoryItem(legacy({ images: {} })).cover).toBe('');
    });

    test.each([
      ['a non-numeric id', { id: 'abc' }],
      ['no viewed_at', { viewed_at: undefined }]
    ])('rejects an entry with %s', (_, overrides) => {
      expect(toHistoryItem(legacy(overrides))).toBeNull();
    });
  });

  test.each([null, 'text', 42, {}, { uid: 'pixiv_illust:1' }])('rejects %p', raw => {
    expect(toHistoryItem(raw)).toBeNull();
  });
});
