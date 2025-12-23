/**
 * MTN MoMo Callback Handler
 *
 * This module handles webhook callbacks from MTN MoMo API
 * when payment status changes (PENDING -> SUCCESSFUL/FAILED)
 *
 * According to MTN MoMo documentation, callbacks are sent to the
 * X-Callback-Url provided in the requesttopay request
 */

const express = require("express");
const router = express.Router();
const crypto = require("crypto");

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
    console.log("⚠️ Supabase credentials not found - running in offline mode (no database)");
  }
} catch (error) {
  console.log("⚠️ Supabase initialization failed - running in offline mode:", error.message);
}

/**
 * CALLBACK PAYLOAD STRUCTURE (from MTN MoMo)
 *
 * Headers:
 * - x-reference-id: The reference ID of the transaction
 * - Content-Type: application/json
 *
 * Body:
 * {
 *   "financialTransactionId": "123456789",
 *   "externalId": "ORDER-12345",
 *   "amount": "100",
 *   "currency": "LRD",
 *   "payer": {
 *     "partyIdType": "MSISDN",
 *     "partyId": "231770123456"
 *   },
 *   "payerMessage": "Payment message",
 *   "payeeNote": "Note",
 *   "status": "SUCCESSFUL",  // or "FAILED", "PENDING"
 *   "reason": "Optional reason if failed"
 * }
 */

// In-memory store (shared with main server)
let transactionStore = new Map();

// Event listeners for real-time notifications
const callbackListeners = new Set();

/**
 * Set the transaction store (for dependency injection)
 */
function setTransactionStore(store) {
  transactionStore = store;
}

/**
 * Register a callback listener for real-time updates
 * Useful for WebSocket implementations
 */
function registerCallbackListener(listener) {
  callbackListeners.add(listener);
}

function unregisterCallbackListener(listener) {
  callbackListeners.delete(listener);
}

/**
 * Notify all registered listeners about transaction update
 */
function notifyListeners(transactionData) {
  callbackListeners.forEach((listener) => {
    try {
      listener(transactionData);
    } catch (error) {
      console.error("Error notifying listener:", error);
    }
  });
}

/**
 * Verify callback signature (if MTN provides signature validation)
 * Currently MTN doesn't provide signature validation, but this is a placeholder
 * for when they implement it
 */
function verifyCallbackSignature(payload, signature, secret) {
  if (!signature || !secret) {
    return true; // Skip verification if not configured
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(payload))
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Process successful payment
 */
async function processSuccessfulPayment(transactionData) {
  console.log("✅ Processing successful payment:", transactionData.referenceId);

  try {
    let updatedOrder = null;

    // Update transaction in Supabase database (if connected)
    if (supabase) {
      const updateData = {
        payment_status: "SUCCESSFUL",
        payment_confirmed_at: new Date().toISOString(),
        financial_transaction_id: transactionData.financialTransactionId || null,
        callback_received: true,
        callback_data: transactionData,
        last_status_check: new Date().toISOString(),
      };

      const { data, error: dbError } = await supabase
        .from("orders")
        .update(updateData)
        .eq("reference_id", transactionData.referenceId)
        .select()
        .single();

      if (dbError) {
        console.error("❌ Database update error:", dbError);
      } else {
        updatedOrder = data;
        console.log("✅ Order updated in database:", updatedOrder.id);
      }
    } else {
      console.log("⚠️ Skipping database update (offline mode)");
    }

    // Update in-memory store
    transactionData.status = "SUCCESSFUL";
    transactionData.processedAt = new Date().toISOString();
    transactionStore.set(transactionData.referenceId, transactionData);

    // Notify listeners (WebSocket, etc.)
    notifyListeners(transactionData);

    // Send confirmation email to customer
    await sendConfirmationEmail(updatedOrder || transactionData);

    // Update inventory
    await updateInventory(updatedOrder || transactionData);

    // Award loyalty points
    await awardLoyaltyPoints(updatedOrder || transactionData);

    // Trigger order fulfillment
    await triggerOrderFulfillment(updatedOrder || transactionData);

    return updatedOrder || transactionData;
  } catch (error) {
    console.error("❌ Error processing successful payment:", error);
    throw error;
  }
}

/**
 * Process failed payment
 */
async function processFailedPayment(transactionData, reason) {
  console.log("❌ Processing failed payment:", transactionData.referenceId);

  try {
    let updatedOrder = null;

    // Update transaction in Supabase database (if connected)
    if (supabase) {
      const updateData = {
        payment_status: "FAILED",
        failure_reason: reason || "Unknown",
        callback_received: true,
        callback_data: transactionData,
        last_status_check: new Date().toISOString(),
      };

      const { data, error: dbError } = await supabase
        .from("orders")
        .update(updateData)
        .eq("reference_id", transactionData.referenceId)
        .select()
        .single();

      if (dbError) {
        console.error("❌ Database update error:", dbError);
      } else {
        updatedOrder = data;
        console.log("✅ Order marked as failed in database:", updatedOrder.id);
      }
    } else {
      console.log("⚠️ Skipping database update (offline mode)");
    }

    // Update in-memory store
    transactionData.status = "FAILED";
    transactionData.failureReason = reason || "Unknown";
    transactionData.processedAt = new Date().toISOString();
    transactionStore.set(transactionData.referenceId, transactionData);

    // Notify listeners
    notifyListeners(transactionData);

    // Send failure notification to customer
    await sendFailureNotification(updatedOrder || transactionData, reason);

    // Log for analytics
    logFailedTransaction(transactionData);

    return updatedOrder || transactionData;
  } catch (error) {
    console.error("❌ Error processing failed payment:", error);
    throw error;
  }
}

/**
 * Process pending payment (payment initiated but not yet confirmed)
 */
async function processPendingPayment(transactionData) {
  console.log("⏳ Processing pending payment:", transactionData.referenceId);

  try {
    let updatedOrder = null;

    // Update transaction in Supabase database (if connected)
    if (supabase) {
      const updateData = {
        payment_status: "PENDING",
        callback_received: true,
        callback_data: transactionData,
        last_status_check: new Date().toISOString(),
      };

      const { data, error: dbError } = await supabase
        .from("orders")
        .update(updateData)
        .eq("reference_id", transactionData.referenceId)
        .select()
        .single();

      if (dbError) {
        console.error("❌ Database update error:", dbError);
      } else {
        updatedOrder = data;
      }
    } else {
      console.log("⚠️ Skipping database update (offline mode)");
    }

    // Update in-memory store
    transactionData.status = "PENDING";
    transactionData.lastUpdated = new Date().toISOString();
    transactionStore.set(transactionData.referenceId, transactionData);

    // Notify listeners
    notifyListeners(transactionData);

    return updatedOrder || transactionData;
  } catch (error) {
    console.error("❌ Error processing pending payment:", error);
    throw error;
  }
}

/**
 * Send confirmation email to customer
 * Replace with your email service (SendGrid, AWS SES, Resend, etc.)
 */
async function sendConfirmationEmail(order) {
  try {
    console.log("📧 Sending confirmation email to:", order.customer_email);

    // Example: Using Resend or any email service
    /*
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: 'orders@litwaypicks.com',
      to: order.customer_email,
      subject: 'Payment Successful - Order Confirmation',
      html: `
        <h2>Payment Successful!</h2>
        <p>Dear ${order.customer_first_name},</p>
        <p>Your payment of ${order.amount} ${order.currency} has been received.</p>
        <p>Order ID: ${order.external_id}</p>
        <p>Reference: ${order.reference_id}</p>
        <p>Transaction ID: ${order.financial_transaction_id}</p>
        <p>We'll send you shipping updates soon!</p>
      `,
    });
    */

    return true;
  } catch (error) {
    console.error("📧 Email send error:", error);
    return false;
  }
}

/**
 * Send failure notification to customer
 */
async function sendFailureNotification(order, reason) {
  try {
    console.log("📧 Sending failure notification to:", order.customer_email);

    // Send email or SMS notification
    /*
    await resend.emails.send({
      from: 'orders@litwaypicks.com',
      to: order.customer_email,
      subject: 'Payment Failed - Order Not Completed',
      html: `
        <h2>Payment Failed</h2>
        <p>Dear ${order.customer_first_name},</p>
        <p>Unfortunately, your payment could not be processed.</p>
        <p>Reason: ${reason}</p>
        <p>Please try again or contact support at support@litwaypicks.com</p>
      `,
    });
    */

    return true;
  } catch (error) {
    console.error("📧 Notification send error:", error);
    return false;
  }
}

/**
 * Update inventory after successful payment
 */
async function updateInventory(order) {
  try {
    console.log("📦 Updating inventory for:", order.reference_id);

    // Update your inventory in Supabase
    if (order.items && Array.isArray(order.items)) {
      for (const item of order.items) {
        // Decrement inventory quantity
        /*
        const { error } = await supabase
          .from('products')
          .update({ 
            stock: supabase.raw('stock - ?', [item.quantity])
          })
          .eq('id', item.id);

        if (error) {
          console.error(`❌ Failed to update inventory for ${item.name}:`, error);
        }
        */
      }
    }

    return true;
  } catch (error) {
    console.error("📦 Inventory update error:", error);
    return false;
  }
}

/**
 * Award loyalty points to customer
 */
async function awardLoyaltyPoints(order) {
  try {
    console.log("🎁 Awarding loyalty points:", order.reference_id);

    // Points are already calculated and stored in order.points_earned
    // You might want to create a separate loyalty_transactions table
    /*
    const { error } = await supabase
      .from('loyalty_transactions')
      .insert({
        customer_email: order.customer_email,
        points: order.points_earned,
        order_id: order.id,
        transaction_type: 'earned',
        description: `Purchase - Order ${order.external_id}`,
      });

    if (error) {
      console.error('❌ Failed to award loyalty points:', error);
    }
    */

    return true;
  } catch (error) {
    console.error("🎁 Loyalty points error:", error);
    return false;
  }
}

/**
 * Trigger order fulfillment process
 */
async function triggerOrderFulfillment(order) {
  try {
    console.log("🚚 Triggering order fulfillment:", order.reference_id);

    // Create fulfillment record or trigger webhook to fulfillment service
    /*
    const { error } = await supabase
      .from('fulfillments')
      .insert({
        order_id: order.id,
        status: 'pending',
        delivery_address: order.delivery_address,
        delivery_city: order.delivery_city,
        delivery_state: order.delivery_state,
        customer_phone: order.customer_phone,
        items: order.items,
      });

    if (error) {
      console.error('❌ Failed to create fulfillment:', error);
    }
    */

    return true;
  } catch (error) {
    console.error("🚚 Order fulfillment error:", error);
    return false;
  }
}

/**
 * Log failed transaction for analytics
 */
function logFailedTransaction(transactionData) {
  try {
    console.log("📊 Logging failed transaction:", {
      referenceId: transactionData.referenceId,
      reason: transactionData.failureReason || transactionData.reason,
      amount: transactionData.amount,
      phone: transactionData.payer?.partyId,
    });

    // Log to your analytics service
    // analytics.track('payment_failed', transactionData);
  } catch (error) {
    console.error("📊 Analytics logging error:", error);
  }
}

/**
 * Main callback handler endpoint (POST as requested)
 * 
 * ============================================================
 * MTN MoMo Callback Payload Examples
 * ============================================================
 * 
 * PENDING/CREATED Response:
 * {
 *   "financialTransactionId": "1232423212",
 *   "externalId": "qksdufkqkcjkui3239998934r32saf",
 *   "amount": "20",
 *   "currency": "USD",
 *   "payer": { "partyIdType": "MSISDN", "partyId": "231886000000" },
 *   "payeeNote": "Payment for services",
 *   "status": "PENDING"
 * }
 * 
 * SUCCESSFUL Response:
 * {
 *   "financialTransactionId": "1232423212",
 *   "externalId": "qksdufkqkcjkui3239998934r32saf",
 *   "amount": "20",
 *   "currency": "USD",
 *   "payer": { "partyIdType": "MSISDN", "partyId": "231886000000" },
 *   "payeeNote": "Payment for services",
 *   "status": "SUCCESSFUL"
 * }
 * 
 * FAILED Response (Note: financialTransactionId may be absent):
 * {
 *   "externalId": "426d6042a658d90881eafca6ca374f87",
 *   "amount": "5000",
 *   "currency": "LRD",
 *   "payer": { "partyIdType": "MSISDN", "partyId": "231888242902" },
 *   "payeeNote": "1000 votes for Grok",
 *   "status": "FAILED",
 *   "reason": "LOW_BALANCE_OR_PAYEE_LIMIT_REACHED_OR_NOT_ALLOWED"
 * }
 * 
 * ============================================================
 * Common Failure Reasons:
 * ============================================================
 * - LOW_BALANCE_OR_PAYEE_LIMIT_REACHED_OR_NOT_ALLOWED
 * - PAYER_NOT_FOUND
 * - NOT_ENOUGH_FUNDS
 * - INTERNAL_PROCESSING_ERROR
 * - TRANSACTION_CANCELLED
 * - APPROVAL_REJECTED
 * - EXPIRED
 * ============================================================
 */
router.post("/callback", async (req, res) => {
  const startTime = Date.now();

  try {
    // Log incoming callback
    console.log("=".repeat(80));
    console.log("📥 CALLBACK RECEIVED:", new Date().toISOString());
    console.log("=".repeat(80));
    console.log("Headers:", JSON.stringify(req.headers, null, 2));
    console.log("Body:", JSON.stringify(req.body, null, 2));

    // ============================================================
    // EXTRACT IMPORTANT KEYS FROM CALLBACK PAYLOAD
    // ============================================================
    const callbackPayload = req.body;
    
    // Core transaction identifiers
    const financialTransactionId = callbackPayload.financialTransactionId || null;
    const externalId = callbackPayload.externalId || null;
    const referenceId = req.headers["x-reference-id"] || callbackPayload.referenceId || externalId;
    
    // Transaction details
    const amount = callbackPayload.amount || null;
    const currency = callbackPayload.currency || null;
    const status = callbackPayload.status || null;
    
    // Payer information
    const payer = callbackPayload.payer || {};
    const payerIdType = payer.partyIdType || null;  // Usually "MSISDN"
    const payerPhone = payer.partyId || null;       // Phone number (e.g., "231886000000")
    
    // Additional info
    const payeeNote = callbackPayload.payeeNote || null;
    const payerMessage = callbackPayload.payerMessage || null;
    const reason = callbackPayload.reason || null;  // Only present if FAILED
    
    // Log extracted values
    console.log("\n📋 EXTRACTED CALLBACK DATA:");
    console.log("------------------------------------------------------------");
    console.log("  Financial Transaction ID:", financialTransactionId || "(not provided)");
    console.log("  External ID:             ", externalId);
    console.log("  Reference ID:            ", referenceId);
    console.log("  Amount:                  ", amount, currency);
    console.log("  Status:                  ", status);
    console.log("  Payer Phone:             ", payerPhone, `(${payerIdType})`);
    console.log("  Payee Note:              ", payeeNote || "(not provided)");
    console.log("  Payer Message:           ", payerMessage || "(not provided)");
    console.log("  Failure Reason:          ", reason || "N/A");
    console.log("------------------------------------------------------------\n");

    // ============================================================
    // VALIDATION
    // ============================================================
    if (!referenceId && !externalId && !financialTransactionId) {
      console.error("❌ No identifier found in callback");
      return res.status(400).json({
        success: false,
        message: "Reference ID, External ID, or Financial Transaction ID is required",
      });
    }

    // Use the best available identifier
    const transactionId = referenceId || externalId || financialTransactionId;

    // Verify callback signature (if implemented by MTN)
    const signature = req.headers["x-momo-signature"];
    const secret = process.env.MOMO_CALLBACK_SECRET;

    if (secret && signature) {
      const isValid = verifyCallbackSignature(req.body, signature, secret);
      if (!isValid) {
        console.error("❌ Invalid callback signature");
        return res.status(401).json({
          success: false,
          message: "Invalid signature",
        });
      }
    }

    // ============================================================
    // BUILD TRANSACTION DATA OBJECT
    // ============================================================
    // Get existing transaction data from in-memory store
    let transactionData = transactionStore.get(transactionId);

    if (!transactionData) {
      console.warn("⚠️ Transaction not found in store, fetching from database");

      // Try to get from database (if connected)
      if (supabase) {
        const { data: order } = await supabase
          .from("orders")
          .select("*")
          .or(`reference_id.eq.${transactionId},external_id.eq.${externalId}`)
          .single();

        if (order) {
          transactionData = {
            referenceId: order.reference_id || transactionId,
            orderId: order.id,
            status: order.payment_status,
            createdAt: order.created_at,
          };
        } else {
          transactionData = {
            referenceId: transactionId,
            createdAt: new Date().toISOString(),
          };
        }
      } else {
        // Offline mode - create new transaction data
        transactionData = {
          referenceId: transactionId,
          createdAt: new Date().toISOString(),
        };
      }
    }

    // Update transaction data with ALL callback fields
    transactionData = {
      ...transactionData,
      // Identifiers
      referenceId: transactionId,
      financialTransactionId,
      externalId,
      // Transaction details
      amount,
      currency,
      status,
      // Payer info
      payer,
      payerPhone,
      payerIdType,
      // Notes
      payeeNote,
      payerMessage,
      // Failure info (if applicable)
      reason,
      // Metadata
      callbackReceivedAt: new Date().toISOString(),
      rawCallbackPayload: callbackPayload,
    };

    // ============================================================
    // PROCESS BASED ON STATUS
    // ============================================================
    // TODO: Add your custom business logic here based on status
    // Examples:
    // - SUCCESSFUL: Fulfill order, send confirmation, update inventory
    // - FAILED: Notify customer, log for analytics, release held inventory
    // - PENDING: Update UI, send "waiting" notification
    // - CREATED: Initial state, payment request acknowledged

    switch (status) {
      case "SUCCESSFUL":
        console.log("✅ Payment SUCCESSFUL");
        // TODO: Implement your success logic
        // - Send confirmation email/SMS
        // - Update order status to "paid"
        // - Trigger fulfillment/shipping
        // - Award loyalty points
        // - Update inventory
        await processSuccessfulPayment(transactionData);
        break;

      case "FAILED":
        console.log("❌ Payment FAILED");
        // TODO: Implement your failure logic
        // - Send failure notification
        // - Release any held inventory
        // - Log failure reason for analytics
        // - Offer retry option
        await processFailedPayment(transactionData, reason);
        break;

      case "PENDING":
      case "CREATED":
        console.log("⏳ Payment PENDING/CREATED");
        // TODO: Implement your pending logic
        // - Update UI to show "waiting for confirmation"
        // - Start timeout for checking status
        // - Send "payment in progress" notification
        await processPendingPayment(transactionData);
        break;

      default:
        console.warn("⚠️ Unknown payment status:", status);
        // TODO: Handle unknown status
        // - Log for investigation
        // - Possibly treat as pending
        transactionStore.set(transactionId, transactionData);
    }

    // ============================================================
    // RESPOND TO MTN MOMO
    // ============================================================
    const processingTime = Date.now() - startTime;
    console.log(`✅ Callback processed in ${processingTime}ms`);
    console.log("=".repeat(80));

    // Must respond with 200 OK to acknowledge receipt
    res.status(200).json({
      success: true,
      message: "Callback received and processed",
      referenceId: transactionId,
      financialTransactionId,
      externalId,
      status,
      processingTime: `${processingTime}ms`,
    });
  } catch (error) {
    console.error("❌ Callback processing error:", error);
    console.error("Stack trace:", error.stack);

    // Still respond with 200 to avoid MTN retries
    // Log the error for investigation
    res.status(200).json({
      success: false,
      message: "Callback received but processing failed",
      error: error.message,
    });
  }
});

/**
 * Get callback history (for debugging)
 */
router.get("/callback/history/:referenceId", async (req, res) => {
  const { referenceId } = req.params;

  try {
    // Check in-memory store first
    const inMemoryData = transactionStore.get(referenceId);

    // Get from database (if connected)
    let order = null;
    if (supabase) {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("reference_id", referenceId)
        .single();

      if (!error) {
        order = data;
      }
    }

    if (!order && !inMemoryData) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
        databaseConnected: !!supabase,
      });
    }

    res.json({
      success: true,
      transaction: order || inMemoryData,
      inMemory: !!inMemoryData,
      inDatabase: !!order,
      databaseConnected: !!supabase,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch transaction",
      error: error.message,
    });
  }
});

/**
 * Get callback logs (for debugging)
 */
router.get("/callback-logs", async (req, res) => {
  try {
    // If database is connected, fetch from there
    if (supabase) {
      const { data: orders, error } = await supabase
        .from("orders")
        .select(
          "reference_id, payment_status, callback_received, callback_data, created_at, last_status_check, financial_transaction_id"
        )
        .eq("callback_received", true)
        .order("last_status_check", { ascending: false })
        .limit(50);

      if (error) throw error;

      res.json({
        success: true,
        count: orders.length,
        logs: orders,
        source: "database",
      });
    } else {
      // Return in-memory transactions
      const inMemoryLogs = Array.from(transactionStore.values()).map((tx) => ({
        reference_id: tx.referenceId,
        payment_status: tx.status,
        callback_received: true,
        callback_data: tx,
        created_at: tx.createdAt,
        last_status_check: tx.processedAt || tx.lastUpdated,
        financial_transaction_id: tx.financialTransactionId,
      }));

      res.json({
        success: true,
        count: inMemoryLogs.length,
        logs: inMemoryLogs,
        source: "memory",
        note: "Database not connected - showing in-memory transactions only",
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch callback logs",
      error: error.message,
    });
  }
});

/**
 * Test callback endpoint (for development)
 */
router.post("/callback/test", async (req, res) => {
  console.log("🧪 Test callback triggered");

  const testCallback = {
    referenceId: req.body.referenceId || "test-" + Date.now(),
    financialTransactionId: "TEST-" + Math.random().toString(36).substring(7),
    externalId: req.body.externalId || "ORDER-TEST",
    amount: req.body.amount || "100",
    currency: req.body.currency || "LRD",
    status: req.body.status || "SUCCESSFUL",
    payer: {
      partyIdType: "MSISDN",
      partyId: "231770123456",
    },
  };

  console.log("Test callback data:", testCallback);

  res.json({
    success: true,
    message: "Test callback data generated",
    testData: testCallback,
    note: "Use POST /api/momo/callback with this data to test the actual callback handler",
  });
});

module.exports = {
  router,
  setTransactionStore,
  registerCallbackListener,
  unregisterCallbackListener,
  processSuccessfulPayment,
  processFailedPayment,
  processPendingPayment,
};
