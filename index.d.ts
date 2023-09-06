declare module 'geoip-lite2' {
    export const cmp: number | any | null

    export type GeoData = {
        range: [number, number];
        country: string;
        region: string;
        eu: string;
        timezone: string;
        city: string;
        ll: [number, number];
        metro: number;
        area: number;
    };

    export function lookup(ip: string): GeoData | null;

    export const pretty: (n: string | number | number[]) => string;
    export const startWatchingDataUpdate: (callback: () => void) => void;
    export const reloadDataSync: () => void;
    export const reloadData: (callback: () => void) => void;
    export const version: string;
}