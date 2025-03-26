const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const port = 3000;

// Serve static files from the current directory
app.use(express.static('.'));

// Constants
const TOTAL_ROUNDS = 10;
const ROUND_TIME = 3000; // 3 seconds

// Store active rooms and players
const rooms = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Handle room joining
    socket.on('join_room', ({ roomCode, playerName }) => {
        roomCode = roomCode.toUpperCase();
        
        // Create room if it doesn't exist
        if (!rooms.has(roomCode)) {
            rooms.set(roomCode, {
                players: [],
                scores: {},
                gameStarted: false,
                playerRounds: {}, // Track individual player rounds
                firstToFinish: null // Track who finished first
            });
        }

        const room = rooms.get(roomCode);

        // Check if room is full
        if (room.players.length >= 2) {
            socket.emit('join_error', 'Room is full');
            return;
        }

        // Add player to room
        socket.join(roomCode);
        room.players.push({
            id: socket.id,
            name: playerName
        });
        room.scores[socket.id] = 0;
        room.playerRounds[socket.id] = 0; // Initialize player round

        // Notify room of player join
        io.to(roomCode).emit('player_joined', {
            players: room.players,
            scores: room.scores
        });

        // Enable start button for first player if room is full
        if (room.players.length === 2) {
            io.to(room.players[0].id).emit('can_start_game');
        }

        socket.roomCode = roomCode;
    });

    // Handle game start
    socket.on('start_game', () => {
        const room = rooms.get(socket.roomCode);
        if (!room || room.players[0].id !== socket.id) return;

        room.gameStarted = true;
        room.scores = {};
        room.playerRounds = {};
        room.players.forEach(player => {
            room.scores[player.id] = 0;
            room.playerRounds[player.id] = 0;
        });

        io.to(socket.roomCode).emit('game_started');
        // Start first round for all players
        room.players.forEach(player => {
            startNewRound(socket.roomCode, player.id);
        });
    });

    // Handle player completing round (either by solving or timeout)
    socket.on('round_complete', () => {
        startNewRound(socket.roomCode, socket.id);
    });

    // Handle score updates
    socket.on('score_update', (correct) => {
        const room = rooms.get(socket.roomCode);
        if (!room || !room.gameStarted) return;

        if (correct) {
            room.scores[socket.id]++;
        }

        io.to(socket.roomCode).emit('scores_updated', room.scores);
        // Move to next round immediately on correct answer
        startNewRound(socket.roomCode, socket.id);
    });

    // Handle rematch request
    socket.on('request_rematch', () => {
        const room = rooms.get(socket.roomCode);
        if (!room || room.players[0].id !== socket.id) return;

        room.gameStarted = true;
        room.scores = {};
        room.playerRounds = {};
        room.firstToFinish = null; // Reset first to finish
        room.players.forEach(player => {
            room.scores[player.id] = 0;
            room.playerRounds[player.id] = 0;
        });

        io.to(socket.roomCode).emit('game_started');
        // Start first round for all players
        room.players.forEach(player => {
            startNewRound(socket.roomCode, player.id);
        });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        if (!socket.roomCode) return;

        const room = rooms.get(socket.roomCode);
        if (!room) return;

        // Remove player from room
        room.players = room.players.filter(p => p.id !== socket.id);
        delete room.scores[socket.id];
        delete room.playerRounds[socket.id];

        if (room.players.length === 0) {
            rooms.delete(socket.roomCode);
        } else {
            io.to(socket.roomCode).emit('player_left', {
                players: room.players,
                scores: room.scores
            });
        }
    });
});

function startNewRound(roomCode, playerId) {
    const room = rooms.get(roomCode);
    if (!room || !room.gameStarted) return;

    room.playerRounds[playerId]++;
    
    if (room.playerRounds[playerId] > TOTAL_ROUNDS) {
        // Record first player to finish if not already set
        if (!room.firstToFinish) {
            room.firstToFinish = playerId;
        }

        // Check if all players have finished
        const allPlayersFinished = room.players.every(
            player => room.playerRounds[player.id] > TOTAL_ROUNDS
        );
        
        if (allPlayersFinished) {
            io.to(roomCode).emit('game_over', {
                scores: room.scores,
                players: room.players,
                firstToFinish: room.firstToFinish
            });
            room.gameStarted = false;
        }
        return;
    }

    // Start new round for this player
    io.to(playerId).emit('new_round', {
        roundNumber: room.playerRounds[playerId],
        totalRounds: TOTAL_ROUNDS
    });
}

http.listen(port, () => {
    console.log(`Rekognize game running at http://localhost:${port}`);
}); 