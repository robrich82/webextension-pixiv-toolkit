/**
 * `CopyStr.copy()` is the options page's "copy to clipboard": it parks the text
 * in an off-screen node, selects it, runs `execCommand('copy')` and takes the
 * node away again. There is no return value and no observable result under
 * Jest, so what is worth asserting is the sequence — a step out of order, or a
 * node removed too early, leaves the user with nothing on the clipboard.
 *
 * The `node` test environment has no DOM, and jsdom implements neither
 * `execCommand` nor a selection that copies anything, so a jsdom run would end
 * up asserting against stubs regardless. These doubles are small enough to keep
 * in the spec and record what the copy path needs.
 */
const CopyStr = require('../src/modules/Util/CopyStr').default;

let dom;

/**
 * The slice of the DOM `CopyStr` touches. Every call is recorded, and nodes
 * know whether they are still attached, so the spec can ask what the document
 * looked like at the moment `execCommand` ran.
 */
function createDomFake() {
  const body = {
    children: [],

    appendChild(node) {
      body.children.push(node);
      node.attached = true;

      return node;
    }
  };

  const selection = {
    ranges: [],
    removeAllRanges: jest.fn(() => { selection.ranges = []; }),
    addRange: jest.fn(range => selection.ranges.push(range))
  };

  const createElement = jest.fn(tagName => ({
    tagName,
    style: {},
    innerText: '',
    attached: false,

    remove: jest.fn(function () {
      const index = body.children.indexOf(this);

      if (index > -1) {
        body.children.splice(index, 1);
      }

      this.attached = false;
    })
  }));

  const createRange = jest.fn(() => ({ selectedNode: undefined, selectNode: jest.fn(function (node) { this.selectedNode = node; }) }));

  /** What the copy saw: the selection and the document as it stood. */
  const copyCalls = [];

  const execCommand = jest.fn(command => {
    copyCalls.push({
      command,
      selectedNodes: selection.ranges.map(range => range.selectedNode),
      attachedChildren: body.children.slice()
    });

    return true;
  });

  return { body, selection, createElement, createRange, execCommand, copyCalls };
}

beforeEach(() => {
  dom = createDomFake();

  globalThis.document = {
    body: dom.body,
    createElement: dom.createElement,
    createRange: dom.createRange,
    execCommand: dom.execCommand
  };

  // `test/setup/extensionGlobals.js` points `window` at `globalThis`, so this
  // is the same `getSelection` the module reaches through `window`.
  globalThis.getSelection = jest.fn(() => dom.selection);
});

afterEach(() => {
  delete globalThis.document;
  delete globalThis.getSelection;
});

test('copies through a selection over a node holding the text', () => {
  CopyStr.copy('https://www.pixiv.net/artworks/12345');

  const copy = dom.copyCalls[0];

  expect(dom.execCommand).toHaveBeenCalledTimes(1);
  expect(copy.command).toBe('copy');
  expect(copy.selectedNodes).toHaveLength(1);
  expect(copy.selectedNodes[0].innerText).toBe('https://www.pixiv.net/artworks/12345');
});

test('the node is still in the document when the copy runs', () => {
  CopyStr.copy('12345');

  const copy = dom.copyCalls[0];

  expect(copy.attachedChildren).toContain(copy.selectedNodes[0]);
});

test('drops any existing selection before selecting its own node', () => {
  const stale = { selectedNode: 'something the user had selected' };

  dom.selection.ranges.push(stale);

  CopyStr.copy('12345');

  expect(dom.selection.removeAllRanges).toHaveBeenCalled();
  expect(dom.copyCalls[0].selectedNodes).not.toContain(stale);
});

test('takes the node away again, leaving the document as it was', () => {
  CopyStr.copy('12345');

  expect(dom.body.children).toHaveLength(0);
  expect(dom.createElement.mock.results[0].value.attached).toBe(false);
});

test('the node carries no size, so it never shows on the page', () => {
  CopyStr.copy('12345');

  const node = dom.createElement.mock.results[0].value;

  expect(dom.createElement).toHaveBeenCalledWith('div');
  expect(node.style).toMatchObject({ width: 0, height: 0 });
});

test('sets the text as innerText, so markup in it is not parsed', () => {
  // A title with a tag in it would otherwise become elements, and the copy
  // would pick up the rendered text instead of what was asked for.
  CopyStr.copy('<b>title</b> & more');

  expect(dom.copyCalls[0].selectedNodes[0].innerText).toBe('<b>title</b> & more');
});

test('each copy uses a fresh node', () => {
  CopyStr.copy('first');
  CopyStr.copy('second');

  const [first, second] = dom.createElement.mock.results.map(result => result.value);

  expect(second).not.toBe(first);
  expect(dom.copyCalls.map(copy => copy.selectedNodes[0].innerText)).toEqual(['first', 'second']);
  expect(dom.body.children).toHaveLength(0);
});
