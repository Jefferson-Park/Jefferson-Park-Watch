import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.108.2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true }
});

export default sb;
export { sb };
