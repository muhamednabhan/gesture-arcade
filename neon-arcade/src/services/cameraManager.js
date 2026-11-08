// Single owner of the webcam stream. Only games that need a camera call acquire();
// the home screen never does. release() always stops every track.

let stream = null;
let endedHandler = null;
let generation = 0; // bumped by every acquire/release so a late-resolving request can't leak a stream
let previewVideo = null, previewParent = null, previewNextSibling = null;
const previewDock = () => document.getElementById('cameraPreviewDock');

function restorePreviewVideo() {
  if (!previewVideo) return;
  previewVideo.classList.remove('camera-preview-video');
  if (previewParent) {
    if (previewNextSibling && previewNextSibling.parentNode === previewParent) previewParent.insertBefore(previewVideo, previewNextSibling);
    else previewParent.appendChild(previewVideo);
  }
  previewVideo = previewParent = previewNextSibling = null;
  const dock = previewDock();
  if (dock) dock.classList.remove('is-active');
  document.body.classList.remove('camera-preview-hidden');
}

function stopStream() {
  if (!stream) { restorePreviewVideo(); return; }
  for (const track of stream.getTracks()) {
    track.onended = null;
    track.stop();
  }
  stream = null;
  endedHandler = null;
  restorePreviewVideo();
}

export const cameraManager = {
  get active() {
    return stream !== null;
  },

  /**
   * Request video only (audio: false), attach it to `videoEl`, and wait for playback.
   * Any previous stream is released first so a restart can never leave two streams open.
   * onEnded fires if the device is unplugged or permission is revoked.
   */
  async acquire(videoEl, { onEnded } = {}) {
    const mine = ++generation;
    stopStream();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const err = new Error("Camera API unavailable (needs HTTPS or localhost).");
      err.name = "NotSupportedError";
      throw err;
    }
    const next = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    if (mine !== generation) {
      // Released or superseded while the permission prompt / device open was pending.
      for (const t of next.getTracks()) t.stop();
      throw new DOMException("Camera request superseded", "AbortError");
    }
    stream = next;
    endedHandler = onEnded || null;
    for (const track of next.getVideoTracks()) {
      track.onended = () => {
        if (stream === next && endedHandler) endedHandler();
      };
    }
    videoEl.srcObject = next;
    // Render the live preview outside the game screen, without changing the video
    // element reference used by the game's gesture detector. Restore it on release.
    const dock = previewDock();
    if (dock) {
      previewVideo = videoEl;
      previewParent = videoEl.parentNode;
      previewNextSibling = videoEl.nextSibling;
      videoEl.classList.add('camera-preview-video');
      dock.appendChild(videoEl);
      dock.classList.add('is-active');
    }
    videoEl.muted = true;
    videoEl.playsInline = true;
    await videoEl.play();
    if (mine !== generation) throw new DOMException("Camera request superseded", "AbortError");
    return next;
  },

  release(videoEl) {
    generation++;
    if (videoEl) videoEl.srcObject = null;
    stopStream();
  }
};
