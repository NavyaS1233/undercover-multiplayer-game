# Undercover — starter project

A beginner-friendly local MVP for the multiplayer Imposter Word Game.

## Requirements
- Node.js 20+ (Node 22 recommended)
- npm

## Run locally
Open a terminal in this `undercover-starter` folder and run:

```bash
npm install
npm run install:all
npm run dev
```

Then open http://localhost:5173 in your browser. The Socket.IO backend runs at http://localhost:4000.

## Test multiplayer
1. Open http://localhost:5173 in two or more browser windows (three players are required to start).
2. In the first window, enter a nickname and choose Create a room.
3. Copy the room code and join from other windows using different nicknames.
4. Once at least three players are connected, the host starts the game.
5. Each player sees their own secret word. Submit unique one-word clues, then vote.
6. If the Imposter is not uniquely voted out, the server automatically advances to the next round. Used clues remain blocked across rounds.

## Notes / MVP limitations
- Active rooms are held in server memory. Restarting the server deletes rooms and games.
- No persistent reconnect/session-token flow yet; disconnecting marks a player offline.
- The same Imposter and word pair remain for subsequent rounds.
- A game ends when the Imposter is uniquely voted out; the current MVP does not have a final-word guessing mechanic.
- For deployment, configure `FRONTEND_ORIGIN` on the server and `VITE_SERVER_URL` for the frontend build. Use HTTPS/WSS in production.


## Security and deployment notes

### Before publishing
- Do not commit real secrets or `.env` files. Use the hosting provider's environment-variable settings.
- This project stores rooms and scores in server memory. Rooms disappear when the server restarts and this starter is not intended for high-traffic production use without additional work.
- The server checks exact allowed browser origins through `FRONTEND_ORIGIN` (comma-separated if needed).
- One socket session can create or join only one room, preventing accidental duplicate memberships from the same live connection. Refreshing the page creates a new socket session; reconnecting to an existing player identity is not implemented.
- Use HTTPS on deployed frontend and backend. Never expose private words in public client state or logs.

### Deploy backend to Render
1. Create a new Web Service from this repository/ZIP after uploading the project to a Git repository.
2. Set the service root directory to `server`, build command `npm install`, start command `npm start`, and health check path `/health`. The included `render.yaml` documents these settings.
3. Add environment variable `FRONTEND_ORIGIN` with the exact deployed frontend origin, for example `https://your-game.vercel.app`. Do not include a path or trailing slash.
4. After deploy, verify `https://YOUR-BACKEND.onrender.com/health` returns `{\"ok\":true,\"service\":\"undercover-server\"}`.

### Deploy frontend to Vercel
1. Import the repository into Vercel and set the project root directory to `client`.
2. Set build command to `npm run build` and output directory to `dist` (Vercel normally detects Vite automatically).
3. Add environment variable `VITE_SERVER_URL` with the full backend origin, for example `https://your-backend.onrender.com` (no `/health` suffix). This variable is embedded at build time; redeploy after changing it.
4. Once Vercel provides the final domain, update the backend's `FRONTEND_ORIGIN` to that exact domain and redeploy the backend.
5. Test room creation and gameplay in separate browser tabs/devices. Check the browser console and the backend `/health` endpoint if connection fails.

### Remaining limitations
- There is no reconnect token, persistent database, room expiry/cleanup, or server-side rate limiting yet. A server restart clears all active games. Add these before treating the game as a hardened public service.
- CORS is not authentication; it only restricts browser origins. Never rely on CORS alone to protect game actions.
