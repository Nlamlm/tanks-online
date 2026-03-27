const socket = io();

const menu = document.getElementById('menu');
const startBtn = document.getElementById('startBtn');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const winText = document.getElementById('winText');

let myId = null;
let gameState = { players: {}, bullets: [], mapObjects: [] };
let currentMap = 'desert';

const WORLD_WIDTH = 2000;
const WORLD_HEIGHT = 2000;
let camera = { x: 0, y: 0 };
let keys = { w: false, a: false, s: false, d: false };
let mouseX = 0, mouseY = 0;

socket.on('connect', () => { myId = socket.id; });
socket.on('state', (state) => { gameState = state; });
socket.on('winMessage', () => { winText.style.display = 'block'; });

startBtn.addEventListener('click', () => {
    const tankType = document.getElementById('tankSelect').value;
    currentMap = document.getElementById('mapSelect').value;
    menu.style.display = 'none';
    canvas.style.display = 'block';
    resizeCanvas();
    socket.emit('join', { type: tankType, map: currentMap });
    requestAnimationFrame(draw);
});

window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) { keys[key] = true; socket.emit('input', keys); }
    if (e.code === 'Space') socket.emit('shoot');
});

window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) { keys[key] = false; socket.emit('input', keys); }
});

window.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });
window.addEventListener('mousedown', (e) => { if (e.button === 0) socket.emit('shoot'); });
window.addEventListener('resize', resizeCanvas);
function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }

// Проверка: находится ли танк в кустах
function isInBush(tank) {
    if (!gameState.mapObjects) return false;
    let tankRect = { x: tank.x - 20, y: tank.y - 20, w: 40, h: 40 };
    return gameState.mapObjects.some(obj => 
        obj.type === 'bush' && 
        tankRect.x < obj.x + obj.w && tankRect.x + tankRect.w > obj.x &&
        tankRect.y < obj.y + obj.h && tankRect.y + tankRect.h > obj.y
    );
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let me = gameState.players[myId];
    
    if (me && !me.isDead) {
        camera.x = Math.max(0, Math.min(me.x - canvas.width / 2, WORLD_WIDTH - canvas.width));
        camera.y = Math.max(0, Math.min(me.y - canvas.height / 2, WORLD_HEIGHT - canvas.height));
        let dx = mouseX - (me.x - camera.x);
        let dy = mouseY - (me.y - camera.y);
        socket.emit('aim', Math.atan2(dy, dx));
    }

    drawBackground();

    // 1. Рисуем воду, стены и дерево (под танками)
    if (gameState.mapObjects) {
        gameState.mapObjects.forEach(obj => {
            if (obj.type === 'bush') return; // Кусты рисуем потом!
            ctx.save();
            ctx.translate(obj.x - camera.x, obj.y - camera.y);
            if (obj.type === 'wall') ctx.fillStyle = '#7f8c8d'; // Серый
            if (obj.type === 'water') ctx.fillStyle = '#3498db'; // Синий
            if (obj.type === 'wood') ctx.fillStyle = '#d35400'; // Коричневый
            ctx.fillRect(0, 0, obj.w, obj.h);
            
            // Обводка для красоты
            ctx.strokeStyle = 'rgba(0,0,0,0.5)';
            ctx.lineWidth = 2;
            ctx.strokeRect(0, 0, obj.w, obj.h);
            ctx.restore();
        });
    }

    // 2. Рисуем танки
    for (let id in gameState.players) {
        let p = gameState.players[id];
        if (p.isDead) continue;

        let hiddenByBush = isInBush(p);
        
        // Магия: Если враг в кустах - пропускаем его отрисовку!
        if (hiddenByBush && id !== myId) continue;

        let drawX = p.x - camera.x;
        let drawY = p.y - camera.y;

        ctx.save();
        ctx.translate(drawX, drawY);

        // Если это мы, и мы в кустах - делаем себя полупрозрачным
        if (hiddenByBush && id === myId) ctx.globalAlpha = 0.5;

        ctx.fillStyle = p.color; ctx.fillRect(-20, -20, 40, 40);
        ctx.rotate(p.turretAngle);
        ctx.fillStyle = '#555'; ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#222'; ctx.fillRect(0, -4, 35, 8);
        ctx.restore();

        ctx.fillStyle = 'red'; ctx.fillRect(drawX - 20, drawY - 35, 40, 5);
        ctx.fillStyle = '#2ecc71'; ctx.fillRect(drawX - 20, drawY - 35, 40 * (p.hp / p.maxHp), 5);
        ctx.fillStyle = 'white'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(id === myId ? 'ТЫ' : 'ВРАГ', drawX, drawY - 45);
    }

    // 3. Рисуем кусты (ПОВЕРХ танков, чтобы их прятать)
    if (gameState.mapObjects) {
        gameState.mapObjects.forEach(obj => {
            if (obj.type === 'bush') {
                ctx.save();
                ctx.translate(obj.x - camera.x, obj.y - camera.y);
                ctx.fillStyle = 'rgba(39, 174, 96, 0.8)'; // Полупрозрачный зеленый
                ctx.fillRect(0, 0, obj.w, obj.h);
                // Фейковая текстура листиков
                ctx.fillStyle = 'rgba(46, 204, 113, 0.9)';
                ctx.fillRect(10, 10, obj.w - 20, obj.h - 20);
                ctx.restore();
            }
        });
    }

    // 4. Рисуем пули (самые верхние)
    ctx.fillStyle = '#f1c40f';
    gameState.bullets.forEach(b => {
        ctx.beginPath(); ctx.arc(b.x - camera.x, b.y - camera.y, 5, 0, Math.PI * 2); ctx.fill();
    });

    if (me && !me.isDead) drawMiniMap();
    requestAnimationFrame(draw);
}

function drawBackground() {
    ctx.fillStyle = currentMap === 'desert' ? '#e6c280' : '#bdc3c7';
    ctx.fillRect(-camera.x, -camera.y, WORLD_WIDTH, WORLD_HEIGHT);
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    for (let i = 0; i <= WORLD_WIDTH; i += 100) {
        ctx.beginPath(); ctx.moveTo(i - camera.x, -camera.y); ctx.lineTo(i - camera.x, WORLD_HEIGHT - camera.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-camera.x, i - camera.y); ctx.lineTo(WORLD_WIDTH - camera.x, i - camera.y); ctx.stroke();
    }
    ctx.strokeStyle = 'red'; ctx.lineWidth = 4; ctx.strokeRect(-camera.x, -camera.y, WORLD_WIDTH, WORLD_HEIGHT);
}

function drawMiniMap() {
    const mmSize = 150; const mmScale = mmSize / WORLD_WIDTH;
    const mmX = canvas.width - mmSize - 20; const mmY = 20;
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'; ctx.fillRect(mmX, mmY, mmSize, mmSize);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(mmX, mmY, mmSize, mmSize);

    for (let id in gameState.players) {
        let p = gameState.players[id];
        if (!p.isDead) {
            ctx.fillStyle = id === myId ? '#2ecc71' : '#e74c3c';
            ctx.beginPath(); ctx.arc(mmX + p.x * mmScale, mmY + p.y * mmScale, 4, 0, Math.PI * 2); ctx.fill();
        }
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'; ctx.lineWidth = 1;
    ctx.strokeRect(mmX + camera.x * mmScale, mmY + camera.y * mmScale, canvas.width * mmScale, canvas.height * mmScale);
}
