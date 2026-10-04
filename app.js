/* =====================================================================
   KIRBY'S SUBSCRIPTION TRACKER
   ===================================================================== */

/* ---------------------------------------------------------------------
   1. CONFIG: paste YOUR Supabase details here
   Find them in Supabase: Project Settings > API
   (the "anon" / "publishable" key is safe to put here, row level
   security protects your data. NEVER paste the "service_role" key.)
   --------------------------------------------------------------------- */
const SUPABASE_URL = 'https://ckkawcagzezqzsxbcqqd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_bawdj0M6KUw0d5cmIEhzzA_Sx_2CE-e';

/* ---------------------------------------------------------------------
   2. SETTINGS: tweak these if you like
   --------------------------------------------------------------------- */
const LOCALE = 'en-CA';
const CURRENCY = 'CAD';

// Each frequency knows how to convert a cost into its biweekly equivalent.
// To add a new frequency, add it here AND in the <select> in index.html
// AND in the SQL check constraint.
const FREQUENCIES = {
  weekly:   { label: 'Weekly',   toBiweekly: (c) => c * 2 },
  biweekly: { label: 'Biweekly', toBiweekly: (c) => c },
  monthly:  { label: 'Monthly',  toBiweekly: (c) => (c * 12) / 26 },
  yearly:   { label: 'Yearly',   toBiweekly: (c) => c / 26 },
};

/* ---------------------------------------------------------------------
   3. HELPERS
   --------------------------------------------------------------------- */
const $ = (id) => document.getElementById(id);

const moneyFormatter = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY });
// Round to 2 decimals, then format like "$12.34"
const fmt = (n) => moneyFormatter.format(Math.round(n * 100) / 100);

const biweeklyCost = (sub) => FREQUENCIES[sub.frequency].toBiweekly(Number(sub.cost));

/* ---------------------------------------------------------------------
   4. START UP
   --------------------------------------------------------------------- */
// Register the service worker (lets the app shell load offline)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}

let db = null;             // the Supabase client
let subs = [];             // the list of subscriptions in memory
let editingId = null;      // id of the subscription being edited (null = adding new)
let currentUserId = null;  // used so we don't reload the list needlessly

if (!window.supabase) {
  showFatal("Couldn't load the Supabase library. Check your internet connection and reload.");
} else if (SUPABASE_URL.includes('YOUR-PROJECT-ID')) {
  showFatal('Setup needed: paste your Supabase URL and key at the top of app.js.');
} else {
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Runs once on load and again whenever you sign in or out.
  db.auth.onAuthStateChange((_event, session) => {
    const userId = session ? session.user.id : null;
    if (userId === currentUserId && _event !== 'SIGNED_OUT') return; // nothing changed
    currentUserId = userId;
    showView(session);
  });
}

function showFatal(message) {
  $('login-view').classList.remove('hidden');
  $('login-error').textContent = message;
}

function showView(session) {
  $('login-view').classList.toggle('hidden', !!session);
  $('app-view').classList.toggle('hidden', !session);
  if (session) loadSubs();
}

/* ---------------------------------------------------------------------
   5. SIGN IN / OUT
   --------------------------------------------------------------------- */
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!db) return;
  $('login-error').textContent = '';
  const { error } = await db.auth.signInWithPassword({
    email: $('login-email').value.trim(),
    password: $('login-password').value,
  });
  if (error) $('login-error').textContent = error.message;
});

$('signout-btn').addEventListener('click', () => db.auth.signOut());

/* ---------------------------------------------------------------------
   6. LOAD + DRAW THE LIST
   --------------------------------------------------------------------- */
async function loadSubs() {
  $('status').textContent = 'Loading...';
  const { data, error } = await db
    .from('subscriptions')
    .select('*')
    .order('created_at', { ascending: true }); // change the sort here if you want

  if (error) {
    $('status').textContent = "Couldn't load your subscriptions. Check your connection.";
    return;
  }
  subs = data;
  render();
}

// Try again automatically when the phone comes back online
window.addEventListener('online', () => { if (currentUserId) loadSubs(); });

function render() {
  const list = $('sub-list');
  list.innerHTML = '';

  let totalBiweekly = 0;

  subs.forEach((sub) => {
    const perTwoWeeks = biweeklyCost(sub);
    totalBiweekly += perTwoWeeks;

    // Build with textContent (not innerHTML) so names can never inject code
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'sub-item';
    btn.type = 'button';
    btn.addEventListener('click', () => openSheet(sub));

    const left = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'sub-name';
    name.textContent = sub.name;
    const meta = document.createElement('div');
    meta.className = 'sub-meta';
    meta.textContent = `${fmt(Number(sub.cost))} · ${FREQUENCIES[sub.frequency].label}`;
    left.append(name, meta);

    const right = document.createElement('div');
    right.className = 'sub-right';
    const amount = document.createElement('div');
    amount.className = 'sub-biweekly';
    amount.textContent = fmt(perTwoWeeks);
    const small = document.createElement('small');
    small.textContent = 'every 2 weeks';
    right.append(amount, small);

    btn.append(left, right);
    li.append(btn);
    list.append(li);
  });

  $('status').textContent = subs.length ? '' : 'No subscriptions yet. Tap "Add subscription" to start.';

  // Totals: monthly and yearly come from the biweekly total (26 paycheques a year)
  $('total-biweekly').textContent = fmt(totalBiweekly);
  $('total-monthly').textContent = fmt((totalBiweekly * 26) / 12);
  $('total-yearly').textContent = fmt(totalBiweekly * 26);
}

/* ---------------------------------------------------------------------
   7. ADD / EDIT PANEL
   --------------------------------------------------------------------- */
function openSheet(sub) {
  editingId = sub ? sub.id : null;
  $('sheet-title').textContent = sub ? 'Edit subscription' : 'Add subscription';
  $('f-name').value = sub ? sub.name : '';
  $('f-cost').value = sub ? Number(sub.cost).toFixed(2) : '';
  $('f-frequency').value = sub ? sub.frequency : 'monthly';
  $('form-error').textContent = '';
  $('delete-btn').classList.toggle('hidden', !sub); // only show Delete when editing
  resetDelete();
  $('overlay').classList.add('open');
  if (!sub) setTimeout(() => $('f-name').focus(), 50);
}

function closeSheet() {
  $('overlay').classList.remove('open');
  resetDelete();
}

$('add-btn').addEventListener('click', () => openSheet(null));
$('cancel-btn').addEventListener('click', closeSheet);
// Tap the dark area outside the panel to close it
$('overlay').addEventListener('click', (e) => { if (e.target === $('overlay')) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

$('sub-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = $('f-name').value.trim();
  const cost = parseFloat($('f-cost').value);
  const frequency = $('f-frequency').value;

  if (!name) return ($('form-error').textContent = 'Please enter a name.');
  if (isNaN(cost) || cost < 0) return ($('form-error').textContent = 'Please enter a valid cost.');

  $('save-btn').disabled = true;
  $('form-error').textContent = '';

  const row = { name, cost, frequency };
  const { error } = editingId
    ? await db.from('subscriptions').update(row).eq('id', editingId)
    : await db.from('subscriptions').insert(row); // user_id fills in automatically

  $('save-btn').disabled = false;

  if (error) {
    $('form-error').textContent = 'Could not save: ' + error.message;
    return;
  }
  closeSheet();
  loadSubs();
});

/* ---------------------------------------------------------------------
   8. DELETE (two taps = quick confirmation)
   First tap turns the button red and asks to confirm.
   Second tap within 3 seconds actually deletes.
   --------------------------------------------------------------------- */
let deleteArmed = false;
let deleteTimer = null;

function resetDelete() {
  deleteArmed = false;
  clearTimeout(deleteTimer);
  $('delete-btn').textContent = 'Delete';
  $('delete-btn').classList.remove('armed');
}

$('delete-btn').addEventListener('click', async () => {
  if (!deleteArmed) {
    deleteArmed = true;
    $('delete-btn').textContent = 'Tap again to confirm delete';
    $('delete-btn').classList.add('armed');
    deleteTimer = setTimeout(resetDelete, 3000);
    return;
  }

  clearTimeout(deleteTimer);
  const { error } = await db.from('subscriptions').delete().eq('id', editingId);
  if (error) {
    $('form-error').textContent = 'Could not delete: ' + error.message;
    resetDelete();
    return;
  }
  closeSheet();
  loadSubs();
});
