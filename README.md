# silvered-bot

A discord bot using [discord.js](https://discord.js.org) with Carl-bot style role management :)

the magic command is ```npm start``` (or ```node index.js```)! you need your own token in `.env` though, because my token is for me :innocent: :innocent:

![discordjs-picture](https://repository-images.githubusercontent.com/40484398/e305e980-cb80-11eb-9bb9-c5d3ec013658)

Setting it up for the first time? Follow **[CHECKLIST.md](CHECKLIST.md)**, which goes step by step from hosting to testing every embed and role menu.

## Commands

| Command | What it does | Who can use it |
|---|---|---|
| `/rolemenu create` | Posts a button menu people click to get/remove roles (games, pings, colors…). Up to 10 roles at once, `pick_one` makes it one-role-only | Manage Roles |
| `/rolemenu add` / `remove` | Add or remove a role on an existing menu (run it in the menu's channel) | Manage Roles |
| `/reactionrole create` | Posts a reaction-role menu embed (title, description, colour, category, `pick_one`) | Manage Roles |
| `/reactionrole add` / `remove` | Add or remove an emoji → role on a menu. `add` works on **any** message, not just ones the bot made | Manage Roles |
| `/reactionrole edit` / `list` / `delete` | Change a menu's category or pick-one setting, list menus by category, or stop a message being a menu | Manage Roles |
| `/embed send` / `edit` | Write or edit an embed in a pop-up form (title, description, colour, image, footer) | Manage Messages |
| `/setup-roles` | Creates **Mod > Semi-Mod > Perms > Non-User** with sensible permissions, stacked in that order. Safe to re-run | Admin |
| `/role add` / `remove` / `info` | Give/take a role from someone | Manage Roles |
| `/autorole set` / `off` / `show` | Give every new member a role on join | Manage Roles |
| `/help`, `/ping`, `/user`, `/avatar`, `/server`, `/botstats`, `/url-lookup`, `/echo`, `/pokeguess` | the originals | everyone |

Nobody can hand out a role at or above their own highest role, and the bot's role must sit **above** every role it manages (Server Settings → Roles → drag it up).

### Example: games, events and interests menus

```
/reactionrole create title:Pick your games category:Games
/reactionrole add message:<link from the reply> emoji:⛏️ role:@Minecraft
/reactionrole add message:<same link> emoji:🔫 role:@Valorant

/reactionrole create title:Event pings category:Events description:Get pinged for the events you care about
/reactionrole add message:<link> emoji:🎬 role:@Movie Night

/reactionrole create title:Pronouns category:Interests pick_one:true
```

Menus made with `/reactionrole create` keep their role list in the embed up to date as you add and remove roles. `/reactionrole list category:Games` shows them grouped. Everything you make in Discord also shows up (and can be edited) in the dashboard, and the other way round.

### Staff roles made by `/setup-roles`

- **Mod** – kick, ban, timeout, manage messages/channels/roles/nicknames/threads, audit log, voice mute/deafen/move
- **Semi-Mod** – timeout, delete messages, manage nicknames/threads, voice mute/move
- **Perms** – trusted members: embed links, files, external emojis/stickers, create threads
- **Non-User** – no extra permissions (for bots, alts, or restricted accounts). To actually lock it out of a channel, deny "View Channel" for it in that channel's settings.

## Web dashboard

A Carl-bot style dashboard for your server:

- **Send message**: build an embed with a live preview and post it to any channel. Paste a message link to **load and edit** something already posted.
- **Role menus**: turn a message into a reaction-role menu (react with an emoji to get a role) or a button menu, with an optional "pick one" mode and a **category** (Games, Events, Interests…). Menus are listed by category and each one has an **Edit** button.
- **Roles**: create, edit (name, colour, permissions) and delete roles
- **Members**: search people and give or take roles
- **Settings**: autorole

It has three modes, set with `DASHBOARD` in `.env`:

| `DASHBOARD=` | Where it is | Who can reach it |
|---|---|---|
| `local` (default) | `http://localhost:3001/#key=...` (printed in the console) | only the computer running the bot |
| `public` | `http://<server-address>:<port>/dashboard/` | anyone who knows the address **and** your `DASHBOARD_KEY` |
| `off` | nowhere | nobody |

Every request needs the key, and an IP that gets the key wrong 10 times is locked out for 15 minutes.

> ⚠️ **Public mode is plain `http://`**, so the key isn't encrypted on the way. Use a long random key that you don't use anywhere else (for example the output of `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`), and change it if you think it leaked.

## Setup

1. In the [Discord Developer Portal](https://discord.com/developers/applications) → your app → **Bot**: turn on **Server Members Intent** and **Message Content Intent**. (Reactions don't need a toggle.)
2. Invite the bot with the `bot` and `applications.commands` scopes and the **Manage Roles** permission (Administrator is easiest).
3. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN` and `CLIENT_ID`. Put your server's ID in `GUILD_ID` for instant command updates.
4. `npm install` then `npm start`. Slash commands register automatically on startup.

The old `config.json` still works for running locally.

## Hosting on Wispbyte

1. Create a free **Node.js** server at https://wispbyte.com/client.
2. Upload the project files with the panel's **File Manager** (everything except `node_modules`, `.env` and `data/`), or set the Git repo address in **Startup** if your server type offers it.
3. Set these in **Startup** variables, or upload a `.env` file:
   - `DISCORD_TOKEN`, `CLIENT_ID` (and `GUILD_ID` if you want instant command updates)
   - `DASHBOARD=public`
   - `DASHBOARD_KEY=<long random key>` (see the warning above)
   - `DASHBOARD_URL=http://<address>:<port>/dashboard/` (optional, so `/dashboard` can post the link. Fill it in after step 5)
4. Make sure the startup file is `index.js`, then press **Start**. You should see `Ready! Logged in as ...` in the console.
5. Your server's address and port are on the panel's **Network** tab (e.g. `123.45.67.89:25565`). Open `http://123.45.67.89:25565/dashboard/` and log in with your `DASHBOARD_KEY`. The status page is at `/health`.

Role menus and settings are saved in `data/settings.json` on the server. They survive restarts, but **reinstalling the server wipes them**, so download a copy of that file from the File Manager now and then.

### Keep-alive pings (GitHub Actions)

`.github/workflows/keep-alive.yml` pings the bot's `/health` page twice a day (08:00 and 20:00 UTC), like a cron job. Change the `cron:` line to pick other times:

1. Push the repo to GitHub.
2. In the repo go to **Settings → Secrets and variables → Actions → New repository secret**. Name it `BOT_URL` and set it to your address, e.g. `http://123.45.67.89:25565` (no `/dashboard`). It's a secret so your server's address isn't public.
3. Go to the **Actions** tab, pick **Keep alive** and press **Run workflow** to check it works.

Things to know:

- If the bot is down, the run fails and GitHub emails you, so it doubles as a free uptime alert.
- GitHub sometimes runs scheduled jobs late when it's busy, and it **turns off scheduled workflows after 60 days with no commits**. If that happens, re-enable it from the Actions tab.
- Wispbyte runs the bot as an always-on process, so it doesn't fall asleep the way Replit or Glitch did. If the bot crashes, Wispbyte's own restart is what brings it back. The ping just tells you about it.
