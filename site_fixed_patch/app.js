/*
 * Wrapper file for Wanderlust Demo App
 *
 * This project originally shipped with a JavaScript file whose filename
 * included a timestamp (e.g. ``app 10.20.58.js``). All of the HTML
 * templates expect to load a script named ``app.js``, so without this
 * wrapper the business logic never runs and the interface feels broken.
 *
 * To fix this without editing every HTML file by hand, we provide
 * ``app.js`` as an entry point that simply includes the contents of
 * the original file. If the original file is moved or renamed in
 * future builds, you only need to update the import here.
 */

// Import the full application logic. Note: in a static browser
// environment there is no module system, so we embed the contents of
// the original file directly instead of using import/export. The
// following immediately‑invoked function expression (IIFE) wraps the
// original code in its own scope to avoid leaking variables.
(function(){

/* START OF ORIGINAL APP CODE */

// ---------- Utilities ----------
const qs  = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const on  = (el, ev, cb, opts) => el && el.addEventListener(ev, cb, opts);

/**
 * Perform a stable merge sort on the provided array using the supplied
 * comparison callback.  The original array remains untouched; a new sorted
 * array is returned.  This implementation avoids Array.prototype.sort so the
 * application retains full control over ordering logic regardless of the
 * execution environment.
 *
 * @template T
 * @param {T[]} array The values to sort
 * @param {(a: T, b: T) => number} [compareFn] Comparison function returning
 *   a negative number when `a` comes before `b`, zero when equal, and a
 *   positive number otherwise.  Defaults to lexicographic comparison.
 * @returns {T[]} A new array containing the sorted values
 */
function mergeSort(array, compareFn) {
  if (!Array.isArray(array)) return [];
  const comparator = typeof compareFn === 'function'
    ? compareFn
    : (a, b) => {
        const aStr = String(a);
        const bStr = String(b);
        if (aStr === bStr) return 0;
        return aStr > bStr ? 1 : -1;
      };

  function merge(left, right) {
    const merged = [];
    let i = 0;
    let j = 0;
    while (i < left.length && j < right.length) {
      if (comparator(left[i], right[j]) <= 0) {
        merged.push(left[i]);
        i += 1;
      } else {
        merged.push(right[j]);
        j += 1;
      }
    }
    while (i < left.length) {
      merged.push(left[i]);
      i += 1;
    }
    while (j < right.length) {
      merged.push(right[j]);
      j += 1;
    }
    return merged;
  }

  function sort(items) {
    if (items.length <= 1) {
      return items;
    }
    const mid = Math.floor(items.length / 2);
    const left = sort(items.slice(0, mid));
    const right = sort(items.slice(mid));
    return merge(left, right);
  }

  return sort(array.slice());
}

/**
 * Attach an event listener that replaces any previously registered handler for
 * the same element, event name and key.  This keeps wiring idempotent so pages
 * can safely call their setup functions multiple times (for example after a
 * `pageshow` event) without accumulating duplicate listeners that fire more
 * than once.
 *
 * @param {EventTarget} el The element to bind the listener to
 * @param {string} ev The event name (e.g. "click")
 * @param {Function} cb The handler function to invoke
 * @param {string} [key=''] Optional suffix to distinguish multiple handlers on the same element/event
 */
function bindEventOnce(el, ev, cb, key = '') {
  if (!el) return;
  const token = `_wlHandler_${ev}_${key || 'default'}`;
  if (el[token]) {
    el.removeEventListener(ev, el[token]);
  }
  el[token] = cb;
  el.addEventListener(ev, cb);
}

const store = {
  get(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  },
  remove(key) {
    localStorage.removeItem(key);
  }
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function toDateOnly(value) {
  if (!value && value !== 0) return null;
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]) - 1;
      const day = Number(match[3]);
      if (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(day)) {
        return new Date(year, month, day);
      }
    }
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDateInput(date) {
  const d = toDateOnly(date);
  if (!d) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const KEY_USERS = "wl_users";                  // [{email, name, passHash}]
const KEY_SESSION = "wl_session";              // {email}
const tripsKey = (email) => `wl_trips_${email}`;        // [{...trip}]
const expensesKey = (tripId) => `wl_exp_${tripId}`;     // [{...expense}]
const expensesDirtyKey = (tripId) => `wl_exp_dirty_${tripId}`; // boolean dirty flag
const remindersKey = (email) => `wl_rem_${email}`;      // [{...reminder}]
const selectedTripKey = (email) => `wl_selected_trip_${email}`; // last chosen trip id
const packingKey = (tripId) => `wl_pack_${tripId}`;     // [{...packing item}]

// Keep a record of recently viewed trip IDs for each user.  This queue stores
// up to the last five trips visited on the budget page.  It is used on the
// homepage to provide quick access to recently viewed vacations.  The queue
// persists in localStorage under a per‑user key and is implemented with
// typical enqueue/dequeue semantics.  New trips are added to the front and
// duplicates are removed prior to insertion.
const recentKey = (email) => `wl_recent_${email}`;

const DESTINATION_CACHE_KEY = 'wl_destination_cache_v1';
const destinationInsightState = {
  tripId: null,
  suggestions: [],
  email: null,
};

const COUNTRY_NAME_ALIASES = {
  UK: 'United Kingdom',
  'U.K.': 'United Kingdom',
  'U.K': 'United Kingdom',
  'United Kingdom of Great Britain': 'United Kingdom',
  USA: 'United States',
  'U.S.': 'United States',
  'U.S': 'United States',
  'United States of America': 'United States',
  UAE: 'United Arab Emirates',
  'U.A.E.': 'United Arab Emirates',
  'U.A.E': 'United Arab Emirates',
  'Republic of Korea': 'South Korea',
  'Korea, South': 'South Korea',
  'Korea (South)': 'South Korea',
  'Korea Republic': 'South Korea',
  'Korea, North': 'North Korea',
  'Korea (North)': 'North Korea',
  PRC: 'China',
  'P.R.C.': 'China',
  'People\'s Republic of China': 'China',
  'Russian Federation': 'Russia',
  'Hong Kong SAR': 'Hong Kong',
  'Macao SAR': 'Macau',
  'Czechia': 'Czech Republic',
  'Viet Nam': 'Vietnam',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* Weather insight helpers removed. */

function sanitiseLocation(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function guessCountryQuery(location) {
  const cleaned = sanitiseLocation(location);
  if (!cleaned) return null;
  const parts = cleaned.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  let candidate = parts[parts.length - 1];
  if (/^[A-Z]{2,3}$/i.test(candidate)) {
    candidate = candidate.toUpperCase();
  }
  return COUNTRY_NAME_ALIASES[candidate] || candidate;
}

function rememberDestinationCache(cacheKey, data) {
  if (!cacheKey) return;
  const cache = store.get(DESTINATION_CACHE_KEY, {}) || {};
  cache[cacheKey] = { data, timestamp: Date.now() };
  const trimmed = Object.entries(cache)
    .sort((a, b) => (b[1]?.timestamp || 0) - (a[1]?.timestamp || 0))
    .slice(0, 20)
    .reduce((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {});
  store.set(DESTINATION_CACHE_KEY, trimmed);
}

async function fetchWikipediaSummaryForLocation(location) {
  const cleaned = sanitiseLocation(location);
  if (!cleaned) return null;
  const queries = [cleaned];
  const parts = cleaned.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (!queries.includes(last)) {
      queries.push(last);
    }
  }

  let lastError = null;
  for (const query of queries) {
    const slug = encodeURIComponent(query);
    if (!slug) continue;
    try {
      const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`, {
        headers: { Accept: 'application/json' },
      });
      if (res.status === 404) {
        continue;
      }
      if (!res.ok) {
        throw new Error(`Summary request failed with status ${res.status}`);
      }
      const json = await res.json();
      if (!json || typeof json !== 'object') {
        continue;
      }
      if (json.type === 'disambiguation') {
        continue;
      }
      if (json.extract || json.description) {
        return {
          title: json.title || query,
          extract: json.extract || json.description || '',
          url: json.content_urls?.desktop?.page || json.content_urls?.mobile?.page || '',
          image: json.thumbnail?.source || json.originalimage?.source || '',
        };
      }
    } catch (err) {
      lastError = err;
      break;
    }
  }
  if (lastError) {
    throw lastError;
  }
  return null;
}

async function fetchCountryDetails(location) {
  const query = guessCountryQuery(location);
  if (!query) return null;
  const slug = encodeURIComponent(query);
  const url = `https://restcountries.com/v3.1/name/${slug}?fields=name,capital,currencies,languages,region,subregion,population,flags,timezones,idd,car,tld`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`Country lookup failed with status ${res.status}`);
  }
  const json = await res.json();
  if (!Array.isArray(json) || json.length === 0) {
    return null;
  }
  const lowerQuery = query.toLowerCase();
  const match = json.find((entry) => {
    const common = entry?.name?.common ? String(entry.name.common).toLowerCase() : '';
    const official = entry?.name?.official ? String(entry.name.official).toLowerCase() : '';
    return common === lowerQuery || official === lowerQuery;
  }) || json[0];

  const currencies = Object.entries(match?.currencies || {}).map(([code, info]) => ({
    code,
    name: info?.name || code,
    symbol: info?.symbol || '',
  }));
  const languages = Object.values(match?.languages || {}).map((lang) => String(lang));
  const callingCode = (() => {
    const root = match?.idd?.root || '';
    const suffix = Array.isArray(match?.idd?.suffixes) && match.idd.suffixes.length > 0
      ? match.idd.suffixes[0]
      : '';
    const joined = `${root || ''}${suffix || ''}`.trim();
    if (!joined) return '';
    return joined.startsWith('+') ? joined : `+${joined}`;
  })();

  return {
    name: match?.name?.common || query,
    officialName: match?.name?.official || '',
    capital: Array.isArray(match?.capital) && match.capital.length > 0 ? match.capital[0] : '',
    region: match?.region || '',
    subregion: match?.subregion || '',
    population: Number.isFinite(match?.population) ? match.population : null,
    currencies,
    languages,
    timezones: Array.isArray(match?.timezones) ? match.timezones : [],
    callingCode,
    drivingSide: match?.car?.side || '',
    flagSvg: match?.flags?.svg || '',
    flagPng: match?.flags?.png || '',
    tlds: Array.isArray(match?.tld) ? match.tld : [],
  };
}

async function fetchDestinationInsights(trip) {
  const location = sanitiseLocation(trip?.location || '');
  if (!location) {
    return null;
  }

  const cacheKey = location.toLowerCase();
  const cache = store.get(DESTINATION_CACHE_KEY, {}) || {};
  const cached = cache[cacheKey];
  const TWELVE_HOURS = 1000 * 60 * 60 * 12;
  if (cached && Date.now() - Number(cached.timestamp || 0) < TWELVE_HOURS) {
    return cached.data;
  }

  try {
    const [summary, country] = await Promise.all([
      fetchWikipediaSummaryForLocation(location),
      fetchCountryDetails(location),
    ]);
    const data = { location, summary, country };
    rememberDestinationCache(cacheKey, data);
    return data;
  } catch (err) {
    console.error('Destination insights fetch failed:', err);
    if (cached?.data) {
      return cached.data;
    }
    throw err;
  }
}

function formatCurrencyList(country) {
  const list = Array.isArray(country?.currencies) ? country.currencies : [];
  if (list.length === 0) return '';
  return list.map((curr) => {
    const symbol = curr.symbol ? ` (${curr.symbol})` : '';
    return curr.name ? `${curr.name}${symbol}` : curr.code;
  }).filter(Boolean).join(', ');
}

function formatLanguageList(country) {
  const list = Array.isArray(country?.languages) ? country.languages : [];
  if (list.length === 0) return '';
  return list.join(', ');
}

function renderDestinationCard(container, insights, trip) {
  if (!container) return;
  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'space-y-4';

  const header = document.createElement('div');
  header.className = 'flex items-start gap-3';
  const badge = document.createElement('div');
  badge.className = 'w-12 h-12 rounded-full bg-primary/10 dark:bg-primary/20 flex items-center justify-center overflow-hidden';
  const country = insights?.country;
  if (country?.flagPng || country?.flagSvg) {
    const flag = document.createElement('img');
    flag.src = country.flagSvg || country.flagPng;
    flag.alt = country?.name ? `Flag of ${country.name}` : 'Destination flag';
    flag.className = 'w-full h-full object-cover';
    badge.appendChild(flag);
  } else {
    const icon = document.createElement('span');
    icon.className = 'text-2xl';
    icon.textContent = '🌍';
    badge.appendChild(icon);
  }

  const titleWrap = document.createElement('div');
  const label = document.createElement('p');
  label.className = 'text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400';
  label.textContent = 'Destination snapshot';
  const title = document.createElement('p');
  title.className = 'text-lg font-semibold text-slate-900 dark:text-white';
  const summaryTitle = insights?.summary?.title || trip?.name || trip?.location || 'Your destination';
  title.textContent = summaryTitle;
  const subtitle = document.createElement('p');
  subtitle.className = 'text-sm text-slate-500 dark:text-slate-400';
  subtitle.textContent = country?.name || sanitiseLocation(trip?.location) || 'Upcoming adventure';
  titleWrap.append(label, title, subtitle);
  header.append(badge, titleWrap);

  const summaryText = document.createElement('p');
  summaryText.className = 'text-sm text-slate-600 dark:text-slate-300';
  summaryText.textContent = insights?.summary?.extract || 'We\'re gathering quick facts to help you get ready.';
  wrap.append(header, summaryText);

  if (insights?.summary?.url) {
    const link = document.createElement('a');
    link.href = insights.summary.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'inline-flex items-center gap-1 text-sm text-primary hover:underline';
    link.textContent = 'Read more on Wikipedia';
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined text-sm';
    icon.textContent = 'open_in_new';
    link.appendChild(icon);
    wrap.appendChild(link);
  }

  const detailList = document.createElement('ul');
  detailList.className = 'grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-slate-700 dark:text-slate-200';

  const addDetail = (labelText, valueText) => {
    if (!valueText) return;
    const item = document.createElement('li');
    item.className = 'flex items-start justify-between gap-2';
    const labelEl = document.createElement('span');
    labelEl.className = 'font-medium text-slate-600 dark:text-slate-300';
    labelEl.textContent = labelText;
    const valueEl = document.createElement('span');
    valueEl.className = 'text-right';
    valueEl.textContent = valueText;
    item.append(labelEl, valueEl);
    detailList.appendChild(item);
  };

  addDetail('Capital', country?.capital || '');
  addDetail('Region', country?.subregion || country?.region || '');
  addDetail('Currencies', formatCurrencyList(country));
  addDetail('Languages', formatLanguageList(country));
  addDetail('Time zone', Array.isArray(country?.timezones) && country.timezones.length > 0 ? country.timezones[0] : '');
  if (Number.isFinite(country?.population) && country.population > 0) {
    addDetail('Population', country.population.toLocaleString());
  }
  if (country?.callingCode) {
    addDetail('Dialling code', country.callingCode);
  }

  if (detailList.childElementCount > 0) {
    wrap.appendChild(detailList);
  }

  const source = document.createElement('p');
  source.className = 'text-xs text-slate-400 dark:text-slate-500';
  source.textContent = 'Information provided by Wikipedia and REST Countries.';
  wrap.appendChild(source);

  container.appendChild(wrap);
}

function buildDestinationPackingSuggestions(insights, trip) {
  const suggestions = new Set(['Travel documents', 'Portable charger', 'Reusable water bottle']);
  const country = insights?.country || {};
  const currencies = Array.isArray(country.currencies) ? country.currencies : [];
  if (currencies.length > 0) {
    const names = currencies.map((curr) => curr.name || curr.code).filter(Boolean);
    if (names.length > 0) {
      suggestions.add(`Local cash (${names.join(', ')})`);
    }
  }

  const languages = Array.isArray(country.languages) ? country.languages : [];
  const speaksEnglish = languages.some((lang) => /english/i.test(lang));
  if (languages.length > 0 && !speaksEnglish) {
    suggestions.add(`Phrasebook or translation app (${languages[0]})`);
  }

  if (country.region && !/americas/i.test(country.region)) {
    suggestions.add('Universal power adapter');
  }

  if (country.drivingSide === 'left') {
    suggestions.add('International driving permit');
  }

  if (country.callingCode) {
    suggestions.add(`Emergency contact card (${country.callingCode})`);
  }

  if (insights?.summary?.title) {
    suggestions.add(`Travel guide for ${insights.summary.title}`);
  }

  const tripName = trip?.name || trip?.location;
  if (tripName && tripName.length > 20) {
    suggestions.add('Printed itinerary and reservation copies');
  }

  return Array.from(suggestions);
}

function renderTravelTips(container, suggestions, trip) {
  if (!container) return;
  container.innerHTML = '';

  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'text-sm opacity-70';
    msg.textContent = 'Add an upcoming trip to see personalised travel tips.';
    container.appendChild(msg);
    return;
  }

  const tripName = trip?.name || trip?.location;
  const intro = document.createElement('p');
  intro.className = 'text-sm text-slate-600 dark:text-slate-300';
  intro.textContent = tripName
    ? `Travel prep suggestions for ${tripName}:`
    : 'Travel prep suggestions for your trip:';
  container.appendChild(intro);

  const list = document.createElement('ul');
  list.className = 'space-y-2';
  suggestions.forEach((suggestion) => {
    const item = document.createElement('li');
    item.className = 'flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200';
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined text-primary text-base';
    icon.textContent = 'check_circle';
    const text = document.createElement('span');
    text.textContent = suggestion;
    item.append(icon, text);
    list.appendChild(item);
  });
  container.appendChild(list);
}

function applySmartPackingSuggestions(tripId, suggestions) {
  if (!tripId || !Array.isArray(suggestions) || suggestions.length === 0) {
    return 0;
  }
  const existing = getPackingItems(tripId);
  const existingNames = new Set(existing.map((item) => (item?.name || '').toLowerCase()));
  let added = 0;
  const updated = [...existing];
  suggestions.forEach((name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (existingNames.has(key)) return;
    existingNames.add(key);
    updated.push({ id: uid('pack'), name: trimmed, packed: false, smart: true });
    added += 1;
  });
  if (added > 0) {
    savePackingItems(tripId, updated);
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent('wl:packing-updated', {
          detail: { tripId, source: 'smart-suggestions' }
        }));
      } catch (err) {
        console.error('Failed to broadcast packing update event:', err);
      }
    }
  }
  return added;
}
function getRecentTrips(email) {
  return store.get(recentKey(email), []) || [];
}
function setRecentTrips(email, arr) {
  store.set(recentKey(email), arr);
}
/**
 * Add a trip ID to the front of the user's recent trip queue.  If the trip
 * already exists in the queue it is removed before the new insertion.  The
 * queue is truncated to a maximum length of 5.  This function is called
 * whenever a budget page is loaded for a trip.
 *
 * @param {string} email The user email
 * @param {string} tripId The trip identifier
 */
function addRecentTrip(email, tripId) {
  if (!email || !tripId) return;
  let queue = getRecentTrips(email);
  // Remove existing occurrences
  queue = queue.filter(id => id !== tripId);
  // Add to front
  queue.unshift(tripId);
  // Limit to five entries
  if (queue.length > 5) {
    queue = queue.slice(0, 5);
  }
  setRecentTrips(email, queue);
}

function removeRecentTrip(email, tripId) {
  if (!email || !tripId) return;
  const queue = getRecentTrips(email).filter(id => id !== tripId);
  setRecentTrips(email, queue);
}

// Retrieve an array of reminders for a user from localStorage.  Supabase
// is the source of truth for reminders; local storage acts as a cache
// after syncFromSupabase() runs.  Returns an empty array when no
// reminders exist.  Do not modify the returned array directly.
function getReminders(email) {
  const stored = store.get(remindersKey(email), []) || [];
  const { items, mutated } = normaliseReminders(stored);
  if (mutated && email) {
    store.set(remindersKey(email), items);
    const sess = getSession();
    if (sess?.email === email) {
      writeRemindersToSupabase(email, items);
    }
  }
  return items;
}

function saveReminders(email, reminders) {
  if (!email) return;
  const { items } = normaliseReminders(reminders);
  store.set(remindersKey(email), items);
  writeRemindersToSupabase(email, items);
}

// Retrieve all expenses for a specific trip from localStorage.  Returns
// an empty array if none are present.  Supabase is the persistent
// backend and local storage acts as a cache after syncFromSupabase().
function getExpenses(tripId) {
  // Guard against falsy/undefined IDs so we never read from a key such as
  // "wl_exp_undefined".  When no trip is selected we treat the expenses list
  // as empty and avoid polluting localStorage with phantom records.
  if (!tripId) {
    return [];
  }
  return store.get(expensesKey(tripId), []) || [];
}

/*
 * ReminderTree implements a simple binary search tree keyed by the
 * reminder date.  Each node stores a reminder object (containing
 * id, tripId, name, date) and left/right children.  The tree is
 * ordered by the ISO date string of the reminder.  Using a binary
 * tree allows efficient insertion and retrieval of reminders in
 * chronological order via an in‑order traversal.  Although JavaScript
 * arrays could be used directly, this demonstrates a dynamic data
 * structure as requested.
 */
class ReminderTree {
  constructor() {
    this.root = null;
  }
  insert(rem) {
    const iso = rem?.date || '';
    function _insert(node, value) {
      if (!node) return { value, left: null, right: null };
      if (value.date < node.value.date) {
        node.left = _insert(node.left, value);
      } else {
        node.right = _insert(node.right, value);
      }
      return node;
    }
    this.root = _insert(this.root, rem);
  }
  // Perform an in‑order traversal and invoke the callback on each reminder
  inOrder(callback) {
    function _traverse(node) {
      if (!node) return;
      _traverse(node.left);
      callback(node.value);
      _traverse(node.right);
    }
    _traverse(this.root);
  }
}

// ---------- Supabase Helpers ----------
// If the firebase-init.js script has been loaded, the global window
// object will contain a firebaseDb instance and a firebaseFirestore
// helper namespace.  These helpers wrap Firestore functions.  All
// Firestore writes are performed asynchronously but are not awaited
// from calling contexts.  This avoids blocking the UI while still
// persisting data to the backend.  In case of any errors during
// Firestore operations, they are logged to the console for
// debugging.

/**
 * Persist a newly registered user to Supabase.  The user record is
 * stored in the `users` table with the email as the primary key.  If
 * the record already exists it will be merged.  This function
 * supersedes the original Firestore implementation; the name is
 * preserved only for backwards compatibility with existing calls.
 *
 * @param {Object} user { email, name, passHash, createdAt }
 */
async function writeUserToSupabase(user) {
  const supabase = window.supabaseClient;
  if (!supabase) return;
  try {
    const { error } = await supabase.from('users').upsert(user);
    if (error) {
      throw error;
    }
  } catch (err) {
    console.error('Error writing user to Supabase:', err);
    throw err;
  }
}

async function readTripsFromSupabase(email) {
  /**
   * Retrieve all trips for a given user from Supabase.
   *
   * Returns an array of trip objects stored under the `trips` table
   * where the `email` column matches the provided email.  If no
   * Supabase client has been initialised, an empty array is returned.
   *
   * @param {string} email The user's email address
   * @returns {Promise<Array<Object>>} Array of trip objects
   */
  const supabase = window.supabaseClient;
  if (!supabase || !email) return [];
  try {
    const { data, error } = await supabase.from('trips').select().eq('email', email);
    if (error) {
      console.error('Error reading trips from Supabase:', error);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.error('Error reading trips from Supabase:', err);
    return [];
  }
}

async function readExpensesFromSupabase(email, tripId) {
  /**
   * Retrieve all expenses for a given trip from Supabase.
   *
   * Queries the `expenses` table for rows where both the `trip_id`
   * and `email` columns match the provided arguments.  If no
   * Supabase client has been initialised, an empty array is returned.
   *
   * @param {string} email The user's email address
   * @param {string} tripId The ID of the trip to fetch expenses for
   * @returns {Promise<Array<Object>>} Array of expense objects
   */
  const supabase = window.supabaseClient;
  if (!supabase || !tripId) return null;
  try {
    const { data, error } = await supabase
      .from('expenses')
      .select()
      .match({ email: email, trip_id: tripId });
    if (error) {
      console.error('Error reading expenses from Supabase:', error);
      return null;
    }
    return data ?? [];
  } catch (err) {
    console.error('Error reading expenses from Supabase:', err);
    return null;
  }
}

async function readRemindersFromSupabase(email) {
  /**
   * Retrieve all reminders for a given user from Supabase.
   *
   * Queries the `reminders` table for rows where the `email` column
   * matches the provided email.  If no Supabase client has been
   * initialised, `null` is returned.  Only reminders created
   * by this user are returned; filtering by trip id is done in
   * wireRemindersPage().
   *
   * @param {string} email The user's email address
   * @returns {Promise<Array<Object>>} Array of reminder objects
   */
  const supabase = window.supabaseClient;
  if (!supabase || !email) return null;
  try {
    const { data, error } = await supabase.from('reminders').select().eq('email', email);
    if (error) {
      console.error('Error reading reminders from Supabase:', error);
      return null;
    }
    return data ?? [];
  } catch (err) {
    console.error('Error reading reminders from Supabase:', err);
    return null;
  }
}

async function readPackingFromSupabase(email, tripId) {
  /**
   * Retrieve packing list items for a given trip from Supabase.
   *
   * Each row is expected to include at least an item identifier,
   * the owning user's email and the associated trip id.  If the
   * Supabase client has not been initialised or the query fails,
   * `null` is returned so that local functionality can continue using
   * any cached data without clearing it.
   *
   * @param {string} email The user's email address
   * @param {string} tripId The ID of the trip whose packing items are requested
   * @returns {Promise<Array<Object>>} Array of packing item objects
   */
  const supabase = window.supabaseClient;
  if (!supabase || !email || !tripId) return null;
  try {
    const { data, error } = await supabase
      .from('packing')
      .select()
      .match({ email, trip_id: tripId });
    if (error) {
      console.error('Error reading packing items from Supabase:', error);
      return null;
    }
    if (!Array.isArray(data)) {
      return [];
    }
    return data
      .map(normalizePackingItemFromSupabase)
      .filter(Boolean);
  } catch (err) {
    console.error('Error reading packing items from Supabase:', err);
    return null;
  }
}

function normalizeTripFromSupabase(trip) {
  if (!trip || typeof trip !== 'object') return null;
  const normalized = { ...trip };
  if (normalized.start_date && !normalized.startDate) normalized.startDate = normalized.start_date;
  if (normalized.end_date && !normalized.endDate) normalized.endDate = normalized.end_date;
  if (normalized.created_at && !normalized.createdAt) normalized.createdAt = normalized.created_at;
  if (normalized.updated_at && !normalized.updatedAt) normalized.updatedAt = normalized.updated_at;
  delete normalized.start_date;
  delete normalized.end_date;
  delete normalized.created_at;
  delete normalized.updated_at;

  if (!normalized.days && normalized.startDate && normalized.endDate) {
    const startTime = new Date(normalized.startDate).getTime();
    const endTime = new Date(normalized.endDate).getTime();
    if (Number.isFinite(startTime) && Number.isFinite(endTime)) {
      const msPerDay = 1000 * 60 * 60 * 24;
      const span = Math.round((endTime - startTime) / msPerDay) + 1;
      normalized.days = Math.max(1, span);
    }
  }
  return normalized;
}

function serializeTripForSupabase(trip, email) {
  if (!trip || typeof trip !== 'object' || !trip.id || !email) {
    return null;
  }

  const payload = { ...trip, email };
  const mappings = [
    ['startDate', 'start_date'],
    ['endDate', 'end_date'],
    ['createdAt', 'created_at'],
    ['updatedAt', 'updated_at']
  ];

  mappings.forEach(([camel, snake]) => {
    if (camel in payload) {
      if (payload[camel] != null && payload[snake] == null) {
        payload[snake] = payload[camel];
      }
      delete payload[camel];
    }
  });

  if ('cost' in payload) {
    const costNum = Number(payload.cost);
    payload.cost = Number.isFinite(costNum) ? costNum : null;
  }

  return payload;
}

function tripTimestamp(trip) {
  if (!trip) return 0;
  const candidates = [trip.updatedAt, trip.createdAt, trip.updated_at, trip.created_at];
  for (const value of candidates) {
    if (!value) continue;
    const ts = new Date(value).getTime();
    if (Number.isFinite(ts)) return ts;
  }
  return 0;
}

function normalizeReminderFromSupabase(reminder) {
  if (!reminder || typeof reminder !== 'object') return null;
  const normalized = { ...reminder };
  if (normalized.trip_id && !normalized.tripId) normalized.tripId = normalized.trip_id;
  if (normalized.created_at && !normalized.createdAt) normalized.createdAt = normalized.created_at;
  if (normalized.updated_at && !normalized.updatedAt) normalized.updatedAt = normalized.updated_at;
  const completed = Boolean(normalized.completed);
  if (normalized.completed !== completed) normalized.completed = completed;
  delete normalized.trip_id;
  delete normalized.created_at;
  delete normalized.updated_at;
  return normalized;
}

function serializeReminderForSupabase(reminder, email) {
  if (!reminder || typeof reminder !== 'object' || !email) return null;

  const id = (() => {
    const candidates = [reminder.id, reminder.reminderId];
    for (const candidate of candidates) {
      if (candidate == null) continue;
      const str = String(candidate).trim();
      if (str) return str;
    }
    return uid('rem');
  })();

  const tripId = (() => {
    const candidates = [reminder.trip_id, reminder.tripId];
    for (const candidate of candidates) {
      if (candidate == null) continue;
      const str = String(candidate).trim();
      if (str) return str;
    }
    return '';
  })();

  if (!tripId) return null;

  const name = typeof reminder.name === 'string' ? reminder.name.trim() : '';
  const dateValue = typeof reminder.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(reminder.date)
    ? reminder.date
    : formatDateInput(reminder.date || new Date());

  const payload = {
    id,
    email,
    trip_id: tripId,
    name: name || 'Reminder',
    date: dateValue || formatDateInput(new Date())
  };

  if (typeof reminder.completed !== 'undefined') {
    payload.completed = Boolean(reminder.completed);
  }

  return payload;
}

function serializePackingItemForSupabase(item, email, tripId) {
  if (!item || typeof item !== 'object' || !email || !tripId) return null;
  const id = (() => {
    if (item.id != null) {
      const str = String(item.id).trim();
      if (str) return str;
    }
    return uid('pack');
  })();
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  const allowedImportance = new Set(['essential', 'useful', 'optional']);
  let importance = typeof item.importance === 'string' ? item.importance.toLowerCase() : '';
  if (!allowedImportance.has(importance)) {
    importance = 'useful';
  }

  return {
    id,
    email,
    trip_id: String(tripId),
    name: name || 'Item',
    packed: Boolean(item.packed),
    Urgent: Boolean(item.urgent),
    Urgency: importance
  };
}

function normalizePackingItemFromSupabase(item) {
  if (!item || typeof item !== 'object') return null;

  const normalised = { ...item };

  if (normalised.trip_id && !normalised.tripId) {
    normalised.tripId = String(normalised.trip_id);
  }

  if (typeof normalised.Urgent !== 'undefined' && typeof normalised.urgent === 'undefined') {
    normalised.urgent = Boolean(normalised.Urgent);
  }

  if (typeof normalised.Urgency !== 'undefined' && typeof normalised.importance === 'undefined') {
    const urgencyValue = normalised.Urgency;
    if (typeof urgencyValue === 'string') {
      normalised.importance = urgencyValue.toLowerCase();
    } else if (typeof urgencyValue === 'boolean') {
      normalised.importance = urgencyValue ? 'essential' : 'useful';
    }
  }

  if (typeof normalised.importance === 'string') {
    normalised.importance = normalised.importance.toLowerCase();
  }

  delete normalised.trip_id;
  delete normalised.Urgent;
  delete normalised.Urgency;

  return normalised;
}

function mergeTripCollections(localTrips = [], remoteTrips = []) {
  const merged = new Map();
  remoteTrips.forEach((trip) => {
    if (trip && trip.id) {
      merged.set(trip.id, { ...trip });
    }
  });

  localTrips.forEach((trip) => {
    if (!trip || !trip.id) return;
    const existing = merged.get(trip.id);
    if (!existing) {
      merged.set(trip.id, { ...trip });
      return;
    }

    const localTs = tripTimestamp(trip);
    const remoteTs = tripTimestamp(existing);

    if (localTs > remoteTs) {
      merged.set(trip.id, { ...existing, ...trip });
    } else if (remoteTs > localTs) {
      merged.set(trip.id, { ...trip, ...existing });
    } else {
      merged.set(trip.id, { ...existing, ...trip });
    }
  });

  return Array.from(merged.values());
}

function serializeTripsForComparison(trips = []) {
  const clone = mergeSort(trips.map((trip) => ({ ...trip })), (a, b) => {
    const aId = a.id || '';
    const bId = b.id || '';
    return aId.localeCompare(bId);
  });
  return JSON.stringify(clone);
}

async function syncFromSupabase(me) {
  if (!me?.email) return;
  // Pull trips
  const remoteRows = await readTripsFromSupabase(me.email);
  const remoteTrips = remoteRows.map(normalizeTripFromSupabase).filter(Boolean);
  const localTrips = getTrips(me.email) || [];
  let effectiveTrips = localTrips;
  if (remoteTrips.length) {
    const merged = mergeTripCollections(localTrips, remoteTrips);
    if (serializeTripsForComparison(merged) !== serializeTripsForComparison(localTrips)) {
      await saveTrips(me.email, merged); // uses existing function in app.js
    }
    effectiveTrips = merged;
  }
  // Pull expenses for each trip in parallel to minimise overall sync time.
  await Promise.all((effectiveTrips || []).map(async (t) => {
    if (!t?.id) return;
    const rows = await readExpensesFromSupabase(me.email, t.id);
    if (rows !== null) {
      const hasRows = Array.isArray(rows) ? rows.length > 0 : false;
      const dirty = areExpensesDirty(t.id);
      if (hasRows || !dirty) {
        store.set(expensesKey(t.id), Array.isArray(rows) ? rows : []);
        markExpensesDirty(t.id, false);
      }
    }
  }));

  // Pull reminders for this user.  Persist an empty array when Supabase
  // returns no rows so that reminders deleted remotely disappear from the
  // local cache as well.
  const rems = await readRemindersFromSupabase(me.email);
  if (rems !== null) {
    const normalizedRems = Array.isArray(rems)
      ? rems.map(normalizeReminderFromSupabase).filter(Boolean)
      : [];
    const { items } = normaliseReminders(normalizedRems);
    store.set(remindersKey(me.email), items);
  }

  // Pull packing lists for each trip.  Packing items are stored in the
  // `packing` table keyed by email and trip id.  Save them into
  // localStorage so the packing page can access them offline.  As with
  // expenses and reminders, persist an empty array when the remote store has
  // no items so that deletions made elsewhere are mirrored locally.
  await Promise.all((effectiveTrips || []).map(async (t) => {
    if (!t?.id) return;
    const packs = await readPackingFromSupabase(me.email, t.id);
    if (packs !== null) {
      const { items } = normalisePackingItems(Array.isArray(packs) ? packs : []);
      store.set(packingKey(t.id), items);
    }
  }));
}

/**
 * Persist an array of trips to Firestore under a user document.  Each
 * trip is written as a document in the subcollection
 * `users/{email}/trips/{tripId}`.  Existing documents are merged.
 *
 * @param {string} email The email of the user owning the trips
 * @param {Array<Object>} trips The array of trip objects
 */
async function writeTripsToSupabase(email, trips) {
  /**
   * Persist an array of trips to Supabase.
   *
   * Each trip object is upserted into the `trips` table along with
   * the owning user's email.  Before inserting, any remote rows that
   * are no longer present locally are removed to keep deletions in
   * sync.  Operations are batched to reduce network chatter compared
   * to issuing one request per trip.
   *
   * @param {string} email The email of the user owning the trips
   * @param {Array<Object>} trips The array of trip objects to persist
   */
  const supabase = window.supabaseClient;
  if (!supabase || !email || !Array.isArray(trips)) return;

  const payload = trips
    .map(trip => serializeTripForSupabase(trip, email))
    .filter(Boolean);
  const keepIds = new Set(payload.map(trip => trip.id));

  try {
    const { data: remoteRows, error: fetchError } = await supabase
      .from('trips')
      .select('id')
      .eq('email', email);
    if (fetchError) {
      console.error('Error fetching trips from Supabase:', fetchError);
    } else if (Array.isArray(remoteRows) && remoteRows.length) {
      const staleIds = remoteRows
        .map(row => row?.id)
        .filter(id => id && !keepIds.has(id));
      if (staleIds.length) {
        const { error: deleteError } = await supabase
          .from('trips')
          .delete()
          .eq('email', email)
          .in('id', staleIds);
        if (deleteError) {
          console.error('Error deleting removed trips from Supabase:', deleteError);
        }
      }
    }
  } catch (err) {
    console.error('Error pruning trips in Supabase:', err);
  }

  if (!payload.length) {
    return;
  }

  try {
    const { error } = await supabase.from('trips').upsert(payload);
    if (error) {
      console.error('Error writing trip to Supabase:', error);
    }
  } catch (err) {
    console.error('Error writing trip to Supabase:', err);
  }
}

/**
 * Persist an array of expenses for a specific trip.  Expenses are
 * stored under `users/{email}/trips/{tripId}/expenses/{expenseId}`.
 *
 * @param {string} email The email of the user owning the trip
 * @param {string} tripId The unique ID of the trip
 * @param {Array<Object>} expenses Array of expense objects
 */
async function writeExpensesToSupabase(email, tripId, expenses) {
  /**
   * Persist an array of expenses to Supabase.
   *
   * Each expense is upserted into the `expenses` table with the
   * associated user email and trip id.  Errors are logged but do
   * not interrupt the calling context.
   *
   * @param {string} email The email of the user owning the trip
   * @param {string} tripId The unique identifier of the trip
   * @param {Array<Object>} expenses Array of expense objects
   */
  const supabase = window.supabaseClient;
  if (!supabase || !email || !tripId || !Array.isArray(expenses)) return null;
  try {
    // Remove all existing expenses for this user and trip before upserting the new set.
    // Without deleting stale rows, removed expenses would reappear on reload.
    await supabase.from('expenses').delete().match({ email, trip_id: tripId });
    for (const exp of expenses) {
      const record = { ...exp, email, trip_id: tripId };
      const { error } = await supabase.from('expenses').upsert(record);
      if (error) {
        console.error('Error writing expense to Supabase:', error);
        throw error;
      }
    }
    return true;
  } catch (err) {
    console.error('Error writing expense to Supabase:', err);
    throw err;
  }
}

async function writePackingToSupabase(email, tripId, items) {
  /**
   * Persist packing list items for a specific trip to Supabase.
   *
   * Items are stored in the `packing` table keyed by the user's email
   * and the associated trip id.  Existing rows for the trip are removed
   * before inserting the updated list to prevent deleted items from
   * reappearing on the next sync.
   *
   * @param {string} email The email of the user owning the trip
   * @param {string} tripId The unique identifier of the trip
   * @param {Array<Object>} items Array of packing item objects
   */
  const supabase = window.supabaseClient;
  if (!supabase || !email || !tripId || !Array.isArray(items)) return;

  try {
    const { error: deleteError } = await supabase
      .from('packing')
      .delete()
      .match({ email, trip_id: tripId });
    if (deleteError) {
      console.error('Error deleting old packing items from Supabase:', deleteError);
    }
  } catch (err) {
    console.error('Error deleting old packing items from Supabase:', err);
  }

  const payload = items
    .map(item => serializePackingItemForSupabase(item, email, tripId))
    .filter(Boolean);

  if (!payload.length) {
    return;
  }
  try {
    const { error } = await supabase.from('packing').upsert(payload);
    if (error) {
      const message = String(error?.message || '');
      if (/column\s+"?(Urgent|Urgency)"?/i.test(message)) {
        const fallbackPayload = payload.map((record) => {
          const { Urgent, Urgency, ...rest } = record;
          const importance = typeof Urgency === 'string'
            ? Urgency
            : Urgency === true
              ? 'essential'
              : 'useful';
          return {
            ...rest,
            urgent: Boolean(Urgent),
            importance
          };
        });
        const { error: fallbackError } = await supabase.from('packing').upsert(fallbackPayload);
        if (fallbackError) {
          console.error('Error writing packing item to Supabase:', fallbackError);
        } else {
          console.warn('Packing items upserted without Urgent/Urgency columns due to schema mismatch.');
        }
      } else {
        console.error('Error writing packing item to Supabase:', error);
      }
    }
  } catch (err) {
    console.error('Error writing packing item to Supabase:', err);
  }
}

/**
 * Persist reminders for a user.  Each reminder is stored under
 * `users/{email}/reminders/{reminderId}`.  Existing documents are
 * merged.
 *
 * @param {string} email The user email
 * @param {Array<Object>} reminders Array of reminder objects
 */
async function writeRemindersToSupabase(email, reminders) {
  /**
   * Persist an array of reminders to Supabase.
   *
   * Existing reminders for the user are removed before the new set is
   * upserted so that deletions made locally are reflected remotely.
   * Errors are logged to the console.
   *
   * @param {string} email The user's email
   * @param {Array<Object>} reminders Array of reminder objects
   */
  const supabase = window.supabaseClient;
  if (!supabase || !email || !Array.isArray(reminders)) return;

  try {
    const { error: deleteError } = await supabase
      .from('reminders')
      .delete()
      .match({ email });
    if (deleteError) {
      console.error('Error deleting old reminders from Supabase:', deleteError);
    }
  } catch (err) {
    console.error('Error deleting old reminders from Supabase:', err);
  }

  if (!reminders.length) {
    return;
  }

  const payload = reminders
    .map(rem => serializeReminderForSupabase(rem, email))
    .filter(Boolean);
  if (!payload.length) {
    return;
  }
  try {
    const { error } = await supabase.from('reminders').upsert(payload);
    if (error) {
      const message = String(error?.message || '');
      if (/column\s+"?completed"?/i.test(message)) {
        const fallbackPayload = payload.map(({ completed, ...rest }) => rest);
        const { error: fallbackError } = await supabase.from('reminders').upsert(fallbackPayload);
        if (fallbackError) {
          console.error('Error writing reminders to Supabase:', fallbackError);
        } else {
          console.warn('Reminder completion status not stored in Supabase due to missing column.');
        }
      } else {
        console.error('Error writing reminders to Supabase:', error);
      }
    }
  } catch (err) {
    console.error('Error writing reminders to Supabase:', err);
  }
}

/**
 * Construct a matrix summarising expenses by month and category.  The
 * resulting 2D array has rows for each month (1–12) and columns for
 * each distinct category encountered in the provided expenses.  Each
 * cell contains the total amount spent in that month and category.
 *
 * This demonstrates the use of multidimensional arrays and key‑value
 * collections.  The category map collects unique categories and
 * assigns each an index.  The matrix is initialised with zeros and
 * populated by iterating through the expenses.
 *
 * @param {Array<Object>} expenses Array of expense objects with
 *   properties { amount: number, date: 'YYYY‑MM‑DD', category: string }
 * @returns {Object} { matrix: number[][], categories: string[] }
 */
function buildExpenseMatrix(expenses) {
  const safeExpenses = Array.isArray(expenses) ? expenses : [];
  const categories = [];
  const categoryIndex = new Map();
  const matrix = Array.from({ length: 12 }, () => []);

  const ensureCategory = (rawName) => {
    let name = '';

    if (typeof rawName === 'string') {
      name = rawName.trim();
    } else if (rawName != null) {
      const coerced = String(rawName);
      name = typeof coerced === 'string' ? coerced.trim() : '';
    }

    if (!name) {
      name = 'Uncategorised';
    }
    if (!categoryIndex.has(name)) {
      const idx = categories.length;
      categoryIndex.set(name, idx);
      categories.push(name);
      matrix.forEach((row) => {
        row[idx] = 0;
      });
    }
    return categoryIndex.get(name);
  };

  safeExpenses.forEach((exp) => {
    if (!exp) return;

    const amount = typeof exp.amount === 'number' ? exp.amount : Number(exp.amount);
    if (!Number.isFinite(amount)) return;

    const dateValue = exp.date;
    if (!dateValue) return;
    const date = new Date(dateValue);
    const time = date.getTime();
    if (!Number.isFinite(time)) return;

    const month = date.getMonth();
    if (!Number.isInteger(month) || month < 0 || month > 11) return;

    const col = ensureCategory(exp.category);
    matrix[month][col] += amount;
  });

  const normalisedMatrix = matrix.map((row) =>
    categories.map((_, idx) => (Number.isFinite(row[idx]) ? row[idx] : 0))
  );

  return { matrix: normalisedMatrix, categories };
}

const nowISO = () => new Date().toISOString();

// -------------------------------------------------------------------------
// Currency converter abstraction
//
// This object encapsulates logic for retrieving exchange rates, converting
// between currencies and formatting numbers.  It fetches rates relative
// to USD from a public API (exchangerate.host) when initialised.  The
// selected currency defaults to USD but can be changed via setCurrency().
// Throughout the budget page, values are stored internally in USD and
// converted on the fly when displayed.  This demonstrates the use of a
// remote REST API, asynchronous operations and encapsulation.
const currencyConverter = {
  // Mapping of currency codes to their rate relative to USD
  rates: { USD: 1 },
  // Currently selected currency (ISO code)
  selected: 'USD',
  // List of currencies supported by the UI
  supported: ['USD','EUR','GBP','TRY'],
  async init() {
    try {
      // Request only the supported currencies (excluding USD) to reduce payload
      const symbols = this.supported.filter(c => c !== 'USD').join(',');
      const resp = await fetch(`https://api.exchangerate.host/latest?base=USD&symbols=${symbols}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.rates) {
          // Merge the fetched rates with the base USD rate
          this.rates = { USD: 1, ...data.rates };
        }
      }
    } catch (err) {
      console.error('Currency rate fetch failed:', err);
    }
  },
  /**
   * Change the current currency used for conversion and formatting.  When
   * passed a code not in the supported list, this method does nothing.
   *
   * @param {string} curr The currency code to select
   */
  setCurrency(curr) {
    if (this.supported.includes(curr)) {
      this.selected = curr;
    }
  },
  /**
   * Convert an amount from USD into the currently selected currency.
   * If a rate is unavailable the amount is returned unchanged.
   *
   * @param {number} amount The value expressed in USD
   * @returns {number} The converted value
   */
  convert(amount) {
    const rate = this.rates[this.selected] ?? 1;
    return (Number(amount) || 0) * rate;
  },
  /**
   * Convert and format an amount.  Uses the Intl API to apply locale
   * appropriate formatting and currency symbols.  If Intl fails, falls
   * back to a simple string representation.
   *
   * @param {number} amount The value expressed in USD
   * @returns {string} A formatted currency string
   */
  format(amount) {
    const converted = this.convert(Number(amount) || 0);
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: this.selected }).format(converted);
    } catch {
      return `${this.selected} ${converted.toFixed(2)}`;
    }
  }
};
const fmtMoney = (n) => {
  let val = n;
  if (val == null || Number.isNaN(val)) val = 0;
  // Delegate to the currency converter if available.  This will both convert
  // from USD to the selected currency and apply locale‑appropriate formatting.
  if (typeof currencyConverter !== 'undefined' && currencyConverter && typeof currencyConverter.format === 'function') {
    return currencyConverter.format(val);
  }
  // Fallback: format as USD when the converter is unavailable or uninitialised.
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(val);
  } catch {
    return `$${Number(val).toFixed(2)}`;
  }
};

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

// WebCrypto SHA-256 (best-effort); fallback to plain string if not available
async function hash(text) {
  if (window.crypto?.subtle) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    const arr = Array.from(new Uint8Array(buf));
    return arr.map(b => b.toString(16).padStart(2, "0")).join("");
  }
  // fallback (not secure, but avoids blocking the demo)
  return `plain:${text}`;
}

function getSession() {
  return store.get(KEY_SESSION, null);
}
function requireSession() {
  const s = getSession();
  if (!s || !s.email) return null;
  const users = store.get(KEY_USERS, []);
  const me = users.find(u => u.email === s.email);
  return me || null;
}

// ---------- Auth: Register / Login / Logout ----------

async function handleRegisterPage() {
  const form = qs("#register-form");
  if (!form) return;

  const nameEl = qs("#full-name");
  const emailEl = qs("#register-email");
  const passEl = qs("#register-password");
  const confirmEl = qs("#confirm-password");
  const loginLink = qs("#login-link");
  const errorBox = qs("#register-error");

  const setRegisterError = (msg = "") => {
    if (!errorBox) return;
    if (msg) {
      errorBox.textContent = msg;
      errorBox.classList.remove("hidden");
    } else {
      errorBox.textContent = "";
      errorBox.classList.add("hidden");
    }
  };

  const clearPasswordMismatch = () => {
    if (confirmEl) {
      confirmEl.setCustomValidity("");
    }
    setRegisterError("");
  };

  on(passEl, "input", clearPasswordMismatch);
  on(confirmEl, "input", clearPasswordMismatch);

    on(loginLink, "click", (e) => {
    e.preventDefault();
    // Navigate to the lowercase login page file.  Filenames on Netlify are case‑sensitive.
    window.location.href = "logpage.html";
  });

  on(form, "submit", async (e) => {
    e.preventDefault();
    setRegisterError("");
    if (confirmEl) confirmEl.setCustomValidity("");
    const name = nameEl?.value?.trim();
    const email = emailEl?.value?.toLowerCase().trim();
    const pass = passEl?.value || "";
    const confirm = confirmEl?.value || "";

    // Basic validation: if required fields are empty simply abort submission.  We avoid using
    // disruptive alert popups; the browser's built‑in required attribute handles user feedback.
    if (!name || !email || !pass) {
      return;
    }
    if (pass !== confirm) {
      if (confirmEl) {
        confirmEl.setCustomValidity("Passwords do not match");
        confirmEl.reportValidity();
      }
      setRegisterError("Passwords do not match. Please re-enter them.");
      return;
    }

    const users = store.get(KEY_USERS, []);
    if (users.some(u => u.email === email)) {
      // Redirect existing users to the login page without showing a popup
      // Use lowercase filename on case‑sensitive hosts (e.g. Netlify).  The login page
      // file is named "logpage.html" on disk, so a mismatched case will result in a
      // 404 when deployed.  Always navigate to the lowercase variant here.
      window.location.href = "logpage.html";
      return;
    }

    const passHash = await hash(pass);
    const newUser = { name, email, passHash, createdAt: nowISO() };
    // Persist the new user to Supabase and wait for completion so that
    // subsequent trip/expense writes have a parent record available.
    try {
      await writeUserToSupabase(newUser);
    } catch (err) {
      console.error('Unable to persist user to Supabase:', err);
      setRegisterError("We couldn't create your account right now. Please try again shortly.");
      return;
    }
    users.push(newUser);
    store.set(KEY_USERS, users);
    store.set(KEY_SESSION, { email }); // auto-login
    // Directly redirect to the home page upon successful account creation.  A dedicated
    // notification area could be used to display a success message if desired.
    window.location.href = "homepage.html";
  });
}

async function handleLoginPage() {
  const form = qs("#login-form");
  if (!form) return;

  const emailEl = qs("#login-email");
  const passEl = qs("#login-password");
  const rememberEl = qs("#remember-me");
  const errorBox = qs("#error-message");
  const signupLink = qs("#signup-link");

  on(signupLink, "click", (e) => {
    e.preventDefault();
    window.location.href = "signpage.html";
  });

  on(form, "submit", async (e) => {
    e.preventDefault();
    errorBox && errorBox.classList.add("hidden");
    const email = emailEl?.value?.toLowerCase().trim();
    const pass = passEl?.value || "";
    const passHash = await hash(pass);

    const users = store.get(KEY_USERS, []);
    const user = users.find(u => u.email === email && u.passHash === passHash);

    if (!user) {
      errorBox && errorBox.classList.remove("hidden");
      return;
    }

    store.set(KEY_SESSION, { email });
    if (rememberEl?.checked) {
      // Optionally set a flag for a "remembered" longer session. For demo, no-op.
    }
    // Synchronise trips and expenses from Supabase after login
    await syncFromSupabase({ email });
    window.location.href = "homepage.html";
  });
}

// Optional: call on any page with a header profile to add a Logout action via context menu/shortcut
function addLogoutShortcut() {
  // Press Ctrl/Cmd+Shift+L to logout
  on(document, "keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "l") {
      store.remove(KEY_SESSION);
      // Redirect to login page without showing a popup
      window.location.href = "logpage.html";
    }
  });
}

// ---------- Trips ----------

function getTrips(email) {
  return store.get(tripsKey(email), []);
}
async function saveTrips(email, trips) {
  // Persist trips to localStorage
  store.set(tripsKey(email), trips);
  // Also persist trips to Supabase when the client is initialised.  This
  // asynchronous call now resolves before dependent writes proceed so
  // that related expenses, reminders and packing items are not inserted
  // before their parent trip exists remotely.
  try {
    await writeTripsToSupabase(email, trips);
  } catch (err) {
    console.error('Failed to persist trips to Supabase:', err);
  }
}

async function deleteTripCascade(email, tripId) {
  if (!email || !tripId) {
    return getTrips(email) || [];
  }

  const remainingTrips = (getTrips(email) || []).filter((trip) => trip?.id !== tripId);
  await saveTrips(email, remainingTrips);

  // Clear cached datasets associated with the trip
  store.remove(expensesKey(tripId));
  markExpensesDirty(tripId, false);
  store.remove(packingKey(tripId));
  removeRecentTrip(email, tripId);

  const remainingReminders = (getReminders(email) || []).filter((rem) => rem?.tripId !== tripId);
  saveReminders(email, remainingReminders);

  const nextSelection = (() => {
    const stored = getStoredTripSelection(email);
    if (stored !== tripId) {
      return stored;
    }
    const upcoming = nextUpcomingTrip(remainingTrips);
    if (upcoming?.id) {
      return upcoming.id;
    }
    return remainingTrips[0]?.id || '';
  })();
  setStoredTripSelection(email, nextSelection || null);

  // Remove remote data; ignore errors so the UI stays responsive.
  try {
    await writeExpensesToSupabase(email, tripId, []);
  } catch (err) {
    console.error('Error removing expenses for deleted trip:', err);
  }
  try {
    await writePackingToSupabase(email, tripId, []);
  } catch (err) {
    console.error('Error removing packing items for deleted trip:', err);
  }
  return remainingTrips;
}

function wireNewTripButton(defaultRedirect = 'homepage.html') {
  const btn = qs('#new-trip-button');
  if (!btn) return;

  const redirect = defaultRedirect || 'homepage.html';
  // Remove any previous handler we attached so that navigating back to the
  // page does not stack duplicate listeners.
  if (btn._wlNewTripHandler) {
    btn.removeEventListener('click', btn._wlNewTripHandler);
  }

  btn.dataset.redirect = redirect;
  const handler = (ev) => {
    ev.preventDefault();
    const target = btn.dataset.redirect || redirect;
    window.location.href = `addvac.html?redirect=${target}`;
  };
  btn._wlNewTripHandler = handler;
  btn.addEventListener('click', handler);
}

function findTripById(email, id) {
  return getTrips(email).find(t => t.id === id) || null;
}

function nextUpcomingTrip(trips) {
  const today = new Date();
  const future = mergeSort(trips.slice(), (a, b) => new Date(a.startDate) - new Date(b.startDate));
  return future.find(t => new Date(t.endDate) >= today) || future[0] || null;
}

function getStoredTripSelection(email) {
  if (!email) return '';
  return store.get(selectedTripKey(email), '') || '';
}

function setStoredTripSelection(email, tripId) {
  if (!email) return;
  if (tripId) {
    store.set(selectedTripKey(email), tripId);
  } else {
    store.remove(selectedTripKey(email));
  }
}

function populateTripSelectElement(selectEl, trips, desiredId = '', placeholderText = 'Select a trip') {
  if (!selectEl) return '';
  const list = Array.isArray(trips) ? trips.slice() : [];
  selectEl.innerHTML = '';
  if (placeholderText !== null && list.length === 0) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = placeholderText;
    selectEl.appendChild(placeholder);
  }
  list.forEach(trip => {
    if (!trip || !trip.id) return;
    const opt = document.createElement('option');
    opt.value = trip.id;
    opt.textContent = trip.name || 'Unnamed trip';
    selectEl.appendChild(opt);
  });
  selectEl.disabled = list.length === 0;
  if (list.length === 0) {
    selectEl.value = '';
    return '';
  }
  let finalId = '';
  if (desiredId && list.some(t => t.id === desiredId)) {
    finalId = desiredId;
  } else {
    const upcoming = nextUpcomingTrip(list);
    if (upcoming?.id) {
      finalId = upcoming.id;
    }
  }
  if (!finalId && list[0]?.id) {
    finalId = list[0].id;
  }
  selectEl.value = finalId || '';
  return finalId || '';
}

function preloadAddVacationFormForEdit(me) {
  // Only on Addvac.html
  const form = qs("#vacation-form");
  if (!form) return;

  const params = new URLSearchParams(window.location.search);
  const editId = params.get("edit");

  if (!editId) return;
  const trip = findTripById(me.email, editId);
  if (!trip) return;

  const nameEl = qs("#trip-name");
  const locEl = qs("#location");
  const startEl = qs("#start-date");
  const endEl = qs("#end-date");
  const costEl = qs("#cost");
  const notesEl = qs("#notes");

  if (nameEl)  nameEl.value = trip.name || "";
  if (locEl)   locEl.value = trip.location || "";
  if (startEl) startEl.value = trip.startDate || "";
  if (endEl)   endEl.value = trip.endDate || "";
  if (costEl)  costEl.value = trip.cost ?? "";
  if (notesEl) notesEl.value = trip.notes || "";
  form.dataset.editId = editId;
}

function wireAddVacationPage(me) {
  const form = qs("#vacation-form");
  if (!form) return;

  const nameEl = qs("#trip-name");
  const locEl = qs("#location");
  const startEl = qs("#start-date");
  const endEl = qs("#end-date");
  const costEl = qs("#cost");
  const notesEl = qs("#notes");
  const errorBanner = qs("#trip-error");

  const setTripError = (msg = "") => {
    if (!errorBanner) return;
    if (msg) {
      errorBanner.textContent = msg;
      errorBanner.classList.remove("hidden");
    } else {
      errorBanner.textContent = "";
      errorBanner.classList.add("hidden");
    }
  };

  const syncEndMin = () => {
    if (startEl?.value) {
      if (endEl) endEl.min = startEl.value;
      if (endEl?.value && endEl.value < startEl.value) endEl.value = startEl.value;
    }
  };
  on(startEl, "change", syncEndMin);
  syncEndMin();

  on(form, "submit", async (e) => {
    e.preventDefault();
    setTripError("");
    // validate
    const name = nameEl?.value?.trim();
    const loc = locEl?.value?.trim();
    const start = startEl?.value || "";
    const end = endEl?.value || "";
    const startTime = start ? new Date(start).getTime() : NaN;
    const endTime = end ? new Date(end).getTime() : NaN;
    const cost = costEl?.value ? Number(costEl.value) : null;
    const notes = notesEl?.value?.trim() || null;

    // Perform simple validations.  We avoid using alert popups; invalid input simply
    // prevents saving without interrupting the user.  HTML required attributes
    // already enforce many of these checks.
    if (!name || !loc || !start || !end) {
      return;
    }
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
      return;
    }
    if (endTime < startTime) {
      return;
    }
    if (costEl?.value && (!Number.isFinite(cost) || cost < 0)) {
      return;
    }

    const trips = getTrips(me.email);
    const editId = form.dataset.editId;
    const hasOverlap = trips.some(trip => {
      if (!trip) return false;
      if (editId && trip.id === editId) return false;
      const tripStart = trip.startDate || trip.start_date || "";
      const tripEnd = trip.endDate || trip.end_date || "";
      if (!tripStart || !tripEnd) return false;
      const tripStartTime = new Date(tripStart).getTime();
      const tripEndTime = new Date(tripEnd).getTime();
      if (!Number.isFinite(tripStartTime) || !Number.isFinite(tripEndTime)) {
        return false;
      }
      return !(endTime < tripStartTime || startTime > tripEndTime);
    });

    if (hasOverlap) {
      setTripError("You already have a trip scheduled during these dates. Please adjust the schedule or update the existing trip.");
      return;
    }
    let selectionId = null;
    if (editId) {
      const idx = trips.findIndex(t => t.id === editId);
      if (idx >= 0) {
        trips[idx] = { ...trips[idx], name, location: loc, startDate: start, endDate: end, cost, notes, updatedAt: nowISO() };
      }
      selectionId = editId;
    } else {
      const id = uid("trip");
      const msPerDay = 1000 * 60 * 60 * 24;
      const days = Math.max(1, Math.round((new Date(end) - new Date(start)) / msPerDay) + 1);
      trips.push({ id, name, location: loc, startDate: start, endDate: end, cost, notes, days, createdAt: nowISO(), updatedAt: nowISO() });
      selectionId = id;
    }
    try {
      await saveTrips(me.email, trips);
    } catch (err) {
      console.error('Failed to save trip before redirecting:', err);
      return;
    }
    if (selectionId) {
      setStoredTripSelection(me.email, selectionId);
    }

    const params = new URLSearchParams(window.location.search);
    // Redirect to the provided URL or fallback to the lowercase home page
    const redirect = params.get("redirect") || "homepage.html";
    // Redirect after saving without showing a popup.  A toast or inline
    // notification could be added here if desired.
    window.location.href = redirect;
  });

  // Handle the cancel button: navigate back to the previous page or the redirect target.
  const cancelBtn = qs('#cancel-trip-button');
  on(cancelBtn, 'click', (e) => {
    e.preventDefault();
    // Try to honour the ?redirect query parameter; default to homepage.
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get('redirect') || 'homepage.html';
    // If there's a history entry from which the user came, going back
    // provides a natural flow. Otherwise, fall back to redirect.
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = redirect;
    }
  });
}

function setSingletonListener(element, eventName, handler, markerName) {
  if (!element) return;
  const key = markerName || `_wlHandler_${eventName}`;
  const existing = element[key];
  if (existing) {
    element.removeEventListener(eventName, existing);
    element[key] = null;
  }
  if (typeof handler === 'function') {
    element.addEventListener(eventName, handler);
    element[key] = handler;
  }
}

function createPlaceholderMessage(text, className = 'text-sm opacity-70') {
  const msg = document.createElement('p');
  msg.className = className;
  msg.textContent = text;
  return msg;
}

function createUpcomingTripCard(trip) {
  const card = document.createElement('div');
  card.className = 'home-trip-card flex items-center gap-4 p-4 rounded-lg bg-primary/10 dark:bg-primary/20 cursor-pointer hover:bg-primary/20 dark:hover:bg-primary/30 transition-colors';
  card.dataset.tripId = trip.id;

  const iconWrap = document.createElement('div');
  iconWrap.className = 'flex items-center justify-center rounded-lg bg-primary/20 dark:bg-primary/30 p-3';
  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined text-primary';
  icon.textContent = 'travel_explore';
  iconWrap.appendChild(icon);
  card.appendChild(iconWrap);

  const textWrap = document.createElement('div');
  const nameEl = document.createElement('p');
  nameEl.className = 'font-semibold text-slate-800 dark:text-slate-200';
  nameEl.textContent = trip.name;
  const dateEl = document.createElement('p');
  dateEl.className = 'text-sm text-slate-500 dark:text-slate-400';
  dateEl.textContent = `${trip.startDate} - ${trip.endDate}`;
  textWrap.appendChild(nameEl);
  textWrap.appendChild(dateEl);
  card.appendChild(textWrap);

  return card;
}

function createSummaryCard(title, value, iconName) {
  const card = document.createElement('div');
  card.className = 'bg-white dark:bg-slate-900 p-4 rounded-lg shadow-sm flex items-center gap-4';

  const iconWrap = document.createElement('div');
  iconWrap.className = 'p-3 rounded-full bg-primary/10 dark:bg-primary/20';
  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined text-primary';
  icon.textContent = iconName;
  iconWrap.appendChild(icon);
  card.appendChild(iconWrap);

  const text = document.createElement('div');
  const titleEl = document.createElement('p');
  titleEl.className = 'text-sm text-slate-500 dark:text-slate-400';
  titleEl.textContent = title;
  const valueEl = document.createElement('p');
  valueEl.className = 'text-xl font-bold text-slate-900 dark:text-white';
  valueEl.textContent = value;
  text.appendChild(titleEl);
  text.appendChild(valueEl);
  card.appendChild(text);

  return card;
}

function createReminderCard(reminder) {
  const card = document.createElement('div');
  card.className = 'flex items-center gap-4 p-4 rounded-lg bg-primary/10 dark:bg-primary/20';

  const iconWrap = document.createElement('div');
  iconWrap.className = 'flex items-center justify-center rounded-lg bg-primary/20 dark:bg-primary/30 p-3';
  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined text-primary';
  icon.textContent = 'event';
  iconWrap.appendChild(icon);
  card.appendChild(iconWrap);

  const textWrap = document.createElement('div');
  const nameEl = document.createElement('p');
  nameEl.className = 'font-semibold text-slate-800 dark:text-slate-200';
  nameEl.textContent = reminder.name;
  const dateEl = document.createElement('p');
  dateEl.className = 'text-sm text-slate-500 dark:text-slate-400';
  dateEl.textContent = reminder.date;
  textWrap.appendChild(nameEl);
  textWrap.appendChild(dateEl);
  card.appendChild(textWrap);

  return card;
}



function renderDestinationInsightsSection(trip, email) {
  const destinationEl = qs('#home-destination-card');
  const tipsEl = qs('#home-travel-tips');
  const applyBtn = qs('#home-travel-tips-apply');
  const feedbackEl = qs('#home-travel-tips-feedback');
  if (!destinationEl || !tipsEl) return;

  const colourClasses = [
    'text-green-600', 'dark:text-green-400',
    'text-red-500', 'dark:text-red-400',
    'text-amber-500', 'dark:text-amber-300',
    'text-slate-500', 'dark:text-slate-300'
  ];

  const resetFeedback = () => {
    if (!feedbackEl) return;
    colourClasses.forEach(cls => feedbackEl.classList.remove(cls));
    feedbackEl.classList.add('hidden');
    feedbackEl.textContent = '';
  };

  const showFeedback = (message, variant) => {
    if (!feedbackEl) return;
    colourClasses.forEach(cls => feedbackEl.classList.remove(cls));
    feedbackEl.classList.remove('hidden');
    feedbackEl.textContent = message;
    if (variant === 'success') {
      feedbackEl.classList.add('text-green-600', 'dark:text-green-400');
    } else if (variant === 'warning') {
      feedbackEl.classList.add('text-amber-500', 'dark:text-amber-300');
    } else if (variant === 'error') {
      feedbackEl.classList.add('text-red-500', 'dark:text-red-400');
    } else {
      feedbackEl.classList.add('text-slate-500', 'dark:text-slate-300');
    }
  };

  const disableApplyButton = () => {
    if (!applyBtn) return;
    applyBtn.disabled = true;
    applyBtn.classList.add('opacity-50', 'cursor-not-allowed');
  };

  const enableApplyButton = () => {
    if (!applyBtn) return;
    applyBtn.disabled = false;
    applyBtn.classList.remove('opacity-50', 'cursor-not-allowed');
  };

  destinationInsightState.tripId = null;
  destinationInsightState.suggestions = [];
  destinationInsightState.email = email || null;
  resetFeedback();

  if (applyBtn) {
    bindEventOnce(applyBtn, 'click', (ev) => {
      ev.preventDefault();
      const { tripId, suggestions } = destinationInsightState;
      if (!tripId || !Array.isArray(suggestions) || suggestions.length === 0) {
        showFeedback('Travel tips are still loading. Please try again shortly.', 'warning');
        return;
      }
      const added = applySmartPackingSuggestions(tripId, suggestions);
      if (added > 0) {
        showFeedback(`Added ${added} travel tip${added === 1 ? '' : 's'} to your packing list.`, 'success');
      } else {
        showFeedback('All suggested items are already on your packing list.', 'warning');
      }
    }, 'travel-tips-apply');
  }

  if (!trip) {
    destinationEl.innerHTML = '<p class="text-sm opacity-70">Add an upcoming trip to see a destination snapshot.</p>';
    tipsEl.innerHTML = '<p class="text-sm opacity-70">Personalised travel tips will appear here once a destination is selected.</p>';
    disableApplyButton();
    return;
  }

  const activeTripId = trip.id || trip.tripId || '';
  destinationEl.dataset.tripId = activeTripId;
  destinationEl.innerHTML = `<p class="text-sm opacity-70">Gathering destination insights for ${escapeHtml(trip.location || trip.name || 'your trip')}…</p>`;
  tipsEl.innerHTML = '<p class="text-sm opacity-70">Collecting tailored travel tips…</p>';
  disableApplyButton();

  const expectedTripId = trip.id || trip.tripId || '';
  fetchDestinationInsights(trip).then((insights) => {
    if ((destinationEl.dataset.tripId || '') !== expectedTripId) {
      return;
    }
    if (!insights) {
      destinationEl.innerHTML = '<p class="text-sm text-red-500">Live destination data is unavailable right now.</p>';
      tipsEl.innerHTML = '<p class="text-sm opacity-70">Travel tips are unavailable for this destination.</p>';
      disableApplyButton();
      return;
    }
    renderDestinationCard(destinationEl, insights, trip);
    const suggestions = buildDestinationPackingSuggestions(insights, trip);
    renderTravelTips(tipsEl, suggestions, trip);
    destinationInsightState.tripId = trip.id || trip.tripId || null;
    destinationInsightState.suggestions = suggestions;
    destinationInsightState.email = email || null;
    if (Array.isArray(suggestions) && suggestions.length > 0) {
      enableApplyButton();
    } else {
      disableApplyButton();
    }
  }).catch((err) => {
    console.error('Unable to render destination insights:', err);
    if ((destinationEl.dataset.tripId || '') !== expectedTripId) {
      return;
    }
    destinationEl.innerHTML = '<p class="text-sm text-red-500">We couldn\'t load destination insights right now.</p>';
    tipsEl.innerHTML = '<p class="text-sm opacity-70">Personalised travel tips are unavailable at the moment.</p>';
    disableApplyButton();
  });
}

function renderTripDetail(tripBox, trip) {
  if (!tripBox || !trip) return;
  const rangeTxt = `${trip.startDate} - ${trip.endDate}`;
  let html = '';
  html += `<p class="text-sm text-primary font-semibold">${rangeTxt}</p>`;
  html += `<h4 class="text-2xl font-bold">${trip.name}</h4>`;
  html += `<p class="mt-1 opacity-80">${trip.location}</p>`;
  html += `<div class="mt-3 text-sm opacity-70">`;
  if (trip.cost != null) {
    html += `Estimated Cost: ${fmtMoney(trip.cost)}`;
  }
  html += `</div>`;
  html += `<div class="mt-4 text-xs opacity-60">Trip ID: ${trip.id}</div>`;
  html += `<div class="mt-6 flex gap-4" id="trip-actions">
        <button id="edit-trip-button" class="bg-primary/20 dark:bg-primary/30 text-primary font-bold py-2 px-4 rounded-full text-sm hover:bg-primary/30 dark:hover:bg-primary/40 transition-colors flex items-center gap-2">
          <span class="material-symbols-outlined text-base">edit</span>
          Edit
        </button>
        <button id="delete-trip-button" class="bg-red-500/20 text-red-500 font-bold py-2 px-4 rounded-full text-sm hover:bg-red-500/30 transition-colors flex items-center gap-2">
          <span class="material-symbols-outlined text-base">delete</span>
          Delete
        </button>
      </div>`;
  tripBox.innerHTML = html;
  tripBox.dataset.currentTripId = trip.id;
}

function renderTripDetailsSection(trips) {
  const tripBox = qs('#trip-details');
  if (!tripBox) return null;
  const next = nextUpcomingTrip(trips);
  if (next) {
    renderTripDetail(tripBox, next);
  } else {
    tripBox.innerHTML = '<p class="opacity-70">No trips yet. Click “New Trip” to add one!</p>';
    delete tripBox.dataset.currentTripId;
  }
  return tripBox;
}

function renderUpcomingTripsSection(trips) {
  const upcomingContainer = qs('#home-upcoming');
  if (!upcomingContainer) return;
  upcomingContainer.innerHTML = '';

  if (!Array.isArray(trips) || trips.length === 0) {
    upcomingContainer.appendChild(createPlaceholderMessage('No upcoming trips.'));
    setSingletonListener(upcomingContainer, 'click', null, '_wlUpcomingHandler');
    return;
  }

  const sortedTrips = mergeSort(trips.slice(), (a, b) => new Date(a.startDate) - new Date(b.startDate));
  const frag = document.createDocumentFragment();
  sortedTrips.forEach(trip => {
    if (!trip || !trip.id) return;
    frag.appendChild(createUpcomingTripCard(trip));
  });
  upcomingContainer.appendChild(frag);

  setSingletonListener(upcomingContainer, 'click', (e) => {
    const card = e.target.closest('.home-trip-card');
    if (!card) return;
    const id = card.dataset.tripId;
    if (!id) return;
    e.preventDefault();
    window.location.href = `addvac.html?edit=${encodeURIComponent(id)}&redirect=homepage.html`;
  }, '_wlUpcomingHandler');
}

function renderSummarySection(trips) {
  const summaryEl = qs('#home-summary');
  if (!summaryEl) return;
  summaryEl.innerHTML = '';

  const totalTrips = Array.isArray(trips) ? trips.length : 0;
  let totalBudget = 0;
  let totalSpent = 0;

  (trips || []).forEach(t => {
    const c = t?.cost;
    if (typeof c === 'number' && !Number.isNaN(c)) {
      totalBudget += c;
    }
    const exps = getExpenses(t.id) || [];
    exps.forEach(exp => {
      const amt = Number(exp?.amount);
      if (!Number.isNaN(amt)) {
        totalSpent += amt;
      }
    });
  });

  const cards = [
    createSummaryCard('Trips', String(totalTrips), 'travel_explore'),
    createSummaryCard('Total Budget', fmtMoney(totalBudget), 'account_balance_wallet'),
    createSummaryCard('Total Spent', fmtMoney(totalSpent), 'paid')
  ];

  const frag = document.createDocumentFragment();
  cards.forEach(card => frag.appendChild(card));
  summaryEl.appendChild(frag);
}

function renderRemindersSection(email) {
  const remindersContainer = qs('#home-upcoming-reminders');
  if (!remindersContainer) return;
  remindersContainer.innerHTML = '';

  const allRems = (getReminders(email) || []).filter(rem => !rem?.completed);
  const tree = new ReminderTree();
  allRems.forEach(rem => tree.insert(rem));

  const sortedRems = [];
  tree.inOrder(rem => { sortedRems.push(rem); });
  const today = new Date().toISOString().split('T')[0];
  const upcoming = sortedRems.filter(r => r.date >= today).slice(0, 3);

  if (upcoming.length === 0) {
    remindersContainer.appendChild(createPlaceholderMessage('No upcoming reminders.'));
    return;
  }

  const frag = document.createDocumentFragment();
  upcoming.forEach(rem => {
    if (!rem) return;
    frag.appendChild(createReminderCard(rem));
  });
  remindersContainer.appendChild(frag);
}

function renderHomepage(me) {
  wireNewTripButton('homepage.html');
  const trips = getTrips(me.email);
  const upcomingTrip = nextUpcomingTrip(trips);
  const tripBox = renderTripDetailsSection(trips);
  renderUpcomingTripsSection(trips);
  renderSummarySection(trips);
  renderRemindersSection(me.email);
  renderDestinationInsightsSection(upcomingTrip, me.email);

  if (tripBox) {
    setSingletonListener(tripBox, 'click', async (e) => {
      const target = e.target.closest('button');
      if (!target) return;
      const currentId = tripBox?.dataset?.currentTripId;
      if (!currentId) return;

      if (target.id === 'edit-trip-button') {
        e.preventDefault();
        window.location.href = `addvac.html?edit=${encodeURIComponent(currentId)}&redirect=homepage.html`;
        return;
      }

      if (target.id === 'delete-trip-button') {
        e.preventDefault();
        try {
          await deleteTripCascade(me.email, currentId);
        } catch (err) {
          console.error('Failed to delete trip:', err);
          tripBox.innerHTML = "<p class='text-red-500'>Unable to delete trip. Please try again.</p>";
          return;
        }
        renderHomepage(me);
        maybeWireCalendar(me);
      }
    }, '_wlTripActionHandler');
  }
}

// ---------- Budget & Expenses ----------

function getActiveTripForBudget(me) {
  if (!me?.email) return null;
  const params = new URLSearchParams(window.location.search);
  const tripId = params.get("trip");
  const trips = getTrips(me.email) || [];
  if (!Array.isArray(trips) || trips.length === 0) {
    return null;
  }
  const storedId = getStoredTripSelection(me.email);
  const candidates = [tripId, storedId];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const match = trips.find(t => t.id === candidate);
    if (match) {
      return match;
    }
  }
  return nextUpcomingTrip(trips);
}

function getExpenses(tripId) {
  // The budget page frequently calls this helper during initial render before
  // a trip has been selected.  Short-circuit in that scenario to avoid writing
  // under the synthetic key `wl_exp_undefined`.
  if (!tripId) {
    return [];
  }
  return store.get(expensesKey(tripId), []) || [];
}

function areExpensesDirty(tripId) {
  if (!tripId) return false;
  return Boolean(store.get(expensesDirtyKey(tripId), false));
}

function markExpensesDirty(tripId, dirty) {
  if (!tripId) return;
  if (dirty) {
    store.set(expensesDirtyKey(tripId), true);
  } else {
    store.remove(expensesDirtyKey(tripId));
  }
}

function saveExpenses(tripId, rows) {
  // Skip persistence when there is no active trip; this function can be called
  // while the UI is still loading.  Also normalise the payload so we always
  // store an array.
  if (!tripId) {
    return;
  }
  const list = Array.isArray(rows) ? rows : [];
  // Persist expenses to localStorage
  store.set(expensesKey(tripId), list);
  markExpensesDirty(tripId, true);
  // Also persist expenses to Supabase.  Derive the currently
  // authenticated user's email from the session.  If no session
  // exists or the Supabase client isn't initialised, this call does nothing.
  const sess = getSession();
  if (sess && sess.email) {
    const syncPromise = writeExpensesToSupabase(sess.email, tripId, list);
    if (syncPromise && typeof syncPromise.then === 'function') {
      syncPromise.then(() => {
        markExpensesDirty(tripId, false);
      }).catch(() => {
        // Leave the dirty flag set so that local data is preserved until a
        // successful sync completes.
      });
    }
  }
}

function normalisePackingItems(items) {
  const allowed = new Set(['essential', 'useful', 'optional']);
  let mutated = false;
  const list = Array.isArray(items) ? items : [];
  const normalised = list.map((item) => {
    const data = item && typeof item === 'object' ? { ...item } : {};
    if (data.trip_id && !data.tripId) {
      data.tripId = String(data.trip_id);
      mutated = true;
    }
    if (typeof data.urgent === 'undefined' && typeof data.Urgent !== 'undefined') {
      data.urgent = Boolean(data.Urgent);
      mutated = true;
    }
    if (typeof data.importance === 'undefined' && typeof data.Urgency !== 'undefined') {
      const urgencyValue = data.Urgency;
      if (typeof urgencyValue === 'string') {
        data.importance = urgencyValue.toLowerCase();
      } else if (typeof urgencyValue === 'boolean') {
        data.importance = urgencyValue ? 'essential' : 'useful';
      }
      mutated = true;
    }
    if (typeof data.Urgent !== 'undefined') {
      delete data.Urgent;
      mutated = true;
    }
    if (typeof data.Urgency !== 'undefined') {
      delete data.Urgency;
      mutated = true;
    }
    if (!data.id) {
      data.id = uid('pack');
      mutated = true;
    }
    if (typeof data.name !== 'string') {
      data.name = 'Item';
      mutated = true;
    }
    const importance = typeof data.importance === 'string' ? data.importance.toLowerCase() : '';
    if (allowed.has(importance)) {
      if (data.importance !== importance) {
        data.importance = importance;
        mutated = true;
      }
    } else {
      if (importance !== 'useful') {
        mutated = true;
      }
      data.importance = 'useful';
    }
    const urgent = Boolean(data.urgent);
    if (data.urgent !== urgent) {
      data.urgent = urgent;
      mutated = true;
    }
    const packed = Boolean(data.packed);
    if (data.packed !== packed) {
      data.packed = packed;
      mutated = true;
    }
    return data;
  });
  return { items: normalised, mutated };
}

function getPackingItems(tripId) {
  if (!tripId) return [];
  const stored = store.get(packingKey(tripId), []) || [];
  const { items, mutated } = normalisePackingItems(stored);
  if (mutated) {
    store.set(packingKey(tripId), items);
    const sess = getSession();
    if (sess && sess.email) {
      writePackingToSupabase(sess.email, tripId, items);
    }
  }
  return items;
}

function savePackingItems(tripId, items) {
  if (!tripId) return;
  const { items: list } = normalisePackingItems(items);
  store.set(packingKey(tripId), list);
  const sess = getSession();
  if (sess && sess.email) {
    writePackingToSupabase(sess.email, tripId, list);
  }
}

function normaliseReminders(reminders) {
  const list = Array.isArray(reminders) ? reminders : [];
  let mutated = false;
  const items = list.map((reminder) => {
    const data = reminder && typeof reminder === 'object' ? { ...reminder } : {};
    if (!data.id) {
      data.id = uid('rem');
      mutated = true;
    }
    if (data.trip_id && !data.tripId) {
      data.tripId = data.trip_id;
      mutated = true;
    }
    if (typeof data.tripId !== 'string') {
      if (data.tripId != null) {
        data.tripId = String(data.tripId);
      } else {
        data.tripId = '';
      }
      mutated = true;
    }
    if (typeof data.name !== 'string') {
      data.name = 'Reminder';
      mutated = true;
    } else {
      const trimmed = data.name.trim();
      if (trimmed !== data.name) {
        data.name = trimmed || 'Reminder';
        mutated = true;
      }
    }
    if (typeof data.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
      const fallback = formatDateInput(data.date || new Date());
      data.date = fallback || formatDateInput(new Date());
      mutated = true;
    }
    const completed = Boolean(data.completed);
    if (data.completed !== completed) {
      data.completed = completed;
      mutated = true;
    }
    if (data.notes != null && typeof data.notes !== 'string') {
      data.notes = String(data.notes);
      mutated = true;
    }
    return data;
  });
  return { items, mutated };
}

function wireBudgetPage(me) {
  // The vacation selector is a <select> element (see budget.html).  It
  // replaces the previous free‑text input to provide a simpler way to
  // choose an existing trip.
  const vacNameEl = qs("#vacation-select");
  const totalEl   = qs("#total-budget");
  const totalBudgetPlaceholder = totalEl ? totalEl.getAttribute('placeholder') : '';
  const disabledBudgetPlaceholder = 'Create a trip to set a budget';
  const addBtn    = qs("#add-expense-button");
  const table     = qs("#expenses-table");
  const tbody     = table ? qs("tbody", table) : null;
  // Reminder inputs no longer exist on the budget page.  Reminders are managed
  // on a dedicated page.  These variables remain for backwards compatibility
  // but always resolve to null so subsequent code does not operate on them.
  const remNameEl = null;
  const remDateEl = null;
  const forecastEl = qs('#budget-forecast');
  const forecastIconEl = qs('#budget-forecast-icon');
  const forecastMessageEl = qs('#budget-forecast-message');
  const forecastDetailEl = qs('#budget-forecast-detail');
  const budgetInsightsEl = qs('#budget-insights');
  const budgetInsightElements = budgetInsightsEl ? {
    allowance: {
      card: budgetInsightsEl.querySelector('[data-insight-card="allowance"]'),
      value: budgetInsightsEl.querySelector('[data-insight="allowance"]'),
      detail: budgetInsightsEl.querySelector('[data-insight-detail="allowance"]'),
    },
    daily: {
      card: budgetInsightsEl.querySelector('[data-insight-card="daily"]'),
      value: budgetInsightsEl.querySelector('[data-insight="daily"]'),
      detail: budgetInsightsEl.querySelector('[data-insight-detail="daily"]'),
    },
    pace: {
      card: budgetInsightsEl.querySelector('[data-insight-card="pace"]'),
      value: budgetInsightsEl.querySelector('[data-insight="pace"]'),
      detail: budgetInsightsEl.querySelector('[data-insight-detail="pace"]'),
    },
  } : null;
  const defaultBudgetInsightDetail = {
    allowance: 'Select a trip to see your recommended pace.',
    daily: 'We\'ll calculate this once your trip begins.',
    pace: 'Stay within your allowance to end the trip on budget.',
  };
  const paceValueClasses = ['text-emerald-600', 'dark:text-emerald-300', 'text-red-600', 'dark:text-red-300', 'text-gray-900', 'dark:text-white'];
  const paceCardClasses = ['bg-emerald-50', 'dark:bg-emerald-900/20', 'bg-red-50', 'dark:bg-red-900/20'];

  // Handle currency selection changes on the budget page.  When the user selects a
  // different currency, update the converter and refresh the table, chart and
  // top categories accordingly.  The selector may not exist on pages
  // where budgeting is not enabled.
  const currencySelectEl = qs('#currency-select');
  if (currencySelectEl) {
    // Set the dropdown to reflect the current converter state.  If the converter
    // has not yet been initialised, selected remains 'USD'.
    currencySelectEl.value = currencyConverter.selected;
    const handleCurrencyChange = (e) => {
      currencyConverter.setCurrency(e.target.value);
      // Refresh all calculated views.  Since renderTable() calls updateExpensesChart(), it
      // will indirectly update the chart, but we call updateTopCategories() explicitly
      // here to ensure the list is refreshed immediately.
      renderTable();
      updateExpensesChart();
      updateTopCategories();
    };
    bindEventOnce(currencySelectEl, 'change', handleCurrencyChange, 'currency-change');
  }

  if (!(vacNameEl || totalEl || addBtn || table)) return; // not this page

  const allTrips = getTrips(me.email) || [];
  let activeTrip = getActiveTripForBudget(me);

  const chartPalette = [
    '#ef4444', // red
    '#10b981', // green
    '#3b82f6', // blue
    '#f59e0b', // amber
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#f97316', // orange
    '#13a4ec'  // sky
  ];
  const paletteColour = (idx) => chartPalette[idx % chartPalette.length];
  const normaliseCategoryName = (name) => {
    if (typeof name !== 'string') return 'Uncategorised';
    const trimmed = name.trim();
    return trimmed ? trimmed : 'Uncategorised';
  };
  let warnedMissingContext = false;
  const getCanvasContext = (canvas) => {
    if (!canvas || typeof canvas.getContext !== 'function') {
      return null;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx && !warnedMissingContext) {
      console.warn('Expenses chart skipped: unable to acquire a 2D canvas context.');
      warnedMissingContext = true;
    }
    return ctx;
  };

  const updateBudgetInputState = () => {
    if (!totalEl) return;
    const hasTrip = Boolean(activeTrip?.id);
    const isEditing = typeof document !== 'undefined' && document.activeElement === totalEl;

    totalEl.disabled = !hasTrip;
    totalEl.readOnly = !hasTrip;
    totalEl.classList.toggle('opacity-50', !hasTrip);
    totalEl.classList.toggle('cursor-not-allowed', !hasTrip);

    if (!hasTrip) {
      if (!isEditing) {
        totalEl.value = '';
      }
      totalEl.setAttribute(
        'placeholder',
        disabledBudgetPlaceholder || totalBudgetPlaceholder || totalEl.getAttribute('placeholder') || ''
      );
      return;
    }

    const cost = activeTrip.cost;
    if (!isEditing) {
      const hasCost = cost !== undefined && cost !== null && cost !== '';
      totalEl.value = hasCost ? String(cost) : '';
    }
    totalEl.setAttribute('placeholder', totalBudgetPlaceholder || '0');
  };

  const ensureTripQueryMatches = (tripId) => {
    const url = new URL(window.location.href);
    if (tripId) {
      url.searchParams.set('trip', tripId);
    } else {
      url.searchParams.delete('trip');
    }
    const newUrl = url.pathname + url.search + url.hash;
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (newUrl !== current) {
      window.history.replaceState({}, '', newUrl);
    }
  };

  const forecastStyles = {
    danger: {
      container: ['bg-red-50', 'border-red-200', 'dark:bg-red-900/40', 'dark:border-red-400/60'],
      message: ['text-red-900', 'dark:text-red-100'],
      detail: ['text-red-700', 'dark:text-red-200'],
      icon: ['text-red-600', 'dark:text-red-200'],
      iconName: 'warning',
    },
    warning: {
      container: ['bg-amber-50', 'border-amber-200', 'dark:bg-amber-900/40', 'dark:border-amber-400/60'],
      message: ['text-amber-900', 'dark:text-amber-100'],
      detail: ['text-amber-700', 'dark:text-amber-200'],
      icon: ['text-amber-600', 'dark:text-amber-200'],
      iconName: 'error_circle',
    },
    safe: {
      container: ['bg-emerald-50', 'border-emerald-200', 'dark:bg-emerald-900/40', 'dark:border-emerald-400/60'],
      message: ['text-emerald-900', 'dark:text-emerald-100'],
      detail: ['text-emerald-700', 'dark:text-emerald-200'],
      icon: ['text-emerald-600', 'dark:text-emerald-200'],
      iconName: 'task_alt',
    },
  };

  const allForecastContainerClasses = Array.from(new Set(Object.values(forecastStyles).flatMap((style) => style.container || [])));
  const allForecastMessageClasses = Array.from(new Set(Object.values(forecastStyles).flatMap((style) => style.message || [])));
  const allForecastDetailClasses = Array.from(new Set(Object.values(forecastStyles).flatMap((style) => style.detail || [])));
  const allForecastIconClasses = Array.from(new Set(Object.values(forecastStyles).flatMap((style) => style.icon || [])));

  function resetBudgetInsights() {
    if (!budgetInsightElements) return;
    Object.entries(budgetInsightElements).forEach(([key, entry]) => {
      if (!entry) return;
      if (entry.value) {
        paceValueClasses.forEach(cls => entry.value.classList.remove(cls));
        entry.value.classList.add('text-gray-900', 'dark:text-white');
        entry.value.textContent = '—';
      }
      if (entry.detail) {
        entry.detail.textContent = defaultBudgetInsightDetail[key] || '';
      }
      if (key === 'pace' && entry.card) {
        paceCardClasses.forEach(cls => entry.card.classList.remove(cls));
      }
    });
  }

  function calculateBudgetMetrics(trip, totalSpent, totalBudget) {
    if (!trip || !trip.startDate || !trip.endDate) {
      return null;
    }
    const start = toDateOnly(trip.startDate);
    const end = toDateOnly(trip.endDate);
    const today = toDateOnly(new Date());
    if (!start || !end || !today) {
      return null;
    }
    const totalDays = Math.max(1, Math.round((end - start) / MS_PER_DAY) + 1);
    let daysElapsed;
    if (today < start) {
      daysElapsed = 0;
    } else if (today > end) {
      daysElapsed = totalDays;
    } else {
      daysElapsed = Math.floor((today - start) / MS_PER_DAY) + 1;
    }
    const daysRemaining = Math.max(0, totalDays - daysElapsed);
    const dailyAllowance = totalBudget > 0 ? totalBudget / totalDays : 0;
    const actualDaily = daysElapsed > 0 ? totalSpent / daysElapsed : 0;
    const expectedSpend = dailyAllowance * daysElapsed;
    const paceDelta = totalSpent - expectedSpend;
    return { totalDays, daysElapsed, daysRemaining, dailyAllowance, actualDaily, paceDelta, expectedSpend };
  }

  function updateBudgetInsights(totalSpent, totalBudget) {
    if (!budgetInsightElements) return;
    if (!activeTrip || !activeTrip.id) {
      resetBudgetInsights();
      return;
    }
    const metrics = calculateBudgetMetrics(activeTrip, totalSpent, totalBudget);
    if (!metrics) {
      resetBudgetInsights();
      return;
    }

    const allowanceEntry = budgetInsightElements.allowance;
    if (allowanceEntry) {
      if (allowanceEntry.value) {
        paceValueClasses.forEach(cls => allowanceEntry.value.classList.remove(cls));
        allowanceEntry.value.classList.add('text-gray-900', 'dark:text-white');
        allowanceEntry.value.textContent = totalBudget > 0 ? fmtMoney(metrics.dailyAllowance) : '—';
      }
      if (allowanceEntry.detail) {
        if (totalBudget > 0) {
          const remainingText = metrics.daysRemaining === 0
            ? 'Trip ends today.'
            : `${metrics.daysRemaining} day${metrics.daysRemaining === 1 ? '' : 's'} remaining.`;
          allowanceEntry.detail.textContent = `${metrics.totalDays} day trip • ${remainingText}`;
        } else {
          allowanceEntry.detail.textContent = 'Set a budget to unlock guidance.';
        }
      }
    }

    const dailyEntry = budgetInsightElements.daily;
    if (dailyEntry) {
      if (dailyEntry.value) {
        paceValueClasses.forEach(cls => dailyEntry.value.classList.remove(cls));
        dailyEntry.value.classList.add('text-gray-900', 'dark:text-white');
        if (metrics.daysElapsed === 0) {
          dailyEntry.value.textContent = '—';
        } else {
          dailyEntry.value.textContent = fmtMoney(metrics.actualDaily || 0);
        }
      }
      if (dailyEntry.detail) {
        if (metrics.daysElapsed === 0) {
          dailyEntry.detail.textContent = 'Your trip hasn\'t started yet.';
        } else {
          const elapsedText = `${metrics.daysElapsed} day${metrics.daysElapsed === 1 ? '' : 's'} tracked`;
          if (metrics.daysRemaining === 0) {
            dailyEntry.detail.textContent = `${elapsedText}. Trip complete.`;
          } else {
            dailyEntry.detail.textContent = `${elapsedText}. ${metrics.daysRemaining} day${metrics.daysRemaining === 1 ? '' : 's'} remaining.`;
          }
        }
      }
    }

    const paceEntry = budgetInsightElements.pace;
    if (paceEntry) {
      if (paceEntry.card) {
        paceCardClasses.forEach(cls => paceEntry.card.classList.remove(cls));
      }
      if (paceEntry.value) {
        paceValueClasses.forEach(cls => paceEntry.value.classList.remove(cls));
      }
      if (!(totalBudget > 0)) {
        if (paceEntry.value) {
          paceEntry.value.textContent = '—';
          paceEntry.value.classList.add('text-gray-900', 'dark:text-white');
        }
        if (paceEntry.detail) {
          paceEntry.detail.textContent = 'Set a budget to monitor your pace.';
        }
        return;
      }
      if (metrics.daysElapsed === 0) {
        if (paceEntry.value) {
          paceEntry.value.textContent = 'Not started';
          paceEntry.value.classList.add('text-gray-900', 'dark:text-white');
        }
        if (paceEntry.detail) {
          paceEntry.detail.textContent = `Aim for ${fmtMoney(metrics.dailyAllowance)} per day across ${metrics.totalDays} days.`;
        }
        return;
      }
      if (paceEntry.value) {
        const ahead = metrics.paceDelta < -0.5;
        const behind = metrics.paceDelta > 0.5;
        if (ahead) {
          const amount = fmtMoney(Math.abs(metrics.paceDelta));
          paceEntry.value.textContent = `${amount} ahead`;
          paceEntry.value.classList.add('text-emerald-600', 'dark:text-emerald-300');
          if (paceEntry.card) {
            paceEntry.card.classList.add('bg-emerald-50', 'dark:bg-emerald-900/20');
          }
          if (paceEntry.detail) {
            paceEntry.detail.textContent = `You\'ve spent ${amount} less than the ${fmtMoney(metrics.expectedSpend)} expected so far.`;
          }
        } else if (behind) {
          const amount = fmtMoney(metrics.paceDelta);
          paceEntry.value.textContent = `${amount} over`;
          paceEntry.value.classList.add('text-red-600', 'dark:text-red-300');
          if (paceEntry.card) {
            paceEntry.card.classList.add('bg-red-50', 'dark:bg-red-900/20');
          }
          if (paceEntry.detail) {
            paceEntry.detail.textContent = `You\'ve spent ${amount} more than the ${fmtMoney(metrics.expectedSpend)} expected by now.`;
          }
        } else {
          paceEntry.value.textContent = 'On pace';
          paceEntry.value.classList.add('text-gray-900', 'dark:text-white');
          if (paceEntry.detail) {
            paceEntry.detail.textContent = `Spending matches the ${fmtMoney(metrics.expectedSpend)} expected so far.`;
          }
        }
      }
    }
  }

  function computeBudgetForecast(trip, totalSpent, totalBudget) {
    if (!trip || !trip.startDate || !trip.endDate) {
      return null;
    }
    const start = toDateOnly(trip.startDate);
    const end = toDateOnly(trip.endDate);
    const today = toDateOnly(new Date());
    if (!start || !end || !today || end < start) {
      return null;
    }

    const totalDays = Math.max(1, Math.round((end - start) / MS_PER_DAY) + 1);
    let daysElapsed;
    let daysRemaining;
    if (today < start) {
      daysElapsed = 0;
      daysRemaining = totalDays;
    } else if (today > end) {
      daysElapsed = totalDays;
      daysRemaining = 0;
    } else {
      daysElapsed = Math.floor((today - start) / MS_PER_DAY) + 1;
      daysRemaining = Math.max(0, Math.round((end - today) / MS_PER_DAY));
    }

    const validBudget = Number.isFinite(totalBudget) && totalBudget > 0;
    if (!validBudget) {
      const detailParts = [
        `Days left: ${daysRemaining}`,
        `Budget: ${fmtMoney(totalBudget || 0)}`,
      ];
      return {
        severity: 'warning',
        message: 'Set a budget to enable spending forecasts.',
        detail: detailParts.join(' • '),
      };
    }

    const dailyRate = daysElapsed > 0 ? totalSpent / daysElapsed : 0;
    const projectedTotal = totalSpent + dailyRate * daysRemaining;
    const projectedRemaining = totalBudget - projectedTotal;
    const baselineParts = [
      daysElapsed === 0
        ? `Daily allowance: ${fmtMoney(totalBudget / totalDays)}`
        : `Daily spend: ${fmtMoney(dailyRate)}`,
      `Days left: ${daysRemaining}`,
      `Budget: ${fmtMoney(totalBudget)}`,
    ];

    if (totalSpent > totalBudget) {
      const overAmount = totalSpent - totalBudget;
      return {
        severity: 'danger',
        message: `You've exceeded your budget by ${fmtMoney(overAmount)}.`,
        detail: [...baselineParts, `Over by: ${fmtMoney(overAmount)}`].join(' • '),
      };
    }

    if (daysRemaining === 0) {
      if (projectedRemaining >= 0) {
        return {
          severity: 'safe',
          message: `Trip complete with ${fmtMoney(projectedRemaining)} left in your budget.`,
          detail: [...baselineParts, `Remaining: ${fmtMoney(projectedRemaining)}`].join(' • '),
        };
      }
      const over = Math.abs(projectedRemaining);
      return {
        severity: 'danger',
        message: `Trip complete but over budget by ${fmtMoney(over)}.`,
        detail: [...baselineParts, `Over by: ${fmtMoney(over)}`].join(' • '),
      };
    }

    const projectedShortfall = projectedTotal - totalBudget;
    if (projectedShortfall > 0.5 && dailyRate > 0) {
      const budgetRemaining = Math.max(0, totalBudget - totalSpent);
      const daysUntilEmpty = Math.max(0, Math.ceil(budgetRemaining / dailyRate));
      let whenText = 'before the trip ends';
      if (daysUntilEmpty === 0) {
        whenText = 'within the next day';
      } else if (daysUntilEmpty === 1) {
        whenText = 'in about 1 day';
      } else {
        whenText = `in about ${daysUntilEmpty} days`;
      }
      return {
        severity: 'danger',
        message: `At your current spending rate you'll run out of money ${whenText}.`,
        detail: [...baselineParts, `Projected shortfall: ${fmtMoney(projectedShortfall)}`].join(' • '),
      };
    }

    if (daysElapsed === 0) {
      const allowance = totalBudget / totalDays;
      return {
        severity: 'safe',
        message: `Your trip hasn't started yet. Aim for ${fmtMoney(allowance)} per day to stay on budget.`,
        detail: [
          `Daily allowance: ${fmtMoney(allowance)}`,
          `Days left: ${daysRemaining}`,
          `Budget: ${fmtMoney(totalBudget)}`,
          `Projected remaining: ${fmtMoney(projectedRemaining)}`,
        ].join(' • '),
      };
    }

    if (projectedRemaining < -0.5) {
      return {
        severity: 'danger',
        message: `You're on track to exceed your budget by ${fmtMoney(Math.abs(projectedRemaining))}.`,
        detail: [...baselineParts, `Projected shortfall: ${fmtMoney(Math.abs(projectedRemaining))}`].join(' • '),
      };
    }

    const projectedBalance = projectedRemaining < 0 ? 0 : projectedRemaining;
    return {
      severity: 'safe',
      message: `You're on track to finish with ${fmtMoney(projectedBalance)} remaining.`,
      detail: [...baselineParts, `Projected remaining: ${fmtMoney(projectedBalance)}`].join(' • '),
    };
  }

  function updateBudgetForecast(totalSpent, totalBudget) {
    if (!forecastEl || !forecastMessageEl || !forecastDetailEl || !forecastIconEl) {
      return;
    }
    if (!activeTrip || !activeTrip.id) {
      forecastEl.classList.add('hidden');
      return;
    }
    const forecast = computeBudgetForecast(activeTrip, totalSpent, totalBudget);
    if (!forecast) {
      forecastEl.classList.add('hidden');
      return;
    }

    const style = forecastStyles[forecast.severity] || forecastStyles.safe;
    forecastEl.classList.remove('hidden');

    allForecastContainerClasses.forEach((cls) => forecastEl.classList.remove(cls));
    allForecastMessageClasses.forEach((cls) => forecastMessageEl.classList.remove(cls));
    allForecastDetailClasses.forEach((cls) => forecastDetailEl.classList.remove(cls));
    allForecastIconClasses.forEach((cls) => forecastIconEl.classList.remove(cls));

    if (style.container) forecastEl.classList.add(...style.container);
    if (style.message) forecastMessageEl.classList.add(...style.message);
    if (style.detail) forecastDetailEl.classList.add(...style.detail);
    if (style.icon) forecastIconEl.classList.add(...style.icon);

    forecastIconEl.textContent = style.iconName || 'trending_up';
    forecastMessageEl.textContent = forecast.message || '';
    if (forecast.detail) {
      forecastDetailEl.textContent = forecast.detail;
      forecastDetailEl.classList.remove('hidden');
    } else {
      forecastDetailEl.textContent = '';
      forecastDetailEl.classList.add('hidden');
    }
  }

  // Populate the trip selector with all trips and remember the user's choice so
  // the selection persists between visits to the budget and reminders pages.
  if (vacNameEl) {
    const selectedId = populateTripSelectElement(vacNameEl, allTrips, activeTrip?.id || getStoredTripSelection(me.email));
    if (!activeTrip && selectedId) {
      activeTrip = allTrips.find(t => t.id === selectedId) || null;
    }
    setStoredTripSelection(me.email, selectedId || null);
    ensureTripQueryMatches(selectedId);
    const handleTripChange = (ev) => {
      const id = ev.target.value;
      setStoredTripSelection(me.email, id || null);
      const url = new URL(window.location.href);
      if (id) {
        url.searchParams.set('trip', id);
      } else {
        url.searchParams.delete('trip');
      }
      window.location.href = url.pathname + url.search + url.hash;
    };
    bindEventOnce(vacNameEl, 'change', handleTripChange, 'trip-change');
  }

    // Expose the current active trip on the global window object so that
    // helper functions like updateExpensesChart() can access it.  Without
    // this assignment, `updateExpensesChart()` cannot read the locally
    // scoped `activeTrip` variable defined within wireBudgetPage() due to
    // lexical scoping rules.  Storing it globally keeps the state in sync
    // across different functions.  When there is no trip, this will be
    // undefined.
    window.currentActiveTrip = activeTrip || null;
    updateBudgetInputState();

    // Maintain a stack of deleted expenses for the current trip.  Each time the user
    // deletes an expense row, the removed record is pushed onto this stack.  An
    // "Undo Delete" button allows the user to restore the most recently deleted
    // expense.  This demonstrates the use of a dynamic LIFO data structure
    // (stack) to manage undoable actions.  The stack is cleared whenever a new
    // trip is selected or the page reloads, as it only pertains to the current
    // session.
    let deletedStack = [];
    /**
     * Update the visibility of the undo button based on whether there are
     * deleted expenses to restore.  When the stack is empty, the button is
     * hidden; otherwise it is shown to prompt the user that an undo is
     * possible.  This helper should be called after any modification to
     * deletedStack.
     */
    function updateUndoButton() {
      const undoBtn = qs('#undo-delete-btn');
      if (!undoBtn) return;
      if (deletedStack.length > 0) {
        undoBtn.classList.remove('hidden');
      } else {
        undoBtn.classList.add('hidden');
      }
    }
    // Register undo button click handler.  We bind the handler here rather than
    // in the global scope to ensure it captures the correct deletedStack for
    // this wireBudgetPage invocation.  If there is no undo button (e.g. on
    // non-budget pages), this code has no effect.
    const undoBtn = qs('#undo-delete-btn');
    if (undoBtn) {
      const handler = (ev) => {
        ev.preventDefault();
        const last = deletedStack.pop();
        if (last) {
          if (activeTrip?.id) {
            const rows = getExpenses(activeTrip.id);
            rows.push(last);
            saveExpenses(activeTrip.id, rows);
            renderTable();
          }
        }
        updateUndoButton();
      };
      bindEventOnce(undoBtn, 'click', handler, 'undo-delete');
    }

    // Ensure the undo button reflects the current state of the stack when the
    // page loads.  With an empty stack the button should be hidden; if
    // persisted state were restored here in future, this call would
    // update the visibility accordingly.
    updateUndoButton();

    // -----------------------------------------------------------------
    // Populate the vacation selector.  Using a <select> element rather than
    // a free‑text input/datalist makes it easier for users to choose from
    // their existing trips.  We populate the select with the name of each
    // trip as the visible text and the trip id as the value.  When the
    // selection changes we redirect to the budget page with a query
    // parameter so the page reloads with the chosen trip.
    // vacNameEl population handled above.

    // -------------------------------------------------------------------
    // Recent trips on home page
    // Fetch the queue of recently viewed trip IDs and display up to five
    // entries.  Each entry is rendered similarly to the upcoming trips list
    // with a small card showing the trip name and date range.  Clicking
    // anywhere on the card navigates to the budget page for that trip.
    const recentContainer = qs('#home-recent-trips');
    if (recentContainer) {
      recentContainer.innerHTML = '';
      const recentIds = getRecentTrips(me.email) || [];
      // Find the corresponding trip objects in order.  Some IDs may no longer
      // exist if the trip was deleted, so filter those out.  We use the
      // original trips array loaded earlier.
      const recentTrips = [];
      if (Array.isArray(recentIds) && recentIds.length > 0 && Array.isArray(allTrips)) {
        recentIds.forEach(rid => {
          const t = allTrips.find(tp => tp.id === rid);
          if (t) recentTrips.push(t);
        });
      }
      if (recentTrips.length === 0) {
        const msg = document.createElement('p');
        msg.className = 'text-sm opacity-70';
        msg.textContent = 'You haven\'t viewed any trips yet.';
        recentContainer.appendChild(msg);
      } else {
        recentTrips.forEach(trip => {
          const card = document.createElement('div');
          card.className = 'flex items-center gap-4 p-4 rounded-lg bg-primary/10 dark:bg-primary/20 cursor-pointer hover:bg-primary/20 dark:hover:bg-primary/30';
          // icon
          const iconWrap = document.createElement('div');
          iconWrap.className = 'flex items-center justify-center rounded-lg bg-primary/20 dark:bg-primary/30 p-3';
          const icon = document.createElement('span');
          icon.className = 'material-symbols-outlined text-primary';
          icon.textContent = 'travel_explore';
          iconWrap.appendChild(icon);
          card.appendChild(iconWrap);
          // text
          const textWrap = document.createElement('div');
          const nameEl = document.createElement('p');
          nameEl.className = 'font-semibold text-slate-800 dark:text-slate-200';
          nameEl.textContent = trip.name;
          const dateEl = document.createElement('p');
          dateEl.className = 'text-sm text-slate-500 dark:text-slate-400';
          dateEl.textContent = `${trip.startDate} - ${trip.endDate}`;
          textWrap.appendChild(nameEl);
          textWrap.appendChild(dateEl);
          card.appendChild(textWrap);
          // On click navigate to budget page
          card.addEventListener('click', (ev) => {
            ev.preventDefault();
            window.location.href = `budget.html?trip=${encodeURIComponent(trip.id)}`;
          });
          recentContainer.appendChild(card);
        });
      }
    }

    // -------------------------------------------------------------------
    // Expense summary on home page
    // Aggregate all expenses across all trips and summarise by category.
    // This uses a dictionary (key‑value map) to accumulate totals and
    // demonstrates the use of multidimensional arrays via buildExpenseMatrix().
    const summaryContainer = qs('#home-expense-summary');
    if (summaryContainer) {
      summaryContainer.innerHTML = '';
      // Gather all expenses
      let allExpenses = [];
      // Use the full trip list captured earlier in this function; the older
      // code referenced an out-of-scope `trips` variable which triggered a
      // ReferenceError and prevented the dashboard from rendering.
      (allTrips || []).forEach(t => {
        const exps = getExpenses(t.id) || [];
        allExpenses = allExpenses.concat(exps);
      });
      // Compute totals per category.  Use a dictionary to map category names to
      // their cumulative spend.  Amounts are stored in USD; parse as numbers.
      const totals = {};
      allExpenses.forEach(exp => {
        if (!exp) return;
        const cat = (exp.category && exp.category.trim()) ? exp.category.trim() : 'Uncategorised';
        const amt = Number(exp.amount) || 0;
        totals[cat] = (totals[cat] || 0) + amt;
      });
      const entries = mergeSort(Object.entries(totals), (a, b) => b[1] - a[1]);
      if (entries.length === 0) {
        const msg = document.createElement('p');
        msg.className = 'text-sm opacity-70';
        msg.textContent = 'No expenses recorded yet.';
        summaryContainer.appendChild(msg);
      } else {
        // Build a simple table to display category totals
        const table = document.createElement('table');
        table.className = 'min-w-full text-sm text-left';
        const thead = document.createElement('thead');
        thead.innerHTML = '<tr class="text-xs uppercase tracking-wider text-gray-700 dark:text-gray-400"><th class="px-4 py-2">Category</th><th class="px-4 py-2">Total</th></tr>';
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        entries.forEach(([cat, amt]) => {
          const tr = document.createElement('tr');
          tr.className = 'border-t border-gray-200 dark:border-gray-700';
          const tdCat = document.createElement('td');
          tdCat.className = 'px-4 py-2';
          tdCat.textContent = cat;
          const tdVal = document.createElement('td');
          tdVal.className = 'px-4 py-2';
          tdVal.textContent = fmtMoney(amt);
          tr.appendChild(tdCat);
          tr.appendChild(tdVal);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        summaryContainer.appendChild(table);
      }
    }
    if (!activeTrip) {
      if (vacNameEl) vacNameEl.value = '';
      // Disable adding expenses when there is no selected trip
      if (addBtn) addBtn.disabled = true;
      // Clear any existing expense rows that may have been included in the
      // HTML template.  Without this the user could see example expenses
      // belonging to a fictitious trip.
      if (tbody) {
        tbody.innerHTML = '';
      }
      // Reset summary information if present
      const remEl = Array.from(document.querySelectorAll("p.text-3xl")).find(el => el.textContent.trim().startsWith("$") && el.previousElementSibling?.textContent?.toLowerCase().includes("remaining"));
      const spentEl = Array.from(document.querySelectorAll("p.text-3xl")).find(el => el.textContent.trim().startsWith("$") && el.previousElementSibling?.textContent?.toLowerCase().includes("total spent"));
      if (remEl) remEl.textContent = fmtMoney(0);
      if (spentEl) spentEl.textContent = fmtMoney(0);
      const bar = document.querySelector(".bg-primary.h-2.5.rounded-full");
      if (bar) bar.style.width = '0%';
      const pctText = Array.from(document.querySelectorAll("span")).find(el => el.textContent?.trim()?.endsWith("%"));
      if (pctText) pctText.textContent = '0%';
      // Clear the expenses chart and top categories list when no trip is selected
      updateExpensesChart();
      return;
    }

  // Header navigation (if present on this page too)
  const navBudget = qs("#budget-nav");
  on(navBudget, "click", (e) => e.preventDefault());

    // Prefill vacation name and total budget.  The template ships with
    // placeholder values (e.g. "Parisian Escape" and "$5,000").  Here we
    // override them with data from the selected trip.  The name field is
    // read‐only in the UI, but still write the value to keep the form
    // consistent.  For the total budget we populate the numeric cost
    // stored on the trip, falling back to whatever is already in the field
    // when no cost has been set.
    // Populate the vacation name field from the active trip so the dropdown
    // reflects the current selection.  Budget values remain editable on this
    // screen, so users can adjust them without navigating away.
    if (vacNameEl) {
      // Select the active trip in the dropdown so the correct row appears selected
      vacNameEl.value = activeTrip.id;
      // Keep the select enabled to allow switching between trips
    }

    // Record this trip as recently viewed.  Each time a budget page is
    // loaded for a trip, we enqueue the trip ID into the recent trips
    // queue so it can be surfaced on the home page.  This queue
    // persists in localStorage on a per‑user basis and stores a maximum
    // of five entries.
    addRecentTrip(me.email, activeTrip.id);

  function parseCurrency(str) {
    if (typeof str === "number") return str;
    const n = Number(String(str).replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

    // -------------------------------------------------------------------
    // Category modelling for Top Categories feature
    //
    // The following classes model expense categories and collections.  A
    // Category tracks monthly spending via a 12‑element array, allowing
    // multidimensional aggregation.  CategoryCollection manages a set of
    // categories keyed by name.  CategoryBST is a binary search tree
    // used to sort categories by their total spend in descending order.
    class Category {
      constructor(name) {
        this.name = name;
        this.monthlyTotals = new Array(12).fill(0);
      }
      addExpense(amountUSD, monthIndex) {
        const idx = Math.max(0, Math.min(11, monthIndex));
        this.monthlyTotals[idx] += amountUSD;
      }
      getTotal() {
        return this.monthlyTotals.reduce((s, v) => s + v, 0);
      }
    }
    class CategoryCollection {
      constructor() {
        this.categories = {};
      }
      addExpense(name, amountUSD, monthIndex) {
        const key = name && name.trim() ? name.trim() : 'Uncategorised';
        if (!this.categories[key]) {
          this.categories[key] = new Category(key);
        }
        this.categories[key].addExpense(amountUSD, monthIndex);
      }
      toArray() {
        return Object.values(this.categories);
      }
    }
    class CategoryNode {
      constructor(category) {
        this.category = category;
        this.left = null;
        this.right = null;
      }
    }
    class CategoryBST {
      constructor() {
        this.root = null;
      }
      insert(category) {
        const newNode = new CategoryNode(category);
        const insertNode = (root, node) => {
          if (!root) return node;
          if (node.category.getTotal() > root.category.getTotal()) {
            root.left = insertNode(root.left, node);
          } else {
            root.right = insertNode(root.right, node);
          }
          return root;
        };
        this.root = insertNode(this.root, newNode);
      }
      traverseDescending() {
        const result = [];
        (function traverse(node) {
          if (!node) return;
          traverse(node.left);
          result.push(node.category);
          traverse(node.right);
        })(this.root);
        return result;
      }
    }
    function updateTopCategories() {
      const listEl = qs('#top-categories-list');
      if (!listEl) return;
      const rows = activeTrip?.id ? getExpenses(activeTrip.id) : [];
      const coll = new CategoryCollection();
      rows.forEach(r => {
        const catName = normaliseCategoryName(r.category);
        const amountUSD = parseCurrency(r.amount);
        let monthIndex = 0;
        try {
          const d = new Date(r.date);
          if (!isNaN(d)) monthIndex = d.getMonth();
        } catch {}
        coll.addExpense(catName, amountUSD, monthIndex);
      });
      const bst = new CategoryBST();
      coll.toArray().forEach(c => bst.insert(c));
      const sorted = bst.traverseDescending();
      listEl.innerHTML = '';
      if (sorted.length === 0) {
        const li = document.createElement('li');
        li.className = 'text-sm opacity-70';
        li.textContent = 'No expenses yet.';
        listEl.appendChild(li);
        return;
      }
      // Define a palette of distinct colours that correspond to the slices in the
      // expenses breakdown chart.  Reusing the same palette here allows
      // categories in the legend to visually match the chart segments.
      sorted.slice(0, 5).forEach((c, idx) => {
        const li = document.createElement('li');
        li.className = 'flex justify-between items-center gap-2';
        // Colour swatch to match the pie slice
        const swatch = document.createElement('span');
        swatch.style.display = 'inline-block';
        swatch.style.width = '0.75rem';
        swatch.style.height = '0.75rem';
        swatch.style.borderRadius = '0.125rem';
        swatch.style.backgroundColor = paletteColour(idx);
        // Category name
        const nameSpan = document.createElement('span');
        nameSpan.textContent = c.name;
        // Amount text
        const amtSpan = document.createElement('span');
        amtSpan.textContent = currencyConverter.format(c.getTotal());
        li.appendChild(swatch);
        li.appendChild(nameSpan);
        li.appendChild(amtSpan);
        listEl.appendChild(li);
      });
    }

    function summary() {
      // When no trip is selected (e.g. a brand new account) `activeTrip`
      // is null.  Returning an empty data set keeps the UI responsive
      // instead of throwing when event handlers such as the currency
      // selector fire without a trip context.
      const rows = activeTrip?.id ? getExpenses(activeTrip.id) : [];
      const totalSpent = rows.reduce((s, r) => s + parseCurrency(r.amount), 0);
      const totalBudget = parseCurrency(
        // `totalEl.value` is an empty string until populated.  Fall back to
        // the persisted trip cost so the summary uses the best available
        // information when the input has not been touched yet.
        totalEl?.value ? totalEl.value : activeTrip?.cost ?? 0
      );
      const remaining = totalBudget - totalSpent;

    // Try to update summary cards if present
    const cards = qsa(".rounded-xl p + p.text-3xl");
    // But better: locate by text around them—keep it simple and optional.
    return { totalSpent, totalBudget, remaining };
  }

  function renderTable() {
    if (!tbody) return;

    updateBudgetInputState();

    // Without this guard, visiting the budget page before creating any
    // trips caused a "Cannot read properties of null" error whenever the
    // user interacted with the currency selector.  Reset the UI to an empty
    // state so the page remains usable until a trip exists.
    if (!activeTrip || !activeTrip.id) {
      tbody.innerHTML = "";
      updateBudgetInputState();
      qsa('[data-summary="remaining"]').forEach(el => {
        el.textContent = fmtMoney(0);
      });
      qsa('[data-summary="spent"]').forEach(el => {
        el.textContent = fmtMoney(0);
      });
      qsa('[data-summary="percent"]').forEach(el => {
        el.textContent = '0%';
      });
      const bar = qs('#budget-usage-bar');
      if (bar) bar.style.width = '0%';
      updateBudgetForecast(0, 0);
      updateBudgetInsights(0, 0);
      updateExpensesChart();
      updateTopCategories();
      return;
    }

    const rows = getExpenses(activeTrip.id);
    tbody.innerHTML = "";
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
          <td class="px-6 py-4 font-medium">${r.name}</td>
          <td class="px-6 py-4">${r.category}</td>
          <td class="px-6 py-4">${fmtMoney(parseCurrency(r.amount))}</td>
          <td class="px-6 py-4">${r.date}</td>
          <td class="px-6 py-4 text-right space-x-2">
            <button class="edit-row font-medium text-primary hover:underline">Edit</button>
            <button class="del-row font-medium text-red-500 hover:underline">Delete</button>
          </td>
        `;
      tr.dataset.id = r.id;
      tbody.appendChild(tr);
    });

    // Update budget summary visuals if present
    const { totalSpent, totalBudget, remaining } = summary();
    // Update summary values across all elements marked with data-summary attributes.
    const pct = totalBudget > 0 ? Math.min(100, Math.round((totalSpent / totalBudget) * 100)) : 0;
    // Remaining budget fields
    qsa('[data-summary="remaining"]').forEach(el => {
      el.textContent = fmtMoney(remaining);
    });
    // Total spent fields
    qsa('[data-summary="spent"]').forEach(el => {
      el.textContent = fmtMoney(totalSpent);
    });
    // Percentage fields
    qsa('[data-summary="percent"]').forEach(el => {
      el.textContent = `${pct}%`;
    });
    // Update the budget usage bar
    const bar = qs('#budget-usage-bar');
    if (bar) bar.style.width = `${pct}%`;

    updateBudgetForecast(totalSpent, totalBudget);
    updateBudgetInsights(totalSpent, totalBudget);

    // After updating the table and summary values, redraw the expenses chart.  This
    // ensures the visualisation stays in sync with the underlying data.  The
    // implementation of updateExpensesChart() is defined below.
    updateExpensesChart();
  }

  // -- Expense form handling --
  // Grab references to the inline expense form and its fields.  This form lives in
  // Budget.html and replaces prompt() popups for creating and editing expenses.
  const expForm    = qs('#expense-form');
  const expName    = qs('#expense-name');
  const expCat     = qs('#expense-category');
  const expAmt     = qs('#expense-amount');
  const expDate    = qs('#expense-date');
  const expSaveBtn = qs('#expense-save-btn');
  const expCancelBtn = qs('#expense-cancel-btn');
  // Track the id of the expense currently being edited; null when adding
  let editingExpenseId = null;

  function showExpenseForm() {
    if (!expForm) return;
    expForm.classList.remove('hidden');
  }
  function hideExpenseForm() {
    if (!expForm) return;
    expForm.classList.add('hidden');
  }
  function resetExpenseForm() {
    if (!expName || !expCat || !expAmt || !expDate) return;
    expName.value = '';
    expCat.value = '';
    expAmt.value = '';
    // Default the date to today
    expDate.value = new Date().toISOString().slice(0,10);
    editingExpenseId = null;
  }
  // When the Add Expense button is clicked, reveal the form for a new entry
  const handleAddExpense = (e) => {
    e.preventDefault();
    resetExpenseForm();
    showExpenseForm();
  };
  bindEventOnce(addBtn, 'click', handleAddExpense, 'expense-add');
  // Save handler: validate fields and either create a new expense or update an existing one
  const handleExpenseSave = (e) => {
    e.preventDefault();
    if (!expName || !expAmt || !expDate) return;
    const name = expName.value.trim();
    if (!name) {
      // Do not save blank names
      return;
    }
    const category = (expCat?.value?.trim() || 'General');
    const amount = parseCurrency(expAmt.value);
    const date   = expDate.value || new Date().toISOString().slice(0,10);
    const rows = getExpenses(activeTrip.id);
    if (editingExpenseId) {
      const idx = rows.findIndex(r => r.id === editingExpenseId);
      if (idx >= 0) {
        rows[idx] = { ...rows[idx], name, category, amount, date };
      }
    } else {
      rows.push({ id: uid('exp'), name, category, amount, date });
    }
    saveExpenses(activeTrip.id, rows);
    hideExpenseForm();
    resetExpenseForm();
    renderTable();
  };
  bindEventOnce(expSaveBtn, 'click', handleExpenseSave, 'expense-save');
  // Cancel handler: hide form without saving
  const handleExpenseCancel = (e) => {
    e.preventDefault();
    hideExpenseForm();
    resetExpenseForm();
  };
  bindEventOnce(expCancelBtn, 'click', handleExpenseCancel, 'expense-cancel');

  const handleTableClick = (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const tr  = e.target.closest('tr');
    const id  = tr?.dataset?.id;
    if (!id) return;
    const rows = getExpenses(activeTrip.id);
    const idx  = rows.findIndex(r => r.id === id);
    if (idx < 0) return;
    if (btn.classList.contains('del-row')) {
      // Remove the expense and push it onto the deletedStack for undo
      const [removed] = rows.splice(idx, 1);
      if (removed) deletedStack.push(removed);
      saveExpenses(activeTrip.id, rows);
      renderTable();
      // Update undo button visibility
      updateUndoButton();
    } else if (btn.classList.contains('edit-row')) {
      // Populate the expense form with the selected row and switch to edit mode
      const r = rows[idx];
      if (expName) expName.value = r.name;
      if (expCat)  expCat.value  = r.category;
      if (expAmt)  expAmt.value  = r.amount;
      if (expDate) expDate.value = r.date;
      editingExpenseId = id;
      showExpenseForm();
    }
  };
  bindEventOnce(tbody, 'click', handleTableClick, 'table-actions');

    const handleBudgetChange = async () => {
      // When the total budget changes, update the cost on the trip and
      // persist it.  Use parseCurrency to handle formatted input.
      if (!activeTrip?.id) {
        totalEl.value = '';
        updateBudgetInputState();
        return;
      }

      const newBudget = parseCurrency(totalEl.value);
      const tripsAll = getTrips(me.email);
      const idx = tripsAll.findIndex(t => t.id === activeTrip.id);
      if (idx >= 0) {
        tripsAll[idx].cost = newBudget;
        await saveTrips(me.email, tripsAll);
        // also update the in-memory activeTrip reference
        activeTrip.cost = newBudget;
      }
      updateBudgetInputState();
      renderTable();
    };
    bindEventOnce(totalEl, 'change', handleBudgetChange, 'budget-change');

  // Minimal reminders functionality has been removed from the budget page.
  // Reminders are now managed on a separate page (reminders.html).

  renderTable();
  // Notifications are not shown on the budget page.  Reminders and
  // notifications can be managed from reminders.html.

  /*
   * Expenses chart integration
   *
   * Use Chart.js to visualise the distribution of expenses by category.  The
   * chart instance is stored in a closure‑scoped variable so that
   * subsequent updates can mutate its data rather than recreate it.  When
   * called, updateExpensesChart() collects all expenses for the active trip,
   * aggregates them by category and either creates or updates the chart.
   */
  // Use `var` here instead of `let` so the variable is hoisted and
  // available when updateExpensesChart() is invoked before its
  // declaration.  Using `let` caused a temporal dead zone error
  // ("Cannot access 'expensesChart' before initialization") because
  // updateExpensesChart() was called prior to this declaration.
  var expensesChart = null;
  function updateExpensesChart() {
    const canvas = qs('#expenses-chart');
    if (!canvas) return;

    // Ensure the canvas has a visible background so the chart does not disappear
    // against a transparent page.  A light neutral colour is used here
    // instead of a debug tint.  This colour will be mostly hidden once
    // the pie chart slices are drawn.
    canvas.style.backgroundColor = '#f6f7f8';

    // If the Chart.js library failed to load (for example due to network
    // issues), fall back to a custom Canvas drawing.  Without this guard a
    // ReferenceError would terminate the rest of the script, disabling
    // import/export and other functionality on the budget page.  When Chart
    // is unavailable we still want to visualise expenses, so we clear any
    // existing Chart.js instance and use a simple pie chart implementation
    // using the native Canvas API.  The custom drawing code also updates
    // the top categories list so that the UI reflects the current state.
    // Always use the native Canvas fallback for drawing the expense
    // breakdown chart.  Chart.js loading can fail in offline
    // environments, and partial definitions of `Chart` by other
    // libraries may cause unpredictable behaviour.  For reliability,
    // force the custom chart renderer.
    const useCustomChart = true;
    if (useCustomChart) {
      // If a previous Chart.js instance exists, destroy it.  This frees
      // resources and avoids leakages.  The variable "expensesChart"
      // continues to track only Chart.js instances; for our custom chart we
      // simply draw directly on the canvas each time without storing
      // persistent state.
      if (expensesChart && typeof expensesChart.destroy === 'function') {
        try {
          expensesChart.destroy();
        } catch {}
      }
      expensesChart = null;
    }

    // Ensure the canvas has a reasonable height.  Some CSS frameworks collapse
    // empty canvases when a height isn't set via a style property, which
    // prevents Chart.js from rendering anything.  Only set a height if one
    // hasn't already been specified.
    if (!canvas.style.height) {
      canvas.style.minHeight = '300px';
    }

    // Determine the currently active trip for the budget page.  The
    // variable `activeTrip` is only defined within the closure of
    // `wireBudgetPage()`, so it is not visible in this top‑level
    // function.  To ensure the chart always reflects the correct
    // selection, look up the current user and trip on each call.  If
    // there is no session or no upcoming trip, `at` will be null.
    // Attempt to read the active trip from a global set by wireBudgetPage().
    // When navigating between different pages, wireBudgetPage() assigns
    // `window.currentActiveTrip` to the currently selected trip.  Use it
    // preferentially; fall back to computing the trip from the current
    // session if necessary.  This ensures the expenses chart reflects
    // the same selection as the rest of the budget UI.
    let at = null;
    if (window.currentActiveTrip) {
      at = window.currentActiveTrip;
    } else {
      const currentUser = (typeof requireSession === 'function') ? requireSession() : null;
      at = currentUser ? getActiveTripForBudget(currentUser) : null;
    }

    // If there is no active trip or the trip id is undefined, reset the chart
    // and update the top categories to show no data.  This avoids errors when
    // attempting to access properties on a null active trip.
    if (!at || !at.id) {
      const ctx = getCanvasContext(canvas);
      // Clear or reset the chart depending on the rendering mode.  When
      // using the fallback (no Chart.js), clear the canvas entirely.  When
      // Chart.js is available, update or create an empty chart instance.
      if (useCustomChart) {
        if (ctx) {
          const clearWidth = canvas.width || canvas.clientWidth || canvas.getBoundingClientRect().width || 0;
          const clearHeight = canvas.height || canvas.clientHeight || canvas.getBoundingClientRect().height || 0;
          ctx.clearRect(0, 0, clearWidth, clearHeight);
        }
        expensesChart = null;
      } else {
        if (!ctx) {
          updateTopCategories();
          return;
        }
        const emptyLabels = [];
        const emptyData = [];
        const bgColours = [];
        const borderColours = [];
        if (expensesChart) {
          expensesChart.data.labels = emptyLabels;
          expensesChart.data.datasets[0].data = emptyData;
          expensesChart.update();
        } else {
          expensesChart = new Chart(ctx, {
            type: 'pie',
            data: {
              labels: emptyLabels,
              datasets: [{
                label: `Expenses (${currencyConverter.selected})`,
                data: emptyData,
                backgroundColor: bgColours,
                borderColor: borderColours,
                borderWidth: 1
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  position: 'bottom',
                  labels: { color: '#374151' }
                }
              }
            }
          });
        }
      }
      updateTopCategories();
      return;
    }
    // Aggregate expenses by category.  Build totals in USD, then convert to the
    // selected currency on the fly.  Using an intermediate object allows
    // conversion logic to remain centralised in the currencyConverter.
    const rows = at ? getExpenses(at.id) : [];
    const totalsUSD = {};
    rows.forEach((row) => {
      if (!row) return;
      const cat = normaliseCategoryName(row.category);
      const amtUSD = parseCurrency(row.amount);
      totalsUSD[cat] = (totalsUSD[cat] || 0) + amtUSD;
    });
    const labels = Object.keys(totalsUSD);
    // Convert USD totals to the currently selected currency for display
    const data = labels.map(l => currencyConverter.convert(totalsUSD[l]));
    const bgColours = labels.map((_, i) => `${paletteColour(i)}33`);
    const borderColours = labels.map((_, i) => paletteColour(i));
    const ctx = getCanvasContext(canvas);
    // When using the fallback implementation, draw a simple pie chart using
    // native Canvas APIs.  Otherwise use Chart.js.  The fallback draws
    // proportional arcs for each category and leaves legend rendering to the
    // Top Categories list.  If there are no categories (e.g. empty data),
    // clear the canvas.
    if (useCustomChart) {
      // When rendering via the native Canvas fallback we need to ensure
      // the canvas has sensible dimensions before any drawing occurs.  If
      // the canvas size is changed after drawing, the entire drawing
      // buffer is cleared, so set the width/height first.  We compute the
      // desired size from the element's bounding rect, falling back to
      // intrinsic values when the rect reports zero (e.g. when the
      // element isn't yet visible).  Only after the canvas is sized do
      // we clear and repaint its contents.
      const rect = canvas.getBoundingClientRect();
      const width = rect.width || canvas.clientWidth || canvas.width || 300;
      const height = rect.height || canvas.clientHeight || canvas.height || 300;
      // Assigning width/height properties resets the canvas drawing
      // context.  Performing this first ensures subsequent drawing calls
      // operate on a clean slate.
      canvas.width = width;
      canvas.height = height;
      // Mirror the width/height to the element's CSS size.  Without
      // explicitly setting these styles the canvas may be scaled or
      // collapsed by Tailwind's utility classes, resulting in a blank
      // appearance.  Setting the styles ensures the canvas occupies the
      // intended space in the layout.
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      // Obtain fresh context after resizing to avoid using a stale
      // reference.  Some browsers discard the old context when the
      // element is resized.
      const ctx2 = getCanvasContext(canvas);
      if (!ctx2) {
        expensesChart = null;
        updateTopCategories();
        return;
      }
      // Fill a light background so the chart area stands out against the
      // page.  Without this the default transparent canvas could appear
      // invisible when no data is present.
      ctx2.fillStyle = '#f0f0f0';
      ctx2.fillRect(0, 0, width, height);

      // Clear any residual tint applied before drawing.  Setting the
      // background colour to ``transparent`` ensures that the slices
      // and legend draw cleanly without unexpected overlays.
      canvas.style.backgroundColor = 'transparent';
      // Compute total to determine slice sizes
      const total = data.reduce((sum, v) => sum + (v || 0), 0);
      const radius = Math.min(width, height) / 2 - 10;
      const centerX = width / 2;
      const centerY = height / 2;
      let startAngle = -0.5 * Math.PI;
      // Draw pie slices only when there is data
      if (total > 0) {
        data.forEach((value, idx) => {
          const sliceAngle = (value / total) * 2 * Math.PI;
          ctx2.beginPath();
          ctx2.moveTo(centerX, centerY);
          ctx2.fillStyle = paletteColour(idx);
          ctx2.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
          ctx2.closePath();
          ctx2.fill();
          startAngle += sliceAngle;
        });
      }
      // No additional debug markers are drawn in production.  If you
      // need to verify the rendering logic, consider adding markers
      // temporarily during development.
      // No Chart.js instance is maintained for custom charts
      expensesChart = null;
    } else {
      if (!ctx) {
        expensesChart = null;
        updateTopCategories();
        return;
      }
      if (expensesChart) {
        // Update existing chart and dataset label to reflect currency
        expensesChart.data.labels = labels;
        expensesChart.data.datasets[0].data = data;
        expensesChart.data.datasets[0].backgroundColor = bgColours;
        expensesChart.data.datasets[0].borderColor = borderColours;
        expensesChart.data.datasets[0].label = `Expenses (${currencyConverter.selected})`;
        expensesChart.update();
      } else {
        expensesChart = new Chart(ctx, {
          type: 'pie',
          data: {
            labels: labels,
            datasets: [{
              label: `Expenses (${currencyConverter.selected})`,
              data: data,
              backgroundColor: bgColours,
              borderColor: borderColours,
              borderWidth: 1
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'bottom',
                labels: { color: '#374151' }
              }
            }
          }
        });
      }
    }
    // Refresh the top categories list whenever the chart is rendered or updated
    updateTopCategories();
  }

  // Immediately draw the chart on initial page load
  updateExpensesChart();

  // Data import/export functionality has been removed at the user's request.  The
  // buttons, inputs and associated event handlers are no longer present in the
  // budget page, so there is nothing to wire up here.
}

// ---------- Minimal Calendar Marking (optional) ----------
function maybeWireCalendar(me) {
  // Dynamically populate upcoming trips on the calendar page.  If the
  // template includes a container with id "calendar-upcoming-list", we
  // build a list of the user's trips there.  When there are no trips,
  // we display a simple message.  If the original calendar-month
  // placeholders (#calendar-month and #calendar-trips) exist, we still
  // populate them as a fallback.
  // Safely compute the user's trips.  When no session exists the `me`
  // argument may be null or undefined.  Previously this caused an error
  // because we assumed `me.email` always exists.  To make the calendar
  // render for logged‑out users too, fall back to an empty list when
  // no email is available.
  let trips = [];
  try {
    const email = me && me.email ? me.email : null;
    trips = email ? getTrips(email) : [];
  } catch {
    trips = [];
  }
  const currentPath = (location.pathname || '').toLowerCase();
  const calendarRedirect = currentPath.includes('calender') ? 'calender.html' : 'homepage.html';
  wireNewTripButton(calendarRedirect);
  // 1) Populate the upcoming trips list if present.  We no longer return early
  // because the dynamic calendar should still be wired up when the list exists.
  {
    const list = qs('#calendar-upcoming-list');
    if (list) {
      list.innerHTML = '';
      if (!trips || trips.length === 0) {
        const li = document.createElement('li');
        li.className = 'text-sm opacity-70';
        li.textContent = 'No upcoming trips.';
        list.appendChild(li);
      } else {
        const sorted = mergeSort(trips.slice(), (a, b) => new Date(a.startDate) - new Date(b.startDate));
        sorted.forEach(t => {
          const li = document.createElement('li');
          li.className = 'flex items-center gap-4 p-3 rounded-lg bg-primary/10 dark:bg-primary/20 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors';
          // icon container
          const iconWrap = document.createElement('div');
          iconWrap.className = 'flex items-center justify-center rounded-lg bg-primary/20 dark:bg-primary/30 p-3';
          const icon = document.createElement('span');
          icon.className = 'material-symbols-outlined text-primary';
          icon.textContent = 'travel_explore';
          iconWrap.appendChild(icon);
          li.appendChild(iconWrap);
          // text container
          const textWrap = document.createElement('div');
          const nameEl = document.createElement('p');
          nameEl.className = 'font-semibold text-slate-800 dark:text-slate-200';
          nameEl.textContent = t.name;
          const dateEl = document.createElement('p');
          dateEl.className = 'text-sm text-slate-500 dark:text-slate-400';
          dateEl.textContent = `${t.startDate} - ${t.endDate}`;
          textWrap.appendChild(nameEl);
          textWrap.appendChild(dateEl);
          li.appendChild(textWrap);
          list.appendChild(li);
        });
      }
    }
  }

  // 3) Populate the trip card list if present.  This section provides a
  // summary card for each trip with actions to view the budget, edit or
  // delete the trip.  Without this section the trips page felt empty
  // and duplicated information available elsewhere.  The new cards
  // complement the upcoming list and calendar by giving a quick
  // overview of all vacations.
  const cardsEl = qs('#trips-cards');
  const searchEl = qs('#trip-search');
  // Define a helper to render the cards given a filter string
  function renderCards(filter = '') {
    if (!cardsEl) return;
    cardsEl.innerHTML = '';
    const query = (filter || '').toLowerCase();
    const filtered = (!trips || trips.length === 0) ? [] : trips.filter(t => {
      const name = (t.name || '').toLowerCase();
      const loc  = (t.location || '').toLowerCase();
      return !query || name.includes(query) || loc.includes(query);
    });
    if (filtered.length === 0) {
      const msg = document.createElement('p');
      msg.className = 'text-sm opacity-70';
      msg.textContent = trips && trips.length > 0 ? 'No trips match your search.' : 'You have not created any trips yet.';
      cardsEl.appendChild(msg);
      return;
    }
    filtered.forEach(trip => {
      const card = document.createElement('div');
      card.className = 'bg-white dark:bg-slate-900 p-4 rounded-lg shadow-sm flex flex-col gap-2';
      // Header: name and actions
      const header = document.createElement('div');
      header.className = 'flex justify-between items-start';
      const titleWrap = document.createElement('div');
      const nameEl = document.createElement('h4');
      nameEl.className = 'font-bold text-lg';
      nameEl.textContent = trip.name;
      const locEl = document.createElement('p');
      locEl.className = 'text-sm text-gray-500 dark:text-gray-400';
      locEl.textContent = trip.location;
      titleWrap.appendChild(nameEl);
      titleWrap.appendChild(locEl);
      header.appendChild(titleWrap);
      // Actions container
      const actions = document.createElement('div');
      actions.className = 'flex gap-2';
      // Edit button
      const editBtn = document.createElement('button');
      editBtn.className = 'text-primary text-sm hover:underline';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        window.location.href = `addvac.html?edit=${trip.id}&redirect=calender.html`;
      });
      // Duplicate button
      const dupBtn = document.createElement('button');
      dupBtn.className = 'text-green-600 text-sm hover:underline';
      dupBtn.textContent = 'Duplicate';
      dupBtn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        // Create a deep copy of the trip with a new ID and timestamps
        const newTrip = { ...trip, id: uid('trip'), createdAt: nowISO(), updatedAt: nowISO() };
        trips.push(newTrip);
        await saveTrips(me.email, trips);
        // Re-render cards to include the duplicate
        renderCards(query);
        maybeWireCalendar(me);
      });
      // Delete button
      const delBtn = document.createElement('button');
      delBtn.className = 'text-red-500 text-sm hover:underline';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        const confirmed = confirm('Delete this trip? This action cannot be undone.');
        if (!confirmed) return;
        try {
          const updated = await deleteTripCascade(me.email, trip.id);
          trips = Array.isArray(updated) ? updated : (getTrips(me.email) || []);
        } catch (err) {
          console.error('Failed to delete trip:', err);
          return;
        }
        renderCards(query);
        maybeWireCalendar(me);
      });
      actions.appendChild(editBtn);
      actions.appendChild(dupBtn);
      actions.appendChild(delBtn);
      header.appendChild(actions);
      card.appendChild(header);
      const datesEl = document.createElement('p');
      datesEl.className = 'text-sm text-gray-500 dark:text-gray-400';
      datesEl.textContent = `${trip.startDate} - ${trip.endDate}`;
      card.appendChild(datesEl);
      if (trip.cost != null) {
        const costEl = document.createElement('p');
        costEl.className = 'text-sm text-gray-500 dark:text-gray-400';
        costEl.textContent = `Cost: ${fmtMoney(trip.cost)}`;
        card.appendChild(costEl);
      }
      const budgetLink = document.createElement('a');
      budgetLink.className = 'text-sm font-medium text-primary hover:underline mt-1';
      budgetLink.href = `budget.html?trip=${trip.id}`;
      budgetLink.textContent = 'View Budget';
      card.appendChild(budgetLink);
      cardsEl.appendChild(card);
    });
  }
  // Initial render with no filter
  renderCards('');
  // Bind search input to filter the cards in real time
  if (searchEl) {
    searchEl.removeEventListener('input', searchEl._wlTripSearchHandler || (()=>{}));
    const handler = (ev) => {
      renderCards(ev.target.value);
    };
    searchEl._wlTripSearchHandler = handler;
    searchEl.addEventListener('input', handler);
  }
  // 2) Dynamic calendar rendering.  If a calendar grid exists on the page (identified by
  // the #calendar-grid id), build a monthly calendar that can be navigated via
  // previous/next buttons and highlight vacation start dates and ranges.  If
  // no such elements exist, leave the fallback logic in place.
  const gridEl  = qs('#calendar-grid');
  const labelEl = qs('#calendar-month-label');
  const prevBtn = qs('#prev-month-btn');
  const nextBtn = qs('#next-month-btn');
  if (gridEl && labelEl) {
    if (!gridEl.dataset.wlLayoutApplied) {
      gridEl.style.display = 'grid';
      gridEl.style.gridTemplateColumns = 'repeat(7, minmax(0, 1fr))';
      gridEl.style.gap = '0.25rem';
      gridEl.style.gridAutoRows = 'minmax(2.5rem, auto)';
      gridEl.dataset.wlLayoutApplied = '1';
    }
    // Always initialise the current month. Use a fresh Date so modifications
    // do not persist across invocations.
    const currentDate = new Date();
    currentDate.setDate(1);

    // Helper to draw the month. Catch errors to ensure the calendar still draws
    // even if trip data is malformed or missing.
    function renderCalendar() {
      try {
        gridEl.innerHTML = '';
        const year  = currentDate.getFullYear();
        const month = currentDate.getMonth();
        labelEl.textContent = currentDate.toLocaleString(undefined, { month: 'long', year: 'numeric' });
        const firstDay    = new Date(year, month, 1);
        const startOffset = firstDay.getDay();
        const gridStart   = new Date(year, month, 1 - startOffset);
        const totalCells  = 42;
        for (let i = 0; i < totalCells; i++) {
          const cellDate = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
          const iso      = cellDate.toISOString().split('T')[0];
          const cell     = document.createElement('div');
          cell.textContent = cellDate.getDate();
          cell.dataset.date = iso;
          cell.className = 'py-2 rounded-full cursor-default flex items-center justify-center';
          if (cellDate.getMonth() !== month) {
            cell.classList.add('opacity-40');
          }
          const list = Array.isArray(trips) ? trips : [];
          const inRange = list.some(t => iso >= t.startDate && iso <= t.endDate);
          const isStart = list.some(t => t.startDate === iso);
          if (inRange) {
            cell.classList.add('bg-primary/10', 'dark:bg-primary/20', 'text-primary');
          }
          if (isStart) {
            cell.classList.remove('bg-primary/10', 'dark:bg-primary/20', 'text-primary');
            cell.classList.add('bg-primary', 'text-white');
          }
          gridEl.appendChild(cell);
        }
      } catch (err) {
        console.error('Failed to render calendar', err);
      }
    }
    // Draw the initial month
    renderCalendar();
    // Month navigation
    if (prevBtn) {
      prevBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderCalendar();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        currentDate.setMonth(currentDate.getMonth() + 1);
        renderCalendar();
      });
    }
    // Do not return here; allow fallback code to run if legacy placeholders exist
  }
  // Fallback: original behaviour populating #calendar-month and #calendar-trips
  const monthEl = qs('#calendar-month');
  if (monthEl) monthEl.textContent = `Trips: ${trips.length}`;
  const legacyList = qs('#calendar-trips');
  if (legacyList) {
    legacyList.innerHTML = '';
    trips.forEach(t => {
      const li = document.createElement('li');
      li.textContent = `${t.name} — ${t.startDate} → ${t.endDate}`;
      legacyList.appendChild(li);
    });
  }
}

// ---------- Reminders page wiring ----------
/**
 * Wire up the reminders page.  This function initialises the trip
 * selector, displays all reminders for the selected trip and
 * provides a form to add and delete reminders.  Reminders are
 * persisted to Supabase via writeRemindersToSupabase() and cached in
 * localStorage.  If the page does not contain the expected elements
 * (e.g. not on reminders.html) this function exits immediately.
 *
 * @param {Object} me The authenticated user (from requireSession())
 */
function wireRemindersPage(me) {
  const tripSelect = qs('#rem-trip-select');
  const listEl    = qs('#reminders-list');
  const nameEl    = qs('#rem-new-name');
  const dateEl    = qs('#rem-new-date');
  const addBtn    = qs('#rem-add-btn');
  if (!tripSelect || !listEl) return; // not on reminders page
  const trips = getTrips(me.email) || [];
  const suggestionsSection = qs('#reminder-suggestions');
  const suggestionsListEl = qs('#reminder-suggestions-list');
  const suggestionsEmptyEl = qs('#reminder-suggestions-empty');
  const suggestionsAddAllBtn = qs('#reminder-add-all');
  const metricsContainer = qs('#reminder-metrics');

  const suggestionRules = [
    { offsetDays: 7, name: 'Check passport', description: '7 days before departure' },
    { offsetDays: 2, name: 'Pack luggage', description: '48 hours before departure' },
    { offsetDays: 0, name: 'Leave for airport', description: 'Departure day' },
  ];

  const statusStyles = {
    completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
    overdue: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
    today: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
    soon: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200',
    upcoming: 'bg-slate-200 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200',
    unknown: 'bg-slate-200 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200',
  };

  function getReminderStatus(reminder) {
    const dueDate = toDateOnly(reminder?.date);
    const today = toDateOnly(new Date());
    if (reminder?.completed) {
      const diff = dueDate && today ? Math.round((dueDate - today) / MS_PER_DAY) : null;
      return {
        key: 'completed',
        label: 'Completed',
        className: statusStyles.completed,
        daysUntil: diff,
      };
    }
    if (!dueDate || !today) {
      return {
        key: 'unknown',
        label: 'Date needed',
        className: statusStyles.unknown,
        daysUntil: null,
      };
    }
    const diff = Math.round((dueDate - today) / MS_PER_DAY);
    if (diff < 0) {
      const overdueDays = Math.abs(diff);
      return {
        key: 'overdue',
        label: overdueDays === 1 ? '1 day overdue' : `${overdueDays} days overdue`,
        className: statusStyles.overdue,
        daysUntil: diff,
      };
    }
    if (diff === 0) {
      return {
        key: 'today',
        label: 'Due today',
        className: statusStyles.today,
        daysUntil: diff,
      };
    }
    if (diff === 1) {
      return {
        key: 'soon',
        label: 'Due in 1 day',
        className: statusStyles.soon,
        daysUntil: diff,
      };
    }
    if (diff <= 3) {
      return {
        key: 'soon',
        label: `Due in ${diff} days`,
        className: statusStyles.soon,
        daysUntil: diff,
      };
    }
    return {
      key: 'upcoming',
      label: `Due in ${diff} days`,
      className: statusStyles.upcoming,
      daysUntil: diff,
    };
  }

  function formatRelativeDays(days) {
    if (days == null) return '';
    if (days === 0) return 'today';
    if (days === 1) return 'in 1 day';
    return `in ${days} days`;
  }

  function updateReminderMetrics(remindersForTrip) {
    if (!metricsContainer) {
      return;
    }
    if (!tripSelect.value) {
      metricsContainer.classList.add('hidden');
      metricsContainer.innerHTML = '';
      return;
    }
    const reminders = Array.isArray(remindersForTrip) ? remindersForTrip : [];
    metricsContainer.classList.remove('hidden');
    let overdueCount = 0;
    let dueSoonCount = 0;
    let completedCount = 0;
    let nextDiff = null;
    reminders.forEach((rem) => {
      const status = getReminderStatus(rem);
      if (status.key === 'completed') {
        completedCount += 1;
        return;
      }
      if (status.key === 'overdue') {
        overdueCount += 1;
      }
      if (status.daysUntil != null && status.daysUntil >= 0) {
        if (status.key === 'today' || status.daysUntil <= 3) {
          dueSoonCount += 1;
        }
        if (nextDiff == null || status.daysUntil < nextDiff) {
          nextDiff = status.daysUntil;
        }
      }
    });
    const nextDetail = nextDiff == null
      ? 'No upcoming reminders scheduled.'
      : nextDiff === 0
        ? 'Next reminder is due today.'
        : `Next reminder ${formatRelativeDays(nextDiff)}.`;
    const cards = [
      {
        key: 'overdue',
        label: 'Overdue',
        value: overdueCount,
        container: 'border border-red-200 bg-red-50 dark:bg-red-900/30 dark:border-red-500/40',
        valueClass: 'text-red-600 dark:text-red-300',
        detail: overdueCount ? 'Handle these as soon as possible.' : 'All reminders are on schedule.',
      },
      {
        key: 'dueSoon',
        label: 'Due Soon',
        value: dueSoonCount,
        container: 'border border-amber-200 bg-amber-50 dark:bg-amber-900/30 dark:border-amber-500/40',
        valueClass: 'text-amber-600 dark:text-amber-300',
        detail: dueSoonCount ? nextDetail : 'Nothing urgent in the next few days.',
      },
      {
        key: 'completed',
        label: 'Completed',
        value: completedCount,
        container: 'border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/30 dark:border-emerald-500/40',
        valueClass: 'text-emerald-600 dark:text-emerald-300',
        detail: completedCount ? 'Nice work ticking things off!' : 'Mark reminders as finished when you complete them.',
      },
    ];
    metricsContainer.innerHTML = '';
    cards.forEach((card) => {
      const wrapper = document.createElement('div');
      wrapper.className = `rounded-lg p-4 ${card.container}`;
      const title = document.createElement('p');
      title.className = 'text-sm font-medium text-gray-700 dark:text-gray-300';
      title.textContent = card.label;
      const value = document.createElement('p');
      value.className = `mt-1 text-2xl font-bold ${card.valueClass}`;
      value.textContent = String(card.value);
      const detail = document.createElement('p');
      detail.className = 'mt-2 text-xs text-gray-600 dark:text-gray-400';
      detail.textContent = card.detail;
      wrapper.appendChild(title);
      wrapper.appendChild(value);
      wrapper.appendChild(detail);
      metricsContainer.appendChild(wrapper);
    });
  }

  const syncTripQuery = (tripId) => {
    const url = new URL(window.location.href);
    if (tripId) {
      url.searchParams.set('trip', tripId);
    } else {
      url.searchParams.delete('trip');
    }
    const newUrl = url.pathname + url.search + url.hash;
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (newUrl !== current) {
      window.history.replaceState({}, '', newUrl);
    }
  };

  const getTripById = (tripId) => trips.find(t => t.id === tripId);

  function buildSuggestionCandidates(trip) {
    if (!trip || !trip.id || !trip.startDate) {
      return [];
    }
    const start = toDateOnly(trip.startDate);
    if (!start) {
      return [];
    }
    const today = toDateOnly(new Date());
    const allRems = getReminders(me.email) || [];
    const existing = new Set(
      allRems
        .filter(r => r.tripId === trip.id)
        .map(r => `${r.name}|${r.date}`)
    );
    const suggestions = suggestionRules.map((rule) => {
      const target = new Date(start.getTime() - (rule.offsetDays || 0) * MS_PER_DAY);
      return {
        name: rule.name,
        date: formatDateInput(target),
        description: rule.description,
        offsetDays: rule.offsetDays,
      };
    }).filter((s) => {
      if (!s.date) return false;
      const suggestionDate = toDateOnly(s.date);
      if (today && suggestionDate && suggestionDate < today) {
        return false;
      }
      const key = `${s.name}|${s.date}`;
      if (existing.has(key)) {
        return false;
      }
      return true;
    });
    return mergeSort(suggestions, (a, b) => new Date(a.date) - new Date(b.date));
  }

  function addReminderFromSuggestion(suggestion) {
    const tripId = tripSelect.value;
    if (!tripId || !suggestion) {
      return;
    }
    const allRems = getReminders(me.email) || [];
    const key = `${suggestion.name}|${suggestion.date}`;
    const exists = allRems.some(r => r.tripId === tripId && `${r.name}|${r.date}` === key);
    if (exists) {
      return;
    }
    const updated = [...allRems, { id: uid('rem'), tripId, name: suggestion.name, date: suggestion.date, completed: false }];
    saveReminders(me.email, updated);
    renderList();
  }

  function renderSuggestions() {
    if (!suggestionsSection || !suggestionsListEl) {
      return;
    }
    const tripId = tripSelect.value;
    const trip = getTripById(tripId);
    if (!trip) {
      suggestionsSection.classList.add('hidden');
      return;
    }

    const suggestions = buildSuggestionCandidates(trip);
    suggestionsSection.classList.remove('hidden');
    suggestionsListEl.innerHTML = '';
    const hasSuggestions = suggestions.length > 0;

    if (suggestionsEmptyEl) {
      if (hasSuggestions) {
        suggestionsEmptyEl.textContent = '';
        suggestionsEmptyEl.classList.add('hidden');
      } else {
        suggestionsEmptyEl.textContent = 'No smart suggestions right now. We\'ll surface new tasks as your departure approaches.';
        suggestionsEmptyEl.classList.remove('hidden');
      }
    }

    if (suggestionsAddAllBtn) {
      suggestionsAddAllBtn.classList.toggle('hidden', !hasSuggestions);
      suggestionsAddAllBtn.disabled = !hasSuggestions;
      suggestionsAddAllBtn.classList.toggle('opacity-50', !hasSuggestions);
      suggestionsAddAllBtn.classList.toggle('cursor-not-allowed', !hasSuggestions);
    }

    if (!hasSuggestions) {
      return;
    }

    suggestions.forEach((suggestion) => {
      const li = document.createElement('li');
      li.className = 'flex items-center justify-between gap-3 rounded-lg bg-blue-50 dark:bg-slate-800/60 px-4 py-3';

      const textWrap = document.createElement('div');
      const title = document.createElement('p');
      title.className = 'font-medium text-blue-900 dark:text-blue-100';
      title.textContent = suggestion.name;
      const detail = document.createElement('p');
      detail.className = 'text-sm text-blue-800/80 dark:text-blue-200/80';
      detail.textContent = `${suggestion.description} • ${suggestion.date}`;
      textWrap.appendChild(title);
      textWrap.appendChild(detail);

      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'text-sm font-semibold text-primary hover:text-primary/80';
      addButton.textContent = 'Add';
      addButton.addEventListener('click', (ev) => {
        ev.preventDefault();
        addReminderFromSuggestion(suggestion);
      });

      li.appendChild(textWrap);
      li.appendChild(addButton);
      suggestionsListEl.appendChild(li);
    });
  }

  const candidateId = new URLSearchParams(window.location.search).get('trip') || getStoredTripSelection(me.email);
  const selectedId = populateTripSelectElement(tripSelect, trips, candidateId);
  setStoredTripSelection(me.email, selectedId || null);
  syncTripQuery(selectedId);

  function updateAddButtonState() {
    if (!addBtn) return;
    const hasTrip = Boolean(tripSelect.value);
    addBtn.disabled = !hasTrip;
    addBtn.classList.toggle('opacity-50', !hasTrip);
    addBtn.classList.toggle('cursor-not-allowed', !hasTrip);
  }
  /**
   * Render the list of reminders for the currently selected trip.
   * If no trip is selected the list is cleared.  Each reminder is
   * displayed with its name and date along with a delete button.
   */
  function renderList() {
    listEl.innerHTML = '';
    const tripId = tripSelect.value;
    if (!tripId) {
      if (metricsContainer) {
        metricsContainer.classList.add('hidden');
        metricsContainer.innerHTML = '';
      }
      const msg = document.createElement('li');
      msg.className = 'text-sm text-gray-600 dark:text-gray-400';
      msg.textContent = trips.length > 0 ? 'Select a trip to view reminders.' : 'Create a trip to add reminders.';
      listEl.appendChild(msg);
      renderSuggestions();
      return;
    }

    const allRems = getReminders(me.email) || [];
    const rems = allRems.filter(r => r.tripId === tripId);
    const sortedRems = mergeSort(rems, (a, b) => {
      const aCompleted = Boolean(a?.completed);
      const bCompleted = Boolean(b?.completed);
      if (aCompleted !== bCompleted) {
        return Number(aCompleted) - Number(bCompleted);
      }
      const dateA = toDateOnly(a?.date);
      const dateB = toDateOnly(b?.date);
      const tsA = dateA ? dateA.getTime() : Number.POSITIVE_INFINITY;
      const tsB = dateB ? dateB.getTime() : Number.POSITIVE_INFINITY;
      if (tsA === tsB) {
        return (a?.name || '').localeCompare(b?.name || '', undefined, { sensitivity: 'base' });
      }
      return tsA - tsB;
    });

    updateReminderMetrics(sortedRems);

    if (sortedRems.length === 0) {
      const msg = document.createElement('li');
      msg.className = 'text-sm text-gray-600 dark:text-gray-400';
      msg.textContent = 'No reminders yet.';
      listEl.appendChild(msg);
      renderSuggestions();
      return;
    }

    sortedRems.forEach((reminder) => {
      const li = document.createElement('li');
      li.className = 'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60';

      const leftWrap = document.createElement('div');
      leftWrap.className = 'flex items-start gap-3';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'mt-1 h-4 w-4 text-primary border-gray-300 rounded';
      checkbox.checked = Boolean(reminder.completed);
      checkbox.addEventListener('change', () => {
        const updated = allRems.map((item) => (
          item.id === reminder.id ? { ...item, completed: checkbox.checked } : item
        ));
        saveReminders(me.email, updated);
        renderList();
      });

      const textWrap = document.createElement('div');
      const title = document.createElement('p');
      title.className = checkbox.checked
        ? 'font-medium line-through text-gray-500 dark:text-gray-400'
        : 'font-medium text-gray-900 dark:text-white';
      title.textContent = reminder.name || 'Reminder';

      const meta = document.createElement('div');
      meta.className = 'mt-1 flex flex-wrap items-center gap-2 text-xs';
      const dateBadge = document.createElement('span');
      dateBadge.className = 'inline-flex items-center rounded-full bg-gray-200 dark:bg-gray-700/60 px-2 py-0.5 text-gray-700 dark:text-gray-200';
      dateBadge.textContent = reminder.date || 'No date';
      meta.appendChild(dateBadge);

      const status = getReminderStatus(reminder);
      const statusBadge = document.createElement('span');
      statusBadge.className = `inline-flex items-center rounded-full px-2 py-0.5 font-semibold ${status.className}`;
      statusBadge.textContent = status.label;
      meta.appendChild(statusBadge);

      textWrap.appendChild(title);
      textWrap.appendChild(meta);

      leftWrap.appendChild(checkbox);
      leftWrap.appendChild(textWrap);

      const controls = document.createElement('div');
      controls.className = 'flex flex-wrap items-center gap-3 sm:justify-end';

      const snoozeBtn = document.createElement('button');
      snoozeBtn.type = 'button';
      snoozeBtn.className = 'text-sm text-primary hover:text-primary/80';
      snoozeBtn.textContent = 'Snooze 1 day';
      if (status.key === 'completed') {
        snoozeBtn.disabled = true;
        snoozeBtn.classList.add('opacity-50', 'cursor-not-allowed');
      }
      snoozeBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (snoozeBtn.disabled) return;
        const due = toDateOnly(reminder.date) || toDateOnly(new Date());
        const next = due ? new Date(due.getTime() + MS_PER_DAY) : new Date();
        const updated = allRems.map((item) => (
          item.id === reminder.id
            ? { ...item, date: formatDateInput(next), completed: false }
            : item
        ));
        saveReminders(me.email, updated);
        renderList();
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'text-sm text-red-500 hover:text-red-700';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const updated = allRems.filter((item) => item.id !== reminder.id);
        saveReminders(me.email, updated);
        renderList();
      });

      controls.appendChild(snoozeBtn);
      controls.appendChild(delBtn);

      li.appendChild(leftWrap);
      li.appendChild(controls);

      listEl.appendChild(li);
    });
    renderSuggestions();
  }
  // When trip selection changes, refresh the reminders list and persist the choice
  const handleTripSelectChange = () => {
    const id = tripSelect.value;
    setStoredTripSelection(me.email, id || null);
    syncTripQuery(id);
    updateAddButtonState();
    renderList();
  };
  bindEventOnce(tripSelect, 'change', handleTripSelectChange, 'reminders-trip');
  if (suggestionsAddAllBtn) {
    const handleAddAllSuggestions = (ev) => {
      ev.preventDefault();
      const tripId = tripSelect.value;
      const trip = getTripById(tripId);
      if (!trip) {
        return;
      }
      const suggestions = buildSuggestionCandidates(trip);
      if (!suggestions.length) {
        return;
      }
      const allRems = getReminders(me.email) || [];
      const existing = new Set(
        allRems
          .filter(r => r.tripId === tripId)
          .map(r => `${r.name}|${r.date}`)
      );
      let mutated = false;
      const updated = [...allRems];
      suggestions.forEach((suggestion) => {
        const key = `${suggestion.name}|${suggestion.date}`;
        if (!existing.has(key)) {
          updated.push({ id: uid('rem'), tripId, name: suggestion.name, date: suggestion.date, completed: false });
          existing.add(key);
          mutated = true;
        }
      });
      if (!mutated) {
        return;
      }
      saveReminders(me.email, updated);
      renderList();
    };
    bindEventOnce(suggestionsAddAllBtn, 'click', handleAddAllSuggestions, 'reminder-add-all');
  }
  // Add new reminder
  if (addBtn) {
    const handleAddReminder = (ev) => {
      ev.preventDefault();
      const tripId = tripSelect.value;
      const name   = (nameEl?.value || '').trim();
      const date   = dateEl?.value || '';
      if (!tripId || !name || !date) {
        // Do not allow adding reminders without full data
        return;
      }
      const allRems = getReminders(me.email) || [];
      const newRem  = { id: uid('rem'), tripId, name, date, completed: false };
      const updated = [...allRems, newRem];
      saveReminders(me.email, updated);
      // Clear the form fields and refresh list
      if (nameEl) nameEl.value = '';
      if (dateEl) dateEl.value = '';
      renderList();
    };
    bindEventOnce(addBtn, 'click', handleAddReminder, 'reminder-add');
  }
  updateAddButtonState();
  // Initial render
  renderList();
}

function wirePackingPage(me) {
  const tripSelect = qs('#packing-trip-select');
  const listEl    = qs('#packing-items-list');
  const inputEl   = qs('#packing-item-input');
  const addBtn    = qs('#packing-add-btn');
  const importanceSelect = qs('#packing-importance-select');
  const urgentToggle = qs('#packing-urgent-toggle');
  if (!tripSelect || !listEl || !inputEl || !addBtn) return; // not on packing page

  const trips = getTrips(me.email) || [];
  const selectedId = populateTripSelectElement(
    tripSelect,
    trips,
    getStoredTripSelection(me.email),
    trips.length > 0 ? 'Select a vacation' : 'Create a trip to start packing'
  );
  setStoredTripSelection(me.email, selectedId || null);

  function updateAddButtonState() {
    const hasTrip = Boolean(tripSelect.value);
    addBtn.disabled = !hasTrip;
    addBtn.classList.toggle('opacity-50', !hasTrip);
    addBtn.classList.toggle('cursor-not-allowed', !hasTrip);
    inputEl.disabled = !hasTrip;
    inputEl.classList.toggle('opacity-50', !hasTrip);
    inputEl.classList.toggle('cursor-not-allowed', !hasTrip);
    if (importanceSelect) {
      importanceSelect.disabled = !hasTrip;
      importanceSelect.classList.toggle('opacity-50', !hasTrip);
      importanceSelect.classList.toggle('cursor-not-allowed', !hasTrip);
    }
    if (urgentToggle) {
      urgentToggle.disabled = !hasTrip;
      urgentToggle.classList.toggle('opacity-50', !hasTrip);
      urgentToggle.classList.toggle('cursor-not-allowed', !hasTrip);
    }
  }

  function renderList() {
    listEl.innerHTML = '';
    const tripId = tripSelect.value;
    if (!tripId) {
      const msg = document.createElement('li');
      msg.className = 'text-sm text-slate-600 dark:text-slate-400';
      msg.textContent = trips.length > 0 ? 'Select a trip to manage your packing list.' : 'Create a trip to start your packing list.';
      listEl.appendChild(msg);
      return;
    }

    const items = getPackingItems(tripId);
    if (!items || items.length === 0) {
      const msg = document.createElement('li');
      msg.className = 'text-sm text-slate-600 dark:text-slate-400';
      msg.textContent = 'No packing items yet.';
      listEl.appendChild(msg);
      return;
    }

    const importanceRank = { essential: 0, useful: 1, optional: 2 };
    const importanceBadgeClass = {
      essential: 'px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
      useful: 'px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200',
      optional: 'px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200',
    };

    const sorted = mergeSort(items, (a, b) => {
      const rankA = importanceRank[(a?.importance || '').toLowerCase()] ?? 1;
      const rankB = importanceRank[(b?.importance || '').toLowerCase()] ?? 1;
      if (rankA !== rankB) return rankA - rankB;
      const urgencyDiff = Number(Boolean(b?.urgent)) - Number(Boolean(a?.urgent));
      if (urgencyDiff !== 0) return urgencyDiff;
      const nameA = (a?.name || '').toLowerCase();
      const nameB = (b?.name || '').toLowerCase();
      if (nameA === nameB) return 0;
      return nameA > nameB ? 1 : -1;
    });

    sorted.forEach((item) => {
      if (!item || !item.id) return;
      const li = document.createElement('li');
      li.className = 'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-4 bg-white dark:bg-slate-800 rounded-md shadow-sm border border-slate-200/60 dark:border-slate-700/60';

      const leftWrap = document.createElement('div');
      leftWrap.className = 'flex items-start gap-3';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'mt-1 h-4 w-4 text-primary border-slate-300 rounded';
      checkbox.checked = Boolean(item.packed);
      checkbox.addEventListener('change', () => {
        const updated = getPackingItems(tripId).map((it) =>
          it.id === item.id ? { ...it, packed: checkbox.checked } : it
        );
        savePackingItems(tripId, updated);
        renderList();
      });

      const textWrap = document.createElement('div');
      const nameSpan = document.createElement('span');
      nameSpan.textContent = item.name || 'Item';
      nameSpan.className = checkbox.checked
        ? 'font-medium line-through text-slate-500 dark:text-slate-400'
        : 'font-medium text-slate-800 dark:text-slate-100';

      const meta = document.createElement('div');
      meta.className = 'mt-1 flex flex-wrap items-center gap-2 text-xs';
      const importanceValue = (item.importance || 'useful').toLowerCase();
      const importanceLabel = importanceValue.charAt(0).toUpperCase() + importanceValue.slice(1);
      const badge = document.createElement('span');
      badge.className = importanceBadgeClass[importanceValue] || importanceBadgeClass.useful;
      badge.textContent = importanceLabel;
      meta.appendChild(badge);

      if (item.urgent) {
        const urgentBadge = document.createElement('span');
        urgentBadge.className = 'px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200';
        urgentBadge.textContent = 'Urgent';
        meta.appendChild(urgentBadge);
      }

      textWrap.appendChild(nameSpan);
      textWrap.appendChild(meta);

      leftWrap.appendChild(checkbox);
      leftWrap.appendChild(textWrap);

      const controls = document.createElement('div');
      controls.className = 'flex flex-wrap items-center gap-3 sm:justify-end';

      const importanceControl = document.createElement('select');
      importanceControl.className = 'rounded-md border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary';
      ['essential', 'useful', 'optional'].forEach((value) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value.charAt(0).toUpperCase() + value.slice(1);
        importanceControl.appendChild(opt);
      });
      importanceControl.value = importanceValue;
      importanceControl.addEventListener('change', () => {
        const updated = getPackingItems(tripId).map((it) =>
          it.id === item.id ? { ...it, importance: importanceControl.value } : it
        );
        savePackingItems(tripId, updated);
        renderList();
      });

      const urgentLabel = document.createElement('label');
      urgentLabel.className = 'flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300';
      const urgentCheckbox = document.createElement('input');
      urgentCheckbox.type = 'checkbox';
      urgentCheckbox.className = 'rounded border-slate-300 dark:border-slate-600 text-primary focus:ring-primary';
      urgentCheckbox.checked = Boolean(item.urgent);
      urgentCheckbox.addEventListener('change', () => {
        const updated = getPackingItems(tripId).map((it) =>
          it.id === item.id ? { ...it, urgent: urgentCheckbox.checked } : it
        );
        savePackingItems(tripId, updated);
        renderList();
      });
      urgentLabel.appendChild(urgentCheckbox);
      urgentLabel.appendChild(document.createTextNode('Urgent'));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'text-sm text-red-500 hover:text-red-700';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const updated = getPackingItems(tripId).filter((it) => it.id !== item.id);
        savePackingItems(tripId, updated);
        renderList();
      });

      controls.appendChild(importanceControl);
      controls.appendChild(urgentLabel);
      controls.appendChild(delBtn);

      li.appendChild(leftWrap);
      li.appendChild(controls);

      listEl.appendChild(li);
    });
  }

  const handlePackingTripChange = () => {
    const id = tripSelect.value;
    setStoredTripSelection(me.email, id || null);
    updateAddButtonState();
    renderList();
  };
  bindEventOnce(tripSelect, 'change', handlePackingTripChange, 'packing-trip');

  const handleAddPackingItem = (ev) => {
    ev.preventDefault();
    const tripId = tripSelect.value;
    const name = (inputEl.value || '').trim();
    if (!tripId || !name) {
      return;
    }
    const items = getPackingItems(tripId);
    const importance = (importanceSelect?.value || 'useful').toLowerCase();
    const urgent = Boolean(urgentToggle?.checked);
    const newItem = { id: uid('pack'), name, packed: false, importance, urgent };
    const updated = [...items, newItem];
    savePackingItems(tripId, updated);
    inputEl.value = '';
    if (importanceSelect) {
      importanceSelect.value = 'useful';
    }
    if (urgentToggle) {
      urgentToggle.checked = false;
    }
    renderList();
  };
  bindEventOnce(addBtn, 'click', handleAddPackingItem, 'packing-add');

  bindEventOnce(window, 'wl:packing-updated', (event) => {
    const detail = event?.detail || {};
    if (!tripSelect.value) {
      return;
    }
    if (!detail.tripId || detail.tripId !== tripSelect.value) {
      return;
    }
    renderList();
  }, 'packing-sync-listener');

  updateAddButtonState();
  renderList();
}

// ---------- Global nav bindings (present on several pages) ----------
function wireHeaderNav() {
  // Navigation links appear on multiple templates with the same IDs but
  // occasionally different destinations (e.g. "Home" vs. "Calendar").  Instead
  // of hard‑coding every path, derive the destination from the existing href and
  // fall back to a sensible default when the attribute is missing.  Handling the
  // bindings through a shared configuration keeps the logic centralised and
  // avoids subtle bugs where one page overrides another's navigation target.
  const navConfig = [
    { selector: '#calendar-nav',  fallback: 'calender.html' },
    { selector: '#vacations-nav', fallback: 'homepage.html' },
    { selector: '#budget-nav',    fallback: 'budget.html' },
    { selector: '#reminders-nav', fallback: 'reminders.html' },
    { selector: '#packing-nav',   fallback: 'packing.html' }
  ];

  const toggleBtn = qs('[data-mobile-menu-toggle]');
  const panel = qs('[data-mobile-menu]');
  const overlay = qs('[data-mobile-menu-overlay]');
  const closeBtn = qs('[data-mobile-menu-close]');
  let lastFocus = null;

  const getFocusable = () => panel
    ? qsa('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])', panel)
        .filter(el => el.offsetParent !== null)
    : [];

  const setMenuState = (open) => {
    if (!panel) {
      if (!open) {
        document.body.classList.remove('overflow-hidden');
      }
      return;
    }
    if (open) {
      panel.classList.remove('translate-x-full', 'pointer-events-none');
      panel.classList.add('translate-x-0');
      panel.setAttribute('aria-hidden', 'false');
      if (overlay) {
        overlay.classList.remove('hidden');
        overlay.setAttribute('aria-hidden', 'false');
      }
      if (toggleBtn) {
        toggleBtn.setAttribute('aria-expanded', 'true');
      }
      lastFocus = document.activeElement;
      document.body.classList.add('overflow-hidden');
      const focusables = getFocusable();
      requestAnimationFrame(() => {
        if (focusables.length > 0 && typeof focusables[0].focus === 'function') {
          focusables[0].focus();
        } else if (panel && typeof panel.focus === 'function') {
          panel.focus();
        }
      });
    } else {
      panel.classList.add('translate-x-full');
      panel.classList.remove('translate-x-0');
      panel.classList.add('pointer-events-none');
      panel.setAttribute('aria-hidden', 'true');
      if (overlay) {
        overlay.classList.add('hidden');
        overlay.setAttribute('aria-hidden', 'true');
      }
      if (toggleBtn) {
        toggleBtn.setAttribute('aria-expanded', 'false');
      }
      document.body.classList.remove('overflow-hidden');
      const toFocus = lastFocus && typeof lastFocus.focus === 'function'
        ? lastFocus
        : toggleBtn;
      if (toFocus && typeof toFocus.focus === 'function') {
        toFocus.focus();
      }
    }
  };

  const isMenuOpen = () => Boolean(panel && panel.classList.contains('translate-x-0') && !panel.classList.contains('pointer-events-none'));

  const openMenu = () => setMenuState(true);
  const closeMenu = () => setMenuState(false);

  on(toggleBtn, 'click', (ev) => {
    ev.preventDefault();
    if (isMenuOpen()) {
      closeMenu();
    } else {
      openMenu();
    }
  });
  on(overlay, 'click', closeMenu);
  on(closeBtn, 'click', closeMenu);

  if (panel) {
    on(panel, 'keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        closeMenu();
        return;
      }
      if (ev.key !== 'Tab') return;
      const focusables = getFocusable();
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    });
  }

  const handleNav = (ev, dest) => {
    ev.preventDefault();
    if (!dest) return;
    if (dest.startsWith('#')) {
      const target = qs(dest);
      closeMenu();
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    closeMenu();
    window.location.href = dest;
  };

  navConfig.forEach(({ selector, fallback }) => {
    const link = qs(selector);
    if (!link) return;
    const dest = link.getAttribute('href') || fallback;
    on(link, 'click', (ev) => handleNav(ev, dest));
  });

  qsa('[data-nav-target]').forEach((link) => {
    const dest = link.dataset.navTarget || link.getAttribute('href') || '';
    on(link, 'click', (ev) => handleNav(ev, dest));
  });

  return { closeMenu };
}

// ---------- Simple "test.html" exercise compat ----------
function wireTestHtml() {
  const btn = qs("#loginBtn");
  if (!btn) return;
  const userEl = qs("#username");
  const passEl = qs("#password");
  const msg = qs("#message");

  on(btn, "click", async () => {
    const email = (userEl?.value || "").toLowerCase().trim();
    const pass = passEl?.value || "";
    const passHash = await hash(pass);
    const users = store.get(KEY_USERS, []);
    const user = users.find(u => u.email === email && u.passHash === passHash);
    msg.textContent = user ? "Login successful!" : "Invalid credentials.";
  });
}

// ---------- Boot ----------
document.addEventListener("DOMContentLoaded", async () => {
  // Decide which pages require login (protect them)
  const pathname = (location.pathname || "").toLowerCase();
  const protectedPages = ["homepage.html", "addvac.html", "budget.html", "calender.html", "reminders.html", "packing.html"];
  const isProtected = protectedPages.some(p => pathname.endsWith("/" + p) || pathname.endsWith(p));

  // Route auth
  let me = null;
  if (isProtected) {
    me = requireSession();
    if (!me) {
      // When a protected page is visited without a valid session, redirect to the
      // login page.  The login file is "logpage.html" (lowercase).  Using an
      // uppercase filename here breaks navigation on case‑sensitive hosts.
      window.location.href = "logpage.html";
      return;
    }
  } else {
    // Even on public pages, load me if logged in (for smoother UX)
    me = requireSession();
  }

    // Global header nav if present
    const navControls = wireHeaderNav() || {};
    addLogoutShortcut();
    const closeMobileMenu = typeof navControls.closeMenu === 'function'
      ? navControls.closeMenu
      : () => {};

    // Personalize the welcome message on the home page.  The template
    // includes a span with the id "welcome-user" containing a placeholder
    // name (e.g., "Friend").  If a user session is active we replace
    // that placeholder with the authenticated user's name.
    const welcomeEl = qs('#welcome-user');
    if (welcomeEl && me && me.name) {
      welcomeEl.textContent = me.name.split(' ')[0] || me.name;
    }

    // Provide a click handler for the explicit logout links. Many of the
    // templates include an anchor with the id "logout-button" that should
    // terminate the session and return the user to the login page. Without
    // this handler the link does nothing.
    const logoutButtons = [qs('#logout-button'), ...qsa('[data-logout]')].filter(Boolean);
    logoutButtons.forEach((btn) => {
      on(btn, 'click', (ev) => {
        ev.preventDefault();
        closeMobileMenu();
        // Clear the session and redirect to the login page.  Ensure the href
        // matches the lowercase filename on disk (logpage.html) to avoid 404s on
        // case‑sensitive deployments.
        store.remove(KEY_SESSION);
        window.location.href = 'logpage.html';
      });
    });

  // Initialise exchange rates so that budget pages display converted values.  We await
  // this call here so that the initial render uses up‑to‑date rates.  If the
  // fetch fails the converter falls back to a 1:1 rate.
  // Start currency conversion initialisation but do not block UI wiring on the
  // network request.  Rates will be applied once the promise resolves.
  const currencyInitPromise = currencyConverter.init().catch((err) => {
    console.error('Currency rate initialisation failed:', err);
  });

  // Page-specific wiring that should happen immediately so forms and buttons
  // respond even while background fetches are running.
  await handleRegisterPage();
  await handleLoginPage();

  const hasHomepageShell = Boolean(qs('#home-summary'));

  if (me) {
    // Provide editing/submission capabilities straight away using any locally
    // cached data.  Remote data will be merged in once synchronisation
    // completes and the relevant UI will be re-rendered below.
    preloadAddVacationFormForEdit(me);
    wireAddVacationPage(me);
    if (hasHomepageShell) {
      renderHomepage(me);
    }
  }

  // Always attempt to wire the calendar with whatever data is currently
  // available.  This ensures the grid renders immediately rather than waiting
  // for asynchronous operations to finish.
  maybeWireCalendar(me);

  // Wait for currency rates so budget calculations use the latest values.
  await currencyInitPromise;

  if (me) {
    // Synchronise trips and related data from Supabase, then refresh any UI
    // that depends on the merged dataset.
    await syncFromSupabase(me);
    preloadAddVacationFormForEdit(me);
    if (hasHomepageShell) {
      renderHomepage(me);
    }
    wireBudgetPage(me);
    wireRemindersPage(me);
    wirePackingPage(me);
  }

  // Rebuild the calendar after remote data loads so new trips appear without a
  // full page refresh.
  maybeWireCalendar(me);

  // When navigating via browser history (e.g. using the Back button),
  // browsers may restore pages from cache without firing DOMContentLoaded.
  // Reinvoke key page wiring on the pageshow event to ensure the
  // calendar, homepage and budget features are properly initialised.
  window.addEventListener('pageshow', () => {
    const sess = requireSession();
    // Rebuild the dynamic calendar if present
    if (qs('#calendar-grid')) {
      maybeWireCalendar(sess);
    }
    // Rerender the homepage upcoming trip list and details if present
    if (qs('#home-upcoming')) {
      if (sess) {
        renderHomepage(sess);
      } else {
        // Even without a session, clear any stale upcoming content
        const container = qs('#home-upcoming');
        if (container) container.innerHTML = '';
      }
    }
    // Refresh budget page bindings if fields are present
    if (qs('#vacation-select')) {
      if (sess) {
        wireBudgetPage(sess);
      }
    }
    // Rewire packing page if present
    if (qs('#packing-trip-select')) {
      if (sess) {
        wirePackingPage(sess);
      }
    }
  });
});

/* END OF ORIGINAL APP CODE */

})();