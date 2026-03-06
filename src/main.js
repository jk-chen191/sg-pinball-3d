import * as THREE from 'three';

// 游戏配置
const CONFIG = {
  // 游戏板尺寸
  boardWidth: 60,
  boardHeight: 80,
  boardDepth: 8,

  // 发射轨道（右侧）
  launchChannelWidth: 8,
  launchChannelHeight: 70,

  // 顶部水平轨道
  topChannelLength: 50,
  topChannelWidth: 6,

  // 弹珠
  ballRadius: 1.5,
  ballMass: 1,

  // 细针
  pinRadius: 0.8,
  pinRows: 5,
  pinsPerRow: 6,

  // 底部口子
  maxSlotCount: 12,
  slotWidth: 2,

  // 物理
  gravity: -40,
  restitution: 0.7, // 弹性系数
  friction: 0.99,

  // 颜色
  colors: {
    board: 0x1a1a3e,
    wall: 0x4a4a6a,
    pin: 0xff6b6b,
    ball: 0x00ffff,
    slot: [0xff6b6b, 0xffd93d, 0x6bcb77, 0x4d96ff, 0x9b59b6, 0xe67e22],
  },

  // 基础分
  baseScore: 100,

  // 游戏设置
  initialBalls: 5, // 初始弹射次数
  bonusBallEvery: 100, // 每 100 分增加一次次数
};

// 游戏状态
class GameState {
  constructor() {
    this.score = 0;
    this.lastSlot = '-';
    this.isBallInPlay = false;
    this.ballVelocity = new THREE.Vector3();
    this.ballAngularVelocity = new THREE.Vector3();
    this.activeSlots = []; // 当前激活的得分区域
    this.slotMultiplier = 1; // 当前倍率
    this.ballsRemaining = CONFIG.initialBalls; // 剩余弹射次数
    this.isGameOver = false; // 游戏是否结束
    this.bonusBallsEarned = 0; // 获得的奖励次数
  }
}

// 排行榜管理
class Leaderboard {
  constructor() {
    this.storageKey = 'pinball_leaderboard';
    this.maxEntries = 5;
    this.highScores = this.load();
  }

  load() {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to load leaderboard:', e);
      return [];
    }
  }

  save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.highScores));
    } catch (e) {
      console.error('Failed to save leaderboard:', e);
    }
  }

  isHighScore(score) {
    if (this.highScores.length < this.maxEntries) {
      return true;
    }
    return score > this.highScores[this.highScores.length - 1].score;
  }

  addEntry(score, name) {
    const entry = {
      score: score,
      name: name.substring(0, 10), // 限制 10 个字符
      date: new Date().toISOString().split('T')[0]
    };

    this.highScores.push(entry);
    this.highScores.sort((a, b) => b.score - a.score);
    this.highScores = this.highScores.slice(0, this.maxEntries);
    this.save();

    return this.highScores.findIndex(e => e.name === entry.name && e.score === score);
  }

  getEntries() {
    return this.highScores;
  }
}

// 主游戏类
class PinballGame {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.clock = new THREE.Clock();

    this.gameObjects = {
      board: null,
      walls: [],
      pins: [],
      slots: [],
      ball: null,
      slotMeshes: [], // 存储得分区域的网格用于显示/隐藏
    };

    this.state = new GameState();
    this.launchPower = 0;
    this.chargingPower = false;
    this.powerIncreaseRate = 100; // 每秒增加的力度
    this.lastScoreForBonus = 0; // 上次检查奖励的次数分数

    this.leaderboard = new Leaderboard();
    this.pendingScore = null; // 等待输入名字的高分

    this.init();
    this.createScene();
    this.setupLights();
    this.setupUI();
    this.randomizeSlots(); // 初始化时随机化得分区域
    this.updateUI(); // 初始化 UI 显示
    this.animate();
  }

  init() {
    // 创建场景
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    // 创建相机 - 调整位置以更好地查看游戏区域（包含发射轨道）
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    this.updateCameraForScreen(aspect);

    // 创建渲染器
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const container = document.getElementById('canvas-container');
    container.appendChild(this.renderer.domElement);

    // 设置 canvas 样式
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';

    // 初始设置渲染器大小
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);

    // 窗口大小调整
    window.addEventListener('resize', () => this.onWindowResize(), false);
  }

  updateCameraForScreen(aspect) {
    // 根据屏幕宽度调整相机位置
    if (window.innerWidth < 768) {
      // 移动端：拉远相机，向左偏移以显示左侧区域
      this.camera.position.set(-5, 45, 150);
      this.camera.lookAt(-5, 40, 0);
    } else {
      // 桌面端
      this.camera.position.set(10, 35, 100);
      this.camera.lookAt(10, 35, 0);
    }
  }

  setupLights() {
    // 环境光 - 增加亮度
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    // 主方向光
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(20, 50, 30);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.1;
    directionalLight.shadow.camera.far = 200;
    directionalLight.shadow.camera.left = -50;
    directionalLight.shadow.camera.right = 50;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -20;
    this.scene.add(directionalLight);

    // 补光
    const fillLight = new THREE.DirectionalLight(0x4a90ff, 0.5);
    fillLight.position.set(-20, 20, -20);
    this.scene.add(fillLight);

    // 顶部点光源
    const pointLight = new THREE.PointLight(0x00ffff, 0.8, 150);
    pointLight.position.set(0, 70, 0);
    this.scene.add(pointLight);
  }

  createScene() {
    this.createBoard();
    this.createWalls();
    this.createPins();
    this.createSlots();
    this.createBall();
  }

  createBoard() {
    // 主游戏板 - 放在后面
    const boardGeometry = new THREE.BoxGeometry(
      CONFIG.boardWidth,
      CONFIG.boardHeight,
      CONFIG.boardDepth
    );
    const boardMaterial = new THREE.MeshStandardMaterial({
      color: CONFIG.colors.board,
      metalness: 0.3,
      roughness: 0.7,
    });

    const board = new THREE.Mesh(boardGeometry, boardMaterial);
    board.position.set(
      -CONFIG.launchChannelWidth / 2,
      CONFIG.boardHeight / 2 - CONFIG.launchChannelHeight / 2,
      -CONFIG.boardDepth / 2
    );
    board.receiveShadow = true;
    this.scene.add(board);
    this.gameObjects.board = board;

    // 发射轨道底板 - 放在后面
    const launchBoardGeometry = new THREE.BoxGeometry(
      CONFIG.launchChannelWidth,
      CONFIG.launchChannelHeight,
      CONFIG.boardDepth
    );
    const launchBoard = new THREE.Mesh(launchBoardGeometry, boardMaterial);
    launchBoard.position.set(
      CONFIG.boardWidth / 2 + CONFIG.launchChannelWidth / 2,
      CONFIG.launchChannelHeight / 2 + 5,
      -CONFIG.boardDepth / 2
    );
    launchBoard.receiveShadow = true;
    this.scene.add(launchBoard);
  }

  createWalls() {
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: CONFIG.colors.wall,
      metalness: 0.5,
      roughness: 0.5,
      emissive: 0x4a4a8a,
      emissiveIntensity: 0.5,
    });

    const wallThickness = 2;
    const wallHeight = 12;

    // 墙壁应该在游戏板后面，细针在前面
    const wallZ = -CONFIG.boardDepth / 2;

    // 左墙
    const leftWall = this.createWall(
      wallThickness,
      CONFIG.boardHeight,
      wallHeight,
      -CONFIG.boardWidth / 2 - wallThickness / 2,
      CONFIG.boardHeight / 2,
      wallZ,
      wallMaterial
    );
    this.scene.add(leftWall);
    this.gameObjects.walls.push(leftWall);

    // 右墙（发射轨道外侧）
    const rightWall = this.createWall(
      wallThickness,
      CONFIG.launchChannelHeight + 10,
      wallHeight,
      CONFIG.boardWidth / 2 + CONFIG.launchChannelWidth + wallThickness / 2,
      CONFIG.launchChannelHeight / 2 + 5,
      wallZ,
      wallMaterial
    );
    this.scene.add(rightWall);
    this.gameObjects.walls.push(rightWall);

    // 中间隔墙（发射轨道和主区域之间）- 缩短以便球能够进入顶部轨道
    const middleWall = this.createWall(
      wallThickness,
      CONFIG.launchChannelHeight - 25,
      wallHeight,
      CONFIG.boardWidth / 2 - wallThickness / 2,
      CONFIG.launchChannelHeight / 2 + 8,
      wallZ,
      wallMaterial
    );
    this.scene.add(middleWall);
    this.gameObjects.walls.push(middleWall);

    // 顶墙（左侧）
    const topWall = this.createWall(
      CONFIG.boardWidth + CONFIG.launchChannelWidth,
      wallThickness,
      wallHeight,
      0,
      CONFIG.launchChannelHeight + 5 + wallThickness / 2,
      wallZ,
      wallMaterial
    );
    this.scene.add(topWall);
    this.gameObjects.walls.push(topWall);

    // 后墙
    const backWall = this.createWall(
      CONFIG.boardWidth + CONFIG.launchChannelWidth + wallThickness * 2,
      CONFIG.launchChannelHeight + 10,
      wallThickness,
      0,
      CONFIG.launchChannelHeight / 2 + 5,
      -CONFIG.boardDepth / 2 - wallThickness / 2,
      wallMaterial
    );
    this.scene.add(backWall);
    this.gameObjects.walls.push(backWall);
  }

  createWall(width, height, depth, x, y, z, material) {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const wall = new THREE.Mesh(geometry, material);
    wall.position.set(x, y, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    return wall;
  }

  createPins() {
    const pinGeometry = new THREE.CylinderGeometry(
      CONFIG.pinRadius,
      CONFIG.pinRadius,
      3,
      16
    );
    const pinMaterial = new THREE.MeshStandardMaterial({
      color: CONFIG.colors.pin,
      metalness: 0.6,
      roughness: 0.4,
      emissive: 0x3a1a1a,
    });

    // 创建交错排列的细针
    const startX = -CONFIG.boardWidth / 2 + CONFIG.boardWidth * 0.08;
    const endX = CONFIG.boardWidth / 2 - CONFIG.launchChannelWidth - CONFIG.boardWidth * 0.08;
    const startY = CONFIG.boardHeight * 0.18; // 第一排细针往下移，空出空间
    const endY = CONFIG.boardHeight * 0.60;

    const rows = CONFIG.pinRows;
    const pinsPerRow = CONFIG.pinsPerRow;

    // 细针应该在游戏板前面（Z 轴正方向）
    const pinZ = CONFIG.boardDepth / 2 + 1.5;

    for (let row = 0; row < rows; row++) {
      const y = startY + (row / (rows - 1)) * (endY - startY);
      const isOddRow = row % 2 === 1;
      const cols = isOddRow ? pinsPerRow - 1 : pinsPerRow;

      for (let col = 0; col < cols; col++) {
        const x = startX + (col / (cols - 1 || 1)) * (endX - startX);

        const pin = new THREE.Mesh(pinGeometry, pinMaterial);
        pin.position.set(x, y, pinZ);
        pin.castShadow = true;
        pin.receiveShadow = true;

        // 添加发光效果
        const glowGeometry = new THREE.SphereGeometry(CONFIG.pinRadius * 1.5, 8, 8);
        const glowMaterial = new THREE.MeshBasicMaterial({
          color: CONFIG.colors.pin,
          transparent: true,
          opacity: 0.3,
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        glow.position.y = 1.5;
        pin.add(glow);

        this.scene.add(pin);
        this.gameObjects.pins.push({
          mesh: pin,
          position: new THREE.Vector3(x, y, pinZ),
          radius: CONFIG.pinRadius,
        });
      }
    }
  }

  createSlots() {
    const slotY = 3;
    const slotHeight = 6;
    // 口子和分隔板应该与细针在同一平面
    const slotZ = CONFIG.boardDepth / 2 + 1.5;

    // 计算槽位宽度以覆盖整个底部（减去发射轨道宽度）
    const playableWidth = CONFIG.boardWidth - CONFIG.launchChannelWidth;
    const slotWidth = playableWidth / CONFIG.maxSlotCount;

    for (let i = 0; i < CONFIG.maxSlotCount; i++) {
      // 从左到右均匀分布
      const x = -CONFIG.boardWidth / 2 + CONFIG.launchChannelWidth / 2 + (i + 0.5) * slotWidth;

      // 创建口子视觉
      const slotGeometry = new THREE.BoxGeometry(slotWidth - 0.5, slotHeight, 2);
      const slotMaterial = new THREE.MeshStandardMaterial({
        color: CONFIG.colors.slot[i % CONFIG.colors.slot.length],
        metalness: 0.4,
        roughness: 0.6,
        emissive: CONFIG.colors.slot[i % CONFIG.colors.slot.length],
        emissiveIntensity: 0.3,
      });

      const slot = new THREE.Mesh(slotGeometry, slotMaterial);
      slot.position.set(x, slotHeight / 2, slotZ);
      slot.receiveShadow = true;
      this.scene.add(slot);
      this.gameObjects.slotMeshes.push(slot);

      this.gameObjects.slots.push({
        index: i,
        x: x,
        y: slotY,
        width: slotWidth,
        color: CONFIG.colors.slot[i % CONFIG.colors.slot.length],
        baseScore: CONFIG.baseScore, // 所有口子基础分相同
      });
    }

    // 添加底部地板（放在后面）
    const floorGeometry = new THREE.BoxGeometry(CONFIG.boardWidth, 2, CONFIG.boardDepth);
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a2a4a,
      metalness: 0.3,
      roughness: 0.7,
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.position.set(0, 0, -CONFIG.boardDepth / 2);
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  // 随机化得分区域
  randomizeSlots() {
    // 随机选择激活的得分区域数量 (1-4)
    const activeCount = Math.floor(Math.random() * 4) + 1;

    // 根据激活数量确定倍率
    let multiplier;
    if (activeCount === 4) {
      multiplier = 1; // 4 个区域：基础分
    } else if (activeCount === 3) {
      multiplier = 2; // 3 个区域：2 倍
    } else if (activeCount === 2) {
      // 2 个区域：4 倍或 6 倍
      multiplier = Math.random() < 0.5 ? 4 : 6;
    } else {
      // 1 个区域：8 倍或 10 倍
      multiplier = Math.random() < 0.5 ? 8 : 10;
    }

    this.state.slotMultiplier = multiplier;

    // 在整个底部范围内随机选择激活区域 (0-11)
    const activeIndices = [];
    const availableIndices = Array.from({ length: CONFIG.maxSlotCount }, (_, i) => i);

    for (let i = 0; i < activeCount; i++) {
      const randomIndex = Math.floor(Math.random() * availableIndices.length);
      activeIndices.push(availableIndices[randomIndex]);
      availableIndices.splice(randomIndex, 1);
    }

    // 排序以便显示
    activeIndices.sort((a, b) => a - b);
    this.state.activeSlots = activeIndices;

    // 更新显示
    for (let i = 0; i < CONFIG.maxSlotCount; i++) {
      if (this.gameObjects.slotMeshes[i]) {
        this.gameObjects.slotMeshes[i].visible = activeIndices.includes(i);
      }
    }

    console.log(`随机得分区域：${activeCount}个激活，倍率：${multiplier}x，位置：${activeIndices.map(i => i + 1).join(', ')}`);

    // 更新 UI 显示当前倍率
    this.updateUI();
  }

  createBall() {
    const ballGeometry = new THREE.SphereGeometry(CONFIG.ballRadius, 32, 32);
    const ballMaterial = new THREE.MeshStandardMaterial({
      color: CONFIG.colors.ball,
      metalness: 0.8,
      roughness: 0.2,
      emissive: 0x004444,
    });

    const ball = new THREE.Mesh(ballGeometry, ballMaterial);
    ball.castShadow = true;
    ball.receiveShadow = true;

    this.scene.add(ball);
    this.gameObjects.ball = ball;

    // 设置初始位置在发射轨道底部
    this.resetBall();
  }

  resetBall() {
    if (this.gameObjects.ball) {
      const launchX = CONFIG.boardWidth / 2 + CONFIG.launchChannelWidth / 2;
      const launchY = 8;
      const ballZ = CONFIG.boardDepth / 2 + CONFIG.ballRadius;
      this.gameObjects.ball.position.set(launchX, launchY, ballZ);
      this.state.ballVelocity.set(0, 0, 0);
      this.state.ballAngularVelocity.set(0, 0, 0);
      this.state.isBallInPlay = false;
      this.chargingPower = false;
      this.launchPower = 0;
    }
  }

  launchBall() {
    if (this.state.isBallInPlay || this.state.isGameOver) return;
    if (this.state.ballsRemaining <= 0) return;

    // 消耗一次次数
    this.state.ballsRemaining--;

    const power = this.launchPower / 100;
    const launchForce = 120 + power * 80; // 力度范围 120-200

    // 垂直向上发射
    this.state.ballVelocity.set(0, launchForce, 0);
    this.state.isBallInPlay = true;

    this.showMessage(`发射！剩余次数：${this.state.ballsRemaining}`);

    // 重置按钮状态
    const launchBtn = document.getElementById('launch-btn');
    launchBtn.disabled = true;
    launchBtn.textContent = '发射中...';
    launchBtn.style.background = 'linear-gradient(135deg, #666, #444)';

    // 重置力度条
    const powerBar = document.getElementById('power-bar');
    const powerValue = document.getElementById('power-value');
    powerBar.style.width = '0%';
    powerValue.textContent = '力度：0%';

    this.updateUI();
  }

  updatePhysics(delta) {
    if (!this.gameObjects.ball || !this.state.isBallInPlay) return;

    const ball = this.gameObjects.ball;
    const velocity = this.state.ballVelocity;

    // 应用重力
    velocity.y += CONFIG.gravity * delta;

    // 应用速度
    ball.position.add(velocity.clone().multiplyScalar(delta));

    // 应用摩擦力
    velocity.multiplyScalar(CONFIG.friction);

    // 碰撞检测
    this.checkCollisions();

    // 检查是否掉落到底部
    if (ball.position.y < CONFIG.ballRadius && !this.checkSlotCollision()) {
      this.handleBallLost();
    }

    // 限制 Z 轴运动（2D 平面运动）- 保持在游戏板前面
    const targetZ = CONFIG.boardDepth / 2 + CONFIG.ballRadius;
    ball.position.z = targetZ;
    velocity.z = 0;

    // 旋转效果
    ball.rotation.x += velocity.length() * delta * 0.5;
  }

  checkCollisions() {
    const ball = this.gameObjects.ball;
    const ballRadius = CONFIG.ballRadius;

    // 墙壁碰撞
    const leftWallX = -CONFIG.boardWidth / 2 + ballRadius;
    const rightWallX = CONFIG.boardWidth / 2 - CONFIG.launchChannelWidth - ballRadius;
    const topWallY = CONFIG.launchChannelHeight + 5 - ballRadius;

    // 左墙
    if (ball.position.x < leftWallX && ball.position.y < topWallY) {
      ball.position.x = leftWallX;
      this.state.ballVelocity.x = Math.abs(this.state.ballVelocity.x) * CONFIG.restitution;
    }

    // 右墙（主区域和发射轨道之间的墙）- 只在隔墙高度范围内生效
    const middleWallTop = CONFIG.launchChannelHeight - 25;
    if (ball.position.x > rightWallX && ball.position.x < CONFIG.boardWidth / 2 &&
        ball.position.y < middleWallTop + 2) {
      ball.position.x = rightWallX;
      this.state.ballVelocity.x = -Math.abs(this.state.ballVelocity.x) * CONFIG.restitution;
    }

    // 发射轨道右墙
    const launchRightX = CONFIG.boardWidth / 2 + CONFIG.launchChannelWidth - ballRadius;
    if (ball.position.x > launchRightX && ball.position.y < CONFIG.launchChannelHeight) {
      ball.position.x = launchRightX;
      this.state.ballVelocity.x = -Math.abs(this.state.ballVelocity.x) * CONFIG.restitution;
    }

    // 顶墙 - 只在主区域（左侧）生效，发射轨道区域不限制
    if (ball.position.y > topWallY && ball.position.x < CONFIG.boardWidth / 2 - CONFIG.launchChannelWidth) {
      ball.position.y = topWallY;
      this.state.ballVelocity.y = -Math.abs(this.state.ballVelocity.y) * CONFIG.restitution;
    }

    // 细针碰撞
    for (const pin of this.gameObjects.pins) {
      const dx = ball.position.x - pin.position.x;
      const dy = ball.position.y - pin.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const minDist = ballRadius + pin.radius;

      if (distance < minDist) {
        // 计算法线
        const nx = dx / distance;
        const ny = dy / distance;

        // 将球推到针外
        ball.position.x = pin.position.x + nx * minDist;
        ball.position.y = pin.position.y + ny * minDist;

        // 随机偏转（增加游戏随机性）
        const randomDeflection = (Math.random() - 0.5) * 0.5;

        // 反射速度
        const dot = this.state.ballVelocity.x * nx + this.state.ballVelocity.y * ny;
        this.state.ballVelocity.x = (this.state.ballVelocity.x - 2 * dot * nx) * CONFIG.restitution + randomDeflection * 10;
        this.state.ballVelocity.y = (this.state.ballVelocity.y - 2 * dot * ny) * CONFIG.restitution;

        // 添加一些随机性
        this.state.ballVelocity.x += (Math.random() - 0.5) * 5;
      }
    }

    // 检查是否进入顶部水平轨道（从发射轨道过来）
    const channelDividerX = CONFIG.boardWidth / 2 - CONFIG.launchChannelWidth;
    if (ball.position.y > CONFIG.launchChannelHeight - 10 &&
        ball.position.x > channelDividerX &&
        ball.position.x < CONFIG.boardWidth / 2 + CONFIG.launchChannelWidth &&
        this.state.ballVelocity.y > 0) {
      // 给一个向左的强力速度，让球进入主区域
      this.state.ballVelocity.x = -50 - (this.launchPower / 100) * 30;
      this.state.ballVelocity.y = this.state.ballVelocity.y * 0.5; // 减小垂直速度
    }
  }

  checkSlotCollision() {
    const ball = this.gameObjects.ball;

    for (const slot of this.gameObjects.slots) {
      // 只检测激活的得分区域
      if (!this.state.activeSlots.includes(slot.index)) continue;

      const halfWidth = slot.width / 2;
      if (ball.position.x > slot.x - halfWidth &&
          ball.position.x < slot.x + halfWidth &&
          ball.position.y < slot.y + 5) {

        // 球进入口子
        this.handleBallInSlot(slot);
        return true;
      }
    }

    return false;
  }

  handleBallInSlot(slot) {
    this.state.isBallInPlay = false;

    // 计算得分：基础分 * 倍率
    const score = slot.baseScore * this.state.slotMultiplier;
    this.state.score += score;
    this.state.lastSlot = `#${slot.index + 1} (${this.state.slotMultiplier}x)`;

    // 检查是否获得奖励次数（每 100 分）
    this.checkBonusBalls(score);

    this.updateUI();
    this.showMessage(`得分：+${score}!`);

    // 重置球
    setTimeout(() => {
      this.resetBall();
      const launchBtn = document.getElementById('launch-btn');
      launchBtn.disabled = false;
      launchBtn.textContent = '按住发射';
      launchBtn.style.background = 'linear-gradient(135deg, #00ffff, #0080ff)';

      // 每次发射后重新随机得分区域
      this.randomizeSlots();
    }, 1500);
  }

  checkBonusBalls(newScore) {
    const totalScore = this.state.score;
    const newBonusCount = Math.floor(totalScore / CONFIG.bonusBallEvery);
    const oldBonusCount = Math.floor((totalScore - newScore) / CONFIG.bonusBallEvery);

    if (newBonusCount > oldBonusCount) {
      const bonusEarned = newBonusCount - oldBonusCount;
      this.state.ballsRemaining += bonusEarned;
      this.state.bonusBallsEarned += bonusEarned;
      this.showMessage(`奖励 +${bonusEarned} 次！`);
    }
  }

  handleBallLost() {
    this.state.isBallInPlay = false;

    // 检查是否还有剩余次数
    if (this.state.ballsRemaining <= 0) {
      this.endGame();
      return;
    }

    this.showMessage('失去弹珠！');

    setTimeout(() => {
      this.resetBall();
      const launchBtn = document.getElementById('launch-btn');
      launchBtn.disabled = false;
      launchBtn.textContent = '按住发射';
      launchBtn.style.background = 'linear-gradient(135deg, #00ffff, #0080ff)';

      // 失去弹珠后也重新随机得分区域
      this.randomizeSlots();
    }, 1000);
  }

  endGame() {
    this.state.isGameOver = true;
    this.state.ballsRemaining = 0;
    this.updateUI();

    // 检查是否进入前五
    if (this.leaderboard.isHighScore(this.state.score) && this.state.score > 0) {
      this.pendingScore = this.state.score;
      this.showNameInput();
    } else {
      this.showMessage('游戏结束！总分：' + this.state.score);
      this.showLeaderboard();
    }
  }

  restartGame() {
    // 重置游戏状态
    this.state = new GameState();
    this.pendingScore = null;
    this.launchPower = 0;
    this.chargingPower = false;

    // 关闭所有弹窗
    const nameModal = document.getElementById('name-input-modal');
    if (nameModal) nameModal.style.display = 'none';

    const leaderboardModal = document.getElementById('leaderboard-modal');
    if (leaderboardModal) leaderboardModal.style.display = 'none';

    // 重置弹珠位置
    this.resetBall();

    // 重新随机得分区域
    this.randomizeSlots();

    // 更新 UI
    this.updateUI();

    // 重置发射按钮状态
    const launchBtn = document.getElementById('launch-btn');
    launchBtn.disabled = false;
    launchBtn.textContent = '按住发射';
    launchBtn.style.background = 'linear-gradient(135deg, #00ffff, #0080ff)';

    // 重置力度条
    const powerBar = document.getElementById('power-bar');
    const powerValue = document.getElementById('power-value');
    powerBar.style.width = '0%';
    powerValue.textContent = '力度：0%';

    this.showMessage('游戏重新开始！');
  }

  showNameInput() {
    // 创建或显示名字输入框
    let modal = document.getElementById('name-input-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'name-input-modal';
      modal.innerHTML = `
        <div class="modal-content">
          <h3>🎉 恭喜进入前五！</h3>
          <p>您的分数：<span id="pending-score"></span></p>
          <input type="text" id="player-name" placeholder="请输入名字 (最多 10 字)" maxlength="10" autocomplete="off">
          <div class="modal-buttons">
            <button id="submit-score">提交</button>
            <button id="skip-score">跳过</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    // 每次都重新绑定事件（使用 onclick 避免重复绑定）
    const submitBtn = document.getElementById('submit-score');
    const skipBtn = document.getElementById('skip-score');
    const nameInput = document.getElementById('player-name');

    submitBtn.onclick = () => this.submitScore();
    skipBtn.onclick = () => this.skipScore();
    nameInput.onkeypress = (e) => {
      if (e.key === 'Enter') this.submitScore();
    };

    document.getElementById('pending-score').textContent = this.pendingScore;
    modal.style.display = 'flex';
    nameInput.value = '';
    nameInput.focus();
  }

  submitScore() {
    const nameInput = document.getElementById('player-name');
    const name = nameInput ? nameInput.value.trim() || '匿名' : '匿名';

    this.leaderboard.addEntry(this.pendingScore, name);
    this.hideNameInput();
    this.showMessage('分数已保存！');
    this.showLeaderboard();
  }

  skipScore() {
    this.hideNameInput();
    this.showMessage('游戏结束！总分：' + this.state.score);
    this.showLeaderboard();
  }

  hideNameInput() {
    const modal = document.getElementById('name-input-modal');
    if (modal) modal.style.display = 'none';
  }

  showLeaderboard() {
    let modal = document.getElementById('leaderboard-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'leaderboard-modal';
      modal.innerHTML = `
        <div class="modal-content leaderboard">
          <h3>🏆 排行榜 TOP 5</h3>
          <div id="leaderboard-list"></div>
          <button id="close-leaderboard">关闭</button>
        </div>
      `;
      document.body.appendChild(modal);
    }

    // 每次都重新绑定关闭按钮事件（避免重复绑定，先移除）
    const closeBtn = document.getElementById('close-leaderboard');
    if (closeBtn) {
      closeBtn.onclick = () => {
        modal.style.display = 'none';
      };
    }

    const list = document.getElementById('leaderboard-list');
    const entries = this.leaderboard.getEntries();

    if (entries.length === 0) {
      list.innerHTML = '<p class="no-scores">暂无记录</p>';
    } else {
      list.innerHTML = entries.map((entry, index) => `
        <div class="leaderboard-entry ${index === 0 ? 'first' : ''}">
          <span class="rank">${index + 1}</span>
          <span class="name">${this.escapeHtml(entry.name)}</span>
          <span class="score">${entry.score}</span>
          <span class="date">${entry.date}</span>
        </div>
      `).join('');
    }

    modal.style.display = 'flex';
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  updateUI() {
    document.querySelector('.combined-panel #multiplier-display span:last-child').textContent = `${this.state.slotMultiplier}x`;
    document.querySelector('.combined-panel #total-score span:last-child').textContent = this.state.score;
    document.querySelector('.combined-panel #last-slot span:last-child').textContent = this.state.lastSlot;

    // 更新剩余次数显示
    const ballsDisplay = document.getElementById('balls-remaining');
    if (ballsDisplay) {
      ballsDisplay.textContent = `剩余次数：${this.state.ballsRemaining}`;
    }

    // 更新奖励次数显示
    const bonusDisplay = document.getElementById('bonus-balls');
    if (bonusDisplay) {
      bonusDisplay.textContent = `奖励次数：${this.state.bonusBallsEarned}`;
    }
  }

  showMessage(text) {
    const messageEl = document.getElementById('message');
    messageEl.textContent = text;
    messageEl.style.display = 'block';

    setTimeout(() => {
      messageEl.style.display = 'none';
    }, 2000);
  }

  setupUI() {
    const powerBar = document.getElementById('power-bar');
    const powerValue = document.getElementById('power-value');
    const launchBtn = document.getElementById('launch-btn');

    // 鼠标/指针按下 - 开始充能
    const startCharging = (e) => {
      e.preventDefault();
      if (this.state.isBallInPlay) return;
      this.chargingPower = true;
      this.launchPower = 0;
      launchBtn.textContent = '松开 发射';
      launchBtn.style.background = 'linear-gradient(135deg, #ff6b6b, #ee5a5a)';
    };

    // 鼠标/指针松开 - 发射
    const stopCharging = (e) => {
      e.preventDefault();
      if (this.chargingPower) {
        this.chargingPower = false;
        this.launchBall();
        launchBtn.textContent = '发射中...';
      }
    };

    // 鼠标/触摸离开按钮 - 重置
    const cancelCharging = (e) => {
      e.preventDefault();
      if (this.chargingPower) {
        this.chargingPower = false;
        this.launchPower = 0;
        this.updatePowerBar(powerBar, powerValue);
        launchBtn.textContent = '按住发射';
        launchBtn.style.background = 'linear-gradient(135deg, #00ffff, #0080ff)';
      }
    };

    // 指针事件（支持鼠标和触摸）
    launchBtn.addEventListener('pointerdown', startCharging);
    launchBtn.addEventListener('pointerup', stopCharging);
    launchBtn.addEventListener('pointerleave', cancelCharging);
    launchBtn.addEventListener('pointercancel', cancelCharging);

    // 兼容鼠标事件
    launchBtn.addEventListener('mousedown', startCharging);
    launchBtn.addEventListener('mouseup', stopCharging);
    launchBtn.addEventListener('mouseleave', cancelCharging);

    // 兼容触摸事件
    launchBtn.addEventListener('touchstart', startCharging, { passive: false });
    launchBtn.addEventListener('touchend', stopCharging);
    launchBtn.addEventListener('touchcancel', cancelCharging);

    // 排行榜按钮
    const viewLeaderboardBtn = document.getElementById('view-leaderboard-btn');
    if (viewLeaderboardBtn) {
      viewLeaderboardBtn.addEventListener('click', () => {
        this.showLeaderboard();
      });
    }

    // 重新开始按钮
    const restartBtn = document.getElementById('restart-btn');
    if (restartBtn) {
      restartBtn.addEventListener('click', () => {
        this.restartGame();
      });
    }
  }

  updatePowerBar(powerBar, powerValue) {
    const power = Math.min(this.launchPower, 100);
    powerBar.style.width = power + '%';
    powerValue.textContent = `力度：${Math.round(power)}%`;

    // 满力度时添加动画效果
    if (power >= 100) {
      powerBar.classList.add('max-power');
    } else {
      powerBar.classList.remove('max-power');
    }
  }

  updateCharging(delta) {
    if (this.chargingPower) {
      this.launchPower += this.powerIncreaseRate * delta;
      if (this.launchPower > 100) {
        this.launchPower = 100;
      }
      const powerBar = document.getElementById('power-bar');
      const powerValue = document.getElementById('power-value');
      this.updatePowerBar(powerBar, powerValue);
    }
  }

  onWindowResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / height;

    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);

    // 根据屏幕大小调整相机
    this.updateCameraForScreen(aspect);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = Math.min(this.clock.getDelta(), 0.1);

    this.updateCharging(delta);
    this.updatePhysics(delta);

    this.renderer.render(this.scene, this.camera);
  }
}

// 启动游戏
new PinballGame();
