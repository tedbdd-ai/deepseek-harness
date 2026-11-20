// Sets the saved theme before the page paints (light is the default); app.js offers the switch.
try { if (localStorage.getItem('atelier-theme') === 'dark') document.documentElement.dataset.theme = 'dark' } catch { /* Storage blocked: stay light. */ }
