# Dashboard Status API

This document describes the new configurable dashboard status API endpoints that provide granular monitoring data.

## Endpoints

### 1. `/api/status` - Flexible Status API

A comprehensive API that allows full control over data granularity and time ranges.

#### Parameters

- `granularity` (string, default: "hour"): Data granularity
  - `"minute"`: Minute-level data (max 1 day)
  - `"hour"`: Hour-level data (max 30 days)  
  - `"day"`: Day-level data (max 365 days)
  - `"auto"`: Automatically choose based on time range
  
- `days` (float, default: 1): Number of days to retrieve data for
  
- `maxPoints` (integer, default: 100): Maximum number of data points to return
  
- `monitorIds` (string, optional): Comma-separated list of monitor IDs to include. If not provided, returns data for all active monitors
  
- `format` (string, default: "detailed"): Response format
  - `"detailed"`: Full data with timestamps and status details
  - `"heartbeat"`: Simplified format compatible with heartbeat bars
  
- `date` (string, optional): Get data for a specific date (YYYY-MM-DD format)
  - Example: `"2023-12-25"` gets all data for Christmas Day
  
- `startDate` (string, optional): Start date/time for custom range
  - Formats: `"YYYY-MM-DD"` or `"YYYY-MM-DDTHH:mm:ss"`
  - Example: `"2023-12-01"` or `"2023-12-01T09:00:00"`
  
- `endDate` (string, optional): End date/time for custom range
  - Formats: `"YYYY-MM-DD"` or `"YYYY-MM-DDTHH:mm:ss"`
  - Example: `"2023-12-31"` or `"2023-12-31T17:00:00"`

#### Examples

```bash
# Get hourly data for the last 7 days
GET /api/status?granularity=hour&days=7&maxPoints=168

# Get minute-level data for the last day  
GET /api/status?granularity=minute&days=1&maxPoints=1440

# Get data for specific monitors only
GET /api/status?monitorIds=1,2,3&granularity=hour&days=1

# Auto-detect granularity based on time range
GET /api/status?granularity=auto&days=30&maxPoints=100

# Get minute data for a specific day (Christmas 2023)
GET /api/status?granularity=minute&date=2023-12-25

# Get minute data for a specific date range
GET /api/status?granularity=minute&startDate=2023-12-01&endDate=2023-12-31

# Get hour data for specific time range with exact times
GET /api/status?granularity=hour&startDate=2023-12-25T09:00:00&endDate=2023-12-25T17:00:00
```

### 2. `/api/dashboard/status` - Preset-based Status API

A simplified API with preset configurations for common use cases.

#### Parameters

- `preset` (string, default: "hourly"): Predefined configuration
  - `"minutely"`: Minute-level data for 1 day (1440 points max)
  - `"hourly"`: Hour-level data for 7 days (168 points max)
  - `"daily"`: Day-level data for 30 days (30 points max)
  - `"yearly"`: Minute-level data for 1 year (525,600 points) ⚠️ **Resource intensive!**
  - `"custom"`: Custom configuration (requires `interval` parameter)
  
- `days` (float, optional): Override the default days for the preset
  
- `interval` (integer, required for "custom"): Minutes between data points
  
- `monitorIds` (string, optional): Comma-separated list of monitor IDs

#### Examples

```bash
# Get hourly data for 7 days (default)
GET /api/dashboard/status?preset=hourly

# Get minute-level data for 1 day
GET /api/dashboard/status?preset=minutely

# Get daily data for 90 days
GET /api/dashboard/status?preset=daily&days=90

# Get EVERY MINUTE of the year (525,600 data points) ⚠️ Resource intensive!
GET /api/dashboard/status?preset=yearly

# Get every minute for 3 months with limited response size
GET /api/status?granularity=minute&days=90&maxPoints=5000

# Custom: data point every 15 minutes for 2 days
GET /api/dashboard/status?preset=custom&interval=15&days=2

# Get data for specific monitors only
GET /api/dashboard/status?preset=hourly&monitorIds=1,2,3

# Get minute data for yesterday
GET /api/dashboard/status?preset=minutely&date=2023-12-24

# Get hourly data for a specific week
GET /api/dashboard/status?preset=hourly&startDate=2023-12-18&endDate=2023-12-24

# Get minute data for business hours of a specific day
GET /api/status?granularity=minute&startDate=2023-12-25T09:00:00&endDate=2023-12-25T17:00:00
```

## Response Format

### Detailed Format Response

```json
{
  "monitors": {
    "1": {
      "id": 1,
      "name": "My Website",
      "type": "http",
      "url": "https://example.com",
      "actualGranularity": "hour",
      "dataPoints": [
        {
          "timestamp": 1640995200,
          "time": "2022-01-01T00:00:00.000Z",
          "status": 1,
          "uptime": 60,
          "downtime": 0
        }
      ],
      "summary": {
        "uptime": 0.99,
        "avgPing": 150.5,
        "totalDataPoints": 168
      }
    }
  },
  "config": {
    "granularity": "hour",
    "days": 7,
    "maxPoints": 168,
    "format": "detailed",
    "timestamp": "2022-01-01T12:00:00.000Z"
  }
}
```

### Heartbeat Format Response

```json
{
  "monitors": {
    "1": {
      "id": 1,
      "name": "My Website",
      "type": "http", 
      "url": "https://example.com",
      "dataPoints": [
        {
          "status": 1,
          "time": "2022-01-01T00:00:00.000Z",
          "msg": "",
          "ping": null
        },
        0
      ],
      "summary": {
        "uptime": 0.99,
        "avgPing": 150.5,
        "totalDataPoints": 100
      }
    }
  }
}
```

## Status Values

- `0`: No data / Empty
- `1`: Up
- `2`: Down  
- `3`: Pending
- `4`: Maintenance

## Data Granularity Limits

- **Minute-level data**: 
  - Recent data (≤ 1 day): Uses in-memory cache (very fast)
  - Historical data (> 1 day): Direct database query (up to 365 days, resource intensive)
- **Hour-level data**: Maximum 30 days (720 data points)
- **Day-level data**: Maximum 365 days

## ⚠️ Performance Considerations

**Getting every minute of the year** (525,600 data points) is possible but **very resource intensive**:

- **Database impact**: Queries potentially millions of heartbeat records
- **Memory usage**: Large JSON responses (10-50MB+ per monitor)
- **Network transfer**: Significant bandwidth usage
- **Processing time**: May take 10-60 seconds per monitor

**Recommendations**:
- Use `maxPoints` parameter to limit response size
- Consider using `format=heartbeat` with aggregated buckets
- Query specific monitors only with `monitorIds` parameter
- Use minute-level data for recent periods (≤ 1 day) when possible

## Date Range Functionality

### Get Specific Day Data
```bash
# Get all minute data for December 25, 2023
GET /api/status?granularity=minute&date=2023-12-25

# Get hourly data for New Year's Day
GET /api/dashboard/status?preset=minutely&date=2024-01-01
```

### Custom Date Ranges
```bash
# Get data from December 1 to December 31, 2023
GET /api/status?granularity=hour&startDate=2023-12-01&endDate=2023-12-31

# Get minute data for business hours (9 AM to 5 PM)
GET /api/status?granularity=minute&startDate=2023-12-25T09:00:00&endDate=2023-12-25T17:00:00

# Get data from specific start date to now
GET /api/status?granularity=hour&startDate=2023-12-01
```

### Date Format Examples
- **Date only**: `2023-12-25` (full day from 00:00:00 to 23:59:59)
- **Date and time**: `2023-12-25T14:30:00` (specific time)
- **ISO format**: `2023-12-25T14:30:00.000Z` (with timezone)

## Use Cases

### For Dashboard Charts
```bash
# Get hourly data points for charting
GET /api/dashboard/status?preset=hourly&days=7
```

### For Real-time Monitoring  
```bash
# Get minute-level data for detailed monitoring
GET /api/dashboard/status?preset=minutely
```

### For Historical Analysis
```bash
# Get daily summaries for long-term trends
GET /api/dashboard/status?preset=daily&days=365
```

### For Custom Intervals
```bash
# Data point every 5 minutes for 6 hours  
GET /api/dashboard/status?preset=custom&interval=5&days=0.25
```

## Caching

Both endpoints use 1-minute caching to balance performance and data freshness.

## Error Handling

The API returns appropriate HTTP status codes:
- `200`: Success
- `400`: Bad request (invalid parameters)
- `500`: Internal server error

Error responses include a descriptive message:
```json
{
  "ok": false,
  "msg": "Minute-level data is only available for up to 1 day"
}
```