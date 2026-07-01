(function () {
  'use strict';

  var state = {
    weekStart:   null,
    rooms:       [],
    bookings:    [],
    plans:       [],
    blocked:     [],
    mode:        'all',   // 'all' | 'room'
    focusRoom:   null,    // room object, set when mode === 'room'
    granularity: 'week',  // 'week' | 'month' — only meaningful when mode === 'room'
    monthAnchor: null     // 'YYYY-MM-01' string (BRT) — anchors the month grid
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
    state.weekStart   = window.UI.weekStart(new Date());
    state.monthAnchor = monthAnchorStr(new Date());
    updateHeaderLabel();
    loadAndRender();

    document.getElementById('prev-week').addEventListener('click', function () {
      if (state.mode === 'room' && state.granularity === 'month') {
        state.monthAnchor = addMonthsToAnchor(state.monthAnchor, -1);
      } else {
        state.weekStart = window.UI.addDays(state.weekStart, -7);
      }
      updateHeaderLabel();
      loadAndRender();
    });

    document.getElementById('next-week').addEventListener('click', function () {
      if (state.mode === 'room' && state.granularity === 'month') {
        state.monthAnchor = addMonthsToAnchor(state.monthAnchor, 1);
      } else {
        state.weekStart = window.UI.addDays(state.weekStart, 7);
      }
      updateHeaderLabel();
      loadAndRender();
    });

    document.getElementById('today-btn').addEventListener('click', function () {
      state.weekStart   = window.UI.weekStart(new Date());
      state.monthAnchor = monthAnchorStr(new Date());
      updateHeaderLabel();
      loadAndRender();
    });

    var backBtn = document.getElementById('room-back-btn');
    if (backBtn) backBtn.addEventListener('click', exitRoomView);

    document.querySelectorAll('.view-mode-pill').forEach(function (pill) {
      pill.addEventListener('click', function () {
        var g = pill.dataset.granularity;
        if (state.mode !== 'room' || g === state.granularity) return;
        state.granularity = g;
        updateActivePill();
        updateHeaderLabel();
        loadAndRender();
      });
    });
  }

  // ---- Room focus mode ------------------------------------

  function openRoomView(room) {
    state.mode        = 'room';
    state.focusRoom    = room;
    state.granularity = 'week';
    state.monthAnchor = monthAnchorStr(new Date());
    showRoomContextBar(room);
    updateActivePill();
    updateHeaderLabel();
    loadAndRender();
  }

  function exitRoomView() {
    state.mode      = 'all';
    state.focusRoom = null;
    hideRoomContextBar();
    updateHeaderLabel();
    loadAndRender();
  }

  function showRoomContextBar(room) {
    var bar    = document.getElementById('room-context-bar');
    var nameEl = document.getElementById('room-context-name');
    if (nameEl) nameEl.textContent = room.name;
    if (bar)    bar.hidden = false;
  }

  function hideRoomContextBar() {
    var bar = document.getElementById('room-context-bar');
    if (bar) bar.hidden = true;
  }

  function updateActivePill() {
    document.querySelectorAll('.view-mode-pill').forEach(function (pill) {
      pill.classList.toggle('view-mode-pill--active', pill.dataset.granularity === state.granularity);
    });
  }

  function getDisplayRooms() {
    return (state.mode === 'room' && state.focusRoom) ? [state.focusRoom] : state.rooms;
  }

  // ---- Header label (week range or month name) -----------

  function updateHeaderLabel() {
    var el = document.getElementById('week-label');
    if (!el) return;

    if (state.mode === 'room' && state.granularity === 'month') {
      var raw = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo', month: 'long', year: 'numeric'
      }).format(new Date(state.monthAnchor + 'T00:00:00-03:00'));
      el.textContent = raw.charAt(0).toUpperCase() + raw.slice(1);
      return;
    }

    var end = window.UI.addDays(state.weekStart, 6);
    var fmt = function (d) {
      return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short'
      }).format(d);
    };
    el.textContent = fmt(state.weekStart) + ' – ' + fmt(end);
  }

  // ---- Month anchor helpers (anchor = 'YYYY-MM-01' in BRT) ----

  function monthAnchorStr(date) {
    return window.UI.localDateStr(date).slice(0, 7) + '-01';
  }

  function addMonthsToAnchor(anchorStr, n) {
    var y = parseInt(anchorStr.slice(0, 4), 10);
    var m = parseInt(anchorStr.slice(5, 7), 10); // 1-12
    var total = (y * 12 + (m - 1)) + n;
    var ny = Math.floor(total / 12);
    var nm = total - ny * 12 + 1;
    return ny + '-' + (nm < 10 ? '0' + nm : nm) + '-01';
  }

  // Monday on/before the 1st of the anchor's month
  function monthGridStartDate(anchorStr) {
    var first = new Date(anchorStr + 'T00:00:00-03:00');
    return window.UI.weekStart(first);
  }

  // 0 = Monday … 6 = Sunday, for an arbitrary "YYYY-MM-DD" (BRT) date string
  function dowMonFirst(dateStr) {
    var local = new Date(dateStr + 'T00:00:00-03:00');
    var dow   = local.getDay(); // 0 = Sun
    return dow === 0 ? 6 : dow - 1;
  }

  // ---- Load rooms + bookings + plans from Supabase -------

  function getRange() {
    if (state.mode === 'room' && state.granularity === 'month') {
      var gridStart = monthGridStartDate(state.monthAnchor);
      return { start: gridStart, end: window.UI.addDays(gridStart, 42) };
    }
    return { start: state.weekStart, end: window.UI.addDays(state.weekStart, 7) };
  }

  function loadAndRender() {
    var grid = document.getElementById('calendar-grid');
    if (grid) grid.innerHTML = '<div class="cal-loading">Carregando…</div>';

    var range = getRange();

    Promise.all([
      window.sb.from('rooms')
        .select('*')
        .eq('active', true)
        .order('name'),
      window.sb.from('bookings')
        .select('*')
        .lt('starts_at', range.end.toISOString())
        .gt('ends_at', range.start.toISOString())
        .order('starts_at', { ascending: true }),
      window.sb.from('client_plans')
        .select('*, clients(name)')
        .eq('active', true),
      window.sb.from('blocked_times')
        .select('*')
        .lt('starts_at', range.end.toISOString())
        .gt('ends_at', range.start.toISOString())
    ]).then(function (results) {
      var roomsRes    = results[0];
      var bookingsRes = results[1];
      var plansRes    = results[2];
      var blockedRes  = results[3];

      if (roomsRes.error || bookingsRes.error) {
        if (grid) grid.innerHTML =
          '<div class="cal-loading" style="color:var(--danger)">Erro ao carregar dados. Verifique a conexão.</div>';
        return;
      }

      state.rooms    = roomsRes.data    || [];
      state.bookings = bookingsRes.data || [];
      // Plans and blocked times are supplemental — failure doesn't block the calendar
      state.plans    = (plansRes.error   ? [] : plansRes.data)   || [];
      state.blocked  = (blockedRes.error ? [] : blockedRes.data) || [];

      // Keep the focused room in sync with freshly-loaded data; if it
      // vanished (e.g. deactivated elsewhere) fall back to the all-rooms view.
      if (state.mode === 'room' && state.focusRoom) {
        var fresh = state.rooms.filter(function (r) { return r.id === state.focusRoom.id; })[0];
        if (!fresh) { exitRoomView(); return; }
        state.focusRoom = fresh;
        var nameEl = document.getElementById('room-context-name');
        if (nameEl) nameEl.textContent = fresh.name;
      }

      render();
    });
  }

  function render() {
    if (state.mode === 'room' && state.granularity === 'month') {
      renderMonthGrid();
    } else {
      renderGrid();
    }
  }

  // ---- Week grid rendering (all rooms, or one focused room) ----

  function renderGrid() {
    var grid = document.getElementById('calendar-grid');
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
    var displayRooms = getDisplayRooms();

    if (displayRooms.length === 0) {
      var emptyRow = document.createElement('tr');
      var emptyTd  = document.createElement('td');
      emptyTd.colSpan = 8;
      emptyTd.className = 'cal-empty';
      emptyTd.innerHTML =
        'Nenhuma sala ativa. <a href="rooms.html">Adicionar salas →</a>';
      emptyRow.appendChild(emptyTd);
      tbody.appendChild(emptyRow);
    }

    displayRooms.forEach(function (room) {
      var origIdx = state.rooms.indexOf(room);
      var color   = BLOCK_COLORS[(origIdx >= 0 ? origIdx : 0) % BLOCK_COLORS.length];
      var tr      = document.createElement('tr');
      tr.className = 'cal-row';

      // Room label cell — click to focus this room (only from the all-rooms view)
      var labelTd = document.createElement('td');
      labelTd.className = 'cal-room-label';
      labelTd.innerHTML =
        '<span class="cal-room-name">' + escHtml(room.name) + '</span>' +
        (room.capacity
          ? '<span class="cal-room-cap">' + room.capacity + 'p</span>'
          : '');

      if (state.mode === 'all') {
        labelTd.classList.add('cal-room-label--clickable');
        labelTd.title = 'Ver calendário desta sala';
        (function (r) {
          labelTd.addEventListener('click', function () { openRoomView(r); });
        }(room));
      }

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
          if (booking.series_id)              block.classList.add('booking-block--series');
          block.style.backgroundColor = color;
          block.title =
            booking.client_name + (booking.series_id ? ' ↻' : '') + '\n' +
            window.UI.formatTime(booking.starts_at) + '–' +
            window.UI.formatTime(booking.ends_at) +
            (booking.client_phone ? '\n' + booking.client_phone : '') +
            (booking.notes        ? '\n' + booking.notes        : '');

          block.innerHTML =
            '<span class="block-name">' + escHtml(booking.client_name) + (booking.series_id ? ' ↻' : '') + '</span>' +
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

        // --- Blocked time blocks ---
        var dayBlocked = state.blocked.filter(function (bt) {
          return bt.room_id === room.id && overlapsDay(bt, dayMidnight);
        });

        dayBlocked.forEach(function (bt) {
          var block = document.createElement('div');
          block.className = 'blocked-block';
          block.title =
            'Bloqueado: ' + (bt.reason || 'sem motivo') + '\n' +
            window.UI.formatTime(bt.starts_at) + '–' + window.UI.formatTime(bt.ends_at);
          block.innerHTML =
            '<span class="block-name">⊘ ' + escHtml(bt.reason || 'Bloqueado') + '</span>' +
            '<span class="block-time">' +
              window.UI.formatTime(bt.starts_at) + '–' + window.UI.formatTime(bt.ends_at) +
            '</span>';
          block.addEventListener('click', function (e) {
            e.stopPropagation();
            if (window.BlockedTimes) window.BlockedTimes.openEdit(bt, state.rooms);
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

  // ---- Month grid rendering (single focused room only) ----

  function renderMonthGrid() {
    var grid = document.getElementById('calendar-grid');
    if (!grid) return;
    var room = state.focusRoom;
    if (!room) { exitRoomView(); return; }

    var todayStr      = window.UI.localDateStr(new Date());
    var gridStartDt   = monthGridStartDate(state.monthAnchor);
    var curMonthPrefix = state.monthAnchor.slice(0, 7);

    var table = document.createElement('table');
    table.className = 'cal-table cal-table--month';

    var thead = document.createElement('thead');
    var hRow  = document.createElement('tr');
    DAY_NAMES.forEach(function (name) {
      var th = document.createElement('th');
      th.className = 'cal-month-head';
      th.textContent = name;
      hRow.appendChild(th);
    });
    thead.appendChild(hRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    for (var w = 0; w < 6; w++) {
      var tr = document.createElement('tr');
      for (var d = 0; d < 7; d++) {
        var date = window.UI.addDays(gridStartDt, w * 7 + d);
        tr.appendChild(buildMonthDayCell(date, room, todayStr, curMonthPrefix));
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    grid.innerHTML = '';
    grid.appendChild(table);
  }

  function buildMonthDayCell(date, room, todayStr, curMonthPrefix) {
    var dateStr = window.UI.localDateStr(date);
    var isPad   = dateStr.slice(0, 7) !== curMonthPrefix;

    var td = document.createElement('td');
    td.className = 'cal-month-cell';
    if (isPad)                td.classList.add('cal-month-cell--pad');
    if (dateStr === todayStr) td.classList.add('today');

    var numEl = document.createElement('div');
    numEl.className = 'cal-month-daynum';
    numEl.textContent = String(parseInt(dateStr.slice(8, 10), 10));
    numEl.title = 'Ver detalhe do dia';
    numEl.addEventListener('click', function (e) {
      e.stopPropagation();
      openDayView(date, dateStr);
    });
    td.appendChild(numEl);

    var dayMidnight = new Date(dateStr + 'T00:00:00-03:00');
    var dayBookings = state.bookings
      .filter(function (b) { return b.room_id === room.id && overlapsDay(b, dayMidnight); })
      .sort(function (a, b) { return new Date(a.starts_at) - new Date(b.starts_at); });
    var dayBlocked = state.blocked
      .filter(function (bt) { return bt.room_id === room.id && overlapsDay(bt, dayMidnight); });

    var itemsWrap = document.createElement('div');
    itemsWrap.className = 'cal-month-items';

    var MAX_SHOWN = 3;
    var shown = 0;

    dayBlocked.forEach(function (bt) {
      if (shown >= MAX_SHOWN) return;
      shown++;
      var pill = document.createElement('div');
      pill.className = 'cal-month-pill cal-month-pill--blocked';
      pill.textContent = '⊘ ' + (bt.reason || 'Bloqueado');
      pill.title = 'Bloqueado: ' + (bt.reason || 'sem motivo') + '\n' +
        window.UI.formatTime(bt.starts_at) + '–' + window.UI.formatTime(bt.ends_at);
      pill.addEventListener('click', function (e) {
        e.stopPropagation();
        if (window.BlockedTimes) window.BlockedTimes.openEdit(bt, state.rooms);
      });
      itemsWrap.appendChild(pill);
    });

    dayBookings.forEach(function (booking) {
      if (shown >= MAX_SHOWN) return;
      shown++;
      var pill = document.createElement('div');
      pill.className = 'cal-month-pill';
      if (booking.status === 'cancelado') pill.classList.add('cancelado');
      if (booking.status === 'pendente')  pill.classList.add('pendente');
      pill.textContent = window.UI.formatTime(booking.starts_at) + ' ' + booking.client_name + (booking.series_id ? ' ↻' : '');
      pill.title = booking.client_name + (booking.series_id ? ' ↻' : '') + '\n' +
        window.UI.formatTime(booking.starts_at) + '–' + window.UI.formatTime(booking.ends_at);
      pill.addEventListener('click', function (e) {
        e.stopPropagation();
        window.Bookings.openEdit(booking, state.rooms);
      });
      itemsWrap.appendChild(pill);
    });

    var totalCount = dayBookings.length + dayBlocked.length;
    if (totalCount > MAX_SHOWN) {
      var more = document.createElement('div');
      more.className = 'cal-month-more';
      more.textContent = '+' + (totalCount - MAX_SHOWN) + ' mais';
      more.addEventListener('click', function (e) {
        e.stopPropagation();
        openDayView(date, dateStr);
      });
      itemsWrap.appendChild(more);
    }

    td.appendChild(itemsWrap);

    // Click empty area of cell → new booking pre-filled for this room/day
    td.addEventListener('click', function () {
      var defaultStart = new Date(dateStr + 'T09:00:00-03:00');
      window.Bookings.openNew(room.id, defaultStart, state.rooms);
    });

    return td;
  }

  // ---- Day zoom view (respects room-focus mode) -----------

  function openDayView(date, dateStr) {
    // Full date title in pt-BR (e.g. "segunda-feira, 15 de junho de 2026")
    var rawTitle = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(date);
    var title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);

    var dayOfWeek   = dowMonFirst(dateStr);
    var dayMidnight = new Date(dateStr + 'T00:00:00-03:00');

    document.getElementById('day-modal-title').textContent = title;

    var body = document.getElementById('day-modal-body');
    body.innerHTML = '';
    var hasContent = false;

    getDisplayRooms().forEach(function (room) {
      var dayBookings = state.bookings
        .filter(function (b) { return b.room_id === room.id && overlapsDay(b, dayMidnight); })
        .sort(function (a, b) { return new Date(a.starts_at) - new Date(b.starts_at); });

      var dayPlans = state.plans
        .filter(function (p) { return p.room_id === room.id && p.day_of_week === dayOfWeek; })
        .sort(function (a, b) { return (a.start_time || '') < (b.start_time || '') ? -1 : 1; });

      var dayBlocked = state.blocked
        .filter(function (bt) { return bt.room_id === room.id && overlapsDay(bt, dayMidnight); })
        .sort(function (a, b) { return new Date(a.starts_at) - new Date(b.starts_at); });

      if (dayBookings.length === 0 && dayPlans.length === 0 && dayBlocked.length === 0) return;
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
          '<span class="day-item-name">' + escHtml(booking.client_name) + (booking.series_id ? ' ↻' : '') + '</span>' +
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

      // Blocked time rows (clickable → opens edit modal)
      dayBlocked.forEach(function (bt) {
        var row = document.createElement('div');
        row.className = 'day-blocked-row';
        row.innerHTML =
          '<span class="day-item-time">' +
            window.UI.formatTime(bt.starts_at) + '–' + window.UI.formatTime(bt.ends_at) +
          '</span>' +
          '<span class="day-item-name">⊘ ' + escHtml(bt.reason || 'Bloqueado') + '</span>' +
          '<span class="badge badge--blocked">Bloqueado</span>';
        row.addEventListener('click', function () {
          window.UI.closeAllModals();
          if (window.BlockedTimes) window.BlockedTimes.openEdit(bt, state.rooms);
        });
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
        var defaultStart  = new Date(dateStr + 'T09:00:00-03:00');
        var defaultRoomId = (state.mode === 'room' && state.focusRoom) ? state.focusRoom.id : null;
        window.UI.closeAllModals();
        window.Bookings.openNew(defaultRoomId, defaultStart, state.rooms);
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
