(function () {
  'use strict';

  var isLoginPage = document.body.dataset.page === 'login';

  // Check session on every page load
  window.sb.auth.getSession().then(function (res) {
    var session = res.data && res.data.session;

    // Not authenticated on a protected page → go to login
    if (!session && !isLoginPage) {
      location.replace('login.html');
      return;
    }

    // Already authenticated on login page → go to dashboard
    if (session && isLoginPage) {
      location.replace('dashboard.html');
      return;
    }

    if (session) {
      // Show email in sidebar
      var userEl = document.getElementById('sidebar-user');
      if (userEl) userEl.textContent = session.user.email;

      // Set global flag so late-registering listeners can check it
      window.authReady = true;

      // Signal page-specific JS that auth is ready
      document.dispatchEvent(new CustomEvent('auth:ready'));
    }
  });

  // Catch session expiry mid-use (e.g. token refresh failure)
  window.sb.auth.onAuthStateChange(function (event) {
    if (event === 'SIGNED_OUT' && !isLoginPage) {
      location.replace('login.html');
    }
  });

  // ---- Login form (only present on login.html) ----
  var loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();

      var email    = document.getElementById('login-email').value.trim();
      var password = document.getElementById('login-password').value;
      var errorEl  = document.getElementById('login-error');
      var btn      = loginForm.querySelector('[type="submit"]');

      errorEl.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Entrando…';

      window.sb.auth.signInWithPassword({ email: email, password: password })
        .then(function (res) {
          if (res.error) {
            var msg = res.error.message || '';
            if (msg.indexOf('Email not confirmed') !== -1) {
              msg = 'E-mail não confirmado. Contate o administrador.';
            } else {
              msg = 'Email ou senha incorretos.';
            }
            errorEl.textContent = msg;
            errorEl.hidden = false;
            btn.disabled = false;
            btn.textContent = 'Entrar';
          } else {
            location.replace('dashboard.html');
          }
        });
    });
  }

  // ---- Logout (called from sidebar button) ----
  window.Auth = {
    logout: function () {
      window.sb.auth.signOut().then(function () {
        location.replace('login.html');
      });
    }
  };

})();
