(function () {
  'use strict';

  var currentExpense = null; // null = new; object = editing

  var CATEGORY_LABELS = {
    aluguel:    'Aluguel',
    contas:     'Contas',
    manutencao: 'Manutenção',
    material:   'Material',
    marketing:  'Marketing',
    pessoal:    'Pessoal',
    outros:     'Outros'
  };

  // ---- Load & render ----------------------------------------

  function loadExpenses() {
    var list = document.getElementById('expenses-list');
    if (list) list.innerHTML = '<div class="loading-state">Carregando…</div>';

    window.sb.from('expenses').select('*').order('expense_date', { ascending: false })
      .then(function (res) {
        if (res.error) {
          if (list) list.innerHTML = '<div class="error-state">Erro ao carregar despesas: ' + res.error.message + '</div>';
          return;
        }
        var expenses = res.data || [];
        renderExpenses(expenses);
        renderCategoryBreakdown(expenses);
      });
  }

  function formatExpenseDate(dateStr) {
    var p = dateStr.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  function renderExpenses(expenses) {
    var list = document.getElementById('expenses-list');
    if (!list) return;

    if (expenses.length === 0) {
      list.innerHTML =
        '<div class="empty-state">Nenhuma despesa registrada ainda.<br>' +
        'Clique em "Adicionar Despesa" para começar.</div>';
      return;
    }

    list.innerHTML = '';
    expenses.forEach(function (expense) {
      var card = document.createElement('div');
      card.className = 'expense-card' + (expense.active ? '' : ' expense-card--inactive');

      card.innerHTML =
        '<div class="expense-card-header">' +
          '<div>' +
            '<p class="expense-card-category">' + escHtml(CATEGORY_LABELS[expense.category] || expense.category) + '</p>' +
            '<p class="expense-card-amount">' + window.UI.formatCurrency(expense.amount) + '</p>' +
          '</div>' +
          '<span class="badge ' + (expense.active ? 'badge--active' : 'badge--inactive') + '">' +
            (expense.active ? 'Ativo' : 'Inativo') + '</span>' +
        '</div>' +
        '<p class="expense-card-date">' + formatExpenseDate(expense.expense_date) + '</p>' +
        (expense.description ? '<p class="expense-card-desc">' + escHtml(expense.description) + '</p>' : '') +
        '<div class="expense-card-actions">' +
          '<button class="btn btn-ghost btn-sm" data-action="edit">Editar</button>' +
          '<button class="btn btn-ghost btn-sm" data-action="toggle">' +
            (expense.active ? 'Desativar' : 'Reativar') + '</button>' +
        '</div>';

      card.querySelector('[data-action="edit"]').addEventListener('click', function () {
        openEdit(expense);
      });

      card.querySelector('[data-action="toggle"]').addEventListener('click', function () {
        var label = expense.active ? 'Desativar' : 'Reativar';
        if (!confirm(label + ' esta despesa?')) return;
        window.sb.from('expenses')
          .update({ active: !expense.active })
          .eq('id', expense.id)
          .then(function (res) {
            if (res.error) { window.UI.toast('Erro ao atualizar despesa.', 'erro'); return; }
            window.UI.toast('Despesa ' + (expense.active ? 'desativada' : 'reativada') + '.', 'ok');
            loadExpenses();
          });
      });

      list.appendChild(card);
    });
  }

  function renderCategoryBreakdown(expenses) {
    var container = document.getElementById('expense-cat-breakdown-list');
    if (!container) return;

    var active = expenses.filter(function (e) { return e.active; });
    var totals = {};
    active.forEach(function (e) {
      totals[e.category] = (totals[e.category] || 0) + parseFloat(e.amount);
    });

    var rows = Object.keys(totals).map(function (cat) {
      return { label: CATEGORY_LABELS[cat] || cat, amount: totals[cat] };
    });

    window.UI.renderBarList(container, rows);
  }

  // ---- Modal --------------------------------------------------

  function openNew() {
    currentExpense = null;
    var form = document.getElementById('expense-form');
    if (form) form.reset();
    document.getElementById('expense-modal-title').textContent = 'Nova Despesa';
    document.getElementById('expense-error').hidden = true;
    document.getElementById('ex-date').value = window.UI.localDateStr(new Date());
    window.UI.openModal('expense-modal');
  }

  function openEdit(expense) {
    currentExpense = expense;
    var form = document.getElementById('expense-form');
    if (form) form.reset();
    document.getElementById('expense-modal-title').textContent = 'Editar Despesa';
    document.getElementById('expense-error').hidden = true;
    document.getElementById('ex-category').value    = expense.category;
    document.getElementById('ex-amount').value       = expense.amount;
    document.getElementById('ex-date').value         = expense.expense_date;
    document.getElementById('ex-description').value  = expense.description || '';
    window.UI.openModal('expense-modal');
  }

  // ---- Helpers ---------------------------------------------

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- Boot -----------------------------------------------

  function bootExpenses() {
    function onAuthReady() {
      loadExpenses();
      var addBtn = document.getElementById('add-expense-btn');
      if (addBtn) addBtn.addEventListener('click', openNew);
    }

    if (window.authReady) { onAuthReady(); return; }
    document.addEventListener('auth:ready', onAuthReady, { once: true });
    setTimeout(function () {
      if (!window.authReady) {
        var list = document.getElementById('expenses-list');
        if (list && list.querySelector('.loading-state')) {
          list.innerHTML =
            '<div class="error-state">Não foi possível conectar. ' +
            '<a href="login.html">Fazer login novamente</a>.</div>';
        }
      }
    }, 10000);
  }

  bootExpenses();

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('expense-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var saveBtn = document.getElementById('expense-save-btn');
        var category = document.getElementById('ex-category').value;
        var amount   = parseFloat(document.getElementById('ex-amount').value);
        var date     = document.getElementById('ex-date').value;
        var errEl    = document.getElementById('expense-error');

        if (!category) { errEl.textContent = 'Selecione uma categoria.'; errEl.hidden = false; return; }
        if (isNaN(amount) || amount <= 0) { errEl.textContent = 'Informe um valor válido maior que zero.'; errEl.hidden = false; return; }
        if (!date) { errEl.textContent = 'Informe a data da despesa.'; errEl.hidden = false; return; }
        errEl.hidden = true;

        var payload = {
          category:     category,
          amount:       amount,
          expense_date: date,
          description:  document.getElementById('ex-description').value.trim() || null
        };

        window.UI.setLoading(saveBtn, true);

        var promise = currentExpense
          ? window.sb.from('expenses').update(payload).eq('id', currentExpense.id)
          : window.sb.from('expenses').insert(payload);

        promise.then(function (res) {
          window.UI.setLoading(saveBtn, false);
          if (res.error) {
            errEl.textContent = 'Erro: ' + res.error.message;
            errEl.hidden = false;
            return;
          }
          window.UI.closeAllModals();
          window.UI.toast(currentExpense ? 'Despesa atualizada.' : 'Despesa registrada.', 'ok');
          loadExpenses();
        });
      });
    }
  });

})();
