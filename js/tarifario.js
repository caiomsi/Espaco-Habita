(function () {
  'use strict';

  var GROUP_LABELS = { grande: 'Sala Grande', pequena: 'Sala Pequena', sala1: 'Sala 1' };
  var PACKAGE_LABELS = { avulsa: 'Avulsa (1h)', pacote5: 'Pacote 5h', pacote10: 'Pacote 10h', pacote15: 'Pacote 15h' };

  function escHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function numInput(id, value) {
    return '<input type="number" step="0.01" min="0" id="' + id + '" value="' + (value == null ? '' : value) + '">';
  }

  // ---- Salão ad-hoc rate tiers ---------------------------------

  function loadSalaoRates() {
    return window.sb.from('salao_rate_tiers').select('*').order('sort_order').then(function (res) {
      var body = document.getElementById('tf-salao-rate-body');
      if (!body) return;
      var rows = res.data || [];
      body.innerHTML = rows.map(function (r) {
        return '<tr data-id="' + r.id + '">' +
          '<td>' + escHtml(r.duration_label) + '</td>' +
          '<td>' + numInput('sr-pp-' + r.id, r.price_public) + '</td>' +
          '<td>' + numInput('sr-ep-' + r.id, r.entrada_public) + '</td>' +
          '<td>' + numInput('sr-sp-' + r.id, r.saldo_public) + '</td>' +
          '<td>' + numInput('sr-pf-' + r.id, r.price_professional) + '</td>' +
          '<td>' + numInput('sr-ef-' + r.id, r.entrada_professional) + '</td>' +
          '<td>' + numInput('sr-sf-' + r.id, r.saldo_professional) + '</td>' +
          '</tr>';
      }).join('');
    });
  }

  function saveSalaoRates() {
    var rows = document.querySelectorAll('#tf-salao-rate-body tr[data-id]');
    var updates = Array.from(rows).map(function (tr) {
      var id = tr.dataset.id;
      return window.sb.from('salao_rate_tiers').update({
        price_public:         parseFloat(document.getElementById('sr-pp-' + id).value) || 0,
        entrada_public:       parseFloat(document.getElementById('sr-ep-' + id).value) || 0,
        saldo_public:         parseFloat(document.getElementById('sr-sp-' + id).value) || 0,
        price_professional:   parseFloat(document.getElementById('sr-pf-' + id).value) || 0,
        entrada_professional: parseFloat(document.getElementById('sr-ef-' + id).value) || 0,
        saldo_professional:   parseFloat(document.getElementById('sr-sf-' + id).value) || 0
      }).eq('id', id);
    });
    return Promise.all(updates);
  }

  // ---- Salão aula tiers ------------------------------------------

  function loadAulaTiers() {
    return window.sb.from('salao_aula_tiers').select('*').order('classes_per_week').then(function (res) {
      var body = document.getElementById('tf-aula-body');
      if (!body) return;
      var rows = res.data || [];
      body.innerHTML = rows.map(function (r) {
        return '<tr data-id="' + r.id + '">' +
          '<td>' + r.classes_per_week + '</td>' +
          '<td>' + numInput('au-pm-' + r.id, r.price_monthly) + '</td>' +
          '<td>' + numInput('au-hm-' + r.id, r.hours_monthly) + '</td>' +
          '</tr>';
      }).join('');
    });
  }

  function saveAulaTiers() {
    var rows = document.querySelectorAll('#tf-aula-body tr[data-id]');
    var updates = Array.from(rows).map(function (tr) {
      var id = tr.dataset.id;
      var hoursVal = document.getElementById('au-hm-' + id).value;
      return window.sb.from('salao_aula_tiers').update({
        price_monthly: parseFloat(document.getElementById('au-pm-' + id).value) || 0,
        hours_monthly: hoursVal === '' ? null : parseFloat(hoursVal)
      }).eq('id', id);
    });
    return Promise.all(updates);
  }

  // ---- Sala period tiers (contracts) ------------------------------

  function loadPeriodTiers() {
    return window.sb.from('sala_period_tiers').select('*').order('room_group').order('sort_order').then(function (res) {
      var body = document.getElementById('tf-period-body');
      if (!body) return;
      var rows = res.data || [];
      body.innerHTML = rows.map(function (r) {
        return '<tr data-id="' + r.id + '">' +
          '<td>' + (GROUP_LABELS[r.room_group] || r.room_group) + '</td>' +
          '<td>' + escHtml(r.label) + '</td>' +
          '<td>' + r.hours_month + '</td>' +
          '<td>' + numInput('pt-pm-' + r.id, r.price_monthly) + '</td>' +
          '</tr>';
      }).join('');
    });
  }

  function savePeriodTiers() {
    var rows = document.querySelectorAll('#tf-period-body tr[data-id]');
    var updates = Array.from(rows).map(function (tr) {
      var id = tr.dataset.id;
      return window.sb.from('sala_period_tiers').update({
        price_monthly: parseFloat(document.getElementById('pt-pm-' + id).value) || 0
      }).eq('id', id);
    });
    return Promise.all(updates);
  }

  // ---- Marginal rates -----------------------------------------------

  function loadMarginalRates() {
    return window.sb.from('sala_marginal_rates').select('*').order('room_group').order('band_from_hours').then(function (res) {
      var body = document.getElementById('tf-marginal-body');
      if (!body) return;
      var rows = res.data || [];
      body.innerHTML = rows.map(function (r) {
        return '<tr data-id="' + r.id + '">' +
          '<td>' + (GROUP_LABELS[r.room_group] || r.room_group) + '</td>' +
          '<td>' + r.band_from_hours + '</td>' +
          '<td>' + r.band_to_hours + '</td>' +
          '<td>' + numInput('mr-rate-' + r.id, r.rate_per_hour) + '</td>' +
          '</tr>';
      }).join('');
    });
  }

  function saveMarginalRates() {
    var rows = document.querySelectorAll('#tf-marginal-body tr[data-id]');
    var updates = Array.from(rows).map(function (tr) {
      var id = tr.dataset.id;
      return window.sb.from('sala_marginal_rates').update({
        rate_per_hour: parseFloat(document.getElementById('mr-rate-' + id).value) || 0
      }).eq('id', id);
    });
    return Promise.all(updates);
  }

  // ---- Admin fee (settings) ------------------------------------------

  function loadAdminFee() {
    return window.sb.from('settings').select('*').eq('key', 'taxa_administracao').single().then(function (res) {
      var el = document.getElementById('tf-admin-fee');
      if (!el || !res.data) return;
      el.value = parseFloat(res.data.value);
    });
  }

  function saveAdminFee() {
    var val = parseFloat(document.getElementById('tf-admin-fee').value) || 0;
    return window.sb.from('settings').update({ value: val, updated_at: new Date().toISOString() }).eq('key', 'taxa_administracao');
  }

  // ---- Hour package tiers --------------------------------------------

  function loadPackageTiers() {
    return window.sb.from('sala_hour_package_tiers').select('*').order('room_group').order('sort_order').then(function (res) {
      var body = document.getElementById('tf-package-body');
      if (!body) return;
      var rows = res.data || [];
      body.innerHTML = rows.map(function (r) {
        return '<tr data-id="' + r.id + '">' +
          '<td>' + (GROUP_LABELS[r.room_group] || r.room_group) + '</td>' +
          '<td>' + (PACKAGE_LABELS[r.package_type] || r.package_type) + '</td>' +
          '<td>' + r.hours + '</td>' +
          '<td>' + numInput('pk-pp-' + r.id, r.price_public) + '</td>' +
          '<td>' + numInput('pk-pf-' + r.id, r.price_professional) + '</td>' +
          '</tr>';
      }).join('');
    });
  }

  function savePackageTiers() {
    var rows = document.querySelectorAll('#tf-package-body tr[data-id]');
    var updates = Array.from(rows).map(function (tr) {
      var id = tr.dataset.id;
      return window.sb.from('sala_hour_package_tiers').update({
        price_public:       parseFloat(document.getElementById('pk-pp-' + id).value) || 0,
        price_professional: parseFloat(document.getElementById('pk-pf-' + id).value) || 0
      }).eq('id', id);
    });
    return Promise.all(updates);
  }

  // ---- Boot -----------------------------------------------------------

  function loadAll() {
    return Promise.all([
      loadSalaoRates(), loadAulaTiers(), loadPeriodTiers(),
      loadMarginalRates(), loadAdminFee(), loadPackageTiers()
    ]);
  }

  var SAVE_HANDLERS = {
    'salao-rate': saveSalaoRates,
    'aula':       saveAulaTiers,
    'period':     savePeriodTiers,
    'marginal':   saveMarginalRates,
    'fee':        saveAdminFee,
    'package':    savePackageTiers
  };

  function boot() {
    loadAll();

    document.querySelectorAll('[data-save]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var handler = SAVE_HANDLERS[btn.dataset.save];
        if (!handler) return;
        var origText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Salvando…';
        Promise.resolve(handler()).then(function (result) {
          btn.disabled = false;
          btn.textContent = origText;
          var hasError = Array.isArray(result)
            ? result.some(function (r) { return r && r.error; })
            : (result && result.error);
          if (hasError) {
            window.UI.toast('Erro ao salvar.', 'erro');
            return;
          }
          window.UI.toast('Valores salvos.', 'ok');
        });
      });
    });
  }

  if (window.authReady) { boot(); } else {
    document.addEventListener('auth:ready', boot, { once: true });
    setTimeout(function () {
      if (!window.authReady) {
        window.UI.toast('Não foi possível conectar. Faça login novamente.', 'erro');
      }
    }, 10000);
  }

})();
