// Runs before first paint so a saved theme never flashes the wrong colours.
(function () {
  try {
    var saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch (e) { /* storage blocked: follow the system setting */ }
})();
