/**
 * `ScriptInjector` collects a list of files and runs them into a tab through
 * `tabs.executeScript`, remembering what it has already injected so a second
 * pass over the same tab does not run a script twice.
 *
 * Two of its edges bite: the injected-files bookkeeping can leave `inject()`
 * with no call left to resolve on, and `reset()` aliases two of its own lists.
 * Both are pinned below.
 */
const browser = require('./doubles/browser').default;
const Tabs = require('../src/modules/Browser/Tabs').default;
const ScriptInjector = require('../src/modules/Util/ScriptInjector').default;

let injector;

beforeEach(() => {
  // The constructor grabs `Tabs.getTabs()`, which caches the browser it first
  // saw; clearing the singleton keeps each spec on the current fake.
  Tabs.instance = undefined;

  injector = new ScriptInjector();
});

/** The details each `executeScript` call was given, in order. */
const executedDetails = () => browser.tabs.executeScript.mock.calls.map(call => call[1]);

describe('collecting files', () => {
  test('turns each file into a detail that runs at document_end', () => {
    injector.addInjectFiles(['js/a.js', 'js/b.js']);

    expect(injector.injectDetails).toEqual([
      { file: 'js/a.js', runAt: 'document_end' },
      { file: 'js/b.js', runAt: 'document_end' }
    ]);
  });

  test('appends to what is already there rather than replacing it', () => {
    injector.addInjectFiles(['js/a.js']).addInjectFiles(['js/b.js']);
    injector.appendInjectDetail({ code: 'window.pixivToolkit = true' });

    expect(injector.injectDetails).toHaveLength(3);
  });

  test('the collecting calls are chainable', () => {
    expect(injector.addInjectFiles([])).toBe(injector);
    expect(injector.appendInjectDetail({})).toBe(injector);
    expect(injector.reset()).toBe(injector);
  });
});

describe('inject', () => {
  test('runs every detail into the given tab', async () => {
    const tab = browser._fake.addTab({ url: 'https://www.pixiv.net/' });

    await injector.addInjectFiles(['js/a.js', 'js/b.js']).inject(tab.id);

    expect(browser.tabs.executeScript).toHaveBeenCalledTimes(2);
    expect(browser.tabs.executeScript.mock.calls.map(call => call[0])).toEqual([tab.id, tab.id]);
    expect(executedDetails()).toEqual([
      { file: 'js/a.js', runAt: 'document_end' },
      { file: 'js/b.js', runAt: 'document_end' }
    ]);
  });

  test('resolves once the last script has run', async () => {
    let lastCallback;

    // Held back rather than run, so the spec decides when the last script
    // finishes. `mockImplementationOnce` per call keeps the fake's own
    // implementation in place for the specs that follow.
    browser.tabs.executeScript
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce((tabId, detail, callback) => { lastCallback = callback; });

    let resolved = false;

    const injecting = injector.addInjectFiles(['js/a.js', 'js/b.js']).inject(1).then(() => { resolved = true; });

    await browser._fake.flush();

    expect(resolved).toBe(false);

    lastCallback();

    await injecting;

    expect(resolved).toBe(true);
  });

  test('skips a file it has already injected', async () => {
    await injector.addInjectFiles(['js/a.js', 'js/b.js']).inject(1);

    browser.tabs.executeScript.mockClear();

    await injector.appendInjectDetail({ file: 'js/c.js', runAt: 'document_end' }).inject(1);

    expect(executedDetails()).toEqual([{ file: 'js/c.js', runAt: 'document_end' }]);
  });

  test('an injection whose last detail is a repeat never settles', async () => {
    // Only the final detail is given the callback that resolves the promise, so
    // when that one is skipped as already injected nothing resolves — an
    // `await injector.inject(tabId)` there hangs for good.
    await injector.addInjectFiles(['js/a.js']).inject(1);

    const settled = await Promise.race([
      injector.inject(1).then(() => 'settled'),
      new Promise(resolve => setTimeout(() => resolve('still pending'), 20))
    ]);

    expect(settled).toBe('still pending');
    expect(browser.tabs.executeScript).toHaveBeenCalledTimes(1);
  });

  test('records a file as injected whichever tab it went into', async () => {
    // The bookkeeping is per injector, not per tab, so the same injector reused
    // across tabs will not re-run a file in the second one.
    await injector.addInjectFiles(['js/a.js', 'js/b.js']).inject(1);

    browser.tabs.executeScript.mockClear();

    await injector.appendInjectDetail({ file: 'js/c.js', runAt: 'document_end' }).inject(2);

    expect(browser.tabs.executeScript.mock.calls.map(call => call[0])).toEqual([2]);
    expect(injector.injectedFiles).toEqual(['js/a.js', 'js/b.js', 'js/c.js']);
  });
});

describe('reset', () => {
  test('clears the collected details', () => {
    injector.addInjectFiles(['js/a.js']).reset();

    expect(injector.injectDetails).toEqual([]);
  });

  test('leaves the already-injected list alone, so repeats stay suppressed', async () => {
    await injector.addInjectFiles(['js/a.js']).inject(1);

    injector.reset();

    expect(injector.injectedFiles).toEqual(['js/a.js']);
  });

  test('points injectDetails and injectFiles at one shared array', () => {
    // `this.injectDetails = this.injectFiles = []` hands both names the same
    // array, so anything collected afterwards shows up under both.
    injector.reset().addInjectFiles(['js/a.js']);

    expect(injector.injectFiles).toBe(injector.injectDetails);
    expect(injector.injectFiles).toEqual([{ file: 'js/a.js', runAt: 'document_end' }]);
  });
});
