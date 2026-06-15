(function () {
  'use strict';

  var currentClient = null; // null = new; object = editing
  var plansClient   = null; // client whose plans modal is open

  var DAY_NAMES = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

  // ---- Load & render clients --------------------------------

  function loadClients() {
    var list = document.getElementById('clients-list');
    if (list) list.innerHTML = '<div class="loading-state">Carregando…</div>';

    window.sb
      .from('clients')
      .select('*, client_plans(*, rooms(name))')
      .order('name')
      .then(function (res) {
        if (res.error) {
          if (list) list.innerHTML = '<div class="error-state">Erro ao carregar clientes: ' + res.error.message + '</div>';
          return;
        }
        renderClients(res.data || []);
      });
  }

  function renderClients(clients) {
    var list = document.getElementById('clients-list');
    if (!list) return;

    if (clients.length === 0) {
      list.innerHTML =
        '<div class="empty-state">Nenhum cliente cadastrado ainda.<br>' +
        'Clique em "Adicionar Cliente" para começar.</div>';
      return;
    }

    list.innerHTML = '';
    clients.forEach(function (client) {
      var card = document.createElement('div');
      card.className = 'client-card' + (client.active ? '' : ' client-card--inactive');

      // Plan chips
      var plans = (client.client_plans || []).filter(function (p) { return p.active; });
      var plansHtml = '';
      if (plans.length > 0) {
        plansHtml = '<div class="client-card-plans">';
        plans.forEach(function (p) {
          var roomName = (p.rooms && p.rooms.name) ? p.rooms.name : 'Sala';
          var start = p.start_time ? p.start_time.slice(0, 5) : '';
          var end   = p.end_time   ? p.end_time.slice(0, 5)   : '';
          plansHtml += '<span class="plan-chip">' +
            DAY_NAMES[p.day_of_week] + ' · ' + roomName + ' · ' + start + '–' + end +
            '</span>';
        });
        plansHtml += '</div>';
      }

      var metaLines = [];
      if (client.phone) metaLines.push(escHtml(client.phone));
      if (client.email) metaLines.push(escHtml(client.email));

      card.innerHTML =
        '<div class="client-card-header">' +
          '<div>' +
            '<p class="client-card-name">' + escHtml(client.name) + '</p>' +
            (metaLines.length ? '<p class="client-card-meta">' + metaLines.join('<br>') + '</p>' : '') +
          '</div>' +
          '<span class="badge ' + (client.active ? 'badge--active' : 'badge--inactive') + '">' +
            (client.active ? 'Ativo' : 'Inativo') + '</span>' +
        '</div>' +
        plansHtml +
        '<div class="client-card-actions">' +
          '<button class="btn btn-ghost btn-sm" data-action="edit">Editar</button>' +
          '<button class="btn btn-ghost btn-sm" data-action="plans">Planos</button>' +
          '<button class="btn btn-ghost btn-sm" data-action="toggle">' +
            (client.active ? 'Desativar' : 'Reativar') + '</button>' +
        '</div>';

      card.querySelector('[data-action="edit"]').addEventListener('click', function () {
        openEdit(client);
      });

      card.querySelector('[data-action="plans"]').addEventListener('click', function () {
        openPlans(client);
      });

      card.querySelector('[data-action="toggle"]').addEventListener('click', function () {
        var label = client.active ? 'Desativar' : 'Reativar';
        if (!confirm(label + ' o cliente "' + client.name + '"?')) return;
        window.sb.from('clients')
          .update({ active: !client.active })
          .eq('id', client.id)
          .then(function (res) {
            if (res.error) { window.UI.toast('Erro ao atualizar cliente.', 'erro'); return; }
            window.UI.toast('Cliente ' + (client.active ? 'desativado' : 'reativado') + '.', 'ok');
            loadClients();
          });
      });

      list.appendChild(card);
    });
  }

  // ---- Client modal ----------------------------------------

  function openNew() {
    currentClient = null;
    var form = document.getElementById('client-form');
    if (form) form.reset();
    document.getElementById('client-modal-title').textContent = 'Novo Cliente';
    document.getElementById('client-error').hidden = true;
    window.UI.openModal('client-modal');
  }

  function openEdit(client) {
    currentClient = client;
    var form = document.getElementById('client-form');
    if (form) form.reset();
    document.getElementById('client-modal-title').textContent = 'Editar Cliente';
    document.getElementById('client-error').hidden = true;
    document.getElementById('cl-name').value  = client.name  || '';
    document.getElementById('cl-phone').value = client.phone || '';
    document.getElementById('cl-email').value = client.email || '';
    document.getElementById('cl-notes').value = client.notes || '';
    window.UI.openModal('client-modal');
  }

  // ---- Plans modal -----------------------------------------

  function openPlans(client) {
    plansClient = client;
    document.getElementById('plans-modal-title').textContent = 'Planos — ' + client.name;
    document.getElementById('plan-error').hidden = true;

    // Reset add-form inputs
    document.querySelectorAll('.days-checkboxes input[type="checkbox"]').forEach(function (cb) {
      cb.checked = false;
    });
    var startEl = document.getElementById('pl-start');
    var endEl   = document.getElementById('pl-end');
    if (startEl) startEl.value = '';
    if (endEl)   endEl.value   = '';

    loadRoomsSelect();
    loadPlansList(client.id);
    window.UI.openModal('plans-modal');
  }

  function loadRoomsSelect() {
    var sel = document.getElementById('pl-room');
    if (!sel) return;
    window.sb.from('rooms').select('id,name').eq('active', true).order('name')
      .then(function (res) {
        sel.innerHTML = '';
        (res.data || []).forEach(function (r) {
          var opt = document.createElement('option');
          opt.value = r.id;
          opt.textContent = r.name;
          sel.appendChild(opt);
        });
        if (!res.data || res.data.length === 0) {
          sel.innerHTML = '<option value="">— Nenhuma sala ativa —</option>';
        }
      });
  }

  function loadPlansList(clientId) {
    var list = document.getElementById('plans-list');
    if (list) list.innerHTML = '<div class="loading-state" style="padding:.75rem">Carregando…</div>';

    window.sb
      .from('client_plans')
      .select('*, rooms(name)')
      .eq('client_id', clientId)
      .eq('active', true)
      .order('day_of_week')
      .then(function (res) {
        if (res.error) {
          if (list) list.innerHTML = '<p class="form-error">Erro ao carregar planos.</p>';
          return;
        }
        renderPlansList(res.data || []);
      });
  }

  function renderPlansList(plans) {
    var list = document.getElementById('plans-list');
    if (!list) return;

    if (plans.length === 0) {
      list.innerHTML = '<p style="font-size:.875rem;color:var(--text-muted);text-align:center;padding:.5rem 0">Nenhum plano cadastrado.</p>';
      return;
    }

    list.innerHTML = '';
    plans.forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'plan-row';
      var roomName = (p.rooms && p.rooms.name) ? p.rooms.name : '—';
      var start = p.start_time ? p.start_time.slice(0, 5) : '';
      var end   = p.end_time   ? p.end_time.slice(0, 5)   : '';
      row.innerHTML =
        '<span class="plan-row-day">' + DAY_NAMES[p.day_of_week] + '</span>' +
        '<span class="plan-row-info">' + escHtml(roomName) + ' · ' + start + '–' + end + '</span>' +
        '<button class="plan-row-delete" title="Remover plano" data-plan-id="' + p.id + '">&times;</button>';

      row.querySelector('.plan-row-delete').addEventListener('click', function () {
        deletePlan(p.id);
      });

      list.appendChild(row);
    });
  }

  function deletePlan(planId) {
    window.sb.from('client_plans').update({ active: false }).eq('id', planId)
      .then(function (res) {
        if (res.error) { window.UI.toast('Erro ao remover plano.', 'erro'); return; }
        window.UI.toast('Plano removido.', 'ok');
        if (plansClient) loadPlansList(plansClient.id);
        loadClients();
      });
  }

  function addPlan() {
    if (!plansClient) return;
    var errEl = document.getElementById('plan-error');
    errEl.hidden = true;

    var roomId = document.getElementById('pl-room').value;
    var start  = document.getElementById('pl-start').value;
    var end    = document.getElementById('pl-end').value;
    var days   = Array.from(
      document.querySelectorAll('.days-checkboxes input[type="checkbox"]:checked')
    ).map(function (cb) { return parseInt(cb.value); });

    if (!roomId)         { errEl.textContent = 'Selecione uma sala.'; errEl.hidden = false; return; }
    if (days.length === 0) { errEl.textContent = 'Selecione ao menos um dia.'; errEl.hidden = false; return; }
    if (!start)          { errEl.textContent = 'Informe o horário de início.'; errEl.hidden = false; return; }
    if (!end)            { errEl.textContent = 'Informe o horário de término.'; errEl.hidden = false; return; }
    if (end <= start)    { errEl.textContent = 'O término deve ser após o início.'; errEl.hidden = false; return; }

    var saveBtn = document.getElementById('plan-save-btn');
    window.UI.setLoading(saveBtn, true);

    var rows = days.map(function (d) {
      return {
        client_id:   plansClient.id,
        room_id:     roomId,
        day_of_week: d,
        start_time:  start,
        end_time:    end
      };
    });

    window.sb.from('client_plans').insert(rows)
      .then(function (res) {
        window.UI.setLoading(saveBtn, false);
        if (res.error) {
          errEl.textContent = 'Erro ao salvar: ' + res.error.message;
          errEl.hidden = false;
          return;
        }
        window.UI.toast('Plano(s) adicionado(s).', 'ok');
        // Reset day checkboxes
        document.querySelectorAll('.days-checkboxes input[type="checkbox"]').forEach(function (cb) {
          cb.checked = false;
        });
        document.getElementById('pl-start').value = '';
        document.getElementById('pl-end').value   = '';
        loadPlansList(plansClient.id);
        loadClients();
      });
  }

  // ---- Helpers ---------------------------------------------

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- Boot -----------------------------------------------

  document.addEventListener('auth:ready', function () {
    loadClients();
    var addBtn = document.getElementById('add-client-btn');
    if (addBtn) addBtn.addEventListener('click', openNew);
  });

  document.addEventListener('DOMContentLoaded', function () {
    // Client form submit
    var form = document.getElementById('client-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var saveBtn = document.getElementById('client-save-btn');
        var name = document.getElementById('cl-name').value.trim();
        var errEl = document.getElementById('client-error');

        if (!name) {
          errEl.textContent = 'O nome do cliente é obrigatório.';
          errEl.hidden = false;
          return;
        }
        errEl.hidden = true;

        var payload = {
          name:  name,
          phone: document.getElementById('cl-phone').value.trim() || null,
          email: document.getElementById('cl-email').value.trim() || null,
          notes: document.getElementById('cl-notes').value.trim() || null
        };

        window.UI.setLoading(saveBtn, true);

        var promise = currentClient
          ? window.sb.from('clients').update(payload).eq('id', currentClient.id)
          : window.sb.from('clients').insert(payload);

        promise.then(function (res) {
          window.UI.setLoading(saveBtn, false);
          if (res.error) {
            errEl.textContent = 'Erro: ' + res.error.message;
            errEl.hidden = false;
            return;
          }
          window.UI.closeAllModals();
          window.UI.toast(currentClient ? 'Cliente atualizado.' : 'Cliente criado.', 'ok');
          loadClients();
        });
      });
    }

    // Plan save button
    var planSaveBtn = document.getElementById('plan-save-btn');
    if (planSaveBtn) planSaveBtn.addEventListener('click', addPlan);
  });

})();
