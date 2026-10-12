const state = { product: null, quantity: 0, config: null };
const rupees = paise => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
const $ = id => document.getElementById(id);
function setStatus(message, type = "") { const el = $("status-message"); el.textContent = message; el.className = `status-message ${type}`; }
function updateCart() {
  $("cart-count").textContent = state.quantity;
  const total = state.product ? state.product.pricePaise * state.quantity : 0;
  $("checkout-total").textContent = rupees(total);
  $("summary-subtotal").textContent = rupees(total);
  $("pay-button").disabled = state.quantity < 1 || !state.config?.paymentsEnabled;
  $("pay-button").style.opacity = $("pay-button").disabled ? ".55" : "1";
  if (!state.config?.paymentsEnabled) {
    $("pay-button").innerHTML = "Online checkout not yet enabled";
  } else {
    $("pay-button").innerHTML = "Continue to payment <span>→</span>";
  }
}
function renderProduct(product) {
  state.product = product;
  $("products-grid").innerHTML = `
    <article class="product-card">
      <div class="product-image"><img src="${product.image}" alt="${product.name}" loading="lazy"></div>
      <div class="product-info">
        <span class="product-kicker">ENGINEERING ESSENTIAL</span>
        <h3>${product.name}</h3>
        <p>${product.description}</p>
        <div class="product-meta"><span class="price">${rupees(product.pricePaise)}</span><button class="add-btn" id="add-to-cart" ${product.inStock ? "" : "disabled"}>${product.inStock ? "Add to cart +" : "Out of stock"}</button></div>
      </div>
    </article>`;
  $("add-to-cart").addEventListener("click", () => {
    state.quantity = Math.min(3, state.quantity + 1);
    updateCart();
    setStatus("Added to cart. Shipping charges must be confirmed before payment is enabled.");
    $("checkout").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  updateCart();
}
async function init() {
  $("year").textContent = new Date().getFullYear();
  try {
    const [configRes, productsRes] = await Promise.all([fetch("/api/config"), fetch("/api/products")]);
    state.config = await configRes.json();
    const products = await productsRes.json();
    if (!products.length) throw new Error("No products are listed yet.");
    renderProduct(products[0]);
    if (!state.config.paymentsEnabled) setStatus("Store preview is ready. The owner must configure the payment gateway, shipping price and policies before accepting real orders.");
  } catch (e) {
    $("products-grid").textContent = "Products could not be loaded. Please refresh the page.";
    setStatus(e.message, "error");
  }
}
$("checkout-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!state.config?.paymentsEnabled) return setStatus("Online payments are not enabled yet. The store owner must finish gateway setup first.", "error");
  if (!state.product || state.quantity < 1) return setStatus("Add a product to your cart first.", "error");
  if (!window.Razorpay) return setStatus("Secure checkout could not load. Check your connection and try again.", "error");
  const button = $("pay-button");
  button.disabled = true;
  setStatus("Preparing secure checkout…");
  const form = new FormData(event.currentTarget);
  const customer = Object.fromEntries(["name","email","phone","address","pincode"].map(k => [k, String(form.get(k) || "").trim()]));
  try {
    const response = await fetch("/api/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: state.product.id, quantity: state.quantity, customer })
    });
    const order = await response.json();
    if (!response.ok) throw new Error(order.error || "Could not create order.");
    const checkout = new Razorpay({
      key: order.keyId, amount: order.amount, currency: order.currency,
      name: "Notes Factory", description: order.productName, order_id: order.razorpayOrderId,
      prefill: { name: customer.name, email: customer.email, contact: customer.phone },
      theme: { color: "#101827" },
      handler: async payment => {
        setStatus("Payment submitted. Verifying securely…");
        try {
          const verifyRes = await fetch("/api/verify-payment", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ localOrderId: order.localOrderId, razorpay_order_id: payment.razorpay_order_id, razorpay_payment_id: payment.razorpay_payment_id, razorpay_signature: payment.razorpay_signature })
          });
          const result = await verifyRes.json();
          if (!verifyRes.ok) throw new Error(result.error || "Payment verification is pending.");
          state.quantity = 0;
          updateCart();
          setStatus(`Payment confirmed. Your order ID is ${result.orderId}. Save this ID for your records. Shipping confirmation is still required.`, "success");
          event.currentTarget.reset();
        } catch (e) {
          setStatus(`${e.message} Do not pay again immediately. Your payment may still be reconciled by the store.`, "error");
        }
      },
      modal: { ondismiss: () => setStatus("Checkout closed. If you completed a payment, wait for confirmation before trying again.") }
    });
    checkout.on("payment.failed", response => setStatus(`Payment was not completed: ${response.error?.description || "please try again."}`, "error"));
    checkout.open();
  } catch (e) {
    setStatus(e.message, "error");
  } finally {
    button.disabled = false;
    updateCart();
  }
});
init();
