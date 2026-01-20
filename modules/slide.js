
// global flag to indicate slides are uploaded, used in audio 
window.slidesUploaded = false;

// ===== Paid-submission data (globals) =====
window.slidesFile = null;     // the uploaded PDF file
window.slideTimings = null;   // slide timing object to upload later

// Handling slides upload 
export async function uploadSlides(){
    const fileInput = document.getElementById("slide-upload");
    const slidesContainer = document.getElementById("slides-container");

    const slideText = document.querySelector('#slides-container .slides-placeholder p, #slides-container p') 
    || document.querySelector('#slides-container p'); // fallback

    const defaultUploadMsg = "Click here to upload your presentation";

    function showUploadMessage(msg) {
    slideText.style.display = "block";
    slideText.innerHTML = msg; // allows <br>
    }

    // ✅ Make the upload text open the file picker
    slideText.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        fileInput.click();
    });

    // Optional: show default message on load
    showUploadMessage(defaultUploadMsg);

    const canvas = document.getElementById("pdf-canvas");
    const ctx = canvas.getContext("2d");

    // up and down arrow to move to next and prevvious page
    const downArrow = document.getElementById("down-arrow");
    const upArrow = document.getElementById("up-arrow");

    // Flags to track when pdf is loaded
    let pdfDoc = null;
    let currentPage = 1;
    let pdfLoaded = false; // track if a PDF is loaded

    // Timing setup (new)
    // Stores timing data per slide: {slideNumber: {total: ms, audience: ms}}
    const slideTimings = {};

    // Track when the current slide started showing
    let slideStartTime = 0;

    // Track when the audience view was opened
    let audienceStartTime = 0;

    // Flag to indicate if the audience overlay is currently open
    let isAudienceOpen = false;

    let timingInterval = null; // <--- Add it here
    let lastTickTime = 0; // track the last interval tick

    // Helper function to format milliseconds into readable mm:ss
    function formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
    }

    // ✅ Ensure an entry exists for the slide
    function ensureSlideEntry(pageNum) {
        if (!slideTimings[pageNum]) {
            slideTimings[pageNum] = { total: 0, audience: 0 };
        }
    }

    // ✅ Single source of truth: accumulate elapsed time since last tick
    function flushTick(now = Date.now()) {
        if (!lastTickTime) {
            lastTickTime = now;
            return;
        }

        const elapsed = now - lastTickTime;

        // Only count while recording
        if (window.isRecording) {
            ensureSlideEntry(currentPage);
            slideTimings[currentPage].total += elapsed;

            if (isAudienceOpen) {
                slideTimings[currentPage].audience += elapsed;
            }
        }

        lastTickTime = now;
    }

    fileInput.addEventListener("change", async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        // reset previous upload session data
        window.slidesFile = null;
        window.slideTimings = null;

        const ext = file.name.split('.').pop().toLowerCase();

        // slidesContainer.innerHTML = "<p>Loading slides...</p>";

        if (ext === "pdf") {
            const fileURL = URL.createObjectURL(file);
            pdfDoc = await pdfjsLib.getDocument(fileURL).promise;
            currentPage = 1;
            pdfLoaded = true; // mark that the PDF is ready
            // global flag to indicate slides uploaded, used in audio recording
            window.slidesUploaded = true; // reliably accessible anywhere
            window.slidesFile = file; // ✅ store the PDF for upload later

            await renderPage(currentPage);
            slideText.style.display = "none"; // ✅ hide text only after PDF renders successfully
            ensureSlideEntry(currentPage); // ✅ prepare timing data, but don't count yet

            // Render page function
            async function renderPage(pageNum) {
                const page = await pdfDoc.getPage(pageNum);
                const viewport = page.getViewport({ scale: 1.5 });
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                await page.render({ canvasContext: ctx, viewport }).promise;
            }
            // handles next page move
            downArrow.addEventListener("click", nextPage);
            async function nextPage() {
                if (!pdfDoc) return;
                if (currentPage >= pdfDoc.numPages) return;

                flushTick(); // ✅ capture time up to the click moment

                const newPage = currentPage + 1;

                // Keep currentPage as OLD page while rendering so render delay (if any)
                // is still attributed to the old slide.
                await renderPage(newPage);

                currentPage = newPage;
                ensureSlideEntry(currentPage);

                // reset tick baseline after page becomes visible
                lastTickTime = Date.now();

                console.log(`Moved to page ${currentPage}`);
            }

            // Handels previous page move
            upArrow.addEventListener("click", prevPage);
            async function prevPage() {
                if (!pdfDoc) return;
                if (currentPage <= 1) return;

                flushTick(); // ✅ capture time up to the click moment

                const newPage = currentPage - 1;

                await renderPage(newPage);

                currentPage = newPage;
                ensureSlideEntry(currentPage);

                lastTickTime = Date.now();

                console.log(`Moved to page ${currentPage}`);
            }

            window.addEventListener("audienceOpened", () => {
                flushTick();          // ✅ capture time before switching state
                isAudienceOpen = true;
            });

            window.addEventListener("audienceClosed", () => {
                flushTick();          // ✅ capture time before switching state
                isAudienceOpen = false;
            });

            // -----------------------------
            // Update Free Feedback live (new)
            // -----------------------------
            const slideTimingContainer = document.getElementById("slide-timings-summary");

            // Function to render timing info in feedback
            function updateSlideFeedback() {
                if (!slideTimingContainer) return;

                let html = "";
                let totalPresentationTime = 0; // Total time for all slides
                let totalAudienceTime = 0; // Total audience view time

                const totalSlides = pdfDoc ? pdfDoc.numPages : Object.keys(slideTimings).length;

                for (let i = 1; i <= totalSlides; i++) {
                    const timing = slideTimings[i] || { total: 0, audience: 0 };
                    html += `Slide ${i} — Total: ${formatTime(timing.total)} (Audience: ${formatTime(timing.audience)})<br>`;
                    totalPresentationTime += timing.total; // accumulate total presentation time
                    totalAudienceTime += timing.audience;  // accumulate total audience time
                }
                // Add total presentation time at the top
                html = `<b>Total Presentation Time: ${formatTime(totalPresentationTime)} (Audience: ${formatTime(totalAudienceTime)})</b><hr>` + html;
                slideTimingContainer.innerHTML = html;
                window.slideTimings = slideTimings; // ✅ keep timings available for upload
            }

            function startTimingInterval() {
                if (timingInterval) clearInterval(timingInterval);

                lastTickTime = Date.now(); // ✅ initialize correctly

                timingInterval = setInterval(() => {
                    if (!pdfLoaded) return;

                    flushTick(Date.now());  // ✅ only place where we add time
                    updateSlideFeedback();  // keep UI updating even when paused
                }, 250); // smoother than 1000ms
            }

            // 🔹 When recording starts → reset timings and start fresh interval
            window.addEventListener("recordingStarted", () => {
                // Reset per-slide totals
                for (let key in slideTimings) {
                    slideTimings[key] = { total: 0, audience: 0 };
                }

                isAudienceOpen = false;
                ensureSlideEntry(currentPage);
                lastTickTime = Date.now();

                // Clear previous feedback display
                const slideTimingContainer = document.getElementById("slide-timings-summary");
                if (slideTimingContainer) slideTimingContainer.innerHTML = "";

                // Start a new timing interval
                startTimingInterval();
            });

            // 🔹 When recording stops → stop the timing interval
            window.addEventListener("recordingStopped", () => {
                flushTick(); // ✅ capture final partial time
                isAudienceOpen = false;
                lastTickTime = 0;

                window.isRecording = false; // <- ensure interval stops

                if (timingInterval) {
                    clearInterval(timingInterval); // stop counting time
                    timingInterval = null;
                }

                // Freeze timers but keep feedback visible
                slideStartTime = 0;
                audienceStartTime = 0;
            });

            document.addEventListener("keydown", (event) => {
                if (!pdfLoaded) return; // allow scrolling if no PDF

                // Disable default browser scrolling for arrow keys
                if (["ArrowDown", "ArrowUp"].includes(event.key)) {
                    event.preventDefault();
                }

                // Custom navigation
                if (event.key === "ArrowDown") {
                    nextPage();
                } else if (event.key === "ArrowUp") {
                    prevPage();
                }
            });

        } else if (ext === "ppt" || ext === "pptx") {
            window.slidesUploaded = false;
            pdfLoaded = false;
            showUploadMessage(
                "PowerPoint files can't be previewed directly in the browser.<br>" +
                "Please export as PDF and upload again.<br><br><b>Click here to try again.</b>"
            );
        } else {
            window.slidesUploaded = false;
            pdfLoaded = false;
            showUploadMessage(
                "Unsupported file format.<br><br><b>Click here to try again.</b>"
            );
        }
        event.target.value = ""; // ✅ lets the same file be selected again
    });
}

// ===== AUDIENCE VIEW LOGIC =====
export function audienceView() {
	const audienceBtn = document.getElementById("audience-btn");
	const audienceOverlay = document.getElementById("audience-overlay");
	const closeAudience = document.getElementById("close-audience");
	const video = document.getElementById("audience-video");

	if (!audienceBtn || !audienceOverlay || !video) return;

	audienceBtn.addEventListener("click", () => {
		audienceOverlay.style.display = "flex";
		video.currentTime = 0; // restart
		video.play();
        
        // 🔔 Notify other parts of the app that audience view opened
		window.dispatchEvent(new Event("audienceOpened"));
	});

	closeAudience.addEventListener("click", () => {
		video.pause();
		audienceOverlay.style.display = "none";

        // 🔔 Notify other parts of the app that audience view closed
		window.dispatchEvent(new Event("audienceClosed"));
	});
}

