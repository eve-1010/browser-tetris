document.addEventListener("DOMContentLoaded", () => {

let playfield = document.getElementById("playfield");
let ctxPlayfield = playfield.getContext("2d");

let grids = document.getElementById("grids");
let ctxGrids = grids.getContext("2d");

const GRID_ROWS = 20;
const GRID_COLUMNS = 10;

const LOCK_DELAY_MAX_COUNT = 5; // maximum moves before "lock"
const SPEED_INCREASE_FACTOR = 0.8;
const INITIAL_SPEED = 400; // tetromino falls every x millisecond

let gridSize;

let playfieldMatrix = [];
let tetrominoSequence = [];

let animation;
let currentTimeStamp;
let previousTimeStamp; 
let gameOver = false; 
let gamePaused = false;

let holdQueue = undefined; 
let holdQueueLock = false;

let fallingSpeed = INITIAL_SPEED;
let delayMoveCount = 0;
let elapsed = 0;
let activeTetromino;

let linesCleared = 0;
let level = 1;

// https://tetris.fandom.com/wiki/SRS
const tetrominoMatrix = {
    "I": [
        [0, 0, 0, 0],
        [1, 1, 1, 1],
        [0, 0, 0, 0],
        [0, 0, 0, 0]
    ],

    "J": [
        [1, 0, 0],
        [1, 1, 1],
        [0, 0, 0]
    ],

    "L": [
        [0, 0, 1],
        [1, 1, 1],
        [0, 0, 0]
    ],

    "O": [
        [1, 1],
        [1, 1]
    ],

    "S": [
        [0, 1, 1],
        [1, 1, 0],
        [0, 0, 0]
    ],

    "T": [
        [0, 1, 0],
        [1, 1, 1],
        [0, 0, 0]
    ],

    "Z": [
        [1, 1, 0],
        [0, 1, 1],
        [0, 0, 0]
    ]
}

const tetrominoColors = {
    "I": "cyan",
    "J": "blue",
    "L": "orange",
    "O": "yellow",
    "S": "green",
    "T": "purple",
    "Z": "red"
}

class tetromino {
    constructor(name) {
        this.name = name;
        this.color = tetrominoColors[name];
        this.matrix = tetrominoMatrix[name];
        // tetromino spawn position
        // https://harddrop.com/wiki/Spawn_Location
        this.x = name == "O" ? 4 : 3;
        this.y = 0;
        this.lock = false;
        this.lockDelay = false;
        this.lockDelayCooldown = false;
    }
}

function computeGameFieldSize() {
    // playfield takes up 80% of height
    gridSize = window.innerHeight * 0.8 / 20;

    // sets width and height of canvas
    grids.width = GRID_COLUMNS * gridSize;
    grids.height = GRID_ROWS * gridSize;

    playfield.width = GRID_COLUMNS * gridSize;
    playfield.height = GRID_ROWS * gridSize;
}

// extra row for vanish space
// https://tetris.fandom.com/wiki/Playfield
function initializePlayfield() {
    for (let row = 0; row < GRID_ROWS + 1; row++) {
        playfieldMatrix[row] = [];
        
        for (let col = 0; col < GRID_COLUMNS ; col++) {
            playfieldMatrix[row][col] = 0;
        }
    }
}

// random number generator
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/random
// The maximum is exclusive and the minimum is inclusive
function randint(min, max) {
    const minCeiled = Math.ceil(min);
    const maxFloored = Math.floor(max);
    return Math.floor(Math.random() * (maxFloored - minCeiled) + minCeiled); 
}

// https://tetris.wiki/Random_Generator
function generateSequence(set = 1) {
    for (let i = 0; i < set; i++) {
        let tetrominos = Object.keys(tetrominoMatrix);
        while (tetrominos.length) {
            let index = randint(0, tetrominos.length);
            tetrominoSequence.push(tetrominos[index]);
            tetrominos.splice(index, 1);
        }
    }
}

function getNextTetromino() {
    // ensures there is at least 7 tetrominos in the sequence
    // relevant for showing next tetrominos on screen
    if (tetrominoSequence.length == 0) {
        generateSequence(2);
    }
    if (tetrominoSequence.length <= 7) {
        generateSequence();
    }

    // pop and return first tetromino
    return tetrominoSequence.shift();
}

// collision and boundary check
function isValidMove(y = activeTetromino.y, 
                     x = activeTetromino.x, 
                     matrix = activeTetromino.matrix) {
    for (let row = 0; row < activeTetromino.matrix.length; row++) {
        for (let col = 0; col < matrix[row].length; col++) {
            // if piece is empty
            if (!matrix[row][col])
                continue;

            // out of bound (horizontal)
            if (x + col < 0 || x + col >= GRID_COLUMNS) return false;

            // out of bound (bottom)
            if (y + row >= playfieldMatrix.length) return false;

            // collision with other tetrominos
            if (playfieldMatrix[y + row][x + col]) return false;
        }
    }
    return true;
}

function placeTetromino() {
    const x = activeTetromino.x;
    const y = activeTetromino.y;

    for (let row = 0; row < activeTetromino.matrix.length; row++) {
        for (let col = 0; col < activeTetromino.matrix[row].length; col++) {
            if (!activeTetromino.matrix[row][col])
                continue;

            // check if placement has any part offscreen
            if (y + row <= 1) gameOver = true;

            playfieldMatrix[y + row][x + col] = activeTetromino.name;
        }
    }

    holdQueueLock = false;

    checkLineClears();
}

function checkLineClears() {
    for (let row = 0; row < playfieldMatrix.length; row++) {
        if (!playfieldMatrix[row].includes(0)) {
            linesCleared++;

            let currentLevel = Math.floor(linesCleared / 5) + 1;
            if (currentLevel != level) {
                level = currentLevel;
                fallingSpeed *= SPEED_INCREASE_FACTOR;
            }

            playfieldMatrix.splice(row, 1);
            playfieldMatrix.splice(0, 0, Array(10).fill(0));
        }
    }
}

// rotate square matrix clockwise 90 degrees
// https://stackoverflow.com/a/58668351
function rotate(matrix) {
    return matrix[0].map((val, index) => matrix.map(row => row[index]).reverse());
}

function hold() {
    if (holdQueueLock) return;

    if (holdQueue) {
        [holdQueue, activeTetromino] = [activeTetromino, holdQueue];
        activeTetromino = new tetromino(activeTetromino.name);
        holdQueue = new tetromino(holdQueue.name);
    }
    else {
        holdQueue = new tetromino(activeTetromino.name);
        activeTetromino = new tetromino(getNextTetromino());
    }

    holdQueueLock = true;
}

// https://stackoverflow.com/a/64802566
function drawGrid() {
    ctxGrids.strokeStyle = "rgb(100, 100, 100)";

    for (let x = 0; x <= grids.width; x += gridSize) {
        for (let y = 0; y <= grids.height; y += gridSize)
            ctxGrids.strokeRect(x, y, gridSize, gridSize);
    }
}

function drawPlayfield() {
    for (let row = 1; row < playfieldMatrix.length; row++) {
        for (let col = 0; col < playfieldMatrix[0].length; col++) {
            let grid = playfieldMatrix[row][col];
            if (grid) {
                ctxPlayfield.fillStyle = tetrominoColors[grid];
                ctxPlayfield.fillRect(col * gridSize, (row - 1) * gridSize,
                                       gridSize, gridSize)
            }
        }
    }
}

function drawActiveTetromino() {
    ctxPlayfield.fillStyle = activeTetromino.color;
    for (let row = 0; row < activeTetromino.matrix.length; row++) {
        for (let col = 0; col < activeTetromino.matrix[row].length; col++) {
            if (activeTetromino.matrix[row][col]) {
                ctxPlayfield.fillRect((activeTetromino.x + col) * gridSize, 
                (activeTetromino.y + row - 1) * gridSize, gridSize, gridSize);
            }
        }
    }
}

function drawPlacementPreview() {
    ctxPlayfield.fillStyle = "#303030";
    let y = activeTetromino.y;
    while (isValidMove(y)) {
        y++;
    }
    for (let row = 0; row < activeTetromino.matrix.length; row++) {
        for (let col = 0; col < activeTetromino.matrix[row].length; col++) {
            if (activeTetromino.matrix[row][col]) {
                ctxPlayfield.fillRect((activeTetromino.x + col) * gridSize,
            (y + row - 2) * gridSize, gridSize, gridSize);
            }
        }
    }
}

function redrawFrame() {
    ctxGrids.clearRect(0, 0, grids.width, grids.height);
    ctxPlayfield.clearRect(0, 0, playfield.width, playfield.height);

    drawGrid(); 
    drawPlacementPreview(); 
    drawPlayfield(); 
    drawActiveTetromino();
}

function resize() {
    computeGameFieldSize();
    redrawFrame();
}

function resetGame() {
    initializePlayfield();
    tetrominoSequence = [];
    previousTimeStamp = undefined;
    holdQueue = undefined;
    holdQueueLock = false;
    fallingSpeed = INITIAL_SPEED;
    level = 1;
    linesCleared = 0;

    if (gameOver) {
        document.getElementById("game-over-screen").style.display = "none";
        gameOver = false;
        gamePaused = false;
    }
    else if (gamePaused) {
        hidePauseMenu();
    }
}

function showPauseMenu() {
    gamePaused = true;
    document.getElementById("pause-screen").style.display = "block";
}

function hidePauseMenu() {
    gamePaused = false;
    document.getElementById("pause-screen").style.display = "none";
}

function gameloop(timeStamp) {
    currentTimeStamp = timeStamp;

    if (gameOver) {
        document.getElementById("score").innerText = `${linesCleared} LINE(S) CLEARED`;
        document.getElementById("game-over-screen").style.display = "block";
        gamePaused = true;
    }

    if (!gamePaused) {
        if (previousTimeStamp == undefined) { // first frame
            previousTimeStamp = timeStamp;
            activeTetromino = new tetromino(getNextTetromino());
            drawActiveTetromino();
        }
        
        elapsed = timeStamp - previousTimeStamp;

        redrawFrame();

        if (!activeTetromino.lockDelay && elapsed > fallingSpeed) {
            activeTetromino.lockDelayCooldown = false;
            if (isValidMove(activeTetromino.y + 1))
                activeTetromino.y++;
            else {
                placeTetromino();
                activeTetromino = new tetromino(getNextTetromino());
            }
            previousTimeStamp = timeStamp;
        }

        // lock delay
        // https://tetris.wiki/Lock_delay
        // https://harddrop.com/wiki/lock_delay
        if (activeTetromino.lockDelay) {
            if (elapsed >= fallingSpeed || delayMoveCount >= LOCK_DELAY_MAX_COUNT) {
                // reset state
                elapsed = fallingSpeed;
                delayMoveCount = 0;
                activeTetromino.lockDelay = false;
                activeTetromino.lockDelayCooldown = true;
            }
        }

    }
    
    animation = requestAnimationFrame(gameloop);
}

function handleKeyDown(event) {
    if (gameOver) return;

    if (event.defaultPrevented) return;

    if (event.key == "Escape") {
        if (gamePaused) {
            hidePauseMenu();
        }
        else {
            showPauseMenu();
        }
    }

    if (activeTetromino.lock) return;

    if (!activeTetromino.lockDelayCooldown) {
        if (event.key == "ArrowDown" ||
            event.key == "ArrowLeft" ||
            event.key == "ArrowRight" ||
            event.key == "ArrowUp") {
            activeTetromino.lockDelay = true; 
            elapsed = 0;
            delayMoveCount++;
        previousTimeStamp = currentTimeStamp;
        }
    }

    switch (event.key) {
        // drop
        case "ArrowDown":
            if (isValidMove(activeTetromino.y + 1)) {
                activeTetromino.y++;
            }
            break;
        // move left
        case "ArrowLeft":
            if (isValidMove(activeTetromino.y, activeTetromino.x - 1)) {
                activeTetromino.x--;
            }
            break;
        // move right
        case "ArrowRight":
            if (isValidMove(activeTetromino.y, activeTetromino.x + 1)) {
                activeTetromino.x++;
            }
            break;
        // rotate
        case "ArrowUp":
            if (event.repeat) return;
            let transformed = rotate(activeTetromino.matrix);
            if (isValidMove(activeTetromino.y,
                            activeTetromino.x,
                            transformed)) {
                activeTetromino.matrix = transformed;
            }
            break;
        // hard drop
        case " ":
            while (isValidMove(activeTetromino.y + 1)) {
                activeTetromino.y++;
            }
            activeTetromino.lock = true;
            break;
        // hold
        case "c": case "Shift":
            hold();
            break;
    }
}

function registerEventListeners() {
    document.getElementById("btn-resume").addEventListener("click", hidePauseMenu);
    document.getElementById("btn-restart").addEventListener("click", resetGame);
    document.getElementById("btn-restart1").addEventListener("click", resetGame);

    window.addEventListener("resize", resize);

    // https://stackoverflow.com/a/43418287
    // https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key
    window.addEventListener("keydown", handleKeyDown);
}

computeGameFieldSize();
initializePlayfield();
registerEventListeners();
animation = requestAnimationFrame(gameloop);

})