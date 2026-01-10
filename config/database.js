require("dotenv").config();

// Initialize Supabase client (optional - only if credentials are provided)
let supabase = null;
try {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { createClient } = require("@supabase/supabase-js");
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    console.log("✅ Supabase client initialized");
  } else {
    console.log(
      "⚠️ Supabase credentials not found - running in offline mode (no database)"
    );
  }
} catch (error) {
  console.log(
    "⚠️ Supabase initialization failed - running in offline mode:",
    error.message
  );
}

module.exports = supabase;
