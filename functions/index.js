// functions/index.js

const admin = require("firebase-admin");
admin.initializeApp();
const DEPLOY_BUMP = "2026-01-23-1";

// ---- Gen 2 global options ----
const SA_EMAIL = "present-functions@sci-sim-c6923.iam.gserviceaccount.com";

const { setGlobalOptions } = require("firebase-functions/v2");
const { onRequest } = require("firebase-functions/v2/https");

// Wrapper so you can keep fn.https.onRequest(...) everywhere (your preference)
const fn = { https: { onRequest } };

// Force region + runtime service account for ALL functions in this file
setGlobalOptions({
    region: "us-central1",
    serviceAccount: SA_EMAIL,
});

/**
 * Simple health check
 */
exports.ping = fn.https.onRequest((req, res) => {
    res.status(200).send("pong");
});

/**
 * Paddle webhook (MVP: no signature verification)
 * Listens for: transaction.completed
 * Writes to Firestore: submissions/{submissionId} => paid=true, transactionId, email (if present)
 */
exports.paddleWebhook = fn.https.onRequest(async (req, res) => {
    try {
        if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

        const body = req.body || {};
        const eventType = body.event_type || body.eventType || null;

        if (eventType !== "transaction.completed") {
            return res.status(200).send("ignored");
        }

        const data = body.data || {};
        const customData = data.custom_data || data.customData || {};
        const submissionId = customData.submissionId || null;

        const transactionId =
            data.id || data.transaction_id || data.transactionId || null;

        if (!submissionId) {
            console.warn("Missing submissionId. customData keys:", Object.keys(customData || {}));
            return res.status(400).send("Missing submissionId");
        }

        function findEmailDeep(obj) {
            if (!obj || typeof obj !== "object") return null;
            const stack = [obj];
            const seen = new Set();

            while (stack.length) {
                const cur = stack.pop();
                if (!cur || typeof cur !== "object") continue;
                if (seen.has(cur)) continue;
                seen.add(cur);

                for (const [, v] of Object.entries(cur)) {
                    if (typeof v === "string") {
                        if (v.includes("@") && v.includes(".")) return v;
                    } else if (v && typeof v === "object") {
                        stack.push(v);
                    }
                }
            }
            return null;
        }

        const email =
            (data.customer && data.customer.email) ||
            (data.billing_details && data.billing_details.email) ||
            (data.user && data.user.email) ||
            (data.address && data.address.email) ||
            findEmailDeep(data) ||
            null;

        const emailMissing = !email;
        if (emailMissing) {
            console.warn(
                "Webhook missing email. Writing paid=true anyway.",
                "txn:", transactionId,
                "data keys:", Object.keys(data || {})
            );
        }

        await admin.firestore().doc(`submissions/${submissionId}`).set(
            {
                submissionId,
                paid: true,
                status: "paid",
                transactionId: transactionId || null,
                email: email || null,
                emailMissing,
                paidAt: admin.firestore.FieldValue.serverTimestamp(),
                rawEventType: eventType,
            },
            { merge: true }
        );

        return res.status(200).send("ok");
    } catch (err) {
        console.error("paddleWebhook error:", err);
        return res.status(500).send("error");
    }
});

/**
 * Create submission doc BEFORE checkout opens
 * Body: { submissionId, presenterName }
 */
exports.createSubmission = fn.https.onRequest(async (req, res) => {
    try {
        // CORS
        res.set("Access-Control-Allow-Origin", "*");
        res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.set("Access-Control-Allow-Headers", "Content-Type");
        if (req.method === "OPTIONS") return res.status(204).send("");
        if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

        const { submissionId, presenterName } = req.body || {};
        if (!submissionId) return res.status(400).send("Missing submissionId");

        await admin.firestore().doc(`submissions/${submissionId}`).set(
            {
                submissionId,
                presenterName: presenterName || null,
                status: "pending_payment",
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
        );

        return res.status(200).send("ok");
    } catch (e) {
        console.error("createSubmission error:", e);
        return res.status(500).send("error");
    }
});

/**
 * Patch submission email from frontend (admin write)
 * Body: { submissionId, transactionId, email }
 */
exports.patchSubmissionEmail = fn.https.onRequest(async (req, res) => {
    try {
        // CORS
        res.set("Access-Control-Allow-Origin", "*");
        res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.set("Access-Control-Allow-Headers", "Content-Type");
        if (req.method === "OPTIONS") return res.status(204).send("");

        if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

        const { submissionId, transactionId, email } = req.body || {};
        if (!submissionId || !transactionId || !email) {
            return res.status(400).send("Missing submissionId, transactionId, or email");
        }

        const docRef = admin.firestore().doc(`submissions/${submissionId}`);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).send("Submission not found");

        const data = snap.data() || {};
        if (!data.transactionId) {
            return res.status(409).send("Submission missing transactionId (webhook not written yet)");
        }
        if (data.transactionId !== transactionId) {
            return res.status(403).send("transactionId mismatch");
        }
        if (data.email) return res.status(200).send("Email already set");

        await docRef.set(
            {
                email,
                emailMissing: false,
                emailSource: "frontend_patch",
                emailPatchedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
        );

        return res.status(200).send("ok");
    } catch (err) {
        console.error("patchSubmissionEmail error:", err);
        return res.status(500).send("error");
    }
});

/**
 * Returns signed upload URLs for slides/audio/metrics (PAID submission)
 * Body: { submissionId, transactionId, presenterName }
 */
exports.getUploadUrls = fn.https.onRequest(async (req, res) => {
    try {
        // CORS
        res.set("Access-Control-Allow-Origin", "*");
        res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.set("Access-Control-Allow-Headers", "Content-Type");
        if (req.method === "OPTIONS") return res.status(204).send("");

        if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

        const { submissionId, transactionId, presenterName } = req.body || {};
        if (!submissionId || !transactionId) {
            return res.status(400).send("Missing submissionId or transactionId");
        }

        const docRef = admin.firestore().doc(`submissions/${submissionId}`);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).send("Submission not found");

        const data = snap.data() || {};
        if (!data.transactionId) {
            return res.status(409).send("Submission missing transactionId (webhook not written yet)");
        }
        if (data.transactionId !== transactionId) {
            return res.status(403).send("transactionId mismatch");
        }

        if (presenterName && presenterName.trim().length > 0) {
            await docRef.set({ presenterName: presenterName.trim() }, { merge: true });
        }

        const bucket = admin.storage().bucket();

        const base = `submissions/${submissionId}/transactions/${transactionId}`;
        const slidesPath = `${base}/slides.pdf`;
        const audioPath = `${base}/audio.webm`;
        const metricsPath = `${base}/metrics.json`;

        const expires = Date.now() + 15 * 60 * 1000;

        const [slidesUrl] = await bucket.file(slidesPath).getSignedUrl({
            version: "v4",
            action: "write",
            expires,
            contentType: "application/pdf",
        });

        const [audioUrl] = await bucket.file(audioPath).getSignedUrl({
            version: "v4",
            action: "write",
            expires,
            contentType: "audio/webm",
        });

        const [metricsUrl] = await bucket.file(metricsPath).getSignedUrl({
            version: "v4",
            action: "write",
            expires,
            contentType: "application/json",
        });

        await docRef.set(
            {
                assets: {
                    [transactionId]: {
                        slidesPath,
                        audioPath,
                        metricsPath,
                        preparedAt: admin.firestore.FieldValue.serverTimestamp(),
                    },
                },
            },
            { merge: true }
        );

        return res.status(200).json({
            submissionId,
            transactionId,
            slidesUrl,
            audioUrl,
            metricsUrl,
            slidesPath,
            audioPath,
            metricsPath,
        });
    } catch (err) {
        console.error("getUploadUrls error:", err);
        return res.status(500).send("error");
    }
});