# 📅 Specific Date API Quick Reference

## Get Minute Data for Specific Days

### ✨ Simple Date Queries

```bash
# Get ALL minute data for yesterday
GET /api/status?granularity=minute&date=2023-12-24

# Get ALL minute data for a specific day (Christmas)
GET /api/status?granularity=minute&date=2023-12-25

# Get ALL minute data for today
GET /api/status?granularity=minute&date=2023-12-26
```

### 🎯 Precise Time Ranges

```bash
# Business hours (9 AM - 5 PM) on specific day
GET /api/status?granularity=minute&startDate=2023-12-25T09:00:00&endDate=2023-12-25T17:00:00

# Night shift (11 PM - 7 AM) 
GET /api/status?granularity=minute&startDate=2023-12-24T23:00:00&endDate=2023-12-25T07:00:00

# Lunch hour on specific day
GET /api/status?granularity=minute&startDate=2023-12-25T12:00:00&endDate=2023-12-25T13:00:00
```

### 📊 Multi-Day Ranges

```bash
# Entire week (Monday to Sunday)
GET /api/status?granularity=minute&startDate=2023-12-18&endDate=2023-12-24

# Month of December 2023
GET /api/status?granularity=minute&startDate=2023-12-01&endDate=2023-12-31

# From specific date to now
GET /api/status?granularity=minute&startDate=2023-12-01
```

### 🎮 Using Dashboard Presets with Dates

```bash
# Minutely preset for specific day
GET /api/dashboard/status?preset=minutely&date=2023-12-25

# Hourly preset for date range
GET /api/dashboard/status?preset=hourly&startDate=2023-12-01&endDate=2023-12-31

# Yearly preset for specific year
GET /api/dashboard/status?preset=yearly&startDate=2023-01-01&endDate=2023-12-31
```

## 📝 Date Format Options

| Format | Example | Description |
|--------|---------|-------------|
| `YYYY-MM-DD` | `2023-12-25` | Full day (00:00:00 to 23:59:59) |
| `YYYY-MM-DDTHH:mm:ss` | `2023-12-25T14:30:00` | Specific time |
| `ISO with timezone` | `2023-12-25T14:30:00.000Z` | UTC timezone |

## 🚀 Real-World Examples

### Incident Investigation
```bash
# "Our site was down around 2 PM on Christmas Day"
GET /api/status?granularity=minute&startDate=2023-12-25T13:30:00&endDate=2023-12-25T14:30:00
```

### Daily Reports
```bash
# "Show me all data for last Monday"
GET /api/status?granularity=minute&date=2023-12-18
```

### Performance Analysis
```bash
# "How did we perform during Black Friday?"
GET /api/status?granularity=minute&date=2023-11-24
```

### Compliance Auditing
```bash
# "Show uptime for Q4 2023"
GET /api/status?granularity=minute&startDate=2023-10-01&endDate=2023-12-31&maxPoints=50000
```

## ⚡ Performance Tips

- **Specific days** (24 hours): Fast response (~1-3 seconds)
- **Week ranges**: Moderate response (~5-15 seconds)  
- **Month ranges**: Slower response (~15-60 seconds)
- **Use `maxPoints`** to limit large responses
- **Use `monitorIds`** to filter specific monitors

## 🎉 You Can Now Get:

✅ **Every minute of any specific day**  
✅ **Every minute of any date range**  
✅ **Every minute for business hours**  
✅ **Every minute from any start date to now**  
✅ **Every minute with precise time boundaries**  

**Perfect for detailed incident investigation and compliance reporting!** 🔍📊