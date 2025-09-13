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
  if (!code) return res.status(400).json({ error: "No code provided" });

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
        scope: "identify email guilds.join"
      })
    });

    const tokenData = await tokenResponse.json();
    if (tokenData.error) return res.status(400).json(tokenData);

    // Get Discord user info
    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const userData = await userResponse.json();

    // Check HubSpot subscription status
    let subscribed = false;
    if (process.env.HUBSPOT_API_KEY && userData.email) {
      const hubResponse = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.HUBSPOT_API_KEY}`
        },
        body: JSON.stringify({
          filterGroups: [{
            filters: [{ propertyName: "email", operator: "EQ", value: userData.email }]
          }],
          properties: ["is_subscribed"]
        })
      });

      const hubData = await hubResponse.json();
      subscribed = hubData.results[0]?.properties?.is_subscribed === "true";
    }

    if (!subscribed) {
      return res.json({ subscribed: false, message: "Please subscribe to claim premium." });
    }

    // Add user to your server and assign role
    if (process.env.DISCORD_BOT_TOKEN) {
      await fetch(`https://discord.com/api/guilds/${process.env.GUILD_ID}/members/${userData.id}`, {
        method: "PUT",
        headers: {
          "Authorization": `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          access_token: tokenData.access_token,
          roles: [process.env.ROLE_ID]
        })
      });
    }

    // Send info to Discord webhook
    if (process.env.DISCORD_WEBHOOK_URL) {
      await fetch(process.env.DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: null,
          embeds: [
            {
              title: "New Premium Subscriber!",
              color: 0x00ff00,
              fields: [
                { name: "Username", value: `${userData.username}#${userData.discriminator}` },
                { name: "ID", value: userData.id },
                { name: "Email", value: userData.email || "Not Provided" },
                { name: "Avatar", value: userData.avatar ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png` : "N/A" }
              ],
              timestamp: new Date()
            }
          ]
        })
      });
    }

    // Return user data to frontend
    res.json({
      subscribed: true,
      username: userData.username,
      discriminator: userData.discriminator,
      id: userData.id,
      email: userData.email,
      avatar: userData.avatar ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png` : null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
