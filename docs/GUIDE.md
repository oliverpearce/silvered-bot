# Guide

## Commands

| Command | What it does | Who can use it |
|---|---|---|
| `/rolemenu create` | Posts a button menu for getting and removing roles. Supports up to 10 roles, and `pick_one` limits members to one | Manage Roles |
| `/rolemenu add` / `remove` | Adds or removes a role on an existing menu (run it in the menu's channel) | Manage Roles |
| `/reactionrole create` | Posts a reaction-role menu embed (title, description, colour, category, `pick_one`) | Manage Roles |
| `/reactionrole add` / `remove` | Adds or removes an emoji and role on a menu. `add` works on any message | Manage Roles |
| `/reactionrole edit` / `list` / `delete` | Changes a menu's settings, lists menus by category, or stops a message being a menu | Manage Roles |
| `/embed send` / `edit` | Writes or edits an embed in a pop-up form | Manage Messages |
| `/setup-roles` | Creates **Mod > Semi-Mod > Perms > Non-User** with suitable permissions. Safe to re-run | Admin |
| `/role add` / `remove` / `info` | Gives, removes or describes a role | Manage Roles |
| `/autorole set` / `off` / `show` | Gives every new member a role on join | Manage Roles |
| `/roles-import` | Creates roles from a pasted list and posts a button menu per category | Manage Roles |
| `/whois set` / `clear` / `lock` / `post` / `unpost` | Manages the self-updating who's who list | See `/help` |
| `/aboutme` | Writes your own line on the who's who list | Everyone |
| `/event create` / `list` / `cancel` / `timezone` | Posts an event and pings its role before it starts | See `/help` |
| `/dashboard` | Gets the link to the web dashboard | Manage Roles |
| `/help`, `/ping`, `/user`, `/avatar`, `/server`, `/botstats`, `/url-lookup`, `/echo`, `/pokeguess` | General commands | Everyone |

Nobody can hand out a role at or above their own highest role. The bot's role must sit above every role it manages (Server Settings → Roles).

### Editing a sent embed

1. Right-click the bot's message and choose **Copy Message Link**.
2. Run `/embed edit message:<link>`.
3. Change the fields in the pop-up form and submit.

The form covers the title, description, colour, image and footer. Thumbnails, authors and fields are kept, and can be changed in the dashboard by pasting the message link into **Send message**. The bot can only edit its own messages.

### Example role menus

```
/reactionrole create title:Pick your games category:Games
/reactionrole add message:<link from the reply> emoji:⛏️ role:@Minecraft
/reactionrole add message:<same link> emoji:🔫 role:@Valorant

/reactionrole create title:Event pings category:Events description:Get pinged for the events you care about
/reactionrole add message:<link> emoji:🎬 role:@Movie Night

/reactionrole create title:Pronouns category:Interests pick_one:true
```

Menus made with `/reactionrole create` keep their role list up to date. Changes made in Discord and in the dashboard stay in sync.

### Staff roles

- **Mod:** kick, ban, timeout, manage messages, channels, roles, nicknames and threads, audit log, voice mute, deafen and move
- **Semi-Mod:** timeout, delete messages, manage nicknames and threads, voice mute and move
- **Perms:** embed links, files, external emojis and stickers, create threads
- **Non-User:** no extra permissions. To lock it out of a channel, deny **View Channel** in that channel's settings.

## Dashboard

- **Send message:** build an embed with a live preview, post it, or paste a message link to edit one
- **Scheduled:** view messages and events waiting to be posted
- **Role menus:** create and edit reaction or button menus, grouped by category
- **Roles:** create, edit and delete roles
- **Members:** search members and manage their roles
- **Who's who:** manage the server's who's who list
- **Settings:** configure autorole and other server features

Set the mode with `DASHBOARD` in `.env`:

| `DASHBOARD=` | Address | Access |
|---|---|---|
| `local` (default) | `http://localhost:3001/#key=...` (printed in the console) | Only the computer running the bot |
| `public` | `https://<your-domain>/dashboard/` | People with Administrator in a server the bot is in, using Discord login |
| `off` | None | Nobody |

Public mode only asks Discord who you are. It shows the servers where you have **Administrator**, checks this on every request, and does not keep your Discord token. Sessions last 7 days and end when the bot restarts.

Local mode uses an access key instead. An IP that gets it wrong 10 times is locked out for 15 minutes.

## Setup

1. In the [Discord Developer Portal](https://discord.com/developers/applications), open your app's **Bot** page and enable **Server Members Intent** and **Message Content Intent**.
2. Invite the bot with the `bot` and `applications.commands` scopes and the **Manage Roles** permission.
3. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN` and `CLIENT_ID`. Add `GUILD_ID` for instant command updates in one server.
4. Run `npm install`, then `npm start`.

A `config.json` in the project root is still supported for local use.

## Hosting on Google Cloud

These steps use a Compute Engine VM, which keeps the bot connected to Discord and keeps `data/` on disk.

1. Create a Debian VM in [Compute Engine](https://console.cloud.google.com/compute/instances). An `e2-micro` is enough. Add the network tag `silvered-bot`.
2. Reserve the VM's external IP as static, point an `A` record such as `bot.example.com` at it, and allow web traffic:

   ```
   gcloud compute firewall-rules create silvered-bot-web --allow tcp:80,tcp:443 --target-tags silvered-bot
   ```

3. Connect with **SSH** and install the project:

   ```
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs git
   git clone https://github.com/oliverpearce/silvered-bot.git
   cd silvered-bot
   npm ci --omit=dev
   cp .env.example .env
   chmod 600 .env
   nano .env
   ```

4. In the [Discord Developer Portal](https://discord.com/developers/applications), open **OAuth2**, copy the **Client Secret**, and add this redirect:

   ```
   https://bot.example.com/dashboard/auth/callback
   ```

   In `.env`, set `DISCORD_TOKEN`, `CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DASHBOARD=public` and `DASHBOARD_URL=https://bot.example.com`. `GUILD_ID` is optional.
5. Run the bot as a service so it starts on boot and restarts after a crash:

   ```
   sudo tee /etc/systemd/system/silvered-bot.service > /dev/null <<EOF
   [Unit]
   Description=silvered-bot
   After=network-online.target
   Wants=network-online.target

   [Service]
   User=$USER
   WorkingDirectory=$HOME/silvered-bot
   ExecStart=/usr/bin/node index.js
   Restart=always
   RestartSec=5
   AmbientCapabilities=CAP_NET_BIND_SERVICE

   [Install]
   WantedBy=multi-user.target
   EOF
   sudo systemctl daemon-reload
   sudo systemctl enable --now silvered-bot
   journalctl -u silvered-bot -f
   ```

6. Get a free HTTPS certificate. Certbot renews it automatically, and the bot loads each new one without restarting:

   ```
   sudo apt-get install -y certbot
   sudo mkdir -p /var/www/silvered-bot /etc/silvered-bot/tls
   sudo chown "$USER" /etc/silvered-bot/tls
   sudo chmod 700 /etc/silvered-bot/tls
   sudo tee /usr/local/bin/silvered-bot-cert > /dev/null <<EOF
   #!/bin/sh
   install -o $USER -m 600 "\$RENEWED_LINEAGE/fullchain.pem" /etc/silvered-bot/tls/fullchain.pem
   install -o $USER -m 600 "\$RENEWED_LINEAGE/privkey.pem" /etc/silvered-bot/tls/privkey.pem
   systemctl kill -s HUP silvered-bot
   EOF
   sudo chmod 755 /usr/local/bin/silvered-bot-cert
   sudo certbot certonly --webroot -w /var/www/silvered-bot -d bot.example.com --deploy-hook /usr/local/bin/silvered-bot-cert
   ```

7. Open `https://bot.example.com/dashboard/` and log in with Discord. The status page is at `/health`.

To update the bot:

```
cd ~/silvered-bot
git pull
npm ci --omit=dev
sudo systemctl restart silvered-bot
```

Role menus and settings are saved in `data/settings.json`. They survive restarts, but **deleting the VM or its disk wipes them**. To back them up, run this on your computer:

```
gcloud compute scp <vm-name>:~/silvered-bot/data/settings.json . --zone <zone>
```

## Keep-alive checks

`.github/workflows/keep-alive.yml` pings `/health` at 08:00 and 20:00 UTC. Change the `cron:` line to use other times.

1. Push the repository to GitHub.
2. Under **Settings → Secrets and variables → Actions**, add a secret named `BOT_URL` set to your address, such as `https://bot.example.com` (no `/dashboard`).
3. On the **Actions** tab, choose **Keep alive** and press **Run workflow** to test it.

If the bot is down, the run fails and GitHub emails you. GitHub can run scheduled jobs late, and it disables them after 60 days without commits. You can re-enable them from the **Actions** tab. The ping only reports problems, and systemd is what restarts a crashed bot.
