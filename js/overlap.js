(function () {
  'use strict';

  // Shared overlap checker used by public request form, admin approval, and admin booking form.
  // Returns Promise<{ hasConflict: boolean, reason: string|null }>
  // Checks blocked_times (hard) and confirmed/pending bookings (hard).
  // excludeBookingId: optional UUID to skip (used when editing an existing booking).
  function checkOverlap(roomId, startsAt, endsAt, excludeBookingId) {
    var blockedQ = window.sb.from('blocked_times')
      .select('id, reason')
      .eq('room_id', roomId)
      .lt('starts_at', endsAt)
      .gt('ends_at', startsAt);

    var bookingsQ = window.sb.from('bookings')
      .select('id, client_name')
      .eq('room_id', roomId)
      .in('status', ['confirmado', 'pendente'])
      .lt('starts_at', endsAt)
      .gt('ends_at', startsAt);
    if (excludeBookingId) bookingsQ = bookingsQ.neq('id', excludeBookingId);

    return Promise.all([blockedQ, bookingsQ]).then(function (results) {
      var blocked  = results[0].data || [];
      var bookings = results[1].data || [];

      if (blocked.length > 0) {
        var r = blocked[0].reason ? ': ' + blocked[0].reason : '';
        return { hasConflict: true, isHardBlock: true, reason: 'Sala bloqueada' + r };
      }
      if (bookings.length > 0) {
        return { hasConflict: true, isHardBlock: false, reason: 'Horário já reservado' };
      }
      return { hasConflict: false, isHardBlock: false, reason: null };
    });
  }

  window.checkOverlap = checkOverlap;

})();
