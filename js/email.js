(function () {
  'use strict';

  // Fire-and-forget email trigger. Errors are swallowed — a failed email never
  // blocks or surfaces an error to the user. The booking is already saved.
  window.Email = {
    send: function (type, bookingId) {
      var ctrl = new AbortController();
      setTimeout(function () { ctrl.abort(); }, 8000);
      fetch('https://forms.caiomsi.com/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: type, bookingId: bookingId }),
        signal: ctrl.signal,
      }).catch(function () {});
    },
  };

})();
