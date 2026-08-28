/**
 * The date parts a parser is expected to derive from a timestamp.
 *
 * The fixtures carry Pixiv's real format — ISO 8601 with a `+09:00` offset —
 * while `DateFormatter`'s getters read local-time fields. The expected year,
 * month and day therefore depend on the timezone of the machine running the
 * tests: the same instant is the 7th in Tokyo and the 6th in London. Deriving
 * the expectation the same way keeps the assertions honest about *which*
 * timestamp a parser used (`createDate`, not `uploadDate`) without pinning the
 * suite to one timezone.
 *
 * The padding rules themselves are `DateFormatter`'s own, and are covered in
 * `DateFormatter.spec.js`.
 */
const pad = value => String(value).padStart(2, '0');

const localDateParts = timestamp => {
  const date = new Date(timestamp);

  return {
    year: String(date.getFullYear()),
    month: pad(date.getMonth() + 1),
    day: pad(date.getDate()),
  };
};

module.exports = { localDateParts };
