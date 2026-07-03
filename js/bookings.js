(function () {
  'use strict';

  var currentBooking   = null; // null = new booking; object = editing existing
  var pendingForce     = false;
  var pendingPackageId = null; // set when the admin picked "pay with package" for a NEW booking
  var acDebounce       = null; // autocomplete debounce timer

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
    refreshPackageField();
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

  function clearRatePresets() {
    var el = document.getElementById('bk-rate-presets');
    if (el) el.innerHTML = '';
  }

  // Renders Público/Profissional preset chips for rooms with a pricing_group,
  // sourced from the rate-card tables (js/pricing.js) instead of the flat
  // hours × rate_hourly formula. Clicking a chip fills the rate field.
  function renderRatePresets(room, hours) {
    var container = document.getElementById('bk-rate-presets');
    if (!container || !window.Pricing) return;
    container.innerHTML = '<span class="loading-inline">Calculando…</span>';

    var promise;
    if (room.pricing_group === 'salao') {
      promise = window.Pricing.getSalaoTiers().then(function (tiers) {
        var tier = tiers.find(function (t) { return parseFloat(t.duration_hours) === hours; });
        if (!tier && tiers.length) {
          var base = tiers.find(function (t) { return parseFloat(t.duration_hours) === 1; }) || tiers[0];
          tier = {
            price_public:       parseFloat(base.price_public) * hours,
            price_professional: parseFloat(base.price_professional) * hours
          };
        }
        return tier;
      });
    } else {
      promise = window.Pricing.getAvulsaRate(room.pricing_group).then(function (avulsa) {
        if (!avulsa) return null;
        return {
          price_public:       parseFloat(avulsa.price_public) * hours,
          price_professional: parseFloat(avulsa.price_professional) * hours
        };
      });
    }

    promise.then(function (tier) {
      if (!tier) { container.innerHTML = ''; return; }
      container.innerHTML =
        '<span class="rate-preset-label">Recomendado:</span>' +
        '<button type="button" class="rate-preset-chip rate-preset-chip--active" data-value="' + tier.price_public + '">Público: ' +
          window.UI.formatCurrency(tier.price_public) + '</button>' +
        '<button type="button" class="rate-preset-chip" data-value="' + tier.price_professional + '">Profissional: ' +
          window.UI.formatCurrency(tier.price_professional) + '</button>';

      // Pre-fill the recommended (public) price by default so a suggestion is
      // visible immediately, not just after clicking a chip. Also overwrite
      // if the current value is itself just a leftover auto-suggestion (e.g.
      // from before the admin switched rooms) — only a value the admin typed
      // or picked themselves is left untouched. See dataset.autoSuggested.
      var rateEl0 = document.getElementById('bk-rate-applied');
      if (rateEl0 && (!rateEl0.value || rateEl0.dataset.autoSuggested === '1')) {
        rateEl0.value = parseFloat(tier.price_public).toFixed(2);
        rateEl0.dataset.lastDiscount = '0';
        rateEl0.dataset.autoSuggested = '1';
      }

      container.querySelectorAll('.rate-preset-chip').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var rateEl = document.getElementById('bk-rate-applied');
          rateEl.value = parseFloat(btn.dataset.value).toFixed(2);
          rateEl.dataset.lastDiscount = '0';
          rateEl.dataset.autoSuggested = ''; // deliberate pick — don't silently replace later
          container.querySelectorAll('.rate-preset-chip').forEach(function (b) {
            b.classList.toggle('rate-preset-chip--active', b === btn);
          });
        });
      });
    });
  }

  function suggestRate() {
    var roomId   = document.getElementById('bk-room').value;
    var startVal = document.getElementById('bk-start').value;
    var endVal   = document.getElementById('bk-end').value;
    var rateEl   = document.getElementById('bk-rate-applied');
    if (!roomId || !startVal || !endVal || !rateEl) return;

    var room = _rooms.find(function (r) { return r.id === roomId; });
    if (!room) return;

    var start    = new Date(window.UI.datetimeLocalToISO(startVal));
    var end      = new Date(window.UI.datetimeLocalToISO(endVal));
    var hours    = (end - start) / 3600000;
    if (hours <= 0) return;

    if (room.pricing_group) {
      renderRatePresets(room, hours);
      return;
    }

    clearRatePresets();
    if (!room.rate_hourly) return;
    rateEl.value = (hours * parseFloat(room.rate_hourly)).toFixed(2);
    rateEl.dataset.lastDiscount = '0';
    rateEl.dataset.autoSuggested = '1';
  }

  // Auto-triggered whenever room/start/end change, so a price recommendation
  // appears immediately instead of requiring a manual "Sugerir" click. Safe to
  // call freely — never overwrites a rate the admin actually typed or picked
  // (dataset.autoSuggested distinguishes that from a stale auto-fill left over
  // from a previous room/duration selection, which IS safe to refresh).
  function autoSuggestRate() {
    var roomId = (document.getElementById('bk-room') || {}).value;
    if (!roomId) return;
    var room = _rooms.find(function (r) { return r.id === roomId; });
    if (!room) return;
    var rateEl = document.getElementById('bk-rate-applied');
    if (!room.pricing_group && rateEl && rateEl.value && rateEl.dataset.autoSuggested !== '1') return;
    suggestRate();
  }

  // ---- "Pay with package" selector -------------------------

  function refreshPackageField() {
    var fieldEl  = document.getElementById('bk-package-field');
    var selectEl = document.getElementById('bk-package');
    if (!fieldEl || !selectEl) return;
    fieldEl.hidden = true;
    selectEl.innerHTML = '<option value="">— Não usar pacote —</option>';

    if (currentBooking || !window.Pricing) return; // only offered for new bookings (v1 scope)
    var roomId   = document.getElementById('bk-room').value;
    var clientId = document.getElementById('bk-client-id').value;
    if (!roomId || !clientId) return;

    var room = _rooms.find(function (r) { return r.id === roomId; });
    if (!room || ['grande', 'pequena', 'sala1'].indexOf(room.pricing_group) === -1) return;

    window.Pricing.getActivePackagesForClient(clientId, room.pricing_group).then(function (pkgs) {
      if (!pkgs || pkgs.length === 0) return;
      pkgs.forEach(function (p) {
        var opt = document.createElement('option');
        opt.value = p.id;
        var expDate = p.expires_at.slice(0, 10).split('-').reverse().join('/');
        opt.textContent = p.hours_remaining + 'h restantes (expira ' + expDate + ')';
        selectEl.appendChild(opt);
      });
      fieldEl.hidden = false;
    });
  }

  // ---- Discount (R$ / % toggle) ---------------------------

  function discountMode(pillsId) {
    var active = document.querySelector('#' + pillsId + ' .discount-mode-pill--active');
    return active ? active.dataset.mode : 'valor';
  }

  function setDiscountMode(pillsId, mode) {
    document.querySelectorAll('#' + pillsId + ' .discount-mode-pill').forEach(function (p) {
      p.classList.toggle('discount-mode-pill--active', p.dataset.mode === mode);
    });
  }

  // Computes the reais value of the discount from the current mode + input,
  // using rateEl's value plus any discount already folded into it (dataset.lastDiscount)
  // as the pre-discount base — so re-computing never compounds.
  function computeDiscountReais(rateEl, discEl, pillsId) {
    var lastApplied = parseFloat(rateEl.dataset.lastDiscount || '0') || 0;
    var baseRate    = (parseFloat(rateEl.value) || 0) + lastApplied;
    var raw         = parseFloat(discEl.value) || 0;
    var reais       = discountMode(pillsId) === 'percentual' ? (baseRate * raw / 100) : raw;
    return Math.max(0, Math.min(reais, baseRate));
  }

  // Returns { baseRate, discountReais, finalRate } from the form's current
  // rate + discount inputs — the source of truth for what to persist, so the
  // stored rate_applied is always net of discount even if the admin never
  // clicked "Aplicar" (Financeiro sums rate_applied directly as revenue).
  function computeFinalPricing(rateEl, discEl, pillsId) {
    var lastApplied = parseFloat(rateEl.dataset.lastDiscount || '0') || 0;
    var baseRate     = (parseFloat(rateEl.value) || 0) + lastApplied;
    var discountReais = computeDiscountReais(rateEl, discEl, pillsId);
    return { baseRate: baseRate, discountReais: discountReais, finalRate: baseRate - discountReais };
  }

  function applyBkDiscount() {
    var rateEl = document.getElementById('bk-rate-applied');
    var discEl = document.getElementById('bk-discount');
    if (!rateEl || !discEl) return;
    var p = computeFinalPricing(rateEl, discEl, 'bk-discount-mode');
    rateEl.value = p.finalRate.toFixed(2);
    rateEl.dataset.lastDiscount = p.discountReais.toFixed(2);
    discEl.value = p.discountReais.toFixed(2);
    setDiscountMode('bk-discount-mode', 'valor');
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
    var discEl = document.getElementById('bk-discount');
    var discountAmount = booking.discount_amount || 0;
    if (discEl) discEl.value = discountAmount ? discountAmount : '';
    if (rateEl) {
      rateEl.dataset.lastDiscount = discountAmount || '0';
      rateEl.dataset.autoSuggested = ''; // this is the booking's real saved rate, not a suggestion
    }
    setDiscountMode('bk-discount-mode', 'valor');

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
    var rateEl = document.getElementById('bk-rate-applied');
    if (rateEl) {
      rateEl.dataset.lastDiscount = '0';
      rateEl.dataset.autoSuggested = '';
    }
    setDiscountMode('bk-discount-mode', 'valor');
    clearRatePresets();
    pendingPackageId = null;
    var pkgField = document.getElementById('bk-package-field');
    if (pkgField) pkgField.hidden = true;
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

    window.checkOverlap(roomId, startsAt, endsAt, excludeId).then(function (result) {
      window.UI.setLoading(saveBtn, false);

      if (result.hasConflict && result.isHardBlock) {
        setError('Sala bloqueada: ' + result.reason + '. Remova o bloqueio antes de criar a reserva.');
        return;
      }
      if (result.hasConflict && !result.isHardBlock) {
        setWarning(
          'Atenção: ' + result.reason + '.' +
          ' Clique em "Salvar mesmo assim" para confirmar.'
        );
        pendingForce = true;
        saveBtn.textContent = 'Salvar mesmo assim';
        return;
      }

      // No hard conflict — check client_plans (soft)
      checkPlanConflict(roomId, startsAt, endsAt, payload);
    }).catch(function (err) {
      window.UI.setLoading(saveBtn, false);
      setError('Erro ao verificar conflitos. Tente novamente.');
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

    var promise;
    if (pendingPackageId && !currentBooking) {
      promise = window.sb.rpc('book_with_revenue_source', {
        p_booking: {
          room_id:      payload.room_id,
          client_id:    payload.client_id,
          client_name:  payload.client_name,
          client_phone: payload.client_phone,
          starts_at:    payload.starts_at,
          ends_at:      payload.ends_at,
          status:       payload.status,
          notes:        payload.notes
        },
        p_package_id: pendingPackageId
      });
    } else {
      promise = currentBooking
        ? window.sb.from('bookings').update(payload).eq('id', currentBooking.id)
        : window.sb.from('bookings').insert(payload);
    }

    promise.then(function (res) {
      window.UI.setLoading(saveBtn, false);
      if (res.error) {
        // Surface DB-level exclusion constraint violation clearly
        var msg = res.error.message || '';
        if (msg.indexOf('no_overlapping') !== -1 || msg.indexOf('exclusion constraint') !== -1) {
          setError('Conflito de horário detectado pelo banco de dados. A reserva não foi salva.');
        } else if (msg.indexOf('Saldo insuficiente') !== -1) {
          setError('Saldo insuficiente ou pacote expirado. Atualize a página e tente novamente.');
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

    // Typing in the rate field by hand is a deliberate choice — stop treating
    // it as a replaceable auto-suggestion (see dataset.autoSuggested above).
    var rateAppliedEl = document.getElementById('bk-rate-applied');
    if (rateAppliedEl) {
      rateAppliedEl.addEventListener('input', function () {
        rateAppliedEl.dataset.autoSuggested = '';
      });
    }

    // Discount mode pills (R$ / %)
    document.querySelectorAll('#bk-discount-mode .discount-mode-pill').forEach(function (p) {
      p.addEventListener('click', function () { setDiscountMode('bk-discount-mode', p.dataset.mode); });
    });

    // Discount apply link
    var discApplyBtn = document.getElementById('bk-discount-apply');
    if (discApplyBtn) {
      discApplyBtn.addEventListener('click', function (e) {
        e.preventDefault();
        applyBkDiscount();
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
      var discEl     = document.getElementById('bk-discount');
      // Always compute the net-of-discount rate here rather than reading the
      // field raw — otherwise a discount typed without clicking "Aplicar"
      // first would save the pre-discount rate as rate_applied (Financeiro
      // treats rate_applied as final revenue, so this must always be net).
      var pricing        = (rateEl && discEl) ? computeFinalPricing(rateEl, discEl, 'bk-discount-mode') : null;
      var rateApplied     = (rateEl && rateEl.value) ? (pricing ? pricing.finalRate : parseFloat(rateEl.value)) : null;
      var discountAmount = pricing ? pricing.discountReais : 0;

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

      var pkgSelect = document.getElementById('bk-package');
      pendingPackageId = (pkgSelect && !currentBooking && pkgSelect.value) ? pkgSelect.value : null;

      var payload = {
        room_id:      roomId,
        client_name:  clientName,
        client_phone: phone || null,
        client_id:    clientId,
        starts_at:    startsAt,
        ends_at:      endsAt,
        status:       status,
        notes:        notes || null,
        rate_applied: isNaN(rateApplied) ? null : rateApplied,
        discount_amount: isNaN(discountAmount) ? 0 : discountAmount
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
        if (currentBooking.series_id && window.Series) {
          window.UI.closeAllModals();
          window.Series.handleDeleteScope(currentBooking);
          return;
        }
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

    // Room change: refresh rate presets + package selector for the new room
    var roomSelect = document.getElementById('bk-room');
    if (roomSelect) {
      roomSelect.addEventListener('change', function () {
        clearRatePresets();
        refreshPackageField();
        autoSuggestRate();
      });
    }

    // Date/time changes (dispatched by bk-picker.js when start/end actually
    // change, including on initial modal open) → refresh the recommendation.
    ['bk-start', 'bk-end'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', autoSuggestRate);
    });
  });

  // ---- Public API ----------------------------------------

  window.Bookings = {
    openNew:  openNew,
    openEdit: openEdit
  };

})();
