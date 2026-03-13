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

        const container = tabBar.closest('.card') || tabBar.parentElement;
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
