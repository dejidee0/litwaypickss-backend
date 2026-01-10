const express = require("express");
const router = express.Router();
const supabase = require("../config/database");
const {
  getAccessToken,
  fetchTransactionDetails,
  getAccountBalance,
  getUserInfo,
  testAccountBalance,
} = require("../services/momoService");
const {
  MOMO_ENVIRONMENT,
  MOMO_BASE_URL,
  CALLBACK_URL,
  MOMO_API_USER_ID,
  MOMO_API_KEY,
  MOMO_SUBSCRIPTION_KEY,
} = require("../config/momo.config");
const pendingTransactions = require("../utils/transactionStore");

/**
 * GET /api/momo/status/:referenceId
 * Check Payment Status
 */
router.get("/status/:referenceId", async (req, res) => {
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

/**
 * GET /api/momo/transactions
 * Get all transactions
 */
router.get("/transactions", async (req, res) => {
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

/**
 * GET /api/momo/order/:referenceId
 * Get order by reference ID
 */
router.get("/order/:referenceId", async (req, res) => {
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

/**
 * GET /api/momo/balance
 * Get account balance
 */
router.get("/balance", async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const balance = await getAccountBalance(accessToken);

    res.json({
      success: true,
      balance: balance,
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

/**
 * GET /api/momo/user/:msisdn
 * Get user info endpoint
 */
router.get("/user/:msisdn", async (req, res) => {
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

/**
 * GET /api/momo/config
 * Check Configuration
 */
router.get("/config", (req, res) => {
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

/**
 * GET /api/momo/test-credentials
 * Test credentials endpoint
 */
router.get("/test-credentials", async (req, res) => {
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

module.exports = router;
