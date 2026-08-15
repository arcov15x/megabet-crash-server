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
let crashPoint = 1.01; // Início seguro
let countdownTimer = 5;
let activeBets = new Map();
let recentHistory = [];

function generateCrashPoint() {
  const e = 2 ** 32;
  const h = Math.floor(Math.random() * e);
  // Garante que o multiplicador nunca seja 1.00 ou menor
  let val = (((100 * e - h) / (e - h)) / 100);
  return Math.max(1.01, parseFloat(val.toFixed(2)));
}

function startCrashLoop() {
  // Loop de contagem regressiva (1s)
  setInterval(() => {
    if (currentState === GAME_STATE.WAITING) {
      countdownTimer--;
      io.emit('cooldown_tick', { countdown: countdownTimer });

      if (countdownTimer <= 0) {
        currentState = GAME_STATE.RUNNING;
        currentMultiplier = 1.00;
        crashPoint = generateCrashPoint();
        io.emit('game_started', { crashPointTarget: crashPoint });
      }
    }
  }, 1000);

  // Loop de voo (100ms)
  setInterval(() => {
    if (currentState === GAME_STATE.RUNNING) {
      currentMultiplier += 0.01 * currentMultiplier;

      if (currentMultiplier >= crashPoint) {
        currentState = GAME_STATE.CRASHED;
        
        let finalVal = Math.max(1.01, parseFloat(crashPoint.toFixed(2)));
        
        // SEGURANÇA: Só adiciona ao histórico se for válido e maior que 1.00
        if (finalVal > 1.00) {
            recentHistory.unshift(finalVal);
            if (recentHistory.length > 10) recentHistory.pop();
        }

        io.emit('game_crashed', { 
          finalMultiplier: finalVal,
          history: recentHistory 
        });

        activeBets.clear();

        setTimeout(() => {
          currentState = GAME_STATE.WAITING;
          countdownTimer = 5;
          currentMultiplier = 1.00;
        }, 3000);
      } else {
        io.emit('multiplier_update', { multiplier: parseFloat(currentMultiplier.toFixed(2)) });
      }
    }
  }, 100);
}

io.on('connection', (socket) => {
  // Filtro extra: Remove qualquer valor inválido do histórico antes de enviar ao cliente
  const cleanedHistory = recentHistory.filter(val => val > 1.00);
  
  socket.emit('sync_state', {
    state: currentState,
    multiplier: parseFloat(currentMultiplier.toFixed(2)),
    countdown: countdownTimer,
    history: cleanedHistory
  });

  socket.on('place_bet', (data) => {
    if (currentState === GAME_STATE.WAITING) {
      activeBets.set(data.user_id, { amount: data.amount, cashedOut: false });
      socket.emit('bet_accepted', { success: true });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  startCrashLoop();
});