(function () {
  'use strict';

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderRooms(rooms) {
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
      if (room.rate_hourly) rates.push(window.UI.formatCurrency(room.rate_hourly) + '/h');
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
    window.sb.from('rooms')
      .select('*')
      .eq('active', true)
      .order('name')
      .then(function (res) {
        if (res.error) {
          var grid = document.getElementById('salas-grid');
          if (grid) grid.innerHTML =
            '<div class="pub-empty-state">' +
              '<p class="pub-empty-title">Não foi possível carregar as salas</p>' +
              '<p class="pub-empty-msg">Verifique sua conexão e <a href="salas.html">tente novamente</a>.</p>' +
            '</div>';
          return;
        }
        renderRooms(res.data || []);
      });
  });

})();
