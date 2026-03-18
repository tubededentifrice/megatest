document.querySelectorAll('time[data-ts]').forEach(function(el) {
  var d = new Date(el.dataset.ts);
  if (!isNaN(d)) el.textContent = d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  });
  else el.textContent = el.dataset.ts;
});
