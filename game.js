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
    const nextCardPreview = document.getElementById('next-card-preview');

    // --- Game State Variables ---
    let playerElixir = 5;
    let maxElixir = 10;
    let elixirRegenRate = 0.0055; // Slowed down
    let gameRunning = false;
    let units = [];
    let projectiles = [];
    let towers = [];
    let buildings = []; // NEW: Array for buildings
    let unitIdCounter = 0;
    let gameTime = 0;
    let enemyPlayTimer = 0;
    let enemyPlayInterval = 300;

    let selectedCardData = null;
    let selectedCardIndex = -1;
    let placementMode = false;

    // --- Sound Engine ---
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
            error: new Tone.Synth({ envelope: { attack: 0.01, decay: 0.2, release: 0.2 } }).toDestination(),
            cannonShot: new Tone.Synth({ oscillator: { type: 'fmsquare' }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.01, release: 0.1 } }).toDestination()
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
            } else if (sound === 'cannonShot') {
                sounds.cannonShot.triggerAttackRelease('G2', '8n');
            }
        } catch (e) {
            console.error("Error playing sound:", e);
        }
    }

    // --- Card Definitions (Matching your 8 cards) ---
    const cardDefinitions = {
        knight: { name: 'Knight', cost: 3, type: 'unit', unitType: 'Knight' },
        archer: { name: 'Archer', cost: 3, type: 'unit', unitType: 'Archer' },
        giant: { name: 'Giant', cost: 5, type: 'unit', unitType: 'Giant' },
        fireball: { name: 'Fireball', cost: 4, type: 'spell', spellType: 'Fireball' },
        mpekka: { name: 'M.Pekka', cost: 4, type: 'unit', unitType: 'Mpekka' },
        goblins: { name: 'Goblins', cost: 2, type: 'unit', unitType: 'Goblins' },
        canon: { name: 'Cannon', cost: 3, type: 'building', unitType: 'Canon' },
        arrows: { name: 'Arrows', cost: 3, type: 'spell', spellType: 'Arrows' }
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
    
    // --- Base Class: Entity ---
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
            } else if (this instanceof Building) {
                playSound('towerDestroy');
                buildings = buildings.filter(b => b.id !== this.id);
            } else {
                units = units.filter(u => u.id !== this.id);
            }
        }

        // Updated findTarget to include buildings
        findTarget(allEntities) {
            let closestTarget = null;
            let minDistance = Infinity;

            for (const entity of allEntities) {
                if (entity.team !== this.team && entity.hp > 0) {
                    
                    // Logic for what this unit can attack
                    if (this.targetType === 'building') {
                        // Giants attack Towers OR Buildings
                        if (!(entity instanceof Tower) && !(entity instanceof Building)) {
                            continue; 
                        }
                    } else if (this.targetType === 'ground') {
                        // Logic for ground-only units (not implemented yet)
                        // if (entity.isFlying) continue;
                    }
                    // 'groundAndAir' (default) attacks anything

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
            
            // Towers target Units first, then Buildings
            if (!this.target || this.target.hp <= 0 || getDistance(this, this.target) > this.attackRange) {
                this.findTarget([...units, ...buildings]); 
            }
            
            if (this.attackCooldown > 0) {
                this.attackCooldown -= 1000 / 60;
            }

            if (this.target && this.attackCooldown <= 0) {
                this.attack();
                this.attackCooldown = this.attackSpeed;
            }
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

    // --- NEW: Building Class ---
    class Building extends Entity {
        constructor(id, team, hp, element, x, y, stats) {
            super(id, team, hp, element);
            
            const containerRect = gameContainer.getBoundingClientRect();
            const worldRect = gameWorld.getBoundingClientRect();
            const initialX = x - (worldRect.left - containerRect.left) - (element.offsetWidth / 2);
            const initialY = y - (worldRect.top - containerRect.top) - (element.offsetHeight / 2);

            this.element.style.transform = `translate(${initialX}px, ${initialY}px)`;
            this.x = x;
            this.y = y;

            this.attackRange = stats.attackRange;
            this.aggroRange = stats.aggroRange;
            this.attackSpeed = stats.attackSpeed;
            this.damage = stats.damage;
            this.targetType = stats.targetType; // What it can shoot at
            this.attackCooldown = 0;
            
            this.lifetime = stats.lifetime; // in game ticks (60 ticks/sec)
            this.decayDamage = this.maxHp / this.lifetime;
        }

        update(gameTime) {
            // No super.update() because buildings don't read position
            if (this.hp <= 0) return;

            // Lifetime decay
            this.hp -= this.decayDamage;
            this.updateHPBar();
            if (this.hp <= 0) {
                this.die();
                return;
            }

            // Find target
            if (!this.target || this.target.hp <= 0 || getDistance(this, this.target) > this.attackRange) {
                this.findTarget(units); // Buildings only target units
            }
            
            if (this.attackCooldown > 0) {
                this.attackCooldown -= 1000 / 60;
            }

            if (this.target && this.attackCooldown <= 0) {
                this.attack();
                this.attackCooldown = this.attackSpeed;
            }
        }
        
        attack() { /* Overridden by subclasses */ }
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
            this.attackType = stats.attackType || 'single';
            this.splashRadius = stats.splashRadius || 0;
        }
        
        update(gameTime) {
            if (this.hp <= 0) return;

            if (!this.target || this.target.hp <= 0 || getDistance(this, this.target) > this.aggroRange) {
                const allTargets = [...units, ...towers, ...buildings]; // Can target buildings
                this.findTarget(allTargets);
                
                if (!this.target) {
                    // Default target: nearest enemy building/tower
                    const enemyBuildings = [
                        ...towers.filter(t => t.team !== this.team),
                        ...buildings.filter(b => b.team !== this.team)
                    ];
                    this.findTarget(enemyBuildings); // Find closest building
                }
            }
            
            if (this.attackCooldown > 0) {
                this.attackCooldown -= 1000 / 60;
            }
            
            if (this.target && this.target.hp > 0) {
                const distance = getDistance(this, this.target);
                if (distance <= this.attackRange) {
                    this.element.classList.add('is-attacking');
                    this.element.classList.remove('is-walking');
                    if (this.attackCooldown <= 0) {
                        this.attack();
                        this.attackCooldown = this.attackSpeed;
                    }
                } else {
                    this.element.classList.add('is-walking');
                    this.element.classList.remove('is-attacking');
                    this.move();
                }
            } else {
                 this.element.classList.remove('is-walking');
                 this.element.classList.remove('is-attacking');
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

        attack() { 
            if (this.target && this.target.hp > 0) {
                this.target.takeDamage(this.damage);
            }
        }
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
            gameWorld.appendChild(element);
            super(id, team, 300, element, x, y, stats);
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
                targetType: 'building' // Attacks towers AND buildings
            };
            const element = document.createElement('div');
            element.className = `unit ${team} giant`;
            gameWorld.appendChild(element);
            super(id, team, 700, element, x, y, stats);
        }
    }

    class Mpekka extends Unit {
        constructor(id, team, x, y) {
            const stats = {
                speed: 1.2,
                attackRange: 30,
                aggroRange: 100,
                attackSpeed: 1800, 
                damage: 200, 
                targetType: 'groundAndAir'
            };
            const element = document.createElement('div');
            element.className = `unit ${team} mpekka`;
            gameWorld.appendChild(element);
            super(id, team, 400, element, x, y, stats);
        }
    }

    class Goblins extends Unit {
        constructor(id, team, x, y) {
            const stats = {
                speed: 2.0,
                attackRange: 30,
                aggroRange: 100,
                attackSpeed: 800,
                damage: 20,
                targetType: 'groundAndAir'
            };
            const element = document.createElement('div');
            element.className = `unit ${team} goblins`;
            gameWorld.appendChild(element);
            super(id, team, 80, element, x, y, stats);
        }
    }

    // --- Specific Building Class ---
    class Canon extends Building {
         constructor(id, team, x, y) {
            const stats = {
                attackRange: 130,
                aggroRange: 140,
                attackSpeed: 1000,
                damage: 40,
                targetType: 'groundAndAir', // Shoots at units
                lifetime: 1800 // 30 seconds * 60 ticks/sec
            };
            const element = document.createElement('div');
            element.className = `building ${team} canon`;
            gameWorld.appendChild(element);
            super(id, team, 250, element, x, y, stats);
        }

        attack() {
            if (!this.target) return;
            playSound('cannonShot');
            const projectile = new Projectile(
                `proj_${unitIdCounter++}`,
                this.team,
                this.damage,
                this.x,
                this.y,
                this.target
            );
            projectile.element.classList.add('canon-ball'); // Style it
            projectiles.push(projectile);
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
        buildings = []; // Reset buildings
        
        gameRunning = true;
        playerElixir = 5;
        gameTime = 0;
        enemyPlayTimer = 0;
        gameOverOverlay.style.display = 'none';
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
            cardDefinitions.mpekka,
            cardDefinitions.goblins,
            cardDefinitions.canon,
            cardDefinitions.arrows,
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
            
            const cardType = cardData.type === 'unit' ? cardData.unitType : cardData.spellType;
            card.classList.add(`card-${cardType.toLowerCase()}`);

            if (index === selectedCardIndex) {
                card.classList.add('selected');
            }

            card.innerHTML = `
                <div class="card-cost">${cardData.cost}</div>
                <div class="card-art"></div>
                <div class="card-name">${cardData.name}</div>
            `;
            
            if (playerElixir < cardData.cost) {
                card.classList.add('disabled');
            }
            
            card.addEventListener('click', () => selectCard(cardData, index));
            cardHandContainer.appendChild(card);
        });
    }

    function updateNextCardUI() {
        if (playerDeck.length > 0) {
            const nextCard = playerDeck[0];
            const cardType = nextCard.type === 'unit' ? nextCard.unitType : nextCard.spellType;
            
            nextCardPreview.className = 'next-card-preview-box'; 
            nextCardPreview.classList.add(`card-${cardType.toLowerCase()}`);

            nextCardPreview.innerHTML = `
                <div class="card-cost-small">${nextCard.cost}</div>
                <div class="card-art-small"></div>
                <div class="card-name-small">${nextCard.name}</div>
            `;
        } else {
            nextCardPreview.innerHTML = '';
        }
    }

    function selectCard(cardData, index) {
        if (playerElixir < cardData.cost || !gameRunning) {
            playSound('error', 'C3');
            return;
        }
        if (index === selectedCardIndex) {
            resetPlacement();
            return;
        }
        placementMode = true;
        selectedCardData = cardData;
        selectedCardIndex = index;
        gameContainer.classList.add('placement-mode');
        updateCardHandUI();
    }

    function resetPlacement() {
        placementMode = false;
        selectedCardData = null;
        selectedCardIndex = -1;
        gameContainer.classList.remove('placement-mode');
        gameContainer.classList.remove('invalid');
        updateCardHandUI();
    }

    function handlePlacement(e) {
        if (!placementMode || !selectedCardData) return;

        const rect = gameContainer.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const riverY = gameContainer.offsetHeight / 2;
        const bridgeYStart = riverY - 25;
        const bridgeYEnd = riverY + 25;

        // --- Placement Validation ---
        let invalidPlacement = false;
        // 1. Can't place on enemy side
        if (y < riverY) {
            invalidPlacement = true;
        }
        // 2. Can't place buildings on river/bridge
        if (selectedCardData.type === 'building' && y > bridgeYStart && y < bridgeYEnd) {
             invalidPlacement = true;
        }

        if (invalidPlacement) {
            playSound('error', 'C3');
            gameContainer.classList.add('invalid');
            setTimeout(() => gameContainer.classList.remove('invalid'), 200);
            return;
        }

        playerElixir -= selectedCardData.cost;
        
        if (selectedCardData.type === 'unit') {
            spawnUnit(selectedCardData.unitType, 'player', x, y);
        } else if (selectedCardData.type === 'building') {
            spawnBuilding(selectedCardData.unitType, 'player', x, y);
        } else if (selectedCardData.type === 'spell') {
            if (selectedCardData.spellType === 'Fireball') {
                castFireball(x, y, 'player');
            } else if (selectedCardData.spellType === 'Arrows') {
                castArrows(x, y, 'player');
            }
        }

        const playedCard = playerHand.splice(selectedCardIndex, 1)[0];
        playerDeck.push(playedCard);
        drawCard();
        resetPlacement();
        updateElixirUI();
        updateNextCardUI();
    }
    
    gameContainer.addEventListener('click', handlePlacement);

    // --- Spell Logic ---
    function castFireball(x, y, team) {
        playSound('spell');
        const effect = document.createElement('div');
        effect.className = 'spell-effect fireball';
        const containerRect = gameContainer.getBoundingClientRect();
        const worldRect = gameWorld.getBoundingClientRect();
        effect.style.transform = `translate(${x - (worldRect.left - containerRect.left) - 50}px, ${y - (worldRect.top - containerRect.top) - 50}px)`;
        gameWorld.appendChild(effect);
        setTimeout(() => effect.remove(), 500); 

        const allTargets = [...units, ...towers, ...buildings]; // Spells hit buildings
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

    function castArrows(x, y, team) {
        playSound('spell', 'A4');
        const effect = document.createElement('div');
        effect.className = 'spell-effect arrows';
        const containerRect = gameContainer.getBoundingClientRect();
        const worldRect = gameWorld.getBoundingClientRect();
        effect.style.transform = `translate(${x - (worldRect.left - containerRect.left) - 100}px, ${y - (worldRect.top - containerRect.top) - 100}px)`;
        gameWorld.appendChild(effect);
        setTimeout(() => effect.remove(), 800); 

        const allTargets = [...units, ...towers, ...buildings];
        const damageRadius = 100; 
        const damage = 40; 
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
            case 'Mpekka':
                unit = new Mpekka(id, team, x, y);
                playSound('spawn', 'A3');
                break;
            case 'Goblins':
                playSound('spawn', 'G5', '16n');
                units.push(new Goblins(id+'_1', team, x-15, y-15));
                units.push(new Goblins(id+'_2', team, x+15, y-15));
                units.push(new Goblins(id+'_3', team, x, y+15));
                return; // Return early as push is handled
        }
        if(unit) {
            units.push(unit);
        }
    }

    function spawnBuilding(type, team, x, y) {
         const id = `${team}_${type}_${unitIdCounter++}`;
         let building;
         switch(type) {
            case 'Canon':
                building = new Canon(id, team, x, y);
                playSound('spawn', 'C3');
                break;
         }
         if(building) {
            buildings.push(building);
         }
    }

    function updateElixirUI() {
        const elixirInt = Math.floor(playerElixir);
        elixirText.textContent = elixirInt;
        elixirBar.style.width = `${(playerElixir / maxElixir) * 100}%`;
        
        const cards = cardHandContainer.querySelectorAll('.card');
        cards.forEach((card, index) => {
            if (index === selectedCardIndex) return; 
            const cardData = playerHand[index];
            if (cardData && playerElixir < cardData.cost) {
                card.classList.add('disabled');
            } else {
                card.classList.remove('disabled');
            }
        });
    }

    // --- Enemy AI (Updated for 8 cards) ---
    function runEnemyAI() {
        enemyPlayTimer++;
        if (enemyPlayTimer >= enemyPlayInterval) {
            enemyPlayTimer = 0;
            
            const cardKeys = Object.keys(cardDefinitions);
            const randomCardKey = cardKeys[Math.floor(Math.random() * cardKeys.length)];
            const cardData = cardDefinitions[randomCardKey];
            
            if (Math.random() < 0.5) return; 

            const enemyKing = towers.find(t => t.id === 'enemy-king');
            const x = enemyKing.x + (Math.random() * 100 - 50);
            const y = enemyKing.y + 70;
            
            if (cardData.type === 'spell') {
                const playerTargets = [...towers, ...buildings].filter(t => t.team === 'player' && t.hp > 0);
                let target = playerTargets[Math.floor(Math.random() * playerTargets.length)];
                if(target) {
                    if(cardData.spellType === 'Fireball') castFireball(target.x, target.y, 'enemy');
                    if(cardData.spellType === 'Arrows') castArrows(target.x, target.y, 'enemy');
                }
            } else if (cardData.type === 'building') {
                spawnBuilding(cardData.unitType, 'enemy', x, y);
            } else {
                spawnUnit(cardData.unitType, 'enemy', x, y);
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
        buildings.forEach(b => b.update(gameTime)); // Update buildings
        units.forEach(unit => unit.update(gameTime));
        projectiles.forEach(projectile => projectile.update());

        requestAnimationFrame(gameLoop);
    }

    // --- Start Game ---
    function startGame() {
        initAudio();
        mainMenu.classList.add('hidden');
        gameContainer.classList.remove('hidden');
        initGame();
        
        if (!isLoopRunning) {
            gameLoop();
        }
    }
    
    startButton.addEventListener('click', startGame);
    restartButton.addEventListener('click', initGame);
});