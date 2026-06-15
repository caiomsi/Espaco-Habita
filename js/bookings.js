(function () {
  'use strict';

  var currentBooking = null; // null = new booking; object = editing existing
  var pendingForce   = false; // true after first conflict warning, next submit proceeds

  // ---- Room select helper --------------------------------

  function populateRoomSelect(rooms, selectedId) {
    var sel = document.getElementById('bk-room');
    if (!sel) return;
    sel.innerHTML = '';
    rooms.forEach(function (r) {
      var opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.name;
      if (r.id === selectedId) opt.selected = true;
      sel.appendChild(opt);
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
      // Load rooms fresh from Supabase (used by the header button)
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
    document.getElementById('bk-phone').value  = booking.client_phone || '';
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

  // ---- Conflict detection --------------------------------

  function checkConflict(roomId, startsAt, endsAt, excludeId) {
    var q = window.sb.from('bookings')
      .select('id, client_name, starts_at, ends_at')
      .eq('room_id', roomId)
      .neq('status', 'cancelado')
      .lt('starts_at', endsAt)   // other booking starts before this one ends
      .gt('ends_at', startsAt);  // other booking ends after this one starts
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
    var newBookingBtn = document.getElementById('new-booking-btn');
    if (newBookingBtn) {
      newBookingBtn.addEventListener('click', function () {
        openNew(null, null, null);
      });
    }

    var form = document.getElementById('booking-form');
    if (!form) return;

    // Form submit
    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var saveBtn    = document.getElementById('booking-save-btn');
      var roomId     = document.getElementById('bk-room').value;
      var clientName = document.getElementById('bk-client').value.trim();
      var phone      = document.getElementById('bk-phone').value.trim();
      var startVal   = document.getElementById('bk-start').value;
      var endVal     = document.getElementById('bk-end').value;
      var status     = document.getElementById('bk-status').value;
      var notes      = document.getElementById('bk-notes').value.trim();

      // Basic validation
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
        client_phone: phone  || null,
        starts_at:    startsAt,
        ends_at:      endsAt,
        status:       status,
        notes:        notes || null
      };

      // Second click after conflict warning: skip check and force-save
      if (pendingForce) {
        doSave(payload);
        return;
      }

      // First attempt: check for overlap
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

    // Delete button
    var deleteBtn = document.getElementById('booking-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function () {
        if (!currentBooking) return;
        if (!confirm('Excluir a reserva de ' + currentBooking.client_name + '?')) return;

        window.sb.from('bookings').delete().eq('id', currentBooking.id)
          .then(function (res) {
            if (res.error) {
              window.UI.toast('Erro ao excluir reserva.', 'erro');
              return;
            }
            window.UI.closeAllModals();
            window.UI.toast('Reserva excluída.', 'ok');
            if (window.Calendar) window.Calendar.refresh();
          });
      });
    }

    // Reset conflict state when room/time inputs change
    ['bk-room', 'bk-start', 'bk-end'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', function () {
          if (pendingForce) {
            pendingForce = false;
            setWarning('');
            var saveBtn = document.getElementById('booking-save-btn');
            if (saveBtn) saveBtn.textContent = 'Salvar';
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
