// Game state
let currentImage = null;
let currentObject = null;
let selectedCells = new Set();
let socket = null;
let playerName = '';
let roomCode = '';
let isPlayer1 = false;
let timerInterval = null;
let hasFinishedAllRounds = false;
let isJoining = false; // Flag to prevent multiple join attempts

// Constants
const CELL_SIZE = 150; // 450px / 3
const GRID_SIZE = 3;
const DATASET_PATH = encodeURIComponent('reCAPTCHA 450.v3-recaptcha-450.tensorflow');
const ROUND_TIME = 5000; // 5 seconds in milliseconds

// DOM elements
const lobbyDiv = document.getElementById('lobby');
const gameDiv = document.getElementById('game');
const gameOverDiv = document.getElementById('game-over');
const playerNameInput = document.getElementById('player-name');
const roomCodeInput = document.getElementById('room-code');
const joinButton = document.getElementById('join-btn');
const startGameButton = document.getElementById('start-game-btn');
const rematchButton = document.getElementById('rematch-btn');
const lobbyMessage = document.getElementById('lobby-message');
const playerSlots = document.querySelectorAll('.player-slot .player-name');
const playerScores = document.querySelectorAll('.player-slot .player-score');
const imageElement = document.getElementById('captcha-image');
const gridOverlay = document.querySelector('.grid-overlay');
const targetObjectSpan = document.getElementById('target-object');
const verifyButton = document.getElementById('verify-btn');
const showAnswerButton = document.getElementById('show-answer-btn');
const resultMessage = document.getElementById('result-message');
const player1Score = document.getElementById('player1-score');
const player2Score = document.getElementById('player2-score');
const currentRoundSpan = document.getElementById('current-round');
const totalRoundsSpan = document.getElementById('total-rounds');
const roundTimer = document.getElementById('round-timer');
const winnerMessage = document.getElementById('winner-message');

// Initialize Socket.IO
function initializeSocket() {
    socket = io();

    socket.on('join_error', (message) => {
        lobbyMessage.textContent = message;
        isJoining = false;
        joinButton.disabled = false;
    });

    socket.on('player_joined', ({ players, scores }) => {
        isJoining = false; // Reset joining flag
        
        // Update player slots
        players.forEach((player, index) => {
            playerSlots[index].textContent = player.name;
            playerSlots[index].dataset.id = player.id;
            playerScores[index].textContent = scores[player.id];
        });

        // Clear empty slots
        for (let i = players.length; i < 2; i++) {
            playerSlots[i].textContent = 'Waiting...';
            playerScores[i].textContent = '0';
        }

        isPlayer1 = players[0].id === socket.id;
        lobbyMessage.textContent = ''; // Clear any messages
    });

    socket.on('can_start_game', () => {
        startGameButton.disabled = false;
    });

    socket.on('game_started', () => {
        hideAllScreens();
        gameDiv.classList.add('active');
        initGame();
    });

    socket.on('new_round', ({ roundNumber, totalRounds }) => {
        if (roundNumber > totalRounds) {
            // Player has finished all rounds
            hasFinishedAllRounds = true;
            stopRoundTimer();
            hideAllScreens();
            gameDiv.classList.add('active');

            // Clear any existing game elements
            const gameContainer = document.getElementById('game-container');
            if (gameContainer) gameContainer.style.display = 'none';

            // Show waiting message
            resultMessage.style.display = 'block';
            resultMessage.style.textAlign = 'center';
            resultMessage.style.marginTop = '40px';
            resultMessage.style.fontSize = '1.2em';
            resultMessage.textContent = 'You finished! Waiting for opponent to finish...';
            resultMessage.className = 'success';

            // Show current scores
            // const scoreDiv = document.createElement('div');
            // scoreDiv.style.marginTop = '20px';
            // scoreDiv.style.fontSize = '1.1em';
            //scoreDiv.textContent = `Current Score - You: ${player1Score.textContent} | Opponent: ${player2Score.textContent}`;
            resultMessage.appendChild(scoreDiv);
            return;
        }

        currentRoundSpan.textContent = roundNumber;
        totalRoundsSpan.textContent = totalRounds;
        
        // Make sure game container is visible for active rounds
        const gameContainer = document.getElementById('game-container');
        if (gameContainer) gameContainer.style.display = 'flex';
        resultMessage.style.display = 'block';
        resultMessage.textContent = '';
        
        initGame();
    });

    socket.on('player_finished', ({ opponentFinished, opponentName, scores }) => {
        hideAllScreens();
        gameDiv.classList.add('active');
        
        // Create or get the waiting container
        let waitingContainer = document.getElementById('waiting-container');
        if (!waitingContainer) {
            waitingContainer = document.createElement('div');
            waitingContainer.id = 'waiting-container';
            waitingContainer.style.textAlign = 'center';
            waitingContainer.style.marginTop = '20px';
            gameDiv.appendChild(waitingContainer);
        }
        
        // Show appropriate message and scores
        const myScore = scores[socket.id] || 0;
        const opponentScore = opponentName ? scores[Object.keys(scores).find(id => id !== socket.id)] || 0 : 0;
        
        let statusHtml = `
            <div class="success" style="font-size: 1.2em; margin-bottom: 20px;">
                You've completed all rounds!<br>
                ${opponentFinished ? 
                    `${opponentName} has also finished!` : 
                    `Waiting for ${opponentName} to finish...`}
            </div>
            <div style="font-size: 1.1em; margin-top: 10px;">
                Current Scores:<br>
                You: ${myScore} | ${opponentName}: ${opponentScore}
            </div>
        `;
        
        waitingContainer.innerHTML = statusHtml;
    });

    socket.on('round_timeout', () => {
        stopRoundTimer();
        showCorrectAnswersAndSkip();
    });

    socket.on('scores_updated', (scores) => {
        const players = Array.from(document.querySelectorAll('.player-slot .player-name'));
        const myScore = scores[socket.id] || 0;
        const opponentId = players.find(p => p.dataset.id !== socket.id)?.dataset.id;
        const opponentScore = opponentId ? scores[opponentId] : 0;
        
        // Always show current player's score on the left
        player1Score.textContent = myScore;
        player2Score.textContent = opponentScore;
    });

    socket.on('rematch_requested', ({ playerName, totalRequests, totalPlayers }) => {
        winnerMessage.textContent = `${playerName} wants a rematch! (${totalRequests}/${totalPlayers} players ready)`;
    });

    socket.on('game_over', ({ scores, players, firstToFinish }) => {
        stopRoundTimer();
        hideAllScreens();
        gameOverDiv.classList.add('active');
        
        // Update final scores
        const finalScoreSlots = gameOverDiv.querySelectorAll('.player-slot');
        players.forEach((player, index) => {
            const slot = finalScoreSlots[index];
            const nameElement = slot.querySelector('.player-name');
            nameElement.textContent = player.name;
            if (player.id === firstToFinish) {
                nameElement.textContent += ' 🏃'; // Add emoji to indicate who finished first
            }
            slot.querySelector('.player-score').textContent = scores[player.id];
        });

        // Show winner
        const player1Score = scores[players[0].id] || 0;
        const player2Score = scores[players[1].id] || 0;
        if (player1Score > player2Score) {
            winnerMessage.textContent = `${players[0].name} wins!`;
        } else if (player2Score > player1Score) {
            winnerMessage.textContent = `${players[1].name} wins!`;
        } else {
            winnerMessage.textContent = "It's a tie!";
        }

        // Show rematch button for all players
        rematchButton.style.display = 'block';
        rematchButton.textContent = 'Request Rematch';
        
        // Reset finished state for next game
        hasFinishedAllRounds = false;
    });

    socket.on('player_left', ({ players }) => {
        lobbyMessage.textContent = 'Other player left the game';
        startGameButton.disabled = true;
        
        // Update player slots
        players.forEach((player, index) => {
            playerSlots[index].textContent = player.name;
        });
        for (let i = players.length; i < 2; i++) {
            playerSlots[i].textContent = 'Waiting...';
        }

        // If in game, return to lobby
        if (gameDiv.classList.contains('active')) {
            hideAllScreens();
            lobbyDiv.classList.add('active');
        }
    });
}

function hideAllScreens() {
    lobbyDiv.classList.remove('active');
    gameDiv.classList.remove('active');
    gameOverDiv.classList.remove('active');
    lobbyDiv.classList.add('hidden');
    gameDiv.classList.add('hidden');
    gameOverDiv.classList.add('hidden');
}

function startRoundTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
    }
    
    let timeLeft = 5;
    roundTimer.textContent = timeLeft;
    
    timerInterval = setInterval(() => {
        timeLeft--;
        roundTimer.textContent = timeLeft;
        
        if (timeLeft <= 0) {
            stopRoundTimer();
            showAnswerButton.click(); // Simulate clicking the skip button
        }
    }, 1000);
}

function stopRoundTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

// Join room handler
joinButton.addEventListener('click', () => {
    if (isJoining) return; // Prevent multiple clicks
    
    playerName = playerNameInput.value.trim();
    roomCode = roomCodeInput.value.trim();

    if (!playerName || !roomCode) {
        lobbyMessage.textContent = 'Please enter both name and room code';
        return;
    }

    isJoining = true;
    joinButton.disabled = true;
    lobbyMessage.textContent = 'Joining room...';
    socket.emit('join_room', { roomCode, playerName });
});

// Start game handler
startGameButton.addEventListener('click', () => {
    socket.emit('start_game');
});

// Rematch handler
rematchButton.addEventListener('click', () => {
    socket.emit('request_rematch');
});

// Create grid cells
for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
    const cell = document.createElement('div');
    cell.className = 'grid-cell';
    cell.dataset.index = i;
    
    cell.addEventListener('click', () => {
        cell.classList.toggle('selected');
        if (cell.classList.contains('selected')) {
            selectedCells.add(i);
        } else {
            selectedCells.delete(i);
        }
    });
    
    gridOverlay.appendChild(cell);
}

// Load annotations from CSV
async function loadAnnotations() {
    try {
        const response = await fetch(`${DATASET_PATH}/train/_annotations.csv`);
        const csvText = await response.text();
        const lines = csvText.split('\n');
        const headers = lines[0].split(',');
        
        // Group annotations by filename
        const annotationsByFile = {};
        
        lines.slice(1).filter(line => line.trim()).forEach(line => {
            const values = line.split(',');
            const filename = values[0];
            
            if (!annotationsByFile[filename]) {
                annotationsByFile[filename] = {
                    filename,
                    width: parseInt(values[1]),
                    height: parseInt(values[2]),
                    class: values[3],
                    bboxes: []
                };
            }
            
            annotationsByFile[filename].bboxes.push({
                xmin: parseInt(values[4]),
                ymin: parseInt(values[5]),
                xmax: parseInt(values[6]),
                ymax: parseInt(values[7])
            });
        });
        
        return Object.values(annotationsByFile);
    } catch (error) {
        console.error('Error loading annotations:', error);
        return [];
    }
}

// Get random image data
function getRandomImage(annotations) {
    const randomIndex = Math.floor(Math.random() * annotations.length);
    const imageData = annotations[randomIndex];
    return imageData;
}

// Check if a cell overlaps with any of the bounding boxes
function doesCellOverlapAnyBBox(cellIndex, bboxes) {
    const row = Math.floor(cellIndex / GRID_SIZE);
    const col = cellIndex % GRID_SIZE;
    
    const cellLeft = col * CELL_SIZE;
    const cellTop = row * CELL_SIZE;
    const cellRight = cellLeft + CELL_SIZE;
    const cellBottom = cellTop + CELL_SIZE;
    
    // Check if the cell overlaps with any bbox
    return bboxes.some(bbox => {
        return !(cellLeft >= bbox.xmax ||
                cellRight <= bbox.xmin ||
                cellTop >= bbox.ymax ||
                cellBottom <= bbox.ymin);
    });
}

// Get correct cells
function getCorrectCells() {
    if (!currentImage) return new Set();
    
    const correctCells = new Set();
    for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
        if (doesCellOverlapAnyBBox(i, currentImage.bboxes)) {
            correctCells.add(i);
        }
    }
    return correctCells;
}

// Show correct answers and skip to next
function showCorrectAnswersAndSkip() {
    // Stop the timer immediately
    stopRoundTimer();
    
    const correctCells = getCorrectCells();
    
    // Remove any existing correct-answer highlights
    document.querySelectorAll('.grid-cell').forEach(cell => {
        cell.classList.remove('correct-answer');
    });
    
    // Add highlight to correct cells
    correctCells.forEach(index => {
        const cell = document.querySelector(`.grid-cell[data-index="${index}"]`);
        cell.classList.add('correct-answer');
    });
    
    // Show skip message
    resultMessage.textContent = 'Time up - Showing correct answer';
    resultMessage.className = 'error';
    
    // Clear selections
    selectedCells.clear();
    document.querySelectorAll('.grid-cell').forEach(cell => {
        cell.classList.remove('selected');
    });

    // Move to next round after a brief delay
    setTimeout(() => {
        socket.emit('round_complete');
    }, 200);
}

// Initialize game
async function initGame() {
    const annotations = await loadAnnotations();
    if (annotations.length === 0) {
        resultMessage.textContent = 'Error loading game data';
        resultMessage.className = 'error';
        return;
    }
    
    // Reset game state
    selectedCells.clear();
    document.querySelectorAll('.grid-cell').forEach(cell => {
        cell.classList.remove('selected', 'correct-answer');
    });
    resultMessage.textContent = '';
    
    // Get random image and its annotations
    currentImage = getRandomImage(annotations);
    currentObject = currentImage.class;
    
    // Update UI with encoded path
    imageElement.src = `${DATASET_PATH}/train/${encodeURIComponent(currentImage.filename)}`;
    targetObjectSpan.textContent = currentObject;
    
    // Start timer only after image loads
    imageElement.onload = () => {
        startRoundTimer();
    };
    
    // Log for debugging
    console.log('Loading image:', imageElement.src);
}

// Verify user selection
function verifySelection() {
    if (!currentImage) return;
    
    const correctCells = getCorrectCells();
    
    // Compare sets
    const selectedArray = Array.from(selectedCells).sort();
    const correctArray = Array.from(correctCells).sort();
    
    const isCorrect = selectedArray.length === correctArray.length &&
                     selectedArray.every((value, index) => value === correctArray[index]);
    
    if (isCorrect) {
        socket.emit('score_update', true);
        resultMessage.textContent = 'Correct!';
        resultMessage.className = 'success';
    } else {
        resultMessage.textContent = 'Incorrect, try again!';
        resultMessage.className = 'error';
    }
}

// Event listeners
verifyButton.addEventListener('click', verifySelection);
showAnswerButton.addEventListener('click', showCorrectAnswersAndSkip);

// Initialize socket connection
initializeSocket();

// Start the game
initGame(); 