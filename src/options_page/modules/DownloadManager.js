import AbstractDownloadTask from './DownloadTasks/AbstractDownloadTask';
import DownloadTaskExistsError from '@/errors/DownloadTaskExistsError';
import DownloadTaskNotFoundError from '@/errors/DownloadTaskNotFoundError';
import Event from '@/modules/Event';

/**
 * @class Manage download tasks
 */
class DownloadManager extends Event {
  /**
   * @type {DownloadManager}
   */
  static defaultInstance;

  /**
   * Download tasks collection
   * @type {Map<string,AbstractDownloadTask>}
   */
  tasks = new Map();

  /**
   * @type {string[]}
   */
  changedTaskIds = [];

  /**
   * @type {number}
   */
  maxDownloadingTasks = 3;

  /**
   * @type {Error}
   */
  lastError = null;

  /**
   *
   * @returns {DownloadManager}
   */
  static getDefault() {
    if (!DownloadManager.defaultInstance) {
      DownloadManager.defaultInstance = new DownloadManager();
    }

    return DownloadManager.defaultInstance;
  }

  /**
   * Set property `maxDownloadingTasks`, max is 3 and min is 1
   * @param {number} number
   */
  setMaxDownloadingTasks(number) {
    number = Number(number);
    // NaN (a cleared field, which Firefox's storage keeps) would lift the cap.
    number = Number.isFinite(number) ? Math.min(3, Math.max(1, number)) : 1;

    let increaseProcessed = this.maxDownloadingTasks < number;

    this.maxDownloadingTasks = number;

    if (increaseProcessed) {
      this.startTasks();
    }
  }

  /**
   * Get a download task using given id
   * @param {string} id
   * @returns
   * @throws {DownloadTaskNotFoundError}
   */
  getTask(id) {
    if (!this.tasks.has(id)) {
      throw new DownloadTaskNotFoundError();
    }

    return this.tasks.get(id);
  }

  tasksUpdate(id) {
    if (this.changedTaskIds.indexOf(id) < 0) {
      this.changedTaskIds.push(id);
    }

    this.dispatch('update', [this.changedTaskIds]);
  }

  getAllTasks() {
    return this.tasks;
  }

  getAvaliableTasksJson() {
    let dataset = [];

    Array.from(this.tasks).forEach(item => {
      let task = item[1];

      if (!task.isDelete) {
        dataset.push(task.toJson());
      }
    });

    return dataset;
  }

  /**
   * Flush the updated tasks
   * @param {boolean} json
   * @returns {any[]}
   */
  flushChangedTasks(json = true) {
    let changedTaskIds = this.changedTaskIds;
    this.changedTaskIds = [];

    let tasks = Array.from(this.tasks).filter(item => {
      let taskId = item[0];
      return changedTaskIds.indexOf(taskId) > -1;
    });

    return tasks.map(task => task[1].toJson());
  }

  /**
   *
   * @param {AbstractDownloadTask} task
   */
  listenTaskEvents(task) {
    task.addListener('statechange', () => {
      this.tasksUpdate(task.id);
    });

    task.addListener('progress', () => {
      this.tasksUpdate(task.id);
    });

    task.addListener('error', () => {
      this.tasksUpdate(task.id);
    });

    task.addListener('complete', () => {
      this.tasksUpdate(task.id);
      this.startTasks();
    });

    task.addListener('failure', () => {
      this.tasksUpdate(task.id);
      this.startTasks();
    });
  }

  /**
   * @returns {AbstractDownloadTask[]}
   */
  get downloadingTasks() {
    return Array.from(this.tasks).filter(item => item[1].isDownloading());
  }

  /**
   * @fires DownloadManager#error
   * @param {Error} error
   */
  setLastError(error) {
    this.lastError = error;
    this.dispatch('error', [error]);
  }

  /**
   *
   * @returns {boolean}
   */
  reachDownloadingTasksLimit() {
    return this.downloadingTasks.length >= this.maxDownloadingTasks;
  }

  /**
   * Resume every paused task and retry every failed one, as many at once as the limit allows.
   */
  startAll() {
    for (const task of this.tasks.values()) {
      if (task.isPaused() || task.isFailure()) {
        task.tryPending();
      }
    }

    this.startTasks();
  }

  /**
   * Find which download task ready for starting and start it.
   */
  startTasks() {
    let tasks = Array.from(this.tasks);
    let index = 0;

    while (!this.reachDownloadingTasksLimit()) {
      let item = tasks[index];

      if (!item) {
        break;
      }

      index++;

      const task = this.getTask(item[0]);

      task.isPending() && task.start();
    }
  }

  /**
   * Add a download task to manager, throw error if it has the same id.
   * @param {any} task
   * @throws {DownloadTaskExistsError}
   */
  async addTask(task) {
    let id = task[task.idKey ? task.idKey : 'id'];

    if (this.tasks.has(id)) {
      throw new DownloadTaskExistsError();
    }

    this.listenTaskEvents(task);

    this.tasks.set(id, task);
    this.startTask(id);
  }

  /**
   * Delete a download task
   * @param {number} id
   */
  async deleteTask(id) {
    let index = this.changedTaskIds.indexOf(id);

    if (index > -1) {
      this.changedTaskIds.splice(index, 1);
    }

    let downloadTask = this.getTask(id);
    downloadTask.markDelete();
    downloadTask.stop();
    this.tasks.delete(id);
    // A deleted download frees its slot for the next queued one.
    this.startTasks();
  }

  /**
   * Start a download task
   * @param {number} id
   */
  async startTask(id) {
    let downloadTask = this.getTask(id);

    try {
      downloadTask.tryPending();

      if (!this.reachDownloadingTasksLimit()) {
        downloadTask.start();
      }
    } catch (error) {
      this.setLastError(error);
    }
  }

  /**
   * Pause a download task
   * @param {number} id
   */
  async pauseTask(id) {
    try {
      this.getTask(id).pause();
    } catch (error) {
      this.setLastError(error);
    }
  }

  /**
   * Stop a download task
   * @param {number} id
   */
  async stopTask(id) {
    this.getTask(id).stop();
  }
}

export default DownloadManager;
