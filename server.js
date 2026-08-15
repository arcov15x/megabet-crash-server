const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const GAME_STATE = {
  WAITING: 'WAITING',
  RUNNING: 'RUNNING',
  CRASHED: 'CRASHED'
};

let currentState = GAME_STATE.WAITING;
let currentMultiplier = 1.00;
let crashPoint = 1.00;
let countdownTimer = 10;
let activeBets = new Map();

function generateCrashPoint() {
  const e = 2 ** 32;
  const h = Math.floor(Math.random() * e);
  if (h % 33 === 0) return 1.00;
  return parseFloat((((100 * e - h) / (e - h)) / 100).toFixed(2));
}

function startCrashLoop() {
  setInterval(() => {
    if (currentState === GAME_STATE.WAITING) {
      countdownTimer--;
      io.emit('cooldown_tick', { countdown: countdownTimer });

      if (countdownTimer <= 0) {
        currentState = GAME_STATE.RUNNING;
        currentMultiplier = 1.00;
        crashPoint = Math.max(1.01, generateCrashPoint());
        io.emit('game_started', { crashPointTarget: crashPoint });
      }
    } 
    else if (currentState === GAME_STATE.RUNNING) {
      // Ajustado de 0.03 para 0.01 para desacelerar a subida e formar a curva correta
      currentMultiplier += 0.01 * currentMultiplier;

      if (currentMultiplier >= crashPoint) {
        currentState = GAME_STATE.CRASHED;
        io.emit('game_crashed', { finalMultiplier: crashPoint });
        activeBets.clear();

        setTimeout(() => {
          currentState = GAME_STATE.WAITING;
          countdownTimer = 10;
          currentMultiplier = 1.00;
        }, 3000);
      } else {
        io.emit('multiplier_update', { multiplier: parseFloat(currentMultiplier.toFixed(2)) });
      }
    }
  }, 100);
}

io.on('connection', (socket) => {
  socket.emit('sync_state', {
    state: currentState,
    multiplier: parseFloat(currentMultiplier.toFixed(2)),
    countdown: countdownTimer
  });

  socket.on('place_bet', (data) => {
    if (currentState === GAME_STATE.WAITING) {
      activeBets.set(data.user_id, { amount: data.amount, cashedOut: false });
      socket.emit('bet_accepted', { success: true });
    } else {
      socket.emit('bet_rejected', { reason: 'Aguarde a próxima ronda.' });
    }
  });

  socket.on('cash_out', (data) => {
    if (currentState === GAME_STATE.RUNNING && activeBets.has(data.user_id)) {
      let bet = activeBets.get(data.user_id);
      if (!bet.cashedOut) {
        bet.cashedOut = true;
        let winnings = bet.amount * currentMultiplier;
        socket.emit('cash_out_success', { multiplier: currentMultiplier, winnings: winnings.toFixed(2) });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor Crash rodando na porta ${PORT}`);
  startCrashLoop();
});