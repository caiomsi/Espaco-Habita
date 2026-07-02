(function () {
  'use strict';

  var GROUP_LABELS = { grande: 'Sala Grande', pequena: 'Sala Pequena', sala1: 'Sala 1' };
  var DAY_NAMES = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

  var pendingClient  = null; // {id, name, phone} from autocomplete
  var pendingFree    = [];   // occurrences that passed conflict check
  var _rooms         = [];   // contract-eligible rooms (pricing_group set)
  var _periodTiers   = [];   // sala_period_tiers for the currently selected room's group
  var _acDebounce    = null;

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatDateBR(dateStr) {
    var p = dateStr.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  // BRT day-of-week from a "YYYY-MM-DD" date string. 0=Mon … 6=Sun. Mirrors series.js.
  function brtDowFromDate(dateStr) {
    var short = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', weekday: 'short'
    }).format(new Date(dateStr + 'T12:00:00-03:00'))
      .toLowerCase().replace('.', '').trim();
    var map = { 'seg': 0, 'ter': 1, 'qua': 2, 'qui': 3, 'sex': 4, 'sáb': 5, 'dom': 6 };
    return map[short.slice(0, 3)];
  }

  // ---- List rendering ---------------------------------------------

  function loadContracts() {
    var list = document.getElementById('contracts-list');
    if (list) list.innerHTML = '<div class="loading-state">Carregando…</div>';

    window.sb.from('sala_contracts').select('*, rooms(name)').order('created_at', { ascending: false })
      .then(function (res) {
        if (res.error) {
          if (list) list.innerHTML = '<div class="error-state">Erro ao carregar contratos: ' + res.error.message + '</div>';
          return;
        }
        renderContracts(res.data || []);
      });
  }

  function renderContracts(contracts) {
    var list = document.getElementById('contracts-list');
    if (!list) return;

    if (contracts.length === 0) {
      list.innerHTML =
        '<div class="empty-state">Nenhum contrato cadastrado ainda.<br>' +
        'Clique em "Novo Contrato" para começar.</div>';
      return;
    }

    list.innerHTML = '';
    contracts.forEach(function (c) {
      var card = document.createElement('div');
      card.className = 'contract-card' + (c.status === 'cancelado' ? ' contract-card--inactive' : '');

      var roomName = (c.rooms && c.rooms.name) ? c.rooms.name : '—';
      var days = (c.days_of_week || []).map(function (d) { return DAY_NAMES[d]; }).join(', ');
      var start = (c.start_time || '').slice(0, 5);
      var end   = (c.end_time   || '').slice(0, 5);

      card.innerHTML =
        '<div class="contract-card-header">' +
          '<div>' +
            '<p class="contract-card-client">' + escHtml(c.client_name) + '</p>' +
            '<p class="contract-card-room">' + escHtml(roomName) + ' · ' + escHtml(c.label) + '</p>' +
          '</div>' +
          '<span class="badge ' + (c.status === 'ativo' ? 'badge--active' : 'badge--inactive') + '">' +
            (c.status === 'ativo' ? 'Ativo' : 'Cancelado') + '</span>' +
        '</div>' +
        '<p class="contract-card-schedule">' + days + ' · ' + start + '–' + end + '</p>' +
        '<p class="contract-card-price">' + window.UI.formatCurrency(c.price_monthly) + '/mês' +
          (c.admin_fee_charged ? ' <span class="contract-card-fee">+ taxa de adesão ' + window.UI.formatCurrency(c.admin_fee_amount) + '</span>' : '') +
        '</p>' +
        '<p class="contract-card-dates">Desde ' + formatDateBR(c.starts_on) +
          (c.ends_on ? ' até ' + formatDateBR(c.ends_on) : '') + '</p>' +
        (c.status === 'ativo'
          ? '<div class="contract-card-actions"><button class="btn btn-ghost btn-sm" data-action="cancel">Cancelar contrato</button></div>'
          : '');

      if (c.status === 'ativo') {
        card.querySelector('[data-action="cancel"]').addEventListener('click', function () {
          handleCancel(c);
        });
      }

      list.appendChild(card);
    });
  }

  function handleCancel(contract) {
    if (!confirm('Cancelar o contrato de ' + contract.client_name + ' (' + contract.label + ')? Ocorrências futuras serão canceladas.')) return;
    var todayStr = window.UI.localDateStr(new Date());
    window.sb.rpc('cancel_sala_contract_future', { p_contract_id: contract.id, p_from: todayStr })
      .then(function (res) {
        if (res.error) { window.UI.toast('Erro ao cancelar contrato.', 'erro'); return; }
        var n = res.data;
        window.UI.toast('Contrato cancelado' + (n != null ? ' — ' + n + ' ocorrência(s) futura(s) removida(s)' : '') + '.', 'ok');
        loadContracts();
      });
  }

  // ---- Modal: rooms + period tiers ---------------------------------

  function loadRoomsSelect() {
    var sel = document.getElementById('ct-room');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Selecione —</option>';
    window.sb.from('rooms').select('id,name,pricing_group').eq('active', true)
      .in('pricing_group', ['grande', 'pequena', 'sala1']).order('name')
      .then(function (res) {
        _rooms = res.data || [];
        _rooms.forEach(function (r) {
          var opt = document.createElement('option');
          opt.value = r.id;
          opt.textContent = r.name + ' (' + GROUP_LABELS[r.pricing_group] + ')';
          sel.appendChild(opt);
        });
      });
  }

  function onRoomChange() {
    var roomId = document.getElementById('ct-room').value;
    var periodSel = document.getElementById('ct-period');
    periodSel.innerHTML = '<option value="">Carregando…</option>';
    periodSel.disabled = true;
    resetConflictPreview();

    var room = _rooms.find(function (r) { return r.id === roomId; });
    if (!room) {
      periodSel.innerHTML = '<option value="">— Selecione uma sala primeiro —</option>';
      return;
    }

    window.Pricing.getPeriodTiers(room.pricing_group).then(function (tiers) {
      _periodTiers = tiers;
      periodSel.innerHTML = '<option value="">— Selecione —</option>';
      tiers.forEach(function (t) {
        var opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.label + ' — ' + window.UI.formatCurrency(t.price_monthly) + '/mês';
        periodSel.appendChild(opt);
      });
      periodSel.disabled = false;
    });
  }

  // ---- Client autocomplete + admin fee preview ----------------------

  function wireAutocomplete() {
    var input = document.getElementById('ct-client');
    if (!input) return;

    input.addEventListener('input', function () {
      pendingClient = null;
      document.getElementById('ct-client-id').value = '';
      hideAdminFeeNote();
      clearTimeout(_acDebounce);
      var box  = document.getElementById('ct-client-suggestions');
      var term = input.value.trim();
      if (!box) return;
      if (term.length < 1) { box.hidden = true; box.innerHTML = ''; return; }

      _acDebounce = setTimeout(function () {
        window.sb.from('clients')
          .select('id,name,phone')
          .eq('active', true)
          .ilike('name', '%' + term + '%')
          .limit(8)
          .then(function (res) {
            box.innerHTML = '';
            var clients = res.data || [];
            if (clients.length === 0) { box.hidden = true; return; }
            clients.forEach(function (c) {
              var item = document.createElement('div');
              item.className = 'client-suggestion-item';
              item.innerHTML =
                '<span>' + escHtml(c.name) + '</span>' +
                (c.phone ? '<span class="client-suggestion-phone">' + escHtml(c.phone) + '</span>' : '');
              item.addEventListener('mousedown', function (e) {
                e.preventDefault();
                input.value = c.name;
                document.getElementById('ct-client-id').value = c.id;
                pendingClient = { id: c.id, name: c.name, phone: c.phone };
                box.hidden = true;
                showAdminFeeNoteIfFirst(c.id);
              });
              box.appendChild(item);
            });
            box.hidden = false;
          });
      }, 200);
    });

    input.addEventListener('blur', function () {
      setTimeout(function () {
        var box2 = document.getElementById('ct-client-suggestions');
        if (box2) box2.hidden = true;
      }, 150);
    });
  }

  function hideAdminFeeNote() {
    var el = document.getElementById('ct-admin-fee-note');
    if (el) el.hidden = true;
  }

  // Client-side preview only — the create_sala_contract RPC re-checks this
  // server-side and is the source of truth for whether the fee is actually charged.
  function showAdminFeeNoteIfFirst(clientId) {
    window.sb.from('sala_contracts').select('id', { count: 'exact', head: true }).eq('client_id', clientId)
      .then(function (res) {
        var el = document.getElementById('ct-admin-fee-note');
        if (!el) return;
        if ((res.count || 0) === 0) {
          el.textContent = 'Este será o primeiro contrato deste cliente — a taxa de administração será cobrada.';
          el.hidden = false;
        } else {
          el.hidden = true;
        }
      });
  }

  // ---- Occurrence generation + conflict check (mirrors series.js) ----

  function generateOccurrences(rule) {
    var todayStr = window.UI.localDateStr(new Date());
    var startStr = rule.starts_on < todayStr ? todayStr : rule.starts_on;
    var current   = new Date(startStr + 'T12:00:00-03:00');
    var limitDate = new Date(current.getTime() + 366 * 86400000);

    var occurrences = [];
    var safety = 0;
    while (current <= limitDate && safety < 600) {
      safety++;
      var dateStr = window.UI.localDateStr(current);
      var dow     = brtDowFromDate(dateStr);
      if (rule.days_of_week.indexOf(dow) !== -1) {
        var st = rule.start_time.length === 5 ? rule.start_time + ':00' : rule.start_time;
        var et = rule.end_time.length   === 5 ? rule.end_time   + ':00' : rule.end_time;
        occurrences.push({
          starts_at: dateStr + 'T' + st + '-03:00',
          ends_at:   dateStr + 'T' + et + '-03:00',
          date_str:  dateStr
        });
      }
      current = new Date(current.getTime() + 86400000);
    }
    return occurrences;
  }

  function checkAllConflicts(roomId, occurrences) {
    if (occurrences.length === 0) return Promise.resolve({ free: [], conflicts: [] });
    var checks = occurrences.map(function (o) {
      return window.checkOverlap(roomId, o.starts_at, o.ends_at, null, null);
    });
    return Promise.all(checks).then(function (results) {
      var free = [], conflicts = [];
      results.forEach(function (r, i) {
        (r.hasConflict ? conflicts : free).push(occurrences[i]);
      });
      return { free: free, conflicts: conflicts };
    });
  }

  function resetConflictPreview() {
    pendingFree = [];
    var el = document.getElementById('ct-conflict-preview');
    if (el) { el.hidden = true; el.innerHTML = ''; }
    var btn = document.getElementById('ct-create-btn');
    if (btn) btn.hidden = true;
  }

  function showConflictPreview(free, conflicts, total) {
    var el = document.getElementById('ct-conflict-preview');
    if (!el) return;
    el.hidden = false;
    var html = '';
    if (conflicts.length === 0) {
      html = '<p class="sr-preview-ok">✓ Nenhum conflito. ' + total + ' ocorrência' + (total === 1 ? '' : 's') + ' serão criadas.</p>';
    } else {
      var dates = conflicts.slice(0, 5).map(function (c) { return formatDateBR(c.date_str); }).join(', ');
      var more  = conflicts.length > 5 ? ' e mais ' + (conflicts.length - 5) : '';
      html += '<p class="sr-preview-warn">⚠ ' + conflicts.length + ' data' + (conflicts.length === 1 ? '' : 's') +
        ' com conflito: ' + dates + more + '. Serão ignoradas.</p>';
      if (free.length > 0) {
        html += '<p class="sr-preview-info">' + free.length + ' ocorrência' + (free.length === 1 ? '' : 's') + ' sem conflito serão criadas.</p>';
      } else {
        html += '<p class="sr-preview-warn">Todas as datas conflitam — nenhuma ocorrência será criada.</p>';
      }
    }
    el.innerHTML = html;
    var createBtn = document.getElementById('ct-create-btn');
    if (createBtn) createBtn.hidden = free.length === 0;
  }

  // ---- Read + validate form ------------------------------------------

  function readForm() {
    var roomId    = document.getElementById('ct-room').value;
    var periodId  = document.getElementById('ct-period').value;
    var startTime = document.getElementById('ct-start-time').value;
    var endTime   = document.getElementById('ct-end-time').value;
    var startsOn  = document.getElementById('ct-starts-on').value;
    var notes     = document.getElementById('ct-notes').value.trim();

    var daysOfWeek = [];
    for (var d = 0; d < 7; d++) {
      var cb = document.getElementById('ct-dow-' + d);
      if (cb && cb.checked) daysOfWeek.push(d);
    }

    var room = _rooms.find(function (r) { return r.id === roomId; });
    var tier = _periodTiers.find(function (t) { return t.id === periodId; });

    return {
      room: room,
      tier: tier,
      client: pendingClient,
      rule: {
        room_id:      roomId,
        client_id:    pendingClient ? pendingClient.id : null,
        client_name:  pendingClient ? pendingClient.name : '',
        client_phone: pendingClient ? pendingClient.phone : null,
        room_group:   room ? room.pricing_group : null,
        period_type:  tier ? tier.period_type : null,
        label:        tier ? tier.label : null,
        price_monthly: tier ? tier.price_monthly : null,
        days_of_week: daysOfWeek,
        start_time:   startTime,
        end_time:     endTime,
        starts_on:    startsOn,
        notes:        notes || null
      }
    };
  }

  function validate(data) {
    if (!data.room)                           return 'Selecione uma sala.';
    if (!data.client || !data.client.id)      return 'Selecione um cliente da lista.';
    if (!data.tier)                           return 'Selecione um período.';
    if (data.rule.days_of_week.length === 0)  return 'Selecione ao menos um dia da semana.';
    if (!data.rule.start_time)                return 'Informe o horário de início.';
    if (!data.rule.end_time)                  return 'Informe o horário de término.';
    if (data.rule.start_time >= data.rule.end_time) return 'O término deve ser após o início.';
    if (!data.rule.starts_on)                 return 'Informe a data da primeira ocorrência.';
    return null;
  }

  function setError(msg) {
    var el = document.getElementById('contract-error');
    if (!el) return;
    if (msg) { el.textContent = msg; el.hidden = false; } else { el.hidden = true; el.textContent = ''; }
  }

  // ---- Check conflicts / create ---------------------------------------

  function onCheckConflicts() {
    var data = readForm();
    var err  = validate(data);
    if (err) { setError(err); return; }
    setError('');
    resetConflictPreview();

    var checkBtn = document.getElementById('ct-check-btn');
    if (checkBtn) { checkBtn.disabled = true; checkBtn.textContent = 'Verificando…'; }

    var occurrences = generateOccurrences(data.rule);
    if (occurrences.length === 0) {
      var el = document.getElementById('ct-conflict-preview');
      if (el) { el.innerHTML = '<p class="sr-preview-warn">Nenhuma ocorrência encontrada para o período e dias selecionados.</p>'; el.hidden = false; }
      if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = 'Verificar conflitos'; }
      return;
    }

    checkAllConflicts(data.rule.room_id, occurrences).then(function (result) {
      pendingFree = result.free;
      showConflictPreview(result.free, result.conflicts, occurrences.length);
      if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = 'Verificar conflitos'; }
    }).catch(function () {
      window.UI.toast('Erro ao verificar conflitos. Tente novamente.', 'erro');
      if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = 'Verificar conflitos'; }
    });
  }

  function onCreateContract() {
    if (pendingFree.length === 0) return;
    var data = readForm();
    var saveBtn = document.getElementById('ct-create-btn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Salvando…'; }

    window.sb.rpc('create_sala_contract', {
      p_contract: {
        room_id:      data.rule.room_id,
        client_id:    data.rule.client_id,
        client_name:  data.rule.client_name,
        client_phone: data.rule.client_phone,
        room_group:   data.rule.room_group,
        period_type:  data.rule.period_type,
        label:        data.rule.label,
        price_monthly: data.rule.price_monthly,
        days_of_week: data.rule.days_of_week,
        start_time:   data.rule.start_time,
        end_time:     data.rule.end_time,
        starts_on:    data.rule.starts_on,
        notes:        data.rule.notes
      },
      p_occurrences: pendingFree
    }).then(function (res) {
      if (res.error) {
        window.UI.toast('Não foi possível criar o contrato — algum horário ficou indisponível. Verifique os conflitos novamente.', 'erro');
        if (saveBtn) saveBtn.disabled = false;
        resetConflictPreview();
        return;
      }
      window.UI.toast('Contrato criado.', 'ok');
      window.UI.closeAllModals();
      loadContracts();
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Criar Contrato'; }
    });
  }

  // ---- Open modal --------------------------------------------------

  function openNewContractModal() {
    pendingClient = null;
    pendingFree   = [];
    var form = document.getElementById('contract-form');
    if (form) form.reset();
    setError('');
    resetConflictPreview();
    hideAdminFeeNote();
    document.getElementById('ct-client-id').value = '';
    var periodSel = document.getElementById('ct-period');
    periodSel.innerHTML = '<option value="">— Selecione uma sala primeiro —</option>';
    periodSel.disabled = true;
    loadRoomsSelect();
    window.UI.openModal('contract-modal');
  }

  // ---- Boot -----------------------------------------------------------

  function boot() {
    loadContracts();

    var newBtn = document.getElementById('new-contract-btn');
    if (newBtn) newBtn.addEventListener('click', openNewContractModal);

    wireAutocomplete();

    var roomSelect = document.getElementById('ct-room');
    if (roomSelect) roomSelect.addEventListener('change', onRoomChange);

    var checkBtn = document.getElementById('ct-check-btn');
    if (checkBtn) checkBtn.addEventListener('click', onCheckConflicts);

    var createBtn = document.getElementById('ct-create-btn');
    if (createBtn) createBtn.addEventListener('click', onCreateContract);

    ['ct-room', 'ct-period', 'ct-start-time', 'ct-end-time', 'ct-starts-on'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', resetConflictPreview);
    });
    for (var d = 0; d < 7; d++) {
      var cb = document.getElementById('ct-dow-' + d);
      if (cb) cb.addEventListener('change', resetConflictPreview);
    }
  }

  if (window.authReady) { boot(); } else {
    document.addEventListener('auth:ready', boot, { once: true });
    setTimeout(function () {
      if (!window.authReady) {
        var list = document.getElementById('contracts-list');
        if (list && list.querySelector('.loading-state')) {
          list.innerHTML = '<div class="error-state">Não foi possível conectar. <a href="login.html">Fazer login novamente</a>.</div>';
        }
      }
    }, 10000);
  }

})();
