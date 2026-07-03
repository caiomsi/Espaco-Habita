(function () {
  'use strict';

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Rooms priced via the rate-card tables (pricing_group set) don't carry a
  // legacy rate_hourly, so without this the public grid showed no price at
  // all for them. Mirrors the precedence sala.js uses on the detail page:
  // legacy rate_hourly wins if present, otherwise fall back to the cheapest
  // tier from the rate card (1h Salão tier, or the avulsa hourly rate).
  function groupHourlyChip(room, salaoTiers, avulsaByGroup) {
    if (room.rate_hourly) return window.UI.formatCurrency(room.rate_hourly) + '/h';

    if (room.pricing_group === 'salao') {
      var cheapest = (salaoTiers || []).slice().sort(function (a, b) {
        return parseFloat(a.duration_hours) - parseFloat(b.duration_hours);
      })[0];
      return cheapest ? 'A partir de ' + window.UI.formatCurrency(cheapest.price_public) : null;
    }

    if (['grande', 'pequena', 'sala1'].indexOf(room.pricing_group) !== -1) {
      var avulsa = avulsaByGroup[room.pricing_group];
      return avulsa ? window.UI.formatCurrency(avulsa.price_public) + '/h' : null;
    }

    return null;
  }

  function renderRooms(rooms, salaoTiers, avulsaByGroup) {
    var grid = document.getElementById('salas-grid');
    if (!grid) return;

    if (!rooms || rooms.length === 0) {
      grid.innerHTML =
        '<div class="pub-empty-state">' +
          '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' +
          '<p class="pub-empty-title">Nenhuma sala cadastrada</p>' +
          '<p class="pub-empty-msg">As salas disponíveis aparecerão aqui em breve.</p>' +
        '</div>';
      return;
    }

    grid.innerHTML = '';
    rooms.forEach(function (room) {
      var rates = [];
      var hourlyChip = room.pricing_group
        ? groupHourlyChip(room, salaoTiers, avulsaByGroup)
        : (room.rate_hourly ? window.UI.formatCurrency(room.rate_hourly) + '/h' : null);
      if (hourlyChip) rates.push(hourlyChip);
      if (room.rate_daily)  rates.push(window.UI.formatCurrency(room.rate_daily)  + '/dia');
      if (room.rate_weekly) rates.push(window.UI.formatCurrency(room.rate_weekly) + '/semana');

      var photoHtml = room.photo_url
        ? '<img src="' + escHtml(room.photo_url) + '" alt="' + escHtml(room.name) + '" loading="lazy">'
        : '<div class="pub-room-photo-placeholder"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>';

      var card = document.createElement('article');
      card.className = 'pub-room-card';
      card.innerHTML =
        '<a href="sala.html?id=' + room.id + '" class="pub-room-photo-link">' +
          '<div class="pub-room-photo">' + photoHtml + '</div>' +
        '</a>' +
        '<div class="pub-room-card-body">' +
          '<div class="pub-room-card-top">' +
            '<h2 class="pub-room-name">' + escHtml(room.name) + '</h2>' +
            (room.capacity
              ? '<span class="pub-capacity-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>&nbsp;' + room.capacity + '</span>'
              : '') +
          '</div>' +
          (room.description
            ? '<p class="pub-room-desc">' + escHtml(room.description) + '</p>'
            : '') +
          (rates.length > 0
            ? '<div class="pub-rates">' +
                rates.map(function (r) { return '<span class="pub-rate-chip">' + r + '</span>'; }).join('') +
              '</div>'
            : '') +
          '<a href="sala.html?id=' + room.id + '" class="pub-cta-btn">Ver disponibilidade</a>' +
        '</div>';

      grid.appendChild(card);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var roomsPromise = window.sb.from('rooms').select('*').eq('active', true).order('name');

    // Pricing lookups run in parallel — if js/pricing.js isn't loaded for some
    // reason, these no-op and rooms just fall back to their legacy rate fields.
    var salaoPromise = window.Pricing ? window.Pricing.getSalaoTiers() : Promise.resolve([]);
    var avulsaPromises = ['grande', 'pequena', 'sala1'].map(function (group) {
      return window.Pricing ? window.Pricing.getAvulsaRate(group) : Promise.resolve(null);
    });

    Promise.all([roomsPromise, salaoPromise].concat(avulsaPromises)).then(function (results) {
      var res = results[0];
      if (res.error) {
        var grid = document.getElementById('salas-grid');
        if (grid) grid.innerHTML =
          '<div class="pub-empty-state">' +
            '<p class="pub-empty-title">Não foi possível carregar as salas</p>' +
            '<p class="pub-empty-msg">Verifique sua conexão e <a href="salas.html">tente novamente</a>.</p>' +
          '</div>';
        return;
      }
      var salaoTiers = results[1] || [];
      var avulsaByGroup = { grande: results[2], pequena: results[3], sala1: results[4] };
      renderRooms(res.data || [], salaoTiers, avulsaByGroup);
    });
  });

})();
