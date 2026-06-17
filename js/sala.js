(function () {
  'use strict';

  var TZ = 'America/Sao_Paulo';

  var RATE_PRESETS = {
    'hora':   { ms: 1 * 3600000,  label: 'Hora' },
    'dia':    { ms: 9 * 3600000,  label: 'Dia' },
    'semana': { ms: 7 * 86400000, label: 'Semana' }
  };

  var state = {
    room:         null,
    activeRate:   'hora',
    bookings:     [],
    blocks:       []
  };

  // ---- Helpers --------------------------------------------

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  // "YYYY-MM-DD" for a Date in BRT
  function brtDateStr(d) { return window.UI.localDateStr(d); }

  // Does any item in arr overlap [dayStart, dayEnd)?
  function dayHasOverlap(arr, dayStart, dayEnd) {
    return arr.some(function (item) {
      return new Date(item.starts_at) < dayEnd && new Date(item.ends_at) > dayStart;
    });
  }

  // Compute price from rate type + duration
  function computePrice(rateKey, ms) {
    var room = state.room;
    if (!room) return null;
    if (rateKey === 'semana' && room.rate_weekly) return parseFloat(room.rate_weekly);
    if (rateKey === 'dia'    && room.rate_daily)  return parseFloat(room.rate_daily);
    if (room.rate_hourly) return (ms / 3600000) * parseFloat(room.rate_hourly);
    return null;
  }

  // ---- Room hero rendering --------------------------------

  function renderHero(room) {
    var heroPhoto = document.getElementById('sala-hero-photo');
    var heroName  = document.getElementById('sala-hero-name');
    var heroDesc  = document.getElementById('sala-hero-desc');
    var heroMeta  = document.getElementById('sala-hero-meta');
    var pageTitle = document.querySelector('title');

    if (pageTitle) pageTitle.textContent = room.name + ' — Espaço Habita';

    if (heroPhoto) {
      if (room.photo_url) {
        heroPhoto.innerHTML = '<img src="' + escHtml(room.photo_url) + '" alt="' + escHtml(room.name) + '">';
      } else {
        heroPhoto.innerHTML = '<div class="sala-hero-photo-placeholder"><svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>';
      }
    }
    if (heroName) heroName.textContent = room.name;
    if (heroDesc) {
      heroDesc.textContent = room.description || '';
      heroDesc.hidden = !room.description;
    }

    if (heroMeta) {
      var parts = [];
      if (room.capacity) parts.push('<span class="pub-capacity-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>&nbsp;' + room.capacity + ' pessoas</span>');
      if (room.rate_hourly) parts.push('<span class="pub-rate-chip">' + window.UI.formatCurrency(room.rate_hourly) + '/h</span>');
      if (room.rate_daily)  parts.push('<span class="pub-rate-chip">' + window.UI.formatCurrency(room.rate_daily)  + '/dia</span>');
      if (room.rate_weekly) parts.push('<span class="pub-rate-chip">' + window.UI.formatCurrency(room.rate_weekly) + '/semana</span>');
      heroMeta.innerHTML = parts.join('');
    }
  }

  // ---- Availability grid ----------------------------------

  function renderAvailability() {
    var grid   = document.getElementById('avail-grid');
    var legend = document.getElementById('avail-legend');
    if (!grid) return;

    var today    = new Date();
    var todayStr = brtDateStr(today);

    // Day-of-week header (Mon–Sun)
    var DOW_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
    var html = '<div class="avail-dow-headers">';
    DOW_LABELS.forEach(function (d) { html += '<div class="avail-dow">' + d + '</div>'; });
    html += '</div><div class="avail-days">';

    // Start from Monday of this week
    var weekStart = window.UI.weekStart(today);

    for (var i = 0; i < 28; i++) {
      var day     = window.UI.addDays(weekStart, i);
      var dateStr = brtDateStr(day);

      var dayStart = new Date(dateStr + 'T00:00:00-03:00');
      var dayEnd   = new Date(dateStr + 'T23:59:59.999-03:00');
      var isPast   = day < new Date(todayStr + 'T00:00:00-03:00');
      var isToday  = dateStr === todayStr;
      var isBusy   = !isPast && dayHasOverlap(state.bookings, dayStart, dayEnd);
      var isBlocked = !isPast && dayHasOverlap(state.blocks, dayStart, dayEnd);

      var cls = 'avail-day';
      if (isPast)              cls += ' avail-day--past';
      else if (isBusy || isBlocked) cls += ' avail-day--busy';
      else                     cls += ' avail-day--free';
      if (isToday)             cls += ' avail-day--today';

      var dayNum = parseInt(dateStr.split('-')[2]);
      var isClickable = !isPast && !isBusy && !isBlocked;

      html += '<button type="button" class="' + cls + '"' +
        (isClickable ? ' data-date="' + dateStr + '"' : ' disabled') +
        ' aria-label="' + dateStr + (isToday ? ' (hoje)' : '') + '">' +
        dayNum +
        '</button>';
    }

    html += '</div>';
    grid.innerHTML = html;

    // Wire free-day clicks → pre-fill start date
    grid.querySelectorAll('.avail-day--free[data-date]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        prefillDate(btn.dataset.date);
      });
    });
  }

  function prefillDate(dateStr) {
    var startEl = document.getElementById('req-start');
    if (!startEl) return;

    // Mark selected day in calendar
    document.querySelectorAll('.avail-day--selected').forEach(function (el) {
      el.classList.remove('avail-day--selected');
    });
    var btn = document.querySelector('.avail-day[data-date="' + dateStr + '"]');
    if (btn) btn.classList.add('avail-day--selected');

    var currentTime = startEl.value ? startEl.value.slice(11, 16) : '09:00';
    startEl.value = dateStr + 'T' + currentTime;
    updateEndFromStart();

    // Scroll to the form section
    var formSection = document.getElementById('form-section');
    if (formSection) {
      formSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      formSection.classList.add('pub-form-highlight');
      setTimeout(function () {
        formSection.classList.remove('pub-form-highlight');
      }, 800);
    }
  }

  // ---- Request form ---------------------------------------

  function updateEndFromStart() {
    var startEl = document.getElementById('req-start');
    var endEl   = document.getElementById('req-end');
    if (!startEl || !endEl || !startEl.value) return;
    var startDate = new Date(startEl.value + ':00-03:00');
    var ms        = RATE_PRESETS[state.activeRate].ms;
    var endDate   = new Date(startDate.getTime() + ms);
    endEl.value   = window.UI.toDatetimeLocal(endDate);
    updatePricePreview();
  }

  function updatePricePreview() {
    var startEl    = document.getElementById('req-start');
    var endEl      = document.getElementById('req-end');
    var previewEl  = document.getElementById('price-preview');
    if (!previewEl) return;

    if (!startEl || !endEl || !startEl.value || !endEl.value) {
      previewEl.hidden = true;
      return;
    }
    var start = new Date(startEl.value + ':00-03:00');
    var end   = new Date(endEl.value   + ':00-03:00');
    var ms    = end - start;
    if (ms <= 0) { previewEl.hidden = true; return; }

    var price = computePrice(state.activeRate, ms);
    if (price == null) { previewEl.hidden = true; return; }

    var hours = ms / 3600000;
    var durLabel = hours < 24
      ? (hours === Math.floor(hours) ? Math.floor(hours) + 'h' : hours.toFixed(1) + 'h')
      : Math.round(hours / 24) + ' dias';

    previewEl.hidden = false;
    previewEl.textContent = 'Estimativa: ' + window.UI.formatCurrency(price) +
      ' (' + RATE_PRESETS[state.activeRate].label + ' · ' + durLabel + ')';
  }

  function setError(msg) {
    var el = document.getElementById('req-error');
    if (!el) return;
    if (msg) { el.textContent = msg; el.hidden = false; }
    else      { el.hidden = true; el.textContent = ''; }
  }

  function showSuccess() {
    var formEl    = document.getElementById('req-form-wrap');
    var successEl = document.getElementById('req-success');
    if (formEl)    formEl.hidden = true;
    if (successEl) successEl.hidden = false;
    successEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function wireForm(roomId) {
    var form    = document.getElementById('req-form');
    var startEl = document.getElementById('req-start');
    var endEl   = document.getElementById('req-end');

    if (!form) return;

    // Rate pills
    document.querySelectorAll('.rate-preset-pill').forEach(function (pill) {
      pill.addEventListener('click', function () {
        state.activeRate = pill.dataset.rate;
        document.querySelectorAll('.rate-preset-pill').forEach(function (p) {
          p.classList.toggle('rate-preset-pill--active', p === pill);
        });
        updateEndFromStart();
      });
    });

    if (startEl) {
      startEl.addEventListener('change', updateEndFromStart);
    }
    if (endEl) {
      endEl.addEventListener('change', updatePricePreview);
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      setError('');

      var name      = (document.getElementById('req-name')      || {}).value || '';
      var email     = (document.getElementById('req-email')     || {}).value || '';
      var phone     = (document.getElementById('req-phone')     || {}).value || '';
      var specialty = (document.getElementById('req-specialty') || {}).value || '';
      var startVal  = startEl ? startEl.value : '';
      var endVal    = endEl   ? endEl.value   : '';
      var notes     = (document.getElementById('req-notes')     || {}).value || '';
      var submitBtn = document.getElementById('req-submit');

      if (!name.trim())      { setError('Informe seu nome completo.'); return; }
      if (!email.trim())     { setError('Informe seu e-mail.'); return; }
      if (!phone.trim())     { setError('Informe seu telefone.'); return; }
      if (!specialty.trim()) { setError('Informe sua especialidade.'); return; }
      if (!startVal)         { setError('Selecione a data e hora de início.'); return; }
      if (!endVal)           { setError('Selecione a data e hora de término.'); return; }

      var startsAt = window.UI.datetimeLocalToISO(startVal);
      var endsAt   = window.UI.datetimeLocalToISO(endVal);

      if (new Date(endsAt) <= new Date(startsAt)) {
        setError('O término deve ser após o início.');
        return;
      }

      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Verificando disponibilidade…'; }

      window.checkOverlap(roomId, startsAt, endsAt).then(function (result) {
        if (result.hasConflict) {
          setError('Este horário não está disponível (' + result.reason + '). Por favor escolha outro.');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Enviar solicitação'; }
          return;
        }

        if (submitBtn) submitBtn.textContent = 'Enviando…';

        var ms     = new Date(endsAt) - new Date(startsAt);
        var price  = computePrice(state.activeRate, ms);
        var rateLbl = RATE_PRESETS[state.activeRate].label;
        var notesFull = ('Tarifa: ' + rateLbl + (notes.trim() ? '\n' + notes.trim() : ''));

        window.sb.from('bookings').insert({
          room_id:             roomId,
          client_name:         name.trim(),
          client_phone:        phone.trim() || null,
          starts_at:           startsAt,
          ends_at:             endsAt,
          status:              'solicitado',
          requester_email:     email.trim(),
          requester_specialty: specialty.trim(),
          notes:               notesFull
        }).select('id').then(function (res) {
          if (res.error) {
            var msg = res.error.message || '';
            if (msg.indexOf('no_overlapping') !== -1 || msg.indexOf('exclusion') !== -1) {
              setError('Este horário ficou indisponível agora. Por favor escolha outro.');
            } else {
              setError('Erro ao enviar solicitação. Tente novamente.');
            }
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Enviar solicitação'; }
            return;
          }
          var bookingId = res.data && res.data[0] && res.data[0].id;
          if (bookingId && window.Email) window.Email.send('solicitado', bookingId);
          showSuccess();
        });
      }).catch(function () {
        setError('Erro de conexão. Verifique sua internet e tente novamente.');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Enviar solicitação'; }
      });
    });
  }

  // ---- Boot -----------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    var params = new URLSearchParams(window.location.search);
    var roomId = params.get('id');

    if (!roomId) {
      var nameEl = document.getElementById('sala-hero-name');
      if (nameEl) nameEl.textContent = 'Sala não encontrada';
      var availSec = document.querySelector('.pub-section--tinted');
      var formSec  = document.getElementById('form-section');
      if (availSec) availSec.hidden = true;
      if (formSec)  formSec.hidden  = true;
      return;
    }

    // Fetch room + availability in parallel
    var weekStart  = window.UI.weekStart(new Date());
    var rangeStart = weekStart.toISOString();
    var rangeEnd   = window.UI.addDays(weekStart, 28).toISOString();

    Promise.all([
      window.sb.from('rooms').select('*').eq('id', roomId).single(),
      window.sb.from('bookings')
        .select('starts_at, ends_at')
        .eq('room_id', roomId)
        .in('status', ['confirmado', 'pendente'])
        .lt('starts_at', rangeEnd)
        .gt('ends_at', rangeStart),
      window.sb.from('blocked_times')
        .select('starts_at, ends_at')
        .eq('room_id', roomId)
        .lt('starts_at', rangeEnd)
        .gt('ends_at', rangeStart)
    ]).then(function (results) {
      var roomRes     = results[0];
      var bookingsRes = results[1];
      var blocksRes   = results[2];

      if (roomRes.error || !roomRes.data) {
        var nameEl2 = document.getElementById('sala-hero-name');
        if (nameEl2) nameEl2.textContent = 'Sala não encontrada';
        var availSec2 = document.querySelector('.pub-section--tinted');
        var formSec2  = document.getElementById('form-section');
        if (availSec2) availSec2.hidden = true;
        if (formSec2)  formSec2.hidden  = true;
        return;
      }

      state.room     = roomRes.data;
      state.bookings = bookingsRes.data || [];
      state.blocks   = blocksRes.data   || [];

      renderHero(state.room);
      renderAvailability();
      wireForm(roomId);

      // Set default start to tomorrow 09:00
      var tomorrow = window.UI.addDays(new Date(), 1);
      var tStr     = window.UI.localDateStr(tomorrow);
      var startEl  = document.getElementById('req-start');
      if (startEl) startEl.value = tStr + 'T09:00';
      updateEndFromStart();
    });
  });

})();
