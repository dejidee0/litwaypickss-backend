# MoMo Payment API Routes

This directory contains the refactored routes for the MTN MoMo Payment integration.

## Project Structure

```
.
├── config/
│   ├── database.js           # Supabase database configuration
│   └── momo.config.js        # MoMo API configuration constants
├── services/
│   └── momoService.js        # MoMo API service functions
├── utils/
│   ├── phoneFormatter.js     # Phone number formatting utilities
│   └── transactionStore.js   # In-memory transaction cache
├── routes/
│   ├── payment.routes.js     # Payment-related endpoints
│   └── transaction.routes.js # Transaction & query endpoints
└── MoMoPaymentProcessor.js   # Main application entry point
```

## API Endpoints

### Payment Routes (`/api/momo`)

#### POST /api/momo/pay
Initiate a payment request.

**Request Body:**
```json
{
  "phone": "0770123456",
  "amount": 100,
  "externalId": "ORDER-12345",
  "payerMessage": "Payment for order",
  "items": [...],
  "userInfo": {
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com"
  },
  "deliveryInfo": {
    "deliveryAddress": "123 Main St",
    "city": "Monrovia",
    "state": "Montserrado"
  },
  "appliedDiscount": {...},
  "subtotal": 100
}
```

**Response:**
```json
{
  "success": true,
  "message": "Payment request sent to customer's phone",
  "referenceId": "uuid-v4",
  "orderId": 123,
  "transaction": {...}
}
```

### Transaction Routes (`/api/momo`)

#### GET /api/momo/status/:referenceId
Check payment status by reference ID.

**Response:**
```json
{
  "success": true,
  "status": "SUCCESSFUL",
  "data": {...},
  "source": "momo_api"
}
```

#### GET /api/momo/transactions
Get all transactions (limited to 100 most recent).

**Response:**
```json
{
  "success": true,
  "count": 10,
  "transactions": [...],
  "source": "database"
}
```

#### GET /api/momo/order/:referenceId
Get order details by reference ID.

**Response:**
```json
{
  "success": true,
  "order": {...},
  "source": "database"
}
```

#### GET /api/momo/balance
Get MoMo account balance.

**Response:**
```json
{
  "success": true,
  "balance": {
    "availableBalance": "1000",
    "currency": "LRD"
  }
}
```

#### GET /api/momo/user/:msisdn
Get user information by phone number (MSISDN).

**Response:**
```json
{
  "success": true,
  "user": {
    "given_name": "John",
    "family_name": "Doe"
  }
}
```

#### GET /api/momo/config
Check API configuration status.

**Response:**
```json
{
  "configured": true,
  "environment": "mtnliberia",
  "baseUrl": "https://proxy.momoapi.mtn.com",
  "callbackUrl": "https://www.litwaypicks.com/api/momo/callback",
  "supportedCurrency": "LRD",
  "hasUserId": true,
  "hasApiKey": true,
  "hasSubscriptionKey": true,
  "supabaseConnected": true
}
```

#### GET /api/momo/test-credentials
Test MoMo API credentials.

**Response:**
```json
{
  "success": true,
  "message": "Full auth flow successful",
  "tokenReceived": true,
  "balanceCheckPassed": true,
  "environment": "mtnliberia",
  "supportedCurrency": "LRD"
}
```

## Services

### momoService.js
Contains all MoMo API interaction functions:
- `getAccessToken()` - Authenticate and get access token
- `testAccountBalance(accessToken)` - Test credentials
- `getUserInfo(msisdn, accessToken)` - Get user details
- `fetchTransactionDetails(referenceId, accessToken)` - Get transaction status
- `requestToPay(details, accessToken)` - Initiate payment
- `getAccountBalance(accessToken)` - Get account balance

## Utilities

### phoneFormatter.js
- `formatLiberianPhone(phone)` - Formats phone numbers to Liberian MSISDN format (231XXXXXXXXX)

### transactionStore.js
- In-memory Map for caching pending transactions

## Configuration

### momo.config.js
Contains MoMo API configuration:
- `MOMO_BASE_URL` - API base URL
- `MOMO_SUBSCRIPTION_KEY` - Subscription key
- `MOMO_API_USER_ID` - API user ID
- `MOMO_API_KEY` - API key
- `MOMO_ENVIRONMENT` - Environment (sandbox/mtnliberia)
- `CALLBACK_URL` - Callback URL for payment notifications

### database.js
- Initializes and exports Supabase client
- Gracefully handles missing credentials

## Benefits of New Structure

1. **Separation of Concerns** - Each file has a single responsibility
2. **Maintainability** - Easier to find and update specific functionality
3. **Testability** - Services and utilities can be tested independently
4. **Scalability** - Easy to add new routes and services
5. **Clarity** - Clear organization makes the codebase easier to navigate
6. **Reusability** - Services and utilities can be reused across different routes
