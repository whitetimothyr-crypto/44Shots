// js/sync-indicator.js — 44 Shots sync status dot
//
// Drives the existing #syncIndicator dot in the top bar.
//   green  = synced & online (accent teal)
//   yellow = pending events queued locally (warning gold)
//   red    = offline (destructive red)
// Consumer-only: reads NomosSync.getStatus() and subscribes via
// NomosSync.onStatusChange. NomosSync engine itself lives in js/sync.js.
// Depends on: NomosSync (js/sync.js)

(function () {
  const dot = document.getElementById("syncIndicator");
  if (!dot || typeof NomosSync === "undefined") return;
  if (typeof NomosSync.getStatus !== "function") return;
  const COLORS = {
    online_clean:   "#3AAEAC", // synced (accent teal — matches "good")
    online_pending: "#C9A84C", // pending events (warning gold)
    offline:        "#A0364E", // offline (destructive red)
  };
  function paint() {
    const s = NomosSync.getStatus();
    let color, label;
    if (!s.online) { color = COLORS.offline; label = "Offline — events queued locally"; }
    else if (s.pending > 0) { color = COLORS.online_pending; label = s.pending + " event(s) pending sync"; }
    else { color = COLORS.online_clean; label = "Synced"; }
    dot.style.color = color;
    dot.setAttribute("title", label);
    dot.setAttribute("aria-label", label);
  }
  paint();
  NomosSync.onStatusChange(paint);
  window.addEventListener("online", paint);
  window.addEventListener("offline", paint);
})();
