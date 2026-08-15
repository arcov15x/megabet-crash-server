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
let countdownTimer = 5; // Ajustado para 5 segundos de espera
let activeBets = new Map();
let recentHistory = []; // Array para armazenar o histórico dos últimos multiplicadores

function generateCrashPoint() {
  const e = 2 ** 32;
  const h = Math.floor(Math.random() * e);
  if (h % 33 === 0) return 1.00;
  return parseFloat((((100 * e - h) / (e - h)) / 100).toFixed(2));
}

function startCrashLoop() {
  // Loop dedicado à contagem regressiva (roda exatamente a cada 1 segundo / 1000ms)
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
  }, 1000);

  // Loop dedicado ao voo do aviãozinho (roda a cada 100ms)
  setInterval(() => {
    if (currentState === GAME_STATE.RUNNING) {
      currentMultiplier += 0.01 * currentMultiplier;

      if (currentMultiplier >= crashPoint) {
        currentState = GAME_STATE.CRASHED;
        
        // Adiciona o resultado ao histórico (mantém os últimos 10)
        let finalVal = parseFloat(crashPoint.toFixed(2));
        recentHistory.unshift(finalVal);
        if (recentHistory.length > 10) recentHistory.pop();

        // Emite o evento de crash enviando também o histórico atualizado
        io.emit('game_crashed', { 
          finalMultiplier: finalVal,
          history: recentHistory 
        });

        activeBets.clear();

        setTimeout(() => {
          currentState = GAME_STATE.WAITING;
          countdownTimer = 5; // Reseta para 5 segundos
          currentMultiplier = 1.00;
        }, 3000);
      } else {
        io.emit('multiplier_update', { multiplier: parseFloat(currentMultiplier.toFixed(2)) });
      }
    }
  }, 100);
}

io.on('connection', (socket) => {
  // Envia o estado atual e o histórico para o cliente que acabou de entrar
  socket.emit('sync_state', {
    state: currentState,
    multiplier: parseFloat(currentMultiplier.toFixed(2)),
    countdown: countdownTimer,
    history: recentHistory
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