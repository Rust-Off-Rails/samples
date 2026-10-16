// Dev tools show live data (the mailbox changes under you), so a page restored from the
// back/forward cache is stale by definition: reload it instead of showing old mail.
window.addEventListener("pageshow", (event) => {
  if (event.persisted) window.location.reload();
});
