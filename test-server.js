const express = require("express");
const { router, setTransactionStore } = require("./MoMoCallbackHandler");

const app = express();
const PORT = 8080;

// Middleware
app.use(express.json());

// Set up transaction store (in-memory for testing)
const transactionStore = new Map();
setTransactionStore(transactionStore);

// Mount the MoMo callback router
app.use("/api/momo", router);

// Basic health check
app.get("/", (req, res) => {
  res.json({ message: "Test server running", endpoints: ["/api/momo/callback", "/api/momo/callback/test"] });
});

app.listen(PORT, () => {
  console.log(`Test server running on http://localhost:${PORT}`);
  console.log("Test endpoints:");
  console.log(`- POST http://localhost:${PORT}/api/momo/callback/test`);
  console.log(`- POST http://localhost:${PORT}/api/momo/callback`);
});