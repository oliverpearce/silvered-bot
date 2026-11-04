# silvered-bot

A discord bot using [discord.js](https://discord.js.org) with Carl-bot style role management :)

the magic command is ```npm start``` (or ```node index.js```)! you need your own token in `.env` though, because my token is for me :innocent: :innocent:

![discordjs-picture](https://repository-images.githubusercontent.com/40484398/e305e980-cb80-11eb-9bb9-c5d3ec013658)

## Commands

| Command | What it does | Who can use it |
|---|---|---|
| `/rolemenu create` | Posts a button menu people click to get/remove roles (games, pings, colors…). Up to 10 roles at once, `pick_one` makes it one-role-only | Manage Roles |
| `/rolemenu add` / `remove` | Add or remove a role on an existing menu (run it in the menu's channel) | Manage Roles |
| `/setup-roles` | Creates **Mod > Semi-Mod > Perms > Non-User** with sensible permissions, stacked in that order. Safe to re-run | Admin |
| `/role add` / `remove` / `info` | Give/take a role from someone | Manage Roles |
| `/autorole set` / `off` / `show` | Give every new member a role on join | Manage Roles |
| `/help`, `/ping`, `/user`, `/avatar`, `/server`, `/botstats`, `/url-lookup`, `/echo`, `/pokeguess` | the originals | everyone |

Nobody can hand out a role at or above their own highest role, and the bot's role must sit **above** every role it manages (Server Settings → Roles → drag it up).

### Staff roles made by `/setup-roles`

- **Mod** – kick, ban, timeout, manage messages/channels/roles/nicknames/threads, audit log, voice mute/deafen/move
- **Semi-Mod** – timeout, delete messages, manage nicknames/threads, voice mute/move
- **Perms** – trusted members: embed links, files, external emojis/stickers, create threads
- **Non-User** – no extra permissions (for bots, alts, or restricted accounts). To actually lock it out of a channel, deny "View Channel" for it in that channel's settings.

## Web dashboard (localhost)

When the bot starts it also starts a private dashboard and prints its link in the console:

```
Dashboard: http://localhost:3001/#key=...
```

Open that link on the same computer. From there you can:

- **Send message**: build an embed with a live preview and post it to any channel
- **Role menus**: turn a message into a reaction-role menu (react with an emoji to get a role) or a button menu, with an optional "pick one" mode
- **Roles**: create, edit (name, colour, permissions) and delete roles
- **Members**: search people and give or take roles
- **Settings**: autorole

It only listens on `127.0.0.1`, so nobody else can reach it, and every request needs the access key. Set `DASHBOARD_KEY` in `.env` to keep the same key between restarts, `DASHBOARD_PORT` to change the port, or `DASHBOARD=off` to turn it off.

## Setup

1. In the [Discord Developer Portal](https://discord.com/developers/applications) → your app → **Bot**: turn on **Server Members Intent** and **Message Content Intent**. (Reactions don't need a toggle.)
2. Invite the bot with the `bot` and `applications.commands` scopes and the **Manage Roles** permission (Administrator is easiest).
3. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN` and `CLIENT_ID`. Put your server's ID in `GUILD_ID` for instant command updates.
4. `npm install` then `npm start`. Slash commands register automatically on startup.

The old `config.json` still works for running locally.

## Hosting on Wispbyte

1. Create a free **Node.js** server at https://wispbyte.com/client.
2. Upload the project files with the panel's **File Manager** (everything except `node_modules`), or set the Git repo address in **Startup** if your server type offers it.
3. Upload your `.env` file too (or fill `DISCORD_TOKEN` / `CLIENT_ID` in **Startup** variables if shown).
4. Add `DASHBOARD=off` to the `.env` there (you can't open localhost on a remote server, so it's not needed). Make sure the startup file is `index.js`, then press **Start**. You should see `Ready! Logged in as ...` in the console.

Wispbyte runs the bot as an always-on process, so it doesn't fall asleep without web traffic the way Replit/Glitch did. The bot still serves a small status page on the server's port (`SERVER_PORT`/`PORT`); if you want outside monitoring, point UptimeRobot or [cron-job.org](https://cron-job.org) at `http://<server-ip>:<port>` from the panel to get alerted if it goes down.
