const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
require("dotenv").config();

// Import callback handler
const {
  router: callbackRouter,
  setTransactionStore,
  registerCallbackListener,
} = require("./MoMoCallbackHandler");

const app = express();
app.use(cors());
app.use(bodyParser.json());

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

const MOMO_BASE_URL =
  process.env.MOMO_BASE_URL ||
  (process.env.MOMO_ENVIRONMENT === "sandbox"
    ? "https://sandbox.momodeveloper.mtn.com"
    : "https://proxy.momoapi.mtn.com");
const MOMO_SUBSCRIPTION_KEY = process.env.MOMO_SUBSCRIPTION_KEY;
const MOMO_API_USER_ID = process.env.MOMO_API_USER_ID;
const MOMO_API_KEY = process.env.MOMO_API_KEY;

const MOMO_ENVIRONMENT = process.env.MOMO_ENVIRONMENT || "mtnliberia";
const CALLBACK_URL =
  process.env.CALLBACK_URL || "https://www.litwaypicks.com/api/momo/callback";

// In-memory cache for quick lookups
const pendingTransactions = new Map();

// Share transaction store with callback handler
setTransactionStore(pendingTransactions);

/**
 * Get Access Token
 * Matches PHP: MoMoAPI::create_access_token()
 */
async function getAccessToken() {
  const credentials = Buffer.from(
    `${MOMO_API_USER_ID}:${MOMO_API_KEY}`
  ).toString("base64");

  try {
    console.log("🔑 Requesting access token...");
    console.log("📍 Token URL:", `${MOMO_BASE_URL}/collection/token/`);

    const response = await axios.post(
      `${MOMO_BASE_URL}/collection/token/`,
      {}, // Empty body like PHP
      {
        headers: {
          "Content-Type": "application/json",
          "Ocp-Apim-Subscription-Key": MOMO_SUBSCRIPTION_KEY,
          Authorization: `Basic ${credentials}`,
        },
      }
    );

    const accessToken = response.data?.access_token;
    if (!accessToken) {
      throw new Error("No access_token in response");
    }

    console.log(
      "✅ Access token obtained (expires in:",
      response.data.expires_in,
      "s)"
    );
    // Return with Bearer prefix like PHP does: "Bearer {$response['access_token']}"
    return `Bearer ${accessToken}`;
  } catch (error) {
    console.error("❌ Token Error:", error.response?.data || error.message);
    throw new Error("Failed to get access token");
  }
}

/**
 * Test Account Balance (to verify credentials are working)
 */
async function testAccountBalance(accessToken) {
  try {
    console.log("\n🧪 Testing account balance to verify credentials...");
    const response = await axios.get(
      `${MOMO_BASE_URL}/collection/v1_0/account/balance`,
      {
        headers: {
          Authorization: accessToken, // Already has "Bearer " prefix
          "X-Target-Environment": MOMO_ENVIRONMENT,
          "Ocp-Apim-Subscription-Key": MOMO_SUBSCRIPTION_KEY,
        },
      }
    );
    console.log("✅ Account balance check passed:", response.data);
    return true;
  } catch (error) {
    console.error(
      "❌ Account balance check failed:",
      error.response?.data || error.message
    );
    return false;
  }
}

/**
 * Get user info by MSISDN
 * Matches PHP: MoMoAPI::get_user_info()
 */
async function getUserInfo(msisdn, accessToken) {
  try {
    const response = await axios.get(
      `${MOMO_BASE_URL}/collection/v1_0/accountholder/MSISDN/${msisdn}/basicuserinfo`,
      {
        headers: {
          "Content-Type": "application/json",
          "X-Target-Environment": MOMO_ENVIRONMENT,
          "Ocp-Apim-Subscription-Key": MOMO_SUBSCRIPTION_KEY,
          Authorization: accessToken,
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error("❌ User info error:", error.response?.data || error.message);
    return null;
  }
}

/**
 * Fetch transaction details by reference ID
 * Matches PHP: MoMoAPI::fetch_transaction_details()
 */
async function fetchTransactionDetails(referenceId, accessToken) {
  try {
    const response = await axios.get(
      `${MOMO_BASE_URL}/collection/v1_0/requesttopay/${referenceId}`,
      {
        headers: {
          "X-Reference-Id": referenceId,
          "Content-Type": "application/json",
          "X-Target-Environment": MOMO_ENVIRONMENT,
          "Ocp-Apim-Subscription-Key": MOMO_SUBSCRIPTION_KEY,
          Authorization: accessToken,
        },
      }
    );
    return response.data;
  } catch (error) {
    console.log("refId", referenceId);
    console.error(
      "❌ Transaction fetch error:",
      error.response?.data || error.message
    );
    return null;
  }
}

/**
 * Request to Pay
 * Matches PHP: MoMoAPI::request_to_pay()
 */
async function requestToPay(details, accessToken) {
  const referenceId = uuidv4();

  try {
    // Request body matching PHP structure exactly
    const requestBody = {
      amount: details.amount.toString(),
      currency: details.currency,
      externalId: details.process_id,
      payer: {
        partyIdType: "MSISDN",
        partyId: details.phone_no,
      },
      payerMessage: details.message,
      payeeNote: details.message,
    };

    console.log("\n📤 REQUEST TO PAY:");
    console.log("URL:", `${MOMO_BASE_URL}/collection/v1_0/requesttopay`);
    console.log("Reference ID:", referenceId);
    console.log("Body:", JSON.stringify(requestBody, null, 2));

    // Headers matching PHP order:
    // X-Reference-Id, X-Target-Environment, Ocp-Apim-Subscription-Key, X-Callback-Url, Content-Type, Authorization
    const response = await axios.post(
      `${MOMO_BASE_URL}/collection/v1_0/requesttopay`,
      requestBody, // axios handles JSON.stringify automatically
      {
        headers: {
          "X-Reference-Id": referenceId,
          "X-Target-Environment": MOMO_ENVIRONMENT,
          "Ocp-Apim-Subscription-Key": MOMO_SUBSCRIPTION_KEY,
          "X-Callback-Url": CALLBACK_URL,
          "Content-Type": "application/json",
          Authorization: accessToken,
        },
        validateStatus: function (status) {
          return status >= 200 && status < 600;
        },
      }
    );

    console.log("Response Status:", response.status);

    // PHP checks for status 202, 201, or 200
    if (
      response.status === 202 ||
      response.status === 201 ||
      response.status === 200
    ) {
      // Fetch transaction details like PHP does
      const transaction = await fetchTransactionDetails(
        referenceId,
        accessToken
      );
      return {
        success: true,
        referenceId,
        transaction,
        status: response.status,
      };
    } else {
      const message = response.data?.message || "";
      throw new Error(`Unable to complete transaction. ${message}`);
    }
  } catch (error) {
    console.error(
      "❌ Request to Pay Error:",
      error.response?.data || error.message
    );
    throw error;
  }
}

// Initiate Payment (Request to Pay) - Main endpoint
app.post("/api/momo/pay", async (req, res) => {
  const {
    phone,
    amount,
    externalId,
    payerMessage,
    items,
    userInfo,
    deliveryInfo,
    appliedDiscount,
    subtotal,
  } = req.body;

  try {
    // Validate required fields
    if (!phone || !amount) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: phone and amount are required",
      });
    }

    // Format phone number
    let formattedPhone = phone.replace(/\D/g, ""); // digits only
    formattedPhone = formattedPhone.replace(/^\+/, "").replace(/^0+/, "");
    if (!formattedPhone.startsWith("231")) {
      formattedPhone = "231" + formattedPhone;
    }

    // Liberia numbers must be 12 digits (231 + 9-digit number)
    if (formattedPhone.length !== 12) {
      return res.status(400).json({
        success: false,
        message: `Invalid Liberia MSISDN: ${formattedPhone}. Must be 12 digits (231 + 9-digit number)`,
      });
    }

    console.log("\n" + "=".repeat(60));
    console.log("💳 NEW PAYMENT REQUEST");
    console.log("=".repeat(60));
    console.log("📱 Formatted phone:", formattedPhone);
    console.log("💰 Amount:", amount);

    // For Liberia, currency is LRD
    const currency = "LRD";
    const processId = externalId || `ORDER-${Date.now()}`;

    // Create order in database (if connected)
    let order = null;
    if (supabase && userInfo && deliveryInfo) {
      const { data, error: dbError } = await supabase
        .from("orders")
        .insert({
          reference_id: null, // Will update after MoMo request
          external_id: processId,
          customer_first_name: userInfo.firstName,
          customer_last_name: userInfo.lastName,
          customer_email: userInfo.email,
          customer_phone: formattedPhone,
          delivery_address: deliveryInfo.deliveryAddress,
          delivery_city: deliveryInfo.city || "",
          delivery_state: deliveryInfo.state || "",
          amount: parseFloat(amount),
          currency: currency,
          payment_method: "momo",
          payment_status: "PENDING",
          items: items,
          subtotal: parseFloat(subtotal || amount),
          discount: appliedDiscount ? parseFloat(appliedDiscount.discount) : 0,
          final_total: parseFloat(amount),
          points_earned: Math.floor(amount * 1),
          loyalty_discount_applied: appliedDiscount || null,
        })
        .select()
        .maybeSingle();

      if (dbError) {
        console.error("❌ Database Error:", dbError);
      } else {
        order = data;
        console.log("✅ Order created in database:", order.id);
      }
    }

    // Get access token
    const accessToken = await getAccessToken();

    // Make request to pay (matching PHP implementation)
    const result = await requestToPay(
      {
        amount: amount,
        currency: currency,
        process_id: processId,
        phone_no: formattedPhone,
        message: payerMessage || "Payment for order",
      },
      accessToken
    );

    // Update order with reference ID
    if (supabase && order) {
      await supabase
        .from("orders")
        .update({ reference_id: result.referenceId })
        .eq("id", order.id);
    }

    // Cache transaction for quick lookups
    pendingTransactions.set(result.referenceId, {
      referenceId: result.referenceId,
      orderId: order?.id,
      status: result.transaction?.status || "PENDING",
      timestamp: Date.now(),
    });

    console.log("✅ Payment initiated successfully:", result.referenceId);
    console.log("=".repeat(60) + "\n");

    res.json({
      success: true,
      message: "Payment request sent to customer's phone",
      referenceId: result.referenceId,
      orderId: order?.id,
      transaction: result.transaction,
    });
  } catch (error) {
    console.error("\n❌ PAYMENT ERROR:");
    console.error("Message:", error.message);
    if (error.response) {
      console.error("Response Status:", error.response.status);
      console.error("Response Data:", error.response.data);
    }
    console.log("=".repeat(60) + "\n");

    let errorMessage = error.message || "Payment initiation failed";
    let statusCode = error.response?.status || 500;

    res.status(statusCode).json({
      success: false,
      message: errorMessage,
      error: error.response?.data,
    });
  }
});

// Check Payment Status
app.get("/api/momo/status/:referenceId", async (req, res) => {
  const { referenceId } = req.params;

  try {
    // Check database first (if connected)
    if (supabase) {
      const { data: order, error: dbError } = await supabase
        .from("orders")
        .select("*")
        .eq("reference_id", referenceId)
        .single();

      if (!dbError && order) {
        if (
          order.payment_status === "SUCCESSFUL" ||
          order.payment_status === "FAILED"
        ) {
          return res.json({
            success: true,
            status: order.payment_status,
            orderDetails: order,
            source: "database",
          });
        }
      }
    }

    // Check in-memory cache
    const cached = pendingTransactions.get(referenceId);

    // Fetch from MoMo API
    const accessToken = await getAccessToken();
    const transaction = await fetchTransactionDetails(referenceId, accessToken);

    if (!transaction) {
      // Check cache
      if (cached) {
        return res.json({
          success: true,
          status: cached.status || "PENDING",
          message: "Transaction is being processed",
          source: "cache",
        });
      }
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    const status = transaction.status;

    // Update database (if connected)
    if (supabase) {
      const updateData = {
        payment_status: status,
        last_status_check: new Date().toISOString(),
      };

      if (transaction.financialTransactionId) {
        updateData.financial_transaction_id =
          transaction.financialTransactionId;
      }

      if (status === "SUCCESSFUL") {
        updateData.payment_confirmed_at = new Date().toISOString();
      }

      await supabase
        .from("orders")
        .update(updateData)
        .eq("reference_id", referenceId);
    }

    // Update cache
    if (cached) {
      cached.status = status;
      pendingTransactions.set(referenceId, cached);
    }

    console.log(`📊 Transaction ${referenceId} status: ${status}`);

    res.json({
      success: true,
      status: status,
      data: transaction,
      source: "momo_api",
    });

    // Cleanup cache after terminal status
    if (status === "SUCCESSFUL" || status === "FAILED") {
      setTimeout(() => {
        pendingTransactions.delete(referenceId);
        console.log(`🗑️ Cleaned up cache: ${referenceId}`);
      }, 300000);
    }
  } catch (error) {
    console.error(
      "❌ Status Check Error:",
      error.response?.data || error.message
    );

    res.status(500).json({
      success: false,
      message: "Failed to check payment status",
      error: error.response?.data || error.message,
    });
  }
});

// Mount callback handler routes
app.use("/api/momo", callbackRouter);

// Get account balance
app.get("/api/momo/balance", async (req, res) => {
  try {
    const accessToken = await getAccessToken();

    const response = await axios.get(
      `${MOMO_BASE_URL}/collection/v1_0/account/balance`,
      {
        headers: {
          Authorization: accessToken,
          "X-Target-Environment": MOMO_ENVIRONMENT,
          "Ocp-Apim-Subscription-Key": MOMO_SUBSCRIPTION_KEY,
        },
      }
    );

    res.json({
      success: true,
      balance: response.data,
    });
  } catch (error) {
    console.error("❌ Balance Error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch balance",
      error: error.response?.data || error.message,
    });
  }
});

// Get user info endpoint
app.get("/api/momo/user/:msisdn", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const userInfo = await getUserInfo(req.params.msisdn, accessToken);

    if (userInfo) {
      res.json({
        success: true,
        user: userInfo,
      });
    } else {
      res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch user info",
      error: error.message,
    });
  }
});

// Get all transactions
app.get("/api/momo/transactions", async (req, res) => {
  try {
    if (supabase) {
      const { data: orders, error } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      res.json({
        success: true,
        count: orders.length,
        transactions: orders,
        source: "database",
      });
    } else {
      // Return in-memory transactions
      const transactions = Array.from(pendingTransactions.values());
      res.json({
        success: true,
        count: transactions.length,
        transactions: transactions,
        source: "memory",
        note: "Database not connected",
      });
    }
  } catch (error) {
    console.error("❌ Transactions Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch transactions",
      error: error.message,
    });
  }
});

// Get order by reference ID
app.get("/api/momo/order/:referenceId", async (req, res) => {
  try {
    if (supabase) {
      const { data: order, error } = await supabase
        .from("orders")
        .select("*")
        .eq("reference_id", req.params.referenceId)
        .single();

      if (error) throw error;

      res.json({
        success: true,
        order,
        source: "database",
      });
    } else {
      const cached = pendingTransactions.get(req.params.referenceId);
      if (cached) {
        res.json({
          success: true,
          order: cached,
          source: "memory",
        });
      } else {
        throw new Error("Order not found");
      }
    }
  } catch (error) {
    res.status(404).json({
      success: false,
      message: "Order not found",
    });
  }
});

// Health Check
app.get("/", (req, res) => {
  res.json({
    status: "running",
    message: "MTN MoMo Payment Server is operational",
    timestamp: new Date().toISOString(),
    database: supabase ? "connected" : "offline",
  });
});

app.post("/", (req, res) => {
  res.json({
    status: "running",
    message: "MTN MoMo Payment Server is operational",
    timestamp: new Date().toISOString(),
    database: supabase ? "connected" : "offline",
  });
});

// Check Configuration
app.get("/api/momo/config", (req, res) => {
  res.json({
    configured: !!(MOMO_API_USER_ID && MOMO_API_KEY && MOMO_SUBSCRIPTION_KEY),
    environment: MOMO_ENVIRONMENT,
    baseUrl: MOMO_BASE_URL,
    callbackUrl: CALLBACK_URL,
    supportedCurrency: "LRD",
    hasUserId: !!MOMO_API_USER_ID,
    hasApiKey: !!MOMO_API_KEY,
    hasSubscriptionKey: !!MOMO_SUBSCRIPTION_KEY,
    supabaseConnected: !!supabase,
  });
});

// Test credentials endpoint
app.get("/api/momo/test-credentials", async (req, res) => {
  try {
    const token = await getAccessToken();
    const balanceCheck = await testAccountBalance(token);

    res.json({
      success: true,
      message: "Full auth flow successful",
      tokenReceived: !!token,
      balanceCheckPassed: balanceCheck,
      environment: MOMO_ENVIRONMENT,
      supportedCurrency: "LRD",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Auth flow failed",
      error: error.message,
    });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${MOMO_ENVIRONMENT}`);
  console.log(`💱 Currency: LRD (Liberian Dollar)`);
  console.log(`🌐 Base URL: ${MOMO_BASE_URL}`);
  console.log(`🔗 Callback URL: ${CALLBACK_URL}`);
  console.log(
    `💾 Supabase: ${supabase ? "Connected" : "Not configured (offline mode)"}`
  );
  console.log("\n" + "=".repeat(60));
  console.log("🔍 Configuration Check:");
  console.log("=".repeat(60));
  console.log(
    "✓ Subscription Key:",
    MOMO_SUBSCRIPTION_KEY ? "SET" : "❌ MISSING"
  );
  console.log("✓ API User ID:", MOMO_API_USER_ID ? "SET" : "❌ MISSING");
  console.log("✓ API Key:", MOMO_API_KEY ? "SET" : "❌ MISSING");
  console.log("=".repeat(60) + "\n");
});
