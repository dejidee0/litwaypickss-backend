require("dotenv").config();

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

module.exports = {
  MOMO_BASE_URL,
  MOMO_SUBSCRIPTION_KEY,
  MOMO_API_USER_ID,
  MOMO_API_KEY,
  MOMO_ENVIRONMENT,
  CALLBACK_URL,
};
