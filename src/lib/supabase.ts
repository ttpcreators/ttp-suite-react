import { createClient } from "@supabase/supabase-js";

// Nouveau projet Supabase (migration egress). La clé anon est publique par
// design (sécurité via les policies RLS). Ne jamais mettre la clé service_role ici.
const SUPABASE_URL = "https://zizvggziggswhrbuyhuo.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InppenZnZ3ppZ2dzd2hyYnV5aHVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5Mzk2NjcsImV4cCI6MjA5ODUxNTY2N30.5nB-lhwwasTyKKYAyO0m79gcu6xAg5b0oH2uobUcvQU";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
