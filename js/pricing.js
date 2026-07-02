(function () {
  'use strict';

  // Shared pricing lookups against the rate-card tables (salao_rate_tiers,
  // salao_aula_tiers, sala_period_tiers, sala_marginal_rates, sala_hour_package_tiers).
  // No caching — these tables are tiny and edited live in Tarifário, so a fresh
  // query on every call is simpler and avoids staleness bugs.

  function getSalaoTiers() {
    return window.sb.from('salao_rate_tiers').select('*').eq('active', true).order('sort_order')
      .then(function (res) { return res.data || []; });
  }

  function getSalaoTierForHours(hours) {
    return getSalaoTiers().then(function (tiers) {
      return tiers.find(function (t) { return parseFloat(t.duration_hours) === hours; }) || null;
    });
  }

  function getAulaTiers() {
    return window.sb.from('salao_aula_tiers').select('*').eq('active', true)
      .then(function (res) { return res.data || []; });
  }

  function getAulaSuggestion(classesPerWeek) {
    return getAulaTiers().then(function (tiers) {
      return tiers.find(function (t) { return t.classes_per_week === classesPerWeek; }) || null;
    });
  }

  function getPackageTiers(roomGroup) {
    return window.sb.from('sala_hour_package_tiers').select('*')
      .eq('room_group', roomGroup).eq('active', true).order('sort_order')
      .then(function (res) { return res.data || []; });
  }

  function getAvulsaRate(roomGroup) {
    return getPackageTiers(roomGroup).then(function (tiers) {
      return tiers.find(function (t) { return t.package_type === 'avulsa'; }) || null;
    });
  }

  function getPeriodTiers(roomGroup) {
    return window.sb.from('sala_period_tiers').select('*')
      .eq('room_group', roomGroup).eq('active', true).order('sort_order')
      .then(function (res) { return res.data || []; });
  }

  function getMarginalRates(roomGroup) {
    return window.sb.from('sala_marginal_rates').select('*')
      .eq('room_group', roomGroup).eq('active', true).order('band_from_hours')
      .then(function (res) { return res.data || []; });
  }

  // Active, unexpired hour packages for a client in a given room group,
  // with remaining balance > 0.
  function getActivePackagesForClient(clientId, roomGroup) {
    if (!clientId) return Promise.resolve([]);
    return window.sb.from('client_hour_packages').select('*')
      .eq('client_id', clientId)
      .eq('room_group', roomGroup)
      .eq('active', true)
      .gt('hours_remaining', 0)
      .gt('expires_at', new Date().toISOString())
      .order('expires_at')
      .then(function (res) { return res.data || []; });
  }

  window.Pricing = {
    getSalaoTiers: getSalaoTiers,
    getSalaoTierForHours: getSalaoTierForHours,
    getAulaTiers: getAulaTiers,
    getAulaSuggestion: getAulaSuggestion,
    getPackageTiers: getPackageTiers,
    getAvulsaRate: getAvulsaRate,
    getPeriodTiers: getPeriodTiers,
    getMarginalRates: getMarginalRates,
    getActivePackagesForClient: getActivePackagesForClient
  };

})();
