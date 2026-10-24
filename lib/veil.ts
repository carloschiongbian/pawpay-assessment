// A "veil" is a heavily blurred copy of the camera, made on this device. It is
// what the stranger receives until both people agree to reveal, so the real
// image never leaves the device before then.
//
// Blur is done by shrinking each frame to a few pixels and smoothly scaling it
// back up — no canvas `filter` needed, so it works in every browser.

const TINY_WIDTH = 16; // pixels across before scaling back up
const OUT_WIDTH = 320;
const FPS = 15; // plenty for a blur; keeps the CPU cost low

export interface Veil {
  track: MediaStreamTrack;
  stop: () => void;
}

export function createVeil(source: MediaStreamTrack): Veil {
  const { width = 640, height = 480 } = source.getSettings();
  const aspect = height / width;

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([source]);
  void video.play().catch(() => {});

  const tiny = document.createElement("canvas");
  tiny.width = TINY_WIDTH;
  tiny.height = Math.max(1, Math.round(TINY_WIDTH * aspect));
  const tinyCtx = tiny.getContext("2d")!;

  const out = document.createElement("canvas");
  out.width = OUT_WIDTH;
  out.height = Math.round(OUT_WIDTH * aspect);
  const outCtx = out.getContext("2d")!;
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = "high";

  const timer = setInterval(() => {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    tinyCtx.drawImage(video, 0, 0, tiny.width, tiny.height);
    outCtx.drawImage(tiny, 0, 0, out.width, out.height);
  }, 1000 / FPS);

  const track = out.captureStream(FPS).getVideoTracks()[0];

  return {
    track,
    stop: () => {
      clearInterval(timer);
      track.stop();
      video.srcObject = null;
    },
  };
}
