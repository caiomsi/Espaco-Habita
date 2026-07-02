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

  function load() {
    var labelEl = document.getElementById('period-label');
    if (labelEl) labelEl.textContent = monthLabel(state.anchor);

    var range = monthRange(state.anchor);

    Promise.all([
      window.sb.from('bookings')
        .select('rate_applied, discount_amount, rooms(name)')
        .eq('status', 'confirmado')
        .gte('starts_at', range.start + 'T00:00:00-03:00')
        .lt('starts_at', range.end + 'T00:00:00-03:00'),
      window.sb.from('expenses')
        .select('category, amount')
        .eq('active', true)
        .gte('expense_date', range.start)
        .lt('expense_date', range.end)
    ]).then(function (results) {
      var bookingsRes = results[0];
      var expensesRes = results[1];
      if (bookingsRes.error || expensesRes.error) {
        window.UI.toast('Erro ao carregar dados financeiros.', 'erro');
        return;
      }
      render(bookingsRes.data || [], expensesRes.data || []);
    });
  }

  function render(bookings, expenses) {
    var receita = 0, descontos = 0, despesas = 0;
    var byRoom = {};
    var byCategory = {};

    bookings.forEach(function (b) {
      var rate = parseFloat(b.rate_applied) || 0;
      var disc = parseFloat(b.discount_amount) || 0;
      receita   += rate;
      descontos += disc;
      var roomName = (b.rooms && b.rooms.name) ? b.rooms.name : 'Sala';
      byRoom[roomName] = (byRoom[roomName] || 0) + rate;
    });

    expenses.forEach(function (e) {
      var amount = parseFloat(e.amount) || 0;
      despesas += amount;
      byCategory[e.category] = (byCategory[e.category] || 0) + amount;
    });

    var saldo = receita - despesas;

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
