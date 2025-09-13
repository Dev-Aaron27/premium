import express from 'express';
import session from 'express-session';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Session middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/', (req, res) => {
  res.send('Discord OAuth2 Backend Running');
});

// Discord OAuth2 login
app.get('/auth/discord', (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = encodeURIComponent(process.env.DISCORD_REDIRECT_URI);
  const scope = encodeURIComponent('identify email guilds.join');

  const discordUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;
  res.redirect(discordUrl);
});

// OAuth2 callback
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
    const accessToken = tokenJson.access_token;

    // Fetch user info
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const user = await userResponse.json();

    // Add user to your server with role
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

    // Redirect to frontend with safe user info
    const encodedUser = Buffer.from(JSON.stringify(user)).toString('base64');
    res.redirect(`${process.env.FRONTEND_URL || '/'}?token=${encodedUser}`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send('Error logging in with Discord');
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
