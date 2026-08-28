/**
 * The retry allowance behind `Manager/Retryer`: how many attempts a ticker
 * grants before it reports the limit, and how `reset()` restores them.
 */
const RetryTicker = require('../src/modules/Util/RetryTicker').default;

describe('the attempt allowance', () => {
  test('grants maxTry attempts before reporting the limit', () => {
    const ticker = new RetryTicker(3);

    expect(ticker.reachLimit()).toBe(false);
    expect(ticker.reachLimit()).toBe(false);
    expect(ticker.reachLimit()).toBe(false);
    expect(ticker.reachLimit()).toBe(true);
  });

  test('keeps reporting the limit once it is reached', () => {
    const ticker = new RetryTicker(1);

    ticker.reachLimit();

    expect(ticker.reachLimit()).toBe(true);
    expect(ticker.reachLimit()).toBe(true);
  });

  test('a ticker with no allowance is at the limit from the first ask', () => {
    expect(new RetryTicker(0).reachLimit()).toBe(true);
  });

  test('counts only the asks, so a ticker never asked is at zero', () => {
    // `Retryer.getRetryTime()` reads `tryTimes` straight off the ticker to
    // report which attempt an `onretry` listener is seeing.
    const ticker = new RetryTicker(3);

    expect(ticker.tryTimes).toBe(0);

    ticker.reachLimit();
    ticker.reachLimit();

    expect(ticker.tryTimes).toBe(2);
  });

  test('stops counting up once the limit is reached', () => {
    const ticker = new RetryTicker(2);

    ticker.reachLimit();
    ticker.reachLimit();
    ticker.reachLimit();
    ticker.reachLimit();

    expect(ticker.tryTimes).toBe(2);
  });
});

describe('reset', () => {
  test('restores the allowance', () => {
    const ticker = new RetryTicker(1);

    ticker.reachLimit();
    ticker.reset();

    expect(ticker.tryTimes).toBe(0);
    expect(ticker.reachLimit()).toBe(false);
  });

  test('restores the full allowance, not just one attempt', () => {
    const ticker = new RetryTicker(2);

    ticker.reachLimit();
    ticker.reachLimit();
    expect(ticker.reachLimit()).toBe(true);

    ticker.reset();

    expect(ticker.reachLimit()).toBe(false);
    expect(ticker.reachLimit()).toBe(false);
    expect(ticker.reachLimit()).toBe(true);
  });

  test('leaves a fresh ticker untouched', () => {
    const ticker = new RetryTicker(1);

    ticker.reset();

    expect(ticker.tryTimes).toBe(0);
    expect(ticker.maxTry).toBe(1);
  });
});
