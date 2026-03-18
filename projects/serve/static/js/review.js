(function() {
  var previewImg = document.getElementById('preview-img');
  var previewEmpty = document.getElementById('preview-empty');
  var previewLabel = document.getElementById('preview-label');
  var selectedThumb = null;

  // Read default tab from container data attribute
  var rv = document.querySelector('.rv');
  var defaultTab = rv ? rv.dataset.defaultTab : 'diff';

  // --- Tab switching ---
  var tabs = document.querySelectorAll('.rv__tab');
  var panels = document.querySelectorAll('.rv__panel');
  tabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      var target = this.dataset.tab;
      tabs.forEach(function(t) { t.classList.toggle('active', t.dataset.tab === target); });
      panels.forEach(function(p) { p.classList.toggle('hidden', p.id !== 'tab-' + target); });
    });
  });

  // --- Search filter ---
  var searchInput = document.getElementById('search-input');
  function applySearch() {
    var raw = searchInput.value.toLowerCase().trim();
    var words = raw ? raw.split(/\s+/) : [];
    document.querySelectorAll('.rv-thumb').forEach(function(thumb) {
      var slug = thumb.dataset.slug.toLowerCase();
      var match = words.every(function(w) { return slug.indexOf(w) !== -1; });
      thumb.style.display = match ? '' : 'none';
    });
  }
  searchInput.addEventListener('input', applySearch);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && document.activeElement === searchInput) {
      searchInput.value = '';
      applySearch();
      searchInput.blur();
      return;
    }
    if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && document.activeElement.tagName !== 'INPUT')) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });

  // --- Preview ---
  function showPreview(url, label) {
    if (!url) return;
    previewImg.src = url;
    previewImg.style.display = '';
    previewEmpty.style.display = 'none';
    if (label) previewLabel.textContent = label;
  }

  // --- Thumbnails ---
  document.querySelectorAll('.rv-thumb').forEach(function(thumb) {
    // Zone hover: switch preview
    thumb.querySelectorAll('.rv-zone').forEach(function(zone) {
      zone.addEventListener('mouseenter', function() {
        var label = this.textContent + ' \u2014 ' + thumb.dataset.slug;
        showPreview(this.dataset.img, label);
      });
    });

    // Thumbnail hover: select and show default preview
    thumb.addEventListener('mouseenter', function() {
      if (selectedThumb) selectedThumb.classList.remove('selected');
      selectedThumb = this;
      this.classList.add('selected');
      var statusLabel = this.dataset.status === 'fail' ? 'Diff'
        : this.dataset.status === 'new' ? 'Actual' : 'Baseline';
      showPreview(this.dataset.default, statusLabel + ' \u2014 ' + this.dataset.slug);
    });

    // Click to pin
    thumb.addEventListener('click', function(e) {
      if (e.target.closest('.rv-accept-btn')) return;
      if (selectedThumb) selectedThumb.classList.remove('selected');
      selectedThumb = this;
      this.classList.add('selected');
      var statusLabel = this.dataset.status === 'fail' ? 'Diff'
        : this.dataset.status === 'new' ? 'Actual' : 'Baseline';
      showPreview(this.dataset.default, statusLabel + ' \u2014 ' + this.dataset.slug);
    });
  });

  // --- htmx: handle acceptedAll event ---
  document.body.addEventListener('acceptedAll', function(e) {
    document.querySelectorAll('.rv-thumb[data-status="fail"], .rv-thumb[data-status="new"]')
      .forEach(function(t) { t.classList.add('accepted'); });
  });

  // --- Initial state: select first thumbnail ---
  var first = document.querySelector('#tab-' + defaultTab + ' .rv-thumb');
  if (first) {
    first.classList.add('selected');
    selectedThumb = first;
    var statusLabel = first.dataset.status === 'fail' ? 'Diff'
      : first.dataset.status === 'new' ? 'Actual' : 'Baseline';
    showPreview(first.dataset.default, statusLabel + ' \u2014 ' + first.dataset.slug);
  }
})();
