import { mount } from '@vue/test-utils';
import { mountOption } from '../helpers/mountOptionComponent';
import AppSuggest from '@/options_page/components/AppSuggest.vue';
import CacheableImage from '@/options_page/components/CacheableImage.vue';

describe('AppSuggest', () => {
  const mountSuggest = () => mountOption(AppSuggest, {
    props: { icon: 'icon.png', title: 'Pixiv Omina', subTitle: 'Downloader', link: 'https://example.com/omina' }
  });

  test('links the icon and MORE to the app and shows its titles', () => {
    const wrapper = mountSuggest();

    expect(wrapper.findAll('a').map(a => a.attributes('href'))).toEqual(['https://example.com/omina', 'https://example.com/omina']);
    expect(wrapper.find('img').attributes()).toMatchObject({ src: 'icon.png', alt: 'Pixiv Omina' });
    expect(wrapper.find('.app-suggest__title').text()).toBe('Pixiv Omina');
    expect(wrapper.find('.app-suggest__sub-title').text()).toBe('Downloader');
  });

  test('the close button is labelled and emits close', async () => {
    const wrapper = mountSuggest();
    const close = wrapper.find('.app-suggest__close');

    expect(close.attributes('aria-label')).toBe('_close.message');

    await close.trigger('click');

    expect(wrapper.emitted('close')).toHaveLength(1);
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
