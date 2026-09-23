import BackgroundPort from '@/modules/Ports/IllustHistoryPort/BackgroundPort';

const createPort = ({ illustHistoryRepo, historyBackupRepo }) => {
  const port = Object.create(BackgroundPort.prototype);

  port.illustHistoryRepo = illustHistoryRepo;
  port.historyBackupRepo = historyBackupRepo;

  return port;
};

describe('BackgroundPort#clearHistoryAction', () => {
  test('clears both the illust history and the backup', async () => {
    const clearData = jest.fn().mockResolvedValue();
    const forgetAll = jest.fn();
    const port = createPort({
      illustHistoryRepo: { clearData },
      historyBackupRepo: { forgetAll }
    });

    await port.clearHistoryAction();

    expect(clearData).toHaveBeenCalled();
    expect(forgetAll).toHaveBeenCalled();
  });

  test('reports a failed clear instead of leaving it unnoticed', async () => {
    const error = new Error('destroy failed');
    const port = createPort({
      illustHistoryRepo: { clearData: jest.fn().mockRejectedValue(error) },
      historyBackupRepo: { forgetAll: jest.fn() }
    });
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(port.clearHistoryAction()).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith('Failed to clear history data', error);

    consoleError.mockRestore();
  });
});
