/**
 * Test script for the new Dashboard Status API
 * 
 * This script demonstrates how to use the new configurable status API endpoints.
 * Make sure Uptime Kuma is running before executing this script.
 */

const axios = require('axios');
const dayjs = require('dayjs');

// Base URL for your Uptime Kuma instance
const BASE_URL = 'http://localhost:3001';

/**
 * Test the flexible status API
 */
async function testStatusAPI() {
    console.log('🔍 Testing /api/status endpoint...\n');
    
    const testCases = [
        {
            name: 'Hourly data for 7 days',
            url: `${BASE_URL}/api/status?granularity=hour&days=7&maxPoints=168`
        },
        {
            name: 'Minute data for 1 day',
            url: `${BASE_URL}/api/status?granularity=minute&days=1&maxPoints=1440`
        },
        {
            name: 'Auto-detect granularity for 30 days',
            url: `${BASE_URL}/api/status?granularity=auto&days=30&maxPoints=100`
        },
        {
            name: 'Daily data for 90 days',
            url: `${BASE_URL}/api/status?granularity=day&days=90&maxPoints=90`
        },
        {
            name: 'Heartbeat format for 7 days',
            url: `${BASE_URL}/api/status?granularity=hour&days=7&format=heartbeat&maxPoints=100`
        },
        {
            name: '⚠️ Minute data for 30 days (RESOURCE INTENSIVE)',
            url: `${BASE_URL}/api/status?granularity=minute&days=30&maxPoints=1000`
        },
        {
            name: '⚠️ Every minute for 1 week (VERY LARGE RESPONSE)',
            url: `${BASE_URL}/api/status?granularity=minute&days=7&maxPoints=10080`
        },
        {
            name: 'Specific day - minute data for yesterday',
            url: `${BASE_URL}/api/status?granularity=minute&date=${dayjs().subtract(1, 'day').format('YYYY-MM-DD')}`
        },
        {
            name: 'Date range - last 3 days with hour granularity',
            url: `${BASE_URL}/api/status?granularity=hour&startDate=${dayjs().subtract(3, 'day').format('YYYY-MM-DD')}&endDate=${dayjs().format('YYYY-MM-DD')}`
        },
        {
            name: 'Business hours - 9 AM to 5 PM yesterday',
            url: `${BASE_URL}/api/status?granularity=minute&startDate=${dayjs().subtract(1, 'day').format('YYYY-MM-DD')}T09:00:00&endDate=${dayjs().subtract(1, 'day').format('YYYY-MM-DD')}T17:00:00`
        }
    ];
    
    for (const testCase of testCases) {
        try {
            console.log(`📊 ${testCase.name}:`);
            console.log(`   URL: ${testCase.url}`);
            
            const response = await axios.get(testCase.url);
            const data = response.data;
            
            console.log(`   ✅ Status: ${response.status}`);
            console.log(`   📈 Monitors found: ${Object.keys(data.monitors).length}`);
            console.log(`   ⚙️  Config: ${JSON.stringify(data.config)}`);
            
            // Show sample data from first monitor
            const firstMonitorId = Object.keys(data.monitors)[0];
            if (firstMonitorId && data.monitors[firstMonitorId].dataPoints) {
                const points = data.monitors[firstMonitorId].dataPoints.length;
                console.log(`   📊 Data points for monitor ${firstMonitorId}: ${points}`);
                if (points > 0) {
                    console.log(`   🕐 Sample point: ${JSON.stringify(data.monitors[firstMonitorId].dataPoints[0])}`);
                }
            }
            
        } catch (error) {
            console.log(`   ❌ Error: ${error.response?.data?.msg || error.message}`);
        }
        console.log('');
    }
}

/**
 * Test the preset-based dashboard API
 */
async function testDashboardAPI() {
    console.log('🎛️  Testing /api/dashboard/status endpoint...\n');
    
    const testCases = [
        {
            name: 'Minutely preset (1 day)',
            url: `${BASE_URL}/api/dashboard/status?preset=minutely`
        },
        {
            name: 'Hourly preset (7 days)', 
            url: `${BASE_URL}/api/dashboard/status?preset=hourly`
        },
        {
            name: 'Daily preset (30 days)',
            url: `${BASE_URL}/api/dashboard/status?preset=daily`
        },
        {
            name: 'Custom preset (15min intervals for 2 days)',
            url: `${BASE_URL}/api/dashboard/status?preset=custom&interval=15&days=2`
        },
        {
            name: 'Hourly with custom days (14 days)',
            url: `${BASE_URL}/api/dashboard/status?preset=hourly&days=14`
        },
        {
            name: '⚠️ YEARLY preset - Every minute for 1 year (525,600 points!) - USE WITH CAUTION',
            url: `${BASE_URL}/api/dashboard/status?preset=yearly&days=365`,
            skipInAutoTest: true // Skip this in automated tests due to resource intensity
        },
        {
            name: '⚠️ Limited yearly test - 10,000 points from 1 year',
            url: `${BASE_URL}/api/status?granularity=minute&days=365&maxPoints=10000`
        },
        {
            name: 'Specific date with preset - minutely for yesterday',
            url: `${BASE_URL}/api/dashboard/status?preset=minutely&date=${dayjs().subtract(1, 'day').format('YYYY-MM-DD')}`
        },
        {
            name: 'Date range with preset - hourly for last week',
            url: `${BASE_URL}/api/dashboard/status?preset=hourly&startDate=${dayjs().subtract(7, 'day').format('YYYY-MM-DD')}&endDate=${dayjs().format('YYYY-MM-DD')}`
        }
    ];
    
    for (const testCase of testCases) {
        // Skip resource-intensive tests in automated runs
        if (testCase.skipInAutoTest && process.env.AUTO_TEST) {
            console.log(`⏭️  Skipping: ${testCase.name} (resource intensive)`);
            continue;
        }
        
        try {
            console.log(`📊 ${testCase.name}:`);
            console.log(`   URL: ${testCase.url}`);
            
            const startTime = Date.now();
            const response = await axios.get(testCase.url, { timeout: 120000 }); // 2 minute timeout
            const endTime = Date.now();
            const data = response.data;
            
            console.log(`   ✅ Status: ${response.status}`);
            console.log(`   ⏱️  Response time: ${endTime - startTime}ms`);
            console.log(`   📈 Monitors found: ${Object.keys(data.monitors).length}`);
            console.log(`   ⚙️  Config: ${JSON.stringify(data.config)}`);
            
            // Show sample data from first monitor
            const firstMonitorId = Object.keys(data.monitors)[0];
            if (firstMonitorId && data.monitors[firstMonitorId].dataPoints) {
                const points = data.monitors[firstMonitorId].dataPoints.length;
                console.log(`   📊 Data points for monitor ${firstMonitorId}: ${points}`);
                console.log(`   🎯 Granularity: ${data.monitors[firstMonitorId].actualGranularity}`);
                
                // Warn about large responses
                if (points > 50000) {
                    console.log(`   ⚠️  WARNING: Very large response (${points} data points)`);
                }
            }
            
        } catch (error) {
            console.log(`   ❌ Error: ${error.response?.data?.msg || error.message}`);
        }
        console.log('');
    }
}

/**
 * Test specific monitor filtering
 */
async function testMonitorFiltering() {
    console.log('🎯 Testing monitor filtering...\n');
    
    try {
        // First get all monitors to see what's available
        console.log('📋 Getting all monitors...');
        const allResponse = await axios.get(`${BASE_URL}/api/status?granularity=hour&days=1`);
        const allData = allResponse.data;
        
        const monitorIds = Object.keys(allData.monitors);
        console.log(`   Found ${monitorIds.length} monitors: [${monitorIds.join(', ')}]`);
        
        if (monitorIds.length >= 2) {
            // Test filtering specific monitors
            const testIds = monitorIds.slice(0, 2); // Take first 2 monitors
            console.log(`\n🔍 Testing with specific monitors: [${testIds.join(', ')}]`);
            
            const filteredResponse = await axios.get(`${BASE_URL}/api/status?granularity=hour&days=1&monitorIds=${testIds.join(',')}`);
            const filteredData = filteredResponse.data;
            
            console.log(`   ✅ Filtered result has ${Object.keys(filteredData.monitors).length} monitors`);
            console.log(`   📊 Monitor IDs: [${Object.keys(filteredData.monitors).join(', ')}]`);
        } else {
            console.log('   ⚠️  Not enough monitors for filtering test');
        }
        
    } catch (error) {
        console.log(`   ❌ Error: ${error.response?.data?.msg || error.message}`);
    }
}

/**
 * Main test runner
 */
async function runTests() {
    console.log('🚀 Starting Dashboard Status API Tests\n');
    console.log('=' .repeat(60));
    
    try {
        await testStatusAPI();
        console.log('=' .repeat(60));
        await testDashboardAPI();
        console.log('=' .repeat(60));
        await testMonitorFiltering();
        console.log('=' .repeat(60));
        
        console.log('✅ All tests completed!');
        
    } catch (error) {
        console.error('❌ Test runner error:', error.message);
        process.exit(1);
    }
}

// Run tests if this script is executed directly
if (require.main === module) {
    runTests();
}

module.exports = {
    testStatusAPI,
    testDashboardAPI,
    testMonitorFiltering,
    runTests
};