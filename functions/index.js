const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

/**
 * Simple health check
 */
exports.ping = functions.https.onRequest((req, res) => {
    res.status(200).send("pong");
});

/**
 * Paddle Sandbox webhook (MVP: no signature verification)
 * Listens for: transaction.completed
 * Writes to Firestore: submissions/{submissionId} => paid=true, transactionId, email (if present)
 *
 * IMPORTANT:
 * - Does NOT fail if email is missing (it logs and sets emailMissing=true).
 * - This ensures Paddle gets 200 and stops retrying.
 */
exports.paddleWebhook = functions.https.onRequest(async (req, res) => {
    try {
        // Paddle sends POST
        if (req.method !== "POST") {
            return res.status(405).send("Method Not Allowed");
        }

        const body = req.body || {};
        const eventType = body.event_type || body.eventType || null;

        // Only handle the one event we care about
        if (eventType !== "transaction.completed") {
            // Always 200 for other events to avoid unnecessary retries
            return res.status(200).send("ignored");
        }

        const data = body.data || {};
        const customData = data.custom_data || data.customData || {};

        // In your frontend you send: { submissionId, presenterName }
        const submissionId = customData.submissionId || null;

        // Paddle transaction id usually here
        const transactionId =
            data.id || data.transaction_id || data.transactionId || null;

        if (!submissionId) {
            // Log enough info to debug without dumping whole payload
            console.warn("Missing submissionId. customData keys:", Object.keys(customData || {}));
            return res.status(400).send("Missing submissionId");
        }

        // Deep email finder (some payloads put email in unexpected places)
        function findEmailDeep(obj) {
            if (!obj || typeof obj !== "object") return null;

            const stack = [obj];
            const seen = new Set();

            while (stack.length) {
                const cur = stack.pop();
                if (!cur || typeof cur !== "object") continue;
                if (seen.has(cur)) continue;
                seen.add(cur);

                for (const [k, v] of Object.entries(cur)) {
                    if (typeof v === "string") {
                        // very basic email pattern
                        if (v.includes("@") && v.includes(".")) return v;
                    } else if (v && typeof v === "object") {
                        stack.push(v);
                    }
                }
            }
            return null;
        }

        // Try the most common places first, then deep search
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

        // Write paid marker
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
 * Patch submission email from frontend (admin write)
 * Body: { submissionId, transactionId, email }
 *
 * Minimal verification: require transactionId to match the one already stored by paddleWebhook.
 */
exports.patchSubmissionEmail = functions.https.onRequest(async (req, res) => {
    try {
        // --- CORS (frontend hosted elsewhere, e.g. GitHub) ---
        res.set("Access-Control-Allow-Origin", "*");
        res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.set("Access-Control-Allow-Headers", "Content-Type");

        // Preflight request
        if (req.method === "OPTIONS") {
            return res.status(204).send("");
        }

        if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

        const { submissionId, transactionId, email } = req.body || {};

        if (!submissionId || !transactionId || !email) {
            return res.status(400).send("Missing submissionId, transactionId, or email");
        }

        const docRef = admin.firestore().doc(`submissions/${submissionId}`);
        const snap = await docRef.get();

        if (!snap.exists) {
            return res.status(404).send("Submission not found");
        }

        const data = snap.data() || {};
        if (!data.transactionId) {
            return res.status(409).send("Submission missing transactionId (webhook not written yet)");
        }

        // Minimal safety check: only allow patch if txn matches what webhook stored
        if (data.transactionId !== transactionId) {
            return res.status(403).send("transactionId mismatch");
        }

        // If already set, don’t overwrite (idempotent)
        if (data.email) {
            return res.status(200).send("Email already set");
        }

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
 * Returns signed upload URLs for slides/audio/metrics for a PAID submission
 * Keyed by transactionId and stores presenterName.
 *
 * Body: { submissionId, transactionId, presenterName }
 *
 * Writes to Firestore:
 *  - submissions/{submissionId}.presenterName (if provided)
 *  - submissions/{submissionId}.assets[transactionId] = { slidesPath, audioPath, metricsPath, preparedAt }
 *
 * Storage paths:
 *  submissions/<submissionId>/transactions/<transactionId>/slides.pdf
 *  submissions/<submissionId>/transactions/<transactionId>/audio.webm
 *  submissions/<submissionId>/transactions/<transactionId>/metrics.json
 */
exports.getUploadUrls = functions.https.onRequest(async (req, res) => {
    try {
        // --- CORS (frontend hosted on GitHub) ---
        res.set("Access-Control-Allow-Origin", "*");
        res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.set("Access-Control-Allow-Headers", "Content-Type");
        if (req.method === "OPTIONS") return res.status(204).send("");

        if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

        const { submissionId, transactionId, presenterName } = req.body || {};
        if (!submissionId || !transactionId) {
            return res.status(400).send("Missing submissionId or transactionId");
        }

        // Verify submission exists + transactionId matches what webhook stored
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

        // Store presenterName (optional, but you wanted it saved)
        if (presenterName && presenterName.trim().length > 0) {
            await docRef.set({ presenterName: presenterName.trim() }, { merge: true });
        }

        // Signed URL uploads
        const bucket = admin.storage().bucket();

        const base = `submissions/${submissionId}/transactions/${transactionId}`;
        const slidesPath = `${base}/slides.pdf`;
        const audioPath = `${base}/audio.webm`;
        const metricsPath = `${base}/metrics.json`;

        // 15-minute window is usually enough for uploading
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

        // Store paths in Firestore for later retrieval/debug
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

exports.createSubmission = functions.https.onRequest(async (req, res) => {
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



