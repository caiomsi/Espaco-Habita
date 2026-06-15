(function () {
  'use strict';

  var currentBooking = null; // null = new booking; object = editing existing
  var pendingForce   = false;
  var acDebounce     = null; // autocomplete debounce timer

  // Cache of rooms loaded for the current modal open (for rate suggestion)
  var _rooms = [];

  // ---- Room select helper --------------------------------

  function populateRoomSelect(rooms, selectedId) {
    _rooms = rooms || [];
    window._bkRooms = _rooms;
    var sel = document.getElementById('bk-room');
    if (!sel) return;
    sel.innerHTML = '';
    if (!rooms || rooms.length === 0) {
      sel.innerHTML = '<option value="">— Nenhuma sala ativa —</option>';
      return;
    }
    rooms.forEach(function (r) {
      var opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.name;
      if (r.id === selectedId) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  // ---- Client autocomplete --------------------------------

  function clearClientSelection() {
    var idEl    = document.getElementById('bk-client-id');
    var hintEl  = document.getElementById('bk-client-phone-hint');
    if (idEl)   idEl.value = '';
    if (hintEl) { hintEl.hidden = true; hintEl.textContent = ''; }
  }

  function selectClient(client) {
    var inputEl = document.getElementById('bk-client');
    var idEl    = document.getElementById('bk-client-id');
    var hintEl  = document.getElementById('bk-client-phone-hint');
    if (inputEl) inputEl.value = client.name;
    if (idEl)    idEl.value    = client.id;
    if (hintEl && client.phone) {
      hintEl.textContent = client.phone;
      hintEl.hidden = false;
    }
    hideSuggestions();
  }

  function hideSuggestions() {
    var box = document.getElementById('client-suggestions');
    if (box) { box.hidden = true; box.innerHTML = ''; }
  }

  function showSuggestions(clients) {
    var box = document.getElementById('client-suggestions');
    if (!box) return;
    box.innerHTML = '';
    if (clients.length === 0) { box.hidden = true; return; }
    clients.forEach(function (c) {
      var item = document.createElement('div');
      item.className = 'client-suggestion-item';
      item.innerHTML =
        '<span>' + escHtml(c.name) + '</span>' +
        (c.phone ? '<span class="client-suggestion-phone">' + escHtml(c.phone) + '</span>' : '');
      item.addEventListener('mousedown', function (e) {
        e.preventDefault(); // keep focus on input
        selectClient(c);
      });
      box.appendChild(item);
    });
    box.hidden = false;
  }

  function wireAutocomplete() {
    var inputEl = document.getElementById('bk-client');
    if (!inputEl) return;

    inputEl.addEventListener('input', function () {
      clearClientSelection();
      resetPendingForce();
      clearTimeout(acDebounce);
      var term = inputEl.value.trim();
      if (term.length < 1) { hideSuggestions(); return; }
      acDebounce = setTimeout(function () {
        window.sb.from('clients')
          .select('id,name,phone')
          .eq('active', true)
          .ilike('name', '%' + term + '%')
          .limit(8)
          .then(function (res) {
            showSuggestions(res.data || []);
          });
      }, 200);
    });

    inputEl.addEventListener('blur', function () {
      setTimeout(hideSuggestions, 150); // delay so mousedown fires first
    });

    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hideSuggestions();
    });
  }

  // ---- Rate suggestion ------------------------------------

  function suggestRate() {
    var roomId   = document.getElementById('bk-room').value;
    var startVal = document.getElementById('bk-start').value;
    var endVal   = document.getElementById('bk-end').value;
    var rateEl   = document.getElementById('bk-rate-applied');
    if (!roomId || !startVal || !endVal || !rateEl) return;

    var room = _rooms.find(function (r) { return r.id === roomId; });
    if (!room || !room.rate_hourly) return;

    var start    = new Date(window.UI.datetimeLocalToISO(startVal));
    var end      = new Date(window.UI.datetimeLocalToISO(endVal));
    var hours    = (end - start) / 3600000;
    if (hours <= 0) return;

    rateEl.value = (hours * parseFloat(room.rate_hourly)).toFixed(2);
  }

  // ---- Open modal: new booking ---------------------------

  function openNew(roomId, startDate, rooms) {
    currentBooking = null;
    pendingForce   = false;

    resetForm();
    document.getElementById('booking-modal-title').textContent = 'Nova Reserva';
    var delBtn = document.getElementById('booking-delete-btn');
    delBtn.hidden = true;
    delBtn.style.display = 'none';
    document.getElementById('booking-save-btn').textContent = 'Salvar';

    var start = startDate || new Date();
    var end   = new Date(start.getTime() + 60 * 60000);

    if (rooms && rooms.length > 0) {
      populateRoomSelect(rooms, roomId);
      window.UI.openModal('booking-modal');
      if (window.BKPicker) window.BKPicker.open(roomId, start, end);
    } else {
      window.sb.from('rooms').select('*').eq('active', true).order('name')
        .then(function (res) {
          populateRoomSelect(res.data || [], roomId);
          window.UI.openModal('booking-modal');
          if (window.BKPicker) window.BKPicker.open(roomId, start, end);
        });
    }
  }

  // ---- Open modal: edit existing booking -----------------

  function openEdit(booking, rooms) {
    currentBooking = booking;
    pendingForce   = false;

    resetForm();
    document.getElementById('booking-modal-title').textContent = 'Editar Reserva';
    var delBtn = document.getElementById('booking-delete-btn');
    delBtn.hidden = false;
    delBtn.style.display = '';
    document.getElementById('booking-save-btn').textContent = 'Salvar';

    populateRoomSelect(rooms, booking.room_id);
    document.getElementById('bk-client').value = booking.client_name || '';
    var idEl = document.getElementById('bk-client-id');
    if (idEl) idEl.value = booking.client_id || '';
    var hintEl = document.getElementById('bk-client-phone-hint');
    if (hintEl && booking.client_phone) {
      hintEl.textContent = booking.client_phone;
      hintEl.hidden = false;
    }
    document.getElementById('bk-status').value      = booking.status || 'confirmado';
    document.getElementById('bk-notes').value       = booking.notes || '';
    var rateEl = document.getElementById('bk-rate-applied');
    if (rateEl) rateEl.value = booking.rate_applied != null ? booking.rate_applied : '';

    window.UI.openModal('booking-modal');
    if (window.BKPicker) window.BKPicker.open(booking.room_id, new Date(booking.starts_at), new Date(booking.ends_at), booking.id);
  }

  // ---- Shared helpers ------------------------------------

  function resetForm() {
    var form = document.getElementById('booking-form');
    if (form) form.reset();
    clearClientSelection();
    hideSuggestions();
    setError('');
    setWarning('');
    if (window.BKPicker) window.BKPicker.reset();
  }

  function setError(msg) {
    var el = document.getElementById('booking-error');
    if (!el) return;
    if (msg) { el.textContent = msg; el.hidden = false; }
    else      { el.hidden = true; el.textContent = ''; }
  }

  function setWarning(msg) {
    var el = document.getElementById('booking-conflict-warning');
    if (!el) return;
    if (msg) { el.textContent = msg; el.hidden = false; }
    else      { el.hidden = true; el.textContent = ''; }
  }

  function resetPendingForce() {
    if (!pendingForce) return;
    pendingForce = false;
    setWarning('');
    var btn = document.getElementById('booking-save-btn');
    if (btn) btn.textContent = 'Salvar';
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- Day-of-week helper (0 = Mon … 6 = Sun, matching calendar.js) ------

  function brtDayOfWeek(isoStr) {
    var short = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', weekday: 'short'
    }).format(new Date(isoStr)).toLowerCase().replace('.', '').trim();
    var map = { 'seg': 0, 'ter': 1, 'qua': 2, 'qui': 3, 'sex': 4, 'sáb': 5, 'dom': 6 };
    return map[short.slice(0, 3)];
  }

  // ---- Time-overlap helper for client_plans (HH:MM strings) ---------------

  function timesOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && aEnd > bStart;
  }

  function brtTimeStr(isoStr) {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date(isoStr)); // returns "HH:MM"
  }

  // ---- Conflict detection: bookings + blocked_times + client_plans --------
  // Returns a Promise that resolves with { type, message } or null (no hard block).
  // Sets pendingForce and shows warnings for soft conflicts internally.
  // Calls doSave(payload) directly if everything is clear.

  function runConflictChecks(roomId, startsAt, endsAt, excludeId, payload) {
    var saveBtn = document.getElementById('booking-save-btn');
    window.UI.setLoading(saveBtn, true);

    // 1. Check blocked_times (hard block — cannot override)
    window.sb.from('blocked_times')
      .select('id, reason, starts_at, ends_at')
      .eq('room_id', roomId)
      .lt('starts_at', endsAt)
      .gt('ends_at', startsAt)
      .then(function (res) {
        window.UI.setLoading(saveBtn, false);
        if (res.error) {
          setError('Erro ao verificar bloqueios: ' + res.error.message);
          return;
        }
        if (res.data && res.data.length > 0) {
          var bt = res.data[0];
          setError(
            'Sala bloqueada: "' + (bt.reason || 'sem motivo') + '" · ' +
            window.UI.formatTime(bt.starts_at) + '–' + window.UI.formatTime(bt.ends_at) +
            '. Remova o bloqueio antes de criar a reserva.'
          );
          return;
        }

        // 2. Check bookings overlap (soft — can override)
        checkBookingConflict(roomId, startsAt, endsAt, excludeId, payload);
      });
  }

  function checkBookingConflict(roomId, startsAt, endsAt, excludeId, payload) {
    var saveBtn = document.getElementById('booking-save-btn');
    window.UI.setLoading(saveBtn, true);

    var q = window.sb.from('bookings')
      .select('id, client_name, starts_at, ends_at')
      .eq('room_id', roomId)
      .neq('status', 'cancelado')
      .lt('starts_at', endsAt)
      .gt('ends_at', startsAt);
    if (excludeId) q = q.neq('id', excludeId);

    q.then(function (res) {
      window.UI.setLoading(saveBtn, false);
      if (res.error) {
        setError('Erro ao verificar conflitos: ' + res.error.message);
        return;
      }
      if (res.data && res.data.length > 0) {
        var c = res.data[0];
        setWarning(
          'Atenção: sobreposição com reserva de ' + c.client_name +
          ' (' + window.UI.formatTime(c.starts_at) + '–' +
          window.UI.formatTime(c.ends_at) + ').' +
          ' Clique em "Salvar mesmo assim" para confirmar.'
        );
        pendingForce = true;
        saveBtn.textContent = 'Salvar mesmo assim';
        return;
      }

      // 3. Check client_plans (soft — can override)
      checkPlanConflict(roomId, startsAt, endsAt, payload);
    });
  }

  function checkPlanConflict(roomId, startsAt, endsAt, payload) {
    var saveBtn = document.getElementById('booking-save-btn');
    var dow     = brtDayOfWeek(startsAt);
    if (dow === undefined) { doSave(payload); return; }

    window.UI.setLoading(saveBtn, true);

    window.sb.from('client_plans')
      .select('id, day_of_week, start_time, end_time, clients(name)')
      .eq('room_id', roomId)
      .eq('active', true)
      .eq('day_of_week', dow)
      .then(function (res) {
        window.UI.setLoading(saveBtn, false);
        if (res.error || !res.data || res.data.length === 0) {
          doSave(payload);
          return;
        }

        var bookingStart = brtTimeStr(startsAt);
        var bookingEnd   = brtTimeStr(endsAt);

        var conflict = res.data.find(function (p) {
          var pStart = (p.start_time || '').slice(0, 5);
          var pEnd   = (p.end_time   || '').slice(0, 5);
          return timesOverlap(bookingStart, bookingEnd, pStart, pEnd);
        });

        if (conflict) {
          var clientName = (conflict.clients && conflict.clients.name) ? conflict.clients.name : 'cliente';
          setWarning(
            'Sobreposição com plano recorrente de ' + clientName +
            ' (' + (conflict.start_time || '').slice(0, 5) + '–' +
            (conflict.end_time || '').slice(0, 5) + ').' +
            ' Clique em "Salvar mesmo assim" para confirmar.'
          );
          pendingForce = true;
          saveBtn.textContent = 'Salvar mesmo assim';
          return;
        }

        doSave(payload);
      });
  }

  // ---- Persist to Supabase --------------------------------

  function doSave(payload) {
    var saveBtn = document.getElementById('booking-save-btn');
    window.UI.setLoading(saveBtn, true);

    var promise = currentBooking
      ? window.sb.from('bookings').update(payload).eq('id', currentBooking.id)
      : window.sb.from('bookings').insert(payload);

    promise.then(function (res) {
      window.UI.setLoading(saveBtn, false);
      if (res.error) {
        // Surface DB-level exclusion constraint violation clearly
        var msg = res.error.message || '';
        if (msg.indexOf('no_overlapping') !== -1 || msg.indexOf('exclusion constraint') !== -1) {
          setError('Conflito de horário detectado pelo banco de dados. A reserva não foi salva.');
        } else {
          setError('Erro ao salvar: ' + msg);
        }
        return;
      }
      window.UI.closeAllModals();
      window.UI.toast(currentBooking ? 'Reserva atualizada.' : 'Reserva criada.', 'ok');
      if (window.Calendar) window.Calendar.refresh();
    });
  }

  // ---- Wire up form events after DOM ready ---------------

  document.addEventListener('DOMContentLoaded', function () {
    wireAutocomplete();

    var newBookingBtn = document.getElementById('new-booking-btn');
    if (newBookingBtn) {
      newBookingBtn.addEventListener('click', function () {
        openNew(null, null, null);
      });
    }

    // Rate suggestion link
    var suggestBtn = document.getElementById('bk-rate-suggest');
    if (suggestBtn) {
      suggestBtn.addEventListener('click', function (e) {
        e.preventDefault();
        suggestRate();
      });
    }

    var form = document.getElementById('booking-form');
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var saveBtn    = document.getElementById('booking-save-btn');
      var roomId     = document.getElementById('bk-room').value;
      var clientName = document.getElementById('bk-client').value.trim();
      var clientId   = document.getElementById('bk-client-id').value || null;
      var startVal   = document.getElementById('bk-start').value;
      var endVal     = document.getElementById('bk-end').value;
      var status     = document.getElementById('bk-status').value;
      var notes      = document.getElementById('bk-notes').value.trim();
      var hintEl     = document.getElementById('bk-client-phone-hint');
      var phone      = (hintEl && !hintEl.hidden) ? hintEl.textContent.trim() : null;
      var rateEl     = document.getElementById('bk-rate-applied');
      var rateApplied = rateEl && rateEl.value ? parseFloat(rateEl.value) : null;

      if (!clientName) { setError('O nome do cliente é obrigatório.'); return; }
      if (!clientId)   {
        setError('Selecione um cliente da lista. Para novos clientes, cadastre-os na página Clientes primeiro.');
        return;
      }
      if (!startVal)   { setError('A data/hora de início é obrigatória.'); return; }
      if (!endVal)     { setError('A data/hora de término é obrigatória.'); return; }
      if (!roomId)     { setError('Selecione uma sala.'); return; }

      var startsAt = window.UI.datetimeLocalToISO(startVal);
      var endsAt   = window.UI.datetimeLocalToISO(endVal);

      if (new Date(endsAt) <= new Date(startsAt)) {
        setError('O término deve ser após o início.');
        return;
      }

      setError('');

      var payload = {
        room_id:      roomId,
        client_name:  clientName,
        client_phone: phone || null,
        client_id:    clientId,
        starts_at:    startsAt,
        ends_at:      endsAt,
        status:       status,
        notes:        notes || null,
        rate_applied: isNaN(rateApplied) ? null : rateApplied
      };

      // If already confirmed after a soft conflict warning, skip to save
      if (pendingForce) {
        doSave(payload);
        return;
      }

      runConflictChecks(roomId, startsAt, endsAt, currentBooking ? currentBooking.id : null, payload);
    });

    var deleteBtn = document.getElementById('booking-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function () {
        if (!currentBooking) return;
        if (!confirm('Excluir a reserva de ' + currentBooking.client_name + '?')) return;
        window.sb.from('bookings').delete().eq('id', currentBooking.id)
          .then(function (res) {
            if (res.error) { window.UI.toast('Erro ao excluir reserva.', 'erro'); return; }
            window.UI.closeAllModals();
            window.UI.toast('Reserva excluída.', 'ok');
            if (window.Calendar) window.Calendar.refresh();
          });
      });
    }

    // Reset pendingForce on any form field change
    ['bk-room', 'bk-status', 'bk-notes'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', resetPendingForce);
    });
  });

  // ---- Public API ----------------------------------------

  window.Bookings = {
    openNew:  openNew,
    openEdit: openEdit
  };

})();
