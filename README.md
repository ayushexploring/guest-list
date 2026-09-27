# Guest List

A shared wedding guest list for the family. Open the link, enter the family passcode once, and add guests. Everyone sees the same list.

- **App:** this repo, hosted on GitHub Pages at `https://ayushexploring.github.io/guest-list/`
- **Data:** a single `guests.json` in the **private** repo `ayushexploring/guest-list-data`. Every save is a commit, so its history is a full undo log.

## One-time setup

### 1. Create the private data repo
New repository → name `guest-list-data` → **Private** → tick **Add a README file** → Create.

### 2. Create a token that can only touch that repo
[github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new) (Fine-grained token)

| Field | Value |
|---|---|
| Token name | `guest-list` |
| Expiration | Custom, a date safely after the wedding, e.g. 31 Jan 2027 |
| Repository access | **Only select repositories** → `guest-list-data` |
| Permissions → Repository → **Contents** | **Read and write** |

Leave everything else alone. Generate it and copy the `github_pat_…` value.

### 3. Publish this app
Create a **public** repo `guest-list`, push this folder to `main`, then
**Settings → Pages → Build and deployment → Source: GitHub Actions**.
The workflow in `.github/workflows/deploy.yml` deploys every push.

### 4. Lock the token with the family passcode
Open `https://ayushexploring.github.io/guest-list/setup.html` (or double-click `setup.html` locally).
Paste the token, choose a passcode (a few words works best), and click **Generate**. It checks that the token can reach the data repo.

Copy the line it gives you and, in `js/config.js`, replace

```js
vault: null,
```

with it. Commit and push.

### 5. Share
Send the family the link **and, separately, the passcode**. Each person enters the passcode and their name once per phone.

## Everyday

- **Tap a guest** to edit or delete them.
- **Categories** (bottom of the page): add, rename, or delete them. A category can only be deleted once it has no guests.
- **Export CSV** opens in Excel or Google Sheets.
- If two people save at the same moment, both changes are kept.

## Undo a mistake
Every change is a commit in `guest-list-data`, with a message like *"Remove guest: Nani (by Mom)"*. Open the repo's **History** for `guests.json`, find the earlier version, and restore it.

## Renewing the token or changing the passcode
Create a new token (step 2), run `setup.html` again (step 4), push, then **delete the old token** on GitHub. Deleting the old token is what locks out devices that were already unlocked. After that, everyone enters the passcode again.

## How safe is this?
- The page only contains the token **encrypted** with the passcode (PBKDF2-SHA256, 600k rounds → AES-GCM), so the real token never appears in this public repo.
- Anyone who knows the passcode can read and change the list. They could also extract the token, but it only has access to `guest-list-data`, and history makes any change reversible.
- A short or guessable passcode could be brute-forced from the published encrypted blob. Use several words.

## Files

| File | What it is |
|---|---|
| `js/config.js` | The only file you edit: headings, data repo, locked token, side labels, starter categories |
| `js/app.js` | App behaviour |
| `js/vault.js` | Passcode encryption |
| `setup.html` | Creates the locked token |
| `css/style.css` | Styles (same palette as the invitation) |
