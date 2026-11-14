import '../helpers/fakeIndexedDb';
import { flushPromises } from '@vue/test-utils';
import browser from '../doubles/browser';
import { shallowMountOption } from '../helpers/mountOptionComponent';
import DiagnosisMessages from '@/options_page/components/DiagnosisMessages.vue';
import Db from '@/modules/Db/Db';
import TrackedErrorRepo from '@/modules/Db/Repository/TrackedErrorRepo';

const textareas = wrapper => wrapper.findAll('textarea').map(t => t.element.value);

beforeEach(() => {
  Db.instance = undefined;
  TrackedErrorRepo.instance = undefined;
});

afterEach(async () => {
  await Db.getDb().database.delete();
});

describe('DiagnosisMessages', () => {
  test('dumps permissions, settings and tracked errors without the download manager open', async () => {
    browser._fake.state.grantedPermissions = { permissions: ['downloads'], origins: [] };
    const repo = Db.getDb().trackedErrorRepo();
    await repo.addItem({ error: new Error('first error'), created_at: Date.UTC(2026, 0, 1) });
    await repo.addItem({ error: 'second error', created_at: Date.UTC(2026, 0, 2) });
    // Nothing answers runtime messages here, as when no download manager tab is open.
    const sendMessage = vi.spyOn(browser.runtime, 'sendMessage');

    const wrapper = shallowMountOption(DiagnosisMessages, { browserItems: { language: 'en' } });
    await vi.waitFor(() => expect(textareas(wrapper)[2]).not.toBe(''));

    const [permissions, settings, errors] = textareas(wrapper);

    expect(JSON.parse(permissions)).toEqual({ permissions: ['downloads'], origins: [] });
    expect(JSON.parse(settings)).toEqual({ language: 'en' });
    // A textarea's value normalises the component's \r\n to \n.
    expect(errors).toBe('2026-01-01T00:00:00.000Z Error: first error\n2026-01-02T00:00:00.000Z second error\n');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('leaves the errors box empty when none were recorded', async () => {
    const getItems = vi.spyOn(Db.getDb().trackedErrorRepo(), 'getItems');

    const wrapper = shallowMountOption(DiagnosisMessages, { browserItems: {} });
    // '' is also the value before the read, so wait for the read to finish.
    await vi.waitFor(() => expect(getItems).toHaveBeenCalled());
    await getItems.mock.results[0].value;
    await flushPromises();

    expect(textareas(wrapper)[2]).toBe('');
  });

  test('loads the errors even if the permissions callback never comes', async () => {
    await Db.getDb().trackedErrorRepo().addItem({ error: 'an error', created_at: Date.UTC(2026, 0, 1) });
    vi.spyOn(browser.permissions, 'getAll').mockImplementation(() => {});

    const wrapper = shallowMountOption(DiagnosisMessages, { browserItems: {} });

    await vi.waitFor(() => expect(textareas(wrapper)[2]).toBe('2026-01-01T00:00:00.000Z an error\n'));
  });

  test('says the errors could not be read rather than showing an empty box', async () => {
    Db.getDb().database.close();

    const wrapper = shallowMountOption(DiagnosisMessages, { browserItems: {} });
    await vi.waitFor(() => expect(textareas(wrapper)[2]).not.toBe(''));

    expect(textareas(wrapper)[2]).toMatch(/^_error_messages_unavailable\.message\nDatabaseClosedError/);
  });
});
