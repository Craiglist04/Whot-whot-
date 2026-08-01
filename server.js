const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const publicPath = path.join(__dirname, "public");
const usersFile = path.join(__dirname, "users.json");

app.use(express.static(publicPath));
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  const candidates = [
    path.join(publicPath, "index.html"),
    path.join(__dirname, "index.html")
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return res.sendFile(file);
  }
  res.status(404).send("index.html not found");
});

function loadUsers() {
  try {
    if (fs.existsSync(usersFile)) return JSON.parse(fs.readFileSync(usersFile, "utf8"));
  } catch (e) {}
  return {};
}
function saveUsers(users) {
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i) | 0;
  return "h" + Math.abs(h).toString(16);
}
function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
function publicUser(u) {
  if (!u) return null;
  return { username: u.username, email: u.email, balance: u.balance || 0, verified: !!u.verified };
}

const CIRCLES   = [1,2,3,4,5,7,8,10,11,12,13,14];
const TRIANGLES = [1,2,3,4,5,7,8,10,11,12,13,14];
const CROSSES   = [1,2,3,5,7,10,11,13,14];
const SQUARES   = [1,2,3,5,7,10,11,13,14];
const STARS     = [1,2,3,4,5,7,8];

function getSpecial(n) {
  if (n === 1) return "holdon";
  if (n === 2) return "pick2";
  if (n === 8) return "suspension";
  if (n === 14) return "general";
  return null;
}
function shuffle(arr) {
  const a = [...arr];
  for (let pass = 0; pass < 3; pass++) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }
  return a;
}
function buildDeck() {
  const deck = [];
  let id = 0;
  CIRCLES.forEach(n => deck.push({ id: id++, shape: "circle", num: n, special: getSpecial(n) }));
  TRIANGLES.forEach(n => deck.push({ id: id++, shape: "triangle", num: n, special: getSpecial(n) }));
  CROSSES.forEach(n => deck.push({ id: id++, shape: "cross", num: n, special: getSpecial(n) }));
  SQUARES.forEach(n => deck.push({ id: id++, shape: "square", num: n, special: getSpecial(n) }));
  STARS.forEach(n => deck.push({ id: id++, shape: "star", num: n, special: getSpecial(n) }));
  return shuffle(deck);
}
function isAction(card) {
  return card && card.special !== null;
}

const rooms = {};
const turnTimers = {};
const socketUser = {};

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
function clearTurnTimer(code) {
  if (turnTimers[code]) {
    clearTimeout(turnTimers[code]);
    delete turnTimers[code];
  }
}
function startTurnTimer(code) {
  clearTurnTimer(code);
  const room = rooms[code];
  if (!room || !room.started || room.gameOver) return;
  room.turnEndsAt = Date.now() + 15000;
  turnTimers[code] = setTimeout(() => autoPlay(code), 15000);
  broadcastRoom(code); // push new turnEndsAt so clients show 15s
}

function publicPlayers(room) {
  return room.players.map(p => ({
    id: p.id,
    name: p.name,
    username: p.username,
    cardCount: room.started ? (room.hands[p.id] || []).length : 0
  }));
}

function getRoomState(room, forSocketId) {
  return {
    code: room.code,
    hostId: room.hostId,
    stake: room.stake || 0,
    players: publicPlayers(room),
    started: room.started,
    current: room.current,
    pendingPick: room.pendingPick || 0,
    topCard: room.discard && room.discard.length ? room.discard[room.discard.length - 1] : null,
    deckCount: room.deck ? room.deck.length : 0,
    yourHand: room.started ? (room.hands[forSocketId] || []) : [],
    effect: room.effect || "",
    gameOver: room.gameOver || false,
    winner: room.winner || null,
    scores: room.scores || null,
    potPaid: room.potPaid || 0,
    winnerUsername: room.winnerUsername || null,
    turnEndsAt: room.turnEndsAt || null
  };
}

function broadcastRoom(code) {
  const room = rooms[code];
  if (!room) return;
  room.players.forEach(p => {
    const sock = io.sockets.sockets.get(p.id);
    if (sock) sock.emit("room_state", getRoomState(room, p.id));
  });
}

function applySpecial(room, card) {
  if (card.special === "holdon") {
    room.playAgain = true;
    room.effect = "Hold On! Same player continues";
  } else if (card.special === "pick2") {
    room.pendingPick = 2;
    room.effect = "Pick Two! Next player must draw 2";
  } else if (card.special === "suspension") {
    room.effect = "Suspension – next player skipped";
    room._skipNext = true;
  } else if (card.special === "general") {
    room.effect = "General Market – others draw 1, you play again";
    room.players.forEach((p, i) => {
      if (i !== room.current && room.deck.length) {
        room.hands[p.id].push(room.deck.pop());
      }
    });
    room.playAgain = true;
  }
}

function advanceTurn(room) {
  let steps = 1;
  if (room._skipNext) {
    steps = 2;
    room._skipNext = false;
  }
  room.current = (room.current + steps) % room.players.length;
}

function settleStake(room) {
  const stake = Number(room.stake) || 0;
  if (stake <= 0 || !room.winner || room.stakeSettled) return;
  room.stakeSettled = true;

  const pot = stake * room.players.length;
  const users = loadUsers();

  // Find winner by display name or username
  const winP = room.players.find(p =>
    p.name === room.winner || p.username === room.winner
  );

  if (!winP || !winP.username || !users[winP.username]) {
    console.log("settleStake: winner not found", room.winner);
    return;
  }

  const before = users[winP.username].balance || 0;
  users[winP.username].balance = before + pot;
  saveUsers(users);
  console.log("settleStake:", winP.username, before, "->", users[winP.username].balance, "pot", pot);

  room.effect = (room.effect || room.winner + " wins!") +
    " · Pot ₦" + pot.toLocaleString() + " paid to " + winP.name;
  room.potPaid = pot;
  room.winnerUsername = winP.username;

  // Push updated balances to every player in the room
  room.players.forEach(p => {
    const sock = io.sockets.sockets.get(p.id);
    if (sock && users[p.username]) {
      sock.emit("auth_ok", publicUser(users[p.username]));
      sock.emit("balance_update", publicUser(users[p.username]));
    }
  });
}

function endByCount(room) {
  room.gameOver = true;
  const scores = room.players.map(p => ({
    name: p.name,
    total: (room.hands[p.id] || []).reduce((s, c) => s + c.num, 0),
    cards: (room.hands[p.id] || []).length
  })).sort((a, b) => a.total - b.total);
  room.scores = scores;
  room.winner = scores[0].name;
  room.effect = "Market finished – lowest number total wins";
  settleStake(room);
}

function autoPlay(code) {
  const room = rooms[code];
  if (!room || !room.started || room.gameOver) return;
  const player = room.players[room.current];
  if (!player) return;
  const hand = room.hands[player.id] || [];
  const top = room.discard[room.discard.length - 1];

  if (room.pendingPick > 0) {
    const need = room.pendingPick;
    for (let i = 0; i < need; i++) {
      if (room.deck.length === 0) { endByCount(room); broadcastRoom(code); return; }
      hand.push(room.deck.pop());
    }
    room.pendingPick = 0;
    room.effect = player.name + " auto-picked " + need;
    advanceTurn(room);
    broadcastRoom(code);
    startTurnTimer(code);
    return;
  }

  const playable = hand.filter(c => c.shape === top.shape || c.num === top.num);
  if (playable.length > 0) {
    const card = playable[0];
    const idx = hand.findIndex(c => c.id === card.id);
    hand.splice(idx, 1);
    room.discard.push(card);
    room.effect = player.name + " auto-played " + card.num;
    room.playAgain = false;
    if (hand.length === 0) {
      if (isAction(card) && room.deck.length > 0) {
        hand.push(room.deck.pop());
        applySpecial(room, card);
        if (room.playAgain) room.playAgain = false;
        advanceTurn(room);
      } else {
        room.gameOver = true;
        room.winner = player.name;
        room.effect = player.name + " wins!";
        settleStake(room);
      }
      broadcastRoom(code);
      if (!room.gameOver) startTurnTimer(code);
      return;
    }
    applySpecial(room, card);
    if (room.playAgain) {
      room.playAgain = false;
      broadcastRoom(code);
      startTurnTimer(code);
      return;
    }
    advanceTurn(room);
    broadcastRoom(code);
    startTurnTimer(code);
    return;
  }

  if (room.deck.length === 0) { endByCount(room); broadcastRoom(code); return; }
  hand.push(room.deck.pop());
  room.effect = player.name + " auto-drew";
  advanceTurn(room);
  broadcastRoom(code);
  startTurnTimer(code);
}

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("register", ({ username, email, password }) => {
    const u = (username || "").trim().toLowerCase();
    const e = (email || "").trim().toLowerCase();
    if (!u || u.length < 3) return socket.emit("auth_error", "Username min 3 characters");
    if (!e || !e.includes("@")) return socket.emit("auth_error", "Valid email required");
    if (!password || password.length < 4) return socket.emit("auth_error", "Password min 4 characters");
    const users = loadUsers();
    if (users[u]) return socket.emit("auth_error", "Username taken");
    if (Object.values(users).some(x => x.email === e)) return socket.emit("auth_error", "Email already used");
    const verifyCode = genCode();
    users[u] = { username: u, email: e, pass: simpleHash(password), balance: 0, verified: false, verifyCode, createdAt: Date.now() };
    saveUsers(users);
    socket.emit("verify_required", { username: u, demoCode: verifyCode });
  });

  socket.on("verify", ({ username, code }) => {
    const u = (username || "").trim().toLowerCase();
    const users = loadUsers();
    if (!users[u]) return socket.emit("auth_error", "Account not found");
    if (users[u].verified) {
      if (!users[u].sessionToken) {
        users[u].sessionToken = genCode() + genCode();
        saveUsers(users);
      }
      socketUser[socket.id] = u;
      return socket.emit("auth_ok", { ...publicUser(users[u]), token: users[u].sessionToken });
    }
    if (String(code).trim() !== String(users[u].verifyCode)) return socket.emit("auth_error", "Wrong verification code");
    users[u].verified = true;
    delete users[u].verifyCode;
    users[u].sessionToken = genCode() + genCode();
    saveUsers(users);
    socketUser[socket.id] = u;
    socket.emit("auth_ok", { ...publicUser(users[u]), token: users[u].sessionToken });
  });

  socket.on("login", ({ username, password }) => {
    const u = (username || "").trim().toLowerCase();
    const users = loadUsers();
    const acc = users[u];
    if (!acc) return socket.emit("auth_error", "Account not found – register first");
    if (acc.pass !== simpleHash(password)) return socket.emit("auth_error", "Wrong password");
    if (!acc.verified) return socket.emit("verify_required", { username: u, demoCode: acc.verifyCode || "" });
    acc.sessionToken = genCode() + genCode();
    saveUsers(users);
    socketUser[socket.id] = u;
    socket.emit("auth_ok", { ...publicUser(acc), token: acc.sessionToken });
  });

  // Restore session after browser refresh
  socket.on("resume_session", ({ username, token }) => {
    const u = (username || "").trim().toLowerCase();
    if (!u || !token) return socket.emit("session_expired");
    const users = loadUsers();
    const acc = users[u];
    if (!acc || !acc.verified || acc.sessionToken !== token) {
      return socket.emit("session_expired");
    }
    socketUser[socket.id] = u;
    socket.emit("auth_ok", { ...publicUser(acc), token: acc.sessionToken });
  });

  socket.on("fund", ({ amount }) => {
    const u = socketUser[socket.id];
    if (!u) return socket.emit("auth_error", "Not logged in");
    const amt = Number(amount);
    if (!amt || amt <= 0) return socket.emit("auth_error", "Invalid amount");
    const users = loadUsers();
    if (!users[u]) return socket.emit("auth_error", "Account missing");
    users[u].balance = (users[u].balance || 0) + amt;
    saveUsers(users);
    socket.emit("auth_ok", publicUser(users[u]));
  });

  socket.on("get_profile", () => {
    const u = socketUser[socket.id];
    if (!u) return socket.emit("auth_error", "Not logged in");
    socket.emit("auth_ok", publicUser(loadUsers()[u]));
  });

  socket.on("create_room", ({ stake }) => {
    const u = socketUser[socket.id];
    if (!u) return socket.emit("error_msg", "Login first");
    const users = loadUsers();
    const acc = users[u];
    if (!acc) return socket.emit("error_msg", "Account missing");
    const tableStake = Math.max(0, Number(stake) || 0);
    if (tableStake > 0 && (acc.balance || 0) < tableStake) {
      return socket.emit("error_msg", "Need ₦" + tableStake + " in wallet to create table");
    }
    let code = makeCode();
    while (rooms[code]) code = makeCode();
    rooms[code] = {
      code, hostId: socket.id, stake: tableStake,
      players: [{ id: socket.id, name: acc.username, username: u }],
      started: false, hands: {}, deck: [], discard: [], current: 0,
      pendingPick: 0, playAgain: false, effect: "", gameOver: false
    };
    socket.join(code);
    socket.roomCode = code;
    socket.emit("room_created", { code, stake: tableStake });
    broadcastRoom(code);
  });

  socket.on("join_room", ({ code }) => {
    const u = socketUser[socket.id];
    if (!u) return socket.emit("error_msg", "Login first");
    const users = loadUsers();
    const acc = users[u];
    if (!acc) return socket.emit("error_msg", "Account missing");
    code = (code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const room = rooms[code];
    if (!room) {
      const active = Object.keys(rooms).filter(c => !rooms[c].started);
      return socket.emit("error_msg", "Room " + code + " not found. Active: " + (active.join(", ") || "none"));
    }
    if (room.started) return socket.emit("error_msg", "Game already started");
    if (room.players.length >= 6) return socket.emit("error_msg", "Room full");
    if (room.players.some(p => p.username === u)) return socket.emit("error_msg", "Already in room");
    if (room.stake > 0 && (acc.balance || 0) < room.stake) {
      return socket.emit("error_msg", "Need ₦" + room.stake + " in wallet to join");
    }
    room.players.push({ id: socket.id, name: acc.username, username: u });
    socket.join(code);
    socket.roomCode = code;
    socket.emit("room_joined", { code, stake: room.stake });
    broadcastRoom(code);
  });

  socket.on("list_rooms", () => {
    const active = Object.values(rooms)
      .filter(r => !r.started && r.players.length > 0)
      .map(r => ({ code: r.code, host: r.players[0]?.name || "?", count: r.players.length, stake: r.stake || 0 }));
    socket.emit("rooms_list", active);
  });

  socket.on("start_game", () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 2) return socket.emit("error_msg", "Need at least 2 players");

    if (room.stake > 0) {
      const users = loadUsers();
      for (const p of room.players) {
        if (!users[p.username] || (users[p.username].balance || 0) < room.stake) {
          return socket.emit("error_msg", p.name + " cannot afford ₦" + room.stake);
        }
      }
      for (const p of room.players) users[p.username].balance -= room.stake;
      saveUsers(users);
      room.players.forEach(p => {
        const sock = io.sockets.sockets.get(p.id);
        if (sock) sock.emit("auth_ok", publicUser(users[p.username]));
      });
    }

    room.deck = buildDeck();
    room.discard = [];
    room.hands = {};
    room.current = 0;
    room.pendingPick = 0;
    room.playAgain = false;
    room.effect = room.stake ? ("Stake ₦" + room.stake + " · pot ₦" + (room.stake * room.players.length)) : "";
    room.gameOver = false;
    room.winner = null;
    room.scores = null;
    room.stakeSettled = false;
    room.potPaid = 0;
    room.started = true;

    room.players.forEach(p => {
      room.hands[p.id] = [];
      for (let i = 0; i < 5; i++) if (room.deck.length) room.hands[p.id].push(room.deck.pop());
    });

    let start = null;
    for (let i = 0; i < room.deck.length; i++) {
      if (!room.deck[i].special) { start = room.deck.splice(i, 1)[0]; break; }
    }
    if (!start) start = room.deck.pop();
    room.discard.push(start);
    broadcastRoom(code);
    startTurnTimer(code);
  });

  socket.on("play_card", ({ cardId }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || !room.started || room.gameOver) return;
    clearTurnTimer(code);
    const playerIdx = room.players.findIndex(p => p.id === socket.id);
    if (playerIdx !== room.current) return;
    const hand = room.hands[socket.id] || [];
    const idx = hand.findIndex(c => c.id === cardId);
    if (idx === -1) return;
    const card = hand[idx];
    if (room.pendingPick > 0) return;
    const top = room.discard[room.discard.length - 1];
    if (card.shape !== top.shape && card.num !== top.num) return;

    hand.splice(idx, 1);
    room.discard.push(card);
    room.effect = "";
    room.playAgain = false;

    if (hand.length === 0) {
      if (isAction(card)) {
        if (room.deck.length > 0) {
          hand.push(room.deck.pop());
          room.effect = "Cannot finish with action – drew 1";
          applySpecial(room, card);
          if (room.playAgain) { room.playAgain = false; broadcastRoom(code); startTurnTimer(code); }
          else { advanceTurn(room); broadcastRoom(code); startTurnTimer(code); }
        } else {
          room.gameOver = true; room.winner = room.players[playerIdx].name;
          room.effect = room.winner + " wins!"; settleStake(room); broadcastRoom(code);
        }
      } else {
        room.gameOver = true; room.winner = room.players[playerIdx].name;
        room.effect = room.winner + " wins!"; settleStake(room); broadcastRoom(code);
      }
      return;
    }

    applySpecial(room, card);
    if (room.playAgain) {
      room.playAgain = false;
      room.effect = (room.effect || "") + " · play again";
      broadcastRoom(code); startTurnTimer(code);
    } else {
      advanceTurn(room); broadcastRoom(code); startTurnTimer(code);
    }
  });

  socket.on("draw_card", () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || !room.started || room.gameOver) return;
    clearTurnTimer(code);
    const playerIdx = room.players.findIndex(p => p.id === socket.id);
    if (playerIdx !== room.current) return;
    const hand = room.hands[socket.id];

    if (room.pendingPick > 0) {
      const need = room.pendingPick;
      for (let i = 0; i < need; i++) {
        if (room.deck.length === 0) { endByCount(room); broadcastRoom(code); return; }
        hand.push(room.deck.pop());
      }
      room.pendingPick = 0;
      room.effect = room.players[playerIdx].name + " picked " + need;
      advanceTurn(room); broadcastRoom(code); startTurnTimer(code);
      return;
    }
    if (room.deck.length === 0) { endByCount(room); broadcastRoom(code); return; }
    hand.push(room.deck.pop());
    const drawn = hand[hand.length - 1];
    const top = room.discard[room.discard.length - 1];
    if (!(drawn.shape === top.shape || drawn.num === top.num)) {
      room.effect = room.players[playerIdx].name + " drew (no play)";
      advanceTurn(room); broadcastRoom(code); startTurnTimer(code);
    } else {
      room.effect = room.players[playerIdx].name + " drew – can play";
      broadcastRoom(code); startTurnTimer(code);
    }
  });

  socket.on("pass_turn", () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || !room.started || room.gameOver) return;
    clearTurnTimer(code);
    if (room.players.findIndex(p => p.id === socket.id) !== room.current) return;
    advanceTurn(room); broadcastRoom(code); startTurnTimer(code);
  });


  socket.on("leave_room", () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) {
      socket.roomCode = null;
      return;
    }
    const room = rooms[code];
    room.players = room.players.filter(p => p.id !== socket.id);
    delete room.hands[socket.id];
    socket.leave(code);
    socket.roomCode = null;
    if (room.players.length === 0) {
      clearTurnTimer(code);
      delete rooms[code];
      return;
    }
    if (room.hostId === socket.id) room.hostId = room.players[0].id;
    if (room.started && !room.gameOver && room.current >= room.players.length) room.current = 0;
    broadcastRoom(code);
  });

  socket.on("disconnect", () => {
    delete socketUser[socket.id];
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    room.players = room.players.filter(p => p.id !== socket.id);
    delete room.hands[socket.id];
    if (room.players.length === 0) { clearTurnTimer(code); delete rooms[code]; return; }
    if (room.hostId === socket.id) room.hostId = room.players[0].id;
    if (room.started && !room.gameOver && room.current >= room.players.length) room.current = 0;
    broadcastRoom(code);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Whot server running on port " + PORT));
