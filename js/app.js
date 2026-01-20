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

			// ✅ Payment completed successfully
			if (event.name === "checkout.completed") {
				const data = event.data;

				// Save payment info for next step
				window.paddlePayment = {
					transactionId: data.transaction_id,
					email: data.customer?.email || null,
					submissionId: data.custom_data?.submissionId || null,
					presenterName: data.custom_data?.presenterName || null,
				};

				console.log("✅ Payment completed:", window.paddlePayment);

				// Optional UI feedback for now
				alert("Payment successful! Preparing upload…");
			}
		},
	});

	window.__paddleInitialized = true;
	console.log("✅ Paddle initialized");
}

window.addEventListener("DOMContentLoaded", initPaddleOnce);
