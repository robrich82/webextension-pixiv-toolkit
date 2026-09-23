import browser from '../../../doubles/browser';
import RendererPort from '@/modules/Ports/IllustHistoryPort/RendererPort';
import IllustHistoryPort from '@/modules/Ports/IllustHistoryPort/IllustHistoryPort';

describe('RendererPort', () => {
  test('delivers a message to the background over the port it opens', () => {
    const renderer = new RendererPort();

    renderer.clearHistory();

    const port = browser.runtime.ports.find(p => p.name === IllustHistoryPort.portName);

    expect(port.postedMessages).toEqual([{ action: 'clearHistory' }]);
  });

  test('reconnects and still delivers the message after the background drops the port', () => {
    const renderer = new RendererPort();
    const firstPort = browser.runtime.ports.find(p => p.name === IllustHistoryPort.portName);

    // Simulate the background page being suspended while this instance sat idle.
    firstPort.peer.disconnect();

    renderer.clearHistory();

    const secondPort = browser.runtime.ports[browser.runtime.ports.length - 1];

    expect(secondPort).not.toBe(firstPort);
    expect(secondPort.postedMessages).toEqual([{ action: 'clearHistory' }]);
  });
});
