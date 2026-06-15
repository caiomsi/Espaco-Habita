(function () {
  'use strict';

  var currentRoom = null; // null = new; object = editing

  // ---- Load & render rooms list --------------------------

  function loadRooms() {
    var list = document.getElementById('rooms-list');
    if (list) list.innerHTML = '<div class="loading-state">Carregando…</div>';

    window.sb.from('rooms').select('*').order('name').then(function (res) {
      if (res.error) {
        if (list) list.innerHTML = '<div class="error-state">Erro ao carregar salas: ' + res.error.message + '</div>';
        return;
      }
      renderRooms(res.data || []);
    });
  }

  function renderRooms(rooms) {
    var list = document.getElementById('rooms-list');
    if (!list) return;

    if (rooms.length === 0) {
      list.innerHTML =
        '<div class="empty-state">Nenhuma sala cadastrada ainda.<br>' +
        'Clique em "Adicionar Sala" para começar.</div>';
      return;
    }

    list.innerHTML = '';
    rooms.forEach(function (room) {
      var card = document.createElement('div');
      card.className = 'room-card' + (room.active ? '' : ' room-card--inactive');

      var ratesHtml = '';
      if (room.rate_hourly || room.rate_daily) {
        ratesHtml = '<div class="room-card-rates">';
        if (room.rate_hourly) {
          ratesHtml += '<span>Hora: <strong>' + window.UI.formatCurrency(room.rate_hourly) + '</strong></span>';
        }
        if (room.rate_daily) {
          ratesHtml += '<span>Dia: <strong>' + window.UI.formatCurrency(room.rate_daily) + '</strong></span>';
        }
        ratesHtml += '</div>';
      }

      card.innerHTML =
        '<div class="room-card-header">' +
          '<div class="room-card-info">' +
            '<h3 class="room-card-name">' + escHtml(room.name) + '</h3>' +
            (room.description
              ? '<p class="room-card-desc">' + escHtml(room.description) + '</p>'
              : '') +
          '</div>' +
          '<div class="room-card-badges">' +
            (room.capacity
              ? '<span class="badge">' + room.capacity + ' pessoas</span>'
              : '') +
            '<span class="badge ' + (room.active ? 'badge--active' : 'badge--inactive') + '">' +
              (room.active ? 'Ativa' : 'Inativa') + '</span>' +
          '</div>' +
        '</div>' +
        ratesHtml +
        '<div class="room-card-actions">' +
          '<button class="btn btn-ghost btn-sm" data-action="edit">Editar</button>' +
          '<button class="btn btn-ghost btn-sm" data-action="toggle">' +
            (room.active ? 'Desativar' : 'Reativar') + '</button>' +
        '</div>';

      card.querySelector('[data-action="edit"]').addEventListener('click', function () {
        openEdit(room);
      });

      card.querySelector('[data-action="toggle"]').addEventListener('click', function () {
        var label = room.active ? 'Desativar' : 'Reativar';
        if (!confirm(label + ' a sala "' + room.name + '"?')) return;
        window.sb.from('rooms')
          .update({ active: !room.active })
          .eq('id', room.id)
          .then(function (res) {
            if (res.error) { window.UI.toast('Erro ao atualizar sala.', 'erro'); return; }
            window.UI.toast('Sala ' + (room.active ? 'desativada' : 'reativada') + '.', 'ok');
            loadRooms();
          });
      });

      list.appendChild(card);
    });
  }

  // ---- Open modal: new room ------------------------------

  function openNew() {
    currentRoom = null;
    var form = document.getElementById('room-form');
    if (form) form.reset();
    document.getElementById('room-modal-title').textContent = 'Nova Sala';
    document.getElementById('room-error').hidden = true;
    window.UI.openModal('room-modal');
  }

  // ---- Open modal: edit room -----------------------------

  function openEdit(room) {
    currentRoom = room;
    var form = document.getElementById('room-form');
    if (form) form.reset();
    document.getElementById('room-modal-title').textContent = 'Editar Sala';
    document.getElementById('room-error').hidden = true;
    document.getElementById('rm-name').value        = room.name        || '';
    document.getElementById('rm-description').value = room.description || '';
    document.getElementById('rm-capacity').value    = room.capacity    || '';
    document.getElementById('rm-rate-hourly').value = room.rate_hourly || '';
    document.getElementById('rm-rate-daily').value  = room.rate_daily  || '';
    window.UI.openModal('room-modal');
  }

  // ---- Helpers -------------------------------------------

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---- Boot: wire events after auth is confirmed ---------

  document.addEventListener('auth:ready', function () {
    loadRooms();

    var addBtn = document.getElementById('add-room-btn');
    if (addBtn) addBtn.addEventListener('click', openNew);
  });

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('room-form');
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var saveBtn = document.getElementById('room-save-btn');
      var name    = document.getElementById('rm-name').value.trim();

      if (!name) {
        document.getElementById('room-error').textContent = 'O nome da sala é obrigatório.';
        document.getElementById('room-error').hidden = false;
        return;
      }

      document.getElementById('room-error').hidden = true;

      var capacity   = parseInt(document.getElementById('rm-capacity').value);
      var rateHourly = parseFloat(document.getElementById('rm-rate-hourly').value);
      var rateDaily  = parseFloat(document.getElementById('rm-rate-daily').value);

      var payload = {
        name:        name,
        description: document.getElementById('rm-description').value.trim() || null,
        capacity:    isNaN(capacity)   ? null : capacity,
        rate_hourly: isNaN(rateHourly) ? null : rateHourly,
        rate_daily:  isNaN(rateDaily)  ? null : rateDaily
      };

      window.UI.setLoading(saveBtn, true);

      var promise = currentRoom
        ? window.sb.from('rooms').update(payload).eq('id', currentRoom.id)
        : window.sb.from('rooms').insert(payload);

      promise.then(function (res) {
        window.UI.setLoading(saveBtn, false);
        if (res.error) {
          document.getElementById('room-error').textContent = 'Erro: ' + res.error.message;
          document.getElementById('room-error').hidden = false;
          return;
        }
        window.UI.closeAllModals();
        window.UI.toast(currentRoom ? 'Sala atualizada.' : 'Sala criada.', 'ok');
        loadRooms();
      });
    });
  });

})();
