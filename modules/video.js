// Handling web camera and video analysis
export function webCamera(){
    // Create a video element
    const video = document.createElement('video');
    video.autoplay = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.borderRadius = '1rem';
    video.style.objectFit = 'fill';

    // Add the video element inside the div
    document.getElementById('webcam').appendChild(video);

    // Access the user's webcam
    navigator.mediaDevices.getUserMedia({ video: true })
        .then(stream => {
            video.srcObject = stream;
        })
        .catch(err => {
            console.error('Error accessing webcam:', err);
        }
    );

}