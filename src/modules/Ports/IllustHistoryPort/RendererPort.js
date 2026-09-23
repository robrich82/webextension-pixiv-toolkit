import IllustHistoryPort from './IllustHistoryPort';

export default class RendererPort extends IllustHistoryPort {
  static instance;

  constructor() {
    super();

    this.connect();
  }

  /**
   * @returns {RendererPort}
   */
  static getInstance() {
    if (RendererPort.instance) {
      return RendererPort.instance;
    }

    return RendererPort.instance = new RendererPort();
  }

  connect() {
    this.createPort(IllustHistoryPort.portName);

    /**
     * The background page can be suspended and dropped this port while this
     * instance sat idle (e.g. the options page was left open). Without this,
     * `this.port` keeps pointing at a dead port and every future message
     * silently fails in the catch below.
     */
    this.port.onDisconnect.addListener(() => {
      this.port = null;
    });
  }

  postMessage(args) {
    if (!this.port) {
      this.connect();
    }

    try {
      this.port.postMessage(args)
    } catch (e) {
      this.port = null;
    }
  }

  saveIllustHistory(args) {
    this.postMessage({
      action: 'saveIllustHistory',
      args: args
    });
  }

  saveBatchHistories({ items }) {
    this.postMessage({
      action: 'saveBatchHistories',
      args: { items }
    });
  }

  countItems(args) {
    this.postMessage({
      action: 'countItems',
      args: args
    });
  }

  listItems(args) {
    this.postMessage({
      action: 'listItems',
      args: args
    });
  }

  searchItems(args) {
    this.postMessage({
      action: 'searchItems',
      args: args
    });
  }

  deleteIllustHistory(args) {
    return this.postMessage({
      action: 'deleteIllustHistory',
      args: args
    });
  }

  clearHistory() {
    return this.postMessage({
      action: 'clearHistory'
    });
  }
}
