import { mount } from '@vue/test-utils';
import AppSuggest from '@/options_page/components/AppSuggest.vue';
import CacheableImage from '@/options_page/components/CacheableImage.vue';
import PageTitle from '@/options_page/components/PageTitle.vue';

describe('PageTitle', () => {
  test('renders the title as a heading', () => {
    expect(mount(PageTitle, { props: { title: 'History' } }).find('h1').text()).toBe('History');
  });
});

describe('AppSuggest', () => {
  test('links the icon and MORE to the app and shows its titles', () => {
    const wrapper = mount(AppSuggest, {
      props: { icon: 'icon.png', title: 'Pixiv Omina', subTitle: 'Downloader', link: 'https://example.com/omina' }
    });

    expect(wrapper.findAll('a').map(a => a.attributes('href'))).toEqual(['https://example.com/omina', 'https://example.com/omina']);
    expect(wrapper.find('img').attributes()).toMatchObject({ src: 'icon.png', alt: 'Pixiv Omina' });
    expect(wrapper.find('.app-suggest__title').text()).toBe('Pixiv Omina');
    expect(wrapper.find('.app-suggest__sub-title').text()).toBe('Downloader');
  });
});

describe('CacheableImage', () => {
  test('renders an <img> by default and follows src changes', async () => {
    const wrapper = mount(CacheableImage, { props: { src: 'a.jpg' } });

    expect(wrapper.find('img').attributes('src')).toBe('a.jpg');

    await wrapper.setProps({ src: 'b.jpg' });

    expect(wrapper.find('img').attributes('src')).toBe('b.jpg');
  });

  test('background mode sets a background image instead', () => {
    const wrapper = mount(CacheableImage, { props: { src: 'a.jpg', mode: 'background' } });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('.cacheable-image-bg').element.style.backgroundImage).toBe('url("a.jpg")');
  });

  test('falls back to the placeholder when src is empty', () => {
    const wrapper = mount(CacheableImage, { props: { src: '', placeholder: 'placeholder.png' } });

    expect(wrapper.find('img').attributes('src')).toBe('placeholder.png');
  });
});
