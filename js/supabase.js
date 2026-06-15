(function () {
  'use strict';

  // Replace these two values with your Supabase project credentials.
  // Settings → API in the Supabase dashboard.
  var SUPABASE_URL  = 'YOUR_SUPABASE_URL';
  var SUPABASE_ANON = 'YOUR_SUPABASE_ANON_KEY';

  window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
})();
