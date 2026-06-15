(function () {
  'use strict';

  var state = {
    weekStart: null,
    rooms:     [],
    bookings:  [],
    plans:     []
  };

  var BLOCK_COLORS = [
    '#c47a35', // terracotta
    '#2d6a4f', // forest
    '#7c5cbf', // plum
    '#c4435a', // crimson
    '#1a6fa8', // sapphire
    '#c06820', // amber-orange
    '#3d7a8a', // teal-slate
    '#5a5e2f', // olive
  ];

  var DAY_NAMES = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

  // ---- Init (called when auth is confirmed) --------------

  function init() {
    state.weekStart = window.UI.weekStart(new Date());
    updateWeekLabel();
    loadAndRender();

    document.getElementById('prev-week').addEventListener('click', function () {
      state.weekStart = window.UI.addDays(state.weekStart, -7);
      updateWeekLabel();
      loadAndRender();
    });

    document.getElementById('next-week').addEventListener('click', function () {
      state.weekStart = window.UI.addDays(state.weekStart, 7);
      updateWeekLabel();
      loadAndRender();
    });

    document.getElementById('today-btn').addEventListener('click', function () {
      state.weekStart = window.UI.weekStart(new Date());
      updateWeekLabel();
      loadAndRender();
    });
  }

  // ---- Week label in toolbar -----------------------------

  function updateWeekLabel() {
    var end = window.UI.addDays(state.weekStart, 6);
    var fmt = function (d) {
      return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short'
      }).format(d);
    };
    var el = document.getElementById('week-label');
    if (el) el.textContent = fmt(state.weekStart) + ' – ' + fmt(end);
  }

  // ---- Load rooms + bookings + plans from Supabase -------

  function loadAndRender() {
    var grid = document.getElementById('calendar-grid');
    if (grid) grid.innerHTML = '<div class="cal-loading">Carregando…</div>';

    var weekEnd = window.UI.addDays(state.weekStart, 7);

    Promise.all([
      window.sb.from('rooms')
        .select('*')
        .eq('active', true)
        .order('name'),
      window.sb.from('bookings')
        .select('*')
        .gte('starts_at', state.weekStart.toISOString())
        .lt('starts_at', weekEnd.toISOString())
        .order('starts_at', { ascending: true }),
      window.sb.from('client_plans')
        .select('*, clients(name)')
        .eq('active', true)
    ]).then(function (results) {
      var roomsRes    = results[0];
      var bookingsRes = results[1];
      var plansRes    = results[2];

      if (roomsRes.error || bookingsRes.error) {
        if (grid) grid.innerHTML =
          '<div class="cal-loading" style="color:var(--danger)">Erro ao carregar dados. Verifique a conexão.</div>';
        return;
      }

      state.rooms    = roomsRes.data    || [];
      state.bookings = bookingsRes.data || [];
      // Plans are supplemental — failure doesn't block the calendar
      state.plans    = (plansRes.error ? [] : plansRes.data) || [];

      renderGrid();
    });
  }

  // ---- Grid rendering ------------------------------------

  function renderGrid() {
    var grid    = document.getElementById('calendar-grid');
    if (!grid) return;

    var dates    = getWeekDates();
    var todayStr = window.UI.localDateStr(new Date());

    var table = document.createElement('table');
    table.className = 'cal-table';

    // --- Header row ---
    var thead = document.createElement('thead');
    var hRow  = document.createElement('tr');

    var corner = document.createElement('th');
    corner.className = 'cal-corner';
    hRow.appendChild(corner);

    dates.forEach(function (date, i) {
      var th      = document.createElement('th');
      var dateStr = window.UI.localDateStr(date);
      th.className = 'cal-header-cell';
      if (dateStr === todayStr) th.classList.add('today');

      var dayNum = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo', day: 'numeric'
      }).format(date);

      th.innerHTML =
        '<span class="cal-day-name">' + DAY_NAMES[i] + '</span>' +
        '<span class="cal-day-num">'  + dayNum + '</span>';

      // Click header → day zoom view
      th.title = 'Ver detalhe do dia';
      (function (d, ds) {
        th.addEventListener('click', function () { openDayView(d, ds); });
      }(date, dateStr));

      hRow.appendChild(th);
    });

    thead.appendChild(hRow);
    table.appendChild(thead);

    // --- Body rows ---
    var tbody = document.createElement('tbody');

    if (state.rooms.length === 0) {
      var emptyRow = document.createElement('tr');
      var emptyTd  = document.createElement('td');
      emptyTd.colSpan = 8;
      emptyTd.className = 'cal-empty';
      emptyTd.innerHTML =
        'Nenhuma sala ativa. <a href="rooms.html">Adicionar salas →</a>';
      emptyRow.appendChild(emptyTd);
      tbody.appendChild(emptyRow);
    }

    state.rooms.forEach(function (room, roomIdx) {
      var color = BLOCK_COLORS[roomIdx % BLOCK_COLORS.length];
      var tr    = document.createElement('tr');
      tr.className = 'cal-row';

      // Room label cell
      var labelTd = document.createElement('td');
      labelTd.className = 'cal-room-label';
      labelTd.innerHTML =
        '<span class="cal-room-name">' + escHtml(room.name) + '</span>' +
        (room.capacity
          ? '<span class="cal-room-cap">' + room.capacity + 'p</span>'
          : '');
      tr.appendChild(labelTd);

      // Day cells — dayIdx 0=Mon … 6=Sun (dates[] always starts from Monday)
      dates.forEach(function (date, dayIdx) {
        var dateStr     = window.UI.localDateStr(date);
        var dayMidnight = new Date(dateStr + 'T00:00:00-03:00');
        var td          = document.createElement('td');
        td.className    = 'cal-cell';
        if (dateStr === todayStr) td.classList.add('today');

        // --- Booking blocks ---
        var dayBookings = state.bookings.filter(function (b) {
          return b.room_id === room.id && overlapsDay(b, dayMidnight);
        });

        dayBookings.forEach(function (booking) {
          var block = document.createElement('div');
          block.className = 'booking-block';
          if (booking.status === 'cancelado') block.classList.add('cancelado');
          if (booking.status === 'pendente')  block.classList.add('pendente');
          block.style.backgroundColor = color;
          block.title =
            booking.client_name + '\n' +
            window.UI.formatTime(booking.starts_at) + '–' +
            window.UI.formatTime(booking.ends_at) +
            (booking.client_phone ? '\n' + booking.client_phone : '') +
            (booking.notes        ? '\n' + booking.notes        : '');

          block.innerHTML =
            '<span class="block-name">' + escHtml(booking.client_name) + '</span>' +
            '<span class="block-time">' +
              window.UI.formatTime(booking.starts_at) + '–' +
              window.UI.formatTime(booking.ends_at) +
            '</span>';

          block.addEventListener('click', function (e) {
            e.stopPropagation();
            window.Bookings.openEdit(booking, state.rooms);
          });

          td.appendChild(block);
        });

        // --- Plan blocks (recurring schedule indicators) ---
        var dayPlans = state.plans.filter(function (p) {
          return p.room_id === room.id && p.day_of_week === dayIdx;
        });

        dayPlans.forEach(function (plan) {
          var block      = document.createElement('div');
          block.className = 'plan-block';
          var clientName = (plan.clients && plan.clients.name) ? plan.clients.name : 'Cliente';
          var start      = plan.start_time ? plan.start_time.slice(0, 5) : '';
          var end        = plan.end_time   ? plan.end_time.slice(0, 5)   : '';
          block.title    = clientName + ' — Plano recorrente · ' + start + '–' + end;
          block.innerHTML =
            '<span class="block-name">' + escHtml(clientName) + ' ↻</span>' +
            '<span class="block-time">' + start + '–' + end + '</span>';
          // Read-only — stop propagation so cell click doesn't fire
          block.addEventListener('click', function (e) { e.stopPropagation(); });
          td.appendChild(block);
        });

        // Click empty area of cell → new booking pre-filled
        td.addEventListener('click', function () {
          var defaultStart = new Date(dateStr + 'T09:00:00-03:00');
          window.Bookings.openNew(room.id, defaultStart, state.rooms);
        });

        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    grid.innerHTML = '';
    grid.appendChild(table);
  }

  // ---- Day zoom view -------------------------------------

  function openDayView(date, dateStr) {
    // Full date title in pt-BR (e.g. "segunda-feira, 15 de junho de 2026")
    var rawTitle = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(date);
    var title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);

    var dayOfWeek   = Math.round((date.getTime() - state.weekStart.getTime()) / 86400000);
    var dayMidnight = new Date(dateStr + 'T00:00:00-03:00');

    document.getElementById('day-modal-title').textContent = title;

    var body = document.getElementById('day-modal-body');
    body.innerHTML = '';
    var hasContent = false;

    state.rooms.forEach(function (room) {
      var dayBookings = state.bookings
        .filter(function (b) { return b.room_id === room.id && overlapsDay(b, dayMidnight); })
        .sort(function (a, b) { return new Date(a.starts_at) - new Date(b.starts_at); });

      var dayPlans = state.plans
        .filter(function (p) { return p.room_id === room.id && p.day_of_week === dayOfWeek; })
        .sort(function (a, b) { return (a.start_time || '') < (b.start_time || '') ? -1 : 1; });

      if (dayBookings.length === 0 && dayPlans.length === 0) return;
      hasContent = true;

      var section = document.createElement('div');
      section.className = 'day-room-section';

      var roomHeading = document.createElement('h3');
      roomHeading.className = 'day-room-name';
      roomHeading.textContent = room.name;
      section.appendChild(roomHeading);

      // Booking rows (clickable → opens edit modal)
      dayBookings.forEach(function (booking) {
        var row = document.createElement('div');
        row.className = 'day-booking-row';
        var statusLabel = { confirmado: 'Confirmado', pendente: 'Pendente', cancelado: 'Cancelado' }[booking.status] || booking.status;
        row.innerHTML =
          '<span class="day-item-time">' +
            window.UI.formatTime(booking.starts_at) + '–' + window.UI.formatTime(booking.ends_at) +
          '</span>' +
          '<span class="day-item-name">' + escHtml(booking.client_name) + '</span>' +
          '<span class="badge badge--' + booking.status + '">' + escHtml(statusLabel) + '</span>';
        row.addEventListener('click', function () {
          window.UI.closeAllModals();
          window.Bookings.openEdit(booking, state.rooms);
        });
        section.appendChild(row);
      });

      // Plan rows (read-only)
      dayPlans.forEach(function (plan) {
        var row = document.createElement('div');
        row.className = 'day-plan-row';
        var clientName = (plan.clients && plan.clients.name) ? plan.clients.name : 'Cliente';
        var start = plan.start_time ? plan.start_time.slice(0, 5) : '';
        var end   = plan.end_time   ? plan.end_time.slice(0, 5)   : '';
        row.innerHTML =
          '<span class="day-item-time">' + start + '–' + end + '</span>' +
          '<span class="day-item-name">' + escHtml(clientName) + '</span>' +
          '<span class="day-item-badge--plan">Plano ↻</span>';
        section.appendChild(row);
      });

      body.appendChild(section);
    });

    if (!hasContent) {
      body.innerHTML = '<p class="day-empty">Nenhuma reserva ou plano para este dia.</p>';
    }

    // Wire "+ Nova Reserva" for this specific day (clone to remove stale listeners)
    var newBtn = document.getElementById('day-new-booking-btn');
    if (newBtn) {
      var clone = newBtn.cloneNode(true);
      newBtn.parentNode.replaceChild(clone, newBtn);
      clone.addEventListener('click', function () {
        var defaultStart = new Date(dateStr + 'T09:00:00-03:00');
        window.UI.closeAllModals();
        window.Bookings.openNew(null, defaultStart, state.rooms);
      });
    }

    window.UI.openModal('day-modal');
  }

  // ---- Helpers -------------------------------------------

  function getWeekDates() {
    var dates = [];
    for (var i = 0; i < 7; i++) {
      dates.push(window.UI.addDays(state.weekStart, i));
    }
    return dates;
  }

  function overlapsDay(booking, dayMidnight) {
    var dayStart = dayMidnight.getTime();
    var dayEnd   = dayStart + 86400000;
    var bStart   = new Date(booking.starts_at).getTime();
    var bEnd     = new Date(booking.ends_at).getTime();
    return bStart < dayEnd && bEnd > dayStart;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---- Public API (used by bookings.js after save) -------

  window.Calendar = { refresh: loadAndRender };

  // ---- Boot: wait for auth:ready event from auth.js ------

  function boot() {
    if (window.authReady) { init(); return; }
    document.addEventListener('auth:ready', init, { once: true });
    setTimeout(function () {
      if (!window.authReady) {
        var grid = document.getElementById('calendar-grid');
        if (grid && grid.querySelector('.cal-loading')) {
          grid.innerHTML =
            '<div class="cal-loading" style="color:var(--danger)">' +
            'Não foi possível conectar. <a href="login.html">Fazer login novamente</a>.' +
            '</div>';
        }
      }
    }, 10000);
  }

  boot();

})();
