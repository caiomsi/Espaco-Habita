(function () {
  'use strict';

  var SUPABASE_URL  = 'https://ayxtccsyswbohmxxliim.supabase.co';
  var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5eHRjY3N5c3dib2hteHhsaWltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0ODAzMDQsImV4cCI6MjA5NzA1NjMwNH0.dXBzyLEAX9v40_W6fRLb09VzyHEBwDqvoGVmMopv1Ok';

  window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
})();
