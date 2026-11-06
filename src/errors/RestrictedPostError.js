/**
 * The post exists, but this session isn't entitled to its content (for
 * example a fanbox post above the user's support tier).
 */
export default class RestrictedPostError extends Error {
  constructor(message = 'Restricted post') {
    super(message);

    this.name = 'RestrictedPostError';
  }
}
