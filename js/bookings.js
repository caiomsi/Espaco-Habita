(function () {
  'use strict';

  var currentBooking = null; // null = new booking; object = editing existing
  var pendingForce   = false;
  var acDebounce     = null; // autocomplete debounce timer

  // ---- Room select helper --------------------------------

  function populateRoomSelect(rooms, selectedId) {
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
    document.getElementById('bk-start').value = window.UI.toDatetimeLocal(start);
    document.getElementById('bk-end').value   = window.UI.toDatetimeLocal(end);

    if (rooms && rooms.length > 0) {
      populateRoomSelect(rooms, roomId);
      window.UI.openModal('booking-modal');
    } else {
      window.sb.from('rooms').select('*').eq('active', true).order('name')
        .then(function (res) {
          populateRoomSelect(res.data || [], roomId);
          window.UI.openModal('booking-modal');
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
    // Pre-fill client_id if the booking has one
    var idEl = document.getElementById('bk-client-id');
    if (idEl) idEl.value = booking.client_id || '';
    // Show phone hint if available
    var hintEl = document.getElementById('bk-client-phone-hint');
    if (hintEl && booking.client_phone) {
      hintEl.textContent = booking.client_phone;
      hintEl.hidden = false;
    }
    document.getElementById('bk-start').value  = window.UI.toDatetimeLocal(new Date(booking.starts_at));
    document.getElementById('bk-end').value    = window.UI.toDatetimeLocal(new Date(booking.ends_at));
    document.getElementById('bk-status').value = booking.status || 'confirmado';
    document.getElementById('bk-notes').value  = booking.notes || '';

    window.UI.openModal('booking-modal');
  }

  // ---- Shared helpers ------------------------------------

  function resetForm() {
    var form = document.getElementById('booking-form');
    if (form) form.reset();
    clearClientSelection();
    hideSuggestions();
    setError('');
    setWarning('');
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

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- Conflict detection --------------------------------

  function checkConflict(roomId, startsAt, endsAt, excludeId) {
    var q = window.sb.from('bookings')
      .select('id, client_name, starts_at, ends_at')
      .eq('room_id', roomId)
      .neq('status', 'cancelado')
      .lt('starts_at', endsAt)
      .gt('ends_at', startsAt);
    if (excludeId) q = q.neq('id', excludeId);
    return q;
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
        setError('Erro ao salvar: ' + res.error.message);
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

      if (!clientName) { setError('O nome do cliente é obrigatório.'); return; }
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
        notes:        notes || null
      };

      if (pendingForce) {
        doSave(payload);
        return;
      }

      window.UI.setLoading(saveBtn, true);
      checkConflict(roomId, startsAt, endsAt, currentBooking ? currentBooking.id : null)
        .then(function (res) {
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
          } else {
            doSave(payload);
          }
        });
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

    ['bk-room', 'bk-start', 'bk-end'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', function () {
          if (pendingForce) {
            pendingForce = false;
            setWarning('');
            var sb = document.getElementById('booking-save-btn');
            if (sb) sb.textContent = 'Salvar';
          }
        });
      }
    });
  });

  // ---- Public API ----------------------------------------

  window.Bookings = {
    openNew:  openNew,
    openEdit: openEdit
  };

})();
