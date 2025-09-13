import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import bodyParser from "body-parser";

dotenv.config();

const app = express();
app.use(bodyParser.json());
const PORT = process.env.PORT || 3000;

// Discord OAuth2 callback
app.get("/auth/discord/callback", async (req, res) => {
  const code = req.query.code;

  if (!code) return res.status(400).send("No code provided");

  try {
    // Exchange code for access token
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code: code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
        scope: "identify email"
      })
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) return res.status(400).json(tokenData);

    // Get user info
    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });

    const userData = await userResponse.json();

    // Send info to Discord webhook
    await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: null,
        embeds: [
          {
            title: "New Subscriber!",
            color: 0x00ff00,
            fields: [
              { name: "Username", value: `${userData.username}#${userData.discriminator}` },
              { name: "ID", value: userData.id },
              { name: "Email", value: userData.email || "Not Provided" },
              { name: "Avatar", value: `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png` }
            ],
            timestamp: new Date()
          }
        ]
      })
    });

    // Optional: Send info to HubSpot
    if (process.env.HUBSPOT_API_KEY) {
      await fetch(`https://api.hubapi.com/crm/v3/objects/contacts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.HUBSPOT_API_KEY}`
        },
        body: JSON.stringify({
          properties: {
            email: userData.email,
            firstname: userData.username,
            discord_id: userData.id
          }
        })
      });
    }

    res.send("Login successful! You can close this page.");
  } catch (err) {
    console.error(err);
    res.status(500).send("Something went wrong");
  }
});

// Start server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
