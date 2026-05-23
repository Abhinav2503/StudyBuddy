/**
 * faceWorker-bridge.js
 * ─────────────────────────────────────────────────────────
 * Since face-api.js requires DOM/Canvas APIs that are
 * unavailable inside a true Web Worker, this module uses
 * a "virtual worker" pattern:
 *
 *  • A real Web Worker handles the TIMING (every 1500 ms)
 *    and sends a tick message to the main thread.
 *  • The main thread receives the tick and runs face detection
 *    (which needs DOM/Canvas) at that throttled rate.
 *
 * This keeps the timer/tick logic off the main thread and
 * prevents CPU overheating by hard-capping detection rate.
 * ─────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  /* ── Inline Worker source (as a Blob so no extra file needed) ── */
  const WORKER_SRC = `
    let tickInterval = null;

    self.onmessage = function (e) {
      if (e.data.cmd === 'START') {
        if (tickInterval) clearInterval(tickInterval);
        tickInterval = setInterval(function () {
          self.postMessage({ type: 'TICK' });
        }, e.data.interval || 1500);
      }
      if (e.data.cmd === 'STOP') {
        if (tickInterval) clearInterval(tickInterval);
        tickInterval = null;
      }
    };
  `;

  /* Build the worker from a Blob URL */
  function createThrottleWorker () {
    const blob = new Blob([WORKER_SRC], { type: 'application/javascript' });
    const url  = URL.createObjectURL(blob);
    return new Worker(url);
  }

  /* Public API exposed on window.FaceWorkerBridge */
  const FaceWorkerBridge = {
    _worker:   null,
    _onTick:   null,   /* callback(fn) set by app.js */

    init (onTickCallback) {
      this._onTick = onTickCallback;
      this._worker = createThrottleWorker();

      this._worker.onmessage = (e) => {
        if (e.data.type === 'TICK' && typeof this._onTick === 'function') {
          this._onTick();
        }
      };

      this._worker.onerror = (err) => {
        console.warn('[FaceWorkerBridge] Worker error:', err.message);
      };
    },

    start (intervalMs = 1500) {
      if (!this._worker) {
        console.error('[FaceWorkerBridge] Not initialised — call init() first.');
        return;
      }
      this._worker.postMessage({ cmd: 'START', interval: intervalMs });
    },

    stop () {
      if (this._worker) {
        this._worker.postMessage({ cmd: 'STOP' });
      }
    },

    destroy () {
      this.stop();
      if (this._worker) {
        this._worker.terminate();
        this._worker = null;
      }
    }
  };

  window.FaceWorkerBridge = FaceWorkerBridge;
})();
