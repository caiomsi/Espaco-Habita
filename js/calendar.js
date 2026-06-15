(function () {
  'use strict';

  var state = {
    weekStart: null,
    rooms:     [],
    bookings:  []
  };

  // Cycles through 8 colours by room position in the list
  var BLOCK_COLORS = [
    '#6366f1', // indigo
    '#0d9488', // teal
    '#f59e0b', // amber
    '#ec4899', // pink
    '#8b5cf6', // violet
    '#3b82f6', // blue
    '#10b981', // emerald
    '#f97316'  // orange
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

  // ---- Load rooms + bookings from Supabase ---------------

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
        .order('starts_at', { ascending: true })
    ]).then(function (results) {
      var roomsRes    = results[0];
      var bookingsRes = results[1];

      if (roomsRes.error || bookingsRes.error) {
        if (grid) grid.innerHTML =
          '<div class="cal-loading" style="color:var(--danger)">Erro ao carregar dados. Verifique a conexão.</div>';
        return;
      }

      state.rooms    = roomsRes.data    || [];
      state.bookings = bookingsRes.data || [];
      renderGrid();
    });
  }

  // ---- Grid rendering ------------------------------------

  function renderGrid() {
    var grid    = document.getElementById('calendar-grid');
    if (!grid) return;

    var dates   = getWeekDates();
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
      var th = document.createElement('th');
      th.className = 'cal-header-cell';
      var dateStr = window.UI.localDateStr(date);
      if (dateStr === todayStr) th.classList.add('today');

      var dayNum = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo', day: 'numeric'
      }).format(date);

      th.innerHTML =
        '<span class="cal-day-name">' + DAY_NAMES[i] + '</span>' +
        '<span class="cal-day-num">'  + dayNum + '</span>';
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

      // Day cells
      dates.forEach(function (date) {
        var dateStr     = window.UI.localDateStr(date);
        var dayMidnight = new Date(dateStr + 'T00:00:00-03:00');
        var td          = document.createElement('td');
        td.className    = 'cal-cell';
        if (dateStr === todayStr) td.classList.add('today');

        // Find bookings for this room × day
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

          // Click booking → edit modal
          block.addEventListener('click', function (e) {
            e.stopPropagation();
            window.Bookings.openEdit(booking, state.rooms);
          });

          td.appendChild(block);
        });

        // Click empty cell → new booking pre-filled
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

  // ---- Helpers -------------------------------------------

  function getWeekDates() {
    var dates = [];
    for (var i = 0; i < 7; i++) {
      dates.push(window.UI.addDays(state.weekStart, i));
    }
    return dates;
  }

  // Returns true if booking [starts_at, ends_at) overlaps calendar day starting at dayMidnight
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
    // If auth already fired before this listener registered, run immediately
    if (window.authReady) { init(); return; }
    document.addEventListener('auth:ready', init, { once: true });
    // Timeout fallback: if auth never fires (network issue, CDN blocked, etc.)
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
