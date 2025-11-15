// South Tyrol Music Network - Interactive Graph
class MusicNetwork {
    constructor() {
        this.canvas = document.getElementById('network-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.nodes = [];
        this.connections = [];
        this.artists = [];
        
        // Graph settings
        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        this.isDragging = false;
    this.nodeDragging = false;
    this.draggedNode = null;
    this.nodeDragOffset = { x: 0, y: 0 };
        this.dragStart = { x: 0, y: 0 };
        this.selectedNode = null;
        
        // Node types and colors
        this.nodeTypes = {
            artist: { color: '#00ff00', radius: 8 },
            dj: { color: '#ff6f00', radius: 8 },
            location: { color: '#ff0080', radius: 5 },
            genre: { color: '#0080ff', radius: 6 },
            collective: { color: '#ffff00', radius: 7 },
            other: { color: '#bfbfbf', radius: 7 }
        };

    // Hover interaction state (desktop)
    this.hoverNode = null;             // currently activated hover node
    this._hoverCandidate = null;       // node beneath cursor candidate before delay
    this._hoverTimer = null;           // debounce timer id for hover activation
    this.hoverProgress = 0;            // 0..1 animation progress for fade
    this._hoverAnimating = false;      // whether an animation rAF loop is running
    this.hoverActive = false;          // whether hover effect is currently active
    this.hoverConnectedNodes = new Set(); // ids of nodes related to hoverNode
    this.hoverConnectedEdges = new Set(); // keys of edges related to hoverNode

    // runtime caches to avoid O(n^2) lookups during render/tick
    this.nodeMap = new Map();
    this.connectionRefs = []; // { from: nodeObj, to: nodeObj, type }

        // Precompute muted label colors (slightly desaturated / darker)
        this.mutedLabelColor = {};
        for (const k of Object.keys(this.nodeTypes)) {
            this.mutedLabelColor[k] = this._mutedColor(this.nodeTypes[k].color, 0.5);
        }

        // Keep original canvas styling by default (set to false to use enhanced visuals)
        this.legacyStyle = true;

        // Visibility toggles for legend filtering
        this.visibleTypes = {
            artist: true,
            dj: true,
            location: true,
            genre: true,
            collective: true,
            other: true
        };

        // View & search state
        this.searchTerm = '';
        this.filteredNodeIds = null;
        this.activeView = 'network';

        // Cached DOM references
        this.networkContainer = null;
        this.listContainer = null;
        this.nodeListElement = null;
        this.listEmptyState = null;
        this.viewToggleButton = null;
        this.searchInput = null;
        this.legendItems = new Map();
        this.explainerTextElement = null;
        this.explainerMessages = {
            network: '',
            list: 'see a list of all included nodes. search or toggle categories to filter list.'
        };
        this.controlsBottomRow = null;
        this.aboutButton = null;
        this.aboutButtonHome = null;
        this.legendToggleButton = null;
        this.legendCollapsed = false;
        this.mobileControlsActive = false;
    this._handleResize = null;
    this._handleViewportResize = null;
    this._resizeDebounce = null;

    // Prevent unexpected automatic layout runs immediately after user interaction
    this._suppressRunLayoutUntil = 0; // timestamp in ms until which runLayout is suppressed

        // Tuning parameters (exposed to UI sliders)
        this.tuning = {
            repulsion: 0.03,        // repulsion factor (lower = less push)
            attraction: 0.8,        // attraction base (higher = nodes pulled together more)
            gravity: 0.5,           // gravity toward center (screenshot default)
            sameTypeRepel: 0.55,    // extra repulsion for same-type nodes (producers/djs)
            minDistance:40,        // minimum readable distance (px)
            iterations: 270         // layout iterations when running
        };

    // Multiplier applied to the automatic fit/initial view to allow a zoomed-in experience
    // Reduce on mobile to prevent over-zooming while preserving a slightly elevated zoom on desktop.
    this.initialZoomMultiplier = 2;

    // Desktop expansion multiplier to make the default view slightly more expanded
    // (values >1 zoom in a bit). Tune as desired (1.0 = no change).
    // User requested ~10% more expansion.
    this.desktopExpandMultiplier = 1.30;
    // Desktop initial zoom multiplier (how much to zoom in on desktop by default).
    // Set to 2.0 to be closer to the mobile default zoom experience.
    this.desktopInitialZoomMultiplier = 1.0;

        // internal debounce timer used when sliders auto-run a short layout
        this._tuningDebounceTimer = null;

    // Desktop layout multiplier: how many viewport-widths/heights the virtual layout
    // area should span. A value of 3 means the layout algorithm works in a space
    // three times the visible viewport, allowing more spread and pan room.
    this.desktopLayoutMultiplier = 3;
    // Mobile layout multiplier controls how much extra space the force layout can
    // occupy on smaller devices, giving more room for nodes to spread before final scaling.
    this.mobileLayoutMultiplier = 1.8;
    // Base scale the camera uses when centering on mobile before any dynamic fit adjustments.
    this.mobileDefaultCenterScale = 1.6;

    // auto-centering while layout runs (disabled when user interacts)
    this.autoCentering = false; // enabled briefly after load or reset via ticks
    this.autoCenterTicks = 0;   // number of ticks to auto-center for

    // Control whether automatic layout runs (from resize/timers) are allowed after init.
    // We'll disable automatic re-layouts after initialization so user navigation doesn't
    // trigger unexpected recalculations. Explicit UI actions (Run Layout button) still work.
    this._autoLayoutEnabled = true;
    // Track whether a modal dialog is currently overlaying the graph to avoid recalculations
    this._modalOpen = false;
        
        this.init();
    }

    // Return a muted version of a hex color by blending toward middle grey
    _mutedColor(hex, amount = 0.5) {
        try {
            const h = hex.replace('#','');
            const r = parseInt(h.substring(0,2),16);
            const g = parseInt(h.substring(2,4),16);
            const b = parseInt(h.substring(4,6),16);
            const mr = Math.round(r * (1 - amount) + 128 * amount);
            const mg = Math.round(g * (1 - amount) + 128 * amount);
            const mb = Math.round(b * (1 - amount) + 128 * amount);
            const toHex = (v) => ('0' + v.toString(16)).slice(-2);
            return `#${toHex(mr)}${toHex(mg)}${toHex(mb)}`;
        } catch (e) {
            return hex;
        }
    }

    // Darken a hex color by blending it toward black. amount between 0 (no change) and 1 (black)
    _darkenColor(hex, amount = 0.5) {
        try {
            const h = (hex || '').replace('#','');
            if (h.length !== 6) return hex;
            const r = parseInt(h.substring(0,2),16);
            const g = parseInt(h.substring(2,4),16);
            const b = parseInt(h.substring(4,6),16);
            const dr = Math.round(r * (1 - amount));
            const dg = Math.round(g * (1 - amount));
            const db = Math.round(b * (1 - amount));
            const toHex = (v) => ('0' + v.toString(16)).slice(-2);
            return `#${toHex(dr)}${toHex(dg)}${toHex(db)}`;
        } catch (e) {
            return hex;
        }
    }
    
    async init() {
        this.setupCanvas();
        this.setupEventListeners();
        
        await this.loadData();
        this.createNodes();
        this.createConnections();
    // Ensure indexes are built in case nodes changed
    this.buildIndexes();
        this.setupSimulation();
        this.centerView();
        this.render();
        // Apply the default tuned layout once on load so the graph appears with these settings
        try {
            this.runLayout(this.tuning.iterations, true);
            this.render();
        } catch (e) {
        }
        // remove tuning panel if present (we're hiding the overlay and using the built-in layout)
        const _tp = document.getElementById('tuning-panel');
        if (_tp) _tp.remove();
        document.getElementById('loading').style.display = 'none';
    // After initialization, disable automatic layout triggers so user navigation remains stable.
    this._autoLayoutEnabled = false;
    }

    /***********************
     * d3-force integration
     ***********************/
    setupSimulation() {
        try {
            this.runLayout(this.tuning.iterations, true);
            this.render();
        } catch (e) {
        }
    }

    // Improved, controlled force-directed layout (one-off)
    // Goals: reduce explosive repulsion, limit excessive attraction between nodes of same type (producers/djs),
    // keep layout readable and let users move nodes freely after layout finishes.
    runLayout(iterations = 180, force = false) {
        if (!force && this._modalOpen) {
            return;
        }

        // If automatic layouts were disabled after init and this call is not forced, skip.
        if (!force && !this._autoLayoutEnabled) {
            return;
        }

        // Skip automatic layout runs if we've recently had user interaction that should
        // suppress auto-layout (prevents unexpected re-layout on initial clicks).
        if (!force && Date.now() < (this._suppressRunLayoutUntil || 0)) {
            return;
        }

        if (!this.nodes || this.nodes.length === 0) return;

        const isMobile = window.innerWidth <= 768;
        const canvasRect = this.canvas.getBoundingClientRect();
        const width = canvasRect.width;
        const height = canvasRect.height;

        this.buildIndexes();
        const layoutNodes = this.nodes.filter((n) => this.isNodeVisible(n) || (!this.searchTerm && n.type === 'dj'));
        if (layoutNodes.length === 0) return;
        const layoutNodeIds = new Set(layoutNodes.map((n) => n.id));

        const degree = new Map();
        layoutNodes.forEach((n) => degree.set(n.id, 0));
        this.connections.forEach((c) => {
            if (degree.has(c.from)) degree.set(c.from, degree.get(c.from) + 1);
            if (degree.has(c.to)) degree.set(c.to, degree.get(c.to) + 1);
        });

        // Allow a larger virtual layout area on desktop so nodes can spread beyond
        // the visible canvas. This creates more pan/expand room and avoids cramped
        // outer edges. Use desktopLayoutMultiplier (e.g., 3) to multiply viewport size.
    const layoutWidth = isMobile ? width * (this.mobileLayoutMultiplier || 1.5) : width * (this.desktopLayoutMultiplier || 3);
    const layoutHeight = isMobile ? height * (this.mobileLayoutMultiplier || 1.5) : height * (this.desktopLayoutMultiplier || 3);

        layoutNodes.forEach((n) => {
            if (typeof n.x !== 'number' || typeof n.y !== 'number') {
                n.x = Math.random() * layoutWidth;
                n.y = Math.random() * layoutHeight;
            }
            n.x += (Math.random() - 0.5) * 2;
            n.y += (Math.random() - 0.5) * 2;
        });

        const area = layoutWidth * layoutHeight;
        const baseKMultiplier = isMobile ? 1.15 : 0.65;
        const k = Math.sqrt(area / Math.max(1, layoutNodes.length)) * baseKMultiplier;

        let repulsionFactor = this.tuning.repulsion;
        let attractionBase = this.tuning.attraction;
        const gravityBase = isMobile ? this.tuning.gravity * 0.5 : this.tuning.gravity;
        const baseMinDist = this.tuning.minDistance;
    const minDist = isMobile ? Math.max(55, Math.round(baseMinDist * 1.2)) : baseMinDist;

        if (isMobile) {
            repulsionFactor *= 1.8;
            attractionBase *= 0.8;
        }

        const conns = this.connectionRefs.filter(
            (cr) => cr.from && cr.to && layoutNodeIds.has(cr.from.id) && layoutNodeIds.has(cr.to.id)
        );

        for (let iter = 0; iter < iterations; iter++) {
            const forces = new Map();
            layoutNodes.forEach((n) => forces.set(n.id, { fx: 0, fy: 0 }));

            for (let i = 0; i < layoutNodes.length; i++) {
                const a = layoutNodes[i];
                for (let j = i + 1; j < layoutNodes.length; j++) {
                    const b = layoutNodes[j];
                    const dx = b.x - a.x;
                    const dy = b.y - a.y;
                    const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;

                    const sameTypeBonus = (a.type === b.type && (a.type === 'artist' || a.type === 'dj')) ? this.tuning.sameTypeRepel : 0;
                    const repulse = repulsionFactor * (k * k) / (dist * (1 + sameTypeBonus));
                    const fx = (dx / dist) * repulse;
                    const fy = (dy / dist) * repulse;

                    forces.get(a.id).fx -= fx;
                    forces.get(a.id).fy -= fy;
                    forces.get(b.id).fx += fx;
                    forces.get(b.id).fy += fy;
                }
            }

            for (const c of conns) {
                const a = c.from;
                const b = c.to;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;

                const type = c.type || 'default';
                const typeStrength = type === 'location' || type === 'genre' || type === 'collective' ? 0.9 : 0.6;
                const bothArtists = ((a.type === 'artist' || a.type === 'dj') && (b.type === 'artist' || b.type === 'dj'));
                const strength = typeStrength * (bothArtists ? 0.25 : 1) * attractionBase;

                const attraction = (dist * dist) / k * strength;
                const fx = (dx / dist) * attraction;
                const fy = (dy / dist) * attraction;

                forces.get(a.id).fx += fx;
                forces.get(a.id).fy += fy;
                forces.get(b.id).fx -= fx;
                forces.get(b.id).fy -= fy;
            }

            // Center gravity should use the virtual layout center (layoutWidth/layoutHeight)
            // so nodes are attracted to the true center of the extended layout area,
            // not just the visible canvas centre which would squeeze the layout.
            const centerX = layoutWidth / 2;
            const centerY = layoutHeight / 2;
            const maxDegree = Math.max(1, ...Array.from(degree.values()));
            layoutNodes.forEach((n) => {
                const deg = degree.get(n.id) || 0;
                const centrality = deg / maxDegree;
                const g = gravityBase * (0.5 + centrality * 0.8);
                const dx = centerX - n.x;
                const dy = centerY - n.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
                forces.get(n.id).fx += (dx / dist) * g * dist;
                forces.get(n.id).fy += (dy / dist) * g * dist;
            });

            const temp = Math.max(1, (1 - iter / iterations) * Math.min(width, height) * 0.08);
            layoutNodes.forEach((n) => {
                const f = forces.get(n.id);
                const fmag = Math.sqrt(f.fx * f.fx + f.fy * f.fy) || 0.001;
                const dx = (f.fx / fmag) * Math.min(fmag, temp);
                const dy = (f.fy / fmag) * Math.min(fmag, temp);
                n.x += dx;
                n.y += dy;

                if (!isMobile) {
                    // clamp within virtual layout area (not just the visible canvas)
                    n.x = Math.max(10, Math.min(layoutWidth - 10, n.x));
                    n.y = Math.max(10, Math.min(layoutHeight - 10, n.y));
                } else {
                    const horizMargin = Math.max(250, Math.round(width * 0.55));
                    const vertMargin = Math.max(140, Math.round(height * 0.35));
                    n.x = Math.max(-horizMargin, Math.min(width + horizMargin, n.x));
                    n.y = Math.max(-vertMargin, Math.min(height + vertMargin, n.y));
                }
            });
        }

        const spacingPasses = isMobile ? 8 : 4;
        for (let pass = 0; pass < spacingPasses; pass++) {
            for (let i = 0; i < layoutNodes.length; i++) {
                const a = layoutNodes[i];
                for (let j = i + 1; j < layoutNodes.length; j++) {
                    const b = layoutNodes[j];
                    const dx = b.x - a.x;
                    const dy = b.y - a.y;
                    const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
                    if (dist < minDist) {
                        const overlap = (minDist - dist) / 2;
                        const ux = dx / dist;
                        const uy = dy / dist;
                        a.x -= ux * overlap;
                        a.y -= uy * overlap;
                        b.x += ux * overlap;
                        b.y += uy * overlap;
                    }
                }
            }
        }

        if (!isMobile) {
            const padding = 40;
            layoutNodes.forEach((n) => {
                // clamp to the virtual layout extents so nodes can occupy the expanded area
                n.x = Math.max(padding, Math.min(layoutWidth - padding, n.x));
                n.y = Math.max(padding, Math.min(layoutHeight - padding, n.y));
            });
        }
        this.fitToScreen();
    }

    // Debounced helper to schedule a short layout run after tuning changes
    _scheduleTuningRun(ms = 250, iterations = 80) {
        if (this._modalOpen) return;
        if (this._tuningDebounceTimer) clearTimeout(this._tuningDebounceTimer);
        this._tuningDebounceTimer = setTimeout(() => {
            try {
                    if (this._autoLayoutEnabled && !this._modalOpen) {
                        this.runLayout(iterations);
                        this.render();
                    }
            } catch (e) {
                console.error('Auto-run layout failed:', e);
            }
            this._tuningDebounceTimer = null;
        }, ms);
    }
    
    setupCanvas() {
        // If a modal is open, skip canvas setup to prevent layout shifts
        if (document.body.classList.contains('modal-open')) {
            return;
        }
        
        const container = document.getElementById('graph-container');
        const rect = container.getBoundingClientRect();
        // Determine sizes; ensure the graph container uses the available viewport height
        const isMobile = window.innerWidth <= 768;
        const viewportHeight = window.visualViewport
            ? Math.floor(window.visualViewport.height || window.innerHeight)
            : window.innerHeight;
        let canvasWidth = rect.width;
        let canvasHeight = rect.height;

        // Calculate header and bottom reserved areas (if present)
        const header = document.querySelector('header');
        const bottomInfo = document.getElementById('bottom-info');
        const controls = document.getElementById('controls');
        const headerHeight = header ? header.getBoundingClientRect().height : 0;
        const bottomHeight = bottomInfo ? bottomInfo.getBoundingClientRect().height : 40;
        const controlsHeight = (controls && (controls.classList.contains('mobile-bottom-controls') || isMobile))
            ? controls.getBoundingClientRect().height
            : 0;
        const effectiveBottom = controlsHeight > 0 ? controlsHeight : bottomHeight;

        // Prefer using the full viewport height minus header/bottom bars so canvas reaches the green line
        const paddingMargin = isMobile ? 0 : 4;
    const viewportAvailable = Math.max(200, viewportHeight - headerHeight - effectiveBottom - paddingMargin);
        // Use the larger of the container's computed rect height and the viewport available height
        canvasHeight = Math.max(rect.height, viewportAvailable);

        // On mobile we still explicitly set the container height to avoid layout collapses
        if (isMobile) {
            container.style.height = canvasHeight + 'px';
        } else {
            // also ensure desktop container expands if it was constrained by CSS
            if (rect.height < viewportAvailable) container.style.height = canvasHeight + 'px';
        }

        // Set canvas size
        this.canvas.width = canvasWidth;
        this.canvas.height = canvasHeight;
        this.canvas.style.width = canvasWidth + 'px';
        this.canvas.style.height = canvasHeight + 'px';
        
        
        // Resize handler
        if (!this._handleResize) {
            this._handleResize = () => {
                if (this._resizeDebounce) clearTimeout(this._resizeDebounce);
                this._resizeDebounce = setTimeout(() => {
                    this.setupCanvas();
                    if (window.innerWidth <= 768 && this._autoLayoutEnabled && !this._modalOpen) {
                        this.runLayout(100);
                    }
                    this.render();
                    this.updateListLayoutSizing();
                    this.updateMobileControlsLayout();
                    this._resizeDebounce = null;
                }, 100);
            };
            window.addEventListener('resize', this._handleResize);
        }

        if (window.visualViewport && !this._handleViewportResize) {
            this._handleViewportResize = () => {
                this._handleResize();
            };
            window.visualViewport.addEventListener('resize', this._handleViewportResize);
        }
    }
    
    setupEventListeners() {
        // Mouse events
    this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    this.canvas.addEventListener('wheel', (e) => this.handleWheel(e));
        
        // Touch events for mobile (includes pinch-zoom)
        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
        this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e));
        
        // Modal close
        document.getElementById('close-modal').addEventListener('click', () => {
            this.closeModal();
        });
        
        document.getElementById('modal-overlay').addEventListener('click', (e) => {
            if (e.target.id === 'modal-overlay') {
                this.closeModal();
            }
        });
        
        // About Us button
        document.getElementById('about-us-btn').addEventListener('click', () => {
            this.showAboutModal();
        });

        // Cache DOM references for view/search controls
        this.networkContainer = document.getElementById('graph-container');
        this.listContainer = document.getElementById('list-container');
        this.nodeListElement = document.getElementById('node-list');
        this.listEmptyState = document.getElementById('list-empty');
        this.viewToggleButton = document.getElementById('toggle-view');
        this.searchInput = document.getElementById('node-search');
        this.explainerTextElement = document.querySelector('.explainer-text');
        this.controlsBottomRow = document.querySelector('#controls .control-buttons.bottom-row');
        this.aboutButton = document.getElementById('about-us-btn');
        if (this.aboutButton && !this.aboutButtonHome) {
            this.aboutButtonHome = this.aboutButton.parentElement;
        }
        this.legendToggleButton = document.getElementById('legend-toggle');

        if (this.explainerTextElement) {
            const initialText = this.explainerTextElement.textContent.trim();
            if (!this.explainerMessages.network) {
                this.explainerMessages.network = initialText;
            }
        }

        if (this.viewToggleButton) {
            this.viewToggleButton.addEventListener('click', () => {
                const targetView = this.activeView === 'network' ? 'list' : 'network';
                this.switchView(targetView);
            });
        }

        if (this.searchInput) {
            this.searchInput.addEventListener('input', (e) => {
                this.searchTerm = (e.target.value || '').trim();
                this.applySearchFilter();
                if (this.activeView === 'list') {
                    this.renderListView();
                }
                this.render();
            });
        }

        if (this.legendToggleButton) {
            this.legendToggleButton.addEventListener('click', () => {
                this.toggleLegend();
            });
        }

        this.updateListLayoutSizing();
        this.updateMobileControlsLayout();

        // Legend toggle handlers: click on legend items to show/hide types
        const legend = document.getElementById('legend');
        if (legend) {
            const items = legend.querySelectorAll('[data-type]');
            items.forEach((it) => {
                const type = it.dataset.type;
                if (!type) return;
                if (!this.visibleTypes.hasOwnProperty(type)) {
                    this.visibleTypes[type] = true;
                }
                this.legendItems.set(type, it);
                it.style.cursor = 'pointer';
                it.style.opacity = this.visibleTypes[type] ? '1' : '0.35';
                it.addEventListener('click', () => {
                    const current = this.visibleTypes[type];
                    this.visibleTypes[type] = !current;
                    it.style.opacity = this.visibleTypes[type] ? '1' : '0.35';
                    this.buildIndexes();
                    this.applySearchFilter();
                    if (this.activeView === 'list') {
                        this.renderListView();
                    }
                    this.render();
                    // Debugging: log visibility map and a short sample of multi-type nodes
                    try {
                    
                    } catch (e) {
                    }
                });
            });
        }

        // Ensure view state reflects current defaults
        this.switchView(this.activeView);
    }

    // Create a small tuning UI panel with sliders for key force parameters
    createTuningUI() {
        // Avoid creating twice
        if (document.getElementById('tuning-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'tuning-panel';
        panel.style.position = 'fixed';
        panel.style.right = '12px';
        panel.style.top = '80px';
        panel.style.width = '260px';
        panel.style.maxHeight = '70vh';
        panel.style.overflow = 'auto';
        panel.style.background = 'rgba(20,20,20,0.95)';
        panel.style.color = '#fff';
        panel.style.padding = '10px';
        panel.style.borderRadius = '8px';
        panel.style.zIndex = 9999;
        panel.style.fontSize = '13px';

        const title = document.createElement('div');
        title.textContent = 'Layout Tuning';
        title.style.fontWeight = '700';
        title.style.marginBottom = '8px';
        panel.appendChild(title);

        const controls = [
            { id: 'repulsion', label: 'Repulsion', min: 0.02, max: 1.0, step: 0.01 },
            { id: 'attraction', label: 'Attraction', min: 0.1, max: 2.0, step: 0.05 },
            { id: 'gravity', label: 'Gravity', min: 0.0, max: 0.5, step: 0.01 },
            { id: 'sameTypeRepel', label: 'Same-type repel', min: 0, max: 2.0, step: 0.05 },
            { id: 'minDistance', label: 'Min distance', min: 10, max: 120, step: 1 },
            { id: 'iterations', label: 'Iterations', min: 20, max: 600, step: 10 }
        ];

        controls.forEach(cfg => {
            const row = document.createElement('div');
            row.style.marginBottom = '8px';

            const lbl = document.createElement('label');
            lbl.textContent = cfg.label;
            lbl.style.display = 'block';
            lbl.style.marginBottom = '4px';
            row.appendChild(lbl);

            const input = document.createElement('input');
            input.type = 'range';
            input.id = `tuning_${cfg.id}`;
            input.min = cfg.min;
            input.max = cfg.max;
            input.step = cfg.step;
            input.value = this.tuning[cfg.id];
            input.style.width = '100%';
            row.appendChild(input);

            const val = document.createElement('div');
            val.id = `tuning_${cfg.id}_val`;
            val.style.textAlign = 'right';
            val.style.fontSize = '12px';
            val.style.marginTop = '2px';
            val.textContent = input.value;
            row.appendChild(val);

            input.addEventListener('input', (e) => {
                const v = cfg.id === 'iterations' ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
                this.tuning[cfg.id] = v;
                val.textContent = v;
                // Auto-apply a short layout after the user stops moving the slider (debounced)
                // Use a conservative iteration count so UI stays responsive
                const autoIters = Math.min(200, Math.max(40, Math.round(this.tuning.iterations / 3)));
                this._scheduleTuningRun(220, autoIters);
            });

            panel.appendChild(row);
        });

        const btnRow = document.createElement('div');
        btnRow.style.display = 'flex';
        btnRow.style.gap = '6px';

        const runBtn = document.createElement('button');
        runBtn.textContent = 'Run Layout';
        runBtn.style.flex = '1';
        runBtn.addEventListener('click', () => {
            // use tuned iterations (force a layout regardless of auto-layout flag)
            this.runLayout(this.tuning.iterations, true);
            this.render();
        });
        btnRow.appendChild(runBtn);

        const resetBtn = document.createElement('button');
        resetBtn.textContent = 'Reset';
        resetBtn.style.flex = '1';
        resetBtn.addEventListener('click', () => {
            this.setupStaticLayout();
            this.fitToScreen();
            this.render();
        });
        btnRow.appendChild(resetBtn);

        panel.appendChild(btnRow);

        document.body.appendChild(panel);
    }
    
    async loadData() {
        try {
            // Use the published CSV link so the data is openly accessible
            const csvUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQTnwSG0xCM-RCKMrCVOog0FroRmpW4hha12qS7OOI0qbNuLz0axm_DMJiHHtUf1NhW7lOpqb79y0tp/pub?output=csv';
            
            const response = await fetch(csvUrl, {
                mode: 'cors',
                headers: {
                    'Accept': 'text/csv'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const csvText = await response.text();
            this.artists = this.parseCSV(csvText);
            
            if (this.artists.length === 0) {
                throw new Error('No valid producer data found');
            }
            
        } catch (error) {
            console.error('Error loading data from Google Sheets:', error);
            
            // Enhanced sample data for testing
            this.artists = [
                {
                    firstName: 'Marco',
                    artistName: 'Alpine Beats',
                    genre: 'Electronic',
                    location: 'Bolzano',
                    location2: 'Bozen',
                    url: 'https://alpinebeats.com',
                    infoText: 'Electronic music producer blending alpine folk with modern beats. Active in the South Tyrolean underground scene since 2018.',
                    collective: 'Digital Alps'
                },
                {
                    firstName: 'Anna',
                    artistName: 'Dolomites Echo',
                    genre: 'Folk',
                    location: 'Merano',
                    location2: 'Meran',
                    url: 'https://dolomitesecho.net',
                    infoText: 'Traditional folk singer incorporating Ladin and German influences into contemporary compositions.',
                    collective: 'Mountain Voices'
                },
                {
                    firstName: 'Luis',
                    artistName: 'Vintschgau Sound',
                    genre: 'Rock',
                    location: 'Mals',
                    location2: 'Malles',
                    url: '',
                    infoText: 'Rock band from the Vinschgau valley, known for their energetic live performances and local dialect lyrics.',
                    collective: 'Vinschgau Collective'
                },
                {
                    firstName: 'Sarah',
                    artistName: 'Klangwerk',
                    genre: 'Experimental',
                    location: 'Brixen',
                    location2: 'Bressanone',
                    url: 'https://klangwerk.studio',
                    infoText: 'Sound producer exploring the intersection of natural Alpine sounds and electronic manipulation.',
                    collective: 'Digital Alps'
                },
                {
                    firstName: 'Tobias',
                    artistName: 'Drei Zinnen',
                    genre: 'Jazz',
                    location: 'Bruneck',
                    location2: 'Brunico',
                    url: '',
                    infoText: 'Jazz trio inspired by the dramatic landscapes of the Dolomites, featuring improvised alpine horn segments.',
                    collective: ''
                },
                {
                    firstName: 'Elena',
                    artistName: 'Bergecho',
                    genre: 'Ambient',
                    location: 'Sterzing',
                    location2: 'Vipiteno',
                    url: 'https://bergecho.bandcamp.com',
                    infoText: 'Ambient composer creating immersive soundscapes recorded in mountain locations throughout South Tyrol.',
                    collective: 'Mountain Voices'
                }
            ];
        }
    }
    
    parseCSV(csvText) {
        // Header-aware CSV parsing: map values to header names so column order doesn't matter
        const lines = csvText.split('\n').filter(l => l.trim() !== '');
        if (lines.length < 2) return [];

        // The first row contains human-readable instructions; the declaration/header row is the SECOND row
        const rawHeaders = this.parseCSVLine(lines[1]).map(h => h.trim().replace(/"/g, ''));
        const headers = rawHeaders.map(h => h.toLowerCase());

        const artists = [];

        // Data rows start at index 2
        for (let i = 2; i < lines.length; i++) {
            const values = this.parseCSVLine(lines[i]);
            if (values.length === 0) continue;

            // Build an object keyed by normalized header names
            const row = {};
            for (let j = 0; j < values.length; j++) {
                const key = (rawHeaders[j] || `col${j}`).trim();
                row[key] = values[j] ? values[j].trim().replace(/"/g, '') : '';
            }

            // Helper to split lists in cells (commas or semicolons)
            const splitList = (v) => {
                if (!v) return [];
                return v.toString().split(/[;,]+/).map(s => s.trim()).filter(Boolean);
            };

            // Normalize commonly used header names into our expected properties
            const artistObj = {
                // primary display name
                artistName: row['Artist Name'] || row['artist name'] || row['artistname'] || row['artist'] || row['Artist'] || '',
                // alternate person/name(s) list
                names: splitList(row['Name(s)'] || row['Name'] || row['name(s)'] || row['name'] || ''),
                // Type: producers, djs, both, other
                rawType: row['Type'] || row['type'] || '',
                // genre/subgenre
                genre: row['Genre'] || row['genre'] || '',
                subgenre: row['Subgenre'] || row['subgenre'] || '',
                // locations may be multiple
                locations: splitList(row['Location(s)'] || row['Location(s)'] || row['locations'] || row['Location'] || row['location'] || ''),
                url: row['URL'] || row['Url'] || row['url'] || row['Website'] || row['website'] || '',
                infoText: row['Info Text'] || row['info text'] || row['info'] || row['notes'] || row['description'] || '',
                collectives: splitList(row['Collective(s)'] || row['Collective'] || row['collective'] || '')
            };

            // Backwards-compatible fields
            artistObj.firstName = artistObj.names.length > 0 ? artistObj.names[0] : (row['First Name'] || row['first name'] || row['firstname'] || '');
            artistObj.location = artistObj.locations[0] || (row['Location'] || row['location'] || '');
            artistObj.location2 = artistObj.locations[1] || (row['Location 2'] || row['location 2'] || '');
            artistObj.collective = artistObj.collectives.join(', ');

            // Normalize the type into one of the canonical values
            const t = (artistObj.rawType || '').toString().trim().toLowerCase();
            if (!t) {
                artistObj.type = 'other';
            } else if ((t.includes('prod') || t.includes('producer')) && t.includes('dj')) {
                // contains both producer and dj
                artistObj.type = 'both';
            } else if (t === 'both' || t.includes('both')) {
                artistObj.type = 'both';
            } else if (t.includes('prod') || t.includes('producer')) {
                artistObj.type = 'producers';
            } else if (t.includes('dj')) {
                artistObj.type = 'djs';
            } else {
                artistObj.type = 'other';
            }

            artistObj.contactFor = '';

            // Fallback: try lowercased header detection for any missing fields
            for (const hKey in row) {
                const low = hKey.toLowerCase();
                const val = row[hKey];
                if (!artistObj.artistName && /artist/.test(low) && !/first/.test(low)) artistObj.artistName = val;
                if ((!artistObj.firstName || artistObj.firstName === '') && /first/.test(low)) artistObj.firstName = val;
                if (!artistObj.genre && /genre/.test(low)) artistObj.genre = val;
                if ((!artistObj.locations || artistObj.locations.length === 0) && /location|place|town|city/.test(low)) artistObj.locations = (val ? val.toString().split(/[;,]+/).map(s=>s.trim()).filter(Boolean) : []);
                if (!artistObj.url && /url|website|site|link/.test(low)) artistObj.url = val;
                if (!artistObj.infoText && /info|note|description|about/.test(low)) artistObj.infoText = val;
                if ((!artistObj.collectives || artistObj.collectives.length === 0) && /collective|group|band|crew/.test(low)) artistObj.collectives = (val ? val.toString().split(/[;,]+/).map(s=>s.trim()).filter(Boolean) : []);
                if (!artistObj.subgenre && /subgenre/.test(low)) artistObj.subgenre = val;
                if ((!artistObj.names || artistObj.names.length === 0) && /name/.test(low)) artistObj.names = (val ? val.toString().split(/[;,]+/).map(s=>s.trim()).filter(Boolean) : []);
                if (!artistObj.contactFor && /contact/.test(low) && /me/.test(low) && /for/.test(low)) {
                    artistObj.contactFor = val;
                }
            }

            // Trim string values
            Object.keys(artistObj).forEach(k => {
                if (typeof artistObj[k] === 'string') artistObj[k] = artistObj[k].trim();
            });

            // Require at least a display name
            if ((artistObj.artistName && artistObj.artistName.length > 0) || (artistObj.firstName && artistObj.firstName.length > 0) || (artistObj.names && artistObj.names.length > 0)) {
                artists.push(artistObj);
            }
        }

        return artists;
    }
    
    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        
        result.push(current.trim());
        return result.map(item => item.replace(/"/g, ''));
    }
    
    createNodes() {
        this.nodes = [];
        const locations = new Set();
        const genres = new Set();
        const collectives = new Set();
        
    
        
        // Create artist nodes and collect unique locations/genres
        this.artists.forEach((artist, index) => {
            

            // Normalize possible field names
            const rawArtistName = (artist.artistName || artist['Artist Name'] || artist.name || '').toString().trim();
            const firstName = (artist.firstName || artist['First Name'] || '').toString().trim();
            const artistLabel = rawArtistName || firstName || `artist_${index}`;

            if (artistLabel) {
                // Better initial positioning - avoid flat lines on mobile
                const isMobile = window.innerWidth <= 768;
                const containerRect = this.canvas?.getBoundingClientRect() || { width: 800, height: 600 };
                
                let x, y;
                if (isMobile) {
                    // Mobile: use more vertical space, less horizontal clustering
                    x = Math.random() * (containerRect.width * 0.6) + containerRect.width * 0.2;
                    y = Math.random() * (containerRect.height * 0.8) + containerRect.height * 0.1;
                } else {
                    // Desktop: spread nodes widely for initial positioning
                    x = Math.random() * (containerRect.width * 0.7) + containerRect.width * 0.15;
                    y = Math.random() * (containerRect.height * 0.7) + containerRect.height * 0.15;
                }

                // Determine node types based on the new 'type' column. We keep an array of types
                // for flexibility (e.g., 'both' -> ['artist','dj']). The primary `type` field is kept for
                // compatibility but `types` contains canonical role names used for visibility checks.
                const rawType = (artist.type || artist.rawType || '').toString().trim().toLowerCase();
                const types = [];
                if (rawType === 'both') {
                    types.push('artist', 'dj');
                } else if (rawType === 'producers' || rawType === 'producer' || rawType.includes('prod')) {
                    types.push('artist');
                } else if (rawType === 'djs' || rawType === 'dj' || rawType.includes('dj')) {
                    types.push('dj');
                } else {
                    // unknown/other: treat as 'artist' for display but mark as 'other' too
                    types.push('other');
                }

                const primaryType = types.includes('dj') && !types.includes('artist') ? 'dj' : (types.includes('artist') && !types.includes('dj') ? 'artist' : (types.includes('artist') && types.includes('dj') ? 'both' : 'other'));

                const node = {
                    id: `artist_${index}`,
                    type: primaryType,
                    types: types, // array, e.g. ['artist','dj']
                    label: artistLabel,
                    data: artist,
                    x: x,
                    y: y,
                    vx: 0,
                    vy: 0
                };
                this.nodes.push(node);
                

                // Check various possible location field names
                // collect locations (may be multiple) and genres/collectives
                const locs = (artist.locations && Array.isArray(artist.locations) && artist.locations.length > 0)
                    ? artist.locations
                    : [ (artist.location || artist.Location || artist['Location '] || '').toString().trim() ].filter(Boolean);

                locs.forEach(l => locations.add(l));

                const genre = (artist.genre || artist.Genre || '').toString().trim();
                if (genre) genres.add(genre);

                // allow multiple collectives separated by commas or semicolons
                const collectiveList = (artist.collectives && artist.collectives.length > 0)
                    ? artist.collectives
                    : ((artist.collective || artist.Collective || '') ? (artist.collective || artist.Collective).toString().split(/[;,]+/).map(s=>s.trim()).filter(Boolean) : []);

                collectiveList.forEach(c => collectives.add(c));
            } else {
                
            }
        });
        
        // Create location nodes
        Array.from(locations).filter(Boolean).forEach((location, index) => {
            const isMobile = window.innerWidth <= 768;
            const containerRect = this.canvas?.getBoundingClientRect() || { width: 800, height: 600 };
            
            let x, y;
            if (isMobile) {
                x = Math.random() * (containerRect.width * 0.6) + containerRect.width * 0.2;
                y = Math.random() * (containerRect.height * 0.8) + containerRect.height * 0.1;
            } else {
                // Desktop: spread nodes widely for initial positioning
                x = Math.random() * (containerRect.width * 0.7) + containerRect.width * 0.15;
                y = Math.random() * (containerRect.height * 0.7) + containerRect.height * 0.15;
            }

            const node = {
                id: `location_${index}`,
                type: 'location',
                label: location,
                x: x,
                y: y,
                vx: 0,
                vy: 0
            };
            this.nodes.push(node);
            
        });
        
        // Create genre nodes
        Array.from(genres).filter(Boolean).forEach((genre, index) => {
            const isMobile = window.innerWidth <= 768;
            const containerRect = this.canvas?.getBoundingClientRect() || { width: 800, height: 600 };
            
            let x, y;
            if (isMobile) {
                x = Math.random() * (containerRect.width * 0.6) + containerRect.width * 0.2;
                y = Math.random() * (containerRect.height * 0.8) + containerRect.height * 0.1;
            } else {
                // Desktop: spread nodes widely for initial positioning
                x = Math.random() * (containerRect.width * 0.7) + containerRect.width * 0.15;
                y = Math.random() * (containerRect.height * 0.7) + containerRect.height * 0.15;
            }

            const node = {
                id: `genre_${index}`,
                type: 'genre',
                label: genre,
                x: x,
                y: y,
                vx: 0,
                vy: 0
            };
            this.nodes.push(node);
            
        });
        
        // Create collective nodes
        Array.from(collectives).filter(Boolean).forEach((collective, index) => {
            const isMobile = window.innerWidth <= 768;
            const containerRect = this.canvas?.getBoundingClientRect() || { width: 800, height: 600 };
            
            let x, y;
            if (isMobile) {
                x = Math.random() * (containerRect.width * 0.6) + containerRect.width * 0.2;
                y = Math.random() * (containerRect.height * 0.8) + containerRect.height * 0.1;
            } else {
                // Desktop: spread nodes widely for initial positioning
                x = Math.random() * (containerRect.width * 0.7) + containerRect.width * 0.15;
                y = Math.random() * (containerRect.height * 0.7) + containerRect.height * 0.15;
            }

            const node = {
                id: `collective_${index}`,
                type: 'collective',
                label: collective,
                x: x,
                y: y,
                vx: 0,
                vy: 0
            };
            this.nodes.push(node);
            
        });
        
    
    }
    
    createConnections() {
        this.connections = [];
        
        this.nodes.forEach(node => {
                if (node.types && (node.types.includes('artist') || node.types.includes('dj') || node.types.includes('other'))) {
                const artist = node.data;

                // Locations (may be multiple)
                const locs = (artist.locations && artist.locations.length > 0)
                    ? artist.locations
                    : [ (artist.location || artist.Location || artist['Location '] || '') ].filter(Boolean);

                // Connect to locations
                if (locs.length > 0) {
                    this.nodes.forEach(locationNode => {
                        if (locationNode.type === 'location') {
                            locs.forEach(loc => {
                                if (!loc) return;
                                if (locationNode.label === loc.trim()) {
                                    this.connections.push({ from: node.id, to: locationNode.id, type: 'location' });
                                }
                            });
                        }
                    });
                }

                // Connect to genres
                const genre = (artist.genre || artist.Genre || '').toString().trim();
                if (genre) {
                    this.nodes.forEach(genreNode => {
                        if (genreNode.type === 'genre' && genreNode.label === genre) {
                            this.connections.push({ from: node.id, to: genreNode.id, type: 'genre' });
                        }
                    });
                }

                // Connect to collectives (support multiple collectives per artist)
                const collectiveList = (artist.collectives && artist.collectives.length > 0)
                    ? artist.collectives
                    : ((artist.collective || artist.Collective || '') ? (artist.collective || artist.Collective).toString().split(/[;,]+/).map(s => s.trim()).filter(Boolean) : []);

                if (collectiveList.length > 0) {
                    this.nodes.forEach(collectiveNode => {
                        if (collectiveNode.type !== 'collective') return;
                        if (collectiveList.includes(collectiveNode.label)) {
                            this.connections.push({ from: node.id, to: collectiveNode.id, type: 'collective' });
                        }
                    });
                }
            }
        });
        
    // build quick lookup structures used by rendering and interaction helpers
        this.buildIndexes();
        this.applySearchFilter();
        if (this.activeView === 'list') {
            this.renderListView();
        }
        
    }

    // Build in-memory indexes and object references to avoid repeated .find() calls
    buildIndexes() {
        this.nodeMap = new Map(this.nodes.map(n => [n.id, n]));
        this.connectionRefs = this.connections.map(c => ({
            from: this.nodeMap.get(c.from) || null,
            to: this.nodeMap.get(c.to) || null,
            type: c.type
        }));
    }

    

    // Determine whether a node should be treated as a person/artist-like node
    isPersonNode(node) {
        if (!node) return false;
        // If node carries raw row data, prefer that as indication it's a person
        if (node.data) {
            // If explicit types exist, consider artist/dj/both/other as person-like
            if (Array.isArray(node.types) && node.types.some(t => ['artist','dj','other'].includes(t))) return true;
            if (['artist','dj','both','other'].includes(node.type)) return true;
            // Fallback: if the data contains name fields, treat as person
            const art = node.data;
            if ((art.artistName && String(art.artistName).trim()) || (art.firstName && String(art.firstName).trim()) || (Array.isArray(art.names) && art.names.length > 0)) return true;
        }
        return false;
    }

    isNodeVisible(node) {
        if (!node) return false;
        // Support nodes that carry multiple role types (e.g., types: ['artist','dj'])
        let typeVisible = true;
        if (node.types && Array.isArray(node.types) && node.types.length > 0) {
            typeVisible = node.types.some(t => this.visibleTypes.hasOwnProperty(t) ? this.visibleTypes[t] : true);
        } else {
            typeVisible = this.visibleTypes.hasOwnProperty(node.type) ? this.visibleTypes[node.type] : true;
        }
        const searchActive = !!this.searchTerm;

        if (!searchActive) {
            return typeVisible;
        }

        if (!this.filteredNodeIds) {
            return typeVisible;
        }

        if (!this.filteredNodeIds.has(node.id)) {
            return false;
        }

        // When searching, allow matches (and their neighbors) even if their type is hidden.
        if (!typeVisible && searchActive) {
            return true;
        }

        return true;
    }

    shouldRenderConnection(cref) {
        if (!cref || !cref.from || !cref.to) return false;
        return this.isNodeVisible(cref.from) && this.isNodeVisible(cref.to);
    }

    _nodeSearchHaystack(node) {
        const parts = [];
        if (!node) return parts;
        if (node.label) parts.push(String(node.label).toLowerCase());
        const hasArtistLike = this.isPersonNode(node);
        if (hasArtistLike && node.data) {
            Object.values(node.data).forEach((val) => {
                if (typeof val === 'string' && val.trim()) {
                    parts.push(val.toLowerCase());
                }
            });
        }
        return parts;
    }

    applySearchFilter() {
        const term = (this.searchTerm || '').toLowerCase();
        if (!term) {
            this.filteredNodeIds = null;
            return;
        }

        if (!this.connectionRefs || this.connectionRefs.length === 0) {
            this.buildIndexes();
        }

        const matched = new Set();
        this.nodes.forEach((node) => {
            const haystack = this._nodeSearchHaystack(node);
            if (haystack.some((text) => text.includes(term))) {
                matched.add(node.id);
            }
        });

        if (matched.size === 0) {
            this.filteredNodeIds = new Set();
            return;
        }

        const result = new Set(matched);
        this.connectionRefs.forEach((cref) => {
            if (!cref || !cref.from || !cref.to) return;
            const fromId = cref.from.id;
            const toId = cref.to.id;
            if (matched.has(fromId)) result.add(toId);
            if (matched.has(toId)) result.add(fromId);
        });

        this.filteredNodeIds = result;
    }

    switchView(view) {
        const targetView = view === 'list' ? 'list' : 'network';
        this.activeView = targetView;

        if (!this.networkContainer) this.networkContainer = document.getElementById('graph-container');
        if (!this.listContainer) this.listContainer = document.getElementById('list-container');

        if (this.networkContainer) {
            if (targetView === 'list') this.networkContainer.classList.add('hidden');
            else this.networkContainer.classList.remove('hidden');
        }

        if (this.listContainer) {
            if (targetView === 'list') this.listContainer.classList.remove('hidden');
            else this.listContainer.classList.add('hidden');
        }

        if (this.viewToggleButton) {
            this.viewToggleButton.textContent = targetView === 'list' ? 'network view' : 'list view';
        }

        if (targetView === 'list') {
            this.renderListView();
            if (this.listContainer) this.listContainer.scrollTop = 0;
        } else {
            this.render();
        }

        if (this.explainerTextElement) {
            const fallback = this.explainerMessages.network || this.explainerTextElement.textContent;
            this.explainerTextElement.textContent = targetView === 'list'
                ? this.explainerMessages.list
                : fallback;
        }

        document.body.classList.toggle('list-view-active', targetView === 'list');
        this.updateListLayoutSizing();
        this.updateMobileControlsLayout();
    }

    renderListView() {
        if (!this.nodeListElement) return;

        const container = this.nodeListElement;
        container.innerHTML = '';

        const typeOrder = ['artist', 'dj', 'other', 'location', 'genre', 'collective'];
        const typeLabels = {
            artist: 'producers',
            dj: 'djs',
            other: 'other',
            location: 'locations',
            genre: 'genres',
            collective: 'collectives'
        };

        const degreeMap = new Map();
        this.connections.forEach((conn) => {
            if (!conn) return;
            if (conn.from) degreeMap.set(conn.from, (degreeMap.get(conn.from) || 0) + 1);
            if (conn.to) degreeMap.set(conn.to, (degreeMap.get(conn.to) || 0) + 1);
        });

        let totalVisible = 0;

        const dotColors = {
            artist: this.nodeTypes.artist.color,
            dj: this.nodeTypes.dj.color,
            location: this.nodeTypes.location.color,
            genre: this.nodeTypes.genre.color,
            collective: this.nodeTypes.collective.color
        };

        typeOrder.forEach((type) => {
            const group = this.nodes.filter((node) => node.type === type && this.isNodeVisible(node));
            if (group.length === 0) return;

            totalVisible += group.length;
            group.sort((a, b) => String(a.label || '').toLowerCase().localeCompare(String(b.label || '').toLowerCase()));

            const section = document.createElement('div');
            section.className = 'node-section';

            const title = document.createElement('div');
            title.className = 'node-section-title';
            title.textContent = `${typeLabels[type]} (${group.length})`;
            section.appendChild(title);

            const list = document.createElement('ul');
            list.className = 'node-section-list';

            group.forEach((node) => {
                const li = document.createElement('li');
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'node-list-item-btn';

                const header = document.createElement('div');
                header.className = 'node-list-header';

                const nameSpan = document.createElement('span');
                nameSpan.className = 'node-list-name';
                const dot = document.createElement('span');
                dot.className = 'node-list-dot';
                dot.style.backgroundColor = dotColors[type] || '#00ff00';
                nameSpan.appendChild(dot);
                nameSpan.appendChild(document.createTextNode(node.label || ''));

                const badge = document.createElement('span');
                badge.className = 'node-list-badge';
                badge.textContent = type === 'artist' ? 'producer' : type;

                header.appendChild(nameSpan);
                header.appendChild(badge);
                btn.appendChild(header);

                const meta = document.createElement('span');
                meta.className = 'node-list-meta';

                if (type === 'artist' || type === 'dj') {
                    meta.textContent = this.buildArtistMeta(node.data);
                    btn.addEventListener('click', () => this.showArtistModal(node.data));
                } else {
                    const count = degreeMap.get(node.id) || 0;
                    meta.textContent = `${count} connection${count === 1 ? '' : 's'}`;
                    btn.addEventListener('click', () => this.showGroupModal(node));
                }

                btn.appendChild(meta);
                li.appendChild(btn);
                list.appendChild(li);
            });

            section.appendChild(list);
            container.appendChild(section);
        });

        if (this.listEmptyState) {
            if (totalVisible === 0) {
                const message = this.searchTerm ? 'no nodes match this search' : 'no nodes to display';
                this.listEmptyState.textContent = message;
                this.listEmptyState.classList.remove('hidden');
            } else {
                this.listEmptyState.classList.add('hidden');
            }
        }
    }

    updateListLayoutSizing() {
        if (!this.listContainer) {
            this.listContainer = document.getElementById('list-container');
        }

        const container = this.listContainer;
        if (!container) return;

        const listViewActive = document.body.classList.contains('list-view-active');
        if (!listViewActive) {
            container.style.height = '';
            container.style.maxHeight = '';
            return;
        }

        const isMobile = window.innerWidth <= 768;
        const header = document.querySelector('header');
        const bottomInfo = document.getElementById('bottom-info');
        const controls = document.getElementById('controls');
        const headerHeight = header ? Math.ceil(header.getBoundingClientRect().height) : 0;
        const bottomHeight = bottomInfo ? Math.ceil(bottomInfo.getBoundingClientRect().height) : 0;
        const controlsHeight = (controls && (controls.classList.contains('mobile-bottom-controls') || window.innerWidth <= 768))
            ? Math.ceil(controls.getBoundingClientRect().height)
            : 0;
        const viewportHeight = window.visualViewport
            ? Math.floor(window.visualViewport.height || window.innerHeight)
            : (window.innerHeight || document.documentElement.clientHeight);
        const footerHeight = Math.max(bottomHeight, controlsHeight);
    const margin = isMobile ? 0 : 24;
        const available = Math.max(260, viewportHeight - headerHeight - footerHeight - margin);

        container.style.maxHeight = available + 'px';
        container.style.height = available + 'px';
    }

    updateMobileControlsLayout() {
        const controls = document.getElementById('controls');
        if (!controls) return;

        const isMobile = window.innerWidth <= 768;
        const wasMobile = this.mobileControlsActive;
        this.mobileControlsActive = isMobile;

        if (this.aboutButton && !this.aboutButtonHome) {
            this.aboutButtonHome = this.aboutButton.parentElement;
        }

        if (this.controlsBottomRow && this.aboutButton) {
            if (isMobile) {
                if (this.aboutButton.parentElement !== this.controlsBottomRow) {
                    this.controlsBottomRow.appendChild(this.aboutButton);
                }
                this.aboutButton.classList.add('control-btn');
            } else {
                if (this.aboutButtonHome && this.aboutButton.parentElement !== this.aboutButtonHome) {
                    this.aboutButtonHome.appendChild(this.aboutButton);
                }
                this.aboutButton.classList.remove('control-btn');
            }
        }

        if (isMobile) {
            controls.classList.add('mobile-bottom-controls');
            if (!wasMobile) {
                this.legendCollapsed = true;
            }
            controls.classList.toggle('legend-collapsed', this.legendCollapsed);
        } else {
            controls.classList.remove('mobile-bottom-controls');
            controls.classList.remove('legend-collapsed');
            this.legendCollapsed = false;
        }

        this.refreshLegendToggleUI(isMobile);
        this.updateListLayoutSizing();

        if (isMobile) {
            const syncCanvas = () => {
                this.setupCanvas();
                this.render();
            };
            if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
                window.requestAnimationFrame(syncCanvas);
            } else {
                setTimeout(syncCanvas, 0);
            }
        }
    }

    toggleLegend() {
        const isMobile = window.innerWidth <= 768;
        if (!isMobile) return;

        this.legendCollapsed = !this.legendCollapsed;
        const controls = document.getElementById('controls');
        if (controls) {
            controls.classList.toggle('legend-collapsed', this.legendCollapsed);
        }
        this.refreshLegendToggleUI(true);
        this.updateListLayoutSizing();

        const syncCanvas = () => {
            this.setupCanvas();
            this.render();
        };
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(syncCanvas);
        } else {
            setTimeout(syncCanvas, 0);
        }
        
    }

    refreshLegendToggleUI(isMobile) {
        if (!this.legendToggleButton) return;

        if (isMobile) {
            const expanded = !this.legendCollapsed;
            this.legendToggleButton.textContent = expanded ? 'hide filters' : 'show filters';
            this.legendToggleButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        } else {
            this.legendToggleButton.textContent = 'filters';
            this.legendToggleButton.setAttribute('aria-expanded', 'true');
        }

        // On mobile, keep the search input hidden/disabled when legend is collapsed
        try {
            const searchWrapper = document.querySelector('#controls .search-wrapper');
            const searchInput = document.getElementById('node-search');
            if (isMobile && searchWrapper) {
                if (this.legendCollapsed) {
                    searchWrapper.setAttribute('aria-hidden', 'true');
                    if (searchInput) {
                        searchInput.disabled = true;
                        searchInput.setAttribute('aria-hidden', 'true');
                        searchInput.tabIndex = -1;
                    }
                } else {
                    searchWrapper.setAttribute('aria-hidden', 'false');
                    if (searchInput) {
                        searchInput.disabled = false;
                        searchInput.removeAttribute('aria-hidden');
                        searchInput.tabIndex = 0;
                    }
                }
            } else if (searchWrapper && searchInput) {
                // non-mobile: ensure search is available
                searchWrapper.removeAttribute('aria-hidden');
                searchInput.disabled = false;
                searchInput.removeAttribute('aria-hidden');
                searchInput.tabIndex = 0;
            }
        } catch (e) {
            // defensive: don't break UI if something unexpected occurs
        }
    }

    buildArtistMeta(artist = {}) {
        if (!artist) return 'no details available';

        const parts = [];
        const genre = (artist.genre || artist.Genre || '').toString().trim();
        if (genre) parts.push(genre);

        const loc1 = (artist.location || artist.Location || artist['Location '] || '').toString().trim();
        const loc2 = (artist.location2 || artist['Location 2'] || artist['Location2'] || '').toString().trim();
        const locations = Array.from(new Set([loc1, loc2].filter(Boolean)));
        if (locations.length) parts.push(locations.join(', '));

        const collective = (artist.collective || artist.Collective || '').toString().trim();
        if (collective) parts.push(collective);

        if (parts.length === 0) return 'no details available';
        return parts.join(' | ');
    }

    // Create a simple static layout: place nodes in concentric, degree-weighted rings
    // Highly connected nodes are placed closer to center; less connected nodes are toward the outside.
    setupStaticLayout() {
        if (!this.nodes || this.nodes.length === 0) return;

        // compute degree per node id
        const degree = {};
        this.connections.forEach(c => {
            if (c.from) degree[c.from] = (degree[c.from] || 0) + 1;
            if (c.to) degree[c.to] = (degree[c.to] || 0) + 1;
        });

        const degValues = Object.values(degree);
        const maxDeg = degValues.length ? Math.max(...degValues) : 1;

    const rect = this.canvas.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    // Use separate radii for X and Y so the static layout fills the canvas aspect
    // ratio instead of forcing a circular (square-limited) placement.
    const baseRadiusX = Math.max(50, rect.width * 0.45);
    const baseRadiusY = Math.max(50, rect.height * 0.45);

        // sort nodes so we can give deterministic-ish placement for equal-degree nodes
        const nodesSorted = [...this.nodes].sort((a, b) => (degree[b.id] || 0) - (degree[a.id] || 0));

        for (let i = 0; i < nodesSorted.length; i++) {
            const node = nodesSorted[i];
            const deg = degree[node.id] || 0;

            // normalized centrality: 0..1 (1 = most connected)
            const centrality = deg / Math.max(maxDeg, 1);

            // radial distances for X and Y separately so layout spans the full rectangle
            const rX = baseRadiusX * (1 - 0.7 * centrality) * (0.75 + Math.random() * 0.5);
            const rY = baseRadiusY * (1 - 0.7 * centrality) * (0.75 + Math.random() * 0.5);

            // angle distribution around ellipse; scatter jitter to avoid lattice
            const angle = (i / nodesSorted.length) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;

            node.x = centerX + Math.cos(angle) * rX;
            node.y = centerY + Math.sin(angle) * rY;
            node.vx = 0;
            node.vy = 0;
        }

        // rebuild indexes used by render and other algorithms
    this.buildIndexes();
    }
    
    centerView() {
        if (this.nodes.length === 0) {
            return;
        }
        
        const bounds = this.getBounds();
        const containerRect = this.canvas.getBoundingClientRect();
        
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;
        
    const isMobile = window.innerWidth <= 768;
    // On mobile, apply a slightly elevated base scale so text stays legible without excessive zoom.
    const mobileScale = this.mobileDefaultCenterScale || 1.6;
    this.scale = isMobile ? mobileScale : 1;

    // compute offsets so the graph center is visible in the canvas center
    this.offsetX = containerRect.width / 2 - centerX * this.scale;
    this.offsetY = containerRect.height / 2 - centerY * this.scale;
        
    }

    // Scale and offset the graph to fill the available canvas with appropriate margins
    fitToScreen() {
        if (this.nodes.length === 0) {
            return;
        }
        
        const bounds = this.getBounds();
        const containerRect = this.canvas.getBoundingClientRect();
        
        // compute graph dimensions
        const graphWidth = bounds.maxX - bounds.minX;
        const graphHeight = bounds.maxY - bounds.minY;
        
    // desired margins (pixels in canvas space)
        const availableWidth = containerRect.width - 2 * 80; // default, may adjust for desktop below
        const availableHeight = containerRect.height - 2 * 80;
        
        // Apply user's preferred initial zoom multiplier (e.g., 4x) but only on mobile
        const isMobile = window.innerWidth <= 768;
    // increase margin on desktop (reduce slightly to allow a more expanded default view)
    const margin = isMobile ? 80 : 100; // smaller desktop margin so the graph appears more expanded
    // By default, limit available width/height to container minus margins. On desktop,
    // allow the "available" graph area to be twice the visible viewport so users can
    // pan into more expansion space. This effectively gives more room for the layout
    // and results in a more zoomed-in default view while preserving mobile behavior.
    let finalAvailableWidth = containerRect.width - 2 * margin;
    let finalAvailableHeight = containerRect.height - 2 * margin;
    if (!isMobile) {
        finalAvailableWidth = Math.max(finalAvailableWidth, containerRect.width * 2 - 2 * margin);
        finalAvailableHeight = Math.max(finalAvailableHeight, containerRect.height * 2 - 2 * margin);
    }

        // compute scale to fit graph in available space (with some breathing room)
        let scale = 1;
        if (graphWidth > 0 && graphHeight > 0) {
            const scaleX = finalAvailableWidth / graphWidth;
            const scaleY = finalAvailableHeight / graphHeight;
            scale = Math.min(scaleX, scaleY, 1.2); // cap max scale at 1.2 to avoid over-zooming small graphs
            scale = Math.max(scale, 0.6); // ensure minimum scale so graph doesn't get too tiny
        }

        // Determine multiplier: mobile uses the large initialZoomMultiplier, desktop uses a stronger desktopInitialZoomMultiplier
        const multiplier = isMobile ? (this.initialZoomMultiplier || 1) : (this.desktopInitialZoomMultiplier || this.desktopExpandMultiplier || 1);
        if (multiplier && multiplier > 1) {
            scale = scale * multiplier;
            // hard cap to avoid insane zooms
            scale = Math.min(scale, 8);
        }
        
    // compute center of graph in original coords
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;
        
        // set offset so graph center aligns with canvas center after scaling
        this.offsetX = containerRect.width / 2 - centerX * scale;
        this.offsetY = containerRect.height / 2 - centerY * scale;
        this.scale = scale;
        
    }
    
    getBounds() {
        if (this.nodes.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
        
        let minX = this.nodes[0].x, maxX = this.nodes[0].x;
        let minY = this.nodes[0].y, maxY = this.nodes[0].y;
        
        this.nodes.forEach(node => {
            minX = Math.min(minX, node.x);
            maxX = Math.max(maxX, node.x);
            minY = Math.min(minY, node.y);
            maxY = Math.max(maxY, node.y);
        });
        
        return { minX, maxX, minY, maxY };
    }
    
    render() {
        const rect = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.save();
        this.ctx.translate(this.offsetX, this.offsetY);
        this.ctx.scale(this.scale, this.scale);
        // Branch: legacy style (original look) vs enhanced visuals
        if (this.legacyStyle) {
            // Original drawing style (keeps your original look)
            // connection lines: muted neon green (slightly more saturated)
            // Slightly more contrasty but still light lines for overview
            this.ctx.lineWidth = 1;
            const baseConnAlpha = 0.55;
            // If hover is active, draw connections with related edges emphasized
            if (this.hoverProgress > 0) {
                    // draw edges: related edges keep original color, others are darkened but keep strength
                    const baseGreen = '#00ff00';
                    for (const cref of this.connectionRefs) {
                        if (!this.shouldRenderConnection(cref)) continue;
                        const key = `${cref.from.id}::${cref.to.id}`;
                        const isRelated = this.hoverConnectedEdges && this.hoverConnectedEdges.has(key);
                        this.ctx.beginPath();
                        this.ctx.moveTo(cref.from.x, cref.from.y);
                        this.ctx.lineTo(cref.to.x, cref.to.y);
                        if (isRelated) {
                            this.ctx.strokeStyle = baseGreen;
                        } else {
                            const dark = this._darkenColor(baseGreen, 0.9 * this.hoverProgress);
                            this.ctx.strokeStyle = dark;
                        }
                        this.ctx.stroke();
                    }

                // Draw non-related nodes first: keep labels visible but darken color
                this.nodes.forEach(node => {
                    if (!this.isNodeVisible(node)) return;
                    if (this.hoverConnectedNodes && this.hoverConnectedNodes.has(node.id)) return; // skip related
                    const drawKey = this._computeDrawKeyForNode(node);
                    const nodeType = this.nodeTypes[drawKey] || this.nodeTypes[node.type] || { color: '#888', radius: 6 };
                    const darkFill = this._darkenColor(nodeType.color, 0.9 * this.hoverProgress);
                    // draw circle with darkened color
                    this.ctx.fillStyle = darkFill;
                    this.ctx.beginPath();
                    this.ctx.arc(node.x, node.y, nodeType.radius, 0, Math.PI * 2);
                    this.ctx.fill();
                    // border darkened
                    this.ctx.strokeStyle = this._darkenColor(nodeType.color, 0.95 * this.hoverProgress);
                    this.ctx.lineWidth = 1;
                    this.ctx.stroke();
                    // label remains visible but darker
                    const label = String(node.label || '').slice(0, 36);
                    this.ctx.font = '12px Courier New, monospace';
                    const metrics = this.ctx.measureText(label);
                    const pad = 8;
                    const labelX = node.x;
                    const labelY = node.y + nodeType.radius + 16;
                    this.ctx.fillStyle = this._darkenColor(this.mutedLabelColor[drawKey] || this.mutedLabelColor[node.type] || '#999999', 0.99 * this.hoverProgress);
                    this.ctx.textAlign = 'center';
                    this.ctx.fillText(label, labelX, labelY);
                });

                // Finally draw related nodes (ensure they are on top) with labels
                this.nodes.forEach(node => {
                    if (!this.isNodeVisible(node)) return;
                    if (!(this.hoverConnectedNodes && this.hoverConnectedNodes.has(node.id))) return;
                    const drawKey = this._computeDrawKeyForNode(node);
                    const nodeType = this.nodeTypes[drawKey] || this.nodeTypes[node.type] || { color: '#888', radius: 6 };
                    // Draw node circle
                    this.ctx.fillStyle = nodeType.color;
                    this.ctx.beginPath();
                    this.ctx.arc(node.x, node.y, nodeType.radius, 0, Math.PI * 2);
                    this.ctx.fill();
                    // Border
                    this.ctx.strokeStyle = nodeType.color;
                    this.ctx.lineWidth = 1;
                    this.ctx.stroke();
                    // Label
                    const label = String(node.label || '').slice(0, 36);
                    this.ctx.font = '12px Courier New, monospace';
                    const metrics = this.ctx.measureText(label);
                    const pad = 8;
                    const labelX = node.x;
                    const labelY = node.y + nodeType.radius + 16;
                    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                    this.ctx.fillRect(labelX - metrics.width / 2 - pad/2, labelY - 12, metrics.width + pad, 16);
                    this.ctx.fillStyle = this.mutedLabelColor[drawKey] || this.mutedLabelColor[node.type] || '#999999';
                    this.ctx.textAlign = 'center';
                    this.ctx.fillText(label, labelX, labelY);
                });
            } else {
                // No hover: regular drawing
                for (const cref of this.connectionRefs) {
                    if (!this.shouldRenderConnection(cref)) continue;
                    this.ctx.beginPath();
                    this.ctx.moveTo(cref.from.x, cref.from.y);
                    this.ctx.lineTo(cref.to.x, cref.to.y);
                    this.ctx.globalAlpha = baseConnAlpha;
                    this.ctx.strokeStyle = 'rgba(0,255,0,1)';
                    this.ctx.stroke();
                }
                this.ctx.globalAlpha = 1;

                this.nodes.forEach(node => {
                    if (!this.isNodeVisible(node)) return; // skip hidden types
                    const drawKey = this._computeDrawKeyForNode(node);
                    const nodeType = this.nodeTypes[drawKey] || this.nodeTypes[node.type] || { color: '#888', radius: 6 };
                    // Draw node circle
                    this.ctx.fillStyle = nodeType.color;
                    this.ctx.beginPath();
                    this.ctx.arc(node.x, node.y, nodeType.radius, 0, Math.PI * 2);
                    this.ctx.fill();
                    // Draw node border
                    this.ctx.strokeStyle = nodeType.color;
                    this.ctx.lineWidth = 1;
                    this.ctx.stroke();
                    // Draw label
                    const label = String(node.label || '').slice(0, 36);
                    this.ctx.font = '12px Courier New, monospace';
                    const metrics = this.ctx.measureText(label);
                    const pad = 8;
                    const labelX = node.x;
                    const labelY = node.y + nodeType.radius + 16;
                    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'; // Semi-transparent black background
                    this.ctx.fillRect(labelX - metrics.width / 2 - pad/2, labelY - 12, metrics.width + pad, 16);
                    this.ctx.fillStyle = this.mutedLabelColor[drawKey] || this.mutedLabelColor[node.type] || '#999999';
                    this.ctx.textAlign = 'center';
                    this.ctx.fillText(label, labelX, labelY);
                });
            }
        } else {
            // Enhanced visuals (alternate mode)
            // use muted neon green for connection lines to match original distribution
            // lighter lines in enhanced mode
            this.ctx.lineWidth = 1;
            const baseConnAlpha = 0.6;
            if (this.hoverProgress > 0) {
                // draw edges with darkened color for non-related edges
                const baseGreen = '#00ff00';
                for (const cref of this.connectionRefs) {
                    if (!this.shouldRenderConnection(cref)) continue;
                    const key = `${cref.from.id}::${cref.to.id}`;
                    const isRelated = this.hoverConnectedEdges && this.hoverConnectedEdges.has(key);
                    this.ctx.beginPath();
                    this.ctx.moveTo(cref.from.x, cref.from.y);
                    this.ctx.lineTo(cref.to.x, cref.to.y);
                    if (isRelated) {
                        this.ctx.strokeStyle = baseGreen;
                    } else {
                        this.ctx.strokeStyle = this._darkenColor(baseGreen, 0.9 * this.hoverProgress);
                    }
                    this.ctx.stroke();
                }

                // non-related nodes: draw them darker but keep labels visible
                this.nodes.forEach(node => {
                    if (!this.isNodeVisible(node)) return;
                    if (this.hoverConnectedNodes && this.hoverConnectedNodes.has(node.id)) return;
                    const drawKey = this._computeDrawKeyForNode(node);
                    const nodeType = this.nodeTypes[drawKey] || this.nodeTypes[node.type] || { color: '#888', radius: 6 };
                    const darkFill = this._darkenColor(nodeType.color, 0.9 * this.hoverProgress);
                    this.ctx.beginPath();
                    this.ctx.fillStyle = darkFill;
                    this.ctx.arc(node.x, node.y, nodeType.radius, 0, Math.PI * 2);
                    this.ctx.fill();
                    // subtle halo (darkened)
                    this.ctx.beginPath();
                    this.ctx.strokeStyle = this._darkenColor(nodeType.color, 0.95 * this.hoverProgress);
                    this.ctx.lineWidth = 6;
                    this.ctx.arc(node.x, node.y, nodeType.radius + 3, 0, Math.PI * 2);
                    this.ctx.stroke();
                    // label remains visible but darker
                    const label = String(node.label || '').slice(0, 36);
                    const labelX = node.x;
                    const labelY = node.y + nodeType.radius + 16;
                    const metrics = this.ctx.measureText(label);
                    const pad = 6;
                    this.ctx.fillStyle = 'rgba(0,0,0,0.5)';
                    this.ctx.fillRect(labelX - metrics.width / 2 - pad/2, labelY - 11, metrics.width + pad, 14);
                    this.ctx.fillStyle = this._darkenColor(this.mutedLabelColor[drawKey] || this.mutedLabelColor[node.type] || '#cccccc', 0.99 * this.hoverProgress);
                    this.ctx.fillText(label, labelX, labelY);
                });

                // draw related nodes on top with labels and halo
                this.nodes.forEach(node => {
                    if (!this.isNodeVisible(node)) return;
                    if (!(this.hoverConnectedNodes && this.hoverConnectedNodes.has(node.id))) return;
                    const drawKey = this._computeDrawKeyForNode(node);
                    const nodeType = this.nodeTypes[drawKey] || this.nodeTypes[node.type] || { color: '#888', radius: 6 };
                    this.ctx.beginPath();
                    this.ctx.fillStyle = nodeType.color;
                    this.ctx.arc(node.x, node.y, nodeType.radius, 0, Math.PI * 2);
                    this.ctx.fill();
                    this.ctx.beginPath();
                    this.ctx.strokeStyle = nodeType.color;
                    this.ctx.globalAlpha = 0.25;
                    this.ctx.lineWidth = 6;
                    this.ctx.arc(node.x, node.y, nodeType.radius + 3, 0, Math.PI * 2);
                    this.ctx.stroke();
                    this.ctx.globalAlpha = 1;
                    // label
                    const label = String(node.label || '').slice(0, 36);
                    const labelX = node.x;
                    const labelY = node.y + nodeType.radius + 16;
                    const metrics = this.ctx.measureText(label);
                    const pad = 6;
                    this.ctx.fillStyle = 'rgba(0,0,0,0.5)';
                    this.ctx.fillRect(labelX - metrics.width / 2 - pad/2, labelY - 11, metrics.width + pad, 14);
                    this.ctx.fillStyle = this.mutedLabelColor[drawKey] || this.mutedLabelColor[node.type] || '#cccccc';
                    this.ctx.fillText(label, labelX, labelY);
                });
            } else {
                for (const cref of this.connectionRefs) {
                    if (!this.shouldRenderConnection(cref)) continue;
                    this.ctx.beginPath();
                    this.ctx.moveTo(cref.from.x, cref.from.y);
                    this.ctx.lineTo(cref.to.x, cref.to.y);
                    this.ctx.stroke();
                }

                this.nodes.forEach(node => {
                    if (!this.isNodeVisible(node)) return;
                    const drawKey = this._computeDrawKeyForNode(node);
                    const nodeType = this.nodeTypes[drawKey] || this.nodeTypes[node.type] || { color: '#888', radius: 6 };

                    // Draw node with subtle halo for visibility
                    this.ctx.beginPath();
                    this.ctx.fillStyle = nodeType.color;
                    this.ctx.arc(node.x, node.y, nodeType.radius, 0, Math.PI * 2);
                    this.ctx.fill();

                    // soft outer ring
                    this.ctx.beginPath();
                    this.ctx.strokeStyle = nodeType.color;
                    this.ctx.globalAlpha = 0.25;
                    this.ctx.lineWidth = 6;
                    this.ctx.arc(node.x, node.y, nodeType.radius + 3, 0, Math.PI * 2);
                    this.ctx.stroke();
                    this.ctx.globalAlpha = 1;

                    // label - offset vertically to avoid overlap; use muted color derived from node color
                    this.ctx.font = '13px Courier New, monospace';
                    this.ctx.textAlign = 'center';
                    this.ctx.fillStyle = this.mutedLabelColor[drawKey] || this.mutedLabelColor[node.type] || '#cccccc';

                    // Split long labels and clamp length
                    const label = String(node.label || '').slice(0, 36);
                    const labelX = node.x;
                    const labelY = node.y + nodeType.radius + 16;
                    // draw a subtle background for readability
                    const metrics = this.ctx.measureText(label);
                    const pad = 6;
                    this.ctx.fillStyle = 'rgba(0,0,0,0.5)';
                    this.ctx.fillRect(labelX - metrics.width / 2 - pad/2, labelY - 11, metrics.width + pad, 14);

                    // draw text on top using same muted color
                    this.ctx.fillStyle = this.mutedLabelColor[node.type] || '#cccccc';
                    this.ctx.fillText(label, labelX, labelY);
                });
            }
        }
        
        this.ctx.restore();
        
    }
    
    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left - this.offsetX) / this.scale,
            y: (e.clientY - rect.top - this.offsetY) / this.scale
        };
    }
    
    getTouchPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        const touch = e.touches[0];
        return {
            x: (touch.clientX - rect.left - this.offsetX) / this.scale,
            y: (touch.clientY - rect.top - this.offsetY) / this.scale
        };
    }
    
    getNodeAt(pos) {
        return this.nodes.find(node => {
            if (!this.isNodeVisible(node)) return false; // ignore hidden types
            const dx = node.x - pos.x;
            const dy = node.y - pos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Resolve a safe radius for hit testing. Nodes may have a `types` array or a
            // `type` value like 'both' which isn't a direct key in nodeTypes. Prefer any
            // existing known type from node.types, otherwise fall back to node.type if present
            // in nodeTypes, and finally default to 'artist' radius for compatibility.
            const candidateKeys = Array.isArray(node.types) && node.types.length > 0 ? node.types.slice() : [];
            if (node.type) candidateKeys.push(node.type);
            let radius = null;
            for (const k of candidateKeys) {
                if (k && this.nodeTypes[k]) { radius = this.nodeTypes[k].radius; break; }
            }
            if (radius === null) radius = (this.nodeTypes.artist && this.nodeTypes.artist.radius) || 8;

            return distance <= radius + 5;
        });
    }

    // internal: clear hover timer & candidate without changing active hover state
    _clearHoverCandidate() {
        if (this._hoverTimer) {
            clearTimeout(this._hoverTimer);
            this._hoverTimer = null;
        }
        this._hoverCandidate = null;
    }

    _activateHover(node) {
        if (!node) return;
        // build connected node set and edge keys
        this.hoverNode = node;
        this.hoverConnectedNodes = new Set([node.id]);
        this.hoverConnectedEdges = new Set();
        this.connectionRefs.forEach((cref, idx) => {
            if (!cref || !cref.from || !cref.to) return;
            if (cref.from.id === node.id || cref.to.id === node.id) {
                // add neighbor
                this.hoverConnectedNodes.add(cref.from.id);
                this.hoverConnectedNodes.add(cref.to.id);
                this.hoverConnectedEdges.add(`${cref.from.id}::${cref.to.id}`);
            }
        });
        this.hoverActive = true;
        // Immediately set hover progress to fully active (no animation)
        if (this._hoverAnimFrame) cancelAnimationFrame(this._hoverAnimFrame);
        this.hoverProgress = 1;
        this.render();
    }

    _deactivateHover() {
        // Immediately deactivate hover (no animation)
        if (this._hoverAnimFrame) cancelAnimationFrame(this._hoverAnimFrame);
        this.hoverProgress = 0;
        this.hoverActive = false;
        this.hoverNode = null;
        this.hoverConnectedNodes = new Set();
        this.hoverConnectedEdges = new Set();
        this.render();
    }

    _startHoverAnimation(target, duration = 150, cb) {
        // Animations have been disabled: set the target state immediately.
        if (this._hoverAnimFrame) cancelAnimationFrame(this._hoverAnimFrame);
        this.hoverProgress = target ? 1 : 0;
        this.render();
        if (cb) cb();
    }

    // compute the draw key for a node (used by render and for debug reporting)
    _computeDrawKeyForNode(n) {
        if (!n) return 'other';
        if (n.types && Array.isArray(n.types) && n.types.includes('artist') && n.types.includes('dj')) {
            if (this.visibleTypes.dj && !this.visibleTypes.artist) return 'dj';
            return 'artist';
        }
        if (n.types && n.types.includes('dj')) return 'dj';
        if (n.types && n.types.includes('artist')) return 'artist';
        if (n.type && this.nodeTypes[n.type]) return n.type;
        return 'other';
    }

    handleMouseDown(e) {
        const pos = this.getMousePos(e);
        const node = this.getNodeAt(pos);

    // Suppress automatic layout runs for a short window after a direct mouse interaction
    // This prevents an apparent 'reload' of the layout when the user clicks the network.
    // Increase window to 3s to be defensive while we trace the caller that triggers runLayout.
    this._suppressRunLayoutUntil = Date.now() + 3000; // suppress for 3 seconds

        if (node) {
            // Start dragging a node (allow dragging all types)
            // user is interacting -> stop auto-centering temporarily
            this.autoCentering = false;
            this.autoCenterTicks = 0;
            this.nodeDragging = true;
            this.draggedNode = node;
            this.nodeDragOffset.x = pos.x - node.x;
            this.nodeDragOffset.y = pos.y - node.y;
            // record pointer start to detect click vs drag
            this._mouseDownPos = { x: pos.x, y: pos.y };
            this._mouseStartNodePos = { x: node.x, y: node.y };
            // Do not open modal on immediate mousedown; use click/tap release to open
            // record last clicked candidate for debug purposes
            this.lastClickedCandidate = { id: node.id, types: node.types, type: node.type, label: node.label };
        } else {
            // Start panning
            // user is interacting -> stop auto-centering temporarily
            this.autoCentering = false;
            this.autoCenterTicks = 0;
            this.isDragging = true;
            this.dragStart = { x: e.clientX - this.offsetX, y: e.clientY - this.offsetY };
        }
    }
    
    handleMouseMove(e) {
        const pos = this.getMousePos(e);
        if (this.nodeDragging && this.draggedNode) {
            // Move dragged node
            this.draggedNode.x = pos.x - this.nodeDragOffset.x;
            this.draggedNode.y = pos.y - this.nodeDragOffset.y;
            this.render();
        } else if (this.isDragging) {
            this.offsetX = e.clientX - this.dragStart.x;
            this.offsetY = e.clientY - this.dragStart.y;
            this.render();
            // While panning, cancel any pending hover
            this._clearHoverCandidate();
            return;
        }

        // Hover handling (desktop only, when not dragging) — only active while Meta/Windows key is pressed
        const isMobile = window.innerWidth <= 768;
        if (!isMobile && !this.nodeDragging && !this.isDragging) {
            if (e && !e.metaKey) {
                // meta key not held: clear any candidate and deactivate hover if active
                this._clearHoverCandidate();
                if (this.hoverActive) this._deactivateHover();
            } else if (e && e.metaKey) {
                const hit = this.getNodeAt(pos);
                if (hit) {
                    // If moved over a new candidate, activate immediately (no delay)
                    if (!this._hoverCandidate || this._hoverCandidate.id !== hit.id) {
                        this._hoverCandidate = hit;
                        if (this._hoverTimer) { clearTimeout(this._hoverTimer); this._hoverTimer = null; }
                        // Activate hover immediately (remove debounce/delay)
                        this._activateHover(hit);
                    }
                } else {
                    // not over any node — clear candidate and schedule deactivation
                    this._clearHoverCandidate();
                    if (this.hoverActive) {
                        // deactivate quickly
                        this._deactivateHover();
                    }
                }
            }
        }
    }
    
    handleMouseUp(e) {
        // If we were dragging a node and released, decide whether it was a click or a drag
        const pos = this.getMousePos(e);
        if (this.nodeDragging && this.draggedNode) {
            const node = this.draggedNode;
            // compare pointer movement to see whether this was a click or a drag
            const down = this._mouseDownPos || { x: node.x, y: node.y };
            const dx = node.x - this._mouseStartNodePos.x;
            const dy = node.y - this._mouseStartNodePos.y;
            const moved = Math.sqrt(dx*dx + dy*dy) > 6; // slightly lower threshold for responsiveness
            if (!moved) {
                // It was a click (no significant movement)
                const nodeIsArtistLike = this.isPersonNode(node);
                // store lastClicked info
                this.lastClicked = { id: node.id, types: node.types, type: node.type, label: node.label, isArtistLike: nodeIsArtistLike, drawKey: this._computeDrawKeyForNode(node) };
                if (nodeIsArtistLike) this.showArtistModal(node.data);
                else this.showGroupModal(node);
            }
        }

        this.isDragging = false;
        this.nodeDragging = false;
        this.draggedNode = null;
        this._mouseDownPos = null;
        this._mouseStartNodePos = null;
    }

    // helper to show a group modal (for location or genre) listing matching producers
    showGroupModal(node) {
        // Save current view state before opening modal to restore later
        this._savedViewState = {
            scale: this.scale,
            offsetX: this.offsetX,
            offsetY: this.offsetY
        };

        this._modalOpen = true;
        
        const label = node.label || '';
        const type = node.type; // 'location' or 'genre'
        const title = `${label} — ${type}`;

    // find producers related to this node via connections (preferred)
        this.buildIndexes();
        let matches = this.connectionRefs
            .filter(cref => cref.to && cref.to.id === node.id && cref.from && this.isPersonNode(cref.from))
            .map(cref => cref.from);

        // fallback to data-field matching if no connections found
        if (matches.length === 0) {
            matches = this.nodes.filter(n => (n.type === 'artist' || n.type === 'dj') && n.data).filter(a => {
                const art = a.data;
                const genre = (art.genre || art.Genre || '').toString().trim().toLowerCase();
                const loc1 = (art.location || art.Location || '').toString().trim().toLowerCase();
                const loc2 = (art.location2 || art['Location 2'] || art.location2 || '').toString().trim().toLowerCase();
                    // Support both singular 'collective' field and normalized 'collectives' array
                    const collectiveRaw = (art.collective || art.Collective || '').toString().trim();
                    const collective = collectiveRaw.toLowerCase();
                    const collectiveParts = (collectiveRaw ? collectiveRaw.split(/[;,]+/).map(s => s.trim().toLowerCase()).filter(Boolean) : []);
                    const collectiveArray = Array.isArray(art.collectives) ? art.collectives.map(s => String(s).trim().toLowerCase()).filter(Boolean) : [];
                const labelLow = label.toString().trim().toLowerCase();
                if (type === 'genre') return genre === labelLow;
                    if (type === 'collective') return collective === labelLow || collectiveParts.includes(labelLow) || collectiveArray.includes(labelLow);
                    return loc1 === labelLow || loc2 === labelLow;
            });
        }

        // Build list HTML
        let html = '<div class="group-list">';
        if (matches.length === 0) {
            html += '<p style="margin-bottom:12px;">No producers found for this ' + type + '.</p>';
        } else {
            html += '<ul style="list-style:none;padding:0;margin:0 0 12px 0;">';
            matches.forEach((m, i) => {
                const art = m.data;
                const name = (art.artistName || art['Artist Name'] || art.firstName || art['First Name'] || 'unknown').toString();
                html += `<li style="margin-bottom:8px;"><button class=\"group-artist-btn\" data-idx=\"${i}\" style=\"background:transparent;border:1px solid #00ff00;color:#00ff00;padding:6px 8px;font-family:Courier New,monospace;cursor:pointer;width:100%;text-align:left;\">${name}</button></li>`;
            });
            html += '</ul>';
        }
        html += '</div>';

    const modalContent = document.getElementById('modal-content');
    modalContent.innerHTML = html;
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-overlay').classList.remove('hidden');
    // add class to body so we can hide other UI elements via CSS
    document.body.classList.add('modal-open');

        // Wire up buttons to open artist modal (replace content with full artist view)
        const buttons = modalContent.querySelectorAll('.group-artist-btn');
        buttons.forEach((btn, idx) => {
            btn.addEventListener('click', () => {
                const m = matches[idx];
                if (m) this.showArtistModal(m.data);
            });
        });
    }
    
    handleTouchStart(e) {
        e.preventDefault();
        const pos = this.getTouchPos(e);
        const node = this.getNodeAt(pos);
        if (e.touches && e.touches.length === 2) {
            // start pinch
            this._pinch = {
                startDist: this.getTouchDistance(e.touches[0], e.touches[1]),
                startScale: this.scale,
                mid: {
                    x: ((e.touches[0].clientX + e.touches[1].clientX) / 2),
                    y: ((e.touches[0].clientY + e.touches[1].clientY) / 2)
                }
            };
            return;
        }

        if (node) {
            this.nodeDragging = true;
            // user is interacting -> stop auto-centering temporarily
            this.autoCentering = false;
            this.autoCenterTicks = 0;
            this.draggedNode = node;
            this.nodeDragOffset.x = pos.x - node.x;
            this.nodeDragOffset.y = pos.y - node.y;
            // store initial touch position to detect taps vs drags
            this._touchStartPos = { x: pos.x, y: pos.y };
            this._touchStartNodePos = { x: node.x, y: node.y };
        } else if (e.touches.length === 1) {
            // user is interacting -> stop auto-centering temporarily
            this.autoCentering = false;
            this.isDragging = true;
            const touch = e.touches[0];
            this.dragStart = { x: touch.clientX - this.offsetX, y: touch.clientY - this.offsetY };
        }
    }
    
    handleTouchMove(e) {
        e.preventDefault();
        if (e.touches && e.touches.length === 2 && this._pinch) {
            // pinch zoom
            const newDist = this.getTouchDistance(e.touches[0], e.touches[1]);
            const scaleDelta = newDist / this._pinch.startDist;
            const newScale = Math.max(0.1, Math.min(3, this._pinch.startScale * scaleDelta));

            // midpoint in screen coords
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            const rect = this.canvas.getBoundingClientRect();
            const mx = (midX - rect.left - this.offsetX) / this.scale;
            const my = (midY - rect.top - this.offsetY) / this.scale;

            // update offsets so the midpoint stays fixed
            this.offsetX = midX - rect.left - mx * newScale;
            this.offsetY = midY - rect.top - my * newScale;
            this.scale = newScale;
            this.render();
            return;
        }

        if (this.nodeDragging && this.draggedNode && e.touches.length === 1) {
            const pos = this.getTouchPos(e);
            this.draggedNode.x = pos.x - this.nodeDragOffset.x;
            this.draggedNode.y = pos.y - this.nodeDragOffset.y;
            this.render();
        } else if (this.isDragging && e.touches.length === 1) {
            const touch = e.touches[0];
            this.offsetX = touch.clientX - this.dragStart.x;
            this.offsetY = touch.clientY - this.dragStart.y;
            this.render();
        }
    }
    
    handleTouchEnd(e) {
        e.preventDefault();
        // End pinch if present
        if (this._pinch && (!e.touches || e.touches.length < 2)) {
            this._pinch = null;
        }

        // Determine if touch was a tap (no significant movement)
        if (this.nodeDragging && this.draggedNode) {
            const pos = this._touchStartPos || { x: 0, y: 0 };
            // last touch position fallback: use draggedNode position
            const last = { x: this.draggedNode.x + this.nodeDragOffset.x, y: this.draggedNode.y + this.nodeDragOffset.y };
            const dx = last.x - pos.x;
            const dy = last.y - pos.y;
            const moved = Math.sqrt(dx*dx + dy*dy) > 8; // slightly larger threshold for touch
            if (!moved) {
                if (this.draggedNode.type === 'artist' || this.draggedNode.type === 'dj') this.showArtistModal(this.draggedNode.data);
                else this.showGroupModal(this.draggedNode);
            }
        }

        this.isDragging = false;
        this.nodeDragging = false;
        this.draggedNode = null;
        this._touchStartPos = null;
        this._touchStartNodePos = null;
    }
    
    handleWheel(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        // mouse position in canvas coords
        const mx = (e.clientX - rect.left - this.offsetX) / this.scale;
        const my = (e.clientY - rect.top - this.offsetY) / this.scale;

        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.max(0.1, Math.min(3, this.scale * zoomFactor));

        // adjust offset so the point under the cursor stays fixed
        this.offsetX = e.clientX - rect.left - mx * newScale;
        this.offsetY = e.clientY - rect.top - my * newScale;
        this.scale = newScale;
        this.render();
    }

    // Touch pinch-zoom helpers
    getTouchDistance(t1, t2) {
        const dx = t2.clientX - t1.clientX;
        const dy = t2.clientY - t1.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    showArtistModal(artist) {
        // Save current view state before opening modal to restore later
        this._savedViewState = {
            scale: this.scale,
            offsetX: this.offsetX,
            offsetY: this.offsetY
        };

        this._modalOpen = true;
        
        // Handle flexible field names from CSV
        const artistName = artist.artistName || artist['Artist Name'] || 'unknown artist';
        const firstName = artist.firstName || artist['First Name'] || '';
        const genre = artist.genre || artist.Genre || 'not specified';
        // Support multiple locations
        const locations = (artist.locations && artist.locations.length > 0)
            ? artist.locations
            : [ (artist.location || artist.Location || artist['Location '] || '') ].filter(Boolean);
        const location1 = locations[0] || 'not specified';
        const location2 = locations[1] || '';
        const url = artist.url || artist.URL || '';
    const infoText = artist.infoText || artist['Info Text'] || 'no additional information available';
        const subgenre = artist.subgenre || artist.Subgenre || '';
        const names = artist.names || [];
        // Inject full artist view into modal content (replaces group list if present)
        const modalContent = document.getElementById('modal-content');
        if (!modalContent) return;

        // Combine locations into single display (show all locations)
        const locationDisplay = locations.length > 0 ? locations.join(', ') : 'not specified';

        // Name field: prefer names provided in Name(s) column. If none provided, fall back to artistName.
        const nameDisplay = (names && names.length > 0) ? names.join(', ') : (artistName || firstName || 'unknown artist');

        // Genre display: include subgenre if present
        const genreDisplay = subgenre ? `${genre}${genre ? ' — ' : ''}${subgenre}` : genre;

        // Location label: pluralize if multiple
        const locationLabel = (locations && locations.length > 1) ? 'locations' : 'location';

        // Collective links (if any)
        let collectiveHTML = '';
    const collectiveArray = (artist.collectives && artist.collectives.length > 0) ? artist.collectives : ((artist.collective && artist.collective.length>0) ? artist.collective.split(/[;,]+/).map(s=>s.trim()).filter(Boolean) : []);
    const contactFor = artist.contactFor || artist['Contact me for...'] || artist['contact me for...'] || '';
        if (collectiveArray.length > 0) {
            collectiveHTML = collectiveArray.map((c, idx) => `<a href="#" class="artist-collective-link" data-collective="${c}">${c}</a>`).join(', ');
        }

        modalContent.innerHTML = `
            <div id="artist-info">
                <div class="info-row">
                    <span class="label">name:</span>
                    <span id="artist-name">${nameDisplay}</span>
                </div>
                <div class="info-row">
                    <span class="label">url:</span>
                    <a id="artist-url" href="${url && url.startsWith('http') ? url : (url ? `https://${url}` : '#')}" target="_blank" style="${url?'' : 'display:none;'}">${url}</a>
                </div>
                <div class="info-row">
                    <span class="label">info:</span>
                    <p id="artist-info-text">${infoText}</p>
                </div>
                <div class="info-row">
                    <span class="label">genre:</span>
                    <span id="artist-genre">${genreDisplay}</span>
                </div>
                <div class="info-row">
                    <span class="label">${locationLabel}:</span>
                    <span id="artist-location">${locationDisplay}</span>
                </div>
                ${collectiveHTML ? `<div class="info-row"><span class="label">collective:</span><span id="artist-collective">${collectiveHTML}</span></div>` : ''}
                ${contactFor ? `<div class="info-row"><span class="label">Contact me for:</span><span id="artist-contact">${contactFor}</span></div>` : ''}
            </div>
        `;

        // Attach click handlers for collective links so they open the respective modal
        if (collectiveHTML) {
            const links = modalContent.querySelectorAll('.artist-collective-link');
            links.forEach((ln) => {
                ln.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    const cname = ln.dataset.collective;
                    if (!cname) return;
                    // find the collective node with matching label
                    const collectiveNode = this.nodes.find(n => n.type === 'collective' && n.label === cname);
                    if (collectiveNode) {
                        this.showGroupModal(collectiveNode);
                    } else {
                    }
                });
            });
        }

        const titleEl = document.getElementById('modal-title');
        if (titleEl) titleEl.textContent = artistName;

        const overlay = document.getElementById('modal-overlay');
        if (overlay) overlay.classList.remove('hidden');
        // add class to body so other UI hides while modal is open
        document.body.classList.add('modal-open');
    }
    
    showAboutModal() {
        // Save current view state before opening modal to restore later
        this._savedViewState = {
            scale: this.scale,
            offsetX: this.offsetX,
            offsetY: this.offsetY
        };

        this._modalOpen = true;
        
        const modalContent = document.getElementById('modal-content');
        if (!modalContent) return;

        modalContent.innerHTML = `
            <div class="about-content">
                <p>The <strong>COLLISIONI Electronic Music Network</strong> is an interactive visualization of the electronic music scene in Südtirol/Alto Adige. This map connects producers, locations, genres, and collectives to highlight the vast diversity of people creating music in this field.</p>
                
                <ul style="margin: 15px 0; padding-left: 20px;">
                    <li><span style="color: #00ff00;">●</span> <strong>Producers</strong> - Electronic music creators</li>
                    <li><span style="color: #ff0080;">●</span> <strong>Locations</strong> - Cities and venues where they live and work</li>
                    <li><span style="color: #0080ff;">●</span> <strong>Genres</strong> - Musical styles and categories</li>
                    <li><span style="color: #ffff00;">●</span> <strong>Collectives</strong> - Association to groups and music crews in Südtirol/Alto Adige</li>
                </ul>
                
                <p>Click on any node to explore connections and discover new producers. Get in touch for booking requests, collaborations, knowledge exchange or simply say hi. Drag nodes to rearrange the network and zoom to get a better view.</p>
                
                <p>Data is sourced from our open and community-maintained database. Please be mindful of other people's information. If you delete information, it disappears from the website. Want to add your project to Collisioni or update information?</p>
                
                <p style="margin-top: 20px;">
                    <a href="https://docs.google.com/spreadsheets/d/1ICmPFunrRBS-2Y8p40f8N13y9DKDzf2pl1Cat-BABP4/edit" 
                       target="_blank" 
                       style="color: #0080ff; text-decoration: underline;">
                        → View and edit the database
                    </a>
                </p>
                
                <p style="margin-top: 15px; font-size: 0.9rem; opacity: 0.8;">
                    <strong>COLLLISIONI</strong> is an invitation to discover other like-minded people and get together. Built with love for the Südtiroler electronic music community.
                </p>
                
                <div style="margin-top: 25px; padding-top: 15px; border-top: 1px solid #00ff00;">
                    <p style="margin-bottom: 0;">
                        <span style="color: #00ff00; font-weight: bold;">Contact:</span> 
                        <a href="https://www.instagram.com/sonn__ambula/" target="_blank" style="color: #4a90a4; text-decoration: underline;">Dorothea T.</a> 
                        (<a href="mailto:info.collisioni@gmail.com" style="color: #4a90a4; text-decoration: underline;">Email</a>) & 
                        <a href="https://www.instagram.com/davidfrisch2/" target="_blank" style="color: #4a90a4; text-decoration: underline;">David L.</a>
                    </p>
                </div>
            </div>
        `;

        const titleEl = document.getElementById('modal-title');
        if (titleEl) titleEl.textContent = 'About This Project';

        const overlay = document.getElementById('modal-overlay');
        if (overlay) overlay.classList.remove('hidden');
        
        const modal = document.getElementById('modal');
        if (modal) modal.classList.add('about-modal');
        
        // add class to body so other UI hides while modal is open
        document.body.classList.add('modal-open');
    }
    
    closeModal() {
        document.getElementById('modal-overlay').classList.add('hidden');
        // remove modal-open body class to reveal UI again
        document.body.classList.remove('modal-open');
        // remove about-modal class for next modal
        const modal = document.getElementById('modal');
        if (modal) modal.classList.remove('about-modal');

        this._modalOpen = false;
        
        // Restore saved view state (scale and offsets) to prevent layout drift
        if (this._savedViewState) {
            this.scale = this._savedViewState.scale;
            this.offsetX = this._savedViewState.offsetX;
            this.offsetY = this._savedViewState.offsetY;
            this._savedViewState = null;
            // Re-render with restored view
            this.render();
        }
    }
}

// Initialize the network when page loads
document.addEventListener('DOMContentLoaded', () => {
    new MusicNetwork();
});
