# Changelog

## 3.0.0-alpha.0 (2026-02-22)

### Breaking Changes
- Removed the `range` field from the `lookup()` results.
- Renamed `eu` to `isEu`.
- Changed `isEu` to a boolean (`true`/`false`) instead of string values.

### Migration
- Replace `<result>.eu` with `result.isEu`.
- Remove any usage of `<result>.range`.

### Example
#### 79.186.130.100
```json
{
  "country": "PL",
  "region": "32",
  "isEu": true,
  "timezone": "Europe/Warsaw",
  "city": "Szczecin",
  "ll": [53.4118, 14.5339],
  "metro": 0,
  "area": 200
}
```

##### 2a01:11bf:4222:900a:99ae:285f:7432:8f8e
```json
{
  "country": "PL",
  "region": "32",
  "isEu": true,
  "timezone": "Europe/Warsaw",
  "city": "Szczecin",
  "ll": [53.4518, 14.5556],
  "metro": 0,
  "area": 100
}
```
