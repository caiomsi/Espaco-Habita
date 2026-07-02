(function () {
  'use strict';

  var TZ = 'America/Sao_Paulo';

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatDuration(startsAt, endsAt) {
    var ms       = new Date(endsAt) - new Date(startsAt);
    var totalMin = Math.round(ms / 60000);
    var h        = Math.floor(totalMin / 60);
    var m        = totalMin % 60;
    if (h === 0)  return m + 'min';
    if (m === 0)  return h + 'h';
    return h + 'h' + m;
  }

  function timeAgo(isoStr) {
    var ms   = Date.now() - new Date(isoStr).getTime();
    var days = Math.floor(ms / 86400000);
    if (days === 0) return 'hoje';
    if (days === 1) return 'ontem';
    return 'há ' + days + ' dias';
  }

  // ---- Pricing / discount row (R$ / % toggle, same math as bookings.js) ----

  function suggestedRate(req) {
    var room = req.rooms;
    if (!room || !room.rate_hourly) return '';
    var hours = (new Date(req.ends_at) - new Date(req.starts_at)) / 3600000;
    if (hours <= 0) return '';
    return (hours * parseFloat(room.rate_hourly)).toFixed(2);
  }

  function discountMode(reqId) {
    var active = document.querySelector('#req-discmode-' + reqId + ' .discount-mode-pill--active');
    return active ? active.dataset.mode : 'valor';
  }

  function setDiscountMode(reqId, mode) {
    document.querySelectorAll('#req-discmode-' + reqId + ' .discount-mode-pill').forEach(function (p) {
      p.classList.toggle('discount-mode-pill--active', p.dataset.mode === mode);
    });
  }

  // Returns { baseRate, discountReais, finalRate } computed from the card's inputs.
  function computePricing(reqId) {
    var rateEl = document.getElementById('req-rate-' + reqId);
    var discEl = document.getElementById('req-discount-' + reqId);
    var baseRate = rateEl ? (parseFloat(rateEl.value) || 0) : 0;
    var raw      = discEl ? (parseFloat(discEl.value) || 0) : 0;
    var discountReais = discountMode(reqId) === 'percentual' ? (baseRate * raw / 100) : raw;
    discountReais = Math.max(0, Math.min(discountReais, baseRate));
    return { baseRate: baseRate, discountReais: discountReais, finalRate: baseRate - discountReais };
  }

  function updatePricePreview(reqId) {
    var el = document.getElementById('req-price-final-' + reqId);
    if (!el) return;
    var p = computePricing(reqId);
    if (!p.baseRate) { el.textContent = ''; return; }
    el.textContent = 'Valor final: ' + new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.finalRate);
  }

  // ---- Render list ----------------------------------------

  function renderList(requests) {
    var container = document.getElementById('requests-list');
    if (!container) return;

    if (!requests || requests.length === 0) {
      container.innerHTML = emptyStateHtml('Nenhuma solicitação pendente', 'Quando um profissional solicitar uma sala pela página pública, o pedido aparecerá aqui para aprovação.');
      return;
    }

    container.innerHTML = '';
    requests.forEach(function (req) {
      renderCard(req, container);
    });
  }

  function renderCard(req, container) {
    var roomName = (req.rooms && req.rooms.name) ? req.rooms.name : '—';
    var card = document.createElement('div');
    card.className = 'req-card';
    card.dataset.id = req.id;

    var dateRange = window.UI.formatDate(req.starts_at) + ' · ' +
      window.UI.formatTime(req.starts_at) + '–' +
      window.UI.formatTime(req.ends_at) + ' (' + formatDuration(req.starts_at, req.ends_at) + ')';

    var notesHtml = req.notes
      ? '<p class="req-card-notes">' + escHtml(req.notes) + '</p>'
      : '';

    var suggested = suggestedRate(req);

    var pricingHtml =
      '<div class="req-pricing-row">' +
        '<div class="form-field">' +
          '<label for="req-rate-' + req.id + '">Valor (R$)</label>' +
          '<input type="number" id="req-rate-' + req.id + '" min="0" step="0.01" value="' + suggested + '" placeholder="0,00">' +
        '</div>' +
        '<div class="form-field">' +
          '<label>Desconto</label>' +
          '<div class="discount-row">' +
            '<div class="discount-mode-pills" id="req-discmode-' + req.id + '">' +
              '<button type="button" class="discount-mode-pill discount-mode-pill--active" data-mode="valor">R$</button>' +
              '<button type="button" class="discount-mode-pill" data-mode="percentual">%</button>' +
            '</div>' +
            '<input type="number" id="req-discount-' + req.id + '" min="0" step="0.01" placeholder="0,00">' +
          '</div>' +
        '</div>' +
        '<p class="req-price-final" id="req-price-final-' + req.id + '"></p>' +
      '</div>';

    card.innerHTML =
      '<div class="req-card-header">' +
        '<div>' +
          '<h3 class="req-card-room">' + escHtml(roomName) + '</h3>' +
          '<span class="req-card-badge">Solicitado ' + timeAgo(req.created_at) + '</span>' +
        '</div>' +
        '<div class="req-card-date">' + escHtml(dateRange) + '</div>' +
      '</div>' +
      '<div class="req-card-body">' +
        '<div class="req-card-who">' +
          '<strong>' + escHtml(req.client_name) + '</strong>' +
          (req.requester_specialty ? ' · ' + escHtml(req.requester_specialty) : '') +
        '</div>' +
        '<div class="req-card-contact">' +
          (req.requester_email ? '<a href="mailto:' + escHtml(req.requester_email) + '">' + escHtml(req.requester_email) + '</a>' : '') +
          (req.client_phone ? '<a href="tel:' + escHtml(req.client_phone) + '">' + escHtml(req.client_phone) + '</a>' : '') +
        '</div>' +
        pricingHtml +
        notesHtml +
        '<p id="req-conflict-' + req.id + '" class="req-conflict-msg" hidden></p>' +
      '</div>' +
      '<div class="req-card-actions">' +
        '<button type="button" class="btn btn-primary" data-action="approve" data-id="' + req.id + '">✓ Aprovar</button>' +
        '<button type="button" class="btn btn-ghost req-decline-btn" data-action="decline" data-id="' + req.id + '">✕ Recusar</button>' +
      '</div>';

    container.appendChild(card);

    // Wire buttons
    card.querySelector('[data-action="approve"]').addEventListener('click', function () {
      handleApprove(req, card);
    });
    card.querySelector('[data-action="decline"]').addEventListener('click', function () {
      handleDecline(req, card);
    });

    // Wire pricing row (live preview)
    card.querySelectorAll('#req-discmode-' + req.id + ' .discount-mode-pill').forEach(function (p) {
      p.addEventListener('click', function () {
        setDiscountMode(req.id, p.dataset.mode);
        updatePricePreview(req.id);
      });
    });
    var rateInput = card.querySelector('#req-rate-' + req.id);
    var discInput = card.querySelector('#req-discount-' + req.id);
    if (rateInput) rateInput.addEventListener('input', function () { updatePricePreview(req.id); });
    if (discInput) discInput.addEventListener('input', function () { updatePricePreview(req.id); });
    updatePricePreview(req.id);
  }

  // ---- Actions --------------------------------------------

  function handleApprove(req, card) {
    var approveBtn = card.querySelector('[data-action="approve"]');
    var declineBtn = card.querySelector('[data-action="decline"]');
    var conflictEl = document.getElementById('req-conflict-' + req.id);

    approveBtn.disabled = true;
    approveBtn.textContent = 'Verificando…';

    window.checkOverlap(req.room_id, req.starts_at, req.ends_at).then(function (result) {
      if (result.hasConflict) {
        // Can't approve — show conflict inline
        card.classList.add('req-card--conflict');
        if (conflictEl) {
          conflictEl.textContent = 'Conflito: ' + result.reason + '. Recuse esta solicitação.';
          conflictEl.hidden = false;
        }
        approveBtn.disabled = false;
        approveBtn.textContent = '✓ Aprovar';
        return;
      }

      approveBtn.textContent = 'Aprovando…';
      var pricing = computePricing(req.id);
      window.sb.from('bookings')
        .update({
          status: 'confirmado',
          rate_applied: pricing.baseRate ? pricing.finalRate : null,
          discount_amount: pricing.discountReais
        })
        .eq('id', req.id)
        .then(function (res) {
          if (res.error) {
            var msg = res.error.message || '';
            if (msg.indexOf('no_overlapping') !== -1 || msg.indexOf('exclusion') !== -1) {
              card.classList.add('req-card--conflict');
              if (conflictEl) {
                conflictEl.textContent = 'Conflito detectado pelo banco — o horário ficou reservado agora. Recuse esta solicitação.';
                conflictEl.hidden = false;
              }
            } else {
              window.UI.toast('Erro ao aprovar: ' + msg, 'erro');
            }
            approveBtn.disabled = false;
            approveBtn.textContent = '✓ Aprovar';
            return;
          }
          window.UI.toast('Reserva de ' + req.client_name + ' confirmada.', 'ok');
          if (window.Email) window.Email.send('confirmado', req.id);
          card.classList.add('req-card--done');
          setTimeout(function () { card.remove(); checkEmpty(); }, 500);
          updateBadge();
        });
    }).catch(function () {
      window.UI.toast('Erro de conexão. Tente novamente.', 'erro');
      approveBtn.disabled = false;
      approveBtn.textContent = '✓ Aprovar';
    });
  }

  function handleDecline(req, card) {
    var declineBtn = card.querySelector('[data-action="decline"]');

    // First tap: ask for confirmation
    if (!declineBtn.dataset.confirming) {
      declineBtn.dataset.confirming = '1';
      declineBtn.textContent = 'Confirmar recusa?';
      declineBtn.classList.add('req-decline-btn--warn');
      var timer = setTimeout(function () {
        if (declineBtn.dataset.confirming) {
          delete declineBtn.dataset.confirming;
          declineBtn.textContent = '✕ Recusar';
          declineBtn.classList.remove('req-decline-btn--warn');
        }
      }, 3000);
      declineBtn.dataset.timer = timer;
      return;
    }

    // Second tap: proceed
    clearTimeout(Number(declineBtn.dataset.timer));
    delete declineBtn.dataset.confirming;
    declineBtn.disabled = true;
    declineBtn.textContent = 'Recusando…';
    declineBtn.classList.remove('req-decline-btn--warn');

    window.sb.from('bookings')
      .update({ status: 'recusado' })
      .eq('id', req.id)
      .then(function (res) {
        if (res.error) {
          window.UI.toast('Erro ao recusar.', 'erro');
          declineBtn.disabled = false;
          declineBtn.textContent = '✕ Recusar';
          return;
        }
        window.UI.toast('Solicitação de ' + req.client_name + ' recusada.', 'ok');
        if (window.Email) window.Email.send('recusado', req.id);
        card.classList.add('req-card--done');
        setTimeout(function () { card.remove(); checkEmpty(); }, 500);
        updateBadge();
      });
  }

  function emptyStateHtml(title, msg) {
    return '<div class="requests-empty">' +
      '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' +
      '<p class="requests-empty-title">' + title + '</p>' +
      '<p class="requests-empty-msg">' + msg + '</p>' +
    '</div>';
  }

  function checkEmpty() {
    var container = document.getElementById('requests-list');
    if (!container) return;
    if (container.querySelectorAll('.req-card').length === 0) {
      container.innerHTML = emptyStateHtml('Tudo em dia!', 'Todas as solicitações foram processadas.');
    }
  }

  function updateBadge() {
    if (window.UI && window.UI.loadRequestBadge) window.UI.loadRequestBadge();
  }

  // ---- Load -----------------------------------------------

  function load() {
    var container = document.getElementById('requests-list');
    if (container) container.innerHTML = '<div class="loading-state">Carregando…</div>';

    window.sb.from('bookings')
      .select('*, rooms(name, rate_hourly, rate_daily, rate_weekly)')
      .eq('status', 'solicitado')
      .order('created_at', { ascending: true })
      .then(function (res) {
        if (res.error) {
          if (container) container.innerHTML = '<p class="error-state">Erro ao carregar solicitações.</p>';
          return;
        }
        renderList(res.data || []);
      });
  }

  // ---- Boot -----------------------------------------------

  function boot() {
    load();
  }

  if (window.authReady) { boot(); return; }
  document.addEventListener('auth:ready', boot, { once: true });

  setTimeout(function () {
    if (!window.authReady) {
      var container = document.getElementById('requests-list');
      if (container && container.querySelector('.loading-state')) {
        container.innerHTML = '<p class="error-state">Não foi possível conectar. <a href="login.html">Fazer login novamente</a>.</p>';
      }
    }
  }, 10000);

})();
