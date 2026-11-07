/**
 * v5 stored pixiv's `illustType`: 0 illust, 1 manga, 2 ugoira.
 */
const LEGACY_ILLUST_TYPES = ['pixiv_illust', 'pixiv_manga', 'pixiv_ugoira'];

/**
 * The History page renders these as links and images, so anything else (a
 * `javascript:` URL in a hand-edited file, say) is refused.
 */
const isWebUrl = value => typeof value === 'string' && /^https?:\/\//i.test(value);

/**
 * Unix seconds. v5 sometimes stored milliseconds, and its own reader kept the
 * first ten digits, so this does the same.
 */
const toSeconds = value => {
  if (value === undefined || value === null || !/^[1-9]\d*$/.test(String(value))) {
    return undefined;
  }

  return parseInt(String(value).substring(0, 10), 10);
};

const optionalString = value => typeof value === 'string' ? value : undefined;

function fromCurrent(raw) {
  let visited_at = toSeconds(raw.visited_at);
  let downloaded_at = toSeconds(raw.downloaded_at);

  if (!raw.uid || !isWebUrl(raw.url) || !(visited_at || downloaded_at)) {
    return null;
  }

  let item = {
    uid: raw.uid,
    title: raw.title,
    url: raw.url,
    cover: isWebUrl(raw.cover) ? raw.cover : '',
    userName: optionalString(raw.userName),
    type: optionalString(raw.type) || '',
    r: !!raw.r,
    visited_at: visited_at || downloaded_at,
  };

  if (downloaded_at) {
    item.downloaded_at = downloaded_at;
  }

  return item;
}

function fromLegacy(raw) {
  let id = raw.id === undefined || raw.id === null ? '' : String(raw.id);
  let visited_at = toSeconds(raw.viewed_at);

  if (!/^N?\d+$/.test(id) || !visited_at) {
    return null;
  }

  let numericId = id.replace(/^N/, '');
  let isNovel = !!raw.isNovel || id.startsWith('N');
  let cover = isNovel ? raw.image : raw.images && raw.images.thumb;

  return {
    uid: (isNovel ? 'pixiv_novel:' : 'pixiv_illust:') + numericId,
    title: raw.title,
    url: isNovel
      ? `https://www.pixiv.net/novel/show.php?id=${numericId}`
      : `https://www.pixiv.net/artworks/${numericId}`,
    cover: isWebUrl(cover) ? cover : '',
    userName: optionalString(raw.userName),
    type: isNovel ? 'pixiv_novel' : (LEGACY_ILLUST_TYPES[raw.type] || 'pixiv_illust'),
    r: !!raw.r,
    visited_at,
  };
}

/**
 * Converts an entry from an export file or the history backup into the shape
 * the `histories` table stores, or returns null when it isn't a usable
 * history entry. Takes both the current shape (`uid`, `visited_at`) and the
 * v5 shape that the PouchDB store and `historyBackup` hold (`id`,
 * `viewed_at`, `images.thumb`).
 *
 * @param {*} raw
 * @returns {import('@/modules/Db/Repository/HistoryRepo').ItemType|null}
 */
export function toHistoryItem(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.title !== 'string') {
    return null;
  }

  return typeof raw.uid === 'string' ? fromCurrent(raw) : fromLegacy(raw);
}
