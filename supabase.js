const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) {
  console.error('Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) in .env.local');
  process.exit(1);
}
if (!secretKey) {
  console.error(
    'Missing SUPABASE_SECRET_KEY in .env.local.\n' +
      'The server needs the secret key (not the publishable one) to read/write data.\n' +
      'Find it in Supabase Dashboard -> Project Settings -> API Keys -> secret key.'
  );
  process.exit(1);
}

module.exports = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
