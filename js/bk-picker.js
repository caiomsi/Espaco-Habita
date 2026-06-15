(function () {
  'use strict';

  var TZ = 'America/Sao_Paulo';

  // Duration presets: label → milliseconds offset (or {days} for multi-day)
  var PRESETS = {
    '1h':   { ms: 1  * 3600000 },
    '2h':   { ms: 2  * 3600000 },
    'half': { ms: 4  * 3600000 },
    'day':  { ms: 9  * 3600000 },
    'week': { ms: 7  * 86400000 }
  };

  // 30-minute time slots 07:00–22:00
  var TIME_SLOTS = (function () {
    var slots = [];
    for (var h = 7; h <= 22; h++) {
      slots.push(pad(h) + ':00');
      if (h < 22) slots.push(pad(h) + ':30');
    }
    return slots;
  }());

  var MONTH_NAMES = [
    'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
  ];

  // ---- Picker state ----------------------------------------

  var state = {
    activeField:       'start',  // 'start' | 'end'
    startDate:         null,     // Date object (BRT-aware)
    endDate:           null,
    viewYear:          null,
    viewMonth:         null,     // 0–11
    activePreset:      null,
    currentRoomId:     null,
    currentBookingId:  null,     // set when editing, for conflict exclusion
    summaryTimer:      null,
    hasHardConflict:   false
  };

  // ---- Helpers ---------------------------------------------

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  // Get BRT hour and minute from a Date
  function brtHHMM(date) {
    if (!date) return '00:00';
    var parts = new Intl.DateTimeFormat('pt-BR', {
      timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(date);
    var h = parts.find(function (p) { return p.type === 'hour'; }).value;
    var m = parts.find(function (p) { return p.type === 'minute'; }).value;
    return h + ':' + m;
  }

  // Get BRT YYYY-MM-DD string from a Date
  function brtDateStr(date) {
    return window.UI.localDateStr(date);
  }

  // Build a Date from BRT date string + HH:MM time string
  function makeBRTDate(dateStr, timeStr) {
    return new Date(dateStr + 'T' + timeStr + ':00-03:00');
  }

  // Format Date for the display fields: "16/06/2026, 09:00"
  function formatDisplay(date) {
    if (!date) return null;
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: TZ,
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  // Format duration label from ms: "1h", "1h30", "2h", etc.
  function formatDuration(ms) {
    if (!ms || ms <= 0) return '';
    var totalMin = Math.round(ms / 60000);
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    if (h === 0) return m + 'min';
    if (m === 0) return h + 'h';
    return h + 'h' + m;
  }

  // Compute price for summary bar
  function computePrice(startDate, endDate, preset) {
    if (!startDate || !endDate) return null;
    var roomId = state.currentRoomId;
    var rooms  = window._bkRooms || [];
    var room   = rooms.find(function (r) { return r.id === roomId; });
    if (!room) return null;

    if (preset === 'week' && room.rate_weekly) return room.rate_weekly;
    if (preset === 'day'  && room.rate_daily)  return room.rate_daily;
    if (room.rate_hourly) {
      var hours = (endDate - startDate) / 3600000;
      return hours * parseFloat(room.rate_hourly);
    }
    return null;
  }

  // Detect which preset matches a given duration (for edit pre-fill)
  function detectPreset(startDate, endDate) {
    if (!startDate || !endDate) return null;
    var ms = endDate - startDate;
    var keys = Object.keys(PRESETS);
    for (var i = 0; i < keys.length; i++) {
      if (PRESETS[keys[i]].ms === ms) return keys[i];
    }
    return null;
  }

  // ---- Render ----------------------------------------------

  function render() {
    renderDisplayFields();
    renderCalendar();
    renderTimeList();
    renderDurationPills();
    syncHiddenInputs();
    scheduleSummaryUpdate();
  }

  function renderDisplayFields() {
    var startEl  = document.getElementById('bk-start-text');
    var endEl    = document.getElementById('bk-end-text');
    var startBox = document.getElementById('bk-start-display');
    var endBox   = document.getElementById('bk-end-display');

    if (startEl) {
      var startTxt = formatDisplay(state.startDate);
      startEl.textContent = startTxt || '—';
      startEl.classList.toggle('bk-display-value--empty', !startTxt);
    }
    if (endEl) {
      var endTxt = formatDisplay(state.endDate);
      endEl.textContent = endTxt || '—';
      endEl.classList.toggle('bk-display-value--empty', !endTxt);
    }
    if (startBox) {
      startBox.classList.toggle('bk-display-field--active', state.activeField === 'start');
    }
    if (endBox) {
      endBox.classList.toggle('bk-display-field--active', state.activeField === 'end');
    }
  }

  function renderDurationPills() {
    var pills = document.querySelectorAll('.duration-pill');
    pills.forEach(function (pill) {
      pill.classList.toggle('duration-pill--active', pill.dataset.preset === state.activePreset);
    });
  }

  function renderCalendar() {
    var container = document.getElementById('bk-calendar');
    if (!container) return;

    var year  = state.viewYear;
    var month = state.viewMonth;
    var today = brtDateStr(new Date());

    // Selected date strings for comparison
    var selStart = state.startDate ? brtDateStr(state.startDate) : null;
    var selEnd   = state.endDate   ? brtDateStr(state.endDate)   : null;

    // Determine range for in-range shading (only if both set, start < end)
    var rangeStart = (state.startDate && state.endDate && state.startDate < state.endDate)
      ? state.startDate : null;
    var rangeEnd   = rangeStart ? state.endDate : null;

    var html = '';

    // Header
    html += '<div class="bk-cal-header">';
    html +=   '<button type="button" class="bk-cal-nav" id="bk-cal-prev" aria-label="Mês anterior">&#8249;</button>';
    html +=   '<span class="bk-cal-month-label">' + MONTH_NAMES[month] + ' ' + year + '</span>';
    html +=   '<button type="button" class="bk-cal-nav" id="bk-cal-next" aria-label="Próximo mês">&#8250;</button>';
    html += '</div>';

    // Day-of-week headers (Sun–Sat in pt-BR)
    html += '<div class="bk-cal-grid">';
    ['D','S','T','Q','Q','S','S'].forEach(function (d) {
      html += '<div class="bk-cal-dow">' + d + '</div>';
    });

    // First day of month (0=Sun)
    var firstDow  = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var daysInPrev  = new Date(year, month, 0).getDate();

    // Leading cells from previous month
    for (var p = firstDow - 1; p >= 0; p--) {
      var prevDay = daysInPrev - p;
      html += '<button type="button" class="cal-day cal-day--other-month" tabindex="-1">' + prevDay + '</button>';
    }

    // Days in current month
    for (var d = 1; d <= daysInMonth; d++) {
      var ds  = year + '-' + pad(month + 1) + '-' + pad(d);
      var cls = 'cal-day';
      if (ds === today)     cls += ' cal-day--today';
      if (ds === selStart || ds === selEnd) cls += ' cal-day--selected';
      else if (rangeStart) {
        var dayDate = new Date(ds + 'T12:00:00-03:00');
        if (dayDate > rangeStart && dayDate < rangeEnd) cls += ' cal-day--in-range';
      }
      html += '<button type="button" class="' + cls + '" data-date="' + ds + '">' + d + '</button>';
    }

    // Trailing cells to complete the grid
    var totalCells = firstDow + daysInMonth;
    var trailing   = (7 - (totalCells % 7)) % 7;
    for (var t = 1; t <= trailing; t++) {
      html += '<button type="button" class="cal-day cal-day--other-month" tabindex="-1">' + t + '</button>';
    }

    html += '</div>'; // .bk-cal-grid
    container.innerHTML = html;

    // Wire prev/next
    var prevBtn = document.getElementById('bk-cal-prev');
    var nextBtn = document.getElementById('bk-cal-next');
    if (prevBtn) prevBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      state.viewMonth--;
      if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear--; }
      renderCalendar();
    });
    if (nextBtn) nextBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      state.viewMonth++;
      if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear++; }
      renderCalendar();
    });

    // Wire day clicks
    container.querySelectorAll('.cal-day[data-date]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        onDateClick(btn.dataset.date);
      });
    });
  }

  function renderTimeList() {
    var list = document.getElementById('bk-time-list');
    if (!list) return;

    var activeDate = state.activeField === 'start' ? state.startDate : state.endDate;
    var activeTime = activeDate ? brtHHMM(activeDate) : null;

    list.innerHTML = '';
    var activeBtn = null;
    TIME_SLOTS.forEach(function (slot) {
      var btn = document.createElement('button');
      btn.type      = 'button';
      btn.className = 'bk-time-slot' + (slot === activeTime ? ' bk-time-slot--active' : '');
      btn.textContent = slot;
      btn.dataset.time = slot;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        onTimeClick(slot);
      });
      list.appendChild(btn);
      if (slot === activeTime) activeBtn = btn;
    });

    // Scroll active slot into view (centered)
    if (activeBtn) {
      setTimeout(function () {
        activeBtn.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 50);
    }
  }

  // ---- Event handlers --------------------------------------

  function onDateClick(dateStr) {
    var currentDate = state.activeField === 'start' ? state.startDate : state.endDate;
    var currentTime = currentDate ? brtHHMM(currentDate) : '09:00';
    var newDate     = makeBRTDate(dateStr, currentTime);

    if (state.activeField === 'start') {
      state.startDate = newDate;
      applyPresetToEnd();
      // If no end yet, or end is before new start, advance to next field
      if (!state.endDate || state.endDate <= state.startDate) {
        if (!state.activePreset) state.activeField = 'end';
      }
    } else {
      state.endDate = newDate;
    }
    render();
  }

  function onTimeClick(timeStr) {
    var activeDate = state.activeField === 'start' ? state.startDate : state.endDate;
    var dateStr    = activeDate ? brtDateStr(activeDate) : brtDateStr(new Date());
    var newDate    = makeBRTDate(dateStr, timeStr);

    if (state.activeField === 'start') {
      state.startDate = newDate;
      applyPresetToEnd();
    } else {
      state.endDate = newDate;
    }
    render();
  }

  function onPresetClick(preset) {
    state.activePreset = preset;
    applyPresetToEnd();
    render();
  }

  // Recompute endDate from startDate + preset (if start is set)
  function applyPresetToEnd() {
    if (!state.activePreset || !state.startDate) return;
    var ms      = PRESETS[state.activePreset].ms;
    state.endDate = new Date(state.startDate.getTime() + ms);
  }

  // ---- Sync hidden inputs ----------------------------------

  function syncHiddenInputs() {
    var startInput = document.getElementById('bk-start');
    var endInput   = document.getElementById('bk-end');
    if (startInput) {
      var v = state.startDate ? window.UI.toDatetimeLocal(state.startDate) : '';
      if (startInput.value !== v) {
        startInput.value = v;
        startInput.dispatchEvent(new Event('change'));
      }
    }
    if (endInput) {
      var ev = state.endDate ? window.UI.toDatetimeLocal(state.endDate) : '';
      if (endInput.value !== ev) {
        endInput.value = ev;
        endInput.dispatchEvent(new Event('change'));
      }
    }
  }

  // ---- Summary bar -----------------------------------------

  function scheduleSummaryUpdate() {
    clearTimeout(state.summaryTimer);
    state.summaryTimer = setTimeout(updateSummary, 280);
  }

  function updateSummary() {
    var bar     = document.getElementById('bk-summary-bar');
    var iconEl  = document.getElementById('bk-summary-icon');
    var textEl  = document.getElementById('bk-summary-text');
    var saveBtn = document.getElementById('booking-save-btn');
    if (!bar || !textEl) return;

    var start = state.startDate;
    var end   = state.endDate;

    // Incomplete state
    if (!start || !end || end <= start || !state.currentRoomId) {
      bar.className = 'bk-summary-bar';
      if (iconEl) iconEl.innerHTML = infoIcon();
      textEl.textContent = 'Selecione sala, data e horário';
      enableSave(saveBtn, true);
      return;
    }

    // Build summary text (room name, formatted date/time, duration, price)
    var rooms    = window._bkRooms || [];
    var room     = rooms.find(function (r) { return r.id === state.currentRoomId; });
    var roomName = room ? room.name : 'Sala';

    var weekdayStr = new Intl.DateTimeFormat('pt-BR', {
      timeZone: TZ, weekday: 'short'
    }).format(start).replace('.', '');

    var dayMonStr = new Intl.DateTimeFormat('pt-BR', {
      timeZone: TZ, day: 'numeric', month: 'short'
    }).format(start);

    var startTime = brtHHMM(start);
    var endTime   = brtHHMM(end);
    var durationMs = end - start;
    var durLabel   = formatDuration(durationMs);

    var price    = computePrice(start, end, state.activePreset);
    var priceStr = price != null
      ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(price)
      : null;

    var summaryParts = [
      roomName,
      weekdayStr + ', ' + dayMonStr,
      startTime + '–' + endTime,
      durLabel
    ];
    if (priceStr) summaryParts.push(priceStr);
    var summaryText = summaryParts.join(' · ');

    // Auto-fill rate_applied if empty
    if (price != null) {
      var rateEl = document.getElementById('bk-rate-applied');
      if (rateEl && !rateEl.value) rateEl.value = price.toFixed(2);
    }

    // Check conflicts (blocked_times + bookings)
    if (!state.currentRoomId) {
      showSummaryOk(bar, iconEl, textEl, saveBtn, summaryText);
      return;
    }

    var startsAt = start.toISOString();
    var endsAt   = end.toISOString();

    // Check blocked_times (hard) AND bookings (hard) in parallel
    Promise.all([
      window.sb.from('blocked_times')
        .select('id, reason')
        .eq('room_id', state.currentRoomId)
        .lt('starts_at', endsAt)
        .gt('ends_at', startsAt),
      (function () {
        var q = window.sb.from('bookings')
          .select('id, client_name')
          .eq('room_id', state.currentRoomId)
          .neq('status', 'cancelado')
          .lt('starts_at', endsAt)
          .gt('ends_at', startsAt);
        if (state.currentBookingId) q = q.neq('id', state.currentBookingId);
        return q;
      }())
    ]).then(function (results) {
      var blockedRes  = results[0];
      var bookingsRes = results[1];

      var hasBlocked  = !blockedRes.error  && blockedRes.data  && blockedRes.data.length  > 0;
      var hasBooking  = !bookingsRes.error && bookingsRes.data && bookingsRes.data.length > 0;

      if (hasBlocked || hasBooking) {
        var reason = hasBlocked
          ? 'Sala bloqueada' + (blockedRes.data[0].reason ? ': ' + blockedRes.data[0].reason : '')
          : 'Conflito com reserva de ' + bookingsRes.data[0].client_name;
        showSummaryConflict(bar, iconEl, textEl, saveBtn, reason);
      } else {
        showSummaryOk(bar, iconEl, textEl, saveBtn, summaryText);
      }
    }).catch(function () {
      // On network error, show OK (submit-time check is the safety net)
      showSummaryOk(bar, iconEl, textEl, saveBtn, summaryText);
    });
  }

  function showSummaryOk(bar, iconEl, textEl, saveBtn, text) {
    state.hasHardConflict = false;
    bar.className = 'bk-summary-bar';
    if (iconEl) iconEl.innerHTML = checkIcon();
    textEl.textContent = text;
    enableSave(saveBtn, true);
  }

  function showSummaryConflict(bar, iconEl, textEl, saveBtn, reason) {
    state.hasHardConflict = true;
    bar.className = 'bk-summary-bar bk-summary-bar--conflict';
    if (iconEl) iconEl.innerHTML = warnIcon();
    textEl.textContent = 'Horário indisponível — ' + reason;
    enableSave(saveBtn, false);
  }

  function enableSave(btn, enabled) {
    if (!btn) return;
    btn.disabled = !enabled;
    btn.style.opacity = enabled ? '' : '.45';
    btn.style.cursor  = enabled ? '' : 'not-allowed';
  }

  // ---- SVG icon helpers ------------------------------------

  function checkIcon() {
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--green-600)"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
  }

  function warnIcon() {
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  }

  function infoIcon() {
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:.45"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  }

  // ---- Event delegation wiring -----------------------------

  document.addEventListener('DOMContentLoaded', function () {
    var modal = document.getElementById('booking-modal');
    if (!modal) return;

    // Duration pill clicks
    modal.addEventListener('click', function (e) {
      var pill = e.target.closest('.duration-pill');
      if (!pill) return;
      onPresetClick(pill.dataset.preset);
    });

    // Display field clicks (switch active field)
    modal.addEventListener('click', function (e) {
      var field = e.target.closest('.bk-display-field');
      if (!field) return;
      state.activeField = field.dataset.field;
      renderDisplayFields();
      renderTimeList();
      renderCalendar();
    });

    // Room change → update currentRoomId and reschedule summary
    var roomSel = document.getElementById('bk-room');
    if (roomSel) roomSel.addEventListener('change', function () {
      state.currentRoomId = roomSel.value || null;
      scheduleSummaryUpdate();
    });
  });

  // ---- Public API ------------------------------------------

  function open(roomId, defaultStart, defaultEnd, bookingId) {
    state.currentRoomId    = roomId || null;
    state.currentBookingId = bookingId || null;
    state.startDate        = defaultStart || null;
    state.endDate          = defaultEnd   || null;
    state.activeField      = 'start';
    state.hasHardConflict  = false;

    // Detect if times match a preset (useful for edit pre-fill)
    state.activePreset = detectPreset(state.startDate, state.endDate);

    // Set calendar view to start date's month (or current month)
    var viewDate      = state.startDate || new Date();
    var brtYear       = parseInt(new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, year: 'numeric' }).format(viewDate));
    var brtMonthStr   = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, month: '2-digit' }).format(viewDate);
    state.viewYear    = brtYear;
    state.viewMonth   = parseInt(brtMonthStr) - 1;

    render();
  }

  function reset() {
    state.startDate       = null;
    state.endDate         = null;
    state.activeField     = 'start';
    state.activePreset    = null;
    state.currentRoomId   = null;
    state.currentBookingId = null;
    state.hasHardConflict = false;
    clearTimeout(state.summaryTimer);

    var now = new Date();
    var brtYear     = parseInt(new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, year: 'numeric' }).format(now));
    var brtMonthStr = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, month: '2-digit' }).format(now);
    state.viewYear  = brtYear;
    state.viewMonth = parseInt(brtMonthStr) - 1;

    render();

    var bar    = document.getElementById('bk-summary-bar');
    var iconEl = document.getElementById('bk-summary-icon');
    var textEl = document.getElementById('bk-summary-text');
    if (bar)    bar.className = 'bk-summary-bar';
    if (iconEl) iconEl.innerHTML = infoIcon();
    if (textEl) textEl.textContent = 'Selecione sala, data e horário';
    var saveBtn = document.getElementById('booking-save-btn');
    enableSave(saveBtn, true);
  }

  window.BKPicker = { open: open, reset: reset };

  // Set initial calendar view on page load
  var now = new Date();
  var initYear  = parseInt(new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, year: 'numeric' }).format(now));
  var initMonth = parseInt(new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, month: '2-digit' }).format(now)) - 1;
  state.viewYear  = initYear;
  state.viewMonth = initMonth;

})();
