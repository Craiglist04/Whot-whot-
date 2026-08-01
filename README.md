# Whot Online – Accounts + Multiplayer

## Features
- Register (username, email, password) + verification code
- Sign in
- Wallet: fund account
- Set table stake when creating a room
- Join only if wallet has enough for the stake
- On game start, stake is deducted; winner gets the pot
- Classic Whot rules + General Market continues for the player who played 14

## Deploy on Render
1. Push this folder to GitHub
2. Render → New Web Service → connect repo
3. Build: `npm install`
4. Start: `npm start`
5. Free instance

## Notes
- Verification code is shown in the app (demo). For real email, connect SendGrid/Resend later.
- Users saved in `users.json` on the server.
- Free Render sleeps after idle; rooms are in memory and clear on sleep.
