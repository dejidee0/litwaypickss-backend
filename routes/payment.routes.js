const express = require("express");
const router = express.Router();
const supabase = require("../config/database");
const { getAccessToken, requestToPay } = require("../services/momoService");
const { formatLiberianPhone } = require("../utils/phoneFormatter");
const pendingTransactions = require("../utils/transactionStore");

/**
 * POST /api/momo/pay
 * Initiate Payment (Request to Pay)
 */
router.post("/pay", async (req, res) => {
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
    const phoneResult = formatLiberianPhone(phone);
    if (!phoneResult.success) {
      return res.status(400).json({
        success: false,
        message: phoneResult.error,
      });
    }
    const formattedPhone = phoneResult.phone;

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
      accessToken,
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

    res.json({
      success: true,
      message: "Payment request sent to customer's phone",
      referenceId: result.referenceId,
      orderId: order?.id,
      transaction: result.transaction,
    });
  } catch (error) {
    console.error("❌ Payment Error:", error.message);

    let errorMessage = error.message || "Payment initiation failed";
    let statusCode = error.response?.status || 500;

    res.status(statusCode).json({
      success: false,
      message: errorMessage,
      error: error.response?.data,
    });
  }
});

module.exports = router;
