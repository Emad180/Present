//For handling the audio analysis
export async function audio() {
	const controlBtn = document.getElementById("upload-button"); // Start/Pause/Resume
	const stopBtn = document.getElementById("start-stop");       // Stop everything
	const audioPlayback = document.getElementById("audio-playback");
	const recordingTimer = document.getElementById("recording-timer");

	// ===== Oscilloscope (waveform) =====
	const scopeCanvas = document.getElementById("voice-scope");
	const scopeCtx = scopeCanvas ? scopeCanvas.getContext("2d") : null;

	let scopeAudioCtx = null;
	let scopeAnalyser = null;
	let scopeData = null;
	let scopeRaf = null;

	function resizeScopeCanvas() {
		if (!scopeCanvas || !scopeCtx) return;
		const dpr = window.devicePixelRatio || 1;

		// match CSS size
		const cssW = scopeCanvas.clientWidth || 600;
		const cssH = scopeCanvas.clientHeight || 60;

		scopeCanvas.width = Math.floor(cssW * dpr);
		scopeCanvas.height = Math.floor(cssH * dpr);

		scopeCtx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
	}

	window.addEventListener("resize", resizeScopeCanvas);

	let mediaRecorder;
	let stream;
	let audioChunks = [];
	let timerInterval;
	let secondsElapsed = 0;

	// global-ish state
	window.recordingState = "idle"; // "idle" | "recording" | "paused"
	window.isRecording = false;     // used by slide timing code

	// This function for updating the time only
	function updateTimer() {
		secondsElapsed++;
		const minutes = Math.floor(secondsElapsed / 60);
		const seconds = secondsElapsed % 60;
		recordingTimer.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
	}

	function startTimer() {
		if (timerInterval) clearInterval(timerInterval);
		timerInterval = setInterval(updateTimer, 1000);
	}

	function startOscilloscope(stream) {
	if (!scopeCanvas || !scopeCtx) return;

	resizeScopeCanvas();

	// Create new context/analyser per recording session
	scopeAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
	const source = scopeAudioCtx.createMediaStreamSource(stream);

	scopeAnalyser = scopeAudioCtx.createAnalyser();
	scopeAnalyser.fftSize = 2048;

	const bufferLength = scopeAnalyser.fftSize;
	scopeData = new Uint8Array(bufferLength);

	source.connect(scopeAnalyser);

	const accent =
		getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#00BFA6";

	function draw() {
		scopeRaf = requestAnimationFrame(draw);

		scopeAnalyser.getByteTimeDomainData(scopeData);

		const w = scopeCanvas.clientWidth || 600;
		const h = scopeCanvas.clientHeight || 60;

		// clear
		scopeCtx.clearRect(0, 0, w, h);

		// center line
		scopeCtx.globalAlpha = 0.25;
		scopeCtx.beginPath();
		scopeCtx.moveTo(0, h / 2);
		scopeCtx.lineTo(w, h / 2);
		scopeCtx.strokeStyle = "#888";
		scopeCtx.lineWidth = 1;
		scopeCtx.stroke();
		scopeCtx.globalAlpha = 1;

		// waveform
		scopeCtx.beginPath();
		const sliceWidth = w / bufferLength;
		let x = 0;

		for (let i = 0; i < bufferLength; i++) {
		const v = scopeData[i] / 128.0;     // 0..2
		const y = (v * h) / 2;              // map to canvas

		if (i === 0) scopeCtx.moveTo(x, y);
		else scopeCtx.lineTo(x, y);

		x += sliceWidth;
		}

		scopeCtx.strokeStyle = accent;
		scopeCtx.lineWidth = 2;
		scopeCtx.stroke();
	}

	draw();
	}

	function pauseOscilloscope() {
	if (scopeRaf) cancelAnimationFrame(scopeRaf);
	scopeRaf = null;
	}

	function resumeOscilloscope() {
	// easiest reliable resume: restart drawing loop if analyser exists
	if (!scopeCanvas || !scopeCtx) return;
	if (!scopeAudioCtx || !scopeAnalyser || !scopeData) return;
	if (scopeRaf) return;

	// re-run start draw loop without rebuilding nodes
	const accent =
		getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#00BFA6";

	function draw() {
		scopeRaf = requestAnimationFrame(draw);

		scopeAnalyser.getByteTimeDomainData(scopeData);

		const w = scopeCanvas.clientWidth || 600;
		const h = scopeCanvas.clientHeight || 60;

		scopeCtx.clearRect(0, 0, w, h);

		scopeCtx.globalAlpha = 0.25;
		scopeCtx.beginPath();
		scopeCtx.moveTo(0, h / 2);
		scopeCtx.lineTo(w, h / 2);
		scopeCtx.strokeStyle = "#888";
		scopeCtx.lineWidth = 1;
		scopeCtx.stroke();
		scopeCtx.globalAlpha = 1;

		scopeCtx.beginPath();
		const sliceWidth = w / scopeData.length;
		let x = 0;

		for (let i = 0; i < scopeData.length; i++) {
		const v = scopeData[i] / 128.0;
		const y = (v * h) / 2;

		if (i === 0) scopeCtx.moveTo(x, y);
		else scopeCtx.lineTo(x, y);

		x += sliceWidth;
		}

		scopeCtx.strokeStyle = accent;
		scopeCtx.lineWidth = 2;
		scopeCtx.stroke();
	}

	draw();
	}

	function stopOscilloscope() {
		if (scopeRaf) cancelAnimationFrame(scopeRaf);
		scopeRaf = null;

		if (scopeCtx && scopeCanvas) {
			const w = scopeCanvas.clientWidth || 600;
			const h = scopeCanvas.clientHeight || 60;
			scopeCtx.clearRect(0, 0, w, h);
		}

		if (scopeAudioCtx) {
			scopeAudioCtx.close().catch(() => {});
		}

		scopeAudioCtx = null;
		scopeAnalyser = null;
		scopeData = null;
	}




	async function startRecording() {
		// slides must be uploaded first
		if (!window.slidesUploaded) {
			alert("Please upload slides before starting recording.");
			return;
		}

		stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		mediaRecorder = new MediaRecorder(stream);
		/////////////////////
		startOscilloscope(stream);

		audioChunks = [];

		mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);

		mediaRecorder.onstop = () => {
			if (timerInterval) clearInterval(timerInterval);

			const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
			audioPlayback.src = URL.createObjectURL(audioBlob);

			window.lastAudioBlob = audioBlob;
			window.hasAudioRecording = true;

			audioAnalysis(audioBlob);

			// release mic
			if (stream) stream.getTracks().forEach(t => t.stop());
			stream = null;
			//////////////////
			stopOscilloscope();

		};

		mediaRecorder.start();
		// ✅ reset timer only when starting a NEW recording
		secondsElapsed = 0;
		recordingTimer.textContent = "0:00";
		startTimer();

		window.recordingState = "recording";
		window.isRecording = true;

		controlBtn.textContent = "Pause";

		// ✅ start slide timing (fresh run)
		window.dispatchEvent(new Event("recordingStarted"));
	}

	function pauseRecording() {
		if (mediaRecorder?.state === "recording") {
			mediaRecorder.pause();
			/////////////////
			pauseOscilloscope();

			if (timerInterval) clearInterval(timerInterval);

			window.recordingState = "paused";
			window.isRecording = false;

			controlBtn.textContent = "Resume";
		}
	}

	function resumeRecording() {
		if (mediaRecorder?.state === "paused") {
			mediaRecorder.resume();
			//////////////////
			resumeOscilloscope();

			startTimer();

			window.recordingState = "recording";
			window.isRecording = true;

			controlBtn.textContent = "Pause";
		}
	}

	function stopEverything() {
		// stop recorder
		if (mediaRecorder && mediaRecorder.state !== "inactive") {
			mediaRecorder.stop(); // triggers onstop (creates blob + analysis)
		}

		// stop timer UI
		if (timerInterval) clearInterval(timerInterval);
		timerInterval = null;
		// secondsElapsed = 0;
		// recordingTimer.textContent = "0:00";

		// release mic even if recorder wasn't running
		if (stream) stream.getTracks().forEach(t => t.stop());
		stream = null;

		window.recordingState = "idle";
		window.isRecording = false;

		controlBtn.textContent = "Start";

		// ✅ tell slide timing to stop interval + freeze totals
		window.dispatchEvent(new Event("recordingStopped"));
		//////////////////
		stopOscilloscope();

	}
	controlBtn.addEventListener("click", async () => {
		if (window.recordingState === "idle") {
			await startRecording();
		} else if (window.recordingState === "recording") {
			pauseRecording();
		} else if (window.recordingState === "paused") {
			resumeRecording();
		}
	});

	stopBtn.addEventListener("click", () => {
		stopEverything();
	});

}

// Handles all audio analysis this function is passed up during audio creation function
async function audioAnalysis(audioBlob) {
	// ---- HTML elements for feedback ----
	const avgVolEl = document.getElementById("avg-volume");
	const speechTimeEl = document.getElementById("speech-time");
	const paceEl = document.getElementById("speaking-pace");
	const toneEl = document.getElementById("tone-profile");

	// ---- Step 1: Decode audio into samples ----
	const arrayBuffer = await audioBlob.arrayBuffer();
	const audioContext = new (window.AudioContext || window.webkitAudioContext)();
	const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
	const channelData = audioBuffer.getChannelData(0);
	const duration = audioBuffer.duration;
	const sampleRate = audioBuffer.sampleRate;

	// ---- Step 2: Compute RMS & convert to dB ----
	let sumSquares = 0;
	for (let i = 0; i < channelData.length; i++) sumSquares += channelData[i] ** 2;
	const rms = Math.sqrt(sumSquares / channelData.length);
	const dB = 20 * Math.log10(rms);

	// ---- Step 3: Volume feedback ----
	let volumeFeedback;
	if (dB < -35) volumeFeedback = "Your voice was too quiet, try speaking louder.";
	else if (dB < -25) volumeFeedback = "Your voice was a bit quiet.";
	else if (dB < -15) volumeFeedback = "Your voice was good and clear.";
	else if (dB < -5) volumeFeedback = "Your voice was strong and confident.";
	else volumeFeedback = "Your voice was too loud, consider softening it a bit.";
	avgVolEl.textContent = volumeFeedback;

	// ---- Step 4: Speech vs silence detection ----
	const frameSize = 1024;
	const silenceThreshold = 0.02;
	let speechFrames = 0;
	let speechTransitions = 0;
	let lastSpeaking = false;

	for (let i = 0; i < channelData.length; i += frameSize) {
		let frameSum = 0;
		for (let j = i; j < i + frameSize && j < channelData.length; j++) {
			frameSum += channelData[j] ** 2;
		}
		const frameRMS = Math.sqrt(frameSum / frameSize);
		const isSpeaking = frameRMS > silenceThreshold;

		if (isSpeaking) speechFrames++;
		if (isSpeaking && !lastSpeaking) speechTransitions++;
		lastSpeaking = isSpeaking;
	}

	const totalFrames = Math.ceil(channelData.length / frameSize);
	const speakingRatio = speechFrames / totalFrames;
	const speakingTimeSec = speakingRatio * duration;

	// ---- Step 5: Speaking time feedback ----
	let speechFeedback;
	if (speakingRatio < 0.3)
		speechFeedback = `You spoke for only ${(speakingRatio * 100).toFixed(0)}% of the time. Try to reduce long pauses.`;
	else if (speakingRatio < 0.7)
		speechFeedback = `You spoke for ${(speakingRatio * 100).toFixed(0)}% of the time. This is a balanced pace.`;
	else
		speechFeedback = `You spoke almost continuously (${(speakingRatio * 100).toFixed(0)}%). Try pausing occasionally for clarity.`;
	speechTimeEl.textContent = speechFeedback;

	// ---- Step 6: Speaking pace feedback ----
	const pace = (speechTransitions / duration) * 60; // speech bursts/min
	let paceFeedback;
	if (pace < 15)
		paceFeedback = "You spoke quite slowly. Try maintaining a more energetic pace.";
	else if (pace <= 40)
		paceFeedback = "Your speaking pace was steady and natural.";
	else
		paceFeedback = "You spoke a bit fast. Try slowing down slightly for clarity.";
	paceEl.textContent = paceFeedback;

	// ---- Step 7: Tone profile feedback ----
	let frameRMSValues = [];
	for (let i = 0; i < channelData.length; i += frameSize) {
		let sum = 0;
		for (let j = i; j < i + frameSize && j < channelData.length; j++) {
			sum += channelData[j] ** 2;
		}
		frameRMSValues.push(Math.sqrt(sum / frameSize));
	}
	const mean = frameRMSValues.reduce((a, b) => a + b, 0) / frameRMSValues.length;
	const variance =
		frameRMSValues.reduce((a, b) => a + (b - mean) ** 2, 0) /
		frameRMSValues.length;
	const std = Math.sqrt(variance);

	let toneFeedback =
		std < 0.01
			? "Your tone was quite monotone. Try varying your energy for emphasis."
			: "Your tone had good variation. Great for keeping attention!";
	toneEl.textContent = toneFeedback;

	window.freeAudioMetrics = {
		avgVolumeText: avgVolEl.textContent,
		speechTimeText: speechTimeEl.textContent,
		paceText: paceEl.textContent,
		toneText: toneEl.textContent
	};

	// ---- Done ----
	await audioContext.close();
}