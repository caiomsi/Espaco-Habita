(function () {
  'use strict';

  var currentBlocked = null; // null = new; object = editing existing

  // ---- Room select helper --------------------------------

  function populateRoomSelect(rooms, selectedId) {
    var sel = document.getElementById('bl-room');
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

  // ---- Open modal: new blocked time ----------------------

  function openNew(roomId, startDate, rooms) {
    currentBlocked = null;

    resetForm();
    document.getElementById('blocked-modal-title').textContent = 'Bloquear Sala';
    var delBtn = document.getElementById('blocked-delete-btn');
    if (delBtn) { delBtn.hidden = true; delBtn.style.display = 'none'; }
    var saveBtn = document.getElementById('blocked-save-btn');
    if (saveBtn) saveBtn.textContent = 'Salvar';

    var start = startDate || new Date();
    var end   = new Date(start.getTime() + 60 * 60000);
    var startEl = document.getElementById('bl-start');
    var endEl   = document.getElementById('bl-end');
    if (startEl) startEl.value = window.UI.toDatetimeLocal(start);
    if (endEl)   endEl.value   = window.UI.toDatetimeLocal(end);

    if (rooms && rooms.length > 0) {
      populateRoomSelect(rooms, roomId);
      window.UI.openModal('blocked-modal');
    } else {
      window.sb.from('rooms').select('*').eq('active', true).order('name')
        .then(function (res) {
          populateRoomSelect(res.data || [], roomId);
          window.UI.openModal('blocked-modal');
        });
    }
  }

  // ---- Open modal: edit existing blocked time ------------

  function openEdit(blocked, rooms) {
    currentBlocked = blocked;

    resetForm();
    document.getElementById('blocked-modal-title').textContent = 'Editar Bloqueio';
    var delBtn = document.getElementById('blocked-delete-btn');
    if (delBtn) { delBtn.hidden = false; delBtn.style.display = ''; }
    var saveBtn = document.getElementById('blocked-save-btn');
    if (saveBtn) saveBtn.textContent = 'Salvar';

    var loadRooms = (rooms && rooms.length > 0)
      ? Promise.resolve({ data: rooms, error: null })
      : window.sb.from('rooms').select('*').eq('active', true).order('name');

    loadRooms.then(function (res) {
      populateRoomSelect(res.data || [], blocked.room_id);
      var startEl = document.getElementById('bl-start');
      var endEl   = document.getElementById('bl-end');
      var reasonEl = document.getElementById('bl-reason');
      if (startEl)  startEl.value  = window.UI.toDatetimeLocal(new Date(blocked.starts_at));
      if (endEl)    endEl.value    = window.UI.toDatetimeLocal(new Date(blocked.ends_at));
      if (reasonEl) reasonEl.value = blocked.reason || '';
      window.UI.openModal('blocked-modal');
    });
  }

  // ---- Shared helpers ------------------------------------

  function resetForm() {
    var form = document.getElementById('blocked-form');
    if (form) form.reset();
    setError('');
  }

  function setError(msg) {
    var el = document.getElementById('blocked-error');
    if (!el) return;
    if (msg) { el.textContent = msg; el.hidden = false; }
    else      { el.hidden = true; el.textContent = ''; }
  }

  // ---- Boot: wire form events ----------------------------

  document.addEventListener('DOMContentLoaded', function () {

    // "Bloquear sala" button in the calendar toolbar
    var blockBtn = document.getElementById('block-room-btn');
    if (blockBtn) {
      blockBtn.addEventListener('click', function () {
        openNew(null, null, null);
      });
    }

    var form = document.getElementById('blocked-form');
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var saveBtn  = document.getElementById('blocked-save-btn');
      var roomId   = document.getElementById('bl-room').value;
      var startVal = document.getElementById('bl-start').value;
      var endVal   = document.getElementById('bl-end').value;
      var reason   = document.getElementById('bl-reason').value.trim();

      if (!roomId)   { setError('Selecione uma sala.'); return; }
      if (!startVal) { setError('A data/hora de início é obrigatória.'); return; }
      if (!endVal)   { setError('A data/hora de término é obrigatória.'); return; }

      var startsAt = window.UI.datetimeLocalToISO(startVal);
      var endsAt   = window.UI.datetimeLocalToISO(endVal);

      if (new Date(endsAt) <= new Date(startsAt)) {
        setError('O término deve ser após o início.');
        return;
      }

      setError('');

      var payload = {
        room_id:   roomId,
        starts_at: startsAt,
        ends_at:   endsAt,
        reason:    reason || null
      };

      window.UI.setLoading(saveBtn, true);

      var promise = currentBlocked
        ? window.sb.from('blocked_times').update(payload).eq('id', currentBlocked.id)
        : window.sb.from('blocked_times').insert(payload);

      promise.then(function (res) {
        window.UI.setLoading(saveBtn, false);
        if (res.error) {
          var msg = res.error.message || '';
          if (msg.indexOf('blocked_no_overlap') !== -1 || msg.indexOf('exclusion constraint') !== -1) {
            setError('Já existe outro bloqueio neste horário para esta sala.');
          } else {
            setError('Erro ao salvar: ' + msg);
          }
          return;
        }
        window.UI.closeAllModals();
        window.UI.toast(currentBlocked ? 'Bloqueio atualizado.' : 'Sala bloqueada.', 'ok');
        if (window.Calendar) window.Calendar.refresh();
      });
    });

    var deleteBtn = document.getElementById('blocked-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function () {
        if (!currentBlocked) return;
        if (!confirm('Remover este bloqueio?')) return;
        window.sb.from('blocked_times').delete().eq('id', currentBlocked.id)
          .then(function (res) {
            if (res.error) { window.UI.toast('Erro ao remover bloqueio.', 'erro'); return; }
            window.UI.closeAllModals();
            window.UI.toast('Bloqueio removido.', 'ok');
            if (window.Calendar) window.Calendar.refresh();
          });
      });
    }
  });

  // ---- Public API ----------------------------------------

  window.BlockedTimes = {
    openNew:  openNew,
    openEdit: openEdit
  };

})();
