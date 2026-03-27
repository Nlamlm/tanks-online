const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const WORLD_WIDTH = 2000;
const WORLD_HEIGHT = 2000;

let players = {};
let bullets = [];

// --- НАША КАРТА (Препятствия) ---
let mapObjects = [
    { id: 1, x: 400, y: 400, w: 200, h: 50, type: 'wall' },   // Стена
    { id: 2, x: 800, y: 600, w: 50, h: 300, type: 'wall' },   // Стена
    { id: 3, x: 1200, y: 300, w: 300, h: 200, type: 'water' },// Вода
    { id: 4, x: 600, y: 800, w: 100, h: 100, type: 'wood' },  // Дерево
    { id: 5, x: 700, y: 800, w: 100, h: 100, type: 'wood' },  // Дерево
    { id: 6, x: 1000, y: 900, w: 200, h: 150, type: 'bush' }, // Кусты
    { id: 7, x: 300, y: 1200, w: 300, h: 200, type: 'bush' }  // Кусты
];

// Функция проверки столкновений
function checkCollision(rect1, rect2) {
    return (rect1.x < rect2.x + rect2.w &&
            rect1.x + rect1.w > rect2.x &&
            rect1.y < rect2.y + rect2.h &&
            rect1.y + rect1.h > rect2.y);
}

io.on('connection', (socket) => {
    socket.on('join', (data) => {
        let isHeavy = data.type === 'heavy';
        players[socket.id] = {
            x: Math.random() * (WORLD_WIDTH - 100) + 50,
            y: Math.random() * (WORLD_HEIGHT - 100) + 50,
            turretAngle: 0,
            speed: isHeavy ? 3 : 6,
            hp: isHeavy ? 200 : 100, maxHp: isHeavy ? 200 : 100,
            color: isHeavy ? '#2c3e50' : '#2980b9',
            isDead: false, keys: { w: false, a: false, s: false, d: false },
            lastShot: 0
        };
    });

    socket.on('input', (keys) => { if (players[socket.id] && !players[socket.id].isDead) players[socket.id].keys = keys; });
    socket.on('aim', (angle) => { if (players[socket.id] && !players[socket.id].isDead) players[socket.id].turretAngle = angle; });
    
    socket.on('shoot', () => {
        let p = players[socket.id];
        let now = Date.now();
        if (p && !p.isDead && now - p.lastShot > 500) { 
            bullets.push({
                x: p.x + Math.cos(p.turretAngle) * 40, y: p.y + Math.sin(p.turretAngle) * 40,
                vx: Math.cos(p.turretAngle) * 15, vy: Math.sin(p.turretAngle) * 15,
                ownerId: socket.id
            });
            p.lastShot = now;
        }
    });
    socket.on('disconnect', () => { delete players[socket.id]; });
});

setInterval(() => {
    let aliveCount = 0; let lastAliveId = null;

    // 1. Двигаем танки и проверяем столкновения
    for (let id in players) {
        let p = players[id];
        if (p.isDead) continue;
        aliveCount++; lastAliveId = id;

        let oldX = p.x; let oldY = p.y; // Сохраняем старые координаты

        if (p.keys.w) p.y -= p.speed;
        if (p.keys.s) p.y += p.speed;
        if (p.keys.a) p.x -= p.speed;
        if (p.keys.d) p.x += p.speed;

        p.x = Math.max(20, Math.min(WORLD_WIDTH - 20, p.x));
        p.y = Math.max(20, Math.min(WORLD_HEIGHT - 20, p.y));

        let tankRect = { x: p.x - 20, y: p.y - 20, w: 40, h: 40 };
        for (let i = mapObjects.length - 1; i >= 0; i--) {
            let obj = mapObjects[i];
            if (checkCollision(tankRect, obj)) {
                if (obj.type === 'wall' || obj.type === 'water') {
                    p.x = oldX; p.y = oldY; // Отбрасываем назад (не пускаем)
                } else if (obj.type === 'wood') {
                    mapObjects.splice(i, 1); // Ломаем дерево тараном!
                }
            }
        }
    }

    if (Object.keys(players).length > 1 && aliveCount === 1 && lastAliveId) {
        io.to(lastAliveId).emit('winMessage');
    }

    // 2. Двигаем пули и проверяем попадания в карту
    for (let i = bullets.length - 1; i >= 0; i--) {
        let b = bullets[i];
        b.x += b.vx; b.y += b.vy;

        if (b.x < 0 || b.x > WORLD_WIDTH || b.y < 0 || b.y > WORLD_HEIGHT) { bullets.splice(i, 1); continue; }

        let bulletRect = { x: b.x - 5, y: b.y - 5, w: 10, h: 10 };
        let bulletDestroyed = false;

        for (let j = mapObjects.length - 1; j >= 0; j--) {
            let obj = mapObjects[j];
            if (checkCollision(bulletRect, obj)) {
                if (obj.type === 'wall') {
                    bulletDestroyed = true; break; // Разбивается о стену
                } else if (obj.type === 'wood') {
                    mapObjects.splice(j, 1); // Уничтожает ящик
                    bulletDestroyed = true; break; // И сама пропадает
                }
            }
        }

        if (bulletDestroyed) { bullets.splice(i, 1); continue; }

        // Попадание в танк
        let hit = false;
        for (let id in players) {
            let p = players[id];
            if (id !== b.ownerId && !p.isDead) {
                if (Math.hypot(p.x - b.x, p.y - b.y) < 25) {
                    p.hp -= 25; hit = true;
                    if (p.hp <= 0) p.isDead = true;
                    break;
                }
            }
        }
        if (hit) bullets.splice(i, 1);
    }

    // ОТПРАВЛЯЕМ КАРТУ ТОЖЕ
    io.emit('state', { players, bullets, mapObjects });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`[СЕРВЕР ЗАПУЩЕН] Порт ${PORT}`); });
