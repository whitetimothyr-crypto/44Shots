// js/media.js — Felix Tracker camera/mic capture (V3.0)
// Photo (canvas snapshot) + Video (MediaRecorder, 15s max)
// Capture flow is UI-driven; this module is just the engine.
(function () {
  const VIDEO_MAX_MS = 15000;

  let activeStream = null;
  let activeRecorder = null;

  function isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
              typeof MediaRecorder !== 'undefined');
  }

  async function startStream(withAudio) {
    if (activeStream) return activeStream;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera not supported on this device');
    }
    const constraints = {
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    };
    if (withAudio) constraints.audio = true;
    activeStream = await navigator.mediaDevices.getUserMedia(constraints);
    return activeStream;
  }

  function stopStream() {
    if (activeRecorder && activeRecorder.state !== 'inactive') {
      try { activeRecorder.stop(); } catch (e) {}
      activeRecorder = null;
    }
    if (activeStream) {
      activeStream.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} });
      activeStream = null;
    }
  }

  async function snapPhoto(videoEl) {
    if (!videoEl || !videoEl.videoWidth) throw new Error('Camera not ready');
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoEl, 0, 0);
    return new Promise((res, rej) => {
      canvas.toBlob(
        (blob) => blob ? res({ blob: blob, mime: 'image/jpeg' }) : rej(new Error('Photo capture failed')),
        'image/jpeg',
        0.85
      );
    });
  }

  function pickVideoMime() {
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm',
      'video/mp4'
    ];
    for (const m of candidates) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
  }

  async function recordVideo(stream, opts) {
    const onTick = (opts && opts.onTick) || function () {};
    const onAutoStop = (opts && opts.onAutoStop) || function () {};
    const mime = pickVideoMime();
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    activeRecorder = recorder;
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const tick = setInterval(() => {
        const elapsed = Date.now() - startTime;
        onTick(elapsed);
        if (elapsed >= VIDEO_MAX_MS) {
          onAutoStop();
          try { recorder.stop(); } catch (e) {}
        }
      }, 100);

      recorder.onstop = () => {
        clearInterval(tick);
        const blob = new Blob(chunks, { type: mime || 'video/webm' });
        resolve({ blob: blob, mime: mime || 'video/webm', duration_ms: Date.now() - startTime });
      };
      recorder.onerror = (e) => {
        clearInterval(tick);
        reject((e && e.error) || new Error('Recording failed'));
      };

      try {
        recorder.start(100);
      } catch (e) {
        clearInterval(tick);
        reject(e);
      }
    });
  }

  function stopRecording() {
    if (activeRecorder && activeRecorder.state !== 'inactive') {
      try { activeRecorder.stop(); } catch (e) {}
    }
  }

  window.FelixMedia = {
    VIDEO_MAX_MS: VIDEO_MAX_MS,
    isSupported: isSupported,
    startStream: startStream,
    stopStream: stopStream,
    snapPhoto: snapPhoto,
    recordVideo: recordVideo,
    stopRecording: stopRecording
  };
})();
