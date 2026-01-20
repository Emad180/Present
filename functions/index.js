const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

exports.ping = functions.https.onRequest((req, res) => {
    res.status(200).send("pong");
});

// Paddle Sandbox webhook (MVP: no signature verification)
exports.paddleWebhook = functions.https.onRequest(async (req, res) => {
    try {
        if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

        const body = req.body || {};
        const eventType = body.event_type;

        if (eventType !== "transaction.completed") {
            return res.status(200).send("ignored");
        }

        const data = body.data || {};
        const customData = data.custom_data || {};

        const submissionId = customData.submissionId;
        const email = data.customer && data.customer.email ? data.customer.email : null;
        const transactionId = data.id || data.transaction_id || data.transactionId || null;

        if (!submissionId) return res.status(400).send("Missing submissionId");
        if (!email) return res.status(400).send("Missing email");

        await admin.firestore().doc(`submissions/${submissionId}`).set(
            {
                submissionId,
                paid: true,
                status: "paid",
                email,
                transactionId,
                paidAt: admin.firestore.FieldValue.serverTimestamp(),
                rawEventType: eventType,
            },
            { merge: true }
        );

        return res.status(200).send("ok");
    } catch (e) {
        console.error(e);
        return res.status(500).send("error");
    }
});
