interface GeoIp2Location {
    country: string;
    region: string;
    isEu: boolean;
    timezone: string;
    city: string;
    ll: [number | null, number | null];
    metro: number | null;
    area: number | null;
}

export function lookup(ip: string | number): GeoIp2Location | null;
export function reloadDataSync(): void;
export function reloadData(callback: (err?: Error | null) => void): void;
export function reloadData(): Promise<void>;
export function startWatchingDataUpdate(callback?: (err?: Error | null) => void): void;
export function stopWatchingDataUpdate(): void;
export function clear(): void;
export const version: string;
