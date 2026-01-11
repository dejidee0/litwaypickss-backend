const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const {
  MOMO_BASE_URL,
  MOMO_SUBSCRIPTION_KEY,
  MOMO_API_USER_ID,
  MOMO_API_KEY,
  MOMO_ENVIRONMENT,
  CALLBACK_URL,
} = require("../config/momo.config");

// Token cache
let cachedToken = null;
let tokenExpiry = null;

/**
 * Get Access Token with caching
 * Tokens are cached and reused until expiry to reduce API calls
 */
async function getAccessToken() {
  // Check if we have a valid cached token
  if (cachedToken && tokenExpiry && new Date() < tokenExpiry) {
    return cachedToken;
  }

  const credentials = Buffer.from(
    `${MOMO_API_USER_ID}:${MOMO_API_KEY}`,
  ).toString("base64");

  try {
    const response = await axios.post(
      `${MOMO_BASE_URL}/collection/token/`,
      {},
      {
        headers: {
          "Content-Type": "application/json",
          "Ocp-Apim-Subscription-Key": MOMO_SUBSCRIPTION_KEY,
          Authorization: `Basic ${credentials}`,
        },
      },
    );

    const accessToken = response.data?.access_token;
    if (!accessToken) {
      throw new Error("No access_token in response");
    }

    // Token expires in 1 hour (3600 seconds) - set expiry to 55 minutes to be safe
    const expiresInMs = (response.data?.expires_in || 3600) * 1000;
    tokenExpiry = new Date(Date.now() + expiresInMs - 300000); // 5 minutes buffer
    cachedToken = `Bearer ${accessToken}`;

    return cachedToken;
  } catch (error) {
    console.error("❌ Token Error:", error.response?.data || error.message);
    throw new Error("Failed to get access token");
  }
}

/**
 * Clear cached token (useful for testing or forced refresh)
 */
function clearTokenCache() {
  cachedToken = null;
  tokenExpiry = null;
}

/**
 * Test Account Balance (to verify credentials are working)
 */
async function testAccountBalance(accessToken) {
  try {
    const response = await axios.get(
      `${MOMO_BASE_URL}/collection/v1_0/account/balance`,
      {
        headers: {
          Authorization: accessToken,
          "X-Target-Environment": MOMO_ENVIRONMENT,
          "Ocp-Apim-Subscription-Key": MOMO_SUBSCRIPTION_KEY,
        },
      },
    );
    return true;
  } catch (error) {
    console.error(
      "❌ Account balance check failed:",
      error.response?.data || error.message,
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
      },
    );
    return response.data;
  } catch (error) {
    console.error("❌ User info error:", error.response?.data || error.message);
    return null;
  }
}

/**
 * Fetch transaction details by reference ID
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
      },
    );
    return response.data;
  } catch (error) {
    console.error(
      "❌ Transaction fetch error:",
      error.response?.data || error.message,
    );
    return null;
  }
}

/**
 * Request to Pay
 */
async function requestToPay(details, accessToken) {
  const referenceId = uuidv4();

  try {
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

    const response = await axios.post(
      `${MOMO_BASE_URL}/collection/v1_0/requesttopay`,
      requestBody,
      {
        headers: {
          "X-Reference-Id": referenceId,
          "X-Target-Environment": MOMO_ENVIRONMENT,
          "Ocp-Apim-Subscription-Key": MOMO_SUBSCRIPTION_KEY,
          "X-Callback-Url": CALLBACK_URL,
          "Content-Type": "application/json",
          Authorization: accessToken,
        },
      },
    );

    if (
      response.status === 202 ||
      response.status === 201 ||
      response.status === 200
    ) {
      const transaction = await fetchTransactionDetails(
        referenceId,
        accessToken,
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
      error.response?.data || error.message,
    );
    throw error;
  }
}

/**
 * Get account balance
 */
async function getAccountBalance(currency = "LRD", accessToken) {
  const response = await axios.get(
    `${MOMO_BASE_URL}/collection/v1_0/account/balance/${currency}`,
    {
      headers: {
        Authorization: accessToken,
        "X-Target-Environment": MOMO_ENVIRONMENT,
        "Ocp-Apim-Subscription-Key": MOMO_SUBSCRIPTION_KEY,
      },
    },
  );
  return response.data;
}

module.exports = {
  getAccessToken,
  clearTokenCache,
  testAccountBalance,
  getUserInfo,
  fetchTransactionDetails,
  requestToPay,
  getAccountBalance,
};
