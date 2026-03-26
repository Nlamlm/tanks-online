
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// Указываем серверу раздавать файлы из нашей папки public
app.use(express.static(path.join(__dirname, 'public')));

// Размеры мира (должны совпадать с тем, что в client.js)
const WORLD_WIDTH = 2000;
const WORLD_HEIGHT = 2000;

let players = {};
let bullets = [];

io.on('connection', (socket) => {
    console.log('Новый танкист прибыл на базу: ' + socket.id);

    // Игрок нажал "В БОЙ"
    socket.on('join', (data) => {
        // Настраиваем характеристики в зависимости от выбранного танка
        let isHeavy = data.type === 'heavy';
        let speed = isHeavy ? 3 : 6;
        let hp = isHeavy ? 200 : 100;
        let color = isHeavy ? '#2c3e50' : '#2980b9'; // Темно-синий или светло-синий

        // Спавним танк в случайном месте карты
        players[socket.id] = {
            x: Math.random() * (WORLD_WIDTH - 100) + 50,
            y: Math.random() * (WORLD_HEIGHT - 100) + 50,
            turretAngle: 0,
            speed: speed,
            hp: hp,
            maxHp: hp,
            color: color,
            isDead: false,
            keys: { w: false, a: false, s: false, d: false },
            lastShot: 0 // Чтобы не стреляли как из пулемета
        };
    });

    // Получаем нажатия клавиш WASD
    socket.on('input', (keys) => {
        if (players[socket.id] && !players[socket.id].isDead) {
            players[socket.id].keys = keys;
        }
    });

    // Получаем угол поворота башни (от мышки)
    socket.on('aim', (angle) => {
        if (players[socket.id] && !players[socket.id].isDead) {
            players[socket.id].turretAngle = angle;
        }
    });

    // Игрок выстрелил
    socket.on('shoot', () => {
        let p = players[socket.id];
        let now = Date.now();
        
        // Ограничение: 1 выстрел в полсекунды (500 мс)
        if (p && !p.isDead && now - p.lastShot > 500) { 
            bullets.push({
                x: p.x + Math.cos(p.turretAngle) * 40,
                y: p.y + Math.sin(p.turretAngle) * 40,
                vx: Math.cos(p.turretAngle) * 15, // Скорость пули по X
                vy: Math.sin(p.turretAngle) * 15, // Скорость пули по Y
                ownerId: socket.id
            });
            p.lastShot = now;
        }
    });

    // Игрок закрыл вкладку
    socket.on('disconnect', () => {
        console.log('Танкист покинул поле боя: ' + socket.id);
        delete players[socket.id];
    });
});

// --- ГЛАВНЫЙ ИГРОВОЙ ЦИКЛ (работает 60 раз в секунду) ---
setInterval(() => {
    let aliveCount = 0;
    let lastAliveId = null;

    // 1. Двигаем танки
    for (let id in players) {
        let p = players[id];
        if (p.isDead) continue;
        
        aliveCount++;
        lastAliveId = id;

        if (p.keys.w) p.y -= p.speed;
        if (p.keys.s) p.y += p.speed;
        if (p.keys.a) p.x -= p.speed;
        if (p.keys.d) p.x += p.speed;

        // Ограничиваем выезд за края карты
        p.x = Math.max(20, Math.min(WORLD_WIDTH - 20, p.x));
        p.y = Math.max(20, Math.min(WORLD_HEIGHT - 20, p.y));
    }

    // 2. Логика победы
    // Если на сервере больше 1 игрока, но живой остался только 1
    if (Object.keys(players).length > 1 && aliveCount === 1 && lastAliveId) {
        io.to(lastAliveId).emit('winMessage'); // Отправляем победителю надпись!
    }

    // 3. Двигаем пули и проверяем попадания
    for (let i = bullets.length - 1; i >= 0; i--) {
        let b = bullets[i];
        b.x += b.vx;
        b.y += b.vy;

        // Удаляем пули, улетевшие за пределы карты
        if (b.x < 0 || b.x > WORLD_WIDTH || b.y < 0 || b.y > WORLD_HEIGHT) {
            bullets.splice(i, 1);
            continue;
        }

        // Проверяем, попала ли пуля в танк
        let hit = false;
        for (let id in players) {
            let p = players[id];
            
            // Своя пуля не наносит урон себе, и мы не бьем мертвых
            if (id !== b.ownerId && !p.isDead) {
                // Вычисляем расстояние от пули до центра танка
                let dist = Math.hypot(p.x - b.x, p.y - b.y);
                if (dist < 25) { // 25 - радиус танка для получения урона
                    p.hp -= 25; // Наносим 25 урона
                    hit = true;
                    
                    if (p.hp <= 0) {
                        p.isDead = true;
                        p.hp = 0;
                    }
                    break; // Пуля пропадает после первого же попадания
                }
            }
        }
        
        if (hit) bullets.splice(i, 1);
    }

    // 4. Отправляем обновленные координаты всем игрокам
    io.emit('state', { players, bullets });
}, 1000 / 60);

// Запускаем сервер
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`[СЕРВЕР ЗАПУЩЕН] Заходи на http://localhost:${PORT}`);
});
