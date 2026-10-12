require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database(process.env.DB_PATH || "notes-factory.db");
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    razorpay_order_id TEXT UNIQUE,
    razorpay_payment_id TEXT UNIQUE,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    pincode TEXT NOT NULL,
    product_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'created',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS webhook_events (
    event_id TEXT PRIMARY KEY,
    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const products = [
  {
    id: "casio-fx-991es-plus",
    name: "Casio Scientific Calculator",
    model: "fx-991ES PLUS (confirm exact model before publishing)",
    pricePaise: 152500,
    description: "Scientific calculator for engineering and mathematics students. Confirm model, stock, warranty and included accessories before dispatch.",
    image: "https://placehold.co/700x500/f3f4f6/111827?text=Casio+Scientific+Calculator",
    stock: 5
  }
];

const razorpayConfigured = Boolean(
  process.env.RAZORPAY_KEY_ID &&
  process.env.RAZORPAY_KEY_SECRET &&
  !process.env.RAZORPAY_KEY_ID.includes("replace")
);
const razorpay = razorpayConfigured
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 180, standardHeaders: "draft-7", legacyHeaders: false }));

// Razorpay webhooks require the original raw request body for signature validation.
app.post("/api/webhooks/razorpay", express.raw({ type: "application/json" }), (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.get("x-razorpay-signature");
  if (!secret || !signature || !Buffer.isBuffer(req.body)) return res.status(400).send("Webhook not configured");
  const expected = crypto.createHmac("sha256", secret).update(req.body).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(400).send("Invalid signature");

  const event = JSON.parse(req.body.toString("utf8"));
  const eventId = req.get("x-razorpay-event-id") || crypto.createHash("sha256").update(req.body).digest("hex");
  const alreadySeen = db.prepare("SELECT event_id FROM webhook_events WHERE event_id = ?").get(eventId);
  if (alreadySeen) return res.status(200).json({ received: true, duplicate: true });

  const insertEvent = db.prepare("INSERT INTO webhook_events(event_id) VALUES (?)");
  const updatePaid = db.prepare(`
    UPDATE orders SET status = 'paid', razorpay_payment_id = ?
    WHERE razorpay_order_id = ? AND status != 'paid'
  `);
  const tx = db.transaction(() => {
    insertEvent.run(eventId);
    if (event.event === "payment.captured") {
      const payment = event.payload && event.payload.payment && event.payload.payment.entity;
      if (payment && payment.order_id && payment.id) updatePaid.run(payment.id, payment.order_id);
    }
  });
  try { tx(); } catch (e) { return res.status(500).send("Webhook processing failed"); }
  res.status(200).json({ received: true });
});

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/config", (_req, res) => {
  res.json({
    storeName: process.env.STORE_NAME || "Notes Factory",
    currency: process.env.CURRENCY || "INR",
    paymentsEnabled: process.env.PAYMENTS_ENABLED === "true" && Boolean(razorpay),
    razorpayKeyId: razorpay ? process.env.RAZORPAY_KEY_ID : null
  });
});
app.get("/api/products", (_req, res) => {
  res.json(products.map(({ stock, ...p }) => ({ ...p, inStock: stock > 0 })));
});

const checkoutLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 12, standardHeaders: "draft-7", legacyHeaders: false });
app.post("/api/checkout", checkoutLimiter, async (req, res) => {
  if (process.env.PAYMENTS_ENABLED !== "true" || !razorpay) {
    return res.status(503).json({ error: "Online payments are not enabled yet. Please try again later." });
  }
  const { productId, quantity, customer } = req.body || {};
  const product = products.find(p => p.id === productId);
  const qty = Number(quantity);
  if (!product || !Number.isInteger(qty) || qty < 1 || qty > 3 || product.stock < qty) {
    return res.status(400).json({ error: "Invalid product or quantity." });
  }
  const c = customer || {};
  const fields = ["name", "email", "phone", "address", "pincode"];
  for (const f of fields) {
    if (typeof c[f] !== "string" || !c[f].trim()) return res.status(400).json({ error: `Please provide ${f}.` });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email) || !/^[6-9]\d{9}$/.test(c.phone.replace(/\D/g, "")) || !/^\d{6}$/.test(c.pincode.trim())) {
    return res.status(400).json({ error: "Check your email, 10-digit Indian mobile number and 6-digit PIN code." });
  }
  const amount = product.pricePaise * qty;
  const localId = crypto.randomUUID();
  try {
    const order = await razorpay.orders.create({
      amount, currency: "INR", receipt: localId,
      notes: { productId: product.id, quantity: String(qty), localOrderId: localId }
    });
    db.prepare(`INSERT INTO orders
      (id, razorpay_order_id, amount, currency, customer_name, email, phone, address, pincode, product_id, status)
      VALUES (?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, 'created')`).run(
      localId, order.id, amount, c.name.trim().slice(0,120), c.email.trim().slice(0,200),
      c.phone.replace(/\D/g,""), c.address.trim().slice(0,500), c.pincode.trim(), product.id
    );
    res.json({ localOrderId: localId, razorpayOrderId: order.id, amount, currency: "INR", keyId: process.env.RAZORPAY_KEY_ID, productName: product.name });
  } catch (e) {
    console.error("Checkout order creation failed:", e.message);
    res.status(502).json({ error: "Could not start payment. Please try again." });
  }
});

app.post("/api/verify-payment", checkoutLimiter, (req, res) => {
  if (!razorpay) return res.status(503).json({ error: "Payment gateway is not configured." });
  const { localOrderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if (![localOrderId, razorpay_order_id, razorpay_payment_id, razorpay_signature].every(v => typeof v === "string" && v.length < 300)) {
    return res.status(400).json({ error: "Missing payment verification details." });
  }
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND razorpay_order_id = ?").get(localOrderId, razorpay_order_id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex");
  const sigA = Buffer.from(razorpay_signature);
  const sigB = Buffer.from(expected);
  if (sigA.length !== sigB.length || !crypto.timingSafeEqual(sigA, sigB)) {
    return res.status(400).json({ error: "Payment signature could not be verified." });
  }
  // Fetch the payment from Razorpay and verify its status, amount and linked order.
  razorpay.payments.fetch(razorpay_payment_id).then(payment => {
    if (payment.order_id !== order.razorpay_order_id || payment.amount !== order.amount ||
        payment.currency !== order.currency || !["captured"].includes(payment.status)) {
      return res.status(400).json({ error: "Payment is not captured or order details do not match." });
    }
    db.prepare(`UPDATE orders SET status='paid', razorpay_payment_id=? WHERE id=?`)
      .run(razorpay_payment_id, localOrderId);
    return res.json({ success: true, orderId: localOrderId, status: "paid" });
  }).catch(err => {
    console.error("Payment fetch failed:", err.message);
    return res.status(502).json({ error: "Could not confirm payment yet. Do not pay again; refresh or contact store support." });
  });
});

// Minimal protected order-status endpoint for customer receipt page.
app.get("/api/orders/:id/status", (req, res) => {
  const order = db.prepare("SELECT id, status, amount, currency, created_at FROM orders WHERE id = ?").get(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  res.json({ orderId: order.id, status: order.status, amount: order.amount, currency: order.currency, createdAt: order.created_at });
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.listen(PORT, () => console.log(`Notes Factory running on http://localhost:${PORT}`));
