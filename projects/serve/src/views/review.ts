import type { ReportMeta, ReviewCheckpoint } from '@megatest/core';
import type { ReviewData } from '../types.js';
import { escapeHtml, formatDuration, timeTag } from '../utils.js';
import { REVIEW_CSS } from './styles.js';

export function renderReviewPage(
    projectName: string,
    commitHash: string,
    data: ReviewData,
    meta: ReportMeta | null,
    title: string,
): string {
    const ext = data.extension;
    const base = `/projects/${encodeURIComponent(projectName)}`;
    const reportBase = `${base}/reports/${encodeURIComponent(commitHash)}`;

    const failed = data.checkpoints.filter((c) => c.status === 'fail');
    const newCps = data.checkpoints.filter((c) => c.status === 'new');
    const passed = data.checkpoints.filter((c) => c.status === 'pass');
    const errors = data.checkpoints.filter((c) => c.status === 'error');

    function imgUrl(type: 'actual' | 'diff' | 'baseline', cp: ReviewCheckpoint): string {
        const slug = `${cp.checkpoint}-${cp.viewport}`;
        switch (type) {
            case 'actual':
                return `${reportBase}/${slug}-actual${ext}`;
            case 'diff':
                return `${reportBase}/${slug}-diff${ext}`;
            case 'baseline':
                if (cp.status === 'fail') {
                    return `${reportBase}/${slug}-baseline${ext}`;
                }
                return `${base}/baselines/${slug}${ext}`;
        }
    }

    function renderDiffThumb(cp: ReviewCheckpoint): string {
        const slug = `${cp.checkpoint}-${cp.viewport}`;
        const diffUrl = imgUrl('diff', cp);
        const baselineUrl = imgUrl('baseline', cp);
        const actualUrl = imgUrl('actual', cp);
        const pct = cp.diffPercent !== null ? `${cp.diffPercent.toFixed(2)}%` : '';

        return `
        <div class="rv-thumb" data-cp="${escapeHtml(cp.checkpoint)}" data-vp="${escapeHtml(cp.viewport)}"
             data-status="fail" data-default="${escapeHtml(diffUrl)}" data-slug="${escapeHtml(slug)}">
          <div class="rv-thumb__wrap">
            <img src="${escapeHtml(diffUrl)}" alt="${escapeHtml(slug)}" class="rv-thumb__img" loading="lazy">
            <div class="rv-thumb__overlay">
              <div class="rv-zone rv-zone--diff" data-img="${escapeHtml(diffUrl)}">Diff</div>
              <div class="rv-zone rv-zone--baseline" data-img="${escapeHtml(baselineUrl)}">Baseline</div>
              <div class="rv-zone rv-zone--actual" data-img="${escapeHtml(actualUrl)}">Actual</div>
            </div>
            <button class="rv-accept-btn" data-cp="${escapeHtml(cp.checkpoint)}" data-vp="${escapeHtml(cp.viewport)}">Accept</button>
          </div>
          <div class="rv-thumb__label">
            <span class="rv-thumb__name">${escapeHtml(cp.checkpoint)}</span>
            <span class="rv-thumb__meta">${escapeHtml(cp.viewport)}${pct ? ` &middot; ${pct}` : ''}</span>
          </div>
        </div>`;
    }

    function renderNewThumb(cp: ReviewCheckpoint): string {
        const slug = `${cp.checkpoint}-${cp.viewport}`;
        const actualUrl = imgUrl('actual', cp);

        return `
        <div class="rv-thumb" data-cp="${escapeHtml(cp.checkpoint)}" data-vp="${escapeHtml(cp.viewport)}"
             data-status="new" data-default="${escapeHtml(actualUrl)}" data-slug="${escapeHtml(slug)}">
          <div class="rv-thumb__wrap">
            <img src="${escapeHtml(actualUrl)}" alt="${escapeHtml(slug)}" class="rv-thumb__img" loading="lazy">
            <button class="rv-accept-btn" data-cp="${escapeHtml(cp.checkpoint)}" data-vp="${escapeHtml(cp.viewport)}">Accept</button>
          </div>
          <div class="rv-thumb__label">
            <span class="rv-thumb__name">${escapeHtml(cp.checkpoint)}</span>
            <span class="rv-thumb__meta">${escapeHtml(cp.viewport)} &middot; new</span>
          </div>
        </div>`;
    }

    function renderPassedThumb(cp: ReviewCheckpoint): string {
        const slug = `${cp.checkpoint}-${cp.viewport}`;
        const baselineUrl = imgUrl('baseline', cp);

        return `
        <div class="rv-thumb" data-cp="${escapeHtml(cp.checkpoint)}" data-vp="${escapeHtml(cp.viewport)}"
             data-status="pass" data-default="${escapeHtml(baselineUrl)}" data-slug="${escapeHtml(slug)}">
          <div class="rv-thumb__wrap">
            <img src="${escapeHtml(baselineUrl)}" alt="${escapeHtml(slug)}" class="rv-thumb__img" loading="lazy">
          </div>
          <div class="rv-thumb__label">
            <span class="rv-thumb__name">${escapeHtml(cp.checkpoint)}</span>
            <span class="rv-thumb__meta">${escapeHtml(cp.viewport)}</span>
          </div>
        </div>`;
    }

    const diffThumbs = failed.map((cp) => renderDiffThumb(cp)).join('\n');
    const newThumbs = newCps.map((cp) => renderNewThumb(cp)).join('\n');
    const passedThumbs = passed.map((cp) => renderPassedThumb(cp)).join('\n');

    const hasChanges = failed.length + newCps.length > 0;
    const acceptAllBtn = hasChanges
        ? `<button class="rv-accept-all" id="accept-all-btn">Accept All Changes</button>`
        : '';

    // Determine default active tab
    const defaultTab = failed.length > 0 ? 'diff' : newCps.length > 0 ? 'new' : 'pass';

    // Meta info line
    const metaLine = meta
        ? `<span class="muted text-xs">${formatDuration(meta.duration)} &middot; ${meta.totalCheckpoints} checkpoints</span>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Review &mdash; ${escapeHtml(projectName)} &mdash; ${escapeHtml(commitHash)}</title>
  <style>
${REVIEW_CSS}
  </style>
</head>
<body>
  <div class="rv">
    <div class="rv__topbar">
      <div class="rv__breadcrumb">
        <a href="/">${escapeHtml(title)}</a>
        <span class="rv__sep">/</span>
        <a href="/">${escapeHtml(projectName)}</a>
        <span class="rv__sep">/</span>
        <span class="rv__current mono">${escapeHtml(commitHash.substring(0, 8))}</span>
      </div>
      ${metaLine}
    </div>

    <div class="rv__layout">
      <div class="rv__sidebar">
        <div class="rv__tabs">
          <button class="rv__tab${defaultTab === 'diff' ? ' active' : ''}" data-tab="diff">
            Differences <span class="rv__tab-count">${failed.length}</span>
          </button>
          <button class="rv__tab${defaultTab === 'new' ? ' active' : ''}" data-tab="new">
            New <span class="rv__tab-count">${newCps.length}</span>
          </button>
          <button class="rv__tab${defaultTab === 'pass' ? ' active' : ''}" data-tab="pass">
            Passed <span class="rv__tab-count">${passed.length}</span>
          </button>
        </div>

        <div class="rv__search">
          <input type="text" class="rv__search-input" id="search-input"
                 placeholder="Filter screenshots..." autocomplete="off" spellcheck="false">
        </div>

        <div class="rv__panels">
          <div class="rv__panel${defaultTab === 'diff' ? '' : ' hidden'}" id="tab-diff">
            ${diffThumbs || '<div class="rv__empty muted text-xs">No differences</div>'}
          </div>
          <div class="rv__panel${defaultTab === 'new' ? '' : ' hidden'}" id="tab-new">
            ${newThumbs || '<div class="rv__empty muted text-xs">No new checkpoints</div>'}
          </div>
          <div class="rv__panel${defaultTab === 'pass' ? '' : ' hidden'}" id="tab-pass">
            ${passedThumbs || '<div class="rv__empty muted text-xs">No passed checkpoints</div>'}
          </div>
        </div>

        <div class="rv__sidebar-footer">
          ${acceptAllBtn}
        </div>
      </div>

      <div class="rv__preview" id="preview">
        <img id="preview-img" src="" alt="" style="display:none">
        <div class="rv__preview-empty" id="preview-empty">
          <span class="muted">Hover a thumbnail to preview</span>
        </div>
        <div class="rv__preview-label" id="preview-label"></div>
      </div>
    </div>
  </div>

  ${errors.length > 0 ? `<!-- ${errors.length} error checkpoint(s) omitted from review -->` : ''}

  <script>
(function() {
  var ACCEPT_URL = '${escapeHtml(reportBase)}/accept';
  var ACCEPT_ALL_URL = '${escapeHtml(reportBase)}/accept-all';
  var previewImg = document.getElementById('preview-img');
  var previewEmpty = document.getElementById('preview-empty');
  var previewLabel = document.getElementById('preview-label');
  var selectedThumb = null;

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
    var words = raw ? raw.split(/\\s+/) : [];
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
        var label = this.textContent + ' — ' + thumb.dataset.slug;
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
      showPreview(this.dataset.default, statusLabel + ' — ' + this.dataset.slug);
    });

    // Click to pin
    thumb.addEventListener('click', function(e) {
      if (e.target.closest('.rv-accept-btn')) return;
      if (selectedThumb) selectedThumb.classList.remove('selected');
      selectedThumb = this;
      this.classList.add('selected');
      var statusLabel = this.dataset.status === 'fail' ? 'Diff'
        : this.dataset.status === 'new' ? 'Actual' : 'Baseline';
      showPreview(this.dataset.default, statusLabel + ' — ' + this.dataset.slug);
    });
  });

  // --- Accept single ---
  document.querySelectorAll('.rv-accept-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var thumb = this.closest('.rv-thumb');
      var self = this;
      self.disabled = true;
      self.textContent = '...';
      fetch(ACCEPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpoint: thumb.dataset.cp, viewport: thumb.dataset.vp })
      }).then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.ok) {
            thumb.classList.add('accepted');
          } else {
            self.textContent = 'Error';
          }
        })
        .catch(function() { self.textContent = 'Error'; });
    });
  });

  // --- Accept all ---
  var acceptAllBtn = document.getElementById('accept-all-btn');
  if (acceptAllBtn) {
    acceptAllBtn.addEventListener('click', function() {
      var self = this;
      self.disabled = true;
      self.textContent = 'Accepting...';
      fetch(ACCEPT_ALL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }).then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.ok) {
            self.textContent = 'All accepted (' + (data.accepted || 0) + ')';
            self.classList.add('rv-accept-all--done');
            document.querySelectorAll('.rv-thumb[data-status="fail"], .rv-thumb[data-status="new"]')
              .forEach(function(t) { t.classList.add('accepted'); });
          } else {
            self.textContent = 'Error';
          }
        })
        .catch(function() { self.textContent = 'Error'; });
    });
  }

  // --- Initial state: select first thumbnail ---
  var first = document.querySelector('#tab-' + '${defaultTab}' + ' .rv-thumb');
  if (first) {
    first.classList.add('selected');
    selectedThumb = first;
    var statusLabel = first.dataset.status === 'fail' ? 'Diff'
      : first.dataset.status === 'new' ? 'Actual' : 'Baseline';
    showPreview(first.dataset.default, statusLabel + ' — ' + first.dataset.slug);
  }
})();
  </script>
</body>
</html>`;
}
