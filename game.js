document.addEventListener('DOMContentLoaded', () => {

    // --- DOM Elements ---
    const mainMenu = document.getElementById('main-menu');
    const startButton = document.getElementById('start-button');
    const gameContainer = document.getElementById('game-container');
    const gameWorld = document.getElementById('game-world');
    const elixirBar = document.getElementById('elixir-bar');
    const elixirText = document.getElementById('elixir-text');
    const cardHandContainer = document.getElementById('card-hand');
    const gameOverOverlay = document.getElementById('game-over-overlay');
    const gameOverMessage = document.getElementById('game-over-message');
    const restartButton = document.getElementById('restart-button');
    // NEW: Next Card UI
    const nextCardPreview = document.getElementById('next-card-preview');

    // --- Game State Variables ---
    let playerElixir = 5;
    let maxElixir = 10;
    let elixirRegenRate = 0.0055; // SLOWED DOWN: ~1 elixir per 3 seconds
    let gameRunning = false;
    let units = [];
    let projectiles = [];
    let towers = [];
    let unitIdCounter = 0;
    let gameTime = 0;
    let enemyPlayTimer = 0;
    let enemyPlayInterval = 300;

    // NEW: Placement Mode State
    let selectedCardData = null;
    let selectedCardIndex = -1;
    let placementMode = false;

    // --- Sound Engine (using Tone.js) ---
    let sounds = {};
    let audioStarted = false;

    async function initAudio() {
        if (audioStarted) return;
        if (typeof Tone === 'undefined') {
            console.warn("Tone.js not loaded.");
            return;
        }
        
        await Tone.start();
        console.log('Audio Context Started');
        
        sounds = {
            spawn: new Tone.Synth().toDestination(),
            hit: new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.01, decay: 0.1, sustain: 0 } }).toDestination(),
            spell: new Tone.MembraneSynth().toDestination(),
            towerDestroy: new Tone.MembraneSynth({ pitchDecay: 0.1, octaves: 5 }).toDestination(),
            error: new Tone.Synth({ envelope: { attack: 0.01, decay: 0.2, release: 0.2 } }).toDestination()
        };
        audioStarted = true;
    }

    function playSound(sound, note = null, duration = '8n') {
        if (!audioStarted || !sounds[sound]) return;
        try {
            if (sound === 'spawn') {
                sounds.spawn.triggerAttackRelease(note || 'C4', duration);
            } else if (sound === 'hit') {
                sounds.hit.triggerAttackRelease(duration);
            } else if (sound === 'spell') {
                sounds.spell.triggerAttackRelease('C2', '4n');
            } else if (sound === 'towerDestroy') {
                sounds.towerDestroy.triggerAttackRelease('G1', '2n');
            } else if (sound === 'error') {
                sounds.error.triggerAttackRelease('C3', '8n');
            }
        } catch (e) {
            console.error("Error playing sound:", e);
        }
    }

    // --- NEW: SVG Graphics Definitions ---
    // We define these here so card definitions and unit classes can use them.
    const SVGs = {
        knight: `<svg viewBox="0 0 100 100"><path fill="currentColor" d="M50 10 L80 25 L80 55 L50 85 L20 55 L20 25 Z M50 20 L50 75 L70 50 L70 30 Z"></path><path fill="currentColor" d="M45 15 L55 15 L55 80 L45 80 Z" transform="rotate(0 50 50)"></path></svg>`,
        archer: `<svg viewBox="0 0 100 100"><path fill="none" stroke="currentColor" stroke-width="8" d="M50 10 C70 30, 70 70, 50 90"></path><path fill="currentColor" d="M45 8 L55 8 L55 92 L45 92 Z"></path><path fill="currentColor" d="M50 48 L90 48 L80 43 L80 53 Z"></path></svg>`,
        giant: `<svg viewBox="0 0 100 100"><path fill="currentColor" d="M30 70 C10 70, 10 40, 30 40 L40 40 L40 30 C40 20, 50 10, 60 10 L70 10 C80 10, 90 20, 90 30 L90 60 C90 80, 80 90, 70 90 L30 90 Z M40 60 L70 60 L70 70 L40 70 Z"></path></svg>`,
        fireball: `<svg viewBox="0 0 100 100"><path fill="currentColor" d="M50 90 C30 90, 20 70, 30 50 C10 50, 20 20, 40 10 C50 30, 60 30, 70 10 C90 20, 100 50, 70 50 C80 70, 70 90, 50 90 Z"></path></svg>`
    };

    // --- Card & Deck Definitions ---
    const cardDefinitions = {
        knight: { name: 'Knight', cost: 3, type: 'unit', unitType: 'Knight', svg: SVGs.knight },
        archer: { name: 'Archer', cost: 3, type: 'unit', unitType: 'Archer', svg: SVGs.archer },
        giant: { name: 'Giant', cost: 5, type: 'unit', unitType: 'Giant', svg: SVGs.giant },
        fireball: { name: 'Fireball', cost: 4, type: 'spell', spellType: 'Fireball', svg: SVGs.fireball }
    };
    
    let playerDeck = [];
    let playerHand = [];

    // --- Utility Functions ---
    const getDistance = (obj1, obj2) => {
        const dx = obj1.x - obj2.x;
        const dy = obj1.y - obj2.y;
        return Math.sqrt(dx * dx + dy * dy);
    };

    const getRect = (element) => {
        const containerRect = gameContainer.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        return {
            left: rect.left - containerRect.left,
            top: rect.top - containerRect.top,
            width: rect.width,
            height: rect.height
        };
    };
    
    // --- Base Class: Entity (Units & Towers) ---
    class Entity {
        constructor(id, team, hp, element) {
            this.id = id;
            this.team = team;
            this.hp = hp;
            this.maxHp = hp;
            this.element = element;
            this.target = null;
            
            this.hpBarElement = document.createElement('div');
            this.hpBarElement.className = 'hp-bar';
            this.hpBarInner = document.createElement('div');
            this.hpBarInner.className = 'hp-bar-inner';
            this.hpBarElement.appendChild(this.hpBarInner);
            this.element.appendChild(this.hpBarElement);
            
            const rect = getRect(this.element);
            this.x = rect.left + rect.width / 2;
            this.y = rect.top + rect.height / 2;
        }

        updateHPBar() {
            const hpPercent = Math.max(0, (this.hp / this.maxHp) * 100);
            this.hpBarInner.style.width = `${hpPercent}%`;
        }

        takeDamage(amount) {
            if (this.hp <= 0) return;
            this.hp -= amount;
            this.updateHPBar();
            playSound('hit');
            
            this.element.classList.add('damage-flash');
            setTimeout(() => {
                this.element.classList.remove('damage-flash');
            }, 200);

            if (this.hp <= 0) {
                this.die();
            }
        }

        die() {
            this.element.remove();
            
            if (this instanceof Tower) {
                playSound('towerDestroy');
                towers = towers.filter(t => t.id !== this.id);
                if (this.isKingTower) {
                    endGame(this.team === 'player' ? 'enemy' : 'player');
                }
            } else {
                units = units.filter(u => u.id !== this.id);
            }
        }

        findTarget(allEntities) {
            let closestTarget = null;
            let minDistance = Infinity;

            for (const entity of allEntities) {
                if (entity.team !== this.team && entity.hp > 0) {
                    if (this.targetType === 'building') {
                        if (!(entity instanceof Tower)) {
                            continue; 
                        }
                    }
                    const distance = getDistance(this, entity);
                    if (distance < minDistance && distance < this.aggroRange) {
                        minDistance = distance;
                        closestTarget = entity;
                    }
                }
            }
            this.target = closestTarget;
        }
        
        updatePosition() {
            const rect = getRect(this.element);
            this.x = rect.left + rect.width / 2;
            this.y = rect.top + rect.height / 2;
        }

        update() {
            this.updatePosition();
        }
    }
    
    // --- Tower Class ---
    class Tower extends Entity {
        constructor(id, team, hp, element, isKingTower = false) {
            super(id, team, hp, element);
            this.isKingTower = isKingTower;
            this.attackRange = 150;
            this.aggroRange = 150;
            this.attackSpeed = 1000;
            this.damage = 15;
            this.attackCooldown = 0;
            this.targetType = 'groundAndAir';
            this.activated = !isKingTower; 
        }
        
        update(gameTime) {
            super.update();
            if (this.hp <= 0) return;
            
            if (this.isKingTower && !this.activated) {
                const princessTowers = towers.filter(t => t.team === this.team && !t.isKingTower);
                if (princessTowers.length < 2) this.activated = true;
                if (this.hp < this.maxHp) this.activated = true;
                if (!this.activated) return;
            }
            
            if (!this.target || this.target.hp <= 0 || getDistance(this, this.target) > this.attackRange) {
                this.findTarget(units);
            }
            
            if (this.attackCooldown > 0) {
                this.attackCooldown -= 1000 / 60;
            }

            if (this.target && this.attackCooldown <= 0) {
                this.attack();
                this.attackCooldown = this.attackSpeed;
            }
        }
        
        findTarget(allUnits) {
            let closestTarget = null;
            let minDistance = Infinity;

            for (const unit of allUnits) {
                if (unit.team !== this.team && unit.hp > 0) {
                    const distance = getDistance(this, unit);
                    if (distance < minDistance && distance < this.aggroRange) {
                        minDistance = distance;
                        closestTarget = unit;
                    }
                }
            }
            this.target = closestTarget;
        }

        attack() {
            if (!this.target) return;
            const projectile = new Projectile(
                `proj_${unitIdCounter++}`,
                this.team,
                this.damage,
                this.x,
                this.y,
                this.target
            );
            projectiles.push(projectile);
        }
    }

    // --- Unit Class ---
    class Unit extends Entity {
        constructor(id, team, hp, element, x, y, stats) {
            super(id, team, hp, element);
            
            const containerRect = gameContainer.getBoundingClientRect();
            const worldRect = gameWorld.getBoundingClientRect();
            const initialX = x - (worldRect.left - containerRect.left) - (element.offsetWidth / 2);
            const initialY = y - (worldRect.top - containerRect.top) - (element.offsetHeight / 2);

            this.element.style.transform = `translate(${initialX}px, ${initialY}px)`;
            this.x = x;
            this.y = y;
            this.speed = stats.speed;
            this.attackRange = stats.attackRange;
            this.aggroRange = stats.aggroRange;
            this.attackSpeed = stats.attackSpeed;
            this.damage = stats.damage;
            this.targetType = stats.targetType;
            this.attackCooldown = 0;
        }
        
        update(gameTime) {
            if (this.hp <= 0) return;

            if (!this.target || this.target.hp <= 0 || getDistance(this, this.target) > this.aggroRange) {
                const allTargets = [...units, ...towers];
                this.findTarget(allTargets);
                
                if (!this.target) {
                    this.target = (this.team === 'player') ? 
                        towers.find(t => t.id === 'enemy-king') : 
                        towers.find(t => t.id === 'player-king');
                }
            }
            
            if (this.attackCooldown > 0) {
                this.attackCooldown -= 1000 / 60;
            }
            
            if (this.target && this.target.hp > 0) {
                const distance = getDistance(this, this.target);
                if (distance <= this.attackRange) {
                    if (this.attackCooldown <= 0) {
                        this.attack();
                        this.attackCooldown = this.attackSpeed;
                    }
                } else {
                    this.move();
                }
            }
        }
        
        move() {
            if (!this.target) return;
            
            const dx = this.target.x - this.x;
            const dy = this.target.y - this.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            const moveX = (dx / distance) * this.speed;
            const moveY = (dy / distance) * this.speed;

            this.x += moveX;
            this.y += moveY;
            
            const containerRect = gameContainer.getBoundingClientRect();
            const worldRect = gameWorld.getBoundingClientRect();
            const elX = this.x - (worldRect.left - containerRect.left) - (this.element.offsetWidth / 2);
            const elY = this.y - (worldRect.top - containerRect.top) - (this.element.offsetHeight / 2);
            
            this.element.style.transform = `translate(${elX}px, ${elY}px)`;
        }

        attack() { /* Overridden by subclasses */ }
    }

    // --- Specific Unit Classes ---
    class Knight extends Unit {
        constructor(id, team, x, y) {
            const stats = {
                speed: 1.5,
                attackRange: 30,
                aggroRange: 100,
                attackSpeed: 1000,
                damage: 30,
                targetType: 'groundAndAir'
            };
            const element = document.createElement('div');
            element.className = `unit ${team} knight`;
            element.innerHTML = cardDefinitions.knight.svg; // Use SVG
            gameWorld.appendChild(element);
            super(id, team, 300, element, x, y, stats);
        }
        
        attack() {
            if (this.target && this.target.hp > 0) {
                this.target.takeDamage(this.damage);
            }
        }
    }

    class Archer extends Unit {
        constructor(id, team, x, y) {
            const stats = {
                speed: 1.5,
                attackRange: 120,
                aggroRange: 130,
                attackSpeed: 800,
                damage: 15,
                targetType: 'groundAndAir'
            };
            const element = document.createElement('div');
            element.className = `unit ${team} archer`;
            element.innerHTML = cardDefinitions.archer.svg; // Use SVG
            gameWorld.appendChild(element);
            super(id, team, 150, element, x, y, stats);
        }
        
        attack() {
            if (!this.target) return;
            const projectile = new Projectile(
                `proj_${unitIdCounter++}`,
                this.team,
                this.damage,
                this.x,
                this.y,
                this.target
            );
            projectiles.push(projectile);
        }
    }
    
    class Giant extends Unit {
        constructor(id, team, x, y) {
            const stats = {
                speed: 1,
                attackRange: 35,
                aggroRange: 100,
                attackSpeed: 1500,
                damage: 50,
                targetType: 'building'
            };
            const element = document.createElement('div');
            element.className = `unit ${team} giant`;
            element.innerHTML = cardDefinitions.giant.svg; // Use SVG
            gameWorld.appendChild(element);
            super(id, team, 700, element, x, y, stats);
        }
        
        attack() {
            if (this.target && this.target.hp > 0) {
                this.target.takeDamage(this.damage);
            }
        }
    }
    
    // --- Projectile Class ---
    class Projectile {
        constructor(id, team, damage, startX, startY, target) {
            this.id = id;
            this.team = team;
            this.damage = damage;
            this.x = startX;
            this.y = startY;
            this.target = target;
            
            this.element = document.createElement('div');
            this.element.className = `projectile ${team}`;
            
            const containerRect = gameContainer.getBoundingClientRect();
            const worldRect = gameWorld.getBoundingClientRect();
            const elX = this.x - (worldRect.left - containerRect.left) - 5;
            const elY = this.y - (worldRect.top - containerRect.top) - 5;
            this.element.style.transform = `translate(${elX}px, ${elY}px)`;
            
            gameWorld.appendChild(this.element);
        }
        
        update() {
            if (!this.target || this.target.hp <= 0) {
                this.die();
                return;
            }
            
            const distance = getDistance(this, this.target);
            
            if (distance < 10) {
                this.target.takeDamage(this.damage);
                this.die();
                return;
            }
            
            const dx = this.target.x - this.x;
            const dy = this.target.y - this.y;
            const speed = 8;
            
            this.x += (dx / distance) * speed;
            this.y += (dy / distance) * speed;
            
            const containerRect = gameContainer.getBoundingClientRect();
            const worldRect = gameWorld.getBoundingClientRect();
            const elX = this.x - (worldRect.left - containerRect.left) - 5;
            const elY = this.y - (worldRect.top - containerRect.top) - 5;
            
            this.element.style.transform = `translate(${elX}px, ${elY}px)`;
        }
        
        die() {
            this.element.remove();
            projectiles = projectiles.filter(p => p.id !== this.id);
        }
    }

    // --- Game Setup ---
    function initGame() {
        gameWorld.innerHTML = '';
        units = [];
        projectiles = [];
        towers = [];
        
        gameRunning = true;
        playerElixir = 5;
        gameTime = 0;
        enemyPlayTimer = 0;
        gameOverOverlay.style.display = 'none';
        
        // NEW: Reset placement mode
        resetPlacement();

        towers = [
            new Tower('enemy-king', 'enemy', 2000, document.getElementById('enemy-king'), true),
            new Tower('enemy-princess-1', 'enemy', 1000, document.getElementById('enemy-princess-1')),
            new Tower('enemy-princess-2', 'enemy', 1000, document.getElementById('enemy-princess-2')),
            new Tower('player-king', 'player', 2000, document.getElementById('player-king'), true),
            new Tower('player-princess-1', 'player', 1000, document.getElementById('player-princess-1')),
            new Tower('player-princess-2', 'player', 1000, document.getElementById('player-princess-2'))
        ];
        
        towers.forEach(t => {
            t.hp = t.maxHp;
            t.updateHPBar();
            t.activated = !t.isKingTower;
        });

        playerDeck = [
            cardDefinitions.knight,
            cardDefinitions.archer,
            cardDefinitions.giant,
            cardDefinitions.fireball,
            cardDefinitions.knight,
            cardDefinitions.archer,
            cardDefinitions.giant,
            cardDefinitions.fireball,
        ].sort(() => Math.random() - 0.5);
        
        playerHand = [];
        for(let i = 0; i < 4; i++) {
            drawCard();
        }
        
        updateCardHandUI();
        updateElixirUI();
        updateNextCardUI();
    }

    // --- Card & UI Functions ---
    function drawCard() {
        if (playerHand.length < 4 && playerDeck.length > 0) {
            const cardData = playerDeck.shift();
            playerHand.push(cardData);
        }
    }
    
    function updateCardHandUI() {
        cardHandContainer.innerHTML = '';
        playerHand.forEach((cardData, index) => {
            const card = document.createElement('button');
            card.className = 'card';
            
            // Add selected class
            if (index === selectedCardIndex) {
                card.classList.add('selected');
            }

            card.innerHTML = `
                <div class="card-cost">${cardData.cost}</div>
                <div class="card-svg">
                    ${cardData.svg}
                </div>
                <div class="card-name">${cardData.name}</div>
            `;
            
            if (playerElixir < cardData.cost) {
                card.classList.add('disabled');
            }
            
            card.addEventListener('click', () => selectCard(cardData, index));
            cardHandContainer.appendChild(card);
        });
    }

    // NEW: Update Next Card UI
    function updateNextCardUI() {
        if (playerDeck.length > 0) {
            const nextCard = playerDeck[0];
            nextCardPreview.innerHTML = `
                <div class="card-cost-small">${nextCard.cost}</div>
                <div class="card-svg-small">${nextCard.svg}</div>
                <div class="card-name-small">${nextCard.name}</div>
            `;
        } else {
            nextCardPreview.innerHTML = '';
        }
    }

    // NEW: selectCard (replaces old playCard)
    function selectCard(cardData, index) {
        if (playerElixir < cardData.cost || !gameRunning) {
            playSound('error', 'C3');
            return;
        }

        // Deselect if clicking the same card
        if (index === selectedCardIndex) {
            resetPlacement();
            return;
        }

        placementMode = true;
        selectedCardData = cardData;
        selectedCardIndex = index;
        gameContainer.classList.add('placement-mode');
        
        updateCardHandUI(); // Re-render hand to show selection
    }

    // NEW: resetPlacement
    function resetPlacement() {
        placementMode = false;
        selectedCardData = null;
        selectedCardIndex = -1;
        gameContainer.classList.remove('placement-mode');
        gameContainer.classList.remove('invalid');
        updateCardHandUI(); // Re-render hand to remove selection
    }

    // NEW: handlePlacement (click on arena)
    function handlePlacement(e) {
        if (!placementMode || !selectedCardData) return;

        const rect = gameContainer.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // --- Placement Validation ---
        const riverY = gameContainer.offsetHeight / 2;
        if (y < riverY) {
            // Invalid placement (enemy side)
            playSound('error', 'C3');
            gameContainer.classList.add('invalid');
            setTimeout(() => gameContainer.classList.remove('invalid'), 200);
            return;
        }

        // --- Valid Placement, Play Card ---
        playerElixir -= selectedCardData.cost;
        
        if (selectedCardData.type === 'unit') {
            spawnUnit(selectedCardData.unitType, 'player', x, y);
        } else if (selectedCardData.type === 'spell') {
            castFireball(x, y, 'player');
        }

        // Cycle card
        const playedCard = playerHand.splice(selectedCardIndex, 1)[0];
        playerDeck.push(playedCard);
        drawCard();
        
        // Reset state
        resetPlacement();
        
        // Update UI
        updateElixirUI();
        updateNextCardUI();
    }
    
    // Add the new placement listener
    gameContainer.addEventListener('click', handlePlacement);


    // --- Spell Logic ---
    function castFireball(x, y, team) {
        playSound('spell');
        
        const effect = document.createElement('div');
        effect.className = 'spell-effect fireball';
        effect.innerHTML = cardDefinitions.fireball.svg; // Use SVG
        const containerRect = gameContainer.getBoundingClientRect();
        const worldRect = gameWorld.getBoundingClientRect();
        effect.style.transform = `translate(${x - (worldRect.left - containerRect.left) - 50}px, ${y - (worldRect.top - containerRect.top) - 50}px)`;
        
        gameWorld.appendChild(effect);
        setTimeout(() => effect.remove(), 500); 

        const allTargets = [...units, ...towers];
        const damageRadius = 50;
        const damage = 100;
        
        allTargets.forEach(target => {
            if (target.team !== team && target.hp > 0) {
                const distance = getDistance({x, y}, target);
                if (distance <= damageRadius) {
                    target.takeDamage(damage);
                }
            }
        });
    }
    
    function spawnUnit(type, team, x, y) {
        const id = `${team}_${type}_${unitIdCounter++}`;
        let unit;
        switch(type) {
            case 'Knight':
                unit = new Knight(id, team, x, y);
                playSound('spawn', 'C4');
                break;
            case 'Archer':
                unit = new Archer(id, team, x, y);
                playSound('spawn', 'E4');
                break;
            case 'Giant':
                unit = new Giant(id, team, x, y);
                playSound('spawn', 'G3');
                break;
        }
        if(unit) {
            units.push(unit);
        }
    }

    function updateElixirUI() {
        const elixirInt = Math.floor(playerElixir);
        elixirText.textContent = elixirInt;
        elixirBar.style.width = `${(playerElixir / maxElixir) * 100}%`;
        
        const cards = cardHandContainer.querySelectorAll('.card');
        cards.forEach((card, index) => {
            // Don't disable the selected card, just check elixir
            if (index === selectedCardIndex) return; 
            
            const cardData = playerHand[index];
            if (cardData && playerElixir < cardData.cost) {
                card.classList.add('disabled');
            } else {
                card.classList.remove('disabled');
            }
        });
    }

    // --- Enemy AI ---
    function runEnemyAI() {
        enemyPlayTimer++;
        if (enemyPlayTimer >= enemyPlayInterval) {
            enemyPlayTimer = 0;
            
            const cardTypes = ['Knight', 'Archer', 'Giant', 'Fireball'];
            const cardToPlay = cardTypes[Math.floor(Math.random() * cardTypes.length)];
            
            const enemyKing = towers.find(t => t.id === 'enemy-king');
            const x = enemyKing.x + (Math.random() * 100 - 50);
            const y = enemyKing.y + 70;
            
            if (cardToPlay === 'Fireball') {
                const playerTowers = towers.filter(t => t.team === 'player' && !t.isKingTower && t.hp > 0);
                let target = playerTowers[Math.floor(Math.random() * playerTowers.length)];
                if (!target) {
                    target = towers.find(t => t.id === 'player-king');
                }
                if(target) {
                     castFireball(target.x, target.y, 'enemy');
                }
            } else {
                spawnUnit(cardToPlay, 'enemy', x, y);
            }
        }
    }
    
    // --- Game Over ---
    function endGame(winner) {
        gameRunning = false;
        gameOverOverlay.style.display = 'flex';
        if (winner === 'player') {
            gameOverMessage.textContent = 'YOU WIN!';
            gameOverOverlay.classList.remove('lose');
        } else {
            gameOverMessage.textContent = 'YOU LOSE!';
            gameOverOverlay.classList.add('lose');
        }
    }
    
    // --- Main Game Loop ---
    let isLoopRunning = false;
    function gameLoop() {
        if (!gameRunning) {
            isLoopRunning = false;
            return;
        }
        isLoopRunning = true;
        gameTime++;

        if (playerElixir < maxElixir) {
            playerElixir += elixirRegenRate;
            if (playerElixir > maxElixir) playerElixir = maxElixir;
            updateElixirUI();
        }

        runEnemyAI();
        towers.forEach(tower => tower.update(gameTime));
        units.forEach(unit => unit.update(gameTime));
        projectiles.forEach(projectile => projectile.update());

        requestAnimationFrame(gameLoop);
    }

    // --- Start Game ---
    function startGame() {
        initAudio(); // Start audio on this first click
        mainMenu.classList.add('hidden');
        gameContainer.classList.remove('hidden');
        
        initGame(); // Set up the game board
        
        if (!isLoopRunning) {
            gameLoop(); // Start the game loop
        }
    }
    
    startButton.addEventListener('click', startGame);
    restartButton.addEventListener('click', initGame);
});