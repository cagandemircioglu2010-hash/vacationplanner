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

  // Global error handler: surface uncaught exceptions on the page.
  // When an error bubbles to the window, this listener prepends a
  // descriptive banner to the document body so errors are visible
  // without developer tools.  The banner includes the message and
  // uses a red background to draw attention.  This should be
  // removed for production deployments.
  window.addEventListener('error', function (e) {
    try {
      const errMsg = document.createElement('div');
      errMsg.style.backgroundColor = '#fee';
      errMsg.style.color = '#900';
      errMsg.style.padding = '8px';
      errMsg.style.border = '1px solid #900';
      errMsg.style.margin = '4px';
      errMsg.style.fontFamily = 'monospace';
      errMsg.textContent = 'Uncaught error: ' + (e.message || e);
      document.body.prepend(errMsg);
    } catch {}
  });

// ---------- Utilities ----------
const qs  = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const on  = (el, ev, cb, opts) => el && el.addEventListener(ev, cb, opts);

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

const KEY_USERS = "wl_users";                  // [{email, name, passHash}]
const KEY_SESSION = "wl_session";              // {email}
const tripsKey = (email) => `wl_trips_${email}`;        // [{...trip}]
const expensesKey = (tripId) => `wl_exp_${tripId}`;     // [{...expense}]
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

// Retrieve an array of reminders for a user from localStorage.  Supabase
// is the source of truth for reminders; local storage acts as a cache
// after syncFromSupabase() runs.  Returns an empty array when no
// reminders exist.  Do not modify the returned array directly.
function getReminders(email) {
  return store.get(remindersKey(email), []) || [];
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
function writeUserToSupabase(user) {
  const supabase = window.supabaseClient;
  if (!supabase) return;
  (async () => {
    try {
      const { error } = await supabase.from('users').upsert(user);
      if (error) {
        console.error('Error writing user to Supabase:', error);
      }
    } catch (err) {
      console.error('Error writing user to Supabase:', err);
    }
  })();
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
  if (!supabase || !tripId) return [];
  try {
    const { data, error } = await supabase
      .from('expenses')
      .select()
      .match({ email: email, trip_id: tripId });
    if (error) {
      console.error('Error reading expenses from Supabase:', error);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.error('Error reading expenses from Supabase:', err);
    return [];
  }
}

async function readRemindersFromSupabase(email) {
  /**
   * Retrieve all reminders for a given user from Supabase.
   *
   * Queries the `reminders` table for rows where the `email` column
   * matches the provided email.  If no Supabase client has been
   * initialised, an empty array is returned.  Only reminders created
   * by this user are returned; filtering by trip id is done in
   * wireRemindersPage().
   *
   * @param {string} email The user's email address
   * @returns {Promise<Array<Object>>} Array of reminder objects
   */
  const supabase = window.supabaseClient;
  if (!supabase || !email) return [];
  try {
    const { data, error } = await supabase.from('reminders').select().eq('email', email);
    if (error) {
      console.error('Error reading reminders from Supabase:', error);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.error('Error reading reminders from Supabase:', err);
    return [];
  }
}

async function readPackingFromSupabase(email, tripId) {
  /**
   * Retrieve packing list items for a given trip from Supabase.
   *
   * Each row is expected to include at least an item identifier,
   * the owning user's email and the associated trip id.  If the
   * Supabase client has not been initialised or the query fails,
   * an empty array is returned so that local functionality can
   * continue using any cached data.
   *
   * @param {string} email The user's email address
   * @param {string} tripId The ID of the trip whose packing items are requested
   * @returns {Promise<Array<Object>>} Array of packing item objects
   */
  const supabase = window.supabaseClient;
  if (!supabase || !email || !tripId) return [];
  try {
    const { data, error } = await supabase
      .from('packing')
      .select()
      .match({ email, trip_id: tripId });
    if (error) {
      console.error('Error reading packing items from Supabase:', error);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.error('Error reading packing items from Supabase:', err);
    return [];
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
  const clone = trips.map((trip) => ({ ...trip })).sort((a, b) => {
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
      saveTrips(me.email, merged); // uses existing function in app.js
    }
    effectiveTrips = merged;
  }
  // Pull expenses for each trip
  for (const t of effectiveTrips) {
    const rows = await readExpensesFromSupabase(me.email, t.id);
    if (rows.length) {
      store.set(`wl_exp_${t.id}`, rows); // uses your existing storage key
    }
  }

  // Pull reminders for this user
  const rems = await readRemindersFromSupabase(me.email);
  if (rems.length) {
    store.set(remindersKey(me.email), rems);
  }

  // Pull packing lists for each trip.  Packing items are stored in the
  // `packing` table keyed by email and trip id.  Save them into
  // localStorage so the packing page can access them offline.
  for (const t of effectiveTrips) {
    const packs = await readPackingFromSupabase(me.email, t.id);
    if (packs.length) {
      store.set(packingKey(t.id), packs);
    }
  }
}

/**
 * Persist an array of trips to Firestore under a user document.  Each
 * trip is written as a document in the subcollection
 * `users/{email}/trips/{tripId}`.  Existing documents are merged.
 *
 * @param {string} email The email of the user owning the trips
 * @param {Array<Object>} trips The array of trip objects
 */
function writeTripsToSupabase(email, trips) {
  /**
   * Persist an array of trips to Supabase.
   *
   * Each trip object is upserted into the `trips` table along with
   * the owning user's email.  Upsert is used so that existing rows
   * with the same primary key (trip id) are updated rather than
   * duplicated.  This function runs asynchronously without awaiting
   * individual writes, preserving the non-blocking behaviour of the
   * original Firestore implementation.
   *
   * @param {string} email The email of the user owning the trips
   * @param {Array<Object>} trips The array of trip objects to persist
   */
  const supabase = window.supabaseClient;
  if (!supabase || !email || !Array.isArray(trips)) return;
  (async () => {
    for (const trip of trips) {
      try {
        const record = { ...trip, email };
        const { error } = await supabase.from('trips').upsert(record);
        if (error) {
          console.error('Error writing trip to Supabase:', error);
        }
      } catch (err) {
        console.error('Error writing trip to Supabase:', err);
      }
    }
  })();
}

/**
 * Persist an array of expenses for a specific trip.  Expenses are
 * stored under `users/{email}/trips/{tripId}/expenses/{expenseId}`.
 *
 * @param {string} email The email of the user owning the trip
 * @param {string} tripId The unique ID of the trip
 * @param {Array<Object>} expenses Array of expense objects
 */
function writeExpensesToSupabase(email, tripId, expenses) {
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
  if (!supabase || !email || !tripId || !Array.isArray(expenses)) return;
  (async () => {
    try {
      // Remove all existing expenses for this user and trip before upserting the new set.
      // Without deleting stale rows, removed expenses would reappear on reload.
      await supabase.from('expenses').delete().match({ email, trip_id: tripId });
    } catch (err) {
      console.error('Error deleting old expenses from Supabase:', err);
    }
    for (const exp of expenses) {
      try {
        const record = { ...exp, email, trip_id: tripId };
        const { error } = await supabase.from('expenses').upsert(record);
        if (error) {
          console.error('Error writing expense to Supabase:', error);
        }
      } catch (err) {
        console.error('Error writing expense to Supabase:', err);
      }
    }
  })();
}

function writePackingToSupabase(email, tripId, items) {
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
  (async () => {
    try {
      await supabase.from('packing').delete().match({ email, trip_id: tripId });
    } catch (err) {
      console.error('Error deleting old packing items from Supabase:', err);
    }
    for (const item of items) {
      try {
        const record = { ...item, email, trip_id: tripId };
        const { error } = await supabase.from('packing').upsert(record);
        if (error) {
          console.error('Error writing packing item to Supabase:', error);
        }
      } catch (err) {
        console.error('Error writing packing item to Supabase:', err);
      }
    }
  })();
}

/**
 * Persist reminders for a user.  Each reminder is stored under
 * `users/{email}/reminders/{reminderId}`.  Existing documents are
 * merged.
 *
 * @param {string} email The user email
 * @param {Array<Object>} reminders Array of reminder objects
 */
function writeRemindersToSupabase(email, reminders) {
  /**
   * Persist an array of reminders to Supabase.
   *
   * Each reminder is upserted into the `reminders` table along with
   * the user's email.  Errors are logged to the console.
   *
   * @param {string} email The user's email
   * @param {Array<Object>} reminders Array of reminder objects
   */
  const supabase = window.supabaseClient;
  if (!supabase || !email || !Array.isArray(reminders)) return;
  (async () => {
    for (const rem of reminders) {
      try {
        const record = { ...rem, email };
        const { error } = await supabase.from('reminders').upsert(record);
        if (error) {
          console.error('Error writing reminder to Supabase:', error);
        }
      } catch (err) {
        console.error('Error writing reminder to Supabase:', err);
      }
    }
  })();
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
  // Determine unique categories and map them to column indices
  const categoryMap = {};
  expenses.forEach(exp => {
    if (exp && exp.category && !(exp.category in categoryMap)) {
      categoryMap[exp.category] = Object.keys(categoryMap).length;
    }
  });
  const categories = Object.keys(categoryMap);
  const numCats = categories.length;
  // Create a 12xN matrix (months 0–11) initialised to 0
  const matrix = Array.from({ length: 12 }, () => Array(numCats).fill(0));
  expenses.forEach(exp => {
    if (!exp || !exp.date || !exp.category || typeof exp.amount !== 'number') return;
    const month = new Date(exp.date).getMonth();
    const col = categoryMap[exp.category];
    if (col >= 0) {
      matrix[month][col] += exp.amount;
    }
  });
  return { matrix, categories };
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

    on(loginLink, "click", (e) => {
    e.preventDefault();
    // Navigate to the lowercase login page file.  Filenames on Netlify are case‑sensitive.
    window.location.href = "logpage.html";
  });

  on(form, "submit", async (e) => {
    e.preventDefault();
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
    users.push(newUser);
    store.set(KEY_USERS, users);
    store.set(KEY_SESSION, { email }); // auto-login
    // Persist the new user to Firestore.  This call is asynchronous
    // and runs in the background.
        // Write the user record to Supabase instead of Firestore
        writeUserToSupabase(newUser);
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
    await syncFromSupabase({ email });   // <-- add this line
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
function saveTrips(email, trips) {
  // Persist trips to localStorage
  store.set(tripsKey(email), trips);
  // Also persist trips to Firestore (if Firebase is initialised).  This
  // asynchronous call runs in the background and does not block
  // the UI.  Errors, if any, are logged by writeTripsToSupabase.
  writeTripsToSupabase(email, trips);
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
  const future = trips.slice().sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
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

  const syncEndMin = () => {
    if (startEl?.value) {
      if (endEl) endEl.min = startEl.value;
      if (endEl?.value && endEl.value < startEl.value) endEl.value = startEl.value;
    }
  };
  on(startEl, "change", syncEndMin);
  syncEndMin();

  on(form, "submit", (e) => {
    e.preventDefault();
    // validate
    const name = nameEl?.value?.trim();
    const loc = locEl?.value?.trim();
    const start = startEl?.value || "";
    const end = endEl?.value || "";
    const cost = costEl?.value ? Number(costEl.value) : null;
    const notes = notesEl?.value?.trim() || null;

    // Perform simple validations.  We avoid using alert popups; invalid input simply
    // prevents saving without interrupting the user.  HTML required attributes
    // already enforce many of these checks.
    if (!name || !loc || !start || !end) {
      return;
    }
    if (end < start) {
      return;
    }
    if (costEl?.value && (!Number.isFinite(cost) || cost < 0)) {
      return;
    }

    const trips = getTrips(me.email);
    const editId = form.dataset.editId;
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
    saveTrips(me.email, trips);
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

function renderHomepage(me) {
  wireNewTripButton('homepage.html');
  const tripBox  = qs("#trip-details");
  // The edit and delete buttons may be dynamically recreated when rendering
  // trip details. Instead of capturing static references here (which will
  // break once innerHTML is replaced), we'll bind handlers via event
  // delegation below.

  // Make header nav work (Calendar/Vacations/Budget/Reminders)
  const navCalendar  = qs("#calendar-nav");
  const navVacations = qs("#vacations-nav");
  const navBudget    = qs("#budget-nav");
  const navReminders = qs("#reminders-nav");
  on(navCalendar, "click", (e) => { e.preventDefault(); window.location.href = "calender.html"; });
  on(navVacations, "click", (e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  on(navBudget, "click",    (e) => { e.preventDefault(); window.location.href = "budget.html"; });
  // Navigate to the dedicated reminders page instead of an anchor on the budget page
  on(navReminders, "click", (e) => { e.preventDefault(); window.location.href = "reminders.html"; });

  const trips = getTrips(me.email);
  const next = nextUpcomingTrip(trips);

  /**
   * Render the currently selected trip inside the trip details panel. The
   * original templates place the Edit and Delete buttons inside
   * ``#trip-details``. The previous implementation replaced the entire
   * contents of the panel using ``innerHTML``, which removed those
   * buttons and left the page without any way to edit or delete a
   * vacation. To fix this, we explicitly reinsert the action buttons
   * whenever we render the details and attach click handlers via
   * event delegation.
   *
   * @param {Object|null} trip The trip data to render
   */
    /**
     * Render a single trip's details into the details panel. In addition to
     * the standard information (name, date range, location and cost), this
     * function now asynchronously fetches current weather information for
     * the trip's destination using free, public APIs. The weather data is
     * inserted into the details view once retrieved. This demonstrates
     * integration with external REST endpoints and the use of asynchronous
     * control flow (promises/async‑await).
     *
     * @param {Object|null} trip The trip data to render
     */
    function setTripDetail(trip) {
      if (!trip || !tripBox) return;
      const rangeTxt = `${trip.startDate} - ${trip.endDate}`;
      // Compose the inner markup for details. We include a placeholder
      // element with id `weather-info` which will be populated after
      // fetching weather data. See fetchWeather() below.
      let html = ``;
      html += `<p class="text-sm text-primary font-semibold">${rangeTxt}</p>`;
      html += `<h4 class="text-2xl font-bold">${trip.name}</h4>`;
      html += `<p class="mt-1 opacity-80">${trip.location}</p>`;
      html += `<div class="mt-3 text-sm opacity-70">`;
      if (trip.cost != null) {
        html += `Estimated Cost: ${fmtMoney(trip.cost)}`;
      }
      html += `</div>`;
      // Weather placeholder: initially shows a loading message. It will be
      // replaced once the weather API returns.
      // Append trip ID.  Weather information has been removed in this version to simplify the implementation.
      html += `<div class="mt-4 text-xs opacity-60">Trip ID: ${trip.id}</div>`;
      // Append action buttons. We include IDs on the buttons so that
      // event delegation can catch clicks. Note: we intentionally do not
      // duplicate classes from the templates exactly; instead we use
      // functional classes similar to the originals to maintain styling.
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
      // Store current trip ID on dataset for later retrieval
      tripBox.dataset.currentTripId = trip.id;
      // Weather fetching has been removed.  If needed in future, reintroduce
      // asynchronous calls here to update additional details.
    }

    /**
     * Retrieve current weather information for a location. This helper
     * performs two asynchronous HTTP requests: first to the Nominatim
     * geocoding service (OpenStreetMap) to convert the location string
     * into latitude and longitude, and second to the Open‑Meteo service
     * to obtain the current weather at those coordinates. The function
     * returns a descriptive string or a fallback message if any errors
     * occur. Both services are public and do not require API keys,
     * although we set a User‑Agent header on the geocoding request per
     * Nominatim usage guidelines. See https://nominatim.org/release-docs/
     * for details.
     *
     * @param {string} location The human‑readable location (city/country)
     * @returns {Promise<string>} A promise that resolves to a human
     *   friendly description of the current weather
     */
    async function fetchWeather(location) {
      try {
        if (!location) return 'Weather data unavailable';
        // 1. Geocode the location using Nominatim.
        const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(location)}`;
        const geoResp = await fetch(geoUrl, {
          headers: {
            // Provide a User‑Agent so that the service is not
            // mistaken for a bot. The email domain is omitted here
            // for privacy; students should use their own details.
            'User-Agent': 'IBVacationPlanner/1.0'
          }
        });
        if (!geoResp.ok) throw new Error('Geocoding failed');
        const geoData = await geoResp.json();
        if (!Array.isArray(geoData) || geoData.length === 0) {
          return 'Weather data unavailable';
        }
        const { lat, lon } = geoData[0];
        if (!lat || !lon) {
          return 'Weather data unavailable';
        }
        // 2. Fetch current weather from Open‑Meteo.
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
        const weatherResp = await fetch(weatherUrl);
        if (!weatherResp.ok) throw new Error('Weather fetch failed');
        const weatherData = await weatherResp.json();
        const cw = weatherData.current_weather;
        if (!cw) return 'Weather data unavailable';
        // Compose a simple description. Temperature is reported in °C, windspeed in km/h.
        const temp = cw.temperature;
        const wind = cw.windspeed;
        return `Current weather: ${temp}°C, Wind ${wind} km/h`;
      } catch (err) {
        console.error('Error fetching weather:', err);
        return 'Weather data unavailable';
      }
    }

    if (next) {
      setTripDetail(next);
    } else if (tripBox) {
      // No trips yet; display a placeholder message.  Leave the edit/delete
      // buttons hidden by clearing the tripBox and removing any stored id.
      tripBox.innerHTML = '<p class="opacity-70">No trips yet. Click “New Trip” to add one!</p>';
      delete tripBox.dataset.currentTripId;
    }

    // Render upcoming trips on the home page if a dedicated container
    // exists.  The template includes a <div id="home-upcoming"> for
    // this purpose.  We'll populate it with cards for each trip in
    // chronological order.  If there are no trips yet we leave it empty.
    const upcomingContainer = qs('#home-upcoming');
    if (upcomingContainer) {
      upcomingContainer.innerHTML = '';
      const sortedTrips = trips.slice().sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
      if (sortedTrips.length === 0) {
        // If there are no upcoming trips, display a simple message instead of
        // leaving the section empty. This prevents the heading from appearing
        // without any content beneath it.
        const msg = document.createElement('p');
        msg.className = 'text-sm opacity-70';
        msg.textContent = 'No upcoming trips.';
        upcomingContainer.appendChild(msg);
      } else {
        sortedTrips.forEach(t => {
          const card = document.createElement('div');
          // Assign a class for styling and event delegation and embed the trip id for later retrieval
          card.className = 'home-trip-card flex items-center gap-4 p-4 rounded-lg bg-primary/10 dark:bg-primary/20 cursor-pointer hover:bg-primary/20 dark:hover:bg-primary/30 transition-colors';
          card.dataset.tripId = t.id;
          // icon container
          const iconWrap = document.createElement('div');
          iconWrap.className = 'flex items-center justify-center rounded-lg bg-primary/20 dark:bg-primary/30 p-3';
          const icon = document.createElement('span');
          icon.className = 'material-symbols-outlined text-primary';
          icon.textContent = 'travel_explore';
          iconWrap.appendChild(icon);
          card.appendChild(iconWrap);
          // text wrapper
          const textWrap = document.createElement('div');
          const nameEl = document.createElement('p');
          nameEl.className = 'font-semibold text-slate-800 dark:text-slate-200';
          nameEl.textContent = t.name;
          const dateEl = document.createElement('p');
          dateEl.className = 'text-sm text-slate-500 dark:text-slate-400';
          dateEl.textContent = `${t.startDate} - ${t.endDate}`;
          textWrap.appendChild(nameEl);
          textWrap.appendChild(dateEl);
          card.appendChild(textWrap);
          upcomingContainer.appendChild(card);
        });
        // Allow users to click upcoming trip cards to edit the selected trip.  When a card
        // is clicked, we navigate to the Add Vacation page in edit mode with a redirect
        // back to the home page.  Event delegation ensures that dynamically created
        // cards remain interactive.
        on(upcomingContainer, 'click', (e) => {
          const card = e.target.closest('.home-trip-card');
          if (!card) return;
          const id = card.dataset.tripId;
          if (!id) return;
          e.preventDefault();
          window.location.href = `addvac.html?edit=${encodeURIComponent(id)}&redirect=homepage.html`;
        });
      }
    }

    // Populate summary statistics for all trips.  The home page
    // contains a div#home-summary which is arranged into three
    // columns.  Each card displays total trips, total budget and
    // total spent.  Data is computed from the trips array and
    // associated expenses stored in localStorage.  We use simple
    // array reductions to aggregate totals.  If there are no trips
    // yet, placeholder values are shown.
    const summaryEl = qs('#home-summary');
    if (summaryEl) {
      summaryEl.innerHTML = '';
      const totalTrips = trips.length;
      // Sum estimated budgets (cost property) ignoring null or NaN
      let totalBudget = 0;
      trips.forEach(t => {
        const c = t.cost;
        if (typeof c === 'number' && !isNaN(c)) totalBudget += c;
      });
      // Sum all expenses across trips
      let totalSpent = 0;
      trips.forEach(t => {
        const exps = getExpenses(t.id) || [];
        exps.forEach(exp => {
          const amt = Number(exp.amount);
          if (!isNaN(amt)) totalSpent += amt;
        });
      });
      // Helper to build a card
      function makeCard(title, value, iconName) {
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
        const tEl = document.createElement('p');
        tEl.className = 'text-sm text-slate-500 dark:text-slate-400';
        tEl.textContent = title;
        const vEl = document.createElement('p');
        vEl.className = 'text-xl font-bold text-slate-900 dark:text-white';
        vEl.textContent = value;
        text.appendChild(tEl);
        text.appendChild(vEl);
        card.appendChild(text);
        return card;
      }
      const cards = [];
      cards.push(makeCard('Trips', String(totalTrips), 'travel_explore'));
      cards.push(makeCard('Total Budget', fmtMoney(totalBudget), 'account_balance_wallet'));
      cards.push(makeCard('Total Spent', fmtMoney(totalSpent), 'paid'));
      cards.forEach(c => summaryEl.appendChild(c));
    }

    // Render upcoming reminders on the home page.  The template
    // includes a <div id="home-upcoming-reminders"> which we
    // populate with the next three reminders across all trips.  We
    // leverage a binary search tree (ReminderTree) to sort reminders
    // chronologically.  Only reminders scheduled for today or in the
    // future are considered upcoming.  If there are no reminders, a
    // placeholder message is shown.
    const remindersContainer = qs('#home-upcoming-reminders');
    if (remindersContainer) {
      remindersContainer.innerHTML = '';
      const allRems = getReminders(me.email) || [];
      // Build a binary tree keyed by reminder date
      const tree = new ReminderTree();
      allRems.forEach(rem => tree.insert(rem));
      // Collect reminders in chronological order
      const sortedRems = [];
      tree.inOrder((rem) => { sortedRems.push(rem); });
      // Filter out past reminders
      const today = new Date().toISOString().split('T')[0];
      const upcoming = sortedRems.filter(r => r.date >= today).slice(0, 3);
      if (upcoming.length === 0) {
        const msg = document.createElement('p');
        msg.className = 'text-sm opacity-70';
        msg.textContent = 'No upcoming reminders.';
        remindersContainer.appendChild(msg);
      } else {
        upcoming.forEach(rem => {
          const card = document.createElement('div');
          card.className = 'flex items-center gap-4 p-4 rounded-lg bg-primary/10 dark:bg-primary/20';
          // icon
          const iconWrap = document.createElement('div');
          iconWrap.className = 'flex items-center justify-center rounded-lg bg-primary/20 dark:bg-primary/30 p-3';
          const icon = document.createElement('span');
          icon.className = 'material-symbols-outlined text-primary';
          icon.textContent = 'event';
          iconWrap.appendChild(icon);
          card.appendChild(iconWrap);
          // text
          const textWrap = document.createElement('div');
          const nameEl = document.createElement('p');
          nameEl.className = 'font-semibold text-slate-800 dark:text-slate-200';
          nameEl.textContent = rem.name;
          const dateEl = document.createElement('p');
          dateEl.className = 'text-sm text-slate-500 dark:text-slate-400';
          dateEl.textContent = rem.date;
          textWrap.appendChild(nameEl);
          textWrap.appendChild(dateEl);
          card.appendChild(textWrap);
          remindersContainer.appendChild(card);
        });
      }
    }

  // Event delegation for edit and delete actions. Listen for clicks on
  // ``#trip-details`` (or its child buttons) and handle accordingly. This
  // ensures that even if the buttons are recreated during rendering,
  // the handlers remain attached.
  on(tripBox, "click", (e) => {
    const target = e.target.closest("button");
    if (!target) return;
    if (target.id === "edit-trip-button") {
      e.preventDefault();
      const id = tripBox?.dataset?.currentTripId;
      if (!id) {
        return;
      }
        window.location.href = `addvac.html?edit=${encodeURIComponent(id)}&redirect=homepage.html`;
    } else if (target.id === "delete-trip-button") {
      e.preventDefault();
      const id = tripBox?.dataset?.currentTripId;
      if (!id) {
        return;
      }
      // Immediately delete the selected trip without a confirmation popup.  A
      // confirmation UI could be implemented inline if desired.
      const trips = getTrips(me.email).filter(t => t.id !== id);
      saveTrips(me.email, trips);
      // Also clear expenses for that trip
      store.remove(expensesKey(id));
      // Reset the trip box content
      tripBox.innerHTML = "<p class='opacity-70'>Trip deleted.</p>";
    }
  });
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
  // Also persist expenses to Supabase.  Derive the currently
  // authenticated user's email from the session.  If no session
  // exists or the Supabase client isn't initialised, this call does nothing.
  const sess = getSession();
  if (sess && sess.email) {
    writeExpensesToSupabase(sess.email, tripId, list);
  }
}

function getPackingItems(tripId) {
  if (!tripId) return [];
  return store.get(packingKey(tripId), []) || [];
}

function savePackingItems(tripId, items) {
  if (!tripId) return;
  const list = Array.isArray(items) ? items : [];
  store.set(packingKey(tripId), list);
  const sess = getSession();
  if (sess && sess.email) {
    writePackingToSupabase(sess.email, tripId, list);
  }
}

function wireBudgetPage(me) {
  // The vacation selector is a <select> element (see budget.html).  It
  // replaces the previous free‑text input to provide a simpler way to
  // choose an existing trip.
  const vacNameEl = qs("#vacation-select");
  const totalEl   = qs("#total-budget");
  const addBtn    = qs("#add-expense-button");
  const table     = qs("#expenses-table");
  const tbody     = table ? qs("tbody", table) : null;
  // Reminder inputs no longer exist on the budget page.  Reminders are managed
  // on a dedicated page.  These variables remain for backwards compatibility
  // but always resolve to null so subsequent code does not operate on them.
  const remNameEl = null;
  const remDateEl = null;

  // Handle currency selection changes on the budget page.  When the user selects a
  // different currency, update the converter and refresh the table, chart and
  // top categories accordingly.  The selector may not exist on pages
  // where budgeting is not enabled.
  const currencySelectEl = qs('#currency-select');
  if (currencySelectEl) {
    // Set the dropdown to reflect the current converter state.  If the converter
    // has not yet been initialised, selected remains 'USD'.
    currencySelectEl.value = currencyConverter.selected;
    on(currencySelectEl, 'change', (e) => {
      currencyConverter.setCurrency(e.target.value);
      // Refresh all calculated views.  Since renderTable() calls updateExpensesChart(), it
      // will indirectly update the chart, but we call updateTopCategories() explicitly
      // here to ensure the list is refreshed immediately.
      renderTable();
      updateExpensesChart();
      updateTopCategories();
    });
  }

  // Notification rendering removed.  Notifications and reminders are handled on
  // the dedicated reminders page.  A no‑op placeholder function is
  // defined to avoid breaking existing references.
  function renderNotifications() {
    return;
  }

  if (!(vacNameEl || totalEl || addBtn || table)) return; // not this page

  const allTrips = getTrips(me.email) || [];
  let activeTrip = getActiveTripForBudget(me);

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

  // Populate the trip selector with all trips and remember the user's choice so
  // the selection persists between visits to the budget and reminders pages.
  if (vacNameEl) {
    const selectedId = populateTripSelectElement(vacNameEl, allTrips, activeTrip?.id || getStoredTripSelection(me.email));
    if (!activeTrip && selectedId) {
      activeTrip = allTrips.find(t => t.id === selectedId) || null;
    }
    setStoredTripSelection(me.email, selectedId || null);
    ensureTripQueryMatches(selectedId);
    on(vacNameEl, 'change', (ev) => {
      const id = ev.target.value;
      setStoredTripSelection(me.email, id || null);
      const url = new URL(window.location.href);
      if (id) {
        url.searchParams.set('trip', id);
      } else {
        url.searchParams.delete('trip');
      }
      window.location.href = url.pathname + url.search + url.hash;
    });
  }

    // Expose the current active trip on the global window object so that
    // helper functions like updateExpensesChart() can access it.  Without
    // this assignment, `updateExpensesChart()` cannot read the locally
    // scoped `activeTrip` variable defined within wireBudgetPage() due to
    // lexical scoping rules.  Storing it globally keeps the state in sync
    // across different functions.  When there is no trip, this will be
    // undefined.
    window.currentActiveTrip = activeTrip || null;

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
      undoBtn.removeEventListener('click', undoBtn._wlUndoHandler || (()=>{}));
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
      undoBtn._wlUndoHandler = handler;
      undoBtn.addEventListener('click', handler);
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
      const entries = Object.entries(totals).sort((a,b) => b[1] - a[1]);
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
    // Populate the vacation name and total budget fields from the active trip.
    // The name and budget fields are read‑only once a trip is selected to
    // prevent accidental editing.  To change them, edit the trip from the
    // Trips page.
    if (vacNameEl) {
      // Select the active trip in the dropdown so the correct row appears selected
      vacNameEl.value = activeTrip.id;
      // Keep the select enabled to allow switching between trips
    }
    if (totalEl) {
      if (activeTrip.cost != null && activeTrip.cost !== '') {
        totalEl.value = String(activeTrip.cost);
      }
      totalEl.readOnly = true;
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
      const rows = getExpenses(activeTrip.id);
      const coll = new CategoryCollection();
      rows.forEach(r => {
        const catName = (r.category && r.category.trim()) ? r.category.trim() : 'Uncategorised';
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
      const palette = [
        '#ef4444', // red
        '#10b981', // green
        '#3b82f6', // blue
        '#f59e0b', // amber
        '#8b5cf6', // violet
        '#ec4899', // pink
        '#f97316', // orange
        '#13a4ec'  // sky
      ];
      sorted.slice(0, 5).forEach((c, idx) => {
        const li = document.createElement('li');
        li.className = 'flex justify-between items-center gap-2';
        // Colour swatch to match the pie slice
        const swatch = document.createElement('span');
        swatch.style.display = 'inline-block';
        swatch.style.width = '0.75rem';
        swatch.style.height = '0.75rem';
        swatch.style.borderRadius = '0.125rem';
        swatch.style.backgroundColor = palette[idx % palette.length];
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
    const rows = getExpenses(activeTrip.id);
    const totalSpent = rows.reduce((s, r) => s + parseCurrency(r.amount), 0);
    const totalBudget = parseCurrency(totalEl?.value ?? activeTrip.cost ?? 0);
    const remaining = totalBudget - totalSpent;

    // Try to update summary cards if present
    const cards = qsa(".rounded-xl p + p.text-3xl");
    // But better: locate by text around them—keep it simple and optional.
    return { totalSpent, totalBudget, remaining };
  }

  function renderTable() {
    if (!tbody) return;
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
  on(addBtn, 'click', (e) => {
    e.preventDefault();
    resetExpenseForm();
    showExpenseForm();
  });
  // Save handler: validate fields and either create a new expense or update an existing one
  on(expSaveBtn, 'click', (e) => {
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
  });
  // Cancel handler: hide form without saving
  on(expCancelBtn, 'click', (e) => {
    e.preventDefault();
    hideExpenseForm();
    resetExpenseForm();
  });

  on(tbody, 'click', (e) => {
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
  });

    on(totalEl, "change", () => {
      // When the total budget changes, update the cost on the trip and
      // persist it.  Use parseCurrency to handle formatted input.
      const newBudget = parseCurrency(totalEl.value);
      const tripsAll = getTrips(me.email);
      const idx = tripsAll.findIndex(t => t.id === activeTrip.id);
      if (idx >= 0) {
        tripsAll[idx].cost = newBudget;
        saveTrips(me.email, tripsAll);
        // also update the in-memory activeTrip reference
        activeTrip.cost = newBudget;
      }
      renderTable();
    });

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
      const ctx = canvas.getContext('2d');
      // Clear or reset the chart depending on the rendering mode.  When
      // using the fallback (no Chart.js), clear the canvas entirely.  When
      // Chart.js is available, update or create an empty chart instance.
      if (useCustomChart) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        expensesChart = null;
      } else {
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
    rows.forEach(r => {
      const cat = (r.category && r.category.trim()) ? r.category.trim() : 'Uncategorised';
      const amtUSD = parseCurrency(r.amount);
      totalsUSD[cat] = (totalsUSD[cat] || 0) + amtUSD;
    });
    const labels = Object.keys(totalsUSD);
    // Convert USD totals to the currently selected currency for display
    const data = labels.map(l => currencyConverter.convert(totalsUSD[l]));
    // Provide a palette of colours.  Repeat if necessary.
    // Define a palette of distinct colours for the expense categories.  The
    // order of colours is chosen to maximise contrast between the first few
    // categories.  This palette is also reused in updateTopCategories()
    // so that the legend matches the chart.
    const colours = [
      '#ef4444', // red
      '#10b981', // green
      '#3b82f6', // blue
      '#f59e0b', // amber
      '#8b5cf6', // violet
      '#ec4899', // pink
      '#f97316', // orange
      '#13a4ec'  // sky
    ];
    const bgColours = labels.map((_, i) => colours[i % colours.length] + '33');
    const borderColours = labels.map((_, i) => colours[i % colours.length]);
    const ctx = canvas.getContext('2d');
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
      const ctx2 = canvas.getContext('2d');
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
          ctx2.fillStyle = colours[idx % colours.length];
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
        const sorted = trips.slice().sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
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
      dupBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        // Create a deep copy of the trip with a new ID and timestamps
        const newTrip = { ...trip, id: uid('trip'), createdAt: nowISO(), updatedAt: nowISO() };
        trips.push(newTrip);
        saveTrips(me.email, trips);
        // Re-render cards to include the duplicate
        renderCards(query);
        maybeWireCalendar(me);
      });
      // Delete button
      const delBtn = document.createElement('button');
      delBtn.className = 'text-red-500 text-sm hover:underline';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const confirmed = confirm('Delete this trip? This action cannot be undone.');
        if (!confirmed) return;
        const updated = trips.filter(t => t.id !== trip.id);
        saveTrips(me.email, updated);
        // Remove associated expenses and reminders
        const expKey = expensesKey(trip.id);
        store.remove(expKey);
        writeExpensesToSupabase(me.email, trip.id, []);
        const remsAll = store.get(remindersKey(me.email), []) || [];
        const filteredRems = remsAll.filter(r => r.tripId !== trip.id);
        store.set(remindersKey(me.email), filteredRems);
        writeRemindersToSupabase(me.email, filteredRems);
        trips = updated;
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
      const msg = document.createElement('li');
      msg.className = 'text-sm text-gray-600 dark:text-gray-400';
      msg.textContent = trips.length > 0 ? 'Select a trip to view reminders.' : 'Create a trip to add reminders.';
      listEl.appendChild(msg);
      return;
    }
    const allRems = store.get(remindersKey(me.email), []) || [];
    const rems = allRems.filter(r => r.tripId === tripId);
    // sort by date ascending
    rems.sort((a, b) => new Date(a.date) - new Date(b.date));
    if (rems.length === 0) {
      const msg = document.createElement('li');
      msg.className = 'text-sm text-gray-600 dark:text-gray-400';
      msg.textContent = 'No reminders yet.';
      listEl.appendChild(msg);
      return;
    }
    rems.forEach(r => {
      const li = document.createElement('li');
      li.className = 'flex items-center justify-between p-4 rounded-lg bg-gray-100 dark:bg-gray-800';
      // description
      const desc = document.createElement('div');
      const p1 = document.createElement('p');
      p1.className = 'font-medium text-gray-900 dark:text-white';
      p1.textContent = r.name;
      const p2 = document.createElement('p');
      p2.className = 'text-sm text-gray-600 dark:text-gray-400';
      p2.textContent = r.date;
      desc.appendChild(p1);
      desc.appendChild(p2);
      li.appendChild(desc);
      // delete button
      const delBtn = document.createElement('button');
      delBtn.className = 'ml-4 text-red-500 hover:text-red-700';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        // Remove reminder from array
        const updated = allRems.filter(x => x.id !== r.id);
        store.set(remindersKey(me.email), updated);
        writeRemindersToSupabase(me.email, updated);
        renderList();
      });
      li.appendChild(delBtn);
      listEl.appendChild(li);
    });
  }
  // When trip selection changes, refresh the reminders list and persist the choice
  tripSelect.addEventListener('change', () => {
    const id = tripSelect.value;
    setStoredTripSelection(me.email, id || null);
    syncTripQuery(id);
    updateAddButtonState();
    renderList();
  });
  // Add new reminder
  if (addBtn) {
    addBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      const tripId = tripSelect.value;
      const name   = (nameEl?.value || '').trim();
      const date   = dateEl?.value || '';
      if (!tripId || !name || !date) {
        // Do not allow adding reminders without full data
        return;
      }
      const allRems = store.get(remindersKey(me.email), []) || [];
      const newRem  = { id: uid('rem'), tripId, name, date };
      const updated = [...allRems, newRem];
      store.set(remindersKey(me.email), updated);
      writeRemindersToSupabase(me.email, updated);
      // Clear the form fields and refresh list
      if (nameEl) nameEl.value = '';
      if (dateEl) dateEl.value = '';
      renderList();
    });
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

    items.forEach((item) => {
      if (!item || !item.id) return;
      const li = document.createElement('li');
      li.className = 'flex items-center justify-between p-3 bg-white dark:bg-slate-800 rounded-md shadow-sm';

      const left = document.createElement('label');
      left.className = 'flex items-center gap-2 cursor-pointer';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'h-4 w-4 text-primary border-slate-300 rounded';
      checkbox.checked = Boolean(item.packed);

      const nameSpan = document.createElement('span');
      nameSpan.textContent = item.name || 'Item';
      nameSpan.className = checkbox.checked
        ? 'line-through text-slate-500 dark:text-slate-400'
        : 'text-slate-800 dark:text-slate-100';

      checkbox.addEventListener('change', () => {
        const updated = getPackingItems(tripId).map((it) =>
          it.id === item.id ? { ...it, packed: checkbox.checked } : it
        );
        savePackingItems(tripId, updated);
        renderList();
      });

      left.appendChild(checkbox);
      left.appendChild(nameSpan);
      li.appendChild(left);

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
      li.appendChild(delBtn);

      listEl.appendChild(li);
    });
  }

  tripSelect.addEventListener('change', () => {
    const id = tripSelect.value;
    setStoredTripSelection(me.email, id || null);
    updateAddButtonState();
    renderList();
  });

  addBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    const tripId = tripSelect.value;
    const name = (inputEl.value || '').trim();
    if (!tripId || !name) {
      return;
    }
    const items = getPackingItems(tripId);
    const newItem = { id: uid('pack'), name, packed: false };
    const updated = [...items, newItem];
    savePackingItems(tripId, updated);
    inputEl.value = '';
    renderList();
  });

  updateAddButtonState();
  renderList();
}

// ---------- Global nav bindings (present on several pages) ----------
function wireHeaderNav() {
    // Bind navigation links by reading their hrefs rather than hard‐coding
    // target paths. Many templates reuse the same ID names (e.g. calendar-nav
    // for both the Home and Trips links), which previously caused us to
    // redirect the “Home” link to the Trips page. To make the nav resilient
    // across pages we look up the element’s existing href and navigate there.
    const cal = qs("#calendar-nav");
    const vac = qs("#vacations-nav");
    const bud = qs("#budget-nav");
    const rem = qs("#reminders-nav");
  const pack = qs("#packing-nav");

    if (cal) {
      // Default to the trips page (calendar), using lowercase filename
      const dest = cal.getAttribute("href") || "calender.html";
      on(cal, "click", (e) => { e.preventDefault(); window.location.href = dest; });
    }
    if (vac) {
      // Default to home page, lowercase
      const dest = vac.getAttribute("href") || "homepage.html";
      on(vac, "click", (e) => { e.preventDefault(); window.location.href = dest; });
    }
    if (bud) {
      // Default to budget page, lowercase
      const dest = bud.getAttribute("href") || "budget.html";
      on(bud, "click", (e) => { e.preventDefault(); window.location.href = dest; });
    }
    if (rem) {
      // Default to the dedicated reminders page rather than an anchor on the budget page
      const dest = rem.getAttribute("href") || "reminders.html";
      on(rem, "click", (e) => { e.preventDefault(); window.location.href = dest; });
    }

    // Navigate to the packing list page if present in the header.  This binding
    // ensures the link works consistently across all templates without
    // duplicating logic.  Use lowercase filenames to avoid case‑sensitive issues.
    if (pack) {
      const dest = pack.getAttribute("href") || "packing.html";
      on(pack, "click", (e) => { e.preventDefault(); window.location.href = dest; });
    }
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
    wireHeaderNav();
    addLogoutShortcut();

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
    const logoutEl = qs('#logout-button');
    on(logoutEl, 'click', (ev) => {
      ev.preventDefault();
      // Clear the session and redirect to the login page.  Ensure the href
      // matches the lowercase filename on disk (logpage.html) to avoid 404s on
      // case‑sensitive deployments.
      store.remove(KEY_SESSION);
      window.location.href = 'logpage.html';
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
    if (qs('#vacation-name')) {
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