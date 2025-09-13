// backend/server.js
import express from "express";
import fetch from "node-fetch";
import bodyParser from "body-parser";
import session from "express-session";
import dotenv from "dotenv";
import qs from "querystring";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(session({
  secret: process.env.SESSION_SECRET || "supersecret",
  resave: false,
  saveUninitialized: true
}));

// Discord OAuth2 constants
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// PayPal constants
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const PAYPAL_API = process.env.PAYPAL_MODE === "live" 
  ? "https://api-m.paypal.com" 
  : "https://api-m.sandbox.paypal.com";

// --- ROUTES ---

// Discord OAuth redirect
app.get("/auth/discord", (req, res) => {
  const params = qs.stringify({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify email guilds.join"
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

// Discord OAuth callback
app.get("/auth/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("No code provided");

  try {
    // Exchange code for token
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: qs.stringify({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code: code,
        redirect_uri: DISCORD_REDIRECT_URI,
        scope: "identify email guilds.join"
      })
    });

    const tokenData = await tokenRes.json();
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });

    const discordUser = await userRes.json();

    req.session.user = discordUser;

    // Redirect back to frontend plans page
    res.redirect("/?logged_in=1");
  } catch (err) {
    console.error(err);
    res.status(500).send("Discord auth failed");
  }
});

// Create PayPal order
app.post("/api/create-order", async (req, res) => {
  const { planName, price } = req.body;

  try {
    const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString("base64");
    const tokenRes = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
      method: "POST",
      headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials"
    });
    const tokenData = await tokenRes.json();

    const orderRes = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{ amount: { currency_code: "USD", value: price.toString() }, description: planName }],
        application_context: {
          return_url: `${req.protocol}://${req.get("host")}/api/capture-order`,
          cancel_url: `${req.protocol}://${req.get("host")}/?cancelled=1`
        }
      })
    });

    const orderData = await orderRes.json();
    res.json(orderData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "PayPal order creation failed" });
  }
});

// Capture PayPal order
app.get("/api/capture-order", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send("No token provided");

  try {
    const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString("base64");
    const tokenRes = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
      method: "POST",
      headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials"
    });
    const tokenData = await tokenRes.json();

    const captureRes = await fetch(`${PAYPAL_API}/v2/checkout/orders/${token}/capture`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${tokenData.access_token}`, "Content-Type": "application/json" }
    });

    const captureData = await captureRes.json();

    // Send Discord notification
    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: "🎉 New Premium Subscription",
            color: 0x7289da,
            fields: [
              { name: "User", value: `${req.session.user.username}#${req.session.user.discriminator}`, inline: true },
              { name: "Discord ID", value: req.session.user.id, inline: true },
              { name: "Email", value: req.session.user.email, inline: true },
              { name: "Plan", value: captureData.purchase_units[0].description, inline: true },
              { name: "Price", value: `$${captureData.purchase_units[0].amount.value}`, inline: true },
              { name: "Date", value: new Date().toISOString(), inline: true }
            ],
            thumbnail: { url: `https://cdn.discordapp.com/avatars/${req.session.user.id}/${req.session.user.avatar}.png` },
            timestamp: new Date().toISOString()
          }
        ]
      })
    });

    res.redirect("/?success=1");
  } catch (err) {
    console.error(err);
    res.status(500).send("Payment capture failed");
  }
});

app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
