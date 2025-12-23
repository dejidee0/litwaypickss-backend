# Deployment Guide - MTN MoMo Payment Processor on Render

This guide explains how to deploy the LitWay Picks MoMo Payment Processor on [Render](https://render.com).

## Prerequisites

1. A [Render](https://render.com) account
2. MTN MoMo API credentials (from MTN or your account manager)
3. (Optional) A [Supabase](https://supabase.com) account for database storage

---

## Step 1: Prepare Your Repository

Ensure your repository has these files:

```
├── MoMoPaymentProcessor.js    # Main server
├── MoMoCallbackHandler.js     # Callback handler
├── package.json               # Dependencies
├── .env.sample                # Environment template
└── DEPLOYMENT.md              # This file
```

Push your code to GitHub, GitLab, or another Git provider.

---

## Step 2: Create a Web Service on Render

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **"New +"** → **"Web Service"**
3. Connect your Git repository
4. Configure the service:

| Setting | Value |
|---------|-------|
| **Name** | `litway-momo-api` (or your preferred name) |
| **Region** | Choose closest to Liberia (e.g., Frankfurt or Ireland) |
| **Branch** | `main` (or your default branch) |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | Free (for testing) or Starter ($7/month for production) |

---

## Step 3: Configure Environment Variables

In Render, go to your service → **"Environment"** tab → **"Add Environment Variable"**

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `MOMO_API_USER_ID` | Your MTN API User ID (UUID) | `a1b2c3d4-e5f6-7890-abcd-ef1234567890` |
| `MOMO_API_KEY` | Your MTN API Key | `your-api-key-here` |
| `MOMO_SUBSCRIPTION_KEY` | Collection Product Subscription Key | `your-subscription-key` |
| `MOMO_ENVIRONMENT` | Target environment | `mtnliberia` |
| `CALLBACK_URL` | Your Render URL + callback path | `https://litway-momo-api.onrender.com/api/momo/callback` |

### Optional Variables (for database)

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key |

### Optional Variables (for email notifications)

| Variable | Description |
|----------|-------------|
| `RESEND_API_KEY` | Resend API key (for emails) |

---

## Step 4: Deploy

1. Click **"Create Web Service"**
2. Render will automatically:
   - Clone your repository
   - Run `npm install`
   - Start the server with `npm start`
3. Wait for deployment to complete (usually 1-3 minutes)

---

## Step 5: Verify Deployment

Once deployed, test your endpoints:

### Health Check
```bash
curl https://litway-momo-api.onrender.com/
```

Expected response:
```json
{
  "status": "running",
  "message": "MTN MoMo Payment Server is operational",
  "timestamp": "2025-12-22T17:00:00.000Z",
  "database": "connected"
}
```

### Config Check
```bash
curl https://litway-momo-api.onrender.com/api/momo/config
```

Expected response (all should be `true`):
```json
{
  "configured": true,
  "environment": "mtnliberia",
  "baseUrl": "https://proxy.momoapi.mtn.com",
  "callbackUrl": "https://litway-momo-api.onrender.com/api/momo/callback",
  "supportedCurrency": "LRD",
  "hasUserId": true,
  "hasApiKey": true,
  "hasSubscriptionKey": true,
  "supabaseConnected": true
}
```

### Test Credentials
```bash
curl https://litway-momo-api.onrender.com/api/momo/test-credentials
```

---

## Step 6: Update MTN Callback URL

**Important:** Update your MTN MoMo API callback URL to point to your Render deployment:

```
https://litway-momo-api.onrender.com/api/momo/callback
```

This URL should be set in your `CALLBACK_URL` environment variable and configured with MTN.

---

## API Endpoints Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Health check |
| GET | `/api/momo/config` | Configuration status |
| POST | `/api/momo/pay` | Initiate payment |
| GET | `/api/momo/status/:referenceId` | Check payment status |
| GET | `/api/momo/balance` | Get account balance |
| GET | `/api/momo/user/:msisdn` | Get user info by phone |
| GET | `/api/momo/transactions` | List all transactions |
| GET | `/api/momo/order/:referenceId` | Get order by reference ID |
| POST | `/api/momo/callback` | MTN MoMo webhook receiver |
| GET | `/api/momo/callback-logs` | List received callbacks |
| GET | `/api/momo/test-credentials` | Test MoMo API credentials |

---

## Troubleshooting

### Server Won't Start

Check Render logs for errors:
- **Missing dependencies**: Run `npm install` locally to verify package.json
- **Port issues**: Render automatically sets the `PORT` environment variable

### MoMo API Errors

1. **401 Unauthorized**: Check API credentials
2. **400 Bad Request**: Verify phone number format (12 digits: 231XXXXXXXXX)
3. **409 Conflict**: Duplicate transaction reference

### Callback Not Received

1. Verify `CALLBACK_URL` is correct
2. Check Render logs for incoming requests
3. Ensure MTN has the correct callback URL configured

---

## Production Recommendations

1. **Use Starter Plan or higher** ($7/month) for production to avoid cold starts
2. **Enable Auto-Deploy** for automatic deployments on git push
3. **Add Health Check Path**: Set to `/` in Render settings
4. **Set up alerts** for downtime notifications
5. **Use Supabase** for persistent storage (in-memory data is lost on restart)

---

## Environment Variables Template

Copy this to quickly set up all required variables:

```env
# MTN MoMo API
MOMO_API_USER_ID=your-api-user-uuid
MOMO_API_KEY=your-api-key
MOMO_SUBSCRIPTION_KEY=your-subscription-key
MOMO_ENVIRONMENT=mtnliberia
CALLBACK_URL=https://your-app.onrender.com/api/momo/callback

# Supabase (Optional)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Server
PORT=5000
NODE_ENV=production
```

---

## Support

For issues with:
- **This deployment**: Check Render logs and this guide
- **MTN MoMo API**: Contact MTN support or your account manager
- **Supabase**: Visit [Supabase Docs](https://supabase.com/docs)
