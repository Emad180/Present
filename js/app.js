// JS library for handing the pdf upload and parsing
import * as pdfjsLib from '../pdfjs/build/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = '../pdfjs/build/pdf.worker.mjs';


// Handles slides upload, audience view etc.
import { uploadSlides, audienceView } from "../modules/slide.js";
window.addEventListener("DOMContentLoaded", uploadSlides);

// audience view logic
window.addEventListener("DOMContentLoaded", audienceView);

// //For handling the audio recording and timer
import { audio } from '../modules/audio.js';
window.addEventListener('DOMContentLoaded', audio);

// Handle web camera and video analysis
import { webCamera } from '../modules/video.js';
window.addEventListener('DOMContentLoaded', webCamera);


// Handles the feedback box/pane 
const feedbackBtn = document.getElementById("view-feedback");
const overlay = document.getElementById("feedback-overlay");
const closeBtn = document.getElementById("close-feedback");

feedbackBtn.addEventListener("click", () => {
	overlay.style.display = "flex";
});

closeBtn.addEventListener("click", () => {
	overlay.style.display = "none";
});

// ===== Disable/Enable paid review button based on required session data =====
function setupPaidReviewButtonGate() {
	const btn = document.getElementById("request-analysis-btn");
	const nameInput = document.getElementById("customer-name");
	const warn = document.getElementById("analysis-warning");

	if (!btn || !nameInput || !warn) return;

	function readiness() {
		const slidesOk = window.slidesUploaded === true;
		const audioOk = window.hasAudioRecording === true && !!window.lastAudioBlob;
		const metricsOk = !!window.freeAudioMetrics;

		return { slidesOk, audioOk, metricsOk };
	}

	function refreshButton() {
		const r = readiness();
		const ready = r.slidesOk && r.audioOk && r.metricsOk;

		btn.disabled = !ready;
		btn.style.opacity = ready ? "1" : "0.6";
		btn.style.cursor = ready ? "pointer" : "not-allowed";
	}

	// Update button state regularly (simple MVP approach)
	setInterval(refreshButton, 500);
	refreshButton();

	// If user clicks when not ready, explain why
	btn.addEventListener("click", () => {
		warn.style.display = "none";
		warn.textContent = "";

		if (nameInput.value.trim().length === 0) {
			warn.textContent = "Please enter your name before payment.";
			warn.style.display = "block";
			return;
		}

		const r = readiness();
		if (!(r.slidesOk && r.audioOk && r.metricsOk)) {
			warn.textContent = "Please upload slides and complete an audio recording first (free metrics must be generated).";
			warn.style.display = "block";
			return;
		}

		// Next step will be payment flow
		// ===== Open Paddle Checkout =====
		const submissionId = crypto.randomUUID();
		const presenterName = nameInput.value.trim();

		// Store submissionId globally for next steps
		window.currentSubmissionId = submissionId;
		Paddle.Checkout.open({
			items: [
				{
					priceId: "pri_01kfc3z3h0n7fz0txwegeftp03",
					quantity: 1
				}
			],

			customData: {
				submissionId: submissionId,
				presenterName: presenterName
			}
		});

	});
}

window.addEventListener("DOMContentLoaded", setupPaidReviewButtonGate);

// ===== 50% OFF countdown (ends at local midnight) =====
function startDiscountCountdown() {
	const el = document.getElementById("discount-countdown");
	if (!el) return;

	function tick() {
		const now = new Date();
		const end = new Date(now);
		end.setHours(23, 59, 59, 999); // today, local time

		const ms = end - now;

		if (ms <= 0) {
			el.textContent = "Offer ended";
			return;
		}

		const totalSec = Math.floor(ms / 1000);
		const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
		const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
		const s = String(totalSec % 60).padStart(2, "0");

		el.textContent = `${h}:${m}:${s}`;
	}

	tick();
	setInterval(tick, 1000);
}
window.addEventListener("DOMContentLoaded", startDiscountCountdown);



// warning user that refresh will result in data lost
window.addEventListener("beforeunload", (e) => {
	// Only warn if user has started something meaningful
	const hasWork =
		window.slidesUploaded ||
		window.hasAudioRecording ||
		(window.slideTimings && Object.keys(window.slideTimings).length > 0);

	if (!hasWork) return;

	e.preventDefault();
	e.returnValue = ""; // required for Chrome
});


// ===== Paddle init (Step 1) =====
// Replace these with your real values
const PADDLE_CLIENT_TOKEN = "test_e800c2a022b5166a68bee7fdacd"; // or live_xxx
const PADDLE_ENV = "sandbox"; // "sandbox" for testing, "production" for live
// NOTE: For live, remove Environment.set (Paddle defaults to production). :contentReference[oaicite:1]{index=1}

function initPaddleOnce() {
	if (window.__paddleInitialized) return;
	if (!window.Paddle) {
		console.error("Paddle.js not loaded. Check script tag in app.html head.");
		return;
	}

	if (PADDLE_ENV === "sandbox") {
		// Must be called before Initialize when testing. :contentReference[oaicite:2]{index=2}
		Paddle.Environment.set("sandbox");
	}

	Paddle.Initialize({
		token: PADDLE_CLIENT_TOKEN,
		eventCallback: (event) => {
			if (!event || !event.name) return;

			console.log("[Paddle event]", event.name, event.data);

			// Capture email as soon as the user types it in checkout
			if (event.name === "checkout.customer.updated" || event.name === "checkout.customer.created") {
				const d = event.data || {};
				const email = d.customer?.email || null;

				const cd = d.custom_data || d.customData || {};
				const submissionId = cd.submissionId || window.currentSubmissionId || null;

				if (email) {
					window.paddleCheckoutEmail = email;
					console.log("✅ Captured checkout email:", email, "for submissionId:", submissionId);
				}
			}

			// ✅ Payment completed successfully
			if (event.name === "checkout.completed") {
				const data = event.data;

				// Save payment info for next step
				const cd = data.custom_data || data.customData || {};
				const submissionId = cd.submissionId || window.currentSubmissionId || null;
				const transactionId = data.transaction_id || data.transactionId || null;
				const presenterName = cd.presenterName || null;

				const email =
					(data.customer && (data.customer.email || data.customer.email_address)) ||
					(data.billing_details && data.billing_details.email) ||
					(data.user && data.user.email) || data.customer?.email ||
					window.paddleCheckoutEmail || null;

				window.paddlePayment = {
					transactionId: data.transaction_id || data.transactionId || null,
					email,
					submissionId,
					presenterName,
				};

				// upload slides, audio record, free feedback metric, and presenter name to firebase storage
				uploadPaidAssetsToStorage({ submissionId, transactionId, presenterName })
				.then(r => console.log("✅ uploadPaidAssetsToStorage:", r))
				.catch(e => console.warn("uploadPaidAssetsToStorage error:", e));


				console.log("✅ Payment completed:", window.paddlePayment);

				// Optional UI feedback for now
				alert("Payment successful! Preparing upload…");
				// --- Patch email via Cloud Function (reliable; avoids Firestore rule issues) ---
				(async () => {
					try {
						const cd = data.custom_data || data.customData || {};
						const submissionId = cd.submissionId || window.currentSubmissionId || null;

						const transactionId =
							data.transaction_id || data.transactionId || null;

						const email =
							(data.customer && (data.customer.email || data.customer.email_address)) ||
							(data.billing_details && data.billing_details.email) ||
							(data.user && data.user.email) ||
							data.customer?.email ||
							window.paddleCheckoutEmail ||
							null;

						console.log("🔎 Email patch (function) debug:", { submissionId, transactionId, email });

						if (!submissionId || !transactionId || !email) return;

						const PATCH_URL =
							"https://us-central1-sci-sim-c6923.cloudfunctions.net/patchSubmissionEmail";

						const resp = await fetch(PATCH_URL, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ submissionId, transactionId, email }),
						});

						const text = await resp.text();
						if (!resp.ok) {
							console.warn("Email patch (function) failed:", resp.status, text);
							return;
						}

						console.log("✅ Email patched via function:", text);
					} catch (e) {
						console.warn("Email patch (function) error:", e);
					}
				})();

			}
		},
	});

	window.__paddleInitialized = true;
	console.log("✅ Paddle initialized");
}

window.addEventListener("DOMContentLoaded", initPaddleOnce);

// Helper function to upload slides, audio record, free feedback metric, and presenter name to firebase storage
async function uploadPaidAssetsToStorage({ submissionId, transactionId, presenterName }) {
	// Pull session assets from globals set by your app
	const slidesFile = window.slidesFile || null;      // set by slide.js
	const slideTimings = window.slideTimings || null;  // set by slide.js
	const audioBlob = window.lastAudioBlob || null;    // set by audio recorder
	const freeAudioMetrics = window.freeAudioMetrics || null;

	console.log("📦 Upload prep:", {
		submissionId,
		transactionId,
		presenterName,
		hasSlides: !!slidesFile,
		hasAudio: !!audioBlob,
		hasMetrics: !!freeAudioMetrics,
		hasTimings: !!slideTimings,
	});

	if (!submissionId || !transactionId) {
		console.warn("Missing submissionId/transactionId; skipping upload.");
		return { ok: false, reason: "missing_ids" };
	}

	// require everything (as you requested: slides + audio + full free feedback including timing)
	if (!slidesFile || !audioBlob || !freeAudioMetrics || !slideTimings) {
		console.warn("Missing one or more required assets; skipping upload.");
		return { ok: false, reason: "missing_assets" };
	}

	// 1) Ask backend for signed upload URLs
	const URLS_ENDPOINT =
		"https://us-central1-sci-sim-c6923.cloudfunctions.net/getUploadUrls";

	const urlsResp = await fetch(URLS_ENDPOINT, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ submissionId, transactionId, presenterName }),
	});

	const urlsText = await urlsResp.text();
	if (!urlsResp.ok) {
		console.warn("getUploadUrls failed:", urlsResp.status, urlsText);
		return { ok: false, reason: "getUploadUrls_failed", status: urlsResp.status, body: urlsText };
	}

	const urls = JSON.parse(urlsText);
	console.log("🔗 Signed URLs received:", {
		slidesPath: urls.slidesPath,
		audioPath: urls.audioPath,
		metricsPath: urls.metricsPath,
	});

	// 2) Upload Slides (PDF)
	const putSlides = await fetch(urls.slidesUrl, {
		method: "PUT",
		headers: { "Content-Type": "application/pdf" },
		body: slidesFile,
	});

	// 3) Upload Audio
	const audioType = audioBlob.type || "audio/webm";
	const putAudio = await fetch(urls.audioUrl, {
		method: "PUT",
		headers: { "Content-Type": audioType },
		body: audioBlob,
	});

	// 4) Upload Metrics JSON (free feedback + timings)
	const payload = {
		submissionId,
		transactionId,
		presenterName,
		email: window.paddleCheckoutEmail || null,
		freeAudioMetrics,
		slideTimings,
		createdAtClient: new Date().toISOString(),
	};

	const putMetrics = await fetch(urls.metricsUrl, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});

	console.log("⬆️ Upload results:", {
		slides: { ok: putSlides.ok, status: putSlides.status },
		audio: { ok: putAudio.ok, status: putAudio.status },
		metrics: { ok: putMetrics.ok, status: putMetrics.status },
	});

	return {
		ok: putSlides.ok && putAudio.ok && putMetrics.ok,
		slidesOk: putSlides.ok,
		audioOk: putAudio.ok,
		metricsOk: putMetrics.ok,
		slidesStatus: putSlides.status,
		audioStatus: putAudio.status,
		metricsStatus: putMetrics.status,
		paths: {
			slidesPath: urls.slidesPath,
			audioPath: urls.audioPath,
			metricsPath: urls.metricsPath,
		},
	};
}

