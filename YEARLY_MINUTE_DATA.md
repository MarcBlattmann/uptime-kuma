# Getting Every Minute of the Year 📅⏰

Yes! You can now get **every minute of the year** (525,600 data points) from the Uptime Kuma dashboard API. Here's how:

## 🚀 Quick Examples

### Option 1: Using the Yearly Preset (Simplest)
```bash
# Get every minute for the past year (525,600 data points)
GET /api/dashboard/status?preset=yearly

# Get every minute for the past 6 months  
GET /api/dashboard/status?preset=yearly&days=180

# Get every minute for a specific monitor only
GET /api/dashboard/status?preset=yearly&monitorIds=1
```

### Option 2: Using the Flexible API
```bash
# Every minute for 1 year (maximum data)
GET /api/status?granularity=minute&days=365&maxPoints=525600

# Every minute for 3 months
GET /api/status?granularity=minute&days=90&maxPoints=129600

# Every minute for 1 month with response size limit
GET /api/status?granularity=minute&days=30&maxPoints=10000
```

### Option 3: Specific Dates and Date Ranges
```bash
# Get every minute for a specific day (Christmas 2023)
GET /api/status?granularity=minute&date=2023-12-25

# Get every minute for yesterday
GET /api/status?granularity=minute&date=${new Date(Date.now() - 86400000).toISOString().split('T')[0]}

# Get every minute for a date range (December 1-31, 2023)
GET /api/status?granularity=minute&startDate=2023-12-01&endDate=2023-12-31

# Get every minute for business hours (9 AM to 5 PM) on a specific day
GET /api/status?granularity=minute&startDate=2023-12-25T09:00:00&endDate=2023-12-25T17:00:00

# Get every minute from a start date to now
GET /api/status?granularity=minute&startDate=2023-01-01
```

## 📊 Response Size Examples

| Time Period | Data Points | Approx. JSON Size | Response Time |
|-------------|-------------|-------------------|---------------|
| 1 Day       | 1,440       | ~200 KB          | <1 second     |
| 1 Week      | 10,080      | ~1.5 MB          | 1-3 seconds   |
| 1 Month     | 43,200      | ~6 MB            | 5-15 seconds  |
| 3 Months    | 129,600     | ~18 MB           | 15-45 seconds |
| 1 Year      | 525,600     | ~75 MB           | 30-120 seconds|

## ⚠️ Important Performance Considerations

### Database Impact
- **Recent data (≤ 24 hours)**: Uses fast in-memory cache ✅
- **Historical data (> 24 hours)**: Queries raw heartbeat table ⚠️
- **Full year**: May query millions of database records ❗

### Memory & Network
- **Full year response**: 50-100+ MB JSON per monitor
- **Multiple monitors**: Response size multiplies
- **Network transfer**: Consider bandwidth limits

### Recommended Best Practices

1. **Use `maxPoints` parameter** to limit response size:
   ```bash
   # Get 10,000 representative points from the full year
   GET /api/status?granularity=minute&days=365&maxPoints=10000
   ```

2. **Query specific monitors only**:
   ```bash
   # Only get data for monitors 1, 2, and 3
   GET /api/dashboard/status?preset=yearly&monitorIds=1,2,3
   ```

3. **Use heartbeat format for visualization**:
   ```bash
   # Get aggregated buckets optimized for charts
   GET /api/status?granularity=minute&days=365&format=heartbeat&maxPoints=1000
   ```

4. **Implement client-side caching** for large datasets

5. **Consider chunked requests** for very large time ranges:
   ```bash
   # Get data in monthly chunks instead of all at once
   GET /api/status?granularity=minute&days=30&maxPoints=43200
   ```

## 🔧 Technical Implementation

The API automatically detects the data source:

- **≤ 1 day**: Uses `UptimeCalculator` in-memory cache (fast)
- **> 1 day**: Queries `heartbeat` table directly and aggregates by minute

### Data Aggregation Process
1. Query raw heartbeat records from database
2. Group heartbeats by minute timestamp
3. Calculate per-minute statistics:
   - Status (UP/DOWN based on majority)
   - Uptime ratio
   - Average ping
   - Heartbeat count per minute

## 🎯 Sample Response Structure

```json
{
  "monitors": {
    "1": {
      "id": 1,
      "name": "My Website",
      "dataPoints": [
        {
          "timestamp": 1640995200,
          "time": "2022-01-01T00:00:00.000Z",
          "status": 1,
          "uptime": 1.0,
          "downtime": 0.0,
          "avgPing": 120.5,
          "heartbeatCount": 3
        }
        // ... 525,599 more data points for full year
      ],
      "summary": {
        "uptime": 0.9985,
        "avgPing": 125.3,
        "totalDataPoints": 525600
      }
    }
  },
  "config": {
    "preset": "yearly", 
    "granularity": "minute",
    "days": 365,
    "maxPoints": 525600
  }
}
```

## 🚨 Production Warnings

### Use With Caution In Production!
- **High server load**: CPU and memory intensive
- **Database locks**: May impact other operations
- **Timeout risks**: Large queries may timeout
- **Storage costs**: Network bandwidth usage

### Recommended Production Limits
```javascript
// Consider these limits in production:
const PRODUCTION_LIMITS = {
  maxMinuteDays: 90,        // Max 3 months of minute data
  maxPointsPerMonitor: 50000, // Limit response size
  maxConcurrentRequests: 2,   // Rate limiting
  timeoutSeconds: 120         // 2 minute timeout
};
```

## 🎉 Success! 

**You now have access to every minute of monitoring data!** 

## 📅 Common Specific Date Use Cases

### Daily Reports
```bash
# Get yesterday's complete minute data
GET /api/status?granularity=minute&date=2023-12-24

# Get data for a specific incident day
GET /api/status?granularity=minute&date=2023-12-15
```

### Business Hours Analysis
```bash
# Monday to Friday, 9 AM to 5 PM
GET /api/status?granularity=minute&startDate=2023-12-18T09:00:00&endDate=2023-12-22T17:00:00

# Weekend monitoring
GET /api/status?granularity=minute&startDate=2023-12-23T00:00:00&endDate=2023-12-24T23:59:59
```

### Incident Investigation
```bash
# Get minute data around a specific incident time
GET /api/status?granularity=minute&startDate=2023-12-25T14:30:00&endDate=2023-12-25T15:30:00

# Full day analysis for incident day
GET /api/status?granularity=minute&date=2023-12-25
```

### Monthly/Quarterly Reports
```bash
# Complete month of December 2023
GET /api/status?granularity=minute&startDate=2023-12-01&endDate=2023-12-31

# Q4 2023 with limited data points
GET /api/status?granularity=minute&startDate=2023-10-01&endDate=2023-12-31&maxPoints=50000
```

Use it wisely for:
- 📈 **Detailed analytics** and trend analysis
- 🔍 **Incident investigation** with minute-level precision  
- 📊 **Custom dashboards** with granular data
- 📋 **Compliance reporting** with complete historical records
- 🎯 **Performance optimization** based on detailed patterns
- 📅 **Historical analysis** for specific dates and time periods
- 🕐 **Business hours monitoring** with precise time ranges

Happy monitoring! 🚀