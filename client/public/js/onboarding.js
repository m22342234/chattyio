/**
 * Onboarding module — runs on index.html.
 *
 * Responsibilities:
 *  1. Populate country / region dependent dropdowns from geoData.js
 *  2. Validate username against all guardrails (digits, word-numbers, blocked substrings)
 *  3. Validate age, gender, location selections
 *  4. Collect the Cloudflare Turnstile token once the widget resolves
 *  5. On submit: honeypot check, then store validated profile in sessionStorage
 *     and redirect to /chat
 */

'use strict';

// ─── DOM References ───────────────────────────────────────────────────────────
const form         = document.getElementById('onboarding-form');
const usernameEl   = document.getElementById('username');
const ageEl        = document.getElementById('age');
const genderEl     = document.getElementById('gender');
const countryEl    = document.getElementById('country');
const regionEl     = document.getElementById('region');
const honeypotEl   = document.getElementById('honeypot-field');
const termsEl      = document.getElementById('terms-check');
const submitBtn    = document.getElementById('submit-btn');
const errorEl      = document.getElementById('form-error');

// ─── Dev / Test Key Detection ─────────────────────────────────────────────────
// Cloudflare test site keys all start with "1x000" or "2x000".
// When detected, skip Turnstile entirely so local dev never blocks on it.
const CF_TEST_SITEKEYS = ['1x00000000000000000000AA', '2x00000000000000000000AB', '3x00000000000000000000FF'];
const IS_DEV_KEY = CF_TEST_SITEKEYS.includes(window.APP_CONFIG?.cfSiteKey);

// ─── Turnstile Token Storage ──────────────────────────────────────────────────
// In dev mode we use a known bypass sentinel; the server accepts any value when
// the test secret is configured.
let cfToken = IS_DEV_KEY ? 'dev-bypass' : null;

/** Called by the Turnstile widget once it resolves */
window.onTurnstileSuccess = function (token) {
  cfToken = token;
  submitBtn.disabled = false;
  submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
};

window.onTurnstileExpire = function () {
  cfToken = null;
  submitBtn.disabled = true;
  submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
};

// ─── Username Guardrails ──────────────────────────────────────────────────────
const RE_DIGIT    = /\d/;
const RE_WORD_NUM = /\b(zero|one|two|three|four|five|six|seven|eight|nine)\b/i;
const RE_BLOCKED  = /(porn|escort|pedo|pdo|adult|sex|nsfw)/i;

function validateUsername(name) {
  const t = (name || '').trim();
  if (t.length < 2)             return 'Username must be at least 2 characters.';
  if (t.length > 20)            return 'Username must be 20 characters or fewer.';
  if (RE_DIGIT.test(t))         return 'Username cannot contain numbers.';
  if (RE_WORD_NUM.test(t))      return 'Username cannot contain spelled-out numbers.';
  if (RE_BLOCKED.test(t))       return 'That username is not permitted.';
  return null; // valid
}

// ─── Populate Country Dropdown ────────────────────────────────────────────────
function populateCountries() {
  countryEl.innerHTML = '<option value="">Select country…</option>';
  COUNTRY_LIST.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    countryEl.appendChild(opt);
  });
}

// ─── Populate Region Dropdown (dependent on country) ─────────────────────────
function populateRegions(country) {
  regionEl.innerHTML = '<option value="">Select region…</option>';
  const regions = GEO_DATA[country] || [];
  if (regions.length === 0 || (regions.length === 1 && regions[0] === 'N/A')) {
    const opt = document.createElement('option');
    opt.value = 'N/A';
    opt.textContent = 'N/A';
    regionEl.appendChild(opt);
    regionEl.value    = 'N/A';
    regionEl.disabled = true;
    return;
  }
  regionEl.disabled = false;
  regions.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = r;
    regionEl.appendChild(opt);
  });
}

countryEl.addEventListener('change', () => {
  populateRegions(countryEl.value);
});

// ─── Populate Age Dropdown ────────────────────────────────────────────────────
function populateAges() {
  ageEl.innerHTML = '<option value="">Age…</option>';
  for (let a = 18; a <= 99; a++) {
    const opt = document.createElement('option');
    opt.value = a;
    opt.textContent = a;
    ageEl.appendChild(opt);
  }
}

// ─── Show Inline Error ────────────────────────────────────────────────────────
function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
  errorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearError() {
  errorEl.textContent = '';
  errorEl.classList.add('hidden');
}

// ─── Form Submit Handler ──────────────────────────────────────────────────────
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  // 1. Honeypot check (client mirror — server will also check)
  if (honeypotEl && honeypotEl.value.trim().length > 0) {
    // Silent: just stop. Do not tell bots why.
    return;
  }

  // 2. Terms acceptance
  if (!termsEl.checked) {
    return showError('You must accept the Terms of Service to continue.');
  }

  // 3. Username
  const usernameError = validateUsername(usernameEl.value);
  if (usernameError) return showError(usernameError);

  // 4. Age
  const age = parseInt(ageEl.value, 10);
  if (!ageEl.value || isNaN(age) || age < 18 || age > 99) {
    return showError('Please select a valid age (18–99).');
  }

  // 5. Gender
  if (!genderEl.value) return showError('Please select a gender.');

  // 6. Country
  if (!countryEl.value) return showError('Please select a country.');

  // 7. Region (allow N/A but require a selection)
  if (!regionEl.value)  return showError('Please select a region.');

  // 8. Turnstile
  if (!cfToken) return showError('Please complete the security verification.');

  // All checks passed — persist to sessionStorage and navigate to chat
  const profile = {
    username: usernameEl.value.trim(),
    age,
    gender:   genderEl.value,
    country:  countryEl.value,
    region:   regionEl.value,
    cfToken,
    back_email: '', // honeypot — always empty when the user fills the form
  };
  sessionStorage.setItem('chatProfile', JSON.stringify(profile));
  window.location.href = '/chat';
});

// ─── Init ─────────────────────────────────────────────────────────────────────
(function init() {
  populateAges();
  populateCountries();

  if (IS_DEV_KEY) {
    // Dev/test mode: Turnstile widget is cosmetic; form is always submittable
    const widget = document.getElementById('cf-turnstile-widget');
    if (widget) {
      widget.innerHTML =
        '<div style="font-size:11px;color:#6b7280;padding:8px;border:1px solid #374151;border-radius:6px;text-align:center">🔒 Security check bypassed (dev mode)</div>';
    }
    // Button already enabled because cfToken = 'dev-bypass'
  } else {
    // Production: disable submit until Turnstile widget resolves
    submitBtn.disabled = true;
    submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
  }
})();
