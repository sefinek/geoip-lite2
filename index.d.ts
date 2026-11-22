export interface GeoIp2Location {
	/** ISO 3166-1 alpha-2 country code. */
	country: string;
	/** Region (subdivision) code. Empty when unknown. */
	region: string;
	/** Whether the country is a member of the European Union. */
	isEu: boolean;
	/** IANA time zone name. Empty when unknown. */
	timezone: string;
	/** City name. Empty when unknown. */
	city: string;
	/** Latitude and longitude. `[null, null]` when the database has no coordinates. */
	ll: [number, number] | [null, null];
	/** Metro code, or `null` when unavailable. */
	metro: number | null;
	/** Accuracy radius in kilometers, or `null` when unavailable. */
	area: number | null;
}

/** Callback invoked after an asynchronous reload. `err` is set only when the reload failed. */
export type ReloadCallback = (err?: Error | null) => void;

/**
 * Looks up an IPv4 or IPv6 address, or an IPv4 address given as an unsigned 32-bit integer.
 * IPv4-mapped IPv6 addresses are resolved as IPv4.
 *
 * @returns The location, or `null` for invalid, private or unknown addresses.
 * @throws {TypeError} When `ip` is `null` or `undefined`.
 */
export function lookup(ip: string | number): GeoIp2Location | null;

/** Synchronously reloads the data files. Throws when the data is corrupted. */
export function reloadDataSync(): void;

/** Asynchronously reloads the data files and reports the result through `callback`. */
export function reloadData(callback: ReloadCallback): void;
/** Asynchronously reloads the data files. The promise rejects when the reload fails. */
export function reloadData(): Promise<void>;

/**
 * Watches the data directory and reloads the data after it changes.
 * Without a callback, reload errors are logged to the console.
 */
export function startWatchingDataUpdate(callback?: ReloadCallback): void;

/** Stops watching the data directory. */
export function stopWatchingDataUpdate(): void;

/** Drops the loaded data from memory. Lookups return `null` until the data is reloaded. */
export function clear(): void;

/** Package version. */
export const version: string;
