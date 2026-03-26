// Подключаемся к серверу через Socket.io
const socket = io();

const menu = document.getElementById('menu');
const startBtn = document.getElementById('startBtn');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const winText = document.getElementById('winText');

let myId = null;
let gameState = { players: {}, bullets: [] };
let currentMap = 'desert';

// Размеры игрового мира (должны совпадать с настройками сервера)
const WORLD_WIDTH = 2000;
const WORLD_HEIGHT = 2000;

// Камера (чтобы экран ездил за твоим танком)
let camera = { x: 0, y: 0 };

// Состояние управления
let keys = { w: false, a: false, s: false, d: false };
let mouseX = 0, mouseY = 0;

// Получаем свой ID при подключении
socket.on('connect', () => {
    myId = socket.id;
});

// Нажатие кнопки "В БОЙ"
startBtn.addEventListener('click', () => {
    const tankType = document.getElementById('tankSelect').value;
    currentMap = document.getElementById('mapSelect').value;
    
    menu.style.display = 'none';
    canvas.style.display = 'block';
    
    resizeCanvas();
    
    // Отправляем на сервер инфу, что мы зашли
    socket.emit('join', { type: tankType, map: currentMap });
    
    // Запускаем бесконечный цикл отрисовки игры
    requestAnimationFrame(draw);
});

// Сервер присылает нам новые координаты всех танков и пуль 60 раз в секунду
socket.on('state', (state) => {
    gameState = state;
});

// Сервер говорит, что мы остались одни и победили
socket.on('winMessage', () => {
    winText.style.display = 'block';
});

// --- УПРАВЛЕНИЕ (WASD и Мышь) ---

window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) {
        keys[key] = true;
        socket.emit('input', keys);
    }
    if (e.code === 'Space') socket.emit('shoot'); // Пробел - выстрел
});

window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) {
        keys[key] = false;
        socket.emit('input', keys);
    }
});

window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
});

window.addEventListener('mousedown', (e) => {
    if (e.button === 0) socket.emit('shoot'); // ЛКМ - выстрел
});

// Подгоняем размер холста под экран
window.addEventListener('resize', resizeCanvas);
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

// --- ОТРИСОВКА ГРАФИКИ ---

function draw() {
    // 1. Очищаем экран перед новым кадром
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let me = gameState.players[myId];
    
    // 2. Настраиваем камеру и прицел
    if (me && !me.isDead) {
        // Центрируем камеру на нашем танке
        camera.x = me.x - canvas.width / 2;
        camera.y = me.y - canvas.height / 2;

        // Не даем камере вылетать за края карты
        camera.x = Math.max(0, Math.min(camera.x, WORLD_WIDTH - canvas.width));
        camera.y = Math.max(0, Math.min(camera.y, WORLD_HEIGHT - canvas.height));

        // Считаем угол поворота башни за мышкой и отправляем на сервер
        let dx = mouseX - (me.x - camera.x);
        let dy = mouseY - (me.y - camera.y);
        socket.emit('aim', Math.atan2(dy, dx));
    }

    // 3. Рисуем карту (фон)
    drawBackground();

    // 4. Рисуем все танки
    for (let id in gameState.players) {
        let p = gameState.players[id];
        if (p.isDead) continue;

        let drawX = p.x - camera.x;
        let drawY = p.y - camera.y;

        ctx.save();
        ctx.translate(drawX, drawY);

        // Корпус танка
        ctx.fillStyle = p.color;
        ctx.fillRect(-20, -20, 40, 40);

        // Башня и дуло (крутятся за мышкой)
        ctx.rotate(p.turretAngle);
        ctx.fillStyle = '#555';
        ctx.beginPath();
        ctx.arc(0, 0, 15, 0, Math.PI * 2); // Башня
        ctx.fill();
        ctx.fillStyle = '#222';
        ctx.fillRect(0, -4, 35, 8); // Дуло
        ctx.restore();

// Полоска ХП (Здоровье)
        ctx.fillStyle = 'red';
        ctx.fillRect(drawX - 20, drawY - 35, 40, 5);
        ctx.fillStyle = '#2ecc71';
        ctx.fillRect(drawX - 20, drawY - 35, 40 * (p.hp / p.maxHp), 5);
        
        // Подпись (Ты или Враг)
        ctx.fillStyle = 'white';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(id === myId ? 'ТЫ' : 'ВРАГ', drawX, drawY - 45);
    }

    // 5. Рисуем летящие пули
    ctx.fillStyle = '#f1c40f'; // Золотые пули
    gameState.bullets.forEach(b => {
        ctx.beginPath();
        ctx.arc(b.x - camera.x, b.y - camera.y, 5, 0, Math.PI * 2);
        ctx.fill();
    });

    // 6. Рисуем миникарту поверх всего
    if (me && !me.isDead) drawMiniMap();

    // Запрашиваем следующий кадр (60 раз в секунду)
    requestAnimationFrame(draw);
}

function drawBackground() {
    // Цвет зависит от выбранной карты
    ctx.fillStyle = currentMap === 'desert' ? '#e6c280' : '#7f8c8d';
    ctx.fillRect(-camera.x, -camera.y, WORLD_WIDTH, WORLD_HEIGHT);

    // Рисуем сетку для ощущения движения
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    for (let i = 0; i <= WORLD_WIDTH; i += 100) {
        ctx.beginPath(); ctx.moveTo(i - camera.x, -camera.y); ctx.lineTo(i - camera.x, WORLD_HEIGHT - camera.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-camera.x, i - camera.y); ctx.lineTo(WORLD_WIDTH - camera.x, i - camera.y); ctx.stroke();
    }
    
    // Красная граница края карты
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 4;
    ctx.strokeRect(-camera.x, -camera.y, WORLD_WIDTH, WORLD_HEIGHT);
}

function drawMiniMap() {
    const mmSize = 150;
    const mmScale = mmSize / WORLD_WIDTH;
    const mmX = canvas.width - mmSize - 20;
    const mmY = 20;
    
    // Темный фон миникарты
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(mmX, mmY, mmSize, mmSize);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(mmX, mmY, mmSize, mmSize);

    // Точки танков на миникарте
    for (let id in gameState.players) {
        let p = gameState.players[id];
        if (!p.isDead) {
            ctx.fillStyle = id === myId ? '#2ecc71' : '#e74c3c'; // Зеленый - ты, Красный - враги
            ctx.beginPath();
            ctx.arc(mmX + p.x * mmScale, mmY + p.y * mmScale, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    
    // Рисуем белый прямоугольник — это то, что видит твоя камера сейчас
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mmX + camera.x * mmScale, mmY + camera.y * mmScale, canvas.width * mmScale, canvas.height * mmScale);
}