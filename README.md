# silvered-bot

A Discord bot for role management, custom embeds and server administration, with a built-in web dashboard.

Made by [oliver pearce](https://github.com/oliverpearce).

# Getting started

Requires Node.js 18 or newer and a [Discord application](https://discord.com/developers/applications) with the **Server Members** and **Message Content** intents enabled.

```
npm install
cp .env.example .env
npm start
```

Add your `DISCORD_TOKEN` and `CLIENT_ID` to `.env` before starting. Slash commands register automatically.

See the [guide](docs/GUIDE.md) for commands, the dashboard and hosting.

# Project structure

```
silvered-bot/
├─ index.js                 entry point
├─ src/
│  ├─ index.js              Discord client and event handlers
│  ├─ config.js             environment settings
│  ├─ web.js                HTTPS and status page
│  ├─ commands/
│  │  ├─ fun/               echo, pokeguess
│  │  ├─ roles/             autorole, reactionrole, role, rolemenu, roles-import, setup-roles
│  │  └─ utility/           aboutme, avatar, botstats, dashboard, embed, event, help, ping,
│  │                         server, url-lookup, user, whois
│  ├─ dashboard/
│  │  ├─ auth.js            Discord login
│  │  ├─ server.js          dashboard API
│  │  └─ public/            dashboard web app
│  └─ lib/                  embeds, events, message links, mod log, role menus, role utils,
│                           scheduler, storage, welcome, who's who
├─ scripts/
│  └─ deploy-commands.js    manual slash command registration
├─ docs/
│  └─ GUIDE.md
└─ .github/workflows/
   └─ keep-alive.yml        scheduled uptime check
```
