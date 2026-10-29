/**
 * The slice of an AbstractResource that content_scripts/components/App.vue
 * reads after a `pagechange`.
 */
export function fakeResource({ pages = ['p0.jpg'], pageResolver = null, context = { type: 'Illust', illustType: 0 } } = {}) {
  return {
    context,
    getUid: () => 'illust:1',
    getTitle: () => 'Title',
    getUserName: () => 'User',
    getCover: () => 'cover.jpg',
    getUrl: () => 'https://www.pixiv.net/artworks/1',
    getType: () => 'illust',
    getR: () => false,
    getPages: () => pages,
    getPageResolver: () => pageResolver,
    getDownloadTaskId: type => (type ? `task-${type}` : 'task'),
    unpack: () => ({ type: 'Illust' })
  };
}
