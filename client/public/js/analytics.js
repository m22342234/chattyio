'use strict';
(function () {
  var token = window.APP_CONFIG && window.APP_CONFIG.cfAnalyticsToken;
  if (!token) return;
  var s = document.createElement('script');
  s.defer = true;
  s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  s.setAttribute('data-cf-beacon', JSON.stringify({ token: token }));
  document.head.appendChild(s);
}());
