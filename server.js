const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Serve static files from /public
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

// Also serve from root in case files were uploaded flat
app.use(express.static(__dirname));

// Force homepage
app.get("/", (req, res) => {
  const candidates = [
    path.join(__dirname, "public", "index.html"),
    path.join(__dirname, "index.html")
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      return res.sendFile(file);
    }
  }
  // Debug page so we can see what files exist
  let listing = "";
  try {
    listing = fs.readdirSync(__dirname).join("\n");
    if (fs.existsSync(path.join(__dirname, "public"))) {
      listing += "\n\npublic/\n" + fs.readdirSync(path.join(__dirname, "public")).join("\n");
    }
  } catch(e) {
    listing = "Error reading directory: " + e.message;
  }
  res.status(404).send(`
    <h2>index.html not found</h2>
    <p>Files currently on the server:</p>
    <pre>${listing}</pre>
    <p>Fix: On GitHub make sure you have either:</p>
    <pre>public/index.html</pre>
    <p>or</p>
    <pre>index.html</pre>
    <p>at the root of the repository.</p>
  `);
});

// ========== WHOT DECK ==========
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
const turnTimers = {}; // code -> timeout id

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

  turnTimers[code] = setTimeout(() => {
    autoPlay(code);
  }, 8000);
}

function autoPlay(code) {
  const room = rooms[code];
  if (!room || !room.started || room.gameOver) return;

  const player = room.players[room.current];
  if (!player) return;
  const hand = room.hands[player.id] || [];
  const top = room.discard[room.discard.length - 1];

  // Must pick
  if (room.pendingPick > 0) {
    const need = room.pendingPick;
    for (let i = 0; i < need; i++) {
      if (room.deck.length === 0) {
        endByCount(room);
        broadcastRoom(code);
        return;
      }
      hand.push(room.deck.pop());
    }
    room.pendingPick = 0;
    room.effect = player.name + " auto-picked " + need;
    advanceTurn(room);
    broadcastRoom(code);
    startTurnTimer(code);
    return;
  }

  // Try to play a valid card
  const playable = hand.filter(c => c.shape === top.shape || c.num === top.num);
  if (playable.length > 0) {
    // Prefer non-action if last card
    playable.sort((a, b) => {
      if (hand.length === 1 && a.special && !b.special) return 1;
      if (hand.length === 1 && b.special && !a.special) return -1;
      return 0;
    });
    const card = playable[0];
    const idx = hand.findIndex(c => c.id === card.id);
    hand.splice(idx, 1);
    room.discard.push(card);
    room.effect = player.name + " auto-played " + card.num + " " + card.shape;
    room.playAgain = false;

    if (hand.length === 0) {
      if (isAction(card)) {
        if (room.deck.length > 0) {
          hand.push(room.deck.pop());
          room.effect += " (cannot finish with action – drew 1)";
          applySpecial(room, card);
          advanceTurn(room);
        } else {
          room.gameOver = true;
          room.winner = player.name;
          room.effect = player.name + " wins!";
        }
      } else {
        room.gameOver = true;
        room.winner = player.name;
        room.effect = player.name + " wins!";
      }
      broadcastRoom(code);
      if (!room.gameOver) startTurnTimer(code);
      return;
    }

    applySpecial(room, card);
    if (room.playAgain) {
      room.playAgain = false;
      room.effect += " · Hold On";
      broadcastRoom(code);
      startTurnTimer(code);
      return;
    }
    advanceTurn(room);
    broadcastRoom(code);
    startTurnTimer(code);
    return;
  }

  // No playable – draw one then pass
  if (room.deck.length === 0) {
    endByCount(room);
    broadcastRoom(code);
    return;
  }
  hand.push(room.deck.pop());
  room.effect = player.name + " auto-drew (no move)";
  advanceTurn(room);
  broadcastRoom(code);
  startTurnTimer(code);
}



function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function publicPlayers(room) {
  return room.players.map(p => ({
    id: p.id,
    name: p.name,
    cardCount: room.started ? (room.hands[p.id] || []).length : 0
  }));
}

function getRoomState(room, forSocketId) {
  return {
    code: room.code,
    hostId: room.hostId,
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
    scores: room.scores || null
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

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("create_room", ({ name }) => {
    if (!name || !name.trim()) return;
    let code = makeCode();
    while (rooms[code]) code = makeCode();

    rooms[code] = {
      code,
      hostId: socket.id,
      players: [{ id: socket.id, name: name.trim().slice(0, 12) }],
      started: false,
      hands: {},
      deck: [],
      discard: [],
      current: 0,
      pendingPick: 0,
      playAgain: false,
      effect: "",
      gameOver: false
    };

    socket.join(code);
    socket.roomCode = code;
    socket.playerName = name.trim().slice(0, 12);

    socket.emit("room_created", { code });
    broadcastRoom(code);
  });

  socket.on("list_rooms", () => {
    const active = Object.values(rooms)
      .filter(r => !r.started && r.players.length > 0)
      .map(r => ({
        code: r.code,
        host: r.players[0]?.name || "?",
        count: r.players.length
      }));
    socket.emit("rooms_list", active);
  });

  socket.on("join_room", ({ code, name }) => {
    code = (code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const room = rooms[code];
    if (!room) {
      const active = Object.keys(rooms).filter(c => !rooms[c].started);
      socket.emit("error_msg", "Room " + code + " not found. Active rooms: " + (active.length ? active.join(", ") : "none (create a new room)"));
      return;
    }
    if (room.started) {
      socket.emit("error_msg", "Game already started");
      return;
    }
    if (room.players.length >= 6) {
      socket.emit("error_msg", "Room is full");
      return;
    }
    if (room.players.some(p => p.name === name.trim())) {
      socket.emit("error_msg", "Name already taken in this room");
      return;
    }

    room.players.push({ id: socket.id, name: name.trim().slice(0, 12) });
    socket.join(code);
    socket.roomCode = code;
    socket.playerName = name.trim().slice(0, 12);

    socket.emit("room_joined", { code });
    broadcastRoom(code);
  });

  socket.on("start_game", () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 2) {
      socket.emit("error_msg", "Need at least 2 players");
      return;
    }

    room.deck = buildDeck();
    room.discard = [];
    room.hands = {};
    room.current = 0;
    room.pendingPick = 0;
    room.playAgain = false;
    room.effect = "";
    room.gameOver = false;
    room.winner = null;
    room.scores = null;
    room.started = true;

    room.players.forEach(p => {
      room.hands[p.id] = [];
      for (let i = 0; i < 5; i++) {
        if (room.deck.length) room.hands[p.id].push(room.deck.pop());
      }
    });

    let start = null;
    for (let i = 0; i < room.deck.length; i++) {
      if (!room.deck[i].special) {
        start = room.deck.splice(i, 1)[0];
        break;
      }
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
          room.effect = "Cannot finish with action card – drew 1";
          applySpecial(room, card);
          advanceTurn(room);
        } else {
          room.gameOver = true;
          room.winner = room.players[playerIdx].name;
          room.effect = room.winner + " wins!";
        }
      } else {
        room.gameOver = true;
        room.winner = room.players[playerIdx].name;
        room.effect = room.winner + " wins!";
      }
      broadcastRoom(code);
      return;
    }

    applySpecial(room, card);

    if (room.playAgain) {
      room.playAgain = false;
      room.effect = (room.effect || "") + " · Hold On – play again";
      broadcastRoom(code);
      startTurnTimer(code);
    } else {
      advanceTurn(room);
      broadcastRoom(code);
      startTurnTimer(code);
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
        if (room.deck.length === 0) {
          endByCount(room);
          broadcastRoom(code);
          return;
        }
        hand.push(room.deck.pop());
      }
      room.pendingPick = 0;
      room.effect = room.players[playerIdx].name + " picked " + need;
      advanceTurn(room);
      broadcastRoom(code);
      startTurnTimer(code);
      return;
    }

    if (room.deck.length === 0) {
      endByCount(room);
      broadcastRoom(code);
      return;
    }

    hand.push(room.deck.pop());
    const drawn = hand[hand.length - 1];
    const top = room.discard[room.discard.length - 1];
    const canPlayDrawn = drawn.shape === top.shape || drawn.num === top.num;

    if (!canPlayDrawn) {
      // Cannot play – auto continue (no Pass needed)
      room.effect = room.players[playerIdx].name + " drew (no play) – next turn";
      advanceTurn(room);
      broadcastRoom(code);
      startTurnTimer(code);
    } else {
      // Can play the drawn card – short window, else auto continues via timer
      room.effect = room.players[playerIdx].name + " drew a card – play it or wait";
      room.mustPlayOrPass = true;
      broadcastRoom(code);
      startTurnTimer(code); // 8s to play the drawn card
    }
  });

  socket.on("pass_turn", () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || !room.started || room.gameOver) return;
    clearTurnTimer(code);
    const playerIdx = room.players.findIndex(p => p.id === socket.id);
    if (playerIdx !== room.current) return;

    advanceTurn(room);
    broadcastRoom(code);
    startTurnTimer(code);
  });

  socket.on("disconnect", () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    // keep room active until host starts or empty

    const room = rooms[code];

    room.players = room.players.filter(p => p.id !== socket.id);
    delete room.hands[socket.id];

    if (room.players.length === 0) {
      clearTurnTimer(code);
      delete rooms[code];
      return;
    }

    if (room.hostId === socket.id) {
      room.hostId = room.players[0].id;
    }

    if (room.started && !room.gameOver) {
      if (room.current >= room.players.length) room.current = 0;
    }

    broadcastRoom(code);
  });
});

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
    room.effect = "General Market – everyone else draws 1";
    room.players.forEach((p, i) => {
      if (i !== room.current && room.deck.length) {
        room.hands[p.id].push(room.deck.pop());
      }
    });
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
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Whot server running on port " + PORT);
});
