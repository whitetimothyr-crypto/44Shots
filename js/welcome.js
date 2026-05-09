// js/welcome.js — 44 Shots mesh join flow
// Handles: game create UI (coach), join-via-link welcome modal,
// one-time walkthrough for new mesh participants, QR display.
// Depends on: FelixAuth, FelixGame, NomosSync

(function () {
  const WALKTHROUGH_KEY = 'plym_walkthrough_v1';

  // ============================================================
  // Modal HTML injected into body
  // ============================================================
  const MODAL_HTML = `
    <div id="nomosWelcomeBackdrop" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9000;align-items:center;justify-content:center;">
      <div id="nomosWelcomeModal" style="background:#1a1a2e;color:#fff;border-radius:16px;padding:28px 24px;max-width:360px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.6);font-family:system-ui,sans-serif;">

        <!-- START: appears on load when no active game -->
        <div id="nomosScreenStart" style="display:none;">
          <div style="text-align:center;margin-bottom:20px;">
            <div style="font-size:2rem;">🏒</div>
            <h2 style="margin:8px 0 4px;font-size:1.2rem;font-weight:700;">Start Tracking</h2>
            <p style="margin:0;font-size:0.85rem;color:#aaa;">Join a game or create one</p>
          </div>
          <input id="nomosJoinCodeInput" type="text" placeholder="Game ID (e.g. PLYM-0001)" autocapitalize="characters" autocomplete="off" style="width:100%;padding:12px;background:#0d1117;color:#fff;border:1px solid #333;border-radius:8px;font-size:1rem;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;box-sizing:border-box;">
          <button id="nomosJoinBtn" style="width:100%;padding:14px;background:#4fc3f7;color:#000;border:none;border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer;">Join Game</button>
          <div style="display:flex;align-items:center;gap:8px;margin:14px 0;">
            <div style="flex:1;height:1px;background:#333;"></div>
            <span style="font-size:0.75rem;color:#666;">OR</span>
            <div style="flex:1;height:1px;background:#333;"></div>
          </div>
          <button id="nomosScanQRBtn" style="width:100%;padding:14px;background:#263238;color:#fff;border:1px solid #333;border-radius:10px;font-size:0.95rem;cursor:pointer;margin-bottom:10px;">📷 Scan QR Code</button>
          <input type="file" id="nomosQRFileInput" accept="image/*" capture="environment" style="display:none;">
          <button id="nomosStartCreateBtn" style="width:100%;padding:12px;background:transparent;color:#4fc3f7;border:1px solid #4fc3f7;border-radius:10px;font-size:0.95rem;cursor:pointer;">Create New Game</button>
          <p id="nomosStartError" style="display:none;color:#ef5350;font-size:0.85rem;text-align:center;margin:10px 0 0;"></p>
        </div>

        <!-- SCHEDULED: pre-start view for games not yet kicked off -->
        <div id="nomosScreenScheduled" style="display:none;">
          <div style="text-align:center;margin-bottom:16px;">
            <div style="font-size:2rem;">⏳</div>
            <h2 style="margin:8px 0 4px;font-size:1.2rem;font-weight:700;">Game Scheduled</h2>
            <p style="margin:0;font-size:0.85rem;color:#aaa;">You're all set for this game</p>
          </div>
          <div style="background:#0d1117;border-radius:10px;padding:14px;margin-bottom:16px;text-align:center;">
            <div id="nomosScheduledCode" style="font-size:1.5rem;font-weight:800;letter-spacing:2px;color:#4fc3f7;">--</div>
            <div id="nomosScheduledStartTime" style="font-size:0.9rem;color:#aaa;margin-top:6px;">Game starts at 9:00 AM</div>
          </div>
          <p style="margin:0 0 18px;font-size:0.85rem;color:#aaa;line-height:1.5;text-align:center;">
            Feel free to explore all features. When the coach starts the game, everything resets and live tracking begins.
          </p>
          <button id="nomosScheduledExploreBtn" style="width:100%;padding:14px;background:#4fc3f7;color:#000;border:none;border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer;">
            Explore the app
          </button>
        </div>

        <!-- SCREEN 1: Welcome + game info -->
        <div id="nomosScreen1">
          <div style="text-align:center;margin-bottom:16px;">
            <div style="font-size:2rem;">🏒</div>
            <h2 id="nomosWelcomeTitle" style="margin:8px 0 4px;font-size:1.2rem;font-weight:700;">Welcome to 44 Shots</h2>
            <p id="nomosWelcomeSubtitle" style="margin:0;font-size:0.85rem;color:#aaa;">You've been invited to track this game</p>
          </div>
          <div id="nomosGameCard" style="background:#0d1117;border-radius:10px;padding:14px;margin-bottom:20px;text-align:center;">
            <div id="nomosGameCode" style="font-size:1.5rem;font-weight:800;letter-spacing:2px;color:#4fc3f7;">--</div>
            <div id="nomosGameMeta" style="font-size:0.8rem;color:#888;margin-top:4px;">Loading game...</div>
          </div>
          <button id="nomosStartWalkthrough" style="width:100%;padding:14px;background:#4fc3f7;color:#000;border:none;border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer;">
            Let's go →
          </button>
          <button id="nomosSkipWalkthrough" style="width:100%;padding:10px;background:transparent;color:#666;border:none;font-size:0.85rem;cursor:pointer;margin-top:6px;">
            Skip intro, take me to the rink
          </button>
        </div>

        <!-- SCREEN 2: Walkthrough step 1 -->
        <div id="nomosScreen2" style="display:none;">
          <div style="text-align:center;margin-bottom:20px;">
            <div style="font-size:2.5rem;">👆</div>
            <h3 style="margin:10px 0 8px;font-size:1.1rem;">Tap the rink to log shots</h3>
            <p style="margin:0;font-size:0.85rem;color:#aaa;line-height:1.5;">
              Tap anywhere on the rink diagram where the shot came from.<br><br>
              Each tap logs a <strong style="color:#4fc3f7;">Save</strong> by default.
            </p>
          </div>
          <button class="nomosNext" data-next="nomosScreen3" style="width:100%;padding:14px;background:#4fc3f7;color:#000;border:none;border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer;">Next →</button>
        </div>

        <!-- SCREEN 3: Walkthrough step 2 -->
        <div id="nomosScreen3" style="display:none;">
          <div style="text-align:center;margin-bottom:20px;">
            <div style="font-size:2.5rem;">🎯</div>
            <h3 style="margin:10px 0 8px;font-size:1.1rem;">Goal, Miss, or Undo</h3>
            <p style="margin:0;font-size:0.85rem;color:#aaa;line-height:1.5;">
              After each tap, corner buttons appear briefly.<br><br>
              Tap <strong style="color:#ef5350;">Goal</strong> if it scored,
              <strong style="color:#888;">Miss</strong> if it missed the net,
              or <strong style="color:#ffa726;">Undo</strong> if you tapped wrong.
            </p>
          </div>
          <button class="nomosNext" data-next="nomosScreen4" style="width:100%;padding:14px;background:#4fc3f7;color:#000;border:none;border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer;">Next →</button>
        </div>

        <!-- SCREEN 4: Walkthrough step 3 -->
        <div id="nomosScreen4" style="display:none;">
          <div style="text-align:center;margin-bottom:20px;">
            <div style="font-size:2.5rem;">📊</div>
            <h3 style="margin:10px 0 8px;font-size:1.1rem;">Your data builds trust</h3>
            <p style="margin:0;font-size:0.85rem;color:#aaa;line-height:1.5;">
              You're one of several people tracking this game.<br><br>
              The more accurate you are, the higher your <strong style="color:#4fc3f7;">trust score</strong> — and the more your data shapes the final stats.
            </p>
          </div>
          <button id="nomosFinishWalkthrough" style="width:100%;padding:14px;background:#4fc3f7;color:#000;border:none;border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer;">
            Take me to the rink 🏒
          </button>
        </div>

      </div>
    </div>

    <!-- Coach: Create Game Panel -->
    <div id="nomosCreateGamePanel" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9000;align-items:center;justify-content:center;">
      <div style="background:#1a1a2e;color:#fff;border-radius:16px;padding:28px 24px;max-width:360px;width:90%;font-family:system-ui,sans-serif;">
        <h2 style="margin:0 0 20px;font-size:1.2rem;">Create Game</h2>
        <input id="nomosAwayTeam" type="text" placeholder="Opponent team name" style="width:100%;padding:12px;background:#0d1117;color:#fff;border:1px solid #333;border-radius:8px;font-size:0.95rem;margin-bottom:12px;box-sizing:border-box;">
        <input id="nomosRinkName" type="text" placeholder="Rink name (optional)" style="width:100%;padding:12px;background:#0d1117;color:#fff;border:1px solid #333;border-radius:8px;font-size:0.95rem;margin-bottom:12px;box-sizing:border-box;">
        <input id="nomosAgeBracket" type="text" placeholder="Age bracket (e.g. Squirt, Peewee)" style="width:100%;padding:12px;background:#0d1117;color:#fff;border:1px solid #333;border-radius:8px;font-size:0.95rem;margin-bottom:20px;box-sizing:border-box;">
        <button id="nomosCreateGameBtn" style="width:100%;padding:14px;background:#4fc3f7;color:#000;border:none;border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer;">Create Game</button>
        <button id="nomosCreateGameCancel" style="width:100%;padding:10px;background:transparent;color:#666;border:none;font-size:0.85rem;cursor:pointer;margin-top:6px;">Cancel</button>

        <!-- Begin Game: transitions an already-scheduled active game to in_progress -->
        <div style="border-top:1px solid #333;margin-top:18px;padding-top:14px;">
          <p style="margin:0 0 10px;font-size:0.8rem;color:#aaa;text-align:center;">If a game is already scheduled:</p>
          <button id="nomosBeginGameBtn" style="width:100%;padding:14px;background:#ef5350;color:#fff;border:none;border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer;">
            Begin Game
          </button>
        </div>

        <!-- Post-creation: share UI -->
        <div id="nomosSharePanel" style="display:none;margin-top:20px;text-align:center;">
          <div id="nomosCreatedCode" style="font-size:1.8rem;font-weight:800;letter-spacing:3px;color:#4fc3f7;margin-bottom:8px;"></div>
          <p style="font-size:0.8rem;color:#aaa;margin:0 0 12px;">Share this link or QR with your scorers</p>
          <input id="nomosShareLink" readonly style="width:100%;padding:10px;background:#0d1117;color:#aaa;border:1px solid #333;border-radius:8px;font-size:0.75rem;margin-bottom:12px;box-sizing:border-box;">
          <button id="nomosCopyLink" style="width:100%;padding:12px;background:#263238;color:#fff;border:none;border-radius:8px;font-size:0.9rem;cursor:pointer;margin-bottom:12px;">📋 Copy Link</button>
          <img id="nomosQRCode" src="" alt="QR Code" style="width:160px;height:160px;border-radius:8px;background:#fff;padding:8px;display:block;margin:0 auto 12px;">
          <button id="nomosShareDone" style="width:100%;padding:12px;background:#4fc3f7;color:#000;border:none;border-radius:10px;font-size:0.95rem;font-weight:700;cursor:pointer;">Done — Start Tracking</button>
        </div>
      </div>
    </div>
  `;

  // ============================================================
  // Helpers
  // ============================================================

  function show(el) { if (el) el.style.display = 'flex'; }
  function hide(el) { if (el) el.style.display = 'none'; }

  function showScreen(id) {
    ['nomosScreenStart','nomosScreenScheduled','nomosScreen1','nomosScreen2','nomosScreen3','nomosScreen4'].forEach((s) => {
      const el = document.getElementById(s);
      if (el) el.style.display = s === id ? 'block' : 'none';
    });
  }

  function hasSeenWalkthrough() {
    return localStorage.getItem(WALKTHROUGH_KEY) === '1';
  }

  function markWalkthroughSeen() {
    localStorage.setItem(WALKTHROUGH_KEY, '1');
  }

  function closeWelcome() {
    hide(document.getElementById('nomosWelcomeBackdrop'));
  }

  function closeCreatePanel() {
    hide(document.getElementById('nomosCreateGamePanel'));
  }

  // ============================================================
  // Wire events
  // ============================================================

  function wireEvents() {
    // Walkthrough next buttons
    document.querySelectorAll('.nomosNext').forEach((btn) => {
      btn.addEventListener('click', () => {
        showScreen(btn.dataset.next);
      });
    });

    // Start walkthrough
    document.getElementById('nomosStartWalkthrough').addEventListener('click', () => {
      showScreen('nomosScreen2');
    });

    // Skip walkthrough
    document.getElementById('nomosSkipWalkthrough').addEventListener('click', () => {
      markWalkthroughSeen();
      closeWelcome();
    });

    // Finish walkthrough
    document.getElementById('nomosFinishWalkthrough').addEventListener('click', () => {
      markWalkthroughSeen();
      closeWelcome();
    });

    // Create game button
    document.getElementById('nomosCreateGameBtn').addEventListener('click', async () => {
      const btn = document.getElementById('nomosCreateGameBtn');
      btn.disabled = true;
      btn.textContent = 'Creating...';
      try {
        const game = await FelixGame.createGame({
          away_team_name: document.getElementById('nomosAwayTeam').value.trim() || null,
          rink_name: document.getElementById('nomosRinkName').value.trim() || null,
          age_bracket: document.getElementById('nomosAgeBracket').value.trim() || null
        });

        // Show share panel
        const shareURL = FelixGame.getShareURL();
        const qrURL = FelixGame.getQRUrl();
        document.getElementById('nomosCreatedCode').textContent = game.code;
        document.getElementById('nomosShareLink').value = shareURL;
        document.getElementById('nomosQRCode').src = qrURL;
        show(document.getElementById('nomosSharePanel'));
        btn.style.display = 'none';
        document.getElementById('nomosCreateGameCancel').style.display = 'none';

      } catch (e) {
        alert('Could not create game: ' + e.message);
        btn.disabled = false;
        btn.textContent = 'Create Game';
      }
    });

    // Copy link
    document.getElementById('nomosCopyLink').addEventListener('click', () => {
      const link = document.getElementById('nomosShareLink').value;
      navigator.clipboard.writeText(link).then(() => {
        document.getElementById('nomosCopyLink').textContent = '✅ Copied!';
        setTimeout(() => { document.getElementById('nomosCopyLink').textContent = '📋 Copy Link'; }, 2000);
      });
    });

    // Create game cancel
    document.getElementById('nomosCreateGameCancel').addEventListener('click', closeCreatePanel);

    // Share done
    document.getElementById('nomosShareDone').addEventListener('click', closeCreatePanel);

    // Begin Game (scheduled -> in_progress)
    document.getElementById('nomosBeginGameBtn').addEventListener('click', async () => {
      const btn = document.getElementById('nomosBeginGameBtn');
      btn.disabled = true;
      btn.textContent = 'Starting...';
      try {
        await FelixGame.beginGame();
        closeCreatePanel();
      } catch (e) {
        alert('Could not begin game: ' + e.message);
        btn.disabled = false;
        btn.textContent = 'Begin Game';
      }
    });

    // Scheduled-screen Explore button: just dismisses the modal
    document.getElementById('nomosScheduledExploreBtn').addEventListener('click', closeWelcome);

    // ----- Start screen: Join by code -----
    const joinHandler = async () => {
      const input = document.getElementById('nomosJoinCodeInput');
      const errEl = document.getElementById('nomosStartError');
      const btn = document.getElementById('nomosJoinBtn');
      const code = (input.value || '').trim().toUpperCase();
      if (!code) {
        errEl.textContent = 'Enter a Game ID';
        errEl.style.display = 'block';
        return;
      }
      errEl.style.display = 'none';
      btn.disabled = true;
      btn.textContent = 'Joining...';
      try {
        await FelixGame.joinGame(code);
        closeWelcome();
      } catch (e) {
        errEl.textContent = 'Could not join: ' + e.message;
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Join Game';
      }
    };
    document.getElementById('nomosJoinBtn').addEventListener('click', joinHandler);
    document.getElementById('nomosJoinCodeInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') joinHandler();
    });

    // ----- Start screen: Scan QR (file picker -> BarcodeDetector) -----
    document.getElementById('nomosScanQRBtn').addEventListener('click', () => {
      document.getElementById('nomosQRFileInput').click();
    });
    document.getElementById('nomosQRFileInput').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const errEl = document.getElementById('nomosStartError');
      if (!('BarcodeDetector' in window)) {
        errEl.textContent = 'QR scanning not supported on this device. Enter Game ID manually.';
        errEl.style.display = 'block';
        return;
      }
      try {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        const bitmap = await createImageBitmap(file);
        const codes = await detector.detect(bitmap);
        if (!codes.length) {
          errEl.textContent = 'No QR code detected. Try again.';
          errEl.style.display = 'block';
          return;
        }
        const raw = codes[0].rawValue || '';
        const match = raw.match(/[?&]game=([^&]+)/);
        const code = (match ? decodeURIComponent(match[1]) : raw).trim().toUpperCase();
        document.getElementById('nomosJoinCodeInput').value = code;
        joinHandler();
      } catch (err) {
        errEl.textContent = 'QR scan failed: ' + err.message;
        errEl.style.display = 'block';
      }
    });

    // ----- Start screen: Create new game (jumps to coach create panel) -----
    document.getElementById('nomosStartCreateBtn').addEventListener('click', () => {
      closeWelcome();
      FelixWelcome.showCreateGame();
    });
  }

  // ============================================================
  // Public API
  // ============================================================

  window.FelixWelcome = {

    // Show welcome modal for a user joining via game link
    showJoinWelcome(game) {
      const backdrop = document.getElementById('nomosWelcomeBackdrop');
      if (!backdrop) return;

      document.getElementById('nomosGameCode').textContent = game.code || '--';
      document.getElementById('nomosGameMeta').textContent =
        [game.home_team_name, game.away_team_name].filter(Boolean).join(' vs ') +
        (game.rink_name ? ` · ${game.rink_name}` : '') +
        ` · ${game.game_date || 'Today'}`;

      if (game.status === 'scheduled') {
        // Pre-start: show scheduled screen, no walkthrough yet
        document.getElementById('nomosScheduledCode').textContent = game.code || '--';
        showScreen('nomosScreenScheduled');
      } else if (hasSeenWalkthrough()) {
        showScreen('nomosScreen1');
        document.getElementById('nomosStartWalkthrough').style.display = 'none';
        document.getElementById('nomosSkipWalkthrough').textContent = 'Got it, take me to the rink';
      } else {
        showScreen('nomosScreen1');
        document.getElementById('nomosStartWalkthrough').style.display = 'block';
      }

      show(backdrop);
    },

    // Show the start modal (Game ID input + QR scan + create).
    // Called on load when no ?game= URL param and no cached active_game_id.
    showGameStart() {
      const backdrop = document.getElementById('nomosWelcomeBackdrop');
      if (!backdrop) return;
      const input = document.getElementById('nomosJoinCodeInput');
      if (input) input.value = '';
      const errEl = document.getElementById('nomosStartError');
      if (errEl) errEl.style.display = 'none';
      const joinBtn = document.getElementById('nomosJoinBtn');
      if (joinBtn) { joinBtn.disabled = false; joinBtn.textContent = 'Join Game'; }
      // Hide QR button if BarcodeDetector unsupported (file fallback still works
      // but most users won't have a saved QR image — skip the dead path).
      const qrBtn = document.getElementById('nomosScanQRBtn');
      if (qrBtn) qrBtn.style.display = ('BarcodeDetector' in window) ? 'block' : 'none';
      showScreen('nomosScreenStart');
      show(backdrop);
    },

    // Show create game panel (coach only)
    showCreateGame() {
      const panel = document.getElementById('nomosCreateGamePanel');
      if (!panel) return;
      // Reset
      document.getElementById('nomosSharePanel').style.display = 'none';
      document.getElementById('nomosCreateGameBtn').style.display = 'block';
      document.getElementById('nomosCreateGameBtn').disabled = false;
      document.getElementById('nomosCreateGameBtn').textContent = 'Create Game';
      document.getElementById('nomosCreateGameCancel').style.display = 'block';
      show(panel);
    }
  };

  // ============================================================
  // Init: inject HTML, wire events, listen for game joins
  // ============================================================

  document.addEventListener('DOMContentLoaded', async () => {
    // Inject modal HTML
    const container = document.createElement('div');
    container.innerHTML = MODAL_HTML;
    document.body.appendChild(container);

    wireEvents();

    // Sync header team labels whenever the active game changes.
    FelixGame.onGameChange((evt) => {
      if (evt && evt.game) {
        const hl = document.getElementById('homeRowLabel');
        const al = document.getElementById('awayRowLabel');
        if (hl) hl.textContent = evt.game.home_team_name || 'HOME';
        if (al) al.textContent = evt.game.away_team_name || 'AWAY';
      }
    });

    // Resolve active game on load:
    //   1. ?game=PLYM-0001 in URL  -> joinGame
    //   2. active_game_id in IndexedDB -> resumeFromCache
    //   3. neither -> show the start modal (Game ID / QR / Create)
    try {
      const game = await FelixGame.init();
      if (!game) FelixWelcome.showGameStart();
    } catch (e) {
      console.warn('FelixGame.init failed:', e.message);
      FelixWelcome.showGameStart();
    }
  });

})();
