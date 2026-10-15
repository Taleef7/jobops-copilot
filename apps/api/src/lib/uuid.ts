const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether `value` has the shape of a UUID. Job ids are `uuid` in Postgres (migration 001)
 * and `randomUUID()` in the file store, so anything else names no job (#353).
 */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
