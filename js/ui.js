(function () {
  'use strict';

  var TZ = 'America/Sao_Paulo';

  window.UI = {

    // ---- Modals ----------------------------------------

    openModal: function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.hidden = false;
      document.body.style.overflow = 'hidden';
      // Focus first interactive field after transition
      var first = el.querySelector('input:not([type="hidden"]), select, textarea');
      if (first) setTimeout(function () { first.focus(); }, 60);
    },

    closeModal: function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.hidden = true;
      document.body.style.overflow = '';
    },

    closeAllModals: function () {
      document.querySelectorAll('.modal-overlay').forEach(function (m) {
        m.hidden = true;
      });
      document.body.style.overflow = '';
    },

    // ---- Toasts ----------------------------------------

    toast: function (msg, type) {
      var existing = document.getElementById('ui-toast');
      if (existing) existing.remove();
      var t = document.createElement('div');
      t.id = 'ui-toast';
      t.className = 'toast toast--' + (type || 'ok');
      t.textContent = msg;
      document.body.appendChild(t);
      // Trigger transition on next frame
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          t.classList.add('toast--visible');
        });
      });
      setTimeout(function () {
        t.classList.remove('toast--visible');
        setTimeout(function () { if (t.parentNode) t.remove(); }, 300);
      }, 3200);
    },

    // ---- Date / time (always Brasília time) ---------------

    // "seg., 14 de jun."
    formatDate: function (isoStr) {
      return new Intl.DateTimeFormat('pt-BR', {
        timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short'
      }).format(new Date(isoStr));
    },

    // "09:30"
    formatTime: function (isoStr) {
      return new Intl.DateTimeFormat('pt-BR', {
        timeZone: TZ, hour: '2-digit', minute: '2-digit'
      }).format(new Date(isoStr));
    },

    // "14/06/2026 09:30"
    formatDatetime: function (isoStr) {
      return new Intl.DateTimeFormat('pt-BR', {
        timeZone: TZ,
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      }).format(new Date(isoStr));
    },

    // Returns "YYYY-MM-DD" in Brasília time for a given Date object
    localDateStr: function (date) {
      var parts = new Intl.DateTimeFormat('pt-BR', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(date);
      var v = function (type) { return parts.find(function (p) { return p.type === type; }).value; };
      return v('year') + '-' + v('month') + '-' + v('day');
    },

    // Returns the Monday of the week that contains `date` (as a Date at BRT midnight)
    weekStart: function (date) {
      var dateStr = this.localDateStr(date);
      var local   = new Date(dateStr + 'T00:00:00-03:00');
      var dow     = local.getDay(); // 0 = Sun
      var diff    = dow === 0 ? -6 : 1 - dow;
      return new Date(local.getTime() + diff * 86400000);
    },

    addDays: function (date, n) {
      return new Date(date.getTime() + n * 86400000);
    },

    // Converts a Date → "YYYY-MM-DDTHH:MM" in Brasília time (for datetime-local inputs)
    toDatetimeLocal: function (date) {
      var parts = new Intl.DateTimeFormat('pt-BR', {
        timeZone: TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      }).formatToParts(date);
      var v = function (type) { return parts.find(function (p) { return p.type === type; }).value; };
      return v('year') + '-' + v('month') + '-' + v('day') + 'T' + v('hour') + ':' + v('minute');
    },

    // Converts a "YYYY-MM-DDTHH:MM" string (treated as Brasília time) → UTC ISO string
    datetimeLocalToISO: function (val) {
      // Append BRT offset so Date() interprets correctly regardless of browser TZ
      return new Date(val + ':00-03:00').toISOString();
    },

    // ---- Loading state on buttons ----------------------

    setLoading: function (btn, loading) {
      if (!btn) return;
      if (loading) {
        btn.disabled = true;
        btn.dataset.origText = btn.textContent;
        btn.textContent = 'Salvando…';
      } else {
        btn.disabled = false;
        btn.textContent = btn.dataset.origText || btn.textContent;
      }
    },

    // ---- Currency (pt-BR / BRL) ------------------------

    formatCurrency: function (val) {
      if (val == null || val === '') return '—';
      return new Intl.NumberFormat('pt-BR', {
        style: 'currency', currency: 'BRL'
      }).format(parseFloat(val));
    },

    // ---- Sidebar request badge (admin pages only) -------

    loadRequestBadge: function () {
      var link = document.querySelector('.sidebar-nav a[href="requests.html"]');
      if (!link || !window.sb) return;

      window.sb.from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'solicitado')
        .then(function (res) {
          var count = (res && res.count) || 0;
          var existing = link.querySelector('.sidebar-badge');
          if (existing) existing.remove();
          if (count > 0) {
            var badge = document.createElement('span');
            badge.className = 'sidebar-badge';
            badge.textContent = count;
            link.appendChild(badge);
          }
        });
    }

  };

  // ---- Global event delegation for modals ----------------

  // Close on backdrop click
  document.addEventListener('click', function (e) {
    if (e.target.classList.contains('modal-overlay')) {
      window.UI.closeAllModals();
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') window.UI.closeAllModals();
  });

  // Close on any .modal-close button
  document.addEventListener('click', function (e) {
    if (e.target.classList.contains('modal-close')) {
      window.UI.closeAllModals();
    }
  });

  // ---- Mobile sidebar toggle ----------------------------

  var sidebarToggle = document.getElementById('sidebar-toggle');
  var sidebar       = document.getElementById('sidebar');

  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', function (e) {
      e.stopPropagation();
      sidebar.classList.toggle('sidebar--open');
    });

    document.addEventListener('click', function (e) {
      if (sidebar.classList.contains('sidebar--open') &&
          !sidebar.contains(e.target) &&
          e.target !== sidebarToggle) {
        sidebar.classList.remove('sidebar--open');
      }
    });
  }

})();
