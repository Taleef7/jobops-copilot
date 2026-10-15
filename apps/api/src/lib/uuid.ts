const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether `value` is a string shaped like a UUID. Job ids are `uuid` in Postgres (migration
 * 001) and `randomUUID()` in the file store, so anything else names no job (#353). Checks
 * the type too: a `job_id` from a JSON body can be an array, which `test()` would stringify.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
