import express from 'express';
import session from 'express-session';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false
  })
);

// Health check
app.get('/', (req, res) => {
  res.send('Discord OAuth2 Backend Running');
});

// OAuth login route
app.get('/auth/discord', (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = encodeURIComponent(process.env.DISCORD_REDIRECT_URI);
  const scope = encodeURIComponent('identify email guilds.join');
  
  const discordUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;
  res.redirect(discordUrl);
});

// OAuth callback route
app.get('/auth/discord/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('No code provided');

  try {
    // Exchange code for access token
    const data = new URLSearchParams();
    data.append('client_id', process.env.DISCORD_CLIENT_ID);
    data.append('client_secret', process.env.DISCORD_CLIENT_SECRET);
    data.append('grant_type', 'authorization_code');
    data.append('code', code);
    data.append('redirect_uri', process.env.DISCORD_REDIRECT_URI);
    data.append('scope', 'identify email guilds.join');

    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      body: data,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const tokenJson = await tokenResponse.json();
    if (!tokenJson.access_token) return res.status(500).send('Failed to get access token');

    const accessToken = tokenJson.access_token;

    // Fetch user info
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const user = await userResponse.json();

    // Add user to guild with role
    const guildId = process.env.GUILD_ID;
    const roleId = process.env.ROLE_ID;

    await fetch(`https://discord.com/api/guilds/${guildId}/members/${user.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        access_token: accessToken,
        roles: [roleId]
      })
    });

    // Store user in session
    req.session.user = user;

    // Redirect to frontend with encoded user info
    const encodedUser = Buffer.from(JSON.stringify(user)).toString('base64');
    const redirectTo = process.env.FRONTEND_URL || '/';
    const separator = redirectTo.includes('?') ? '&' : '?';
res.redirect(`${redirectTo}${separator}token=${encodedUser}`);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error logging in with Discord');
  }
});

// Start server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
