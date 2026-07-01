import { createClient } from "@supabase/supabase-js";

// Même base Supabase que l'app actuelle. La clé publishable est publique par
// design (sécurité via les policies RLS). Ne jamais mettre la clé service_role ici.
const SUPABASE_URL = "https://tytbkyyfhlyhxpbcwnkw.supabase.co";
const SUPABASE_KEY = "sb_publishable_LQS5P8cn2kd8pKnN7kiilg_y9UgGLAx";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
