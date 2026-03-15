/* ============================================================
   Megatest Mocks — minimal interactivity
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  /* --- Tab switching --------------------------------------- */
  document.querySelectorAll('.tabs').forEach(tabBar => {
    tabBar.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        if (!target) return;

        tabBar.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const container = tabBar.closest('.main') || tabBar.closest('.card') || tabBar.parentElement;
        container.querySelectorAll('.tab-panel').forEach(p => {
          p.hidden = p.id !== target;
        });
      });
    });
  });

  /* --- Filter chips ---------------------------------------- */
  document.querySelectorAll('.filters').forEach(bar => {
    bar.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        bar.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
    });
  });

  /* --- State toggles (open/closed) ------------------------- */
  document.querySelectorAll('.state-toggles').forEach(group => {
    group.querySelectorAll('.state-toggle').forEach(toggle => {
      toggle.addEventListener('click', () => {
        const state = toggle.dataset.showState;
        if (!state) return;

        group.querySelectorAll('.state-toggle').forEach(t => t.classList.remove('active'));
        toggle.classList.add('active');

        const list = document.getElementById('run-list');
        if (!list) return;

        list.querySelectorAll('.run-item[data-state]').forEach(item => {
          item.hidden = item.dataset.state !== state;
        });
      });
    });
  });

  /* --- Checkpoint approve / reject buttons ------------------ */
  document.querySelectorAll('.checkpoint__actions .btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const checkpoint = btn.closest('.checkpoint');
      if (!checkpoint) return;

      if (btn.classList.contains('btn--primary')) {
        checkpoint.style.borderColor = 'rgba(63,185,80,.4)';
        checkpoint.style.opacity = '0.6';
        btn.textContent = 'Approved';
        btn.disabled = true;
      } else if (btn.classList.contains('btn--danger')) {
        checkpoint.style.borderColor = 'rgba(248,81,73,.5)';
        btn.textContent = 'Rejected';
        btn.disabled = true;
      }
    });
  });

});
