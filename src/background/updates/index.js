import update6_0_0 from './update6_0_0';
import update6_4_3 from './update6_4_3';

/**
 * Every settings migration, keyed by the version it brings settings up to.
 * `Updater` walks them in insertion order, so keep them in ascending version
 * order.
 */
export default () => {
  let updates = new Map();

  updates.set('6.0.0', update6_0_0);
  updates.set('6.4.3', update6_4_3);

  return updates;
}
