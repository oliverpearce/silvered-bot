# Setup checklist

Work through this top to bottom and tick things off as you go (on GitHub you can click the boxes when editing, or change `[ ]` to `[x]`). If something fails, the **If it doesn't work** notes under each section cover the usual causes.

---

## 1. Discord Developer Portal

- [ ] Open https://discord.com/developers/applications and pick your bot's app
- [ ] **Bot** tab: turn on **Server Members Intent**
- [ ] **Bot** tab: turn on **Message Content Intent**
- [ ] **Bot** tab: copy the token (press **Reset Token** if you can't see it). This is `DISCORD_TOKEN`. Never share it or put it on GitHub
- [ ] **General Information** tab: copy the **Application ID**. This is `CLIENT_ID`
- [ ] **OAuth2 → URL Generator**: tick `bot` and `applications.commands`, then under bot permissions tick **Administrator** (or at least Manage Roles, Manage Messages, Send Messages, Embed Links, Add Reactions, Read Message History)
- [ ] Open the generated link and invite the bot to every server you want it in

## 2. Discord server setup

- [ ] **Server Settings → Roles**: drag the bot's role **above** every role it should hand out (games, events, interests…). It can't give roles that sit above it
- [ ] Create the roles you want people to pick, for example:
  - [ ] Games: `@Minecraft`, `@Valorant`, …
  - [ ] Events: `@Movie Night`, `@Game Night`, …
  - [ ] Interests: `@Art`, `@Music`, …
- [ ] (Optional) Turn on **Developer Mode** (User Settings → Advanced) so you can right-click → **Copy Message Link / Copy ID**
- [ ] (Optional) Copy your server's ID for `GUILD_ID`. Slash commands then update instantly in that server instead of taking up to an hour everywhere

## 3. Make a dashboard password

- [ ] Run this on your computer and copy the result. This is `DASHBOARD_KEY`:
  ```
  node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
  ```
- [ ] Save it in a password manager. Don't reuse a real password: the dashboard is plain `http://`

## 4. Push the code to GitHub

- [ ] Run these yourself:
  ```
  git add -A
  git status
  git commit -m "Public dashboard, reaction roles, embeds, keep-alive"
  git push origin host-mod
  ```
- [ ] In `git status`, check that `.env` and `data/` are **not** listed (they're gitignored)
- [ ] When you're happy, merge `host-mod` into `main` (a pull request on GitHub, or `git checkout main`, `git merge host-mod`, `git push`)

## 5. Host it on Wispbyte

- [ ] Create a free **Node.js** server at https://wispbyte.com/client
- [ ] Get the code onto it, either:
  - [ ] **Startup** tab: set the Git repo address (and branch) if your server type has it, **or**
  - [ ] **File Manager**: upload everything except `node_modules`, `.env` and `data/`
- [ ] **Startup** tab: check that the startup file is `index.js`
- [ ] Set these in the **Startup** variables (or upload a `.env` file with them):
  - [ ] `DISCORD_TOKEN=` your token
  - [ ] `CLIENT_ID=` your application ID
  - [ ] `GUILD_ID=` your server ID (optional)
  - [ ] `DASHBOARD=public`
  - [ ] `DASHBOARD_KEY=` the password from step 3
- [ ] Press **Start**. The console should show:
  - [ ] `Ready! Logged in as ...`
  - [ ] `Registered N slash commands ...`
  - [ ] `Status page listening on port ...`
  - [ ] `Dashboard: http://<your-server-address>:<port>/dashboard/`
- [ ] **Network** tab: note the address and port, e.g. `123.45.67.89:25565`
- [ ] Open `http://<address>:<port>/health` in your browser. It should say `silvered-bot is online (..ms)`
- [ ] The bot shows as online in Discord

**If it doesn't work:**
- `No bot token found` / `Couldn't log in`: the token is wrong or missing. Reset it in the Developer Portal and paste it again.
- `Used disallowed intents`: you skipped the intents in step 1.
- `DASHBOARD=public needs DASHBOARD_KEY ...`: the key is missing or shorter than 16 characters.
- The page doesn't load: check you used the port from the **Network** tab and `http://` (not `https://`).

## 6. Keep-alive pings (GitHub Actions)

- [ ] GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**
  - Name: `BOT_URL`
  - Value: `http://<address>:<port>` (no `/health` or `/dashboard` on the end)
- [ ] **Actions** tab: if asked, press the button to enable workflows
- [ ] **Actions → Keep alive → Run workflow**, and the run goes green ✅
- [ ] Stop the bot on Wispbyte, run the workflow again, and it fails ❌ (so you know you'd get an email). Then start the bot again
- [ ] Reminder: it runs twice a day (08:00 and 20:00 UTC). GitHub pauses it after 60 days with no commits. Re-enable it from the Actions tab if that happens

## 7. Dashboard: log in and pick a server and channel

- [ ] Open `http://<address>:<port>/dashboard/`
- [ ] Log in with your `DASHBOARD_KEY`
- [ ] The bot's name and avatar show at the top left
- [ ] The **Server** dropdown (left sidebar) lists every server the bot is in. Switch between them and the channels/roles change
- [ ] **Send message → Channel** dropdown lists that server's text channels, grouped by category. Channels the bot can't post in are greyed out
- [ ] **Refresh** (bottom left) picks up new channels, roles and emoji after you change them in Discord
- [ ] **Lock** logs you out of this browser
- [ ] Wrong password 10 times locks you out for 15 minutes (only test this if you're happy to wait)

## 8. Embeds

**From the dashboard (Send message):**
- [ ] Pick a server and a channel
- [ ] Fill in a title, description and colour. The preview on the right updates as you type
- [ ] Try the extras: author, thumbnail, image, footer, timestamp, fields, **Insert mention…**
- [ ] **Send to Discord**. It appears in the channel and looks like the preview
- [ ] Copy the message link, paste it into **Load message**, change something and press **Save changes**. The message edits in place
- [ ] **Stop editing (post as new)** and **Clear form** both work

**From Discord:**
- [ ] `/embed send` opens a pop-up form. Fill it in and it posts
- [ ] `/embed send channel:#other-channel` posts in that channel
- [ ] `/embed edit message:<link>` opens the form already filled in. Saving changes the message
- [ ] A bad colour (e.g. `pink`) or a bad image link gives a clear error instead of posting

## 9. Reaction role menus

**From the dashboard:**
- [ ] Send message → open **Role menu** → **Reactions**
- [ ] Set **Category** to `Games`
- [ ] Add 2–3 roles, each with an emoji (the ☺ button shows server emoji too)
- [ ] **Write the role list into the description**, then **Send to Discord**
- [ ] The bot adds its reactions to the message
- [ ] **Role menus** page: the menu is listed under **Games**
- [ ] **Edit** a menu: swap an emoji, add a role and save. The reactions update to match
- [ ] Make a **Buttons** menu too and check clicking a button gives and takes the role

**From Discord:**
- [ ] `/reactionrole create title:Event pings category:Events`
- [ ] `/reactionrole add message:<link> emoji:🎬 role:@Movie Night`. The bot reacts and the role list in the embed updates
- [ ] `/reactionrole add` on a message the bot **didn't** send (e.g. an announcement) also works
- [ ] `/reactionrole remove message:<link> role:@Movie Night` takes it off
- [ ] `/reactionrole create title:Pronouns category:Interests pick_one:true`
- [ ] `/reactionrole edit message:<link> category:Interests` moves a menu to another category
- [ ] `/reactionrole list` shows menus grouped by category, and `/reactionrole list category:Games` shows just one group
- [ ] `/reactionrole delete message:<link>` stops it being a menu (add `delete_message:true` to delete the message too)

**Test with a normal (non-admin) account:**
- [ ] Reacting gives the role
- [ ] Removing the reaction takes the role away
- [ ] On a **pick one** menu, picking a second emoji swaps the role and removes the old reaction
- [ ] Restart the bot on Wispbyte, then react on an **old** menu. It still works
- [ ] Menus made in Discord show up in the dashboard, and menus made in the dashboard show up in `/reactionrole list`

**If it doesn't work:**
- No role given: the bot's role is below that role. Drag it higher (step 2).
- Bot can't react: it needs Add Reactions and Read Message History in that channel.
- Custom emoji fails: the bot has to be in the server the emoji comes from.

## 10. Other commands

- [ ] `/help` lists the new commands on the Roles page
- [ ] `/autorole set` (or Dashboard → Settings → Autorole) gives new members a role
- [ ] `/role add`, `/role remove`, `/role info`
- [ ] `/rolemenu create` (button menus)
- [ ] `/setup-roles` (staff roles)

## 11. Backups and upkeep

- [ ] Download `data/settings.json` from Wispbyte's File Manager. It holds every role menu and the autorole, and **reinstalling the server wipes it**
- [ ] Download it again whenever you make a lot of new menus
- [ ] If the token or dashboard password ever leaks: reset the token in the Developer Portal, change `DASHBOARD_KEY` on Wispbyte, then restart
- [ ] After pushing new code: update the files on Wispbyte (or pull from Git there) and restart
