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
            location: { color: '#ff0080', radius: 5 },
            genre: { color: '#0080ff', radius: 6 },
            collective: { color: '#ffff00', radius: 7 }
        };

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
            location: true,
            genre: true,
            collective: true
        };

    // auto-centering while simulation runs (disabled when user interacts)
    this.autoCentering = false; // enabled briefly after load or reset via ticks
    this.autoCenterTicks = 0;   // number of ticks to auto-center for
        
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
    
    async init() {
        console.log('Initializing music network...');
        this.setupCanvas();
        this.setupEventListeners();
        await this.loadData();
        console.log('Data loaded, creating nodes...');
        this.createNodes();
        console.log('Creating connections...');
        this.createConnections();
    // Ensure indexes are built in case nodes changed
    this.buildIndexes();
        console.log('Setting up force simulation...');
        this.setupSimulation();
        console.log('Centering view...');
        this.centerView();
        console.log('Rendering...');
        this.render();
        document.getElementById('loading').style.display = 'none';
        console.log('Initialization complete!');
    }

    /***********************
     * d3-force integration
     ***********************/
    setupSimulation() {
        // lazy-load d3 if not present by injecting CDN script
        if (typeof d3 === 'undefined') {
            const s = document.createElement('script');
            s.src = 'https://unpkg.com/d3@7/dist/d3.min.js';
            s.onload = () => this._initSimulationOnceD3Loaded();
            document.head.appendChild(s);
        } else {
            this._initSimulationOnceD3Loaded();
        }
    }

    _initSimulationOnceD3Loaded() {
        try {
            // Build link objects expected by d3
            const links = this.connections.map(c => ({ source: c.from, target: c.to, type: c.type }));

            // Map nodes by id for d3
            const nodes = this.nodes.map(n => Object.assign({}, n));

            // compute node degrees (number of links) so we can bias centering
            // force toward isolated nodes only
            const degree = {};
            links.forEach(l => {
                const s = l.source;
                const t = l.target;
                degree[s] = (degree[s] || 0) + 1;
                degree[t] = (degree[t] || 0) + 1;
            });

            // Adapt force parameters to graph size — larger graphs need stronger link distances and tuned charge
            const nodeCount = nodes.length;
            const scaleFactor = Math.min(3, Math.max(1, nodeCount / 150)); // for ~400 nodes scaleFactor~2.66

            // base link distances per type; vary significantly for organic feel
            // Start with much wider spacing for initial readability, will settle closer naturally
            const baseDistances = {
                location: window.innerWidth > 1024 ? 200 : 100,
                genre: window.innerWidth > 1024 ? 220 : 110,
                collective: window.innerWidth > 1024 ? 190 : 95,
                default: window.innerWidth > 1024 ? 210 : 105
            };

            // More padding initially for better readability, will compress after settling
            const collisionPadding = 12 + Math.round(scaleFactor * 5);
            // Reduced link strength so artists don't cluster too tightly via shared connections
            const linkStrength = Math.max(0.1, 0.3 / scaleFactor);
            // Stronger initial artist repulsion for readability, will soften after settling
            const perTypeCharge = {
                artist: this.legacyStyle ? -35 * scaleFactor : -45 * scaleFactor,
                location: this.legacyStyle ? -45 * scaleFactor : -55 * scaleFactor,
                genre: this.legacyStyle ? -50 * scaleFactor : -60 * scaleFactor,
                collective: this.legacyStyle ? -35 * scaleFactor : -45 * scaleFactor
            };
            // Highly variable link distances based on degree create natural clustering
            const linkTypeMultiplier = { location: 0.8, genre: 0.85, collective: 0.75, default: 1 };
            // Moderate collision enforcement for organic packing
            const collisionTypeMultiplier = { artist: 0.9, location: 1.1, genre: 1.2, collective: 1.0 };

            // Create simulation with optimized forces
            this.simulation = d3.forceSimulation(nodes)
                .force('link', d3.forceLink(links).id(d => d.id).distance(link => {
                    const t = link.type || 'default';
                    const mult = linkTypeMultiplier[t] || linkTypeMultiplier.default;
                    // Strong degree-based variation: highly connected nodes form tight clusters
                    const srcDeg = degree[link.source.id || link.source] || 0;
                    const tgtDeg = degree[link.target.id || link.target] || 0;
                    const avgDeg = (srcDeg + tgtDeg) / 2;
                    
                    // More aggressive degree scaling for organic clustering
                    // High-degree nodes: much shorter links (0.4x base for initial spread)
                    // Low-degree nodes: longer links (1.0x base)
                    const degreeScale = Math.max(0.4, 1 - (avgDeg / 12));
                    
                    // Add slight randomness for organic feel (±10%)
                    const randomVariation = 0.9 + Math.random() * 0.2;
                    
                    return (baseDistances[t] || baseDistances.default) * scaleFactor * mult * degreeScale * randomVariation;
                }).strength(linkStrength))
                .force('charge', d3.forceManyBody().strength(d => perTypeCharge[d.type] || (perTypeCharge.default || -8)))
                .force('center', d3.forceCenter(this.canvas.width / 2, this.canvas.height / 2))
                .force('forceX', d3.forceX(this.canvas.width / 2).strength(d => {
                    const deg = degree[d.id] || 0;
                    // High-degree nodes pulled to center, low-degree drift to periphery naturally
                    return deg <= 1 ? 0.02 : Math.min(0.12, 0.02 + deg * 0.01);
                }))
                .force('forceY', d3.forceY(this.canvas.height / 2).strength(d => {
                    const deg = degree[d.id] || 0;
                    // High-degree nodes pulled to center, low-degree drift to periphery naturally
                    return deg <= 1 ? 0.02 : Math.min(0.12, 0.02 + deg * 0.01);
                }))
                .force('collision', d3.forceCollide().radius(d => {
                    const mult = collisionTypeMultiplier[d.type] || 1;
                    return this.nodeTypes[d.type].radius + Math.round(collisionPadding * mult);
                }).strength(0.8).iterations(2)) // Stronger collision initially for better spacing
                .alphaDecay(0.028) // Slightly faster decay to reach readable state
                .alphaMin(0.001)
                .on('tick', () => {
                    // copy positions back efficiently using map
                    for (let i = 0; i < nodes.length; i++) {
                        const nd = nodes[i];
                        const local = this.nodeMap.get(nd.id);
                        if (local) {
                            local.x = nd.x;
                            local.y = nd.y;
                            local.vx = nd.vx;
                            local.vy = nd.vy;
                        }
                    }

                    // Auto-center only for a short countdown after load/reset
                    if (this.autoCenterTicks > 0) {
                        const bounds = this.getBounds();
                        const containerRect = this.canvas.getBoundingClientRect();
                        const centerX = (bounds.minX + bounds.maxX) / 2;
                        const centerY = (bounds.minY + bounds.maxY) / 2;
                        this.offsetX = containerRect.width / 2 - centerX;
                        this.offsetY = containerRect.height / 2 - centerY;
                        this.autoCenterTicks -= 1;
                        this.autoCentering = this.autoCenterTicks > 0;
                    }

                    // Clamp nodes to remain inside visible canvas area with padding
                    const rect = this.canvas.getBoundingClientRect();
                    const paddingClamp = 30; // keep nodes this far from edges (slightly reduced)
                    for (let i = 0; i < nodes.length; i++) {
                        const nd = nodes[i];
                        nd.x = Math.max(paddingClamp, Math.min(rect.width - paddingClamp, nd.x));
                        nd.y = Math.max(paddingClamp, Math.min(rect.height - paddingClamp, nd.y));
                    }

                    // render at most every few ticks for performance on large graphs
                    if (!this._lastRenderTick || (Date.now() - this._lastRenderTick) > 30) {
                        this.render();
                        this._lastRenderTick = Date.now();
                    }
                });

            // when simulation finishes settling, only center if this was the
            // initial auto-centering run to avoid jumping after user interaction
            const initialAutoCenter = this.autoCenterTicks > 0;
            this.simulation.on('end', () => {
                try {
                    if (initialAutoCenter) {
                        this.fitToScreen();
                        this.render();
                    }
                    // After the simulation settles, drastically reduce repulsion and
                    // centering so users can rearrange nodes freely without strong forces.
                    this._softenSimulationForInteraction();
                } catch (e) {
                    // ignore
                }
            });

            // Attach drag handlers that interact with the simulation
            this._d3nodes = nodes;
            // fast lookup for d3 nodes by id to avoid repeated array.find calls
            this._d3nodeMap = new Map(this._d3nodes.map(n => [n.id, n]));
            this._d3links = links;

            // Start with higher alpha for good initial spread
            this.simulation.alpha(1.0).restart();
            // enable auto-centering briefly after loading
            this.autoCenterTicks = 80; // number of ticks to auto-center for (tuneable)
            this.autoCentering = true;

            // ensure nodeMap exists so tick copy works
            if (!this.nodeMap || this.nodeMap.size === 0) this.buildIndexes();
        } catch (err) {
            console.error('Error initializing d3 simulation:', err);
            // fallback to previous runLayout behavior
            this.runLayout();
        }
    }

    // Soften simulation so manual user interaction persists: lower charge, increased collision softness
    _softenSimulationForInteraction() {
        if (!this.simulation) return;
        try {
            // Reduce forces after initial layout settles, allowing natural clustering
            // Set charge to gentle repulsion so nodes can be closer together
            if (this.simulation.force('charge')) this.simulation.force('charge').strength(() => -1.5);
            // Disable strong centering/anchoring influences so nodes stay where users place them.
            // IMPORTANT: do NOT set the center to (0,0) — that pulls everything to the corner.
            // Instead, remove the center/forceX/forceY forces so they no longer influence positions.
            try { if (typeof d3 !== 'undefined') this.simulation.force('center', null); } catch (e) {}
            try { if (typeof d3 !== 'undefined') this.simulation.force('forceX', null); } catch (e) {}
            try { if (typeof d3 !== 'undefined') this.simulation.force('forceY', null); } catch (e) {}
            // Soften collisions a lot to make overlapping and tight packing possible through manual moves
            if (this.simulation.force('collision')) this.simulation.force('collision').radius(d => this.nodeTypes[d.type].radius + 4).iterations(1);
            // Make simulation passive: no continuous alpha target, but allow tiny nudges
            this.simulation.alphaTarget(0);
            // apply changes gently
            this.simulation.restart();
        } catch (e) {
            // ignore
        }
    }

    // Harden simulation when user clicks Reset or when we want the layout to re-run
    _hardenSimulationForLayout() {
        if (!this.simulation) return;
        try {
            const scale = Math.min(3, Math.max(1, this.nodes.length / 150));
            const charge = this.legacyStyle ? -12 * scale : -26 * scale;
            if (this.simulation.force('charge')) this.simulation.force('charge').strength(charge);
            // Restore centering and directional forces so layout converges
            if (typeof d3 !== 'undefined') {
                this.simulation.force('center', d3.forceCenter(this.canvas.width / 2, this.canvas.height / 2));
                this.simulation.force('forceX', d3.forceX(this.canvas.width / 2).strength(0.02));
                this.simulation.force('forceY', d3.forceY(this.canvas.height / 2).strength(0.02));
            }
            if (this.simulation.force('collision')) this.simulation.force('collision').radius(d => this.nodeTypes[d.type].radius + 8 + Math.round(scale * 6)).iterations(2);
            // nudge alpha to let layout run again with stronger forces
            this.simulation.alpha(0.6).restart();
        } catch (e) {
            // ignore
        }
    }

    // Simple iterative layout to separate nodes and avoid overlaps
    runLayout(iterations = 200) {
        if (!this.nodes || this.nodes.length === 0) return;
        
        // Detect mobile screen size for layout adjustments
        const isMobile = window.innerWidth <= 768;
        const canvasRect = this.canvas.getBoundingClientRect();
        
    const minDist = isMobile ? 30 : 60; // allow nodes to be closer in fallback layout
    const springLen = isMobile ? 60 : 120; // shorter spring length so connections pull nodes closer
        
        // Mobile-specific: spread nodes more vertically to use available height
        if (isMobile) {
            // Initial random positioning for mobile - use more height
            this.nodes.forEach(node => {
                if (node.x < 50 || node.x > canvasRect.width - 50) {
                    node.x = Math.random() * (canvasRect.width - 100) + 50;
                }
                if (node.y < 50 || node.y > canvasRect.height - 50) {
                    node.y = Math.random() * (canvasRect.height - 100) + 50;
                }
            });
        }

        for (let it = 0; it < iterations; it++) {
            // repulsive force between all pairs (simple separation)
            for (let i = 0; i < this.nodes.length; i++) {
                for (let j = i + 1; j < this.nodes.length; j++) {
                    const a = this.nodes[i];
                    const b = this.nodes[j];
                    const dx = b.x - a.x;
                    const dy = b.y - a.y;
                    let dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
                    const overlap = minDist - dist;
                    if (overlap > 0) {
                        const ux = dx / dist;
                        const uy = dy / dist;
                        const shift = overlap * 0.5;
                        a.x -= ux * shift;
                        a.y -= uy * shift;
                        b.x += ux * shift;
                        b.y += uy * shift;
                    }
                }
            }

            // weak spring force along connections to pull related nodes together
            for (let c = 0; c < this.connections.length; c++) {
                const conn = this.connections[c];
                const from = this.nodes.find(n => n.id === conn.from);
                const to = this.nodes.find(n => n.id === conn.to);
                if (!from || !to) continue;
                const dx = to.x - from.x;
                const dy = to.y - from.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
                const diff = dist - springLen;
                const k = 0.01; // spring stiffness
                const fx = (dx / dist) * diff * k;
                const fy = (dy / dist) * diff * k;
                from.x += fx;
                from.y += fy;
                to.x -= fx;
                to.y -= fy;
            }
        }

        // clamp nodes inside canvas with some padding
        const padding = isMobile ? 30 : 40; // smaller padding on mobile
        for (let n of this.nodes) {
            n.x = Math.max(padding, Math.min(canvasRect.width - padding, n.x));
            n.y = Math.max(padding, Math.min(canvasRect.height - padding, n.y));
        }
        console.log('Layout complete');
        // fit the graph to fill the screen after fallback layout
        this.fitToScreen();
    }
    
    setupCanvas() {
        const container = document.getElementById('graph-container');
        const rect = container.getBoundingClientRect();
        
        // On mobile, ensure we use the full available height
        const isMobile = window.innerWidth <= 768;
        let canvasWidth = rect.width;
        let canvasHeight = rect.height;
        
        if (isMobile) {
            // Calculate available height manually for mobile
            const header = document.querySelector('header');
            const bottomInfo = document.getElementById('bottom-info');
            const headerHeight = header ? header.getBoundingClientRect().height : 0;
            const bottomHeight = bottomInfo ? bottomInfo.getBoundingClientRect().height : 40;
            
            canvasHeight = window.innerHeight - headerHeight - bottomHeight;
            
            // Set the container height explicitly
            container.style.height = canvasHeight + 'px';
        }
        
        // Set canvas size
        this.canvas.width = canvasWidth;
        this.canvas.height = canvasHeight;
        this.canvas.style.width = canvasWidth + 'px';
        this.canvas.style.height = canvasHeight + 'px';
        
        console.log('Canvas setup:', { width: canvasWidth, height: canvasHeight, isMobile });
        
        // Resize handler
        window.addEventListener('resize', () => {
            setTimeout(() => {
                this.setupCanvas();
                // Re-run layout on mobile when orientation changes to fix flat line
                if (window.innerWidth <= 768) {
                    this.runLayout(100); // shorter layout run for responsiveness
                }
                // update simulation center if present so nodes stay centered
                if (this.simulation && typeof d3 !== 'undefined') {
                    this.simulation.force('center', d3.forceCenter(this.canvas.width / 2, this.canvas.height / 2));
                    this.simulation.alpha(0.2).restart();
                }
                this.render();
            }, 100);
        });
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
        
        // Reset view button
        document.getElementById('reset-view').addEventListener('click', () => {
            // enable auto-centering briefly after reset
            this.autoCenterTicks = 80;
            this.autoCentering = true;
            this.fitToScreen();
            if (this.simulation && typeof d3 !== 'undefined') {
                this.simulation.force('center', d3.forceCenter(this.canvas.width / 2, this.canvas.height / 2));
                // harden forces and re-run layout when user requests reset
                this._hardenSimulationForLayout();
            }
            this.render();
        });
        
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

        // Legend toggle handlers: click on legend items to show/hide types
        const legend = document.getElementById('legend');
        if (legend) {
            // legend has 4 child divs in the DOM order: artists, locations, genres, collectives
            const items = legend.querySelectorAll('div');
            if (items && items.length >= 4) {
                const mapping = ['artist', 'location', 'genre', 'collective'];
                items.forEach((it, idx) => {
                    it.style.cursor = 'pointer';
                    it.addEventListener('click', () => {
                        const type = mapping[idx];
                        this.visibleTypes[type] = !this.visibleTypes[type];
                        // visual feedback: toggle opacity
                        it.style.opacity = this.visibleTypes[type] ? '1' : '0.35';
                        // If hiding some node types, we may want to hide their nodes & links
                        // Rebuild connection refs in case visibility affects pruning elsewhere
                        this.buildIndexes();
                        this.render();
                        // nudge simulation to reposition remaining nodes
                        if (this.simulation) {
                            // recompute center and restart lightly
                            this.simulation.force('center', d3.forceCenter(this.canvas.width / 2, this.canvas.height / 2));
                            this.simulation.alpha(0.3).restart();
                        }
                    });
                });
            }
        }
    }
    
    async loadData() {
        try {
            // Convert Google Sheets URL to CSV export format
            const sheetId = '1ICmPFunrRBS-2Y8p40f8N13y9DKDzf2pl1Cat-BABP4';
            const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
            
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
                throw new Error('No valid artist data found');
            }
            
            console.log('Loaded artists:', this.artists);
        } catch (error) {
            console.error('Error loading data from Google Sheets:', error);
            console.log('Using sample data for demonstration...');
            
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
                    infoText: 'Sound artist exploring the intersection of natural Alpine sounds and electronic manipulation.',
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
        if (lines.length === 0) return [];

        const rawHeaders = this.parseCSVLine(lines[0]).map(h => h.trim().replace(/"/g, ''));
        const headers = rawHeaders.map(h => h.toLowerCase());

        const artists = [];

        for (let i = 1; i < lines.length; i++) {
            const values = this.parseCSVLine(lines[i]);
            if (values.length === 0) continue;

            // Build an object keyed by normalized header names
            const row = {};
            for (let j = 0; j < values.length; j++) {
                const key = (rawHeaders[j] || `col${j}`).trim();
                row[key] = values[j] ? values[j].trim().replace(/"/g, '') : '';
            }

            // Normalize commonly used header names into our expected properties
            const artistObj = {
                firstName: row['First Name'] || row['first name'] || row['firstname'] || row['first_name'] || row['first'] || row['first_name '] || row['first name '] || row['First'] || '',
                artistName: row['Artist Name'] || row['artist name'] || row['artistname'] || row['artist'] || row['Artist'] || row['artist name '] || '',
                genre: row['Genre'] || row['genre'] || row['GENRE'] || '',
                location: row['Location'] || row['location'] || row['place'] || row['town'] || row['Location '] || '',
                location2: row['Location 2'] || row['location 2'] || row['location2'] || row['alt location'] || row['location2 '] || '',
                url: row['URL'] || row['Url'] || row['url'] || row['Website'] || row['website'] || '',
                infoText: row['Info Text'] || row['info text'] || row['info'] || row['notes'] || row['description'] || '',
                collective: row['Collective'] || row['collective'] || row['COLLECTIVE'] || ''
            };

            // If headers didn't match exact cases above, also try matching via lowercase header map
            // This ensures robustness for different header spellings
            for (const hKey in row) {
                const low = hKey.toLowerCase();
                if (!artistObj.firstName && /first/.test(low)) artistObj.firstName = row[hKey];
                if (!artistObj.artistName && /artist/.test(low) && !/first/.test(low)) artistObj.artistName = row[hKey];
                if (!artistObj.genre && /genre/.test(low)) artistObj.genre = row[hKey];
                if (!artistObj.location && /location|place|town|city/.test(low)) {
                    if (!artistObj.location) artistObj.location = row[hKey];
                    else if (!artistObj.location2) artistObj.location2 = row[hKey];
                }
                if (!artistObj.url && /url|website|site|link/.test(low)) artistObj.url = row[hKey];
                if (!artistObj.infoText && /info|note|description|about/.test(low)) artistObj.infoText = row[hKey];
                if (!artistObj.collective && /collective|group|band|crew/.test(low)) artistObj.collective = row[hKey];
            }

            // Trim values
            Object.keys(artistObj).forEach(k => { if (typeof artistObj[k] === 'string') artistObj[k] = artistObj[k].trim(); });

            // Only include rows that have at least a first name or artist name
            if ((artistObj.firstName && artistObj.firstName.length > 0) || (artistObj.artistName && artistObj.artistName.length > 0)) {
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
        
        console.log('Creating nodes for artists:', this.artists);
        
        // Create artist nodes and collect unique locations/genres
        this.artists.forEach((artist, index) => {
            console.log('Processing artist:', artist);

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

                const node = {
                    id: `artist_${index}`,
                    type: 'artist',
                    label: artistLabel,
                    data: artist,
                    x: x,
                    y: y,
                    vx: 0,
                    vy: 0
                };
                this.nodes.push(node);
                console.log('Created artist node:', node);

                // Check various possible location field names
                const location1 = (artist.location || artist.Location || artist['Location '] || '').toString().trim();
                const location2 = (artist.location2 || artist['Location 2'] || artist['Location2'] || '').toString().trim();
                const genre = (artist.genre || artist.Genre || '').toString().trim();
                const collective = (artist.collective || artist.Collective || '').toString().trim();

                if (location1) locations.add(location1);
                if (location2) locations.add(location2);
                if (genre) genres.add(genre);
                if (collective) collectives.add(collective);
            } else {
                console.log('Skipping artist - no valid name found:', artist);
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
            console.log('Created location node:', node);
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
            console.log('Created genre node:', node);
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
            console.log('Created collective node:', node);
        });
        
    console.log('Total nodes created:', this.nodes.length, ' (artists:', this.nodes.filter(n=>n.type==='artist').length, ', locations:', this.nodes.filter(n=>n.type==='location').length, ', genres:', this.nodes.filter(n=>n.type==='genre').length, ', collectives:', this.nodes.filter(n=>n.type==='collective').length, ')');
    }
    
    createConnections() {
        this.connections = [];
        
        this.nodes.forEach(node => {
            if (node.type === 'artist') {
                const artist = node.data;
                
                // Get location and genre values with multiple possible field names
                const location1 = artist.location || artist.Location || artist['Location '] || '';
                const location2 = artist.location2 || artist['Location 2'] || artist['Location2'] || '';
                const genre = artist.genre || artist.Genre || '';
                const collective = artist.collective || artist.Collective || '';
                
                // Connect to locations
                this.nodes.forEach(locationNode => {
                    if (locationNode.type === 'location') {
                        if (locationNode.label === location1.trim() || locationNode.label === location2.trim()) {
                            this.connections.push({
                                from: node.id,
                                to: locationNode.id,
                                type: 'location'
                            });
                        }
                    }
                });
                
                // Connect to genres
                this.nodes.forEach(genreNode => {
                    if (genreNode.type === 'genre' && genreNode.label === genre.trim()) {
                        this.connections.push({
                            from: node.id,
                            to: genreNode.id,
                            type: 'genre'
                        });
                    }
                });
                
                // Connect to collectives
                this.nodes.forEach(collectiveNode => {
                    if (collectiveNode.type === 'collective' && collectiveNode.label === collective.trim()) {
                        this.connections.push({
                            from: node.id,
                            to: collectiveNode.id,
                            type: 'collective'
                        });
                    }
                });
            }
        });
        
        console.log('Created connections:', this.connections.length);
        // build quick lookup structures used by rendering and the simulation tick
        this.buildIndexes();
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
    
    centerView() {
        if (this.nodes.length === 0) {
            console.log('No nodes to center');
            return;
        }
        
        const bounds = this.getBounds();
        const containerRect = this.canvas.getBoundingClientRect();
        
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;
        
        this.offsetX = containerRect.width / 2 - centerX;
        this.offsetY = containerRect.height / 2 - centerY;
        this.scale = 1;
        
        console.log('Centered view:', { 
            centerX, centerY, 
            offsetX: this.offsetX, 
            offsetY: this.offsetY,
            canvasSize: { width: containerRect.width, height: containerRect.height }
        });
    }

    // Scale and offset the graph to fill the available canvas with appropriate margins
    fitToScreen() {
        if (this.nodes.length === 0) {
            console.log('No nodes to fit');
            return;
        }
        
        const bounds = this.getBounds();
        const containerRect = this.canvas.getBoundingClientRect();
        
        // compute graph dimensions
        const graphWidth = bounds.maxX - bounds.minX;
        const graphHeight = bounds.maxY - bounds.minY;
        
        // desired margins (pixels in canvas space)
        const margin = 80;
        const availableWidth = containerRect.width - 2 * margin;
        const availableHeight = containerRect.height - 2 * margin;
        
        // compute scale to fit graph in available space (with some breathing room)
        let scale = 1;
        if (graphWidth > 0 && graphHeight > 0) {
            const scaleX = availableWidth / graphWidth;
            const scaleY = availableHeight / graphHeight;
            scale = Math.min(scaleX, scaleY, 1.2); // cap max scale at 1.2 to avoid over-zooming small graphs
            scale = Math.max(scale, 0.3); // ensure minimum scale so graph doesn't get too tiny
        }
        
        // compute center of graph in original coords
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;
        
        // set offset so graph center aligns with canvas center after scaling
        this.offsetX = containerRect.width / 2 - centerX * scale;
        this.offsetY = containerRect.height / 2 - centerY * scale;
        this.scale = scale;
        
        console.log('Fit to screen:', { 
            graphWidth, graphHeight,
            scale: this.scale,
            offsetX: this.offsetX, 
            offsetY: this.offsetY,
            canvasSize: { width: containerRect.width, height: containerRect.height }
        });
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
            // slightly more contrasty but still light lines for overview
            this.ctx.lineWidth = 1;
            // stronger opacity for readability
            this.ctx.strokeStyle = 'rgba(0,255,0,0.55)';
            for (const cref of this.connectionRefs) {
                if (!cref.from || !cref.to) continue;
                if (!this.visibleTypes[cref.from.type] || !this.visibleTypes[cref.to.type]) continue;
                this.ctx.beginPath();
                this.ctx.moveTo(cref.from.x, cref.from.y);
                this.ctx.lineTo(cref.to.x, cref.to.y);
                this.ctx.stroke();
            }

            this.nodes.forEach(node => {
                if (!this.visibleTypes[node.type]) return; // skip hidden types
                const nodeType = this.nodeTypes[node.type];

                // Draw node circle
                this.ctx.fillStyle = nodeType.color;
                this.ctx.beginPath();
                this.ctx.arc(node.x, node.y, nodeType.radius, 0, Math.PI * 2);
                this.ctx.fill();

                // Draw node border for better visibility
                this.ctx.strokeStyle = nodeType.color;
                this.ctx.lineWidth = 1;
                this.ctx.stroke();

                // Draw label with larger font for readability
                const label = String(node.label || '').slice(0, 36);
                this.ctx.font = '12px Courier New, monospace';
                const metrics = this.ctx.measureText(label);
                const pad = 8;
                const labelX = node.x;
                const labelY = node.y + nodeType.radius + 16;
                this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'; // Semi-transparent black background
                this.ctx.fillRect(labelX - metrics.width / 2 - pad/2, labelY - 12, metrics.width + pad, 16);

                this.ctx.fillStyle = this.mutedLabelColor[node.type] || '#999999';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(label, labelX, labelY);
            });
        } else {
            // Enhanced visuals (alternate mode)
            // use muted neon green for connection lines to match original distribution
            // lighter lines in enhanced mode
            this.ctx.lineWidth = 1;
            // stronger opacity in enhanced mode as well
            this.ctx.strokeStyle = 'rgba(0,255,0,0.60)';
            for (const cref of this.connectionRefs) {
                if (!cref.from || !cref.to) continue;
                if (!this.visibleTypes[cref.from.type] || !this.visibleTypes[cref.to.type]) continue;
                this.ctx.beginPath();
                this.ctx.moveTo(cref.from.x, cref.from.y);
                this.ctx.lineTo(cref.to.x, cref.to.y);
                this.ctx.stroke();
            }

            this.nodes.forEach(node => {
                if (!this.visibleTypes[node.type]) return;
                const nodeType = this.nodeTypes[node.type];

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
                this.ctx.fillStyle = this.mutedLabelColor[node.type] || '#cccccc';

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
        
        this.ctx.restore();
        
        console.log('Render complete. Offset:', this.offsetX, this.offsetY, 'Scale:', this.scale);
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
            if (!this.visibleTypes[node.type]) return false; // ignore hidden types
            const dx = node.x - pos.x;
            const dy = node.y - pos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            return distance <= this.nodeTypes[node.type].radius + 5;
        });
    }

    // helper to get d3 node by id (if simulation present)
    _getD3Node(id) {
        if (this._d3nodeMap) return this._d3nodeMap.get(id) || null;
        if (this._d3nodes) return this._d3nodes.find(n => n.id === id) || null;
        return null;
    }
    
    handleMouseDown(e) {
        const pos = this.getMousePos(e);
        const node = this.getNodeAt(pos);

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
            // If simulation active, fix the node in the simulation so physics respects manual moves
            if (this.simulation) {
                const d3node = this._getD3Node(node.id);
                if (d3node) {
                    d3node.fx = node.x;
                    d3node.fy = node.y;
                    // keep simulation lightly active while dragging so connected nodes behave
                    this.simulation.alphaTarget(0.2).restart();
                }
            }
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
            // update d3 simulation fixed position if present (use fast map)
            if (this.simulation) {
                const d3node = this._getD3Node(this.draggedNode.id);
                if (d3node) {
                    d3node.fx = this.draggedNode.x;
                    d3node.fy = this.draggedNode.y;
                }
            }
            this.render();
        } else if (this.isDragging) {
            this.offsetX = e.clientX - this.dragStart.x;
            this.offsetY = e.clientY - this.dragStart.y;
            this.render();
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
                if (node.type === 'artist') this.showArtistModal(node.data);
                else this.showGroupModal(node);
            }
        }

        this.isDragging = false;
        this.nodeDragging = false;
        // release simulation fixation if present: clear fx/fy using fast map and lightly nudge simulation
        if (this.simulation && this.draggedNode) {
            const d3node = this._getD3Node(this.draggedNode.id);
            if (d3node) {
                d3node.fx = null;
                d3node.fy = null;
                // lightly nudge simulation so layout responds subtly, then settle
                this.simulation.alphaTarget(0.04);
                setTimeout(() => { if (this.simulation) this.simulation.alphaTarget(0); }, 400);
            }
        }
        this.draggedNode = null;
        this._mouseDownPos = null;
        this._mouseStartNodePos = null;
    }

    // helper to show a group modal (for location or genre) listing matching artists
    showGroupModal(node) {
        const label = node.label || '';
        const type = node.type; // 'location' or 'genre'
        const title = `${label} — ${type}`;

        // find artists related to this node via connections (preferred)
        const relatedArtistIds = this.connections
            .filter(c => c.to === node.id && c.from && c.from.startsWith('artist_'))
            .map(c => c.from);

        let matches = relatedArtistIds.map(id => this.nodes.find(n => n.id === id)).filter(Boolean);

        // fallback to data-field matching if no connections found
        if (matches.length === 0) {
            matches = this.nodes.filter(n => n.type === 'artist' && n.data).filter(a => {
                const art = a.data;
                const genre = (art.genre || art.Genre || '').toString().trim().toLowerCase();
                const loc1 = (art.location || art.Location || '').toString().trim().toLowerCase();
                const loc2 = (art.location2 || art['Location 2'] || art.location2 || '').toString().trim().toLowerCase();
                const collective = (art.collective || art.Collective || '').toString().trim().toLowerCase();
                const labelLow = label.toString().trim().toLowerCase();
                if (type === 'genre') return genre === labelLow;
                if (type === 'collective') return collective === labelLow;
                return loc1 === labelLow || loc2 === labelLow;
            });
        }

        // Build list HTML
        let html = '<div class="group-list">';
        if (matches.length === 0) {
            html += '<p style="margin-bottom:12px;">No artists found for this ' + type + '.</p>';
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
            if (this.simulation) {
                const d3node = this._getD3Node(node.id);
                if (d3node) {
                    d3node.fx = node.x;
                    d3node.fy = node.y;
                    this.simulation.alphaTarget(0.2).restart();
                }
            }
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
            if (this.simulation) {
                const d3node = this._getD3Node(this.draggedNode.id);
                if (d3node) {
                    d3node.fx = this.draggedNode.x;
                    d3node.fy = this.draggedNode.y;
                }
            }
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
                if (this.draggedNode.type === 'artist') this.showArtistModal(this.draggedNode.data);
                else this.showGroupModal(this.draggedNode);
            }
        }

        this.isDragging = false;
        this.nodeDragging = false;
        if (this.simulation && this.draggedNode) {
            const d3node = this._getD3Node(this.draggedNode.id);
            if (d3node) {
                d3node.fx = null;
                d3node.fy = null;
                // lightly nudge simulation so layout responds subtly, then settle
                this.simulation.alphaTarget(0.04);
                setTimeout(() => { if (this.simulation) this.simulation.alphaTarget(0); }, 400);
            }
        }
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
        // Handle flexible field names from CSV
        const artistName = artist.artistName || artist['Artist Name'] || 'unknown artist';
        const firstName = artist.firstName || artist['First Name'] || '';
        const genre = artist.genre || artist.Genre || 'not specified';
        const location1 = artist.location || artist.Location || artist['Location '] || 'not specified';
        const location2 = artist.location2 || artist['Location 2'] || artist['Location2'] || 'not specified';
        const url = artist.url || artist.URL || '';
        const infoText = artist.infoText || artist['Info Text'] || 'no additional information available';
        // Inject full artist view into modal content (replaces group list if present)
        const modalContent = document.getElementById('modal-content');
        if (!modalContent) return;

        // Combine locations into single display
        let locationDisplay = location1;
        if (location2 && location2 !== 'not specified' && location2 !== location1) {
            locationDisplay += `, ${location2}`;
        }

        modalContent.innerHTML = `
            <div id="artist-info">
                <div class="info-row">
                    <span class="label">name:</span>
                    <span id="artist-name">${firstName ? `${firstName} (${artistName})` : artistName}</span>
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
                    <span id="artist-genre">${genre}</span>
                </div>
                <div class="info-row">
                    <span class="label">location:</span>
                    <span id="artist-location">${locationDisplay}</span>
                </div>
                <div class="info-row">
                    <span class="label">collective:</span>
                    <span id="artist-collective">${artist.collective || artist.Collective || 'none'}</span>
                </div>
            </div>
        `;

        const titleEl = document.getElementById('modal-title');
        if (titleEl) titleEl.textContent = artistName;

        const overlay = document.getElementById('modal-overlay');
        if (overlay) overlay.classList.remove('hidden');
        // add class to body so other UI hides while modal is open
        document.body.classList.add('modal-open');
    }
    
    showAboutModal() {
        const modalContent = document.getElementById('modal-content');
        if (!modalContent) return;

        modalContent.innerHTML = `
            <div class="about-content">
                <p>The <strong>COLLISIONI Electronic Music Network</strong> is an interactive visualization of the electronic music scene in Südtirol/Alto Adige. This map connects artists, locations, genres, and collectives to highlight the vast diversity of people creating music in this field.</p>
                
                <ul style="margin: 15px 0; padding-left: 20px;">
                    <li><span style="color: #00ff00;">●</span> <strong>Artists</strong> - Musicians producers</li>
                    <li><span style="color: #ff0080;">●</span> <strong>Locations</strong> - Cities and venues where they live and work</li>
                    <li><span style="color: #0080ff;">●</span> <strong>Genres</strong> - Musical styles and categories</li>
                    <li><span style="color: #ffff00;">●</span> <strong>Collectives</strong> - Association to groups and music crews in Südtirol/Alto Adige</li>
                </ul>
                
                <p>Click on any node to explore connections and discover new artists. Get in touch for booking requests, collaborations, knowledge exchange or simply say hi. Drag nodes to rearrange the network, zoom to get a better view, and use the reset button to center the visualization.</p>
                
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
    }
}

// Initialize the network when page loads
document.addEventListener('DOMContentLoaded', () => {
    new MusicNetwork();
});
