let express = require("express");
const {
    setting,
    allowDevAllOrigin,
    allowAllOrigin,
    percentageToColor,
    filterAndJoin,
    sendHttpError,
} = require("../util-server");
const { R } = require("redbean-node");
const apicache = require("../modules/apicache");
const Monitor = require("../model/monitor");
const dayjs = require("dayjs");
const { UP, MAINTENANCE, DOWN, PENDING, flipStatus, log, badgeConstants } = require("../../src/util");
const StatusPage = require("../model/status_page");
const { UptimeKumaServer } = require("../uptime-kuma-server");
const { makeBadge } = require("badge-maker");
const { Prometheus } = require("../prometheus");
const Database = require("../database");
const { UptimeCalculator } = require("../uptime-calculator");

let router = express.Router();

let cache = apicache.middleware;
const server = UptimeKumaServer.getInstance();
let io = server.io;

router.get("/api/entry-page", async (request, response) => {
    allowDevAllOrigin(response);

    let result = { };
    let hostname = request.hostname;
    if ((await setting("trustProxy")) && request.headers["x-forwarded-host"]) {
        hostname = request.headers["x-forwarded-host"];
    }

    if (hostname in StatusPage.domainMappingList) {
        result.type = "statusPageMatchedDomain";
        result.statusPageSlug = StatusPage.domainMappingList[hostname];
    } else {
        result.type = "entryPage";
        result.entryPage = server.entryPage;
    }
    response.json(result);
});

router.all("/api/push/:pushToken", async (request, response) => {
    try {
        let pushToken = request.params.pushToken;
        let msg = request.query.msg || "OK";
        let ping = parseFloat(request.query.ping) || null;
        let statusString = request.query.status || "up";
        const statusFromParam = (statusString === "up") ? UP : DOWN;

        let monitor = await R.findOne("monitor", " push_token = ? AND active = 1 ", [
            pushToken
        ]);

        if (! monitor) {
            throw new Error("Monitor not found or not active.");
        }

        const previousHeartbeat = await Monitor.getPreviousHeartbeat(monitor.id);

        let isFirstBeat = true;

        let bean = R.dispense("heartbeat");
        bean.time = R.isoDateTimeMillis(dayjs.utc());
        bean.monitor_id = monitor.id;
        bean.ping = ping;
        bean.msg = msg;
        bean.downCount = previousHeartbeat?.downCount || 0;

        if (previousHeartbeat) {
            isFirstBeat = false;
            bean.duration = dayjs(bean.time).diff(dayjs(previousHeartbeat.time), "second");
        }

        if (await Monitor.isUnderMaintenance(monitor.id)) {
            msg = "Monitor under maintenance";
            bean.status = MAINTENANCE;
        } else {
            determineStatus(statusFromParam, previousHeartbeat, monitor.maxretries, monitor.isUpsideDown(), bean);
        }

        // Calculate uptime
        let uptimeCalculator = await UptimeCalculator.getUptimeCalculator(monitor.id);
        let endTimeDayjs = await uptimeCalculator.update(bean.status, parseFloat(bean.ping));
        bean.end_time = R.isoDateTimeMillis(endTimeDayjs);

        log.debug("router", `/api/push/ called at ${dayjs().format("YYYY-MM-DD HH:mm:ss.SSS")}`);
        log.debug("router", "PreviousStatus: " + previousHeartbeat?.status);
        log.debug("router", "Current Status: " + bean.status);

        bean.important = Monitor.isImportantBeat(isFirstBeat, previousHeartbeat?.status, bean.status);

        if (Monitor.isImportantForNotification(isFirstBeat, previousHeartbeat?.status, bean.status)) {
            // Reset down count
            bean.downCount = 0;

            log.debug("monitor", `[${monitor.name}] sendNotification`);
            await Monitor.sendNotification(isFirstBeat, monitor, bean);
        } else {
            if (bean.status === DOWN && monitor.resendInterval > 0) {
                ++bean.downCount;
                if (bean.downCount >= monitor.resendInterval) {
                    // Send notification again, because we are still DOWN
                    log.debug("monitor", `[${monitor.name}] sendNotification again: Down Count: ${bean.downCount} | Resend Interval: ${monitor.resendInterval}`);
                    await Monitor.sendNotification(isFirstBeat, monitor, bean);

                    // Reset down count
                    bean.downCount = 0;
                }
            }
        }

        await R.store(bean);

        io.to(monitor.user_id).emit("heartbeat", bean.toJSON());

        Monitor.sendStats(io, monitor.id, monitor.user_id);
        new Prometheus(monitor).update(bean, undefined);

        response.json({
            ok: true,
        });
    } catch (e) {
        response.status(404).json({
            ok: false,
            msg: e.message
        });
    }
});

router.get("/api/badge/:id/status", cache("5 minutes"), async (request, response) => {
    allowAllOrigin(response);

    const {
        label,
        upLabel = "Up",
        downLabel = "Down",
        pendingLabel = "Pending",
        maintenanceLabel = "Maintenance",
        upColor = badgeConstants.defaultUpColor,
        downColor = badgeConstants.defaultDownColor,
        pendingColor = badgeConstants.defaultPendingColor,
        maintenanceColor = badgeConstants.defaultMaintenanceColor,
        style = badgeConstants.defaultStyle,
        value, // for demo purpose only
    } = request.query;

    try {
        const requestedMonitorId = parseInt(request.params.id, 10);
        const overrideValue = value !== undefined ? parseInt(value) : undefined;

        let publicMonitor = await R.getRow(`
                SELECT monitor_group.monitor_id FROM monitor_group, \`group\`
                WHERE monitor_group.group_id = \`group\`.id
                AND monitor_group.monitor_id = ?
                AND public = 1
            `,
        [ requestedMonitorId ]
        );

        const badgeValues = { style };

        if (!publicMonitor) {
            // return a "N/A" badge in naColor (grey), if monitor is not public / not available / non exsitant

            badgeValues.message = "N/A";
            badgeValues.color = badgeConstants.naColor;
        } else {
            const heartbeat = await Monitor.getPreviousHeartbeat(requestedMonitorId);
            const state = overrideValue !== undefined ? overrideValue : heartbeat.status;

            if (label === undefined) {
                badgeValues.label = "Status";
            } else {
                badgeValues.label = label;
            }
            switch (state) {
                case DOWN:
                    badgeValues.color = downColor;
                    badgeValues.message = downLabel;
                    break;
                case UP:
                    badgeValues.color = upColor;
                    badgeValues.message = upLabel;
                    break;
                case PENDING:
                    badgeValues.color = pendingColor;
                    badgeValues.message = pendingLabel;
                    break;
                case MAINTENANCE:
                    badgeValues.color = maintenanceColor;
                    badgeValues.message = maintenanceLabel;
                    break;
                default:
                    badgeValues.color = badgeConstants.naColor;
                    badgeValues.message = "N/A";
            }
        }

        // build the svg based on given values
        const svg = makeBadge(badgeValues);

        response.type("image/svg+xml");
        response.send(svg);
    } catch (error) {
        sendHttpError(response, error.message);
    }
});

router.get("/api/badge/:id/uptime/:duration?", cache("5 minutes"), async (request, response) => {
    allowAllOrigin(response);

    const {
        label,
        labelPrefix,
        labelSuffix = badgeConstants.defaultUptimeLabelSuffix,
        prefix,
        suffix = badgeConstants.defaultUptimeValueSuffix,
        color,
        labelColor,
        style = badgeConstants.defaultStyle,
        value, // for demo purpose only
    } = request.query;

    try {
        const requestedMonitorId = parseInt(request.params.id, 10);
        // if no duration is given, set value to 24 (h)
        let requestedDuration = request.params.duration !== undefined ? request.params.duration : "24h";
        const overrideValue = value && parseFloat(value);

        if (/^[0-9]+$/.test(requestedDuration)) {
            requestedDuration = `${requestedDuration}h`;
        }

        let publicMonitor = await R.getRow(`
                SELECT monitor_group.monitor_id FROM monitor_group, \`group\`
                WHERE monitor_group.group_id = \`group\`.id
                AND monitor_group.monitor_id = ?
                AND public = 1
            `,
        [ requestedMonitorId ]
        );

        const badgeValues = { style };

        if (!publicMonitor) {
            // return a "N/A" badge in naColor (grey), if monitor is not public / not available / non existent
            badgeValues.message = "N/A";
            badgeValues.color = badgeConstants.naColor;
        } else {
            const uptimeCalculator = await UptimeCalculator.getUptimeCalculator(requestedMonitorId);
            const uptime = overrideValue ?? uptimeCalculator.getDataByDuration(requestedDuration).uptime;

            // limit the displayed uptime percentage to four (two, when displayed as percent) decimal digits
            const cleanUptime = (uptime * 100).toPrecision(4);

            // use a given, custom color or calculate one based on the uptime value
            badgeValues.color = color ?? percentageToColor(uptime);
            // use a given, custom labelColor or use the default badge label color (defined by badge-maker)
            badgeValues.labelColor = labelColor ?? "";
            // build a label string. If a custom label is given, override the default one (requestedDuration)
            badgeValues.label = filterAndJoin([
                labelPrefix,
                label ?? `Uptime (${requestedDuration.slice(0, -1)}${labelSuffix})`,
            ]);
            badgeValues.message = filterAndJoin([ prefix, cleanUptime, suffix ]);
        }

        // build the SVG based on given values
        const svg = makeBadge(badgeValues);

        response.type("image/svg+xml");
        response.send(svg);
    } catch (error) {
        sendHttpError(response, error.message);
    }
});

router.get("/api/badge/:id/ping/:duration?", cache("5 minutes"), async (request, response) => {
    allowAllOrigin(response);

    const {
        label,
        labelPrefix,
        labelSuffix = badgeConstants.defaultPingLabelSuffix,
        prefix,
        suffix = badgeConstants.defaultPingValueSuffix,
        color = badgeConstants.defaultPingColor,
        labelColor,
        style = badgeConstants.defaultStyle,
        value, // for demo purpose only
    } = request.query;

    try {
        const requestedMonitorId = parseInt(request.params.id, 10);

        // Default duration is 24 (h) if not defined in queryParam, limited to 720h (30d)
        let requestedDuration = request.params.duration !== undefined ? request.params.duration : "24h";
        const overrideValue = value && parseFloat(value);

        if (/^[0-9]+$/.test(requestedDuration)) {
            requestedDuration = `${requestedDuration}h`;
        }

        // Check if monitor is public

        const uptimeCalculator = await UptimeCalculator.getUptimeCalculator(requestedMonitorId);
        const publicAvgPing = uptimeCalculator.getDataByDuration(requestedDuration).avgPing;

        const badgeValues = { style };

        if (!publicAvgPing) {
            // return a "N/A" badge in naColor (grey), if monitor is not public / not available / non exsitant

            badgeValues.message = "N/A";
            badgeValues.color = badgeConstants.naColor;
        } else {
            const avgPing = parseInt(overrideValue ?? publicAvgPing);

            badgeValues.color = color;
            // use a given, custom labelColor or use the default badge label color (defined by badge-maker)
            badgeValues.labelColor = labelColor ?? "";
            // build a lable string. If a custom label is given, override the default one (requestedDuration)
            badgeValues.label = filterAndJoin([ labelPrefix, label ?? `Avg. Ping (${requestedDuration.slice(0, -1)}${labelSuffix})` ]);
            badgeValues.message = filterAndJoin([ prefix, avgPing, suffix ]);
        }

        // build the SVG based on given values
        const svg = makeBadge(badgeValues);

        response.type("image/svg+xml");
        response.send(svg);
    } catch (error) {
        sendHttpError(response, error.message);
    }
});

router.get("/api/badge/:id/avg-response/:duration?", cache("5 minutes"), async (request, response) => {
    allowAllOrigin(response);

    const {
        label,
        labelPrefix,
        labelSuffix,
        prefix,
        suffix = badgeConstants.defaultPingValueSuffix,
        color = badgeConstants.defaultPingColor,
        labelColor,
        style = badgeConstants.defaultStyle,
        value, // for demo purpose only
    } = request.query;

    try {
        const requestedMonitorId = parseInt(request.params.id, 10);

        // Default duration is 24 (h) if not defined in queryParam, limited to 720h (30d)
        const requestedDuration = Math.min(
            request.params.duration
                ? parseInt(request.params.duration, 10)
                : 24,
            720
        );
        const overrideValue = value && parseFloat(value);

        const sqlHourOffset = Database.sqlHourOffset();

        const publicAvgPing = parseInt(await R.getCell(`
            SELECT AVG(ping) FROM monitor_group, \`group\`, heartbeat
            WHERE monitor_group.group_id = \`group\`.id
            AND heartbeat.time > ${sqlHourOffset}
            AND heartbeat.ping IS NOT NULL
            AND public = 1
            AND heartbeat.monitor_id = ?
            `,
        [ -requestedDuration, requestedMonitorId ]
        ));

        const badgeValues = { style };

        if (!publicAvgPing) {
            // return a "N/A" badge in naColor (grey), if monitor is not public / not available / non existent

            badgeValues.message = "N/A";
            badgeValues.color = badgeConstants.naColor;
        } else {
            const avgPing = parseInt(overrideValue ?? publicAvgPing);

            badgeValues.color = color;
            // use a given, custom labelColor or use the default badge label color (defined by badge-maker)
            badgeValues.labelColor = labelColor ?? "";
            // build a label string. If a custom label is given, override the default one (requestedDuration)
            badgeValues.label = filterAndJoin([
                labelPrefix,
                label ?? `Avg. Response (${requestedDuration}h)`,
                labelSuffix,
            ]);
            badgeValues.message = filterAndJoin([ prefix, avgPing, suffix ]);
        }

        // build the SVG based on given values
        const svg = makeBadge(badgeValues);

        response.type("image/svg+xml");
        response.send(svg);
    } catch (error) {
        sendHttpError(response, error.message);
    }
});

router.get("/api/badge/:id/cert-exp", cache("5 minutes"), async (request, response) => {
    allowAllOrigin(response);

    const date = request.query.date;

    const {
        label,
        labelPrefix,
        labelSuffix,
        prefix,
        suffix = date ? "" : badgeConstants.defaultCertExpValueSuffix,
        upColor = badgeConstants.defaultUpColor,
        warnColor = badgeConstants.defaultWarnColor,
        downColor = badgeConstants.defaultDownColor,
        warnDays = badgeConstants.defaultCertExpireWarnDays,
        downDays = badgeConstants.defaultCertExpireDownDays,
        labelColor,
        style = badgeConstants.defaultStyle,
        value, // for demo purpose only
    } = request.query;

    try {
        const requestedMonitorId = parseInt(request.params.id, 10);

        const overrideValue = value && parseFloat(value);

        let publicMonitor = await R.getRow(`
            SELECT monitor_group.monitor_id FROM monitor_group, \`group\`
            WHERE monitor_group.group_id = \`group\`.id
            AND monitor_group.monitor_id = ?
            AND public = 1
            `,
        [ requestedMonitorId ]
        );

        const badgeValues = { style };

        if (!publicMonitor) {
            // return a "N/A" badge in naColor (grey), if monitor is not public / not available / non existent

            badgeValues.message = "N/A";
            badgeValues.color = badgeConstants.naColor;
        } else {
            const tlsInfoBean = await R.findOne("monitor_tls_info", "monitor_id = ?", [
                requestedMonitorId,
            ]);

            if (!tlsInfoBean) {
                // return a "No/Bad Cert" badge in naColor (grey), if no cert saved (does not save bad certs?)
                badgeValues.message = "No/Bad Cert";
                badgeValues.color = badgeConstants.naColor;
            } else {
                const tlsInfo = JSON.parse(tlsInfoBean.info_json);

                if (!tlsInfo.valid) {
                    // return a "Bad Cert" badge in naColor (grey), when cert is not valid
                    badgeValues.message = "Bad Cert";
                    badgeValues.color = downColor;
                } else {
                    const daysRemaining = parseInt(overrideValue ?? tlsInfo.certInfo.daysRemaining);

                    if (daysRemaining > warnDays) {
                        badgeValues.color = upColor;
                    } else if (daysRemaining > downDays) {
                        badgeValues.color = warnColor;
                    } else {
                        badgeValues.color = downColor;
                    }
                    // use a given, custom labelColor or use the default badge label color (defined by badge-maker)
                    badgeValues.labelColor = labelColor ?? "";
                    // build a label string. If a custom label is given, override the default one
                    badgeValues.label = filterAndJoin([
                        labelPrefix,
                        label ?? "Cert Exp.",
                        labelSuffix,
                    ]);
                    badgeValues.message = filterAndJoin([ prefix, date ? tlsInfo.certInfo.validTo : daysRemaining, suffix ]);
                }
            }
        }

        // build the SVG based on given values
        const svg = makeBadge(badgeValues);

        response.type("image/svg+xml");
        response.send(svg);
    } catch (error) {
        sendHttpError(response, error.message);
    }
});

router.get("/api/badge/:id/response", cache("5 minutes"), async (request, response) => {
    allowAllOrigin(response);

    const {
        label,
        labelPrefix,
        labelSuffix,
        prefix,
        suffix = badgeConstants.defaultPingValueSuffix,
        color = badgeConstants.defaultPingColor,
        labelColor,
        style = badgeConstants.defaultStyle,
        value, // for demo purpose only
    } = request.query;

    try {
        const requestedMonitorId = parseInt(request.params.id, 10);

        const overrideValue = value && parseFloat(value);

        let publicMonitor = await R.getRow(`
            SELECT monitor_group.monitor_id FROM monitor_group, \`group\`
            WHERE monitor_group.group_id = \`group\`.id
            AND monitor_group.monitor_id = ?
            AND public = 1
            `,
        [ requestedMonitorId ]
        );

        const badgeValues = { style };

        if (!publicMonitor) {
            // return a "N/A" badge in naColor (grey), if monitor is not public / not available / non existent

            badgeValues.message = "N/A";
            badgeValues.color = badgeConstants.naColor;
        } else {
            const heartbeat = await Monitor.getPreviousHeartbeat(
                requestedMonitorId
            );

            if (!heartbeat.ping) {
                // return a "N/A" badge in naColor (grey), if previous heartbeat has no ping

                badgeValues.message = "N/A";
                badgeValues.color = badgeConstants.naColor;
            } else {
                const ping = parseInt(overrideValue ?? heartbeat.ping);

                badgeValues.color = color;
                // use a given, custom labelColor or use the default badge label color (defined by badge-maker)
                badgeValues.labelColor = labelColor ?? "";
                // build a label string. If a custom label is given, override the default one
                badgeValues.label = filterAndJoin([
                    labelPrefix,
                    label ?? "Response",
                    labelSuffix,
                ]);
                badgeValues.message = filterAndJoin([ prefix, ping, suffix ]);
            }
        }

        // build the SVG based on given values
        const svg = makeBadge(badgeValues);

        response.type("image/svg+xml");
        response.send(svg);
    } catch (error) {
        sendHttpError(response, error.message);
    }
});

/**
 * Determines the status of the next beat in the push route handling.
 * @param {string} status - The reported new status.
 * @param {object} previousHeartbeat - The previous heartbeat object.
 * @param {number} maxretries - The maximum number of retries allowed.
 * @param {boolean} isUpsideDown - Indicates if the monitor is upside down.
 * @param {object} bean - The new heartbeat object.
 * @returns {void}
 */
function determineStatus(status, previousHeartbeat, maxretries, isUpsideDown, bean) {
    if (isUpsideDown) {
        status = flipStatus(status);
    }

    if (previousHeartbeat) {
        if (previousHeartbeat.status === UP && status === DOWN) {
            // Going Down
            if ((maxretries > 0) && (previousHeartbeat.retries < maxretries)) {
                // Retries available
                bean.retries = previousHeartbeat.retries + 1;
                bean.status = PENDING;
            } else {
                // No more retries
                bean.retries = 0;
                bean.status = DOWN;
            }
        } else if (previousHeartbeat.status === PENDING && status === DOWN && previousHeartbeat.retries < maxretries) {
            // Retries available
            bean.retries = previousHeartbeat.retries + 1;
            bean.status = PENDING;
        } else {
            // No more retries or not pending
            if (status === DOWN) {
                bean.retries = previousHeartbeat.retries + 1;
                bean.status = status;
            } else {
                bean.retries = 0;
                bean.status = status;
            }
        }
    } else {
        // First beat?
        if (status === DOWN && maxretries > 0) {
            // Retries available
            bean.retries = 1;
            bean.status = PENDING;
        } else {
            // Retires not enabled
            bean.retries = 0;
            bean.status = status;
        }
    }
}

// Dashboard Status API with configurable granularity
router.get("/api/status", cache("1 minutes"), async (request, response) => {
    allowDevAllOrigin(response);
    
    try {
        const {
            granularity = "hour", // minute, hour, day, auto
            days = 1,
            maxPoints = 100,
            monitorIds, // comma-separated list of monitor IDs (optional)
            format = "detailed", // detailed, heartbeat (for compatibility)
            startDate = null, // Start date/time (ISO string or YYYY-MM-DD)
            endDate = null, // End date/time (ISO string or YYYY-MM-DD)
            date = null // Specific date (YYYY-MM-DD) - shorthand for full day
        } = request.query;
        
        // Process date range parameters
        let startTime, endTime, actualDays;
        
        if (date) {
            // Specific date - get full day (00:00:00 to 23:59:59)
            const targetDate = dayjs(date);
            if (!targetDate.isValid()) {
                throw new Error("Invalid date format. Use YYYY-MM-DD");
            }
            startTime = targetDate.startOf('day');
            endTime = targetDate.endOf('day');
            actualDays = 1;
        } else if (startDate && endDate) {
            // Custom date range
            startTime = dayjs(startDate);
            endTime = dayjs(endDate);
            if (!startTime.isValid() || !endTime.isValid()) {
                throw new Error("Invalid date format. Use ISO string (YYYY-MM-DDTHH:mm:ss) or YYYY-MM-DD");
            }
            if (endTime.isBefore(startTime)) {
                throw new Error("End date must be after start date");
            }
            actualDays = endTime.diff(startTime, 'day', true); // true for fractional days
        } else if (startDate) {
            // Start date only - go from start date to now
            startTime = dayjs(startDate);
            if (!startTime.isValid()) {
                throw new Error("Invalid start date format. Use ISO string (YYYY-MM-DDTHH:mm:ss) or YYYY-MM-DD");
            }
            endTime = dayjs();
            actualDays = endTime.diff(startTime, 'day', true);
        } else {
            // Default behavior - use days parameter from now
            const requestedDays = parseFloat(days);
            actualDays = requestedDays;
            endTime = dayjs();
            startTime = endTime.subtract(requestedDays, 'day');
        }
        
        let result = {
            monitors: {},
            config: {
                granularity,
                days: actualDays,
                maxPoints: parseInt(maxPoints),
                format,
                startDate: startTime.toISOString(),
                endDate: endTime.toISOString(),
                timestamp: new Date().toISOString()
            }
        };
        
        // Get list of monitor IDs to fetch data for
        let targetMonitorIds = [];
        if (monitorIds) {
            targetMonitorIds = monitorIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        } else {
            // Get all active monitors if no specific IDs provided
            targetMonitorIds = await R.getCol("SELECT id FROM monitor WHERE active = 1");
        }
        
        // Process each monitor
        for (const monitorId of targetMonitorIds) {
            try {
                const uptimeCalculator = await UptimeCalculator.getUptimeCalculator(monitorId);
                const monitor = await R.findOne("monitor", "id = ?", [monitorId]);
                
                if (!monitor) continue;
                
                let dataPoints = [];
                let uptimeData = null;
                let actualGranularity = granularity.toLowerCase();
                
                // Auto-detect granularity based on requested time range
                if (actualGranularity === "auto") {
                    if (actualDays <= 1) {
                        actualGranularity = "minute";
                    } else if (actualDays <= 30) {
                        actualGranularity = "hour";
                    } else {
                        actualGranularity = "day";
                    }
                }
                
                // Get data based on granularity
                switch (actualGranularity) {
                    case "minute":
                        if (actualDays <= 1 && !startDate && !endDate && !date) {
                            // For recent minute-level data (within 24 hours), use in-memory data
                            const minutesToFetch = Math.min(Math.ceil(requestedDays * 24 * 60), 1440);
                            const rawData = uptimeCalculator.getDataArray(minutesToFetch, "minute");
                            
                            if (format === "heartbeat") {
                                // Use aggregated buckets for heartbeat format
                                const buckets = uptimeCalculator.getAggregatedBuckets(requestedDays, parseInt(maxPoints));
                                dataPoints = buckets.map(bucket => {
                                    if (bucket.up === 0 && bucket.down === 0 && bucket.maintenance === 0 && bucket.pending === 0) {
                                        return 0; // Empty beat
                                    }
                                    return {
                                        status: bucket.down > 0 ? DOWN :
                                            bucket.maintenance > 0 ? MAINTENANCE :
                                                bucket.pending > 0 ? PENDING :
                                                    bucket.up > 0 ? UP : 0,
                                        time: dayjs.unix(bucket.end).toISOString(),
                                        msg: "",
                                        ping: null
                                    };
                                });
                            } else {
                                dataPoints = rawData.map(point => ({
                                    timestamp: point.timestamp,
                                    time: dayjs.unix(point.timestamp).toISOString(),
                                    status: point.up > 0 ? UP : (point.down > 0 ? DOWN : 0),
                                    uptime: point.up || 0,
                                    downtime: point.down || 0
                                }));
                            }
                            uptimeData = uptimeCalculator.get24Hour();
                        } else {
                            // For historical or custom date range minute-level data, query database directly
                            // WARNING: This can be very resource intensive for large time ranges!
                            const maxDaysForMinuteData = 365; // Allow up to 1 year
                            if (actualDays > maxDaysForMinuteData) {
                                throw new Error(`Minute-level data is only available for up to ${maxDaysForMinuteData} days`);
                            }
                            
                            // Calculate total minutes requested
                            const totalMinutes = Math.ceil(actualDays * 24 * 60);
                            if (totalMinutes > parseInt(maxPoints) * 100) {
                                log.warn("api", `Large minute-level request: ${totalMinutes} minutes for monitor ${monitorId}`);
                            }
                            
                            // Query raw heartbeat data from database using calculated date range
                            const heartbeats = await R.getAll(`
                                SELECT time, status, msg, ping 
                                FROM heartbeat 
                                WHERE monitor_id = ? 
                                AND time >= ? 
                                AND time <= ?
                                ORDER BY time ASC
                            `, [
                                monitorId,
                                startTime.toISOString(),
                                endTime.toISOString()
                            ]);
                            
                            if (format === "heartbeat") {
                                // For heartbeat format, use aggregated buckets to manage response size
                                const buckets = uptimeCalculator.getAggregatedBuckets(requestedDays, parseInt(maxPoints));
                                dataPoints = buckets.map(bucket => {
                                    if (bucket.up === 0 && bucket.down === 0 && bucket.maintenance === 0 && bucket.pending === 0) {
                                        return 0; // Empty beat
                                    }
                                    return {
                                        status: bucket.down > 0 ? DOWN :
                                            bucket.maintenance > 0 ? MAINTENANCE :
                                                bucket.pending > 0 ? PENDING :
                                                    bucket.up > 0 ? UP : 0,
                                        time: dayjs.unix(bucket.end).toISOString(),
                                        msg: "",
                                        ping: null
                                    };
                                });
                            } else {
                                // Convert raw heartbeat data to minute-level aggregates
                                const minuteMap = new Map();
                                
                                for (const heartbeat of heartbeats) {
                                    const minuteKey = Math.floor(dayjs(heartbeat.time).unix() / 60) * 60;
                                    
                                    if (!minuteMap.has(minuteKey)) {
                                        minuteMap.set(minuteKey, {
                                            timestamp: minuteKey,
                                            time: dayjs.unix(minuteKey).toISOString(),
                                            upCount: 0,
                                            downCount: 0,
                                            totalCount: 0,
                                            avgPing: 0,
                                            pings: []
                                        });
                                    }
                                    
                                    const minute = minuteMap.get(minuteKey);
                                    minute.totalCount++;
                                    
                                    if (heartbeat.status === UP) {
                                        minute.upCount++;
                                    } else if (heartbeat.status === DOWN) {
                                        minute.downCount++;
                                    }
                                    
                                    if (heartbeat.ping !== null && heartbeat.ping !== undefined) {
                                        minute.pings.push(heartbeat.ping);
                                    }
                                }
                                
                                // Convert map to array and calculate final stats
                                dataPoints = Array.from(minuteMap.values()).map(minute => {
                                    const avgPing = minute.pings.length > 0 ? 
                                        minute.pings.reduce((a, b) => a + b, 0) / minute.pings.length : null;
                                    
                                    return {
                                        timestamp: minute.timestamp,
                                        time: minute.time,
                                        status: minute.upCount > minute.downCount ? UP : 
                                               minute.downCount > 0 ? DOWN : 0,
                                        uptime: minute.totalCount > 0 ? minute.upCount / minute.totalCount : 0,
                                        downtime: minute.totalCount > 0 ? minute.downCount / minute.totalCount : 0,
                                        avgPing: avgPing,
                                        heartbeatCount: minute.totalCount
                                    };
                                }).sort((a, b) => a.timestamp - b.timestamp);
                            }
                            
                            // Calculate overall uptime based on requested period
                            if (requestedDays <= 1) {
                                uptimeData = uptimeCalculator.get24Hour();
                            } else if (requestedDays <= 7) {
                                uptimeData = uptimeCalculator.get7Day();
                            } else if (requestedDays <= 30) {
                                uptimeData = uptimeCalculator.get30Day();
                            } else {
                                uptimeData = uptimeCalculator.getData(Math.ceil(requestedDays), "day");
                            }
                        }
                        break;
                        
                    case "hour":
                        if (actualDays <= 30) {
                            // For hour-level data, limit to 30 days max
                            const hoursToFetch = Math.min(Math.ceil(actualDays * 24), 720);
                            
                            if (format === "heartbeat") {
                                // Use aggregated buckets for heartbeat format
                                const buckets = uptimeCalculator.getAggregatedBuckets(requestedDays, parseInt(maxPoints));
                                dataPoints = buckets.map(bucket => {
                                    if (bucket.up === 0 && bucket.down === 0 && bucket.maintenance === 0 && bucket.pending === 0) {
                                        return 0; // Empty beat
                                    }
                                    return {
                                        status: bucket.down > 0 ? DOWN :
                                            bucket.maintenance > 0 ? MAINTENANCE :
                                                bucket.pending > 0 ? PENDING :
                                                    bucket.up > 0 ? UP : 0,
                                        time: dayjs.unix(bucket.end).toISOString(),
                                        msg: "",
                                        ping: null
                                    };
                                });
                            } else {
                                const rawData = uptimeCalculator.getDataArray(hoursToFetch, "hour");
                                dataPoints = rawData.map(point => ({
                                    timestamp: point.timestamp,
                                    time: dayjs.unix(point.timestamp).toISOString(),
                                    status: point.up > 0 ? UP : (point.down > 0 ? DOWN : 0),
                                    uptime: point.up || 0,
                                    downtime: point.down || 0
                                }));
                            }
                            uptimeData = uptimeCalculator.getData(Math.ceil(requestedDays), "day");
                        } else {
                            throw new Error("Hour-level data is only available for up to 30 days");
                        }
                        break;
                        
                    case "day":
                        // For day-level data, limit to 365 days max
                        const daysToFetch = Math.min(Math.ceil(actualDays), 365);
                        
                        if (format === "heartbeat") {
                            // Use aggregated buckets for heartbeat format
                            const buckets = uptimeCalculator.getAggregatedBuckets(requestedDays, parseInt(maxPoints));
                            dataPoints = buckets.map(bucket => {
                                if (bucket.up === 0 && bucket.down === 0 && bucket.maintenance === 0 && bucket.pending === 0) {
                                    return 0; // Empty beat
                                }
                                return {
                                    status: bucket.down > 0 ? DOWN :
                                        bucket.maintenance > 0 ? MAINTENANCE :
                                            bucket.pending > 0 ? PENDING :
                                                bucket.up > 0 ? UP : 0,
                                    time: dayjs.unix(bucket.end).toISOString(),
                                    msg: "",
                                    ping: null
                                };
                            });
                        } else {
                            const rawData = uptimeCalculator.getDataArray(daysToFetch, "day");
                            dataPoints = rawData.map(point => ({
                                timestamp: point.timestamp,
                                time: dayjs.unix(point.timestamp).toISOString(),
                                status: point.up > 0 ? UP : (point.down > 0 ? DOWN : 0),
                                uptime: point.up || 0,
                                downtime: point.down || 0
                            }));
                        }
                        uptimeData = uptimeCalculator.getData(daysToFetch, "day");
                        break;
                        
                    default:
                        throw new Error("Invalid granularity. Use 'minute', 'hour', 'day', or 'auto'");
                }
                
                // Limit number of data points if requested and not using heartbeat format with buckets
                if (format !== "heartbeat" && dataPoints.length > parseInt(maxPoints)) {
                    const step = Math.ceil(dataPoints.length / parseInt(maxPoints));
                    dataPoints = dataPoints.filter((_, index) => index % step === 0);
                }
                
                result.monitors[monitorId] = {
                    id: monitorId,
                    name: monitor.name,
                    type: monitor.type,
                    url: monitor.url,
                    dataPoints: dataPoints,
                    actualGranularity: actualGranularity,
                    summary: {
                        uptime: uptimeData ? uptimeData.uptime : 0,
                        avgPing: uptimeData ? uptimeData.avgPing : null,
                        totalDataPoints: dataPoints.length
                    }
                };
                
            } catch (error) {
                log.error("api", `Error fetching data for monitor ${monitorId}: ${error.message}`);
                result.monitors[monitorId] = {
                    id: monitorId,
                    error: error.message
                };
            }
        }
        
        response.json(result);
        
    } catch (error) {
        log.error("api", `Dashboard status API error: ${error.message}`);
        response.status(400).json({
            ok: false,
            msg: error.message
        });
    }
});

// Simplified Dashboard Status API with presets for common use cases
router.get("/api/dashboard/status", cache("1 minutes"), async (request, response) => {
    allowDevAllOrigin(response);
    
    try {
        const {
            preset = "hourly", // minutely, hourly, daily, yearly, custom
            days = null, // defaults based on preset
            interval = null, // minutes between data points for custom preset
            monitorIds,
            startDate = null, // Start date/time (ISO string or YYYY-MM-DD)
            endDate = null, // End date/time (ISO string or YYYY-MM-DD)
            date = null // Specific date (YYYY-MM-DD) - shorthand for full day
        } = request.query;
        
        let granularity, requestedDays, maxPoints;
        
        // Configure based on preset
        switch (preset.toLowerCase()) {
            case "minutely":
                granularity = "minute";
                requestedDays = days ? parseFloat(days) : 1; // Default to 1 day
                maxPoints = Math.min(requestedDays * 24 * 60, 1440); // Up to 1440 minutes for 1 day
                break;
                
            case "hourly":
                granularity = "hour";
                requestedDays = days ? parseFloat(days) : 7; // Default to 7 days
                maxPoints = Math.min(requestedDays * 24, 720); // Up to 720 hours (30 days max)
                break;
                
            case "daily":
                granularity = "day";
                requestedDays = days ? parseFloat(days) : 30; // Default to 30 days
                maxPoints = Math.min(requestedDays, 365); // Up to 365 days
                break;
                
            case "yearly":
                // Special preset for getting every minute of the year
                granularity = "minute";
                requestedDays = days ? parseFloat(days) : 365; // Default to 1 year
                maxPoints = 525600; // 365 * 24 * 60 = all minutes in a year
                break;
                
            case "custom":
                if (!interval) {
                    throw new Error("Custom preset requires 'interval' parameter (minutes between data points)");
                }
                const intervalMinutes = parseInt(interval);
                requestedDays = days ? parseFloat(days) : 7;
                
                if (intervalMinutes < 60) {
                    granularity = "minute";
                    maxPoints = Math.min(requestedDays * 24 * 60 / intervalMinutes, 1440);
                } else if (intervalMinutes < 1440) {
                    granularity = "hour";
                    maxPoints = Math.min(requestedDays * 24 / (intervalMinutes / 60), 720);
                } else {
                    granularity = "day";
                    maxPoints = Math.min(requestedDays / (intervalMinutes / 1440), 365);
                }
                break;
                
            default:
                throw new Error("Invalid preset. Use 'minutely', 'hourly', 'daily', or 'custom'");
        }
        
        // Redirect to main status API with calculated parameters
        const params = new URLSearchParams({
            granularity: granularity,
            days: requestedDays.toString(),
            maxPoints: Math.ceil(maxPoints).toString(),
            format: "detailed"
        });
        
        if (monitorIds) {
            params.append("monitorIds", monitorIds);
        }
        
        // Add date parameters if provided
        if (date) {
            params.append("date", date);
        }
        if (startDate) {
            params.append("startDate", startDate);
        }
        if (endDate) {
            params.append("endDate", endDate);
        }
        
        // Forward the request internally to the main status endpoint
        const apiUrl = `/api/status?${params.toString()}`;
        
        // Make internal request (we'll redirect the logic instead of making HTTP call)
        request.query = Object.fromEntries(params.entries());
        if (monitorIds) {
            request.query.monitorIds = monitorIds;
        }
        if (date) {
            request.query.date = date;
        }
        if (startDate) {
            request.query.startDate = startDate;
        }
        if (endDate) {
            request.query.endDate = endDate;
        }
        
        // Call the main status API logic directly
        const {
            granularity: queryGranularity = "hour",
            days: queryDays = "1",
            maxPoints: queryMaxPoints = "100",
            monitorIds: queryMonitorIds,
            format = "detailed"
        } = request.query;
        
        let result = {
            monitors: {},
            config: {
                preset: preset.toLowerCase(),
                granularity: queryGranularity,
                days: parseFloat(queryDays),
                maxPoints: parseInt(queryMaxPoints),
                format,
                timestamp: new Date().toISOString()
            }
        };
        
        // Get list of monitor IDs to fetch data for
        let targetMonitorIds = [];
        if (queryMonitorIds) {
            targetMonitorIds = queryMonitorIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        } else {
            // Get all active monitors if no specific IDs provided
            targetMonitorIds = await R.getCol("SELECT id FROM monitor WHERE active = 1");
        }
        
        const finalRequestedDays = parseFloat(queryDays);
        
        // Process each monitor (same logic as main API)
        for (const monitorId of targetMonitorIds) {
            try {
                const uptimeCalculator = await UptimeCalculator.getUptimeCalculator(monitorId);
                const monitor = await R.findOne("monitor", "id = ?", [monitorId]);
                
                if (!monitor) continue;
                
                let dataPoints = [];
                let uptimeData = null;
                let actualGranularity = queryGranularity.toLowerCase();
                
                // Get data based on granularity
                switch (actualGranularity) {
                    case "minute":
                        if (finalRequestedDays <= 1) {
                            // Use in-memory data for recent minute-level data
                            const minutesToFetch = Math.min(Math.ceil(finalRequestedDays * 24 * 60), 1440);
                            const rawData = uptimeCalculator.getDataArray(minutesToFetch, "minute");
                            dataPoints = rawData.map(point => ({
                                timestamp: point.timestamp,
                                time: dayjs.unix(point.timestamp).toISOString(),
                                status: point.up > 0 ? UP : (point.down > 0 ? DOWN : 0),
                                uptime: point.up || 0,
                                downtime: point.down || 0
                            }));
                            uptimeData = uptimeCalculator.get24Hour();
                        } else {
                            // For historical minute-level data, query database directly
                            const maxDaysForMinuteData = 365; // Allow up to 1 year
                            if (finalRequestedDays > maxDaysForMinuteData) {
                                throw new Error(`Minute-level data is only available for up to ${maxDaysForMinuteData} days`);
                            }
                            
                            const totalMinutes = Math.ceil(finalRequestedDays * 24 * 60);
                            if (totalMinutes > parseInt(queryMaxPoints) * 100) {
                                log.warn("api", `Large minute-level request: ${totalMinutes} minutes for monitor ${monitorId}`);
                            }
                            
                            // Query raw heartbeat data from database
                            const startTime = dayjs().subtract(finalRequestedDays, 'day');
                            const heartbeats = await R.getAll(`
                                SELECT time, status, msg, ping 
                                FROM heartbeat 
                                WHERE monitor_id = ? 
                                AND time >= ? 
                                ORDER BY time ASC
                            `, [
                                monitorId,
                                startTime.toISOString()
                            ]);
                            
                            // Convert raw heartbeat data to minute-level aggregates
                            const minuteMap = new Map();
                            
                            for (const heartbeat of heartbeats) {
                                const minuteKey = Math.floor(dayjs(heartbeat.time).unix() / 60) * 60;
                                
                                if (!minuteMap.has(minuteKey)) {
                                    minuteMap.set(minuteKey, {
                                        timestamp: minuteKey,
                                        time: dayjs.unix(minuteKey).toISOString(),
                                        upCount: 0,
                                        downCount: 0,
                                        totalCount: 0,
                                        pings: []
                                    });
                                }
                                
                                const minute = minuteMap.get(minuteKey);
                                minute.totalCount++;
                                
                                if (heartbeat.status === UP) {
                                    minute.upCount++;
                                } else if (heartbeat.status === DOWN) {
                                    minute.downCount++;
                                }
                                
                                if (heartbeat.ping !== null && heartbeat.ping !== undefined) {
                                    minute.pings.push(heartbeat.ping);
                                }
                            }
                            
                            // Convert map to array and calculate final stats
                            dataPoints = Array.from(minuteMap.values()).map(minute => {
                                const avgPing = minute.pings.length > 0 ? 
                                    minute.pings.reduce((a, b) => a + b, 0) / minute.pings.length : null;
                                
                                return {
                                    timestamp: minute.timestamp,
                                    time: minute.time,
                                    status: minute.upCount > minute.downCount ? UP : 
                                           minute.downCount > 0 ? DOWN : 0,
                                    uptime: minute.totalCount > 0 ? minute.upCount / minute.totalCount : 0,
                                    downtime: minute.totalCount > 0 ? minute.downCount / minute.totalCount : 0,
                                    avgPing: avgPing,
                                    heartbeatCount: minute.totalCount
                                };
                            }).sort((a, b) => a.timestamp - b.timestamp);
                            
                            // Calculate overall uptime
                            if (finalRequestedDays <= 7) {
                                uptimeData = uptimeCalculator.get7Day();
                            } else if (finalRequestedDays <= 30) {
                                uptimeData = uptimeCalculator.get30Day();
                            } else {
                                uptimeData = uptimeCalculator.getData(Math.ceil(finalRequestedDays), "day");
                            }
                        }
                        break;
                        
                    case "hour":
                        if (finalRequestedDays <= 30) {
                            const hoursToFetch = Math.min(Math.ceil(finalRequestedDays * 24), 720);
                            const rawData = uptimeCalculator.getDataArray(hoursToFetch, "hour");
                            dataPoints = rawData.map(point => ({
                                timestamp: point.timestamp,
                                time: dayjs.unix(point.timestamp).toISOString(),
                                status: point.up > 0 ? UP : (point.down > 0 ? DOWN : 0),
                                uptime: point.up || 0,
                                downtime: point.down || 0
                            }));
                            uptimeData = uptimeCalculator.getData(Math.ceil(finalRequestedDays), "day");
                        } else {
                            throw new Error("Hour-level data is only available for up to 30 days");
                        }
                        break;
                        
                    case "day":
                        const daysToFetch = Math.min(Math.ceil(finalRequestedDays), 365);
                        const rawData = uptimeCalculator.getDataArray(daysToFetch, "day");
                        dataPoints = rawData.map(point => ({
                            timestamp: point.timestamp,
                            time: dayjs.unix(point.timestamp).toISOString(),
                            status: point.up > 0 ? UP : (point.down > 0 ? DOWN : 0),
                            uptime: point.up || 0,
                            downtime: point.down || 0
                        }));
                        uptimeData = uptimeCalculator.getData(daysToFetch, "day");
                        break;
                        
                    default:
                        throw new Error("Invalid granularity. Use 'minute', 'hour', or 'day'");
                }
                
                // Apply maxPoints limit if needed
                if (dataPoints.length > parseInt(queryMaxPoints)) {
                    const step = Math.ceil(dataPoints.length / parseInt(queryMaxPoints));
                    dataPoints = dataPoints.filter((_, index) => index % step === 0);
                }
                
                result.monitors[monitorId] = {
                    id: monitorId,
                    name: monitor.name,
                    type: monitor.type,
                    url: monitor.url,
                    dataPoints: dataPoints,
                    actualGranularity: actualGranularity,
                    summary: {
                        uptime: uptimeData ? uptimeData.uptime : 0,
                        avgPing: uptimeData ? uptimeData.avgPing : null,
                        totalDataPoints: dataPoints.length
                    }
                };
                
            } catch (error) {
                log.error("api", `Error fetching data for monitor ${monitorId}: ${error.message}`);
                result.monitors[monitorId] = {
                    id: monitorId,
                    error: error.message
                };
            }
        }
        
        response.json(result);
        
    } catch (error) {
        log.error("api", `Dashboard status API error: ${error.message}`);
        response.status(400).json({
            ok: false,
            msg: error.message
        });
    }
});

module.exports = router;
