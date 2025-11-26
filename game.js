document.addEventListener('DOMContentLoaded', () => {

    // --- DOM Elements ---
    const gameContainer = document.getElementById('game-container');
    const gameWorld = document.getElementById('game-world');
    const elixirBar = document.getElementById('elixir-bar');
    const elixirText = document.getElementById('elixir-text');
    const cardHandContainer = document.getElementById('card-hand');
    const gameOverOverlay = document.getElementById('game-over-overlay');
    const gameOverMessage = document.getElementById('game-over-message');
    const restartButton = document.getElementById('restart-button');

    // --- Game State Variables ---
    let playerElixir = 5;
    let maxElixir = 10;
    let elixirRegenRate = 0.05; // Elixir per game tick (approx 60 ticks/sec)
    let gameRunning = true;
    let units = [];
    let projectiles = [];
    let towers = [];
    let unitIdCounter = 0;
    let gameTime = 0;
    let enemyPlayTimer = 0;
    let enemyPlayInterval = 300; // ~5 seconds

    // --- Card & Deck Definitions ---
    const cardDefinitions = {
        knight: { name: 'Knight', emoji: '🛡️', cost: 3, type: 'Knight' },
        archer: { name: 'Archer', emoji: '🏹', cost: 3, type: 'Archer' },
        giant: { name: 'Giant', emoji: '🗿', cost: 5, type: 'Giant' },
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
        // This function now needs to account for the game container's offset
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
            
            // Create HP bar
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
            if (this.hp <= 0) return; // Already dead
            this.hp -= amount;
            this.updateHPBar();
            
            // Add damage flash effect
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
                // If a Princess tower dies, remove it from the towers list
                towers = towers.filter(t => t.id !== this.id);
                // Check for game over if a King tower dies
                if (this.isKingTower) {
                    endGame(this.team === 'player' ? 'enemy' : 'player');
                }
            } else {
                // If a unit dies, remove it from the units list
                units = units.filter(u => u.id !== this.id);
            }
        }

        findTarget(allEntities) {
            let closestTarget = null;
            let minDistance = Infinity;

            for (const entity of allEntities) {
                if (entity.team !== this.team && entity.hp > 0) {
                    
                    // Target-finding logic
                    // Giants ONLY target towers.
                    if (this.targetType === 'building') {
                        if (!(entity instanceof Tower)) {
                            continue; // Giant skips non-towers
                        }
                    }
                    // Knights/Archers target nearest enemy (unit or tower).
                    // (No special rule needed, they attack anything)


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
            // Update internal x/y from DOM element
            const rect = getRect(this.element);
            this.x = rect.left + rect.width / 2;
            this.y = rect.top + rect.height / 2;
        }

        // Base update method, to be overridden
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
            this.attackSpeed = 1000; // ms
            this.damage = 15;
            this.attackCooldown = 0;
            this.targetType = 'groundAndAir'; // Towers hit everything
            this.activated = false;
        }
        
        update(gameTime) {
            super.update();
            if (this.hp <= 0) return;
            
            // King tower activation
            if (this.isKingTower && !this.activated) {
                // Check if any friendly princess tower is destroyed
                const princessTowers = towers.filter(t => t.team === this.team && !t.isKingTower);
                if (princessTowers.length < 2) {
                    this.activated = true;
                }
                // Check if King tower took damage
                if (this.hp < this.maxHp) {
                    this.activated = true;
                }
                
                if(!this.activated) return; // Don't attack if not activated
            }
            
            // Find target if current one is dead or out of range
            if (!this.target || this.target.hp <= 0 || getDistance(this, this.target) > this.attackRange) {
                this.findTarget(units); // Towers only target units
            }
            
            // Attack logic
            if (this.attackCooldown > 0) {
                this.attackCooldown -= 1000 / 60; // Reduce by milliseconds per frame
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
            
            // We set position relative to gameWorld
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
            this.targetType = stats.targetType; // 'groundAndAir', 'ground', 'building'
            
            this.attackCooldown = 0;
            this.path = null; // Used for pathfinding
        }
        
        update(gameTime) {
            // Note: We don't call super.update() here because unit position
            // is calculated, not read from the DOM.
            if (this.hp <= 0) return;

            // Find a target
            if (!this.target || this.target.hp <= 0 || getDistance(this, this.target) > this.aggroRange) {
                const allTargets = [...units, ...towers];
                this.findTarget(allTargets);
                
                // If still no target, move towards enemy King Tower
                if (!this.target) {
                    if (this.team === 'player') {
                        this.target = towers.find(t => t.id === 'enemy-king');
                    } else {
                        this.target = towers.find(t => t.id === 'player-king');
                    }
                }
            }
            
            // Attack logic
            if (this.attackCooldown > 0) {
                this.attackCooldown -= 1000 / 60;
            }
            
            if (this.target && this.target.hp > 0) {
                const distance = getDistance(this, this.target);
                
                if (distance <= this.attackRange) {
                    // Stop moving and attack
                    if (this.attackCooldown <= 0) {
                        this.attack();
                        this.attackCooldown = this.attackSpeed;
                    }
                } else {
                    // Move towards target
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

            // Update internal coordinates
            this.x += moveX;
            this.y += moveY;
            
            // Update DOM element position
            const containerRect = gameContainer.getBoundingClientRect();
            const worldRect = gameWorld.getBoundingClientRect();
            const elX = this.x - (worldRect.left - containerRect.left) - (this.element.offsetWidth / 2);
            const elY = this.y - (worldRect.top - containerRect.top) - (this.element.offsetHeight / 2);
            
            this.element.style.transform = `translate(${elX}px, ${elY}px)`;
        }

        attack() {
            // Overridden by subclasses (Knight, Archer)
        }
    }

    // --- Specific Unit Classes ---
    
    class Knight extends Unit {
        constructor(id, team, x, y) {
            const stats = {
                speed: 1.5,
                attackRange: 30, // Melee
                aggroRange: 100,
                attackSpeed: 1000,
                damage: 30,
                targetType: 'groundAndAir' // Hits anything
            };
            const element = document.createElement('div');
            element.className = `unit ${team} knight`;
            element.innerHTML = '<div class="emoji">🛡️</div>';
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
                attackRange: 120, // Ranged
                aggroRange: 130,
                attackSpeed: 800,
                damage: 15,
                targetType: 'groundAndAir'
            };
            const element = document.createElement('div');
            element.className = `unit ${team} archer`;
            element.innerHTML = '<div class="emoji">🏹</div>';
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
                speed: 1, // Slower
                attackRange: 35, // Melee
                aggroRange: 100,
                attackSpeed: 1500,
                damage: 50,
                targetType: 'building' // ONLY attacks towers
            };
            const element = document.createElement('div');
            element.className = `unit ${team} giant`;
            element.innerHTML = '<div class="emoji">🗿</div>';
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
            
            // Calculate position relative to gameWorld
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
            
            // Move towards target
            const dx = this.target.x - this.x;
            const dy = this.target.y - this.y;
            const speed = 8;
            
            this.x += (dx / distance) * speed;
            this.y += (dy / distance) * speed;
            
            // Update DOM element position
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
        // Clear old game state
        gameWorld.innerHTML = '';
        units = [];
        projectiles = [];
        towers = [];
        playerHand = [];
        playerDeck = [];
        gameRunning = true;
        playerElixir = 5;
        gameTime = 0;
        enemyPlayTimer = 0;
        gameOverOverlay.style.display = 'none';

        // Create Towers
        towers = [
            new Tower('enemy-king', 'enemy', 2000, document.getElementById('enemy-king'), true),
            new Tower('enemy-princess-1', 'enemy', 1000, document.getElementById('enemy-princess-1')),
            new Tower('enemy-princess-2', 'enemy', 1000, document.getElementById('enemy-princess-2')),
            
            new Tower('player-king', 'player', 2000, document.getElementById('player-king'), true),
            new Tower('player-princess-1', 'player', 1000, document.getElementById('player-princess-1')),
            new Tower('player-princess-2', 'player', 1000, document.getElementById('player-princess-2'))
        ];
        
        towers.forEach(t => t.updateHPBar());

        // Setup Deck & Hand
        playerDeck = [
            cardDefinitions.knight,
            cardDefinitions.archer,
            cardDefinitions.giant,
            cardDefinitions.knight,
            cardDefinitions.archer,
            cardDefinitions.knight,
            cardDefinitions.archer,
            cardDefinitions.giant,
        ].sort(() => Math.random() - 0.5); // Shuffle deck
        
        for(let i = 0; i < 4; i++) {
            drawCard();
        }
        
        updateCardHandUI();
        
        // Start game loop
        gameLoop();
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
            card.innerHTML = `
                <div class="card-cost">${cardData.cost}</div>
                <div class="card-emoji">${cardData.emoji}</div>
                <div class="card-name">${cardData.name}</div>
            `;
            
            if (playerElixir < cardData.cost) {
                card.classList.add('disabled');
            }
            
            card.addEventListener('click', () => playCard(cardData, index));
            cardHandContainer.appendChild(card);
        });
    }

    function playCard(cardData, handIndex) {
        if (playerElixir < cardData.cost || !gameRunning) return;

        playerElixir -= cardData.cost;
        
        // Spawn unit at a random-ish position near player king tower
        const containerRect = gameContainer.getBoundingClientRect();
        const playerKing = towers.find(t => t.id === 'player-king');
        const x = playerKing.x + (Math.random() * 100 - 50);
        const y = playerKing.y - 50; // Spawn in front of king
        
        spawnUnit(cardData.type, 'player', x, y);

        // Cycle card
        const playedCard = playerHand.splice(handIndex, 1)[0];
        playerDeck.push(playedCard);
        drawCard();
        
        updateCardHandUI();
        updateElixirUI();
    }
    
    function spawnUnit(type, team, x, y) {
        const id = `${team}_${type}_${unitIdCounter++}`;
        let unit;
        switch(type) {
            case 'Knight':
                unit = new Knight(id, team, x, y);
                break;
            case 'Archer':
                unit = new Archer(id, team, x, y);
                break;
            case 'Giant':
                unit = new Giant(id, team, x, y);
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
        
        // Update card disabled state
        const cards = cardHandContainer.querySelectorAll('.card');
        cards.forEach((card, index) => {
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
            
            const cardTypes = ['Knight', 'Archer', 'Giant'];
            const cardToPlay = cardTypes[Math.floor(Math.random() * cardTypes.length)];
            
            // Spawn in a random lane
            const enemyKing = towers.find(t => t.id === 'enemy-king');
            const x = enemyKing.x + (Math.random() * 100 - 50);
            const y = enemyKing.y + 70; // Spawn in front of king
            
            spawnUnit(cardToPlay, 'enemy', x, y);
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
    
    restartButton.addEventListener('click', initGame);

    // --- Main Game Loop ---
    function gameLoop() {
        if (!gameRunning) {
            return;
        }
        
        gameTime++;

        // 1. Update Elixir
        if (playerElixir < maxElixir) {
            playerElixir += elixirRegenRate;
            if (playerElixir > maxElixir) {
                playerElixir = maxElixir;
            }
            updateElixirUI();
        }

        // 2. Run Enemy AI
        runEnemyAI();

        // 3. Update all Towers
        towers.forEach(tower => tower.update(gameTime));

        // 4. Update all Units
        units.forEach(unit => unit.update(gameTime));

        // 5. Update all Projectiles
        projectiles.forEach(projectile => projectile.update());

        // 6. Request next frame
        requestAnimationFrame(gameLoop);
    }

    // --- Start Game ---
    initGame();
});