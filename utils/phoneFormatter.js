/**
 * Format phone number to Liberian MSISDN format
 * @param {string} phone - Raw phone number
 * @returns {object} { success: boolean, phone?: string, error?: string }
 */
function formatLiberianPhone(phone) {
  if (!phone) {
    return {
      success: false,
      error: "Phone number is required",
    };
  }

  // Format phone number
  let formattedPhone = phone.replace(/\D/g, ""); // digits only
  formattedPhone = formattedPhone.replace(/^\+/, "").replace(/^0+/, "");
  if (!formattedPhone.startsWith("231")) {
    formattedPhone = "231" + formattedPhone;
  }

  // Liberia numbers must be 12 digits (231 + 9-digit number)
  if (formattedPhone.length !== 12) {
    return {
      success: false,
      error: `Invalid Liberia MSISDN: ${formattedPhone}. Must be 12 digits (231 + 9-digit number)`,
    };
  }

  return {
    success: true,
    phone: formattedPhone,
  };
}

module.exports = {
  formatLiberianPhone,
};
