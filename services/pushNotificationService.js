// pushNotificationService.js
// Reusable FCM push-notification sender. Reuses the device_tokens table
// created in Module 2. Never throws — every function resolves with a
// summary object, so a push failure can never crash or fail the caller's
// API response (same non-blocking contract as services/emailService.js).
const {getMessaging} = require("firebase-admin/messaging");
const {app: firebaseApp} = require("../configure/firebaseAdmin");
const pool = require("../configure/dbConfig");

const MAX_TOKENS_PER_BATCH = 500; // FCM sendEachForMulticast limit

const INVALID_TOKEN_ERROR_CODES = new Set([
    "messaging/invalid-registration-token",
    "messaging/registration-token-not-registered",
    "messaging/invalid-argument",
]);

function isFirebaseReady() {
    return Boolean(firebaseApp);
}

function chunk(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

async function removeInvalidTokens(tokens) {
    if (!tokens.length) return;
    try {
        await pool.query(
            "DELETE FROM device_tokens WHERE fcm_token = ANY($1::text[])",
            [tokens]
        );
    } catch (err) {
        console.error("Failed to remove invalid device tokens:", err.message);
    }
}

function emptySummary() {
    return {attempted: 0, successCount: 0, failureCount: 0, invalidTokensRemoved: 0};
}

/**
 * Sends an FCM notification to a list of raw device tokens.
 * @param {string[]} tokens
 * @param {{title: string, body: string, data?: Record<string, unknown>}} notification
 */
async function sendPushNotificationToTokens(tokens, {title, body, data} = {}) {
    const uniqueTokens = [...new Set((tokens || []).filter(Boolean))];
    const summary = {...emptySummary(), attempted: uniqueTokens.length};

    if (!uniqueTokens.length) {
        return summary;
    }

    if (!isFirebaseReady()) {
        console.error("Push notification skipped: Firebase Admin is not configured.");
        summary.failureCount = uniqueTokens.length;
        return summary;
    }

    // FCM data payload values must be strings.
    const stringData = data
        ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]))
        : undefined;

    const invalidTokens = [];

    for (const batch of chunk(uniqueTokens, MAX_TOKENS_PER_BATCH)) {
        try {
            const response = await getMessaging(firebaseApp).sendEachForMulticast({
                tokens: batch,
                notification: {title, body},
                ...(stringData ? {data: stringData} : {}),
            });

            summary.successCount += response.successCount;
            summary.failureCount += response.failureCount;

            response.responses.forEach((res, idx) => {
                if (res.success) return;
                const code = res.error?.code;
                if (code && INVALID_TOKEN_ERROR_CODES.has(code)) {
                    invalidTokens.push(batch[idx]);
                } else {
                    console.error("FCM send failed for a token:", res.error?.message || code);
                }
            });
        } catch (err) {
            console.error("Failed to send FCM batch:", err.message);
            summary.failureCount += batch.length;
        }
    }

    if (invalidTokens.length) {
        await removeInvalidTokens(invalidTokens);
        summary.invalidTokensRemoved = invalidTokens.length;
    }

    return summary;
}

/**
 * Sends an FCM notification to every registered device for the given
 * employee id(s), looking up tokens from device_tokens.
 * @param {number | number[]} employeeIds
 * @param {{title: string, body: string, data?: Record<string, unknown>}} notification
 */
async function sendPushNotificationToEmployees(employeeIds, {title, body, data} = {}) {
    const ids = (Array.isArray(employeeIds) ? employeeIds : [employeeIds]).filter(
        id => id !== null && id !== undefined
    );

    if (!ids.length) {
        return emptySummary();
    }

    try {
        const result = await pool.query(
            "SELECT fcm_token FROM device_tokens WHERE employee_id = ANY($1::int[])",
            [ids]
        );
        const tokens = result.rows.map(row => row.fcm_token);
        return sendPushNotificationToTokens(tokens, {title, body, data});
    } catch (err) {
        console.error("Failed to look up device tokens for employees:", err.message);
        return emptySummary();
    }
}

module.exports = {
    sendPushNotificationToTokens,
    sendPushNotificationToEmployees,
};
