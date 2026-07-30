# Whot Online – Multiplayer (Render)

Nigerian Whot card game that works on **different phones**.

## Deploy to Render (free)

### 1. Push to GitHub
1. Create a new repository on GitHub
2. Upload the whole `whot-render` folder contents:
   - `package.json`
   - `server.js`
   - `public/index.html`
   - `README.md`

### 2. Create Web Service on Render
1. Go to [https://render.com](https://render.com) and sign up / log in
2. Click **New +** → **Web Service**
3. Connect your GitHub account and select the repository
4. Settings:
   - **Name**: `whot-online` (or any name)
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
5. Click **Create Web Service**

### 3. Wait for deploy
Render will build and start the server (usually 1–3 minutes).  
When it shows **Live**, open the URL it gives you (example: `https://whot-online.onrender.com`).

### 4. Play
- Open the URL on **Phone A** → Create Room → share the 4-letter code
- Open the same URL on **Phone B** → Join Room → enter the code
- When 2+ players are in, the host presses **Start Game**

---

## Rules included
- Exact card list you provided
- 1 = Hold On (same player continues)
- 2 = Pick Two (cannot be blocked)
- 8 = Suspension (skip)
- 14 = General Market
- Cannot finish with an action card
- No Whot (wild) cards
- Market empty → count numbers only (lowest wins)

## Notes
- Free Render services sleep after ~15 minutes of no traffic. First load after sleep can take 30–60 seconds.
- Max 6 players per room.
