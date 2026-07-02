(function () {
  'use strict';

  // ---- Module state ------------------------------------------

  var pendingFree      = [];    // occurrences that passed conflict check, ready to insert
  var pendingClient    = null;  // {id, name, phone} from autocomplete selection
  var pendingFromDate  = null;  // "YYYY-MM-DD" for editSeriesFuture
  var _editingSeriesId = null;  // null = new series; uuid = editing existing
  var _acDebounce      = null;

  // ---- Helpers -----------------------------------------------

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // BRT day-of-week from a "YYYY-MM-DD" date string. 0=Mon … 6=Sun.
  // Uses same Intl approach as bookings.js brtDayOfWeek(), avoiding Date.getDay() (0=Sun).
  function brtDowFromDate(dateStr) {
    var short = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', weekday: 'short'
    }).format(new Date(dateStr + 'T12:00:00-03:00'))
      .toLowerCase().replace('.', '').trim();
    var map = { 'seg': 0, 'ter': 1, 'qua': 2, 'qui': 3, 'sex': 4, 'sáb': 5, 'dom': 6 };
    return map[short.slice(0, 3)];
  }

  function formatDateBR(dateStr) {
    var p = dateStr.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  // ---- Discount (R$ / % toggle) — mirrors bookings.js ----------

  function discountMode(pillsId) {
    var active = document.querySelector('#' + pillsId + ' .discount-mode-pill--active');
    return active ? active.dataset.mode : 'valor';
  }

  function setDiscountMode(pillsId, mode) {
    document.querySelectorAll('#' + pillsId + ' .discount-mode-pill').forEach(function (p) {
      p.classList.toggle('discount-mode-pill--active', p.dataset.mode === mode);
    });
  }

  function computeDiscountReais(rateEl, discEl, pillsId) {
    var lastApplied = parseFloat(rateEl.dataset.lastDiscount || '0') || 0;
    var baseRate    = (parseFloat(rateEl.value) || 0) + lastApplied;
    var raw         = parseFloat(discEl.value) || 0;
    var reais       = discountMode(pillsId) === 'percentual' ? (baseRate * raw / 100) : raw;
    return Math.max(0, Math.min(reais, baseRate));
  }

  function applySrDiscount() {
    var rateEl = document.getElementById('sr-rate');
    var discEl = document.getElementById('sr-discount');
    if (!rateEl || !discEl) return;
    var lastApplied  = parseFloat(rateEl.dataset.lastDiscount || '0') || 0;
    var baseRate     = (parseFloat(rateEl.value) || 0) + lastApplied;
    var discountReais = computeDiscountReais(rateEl, discEl, 'sr-discount-mode');
    rateEl.value = (baseRate - discountReais).toFixed(2);
    rateEl.dataset.lastDiscount = discountReais.toFixed(2);
    discEl.value = discountReais.toFixed(2);
    setDiscountMode('sr-discount-mode', 'valor');
  }

  // ---- Core: generate + conflict check ----------------------

  // Returns [{starts_at, ends_at, date_str}, …] for all matching days in the rule window.
  // When fromDate is given (editing a series forward), never generate before today —
  // past/completed occurrences must not be regenerated.
  function generateOccurrences(rule, fromDate) {
    var startStr = fromDate || rule.starts_on;
    if (fromDate) {
      var todayStr = window.UI.localDateStr(new Date());
      if (startStr < todayStr) startStr = todayStr;
    }
    var current   = new Date(startStr + 'T12:00:00-03:00');
    var limitDate = rule.ends_on
      ? new Date(rule.ends_on + 'T12:00:00-03:00')
      : new Date(current.getTime() + 366 * 86400000);

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
          date_str:  dateStr,
        });
      }
      current = new Date(current.getTime() + 86400000);
    }

    return occurrences;
  }

  // Runs window.checkOverlap for every occurrence in parallel.
  // excludeSeriesId: when editing, skip this series' own (soon-to-be-replaced) rows.
  // Returns Promise<{free: [...], conflicts: [...]}>
  function checkAllConflicts(roomId, occurrences, excludeSeriesId) {
    if (occurrences.length === 0) return Promise.resolve({ free: [], conflicts: [] });
    var checks = occurrences.map(function (o) {
      return window.checkOverlap(roomId, o.starts_at, o.ends_at, null, excludeSeriesId || null);
    });
    return Promise.all(checks).then(function (results) {
      var free = [], conflicts = [];
      results.forEach(function (r, i) {
        (r.hasConflict ? conflicts : free).push(occurrences[i]);
      });
      return { free: free, conflicts: conflicts };
    });
  }

  // Builds the jsonb `p_series` / `p_rule` payload the atomic RPCs expect.
  // includeStartsOn: true for creation (NOT NULL on the rule); omitted on reschedule
  // because the series' first-occurrence date is never moved by an edit.
  function buildSeriesPayload(data, includeStartsOn) {
    var p = {
      room_id:      data.rule.room_id,
      client_id:    data.rule.client_id,
      client_name:  data.rule.client_name,
      client_phone: data.client ? data.client.phone : null,
      days_of_week: data.rule.days_of_week,
      start_time:   data.rule.start_time,
      end_time:     data.rule.end_time,
      rate_applied: data.rule.rate_applied,
      discount_amount: data.rule.discount_amount,
      notes:        data.rule.notes,
      ends_on:      data.rule.ends_on,
    };
    if (includeStartsOn) p.starts_on = data.rule.starts_on;
    return p;
  }

  // ---- Conflict preview UI -----------------------------------

  function resetConflictPreview() {
    pendingFree = [];
    var el = document.getElementById('sr-conflict-preview');
    if (el) { el.hidden = true; el.innerHTML = ''; }
    var btn = document.getElementById('sr-create-btn');
    if (btn) { btn.hidden = true; }
  }

  function showConflictPreview(free, conflicts, total) {
    var el = document.getElementById('sr-conflict-preview');
    if (!el) return;
    el.hidden = false;

    var html = '';
    if (conflicts.length === 0) {
      html = '<p class="sr-preview-ok">✓ Nenhum conflito. ' + total + ' ocorrência' +
        (total === 1 ? '' : 's') + ' serão criadas.</p>';
    } else {
      var dates = conflicts.slice(0, 5).map(function (c) { return formatDateBR(c.date_str); }).join(', ');
      var more  = conflicts.length > 5 ? ' e mais ' + (conflicts.length - 5) : '';
      html += '<p class="sr-preview-warn">⚠ ' + conflicts.length + ' data' +
        (conflicts.length === 1 ? '' : 's') + ' com conflito: ' + dates + more + '. Serão ignoradas.</p>';
      if (free.length > 0) {
        html += '<p class="sr-preview-info">' + free.length + ' ocorrência' +
          (free.length === 1 ? '' : 's') + ' sem conflito serão criadas.</p>';
      } else {
        html += '<p class="sr-preview-warn">Todas as datas conflitam — nenhuma ocorrência será criada.</p>';
      }
    }
    el.innerHTML = html;

    var createBtn = document.getElementById('sr-create-btn');
    if (createBtn) {
      createBtn.hidden   = free.length === 0;
      createBtn.textContent = _editingSeriesId
        ? 'Salvar e recriar recorrências'
        : 'Criar recorrência';
    }
  }

  // ---- Read + validate form ---------------------------------

  function readForm() {
    var roomId    = (document.getElementById('sr-room')       || {}).value || '';
    var clientEl  =  document.getElementById('sr-client');
    var clientId  = (document.getElementById('sr-client-id')  || {}).value || '';
    var startTime = (document.getElementById('sr-start-time') || {}).value || '';
    var endTime   = (document.getElementById('sr-end-time')   || {}).value || '';
    var rate      = parseFloat((document.getElementById('sr-rate')  || {}).value);
    var rateEl    = document.getElementById('sr-rate');
    var discEl    = document.getElementById('sr-discount');
    var discount  = (rateEl && discEl) ? computeDiscountReais(rateEl, discEl, 'sr-discount-mode') : 0;
    var notes     = ((document.getElementById('sr-notes') || {}).value || '').trim();
    var startsOn  = (document.getElementById('sr-starts-on')  || {}).value || '';
    var endsOn    = (document.getElementById('sr-ends-on')    || {}).value || '';

    var daysOfWeek = [];
    for (var d = 0; d < 7; d++) {
      var cb = document.getElementById('sr-dow-' + d);
      if (cb && cb.checked) daysOfWeek.push(d);
    }

    var clientName = clientEl ? clientEl.value.trim() : '';
    var client     = pendingClient || (clientId ? { id: clientId, name: clientName, phone: null } : null);

    return {
      roomId: roomId,
      client: client,
      rule: {
        room_id:      roomId,
        client_id:    clientId || null,
        client_name:  clientName,
        client_phone: client ? (client.phone || null) : null,
        days_of_week: daysOfWeek,
        start_time:   startTime,
        end_time:     endTime,
        rate_applied: isNaN(rate) ? null : rate,
        discount_amount: isNaN(discount) ? 0 : discount,
        notes:        notes || null,
        starts_on:    startsOn,
        ends_on:      endsOn || null,
      },
    };
  }

  function validate(data) {
    if (!data.roomId)                         return 'Selecione uma sala.';
    if (!data.client || !data.client.id)      return 'Selecione um cliente da lista.';
    if (data.rule.days_of_week.length === 0)  return 'Selecione ao menos um dia da semana.';
    if (!data.rule.start_time)                return 'Informe o horário de início.';
    if (!data.rule.end_time)                  return 'Informe o horário de término.';
    if (data.rule.start_time >= data.rule.end_time) return 'O término deve ser após o início.';
    if (!data.rule.starts_on)                 return 'Informe a data da primeira ocorrência.';
    return null;
  }

  function setSeriesError(msg) {
    var el = document.getElementById('series-error');
    if (!el) return;
    if (msg) { el.textContent = msg; el.hidden = false; }
    else     { el.hidden = true; el.textContent = ''; }
  }

  // ---- Client autocomplete ----------------------------------

  function wireAutocomplete() {
    var input = document.getElementById('sr-client');
    if (!input) return;

    input.addEventListener('input', function () {
      pendingClient = null;
      var idEl = document.getElementById('sr-client-id');
      if (idEl) idEl.value = '';
      clearTimeout(_acDebounce);
      var box  = document.getElementById('sr-client-suggestions');
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
                var idEl2 = document.getElementById('sr-client-id');
                if (idEl2) idEl2.value = c.id;
                pendingClient = { id: c.id, name: c.name, phone: c.phone };
                box.hidden = true;
              });
              box.appendChild(item);
            });
            box.hidden = false;
          });
      }, 200);
    });

    input.addEventListener('blur', function () {
      setTimeout(function () {
        var box2 = document.getElementById('sr-client-suggestions');
        if (box2) box2.hidden = true;
      }, 150);
    });
  }

  // ---- Room select population --------------------------------

  function populateRooms(selectedId) {
    var sel = document.getElementById('sr-room');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Selecione —</option>';
    window.sb.from('rooms').select('id,name').eq('active', true).order('name')
      .then(function (res) {
        (res.data || []).forEach(function (r) {
          var opt = document.createElement('option');
          opt.value = r.id; opt.textContent = r.name;
          if (r.id === selectedId) opt.selected = true;
          sel.appendChild(opt);
        });
      });
  }

  // ---- Open series modal (new) --------------------------------

  function openSeriesModal() {
    _editingSeriesId = null;
    pendingFree      = [];
    pendingClient    = null;
    pendingFromDate  = null;

    var form = document.getElementById('series-form');
    if (form) form.reset();
    resetConflictPreview();
    setSeriesError('');

    var titleEl = document.getElementById('series-modal-title');
    if (titleEl) titleEl.textContent = 'Nova Recorrência';

    var rateEl = document.getElementById('sr-rate');
    if (rateEl) rateEl.dataset.lastDiscount = '0';
    setDiscountMode('sr-discount-mode', 'valor');

    populateRooms(null);
    window.UI.openModal('series-modal');
  }

  // ---- Open series modal (edit from a date forward) ----------

  function openSeriesModalForEdit(seriesId, fromDateStr) {
    _editingSeriesId = seriesId;
    pendingFree      = [];
    pendingClient    = null;
    pendingFromDate  = fromDateStr;

    var form = document.getElementById('series-form');
    if (form) form.reset();
    resetConflictPreview();
    setSeriesError('');

    var titleEl = document.getElementById('series-modal-title');
    if (titleEl) titleEl.textContent = 'Editar Recorrência (desta data em diante)';

    window.sb.from('booking_series').select('*').eq('id', seriesId).single()
      .then(function (res) {
        if (res.error || !res.data) {
          window.UI.toast('Erro ao carregar dados da recorrência.', 'erro');
          return;
        }
        var s = res.data;

        var clientInput = document.getElementById('sr-client');
        var clientIdEl  = document.getElementById('sr-client-id');
        if (clientInput) clientInput.value = s.client_name || '';
        if (clientIdEl)  clientIdEl.value  = s.client_id  || '';
        pendingClient = { id: s.client_id, name: s.client_name, phone: s.client_phone };

        populateRooms(s.room_id);

        for (var d = 0; d < 7; d++) {
          var cb = document.getElementById('sr-dow-' + d);
          if (cb) cb.checked = (s.days_of_week || []).indexOf(d) !== -1;
        }

        var startEl = document.getElementById('sr-start-time');
        var endEl   = document.getElementById('sr-end-time');
        if (startEl) startEl.value = (s.start_time || '').slice(0, 5);
        if (endEl)   endEl.value   = (s.end_time   || '').slice(0, 5);

        var rateEl  = document.getElementById('sr-rate');
        var notesEl = document.getElementById('sr-notes');
        if (rateEl)  rateEl.value  = s.rate_applied != null ? s.rate_applied : '';
        if (notesEl) notesEl.value = s.notes || '';
        var discEl = document.getElementById('sr-discount');
        var discountAmount = s.discount_amount || 0;
        if (discEl) discEl.value = discountAmount ? discountAmount : '';
        if (rateEl) rateEl.dataset.lastDiscount = discountAmount || '0';
        setDiscountMode('sr-discount-mode', 'valor');

        // Lock starts_on to the selected occurrence's date
        var startsOnEl = document.getElementById('sr-starts-on');
        var endsOnEl   = document.getElementById('sr-ends-on');
        if (startsOnEl) startsOnEl.value = fromDateStr;
        if (endsOnEl)   endsOnEl.value   = s.ends_on || '';

        window.UI.openModal('series-modal');
      });
  }

  // ---- Verify conflicts step ---------------------------------

  function onCheckConflicts() {
    var data = readForm();
    var err  = validate(data);
    if (err) { setSeriesError(err); return; }
    setSeriesError('');
    resetConflictPreview();

    var checkBtn = document.getElementById('sr-check-btn');
    if (checkBtn) { checkBtn.disabled = true; checkBtn.textContent = 'Verificando…'; }

    var occurrences = generateOccurrences(data.rule, _editingSeriesId ? pendingFromDate : null);

    if (occurrences.length === 0) {
      var el = document.getElementById('sr-conflict-preview');
      if (el) {
        el.innerHTML = '<p class="sr-preview-warn">Nenhuma ocorrência encontrada para o período e dias selecionados.</p>';
        el.hidden = false;
      }
      if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = 'Verificar conflitos'; }
      return;
    }

    checkAllConflicts(data.roomId, occurrences, _editingSeriesId).then(function (result) {
      pendingFree = result.free;
      showConflictPreview(result.free, result.conflicts, occurrences.length);
      if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = 'Verificar conflitos'; }
    }).catch(function () {
      window.UI.toast('Erro ao verificar conflitos. Tente novamente.', 'erro');
      if (checkBtn) { checkBtn.disabled = false; checkBtn.textContent = 'Verificar conflitos'; }
    });
  }

  // ---- Create / save -----------------------------------------

  function onCreateSeries() {
    if (pendingFree.length === 0) return;
    var data    = readForm();
    var saveBtn = document.getElementById('sr-create-btn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Salvando…'; }

    if (_editingSeriesId) {
      doEditSeriesFuture(data, saveBtn);
    } else {
      doCreateNew(data, saveBtn);
    }
  }

  function doCreateNew(data, saveBtn) {
    // One atomic RPC: inserts the rule + every occurrence in a single transaction.
    // If any occurrence hits the overlap constraint, the whole thing rolls back —
    // no orphaned series row, no partial insert.
    window.sb.rpc('create_booking_series', {
      p_series:      buildSeriesPayload(data, true),
      p_occurrences: pendingFree,
    }).then(function (res) {
      if (res.error) {
        window.UI.toast('Não foi possível criar a recorrência — algum horário ficou indisponível. Verifique os conflitos novamente.', 'erro');
        if (saveBtn) { saveBtn.disabled = false; }
        resetConflictPreview();
        return;
      }
      var n = pendingFree.length;
      window.UI.toast(n + ' reserva' + (n === 1 ? '' : 's') + ' recorrente' + (n === 1 ? '' : 's') + ' criada' + (n === 1 ? '' : 's') + '.', 'ok');
      window.UI.closeAllModals();
      if (window.Calendar) window.Calendar.refresh();
    });
  }

  function doEditSeriesFuture(data, saveBtn) {
    // One atomic RPC: deletes only FUTURE occurrences (>= max(fromDate, today)),
    // updates the rule, and reinserts — all in a single transaction. A failed
    // reinsert rolls back the delete, so future occurrences are never lost.
    window.sb.rpc('reschedule_series_future', {
      p_series_id:   _editingSeriesId,
      p_from:        pendingFromDate,
      p_rule:        buildSeriesPayload(data, false),
      p_occurrences: pendingFree,
    }).then(function (res) {
      if (res.error) {
        window.UI.toast('Não foi possível atualizar a recorrência — algum horário ficou indisponível. As ocorrências futuras foram preservadas; verifique os conflitos novamente.', 'erro');
        if (saveBtn) { saveBtn.disabled = false; }
        resetConflictPreview();
        return;
      }
      var n = pendingFree.length;
      window.UI.toast(n + ' reserva' + (n === 1 ? '' : 's') + ' atualizada' + (n === 1 ? '' : 's') + '.', 'ok');
      window.UI.closeAllModals();
      if (window.Calendar) window.Calendar.refresh();
    });
  }

  // ---- Cancel series (this + future) ------------------------

  // Soft-cancel via RPC: marks future occurrences 'cancelado' (history preserved),
  // clamped to today so completed occurrences are never touched.
  function cancelSeriesFuture(seriesId, fromDateStr) {
    window.sb.rpc('cancel_series_future', {
      p_series_id: seriesId,
      p_from:      fromDateStr,
    }).then(function (res) {
      if (res.error) { window.UI.toast('Erro ao cancelar ocorrências.', 'erro'); return; }
      var n = res.data;
      window.UI.toast((n != null ? n + ' ' : '') + 'ocorrência' + (n === 1 ? '' : 's') + ' futura' + (n === 1 ? '' : 's') + ' cancelada' + (n === 1 ? '' : 's') + '.', 'ok');
      if (window.Calendar) window.Calendar.refresh();
    });
  }

  // ---- Scope dialog -----------------------------------------

  function openScopeDialog(booking, rooms, origOpenEdit, isDelete) {
    var titleEl = document.getElementById('scope-modal-title');
    var descEl  = document.getElementById('scope-modal-desc');
    if (titleEl) titleEl.textContent = isDelete ? 'Cancelar recorrência' : 'Editar recorrência';
    if (descEl)  descEl.textContent  = isDelete
      ? 'Deseja cancelar apenas esta reserva ou esta e todas as seguintes?'
      : 'Deseja editar apenas esta reserva ou esta e todas as seguintes?';

    // Wire buttons fresh (cloneNode removes stale listeners)
    var oneBtn = document.getElementById('scope-only-this-btn');
    var futBtn = document.getElementById('scope-all-future-btn');

    if (oneBtn) {
      var oneClone = oneBtn.cloneNode(true);
      oneBtn.parentNode.replaceChild(oneClone, oneBtn);
      oneClone.addEventListener('click', function () {
        window.UI.closeAllModals();
        if (isDelete) {
          doDeleteOne(booking);
        } else {
          origOpenEdit(booking, rooms);
        }
      });
    }

    if (futBtn) {
      var futClone = futBtn.cloneNode(true);
      futBtn.parentNode.replaceChild(futClone, futBtn);
      futClone.addEventListener('click', function () {
        window.UI.closeAllModals();
        var fromDateStr = window.UI.localDateStr(new Date(booking.starts_at));
        if (isDelete) {
          cancelSeriesFuture(booking.series_id, fromDateStr);
        } else {
          openSeriesModalForEdit(booking.series_id, fromDateStr);
        }
      });
    }

    window.UI.openModal('series-scope-modal');
  }

  // Single-occurrence cancel: soft-cancel (preserve history), never hard-delete.
  function doDeleteOne(booking) {
    if (!confirm('Cancelar apenas esta reserva de ' + booking.client_name + '?')) return;
    window.sb.from('bookings').update({ status: 'cancelado' }).eq('id', booking.id)
      .then(function (res) {
        if (res.error) { window.UI.toast('Erro ao cancelar reserva.', 'erro'); return; }
        window.UI.closeAllModals();
        window.UI.toast('Reserva cancelada.', 'ok');
        if (window.Calendar) window.Calendar.refresh();
      });
  }

  // ---- Boot --------------------------------------------------

  function boot() {
    // "Nova Recorrência" toolbar button
    var newBtn = document.getElementById('new-series-btn');
    if (newBtn) newBtn.addEventListener('click', openSeriesModal);

    wireAutocomplete();

    // "Verificar conflitos" button
    var checkBtn = document.getElementById('sr-check-btn');
    if (checkBtn) checkBtn.addEventListener('click', onCheckConflicts);

    // "Criar recorrência" / "Salvar e recriar" button
    var createBtn = document.getElementById('sr-create-btn');
    if (createBtn) createBtn.addEventListener('click', onCreateSeries);

    // Discount mode pills (R$ / %)
    document.querySelectorAll('#sr-discount-mode .discount-mode-pill').forEach(function (p) {
      p.addEventListener('click', function () { setDiscountMode('sr-discount-mode', p.dataset.mode); });
    });

    // Discount apply link
    var discApplyBtn = document.getElementById('sr-discount-apply');
    if (discApplyBtn) {
      discApplyBtn.addEventListener('click', function (e) {
        e.preventDefault();
        applySrDiscount();
      });
    }

    // Reset preview when key form fields change (user changed their mind)
    ['sr-room', 'sr-start-time', 'sr-end-time', 'sr-starts-on', 'sr-ends-on'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', resetConflictPreview);
    });
    for (var d = 0; d < 7; d++) {
      var cb = document.getElementById('sr-dow-' + d);
      if (cb) cb.addEventListener('change', resetConflictPreview);
    }

    // Monkey-patch window.Bookings.openEdit to intercept recurring booking clicks
    if (window.Bookings && window.Bookings.openEdit) {
      var _orig = window.Bookings.openEdit;
      window.Bookings.openEdit = function (booking, rooms) {
        if (!booking || !booking.series_id) {
          _orig(booking, rooms);
          return;
        }
        openScopeDialog(booking, rooms, _orig, false);
      };
    }
  }

  document.addEventListener('DOMContentLoaded', boot);

  // ---- Public API -------------------------------------------

  window.Series = {
    openSeriesModal:    openSeriesModal,
    cancelSeriesFuture: cancelSeriesFuture,
    // Called from bookings.js delete button when booking.series_id is set
    handleDeleteScope: function (booking) {
      openScopeDialog(booking, null, null, true);
    },
  };

})();
