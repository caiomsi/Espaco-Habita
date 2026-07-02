(function () {
  'use strict';

  var TZ = 'America/Sao_Paulo';

  var CATEGORY_LABELS = {
    aluguel:    'Aluguel',
    contas:     'Contas',
    manutencao: 'Manutenção',
    material:   'Material',
    marketing:  'Marketing',
    pessoal:    'Pessoal',
    outros:     'Outros'
  };

  var state = { anchor: null }; // "YYYY-MM-01" for the month currently shown

  // ---- Month arithmetic on "YYYY-MM-01" strings ---------------

  function monthAnchorStr(date) {
    return window.UI.localDateStr(date).slice(0, 7) + '-01';
  }

  function addMonthsToAnchor(anchorStr, n) {
    var parts = anchorStr.split('-');
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10) - 1 + n;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    var mm = (m + 1 < 10 ? '0' : '') + (m + 1);
    return y + '-' + mm + '-01';
  }

  function monthLabel(anchorStr) {
    var d = new Date(anchorStr + 'T12:00:00-03:00');
    var label = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, month: 'long', year: 'numeric' }).format(d);
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function monthRange(anchorStr) {
    return { start: anchorStr, end: addMonthsToAnchor(anchorStr, 1) };
  }

  // ---- Load & render --------------------------------------------
  //
  // Revenue is recognized once, from three independent sources — no double
  // counting between them (see contract/package RPCs, which zero out
  // rate_applied and tag revenue_source on the bookings they generate):
  //   - Ad-hoc bookings: status='confirmado' AND revenue_source='direto', on approval
  //   - Hour packages: at purchase (client_hour_packages.purchased_at in month)
  //   - Sala contracts: live per displayed month, from price_monthly, for every
  //     contract whose [starts_on, ends_on] window overlaps the month and wasn't
  //     cancelled before it started. The one-time admin fee is recognized in the
  //     month the contract started, when admin_fee_charged is true.

  function load() {
    var labelEl = document.getElementById('period-label');
    if (labelEl) labelEl.textContent = monthLabel(state.anchor);

    var range = monthRange(state.anchor);

    Promise.all([
      window.sb.from('bookings')
        .select('rate_applied, discount_amount, rooms(name)')
        .eq('status', 'confirmado')
        .eq('revenue_source', 'direto')
        .gte('starts_at', range.start + 'T00:00:00-03:00')
        .lt('starts_at', range.end + 'T00:00:00-03:00'),
      window.sb.from('client_hour_packages')
        .select('price_paid, purchased_at')
        .gte('purchased_at', range.start + 'T00:00:00-03:00')
        .lt('purchased_at', range.end + 'T00:00:00-03:00'),
      window.sb.from('sala_contracts')
        .select('price_monthly, starts_on, ends_on, admin_fee_charged, admin_fee_amount, status')
        .lt('starts_on', range.end)
        .or('ends_on.is.null,ends_on.gte.' + range.start),
      window.sb.from('expenses')
        .select('category, amount')
        .eq('active', true)
        .gte('expense_date', range.start)
        .lt('expense_date', range.end)
    ]).then(function (results) {
      var bookingsRes  = results[0];
      var packagesRes  = results[1];
      var contractsRes = results[2];
      var expensesRes  = results[3];
      if (bookingsRes.error || packagesRes.error || contractsRes.error || expensesRes.error) {
        window.UI.toast('Erro ao carregar dados financeiros.', 'erro');
        return;
      }
      render(bookingsRes.data || [], packagesRes.data || [], contractsRes.data || [], expensesRes.data || [], range);
    });
  }

  function render(bookings, packages, contracts, expenses, range) {
    var receitaDireto = 0, receitaPacotes = 0, receitaContratos = 0, descontos = 0, despesas = 0;
    var byRoom = {};
    var byCategory = {};

    bookings.forEach(function (b) {
      var rate = parseFloat(b.rate_applied) || 0;
      var disc = parseFloat(b.discount_amount) || 0;
      receitaDireto += rate;
      descontos     += disc;
      var roomName = (b.rooms && b.rooms.name) ? b.rooms.name : 'Sala';
      byRoom[roomName] = (byRoom[roomName] || 0) + rate;
    });

    packages.forEach(function (p) {
      receitaPacotes += parseFloat(p.price_paid) || 0;
    });

    contracts.forEach(function (c) {
      receitaContratos += parseFloat(c.price_monthly) || 0;
      if (c.admin_fee_charged && c.starts_on >= range.start && c.starts_on < range.end) {
        receitaContratos += parseFloat(c.admin_fee_amount) || 0;
      }
    });

    expenses.forEach(function (e) {
      var amount = parseFloat(e.amount) || 0;
      despesas += amount;
      byCategory[e.category] = (byCategory[e.category] || 0) + amount;
    });

    var receita = receitaDireto + receitaPacotes + receitaContratos;
    var saldo   = receita - despesas;

    setText('fin-receita',   window.UI.formatCurrency(receita));
    setText('fin-descontos', window.UI.formatCurrency(descontos));
    setText('fin-despesas',  window.UI.formatCurrency(despesas));
    setText('fin-saldo',     window.UI.formatCurrency(saldo));

    var saldoCard = document.getElementById('fin-saldo-card');
    if (saldoCard) saldoCard.classList.toggle('fin-stat-card--negative', saldo < 0);

    var catRows = Object.keys(byCategory).map(function (cat) {
      return { label: CATEGORY_LABELS[cat] || cat, amount: byCategory[cat] };
    });
    window.UI.renderBarList(document.getElementById('fin-expense-breakdown'), catRows);

    var roomRows = Object.keys(byRoom).map(function (name) {
      return { label: name, amount: byRoom[name] };
    });
    window.UI.renderBarList(document.getElementById('fin-room-breakdown'), roomRows);

    var originRows = [
      { label: 'Ad-hoc', amount: receitaDireto },
      { label: 'Pacotes', amount: receitaPacotes },
      { label: 'Contratos', amount: receitaContratos }
    ].filter(function (r) { return r.amount > 0; });
    window.UI.renderBarList(document.getElementById('fin-origin-breakdown'), originRows);
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  // ---- Boot -----------------------------------------------------

  function boot() {
    state.anchor = monthAnchorStr(new Date());
    load();

    var prevBtn = document.getElementById('prev-month');
    var nextBtn = document.getElementById('next-month');
    var thisBtn = document.getElementById('this-month-btn');

    if (prevBtn) prevBtn.addEventListener('click', function () {
      state.anchor = addMonthsToAnchor(state.anchor, -1);
      load();
    });
    if (nextBtn) nextBtn.addEventListener('click', function () {
      state.anchor = addMonthsToAnchor(state.anchor, 1);
      load();
    });
    if (thisBtn) thisBtn.addEventListener('click', function () {
      state.anchor = monthAnchorStr(new Date());
      load();
    });
  }

  if (window.authReady) { boot(); } else {
    document.addEventListener('auth:ready', boot, { once: true });
    setTimeout(function () {
      if (!window.authReady) {
        var el = document.getElementById('fin-expense-breakdown');
        if (el && el.querySelector('.loading-state')) {
          el.innerHTML = '<p class="error-state">Não foi possível conectar. <a href="login.html">Fazer login novamente</a>.</p>';
        }
      }
    }, 10000);
  }

})();
