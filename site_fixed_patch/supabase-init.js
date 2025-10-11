/**
 * Supabase initialization module
 *
 * This script sets up a Supabase client and exposes it globally via
 * `window.supabaseClient`.  It is loaded on each page alongside `app.js`
 * and is responsible for configuring the connection to your Supabase
 * project.  Replace the placeholder strings below with your actual
 * Supabase project URL and anonymous key after creating a project
 * in the Supabase dashboard.
 *
 * The Supabase JavaScript client library is loaded via CDN in your HTML
 * pages before this script runs.  See the HTML templates for details.
 */

// TODO: Replace these placeholder values once you have created
// a Supabase project and obtained the corresponding URL and anon key.
// URL for your Supabase project.  This comes from the Supabase dashboard
// under Project Settings → API.  See documentation for details.
const SUPABASE_URL = 'https://eayvlgxeqjiexdxjjsth.supabase.co';

// Anonymous (publishable) API key for your project.  This JWT is safe to
// expose in client‑side code as long as Row Level Security (RLS) is configured
// appropriately on your tables.  Do not share your service role key in
// frontend code.  Replace this value with the anon key from your dashboard.
const SUPABASE_ANON_KEY =
  // The anon key has three segments separated by dots.  It is important to
  // keep the string intact (no spaces or newlines).  If you regenerate
  // the key in the dashboard, update it here accordingly.
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVheXZsZ3hlcWppZXhkeGpqc3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4MjcxNjcsImV4cCI6MjA3NTQwMzE2N30.Dpa2DNcbogWhl5MB-Ct7vT28iNmJeeMWqHhutEh8bSM';

// Ensure the Supabase global is present.  When loaded from the CDN
// (see https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2), the library
// attaches itself to the `window.supabase` namespace.  The check below
// prevents errors if the CDN script fails to load.
if (window.supabase && typeof window.supabase.createClient === 'function') {
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  // Expose the client on the global window so other scripts (like app.js)
  // can access it without additional imports.
  window.supabaseClient = client;
  console.log('Supabase initialised');
} else {
  console.error(
    'Supabase JS library not loaded. Please include the CDN script before supabase-init.js.',
  );
}