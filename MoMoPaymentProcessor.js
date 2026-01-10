const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
require("dotenv").config();

// Import callback handler
const {
  router: callbackRouter,
  setTransactionStore,
} = require("./MoMoCallbackHandler");

// Import configuration
const supabase = require("./config/database");
const {
  MOMO_ENVIRONMENT,
  MOMO_BASE_URL,
  CALLBACK_URL,
  MOMO_SUBSCRIPTION_KEY,
  MOMO_API_USER_ID,
  MOMO_API_KEY,
} = require("./config/momo.config");

// Import routes
const paymentRoutes = require("./routes/payment.routes");
const transactionRoutes = require("./routes/transaction.routes");

// Import transaction store
const pendingTransactions = require("./utils/transactionStore");

// Initialize Express app
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Share transaction store with callback handler
setTransactionStore(pendingTransactions);

// Mount routes
app.use("/api/momo", paymentRoutes);
app.use("/api/momo", transactionRoutes);
app.use("/api/momo", callbackRouter);

// Health Check - GET
app.get("/", (req, res) => {
  res.json({
    status: "running",
    message: "MTN MoMo Payment Server is operational",
    timestamp: new Date().toISOString(),
    database: supabase ? "connected" : "offline",
  });
});

// Health Check - POST
app.post("/", (req, res) => {
  res.json({
    status: "running",
    message: "MTN MoMo Payment Server is operational",
    timestamp: new Date().toISOString(),
    database: supabase ? "connected" : "offline",
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${MOMO_ENVIRONMENT}`);
  console.log(`💱 Currency: LRD (Liberian Dollar)`);
  console.log(`🌐 Base URL: ${MOMO_BASE_URL}`);
  console.log(`🔗 Callback URL: ${CALLBACK_URL}`);
  console.log(
    `💾 Supabase: ${supabase ? "Connected" : "Not configured (offline mode)"}`,
  );
  console.log("\n" + "=".repeat(60));
  console.log("🔍 Configuration Check:");
  console.log("=".repeat(60));
  console.log(
    "✓ Subscription Key:",
    MOMO_SUBSCRIPTION_KEY ? "SET" : "❌ MISSING",
  );
  console.log("✓ API User ID:", MOMO_API_USER_ID ? "SET" : "❌ MISSING");
  console.log("✓ API Key:", MOMO_API_KEY ? "SET" : "❌ MISSING");
  console.log("=".repeat(60) + "\n");
});
