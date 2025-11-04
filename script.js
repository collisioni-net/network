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

            // Create simulation with many-body, link and collision
            this.simulation = d3.forceSimulation(nodes)
                    .force('link', d3.forceLink(links).id(d => d.id).distance(d => {
                        // slightly larger link distances for better readability
                                    if (d.type === 'location') return (window.innerWidth > 1024 ? 220 : 130);
                                    if (d.type === 'genre') return (window.innerWidth > 1024 ? 240 : 150);
                                    if (d.type === 'collective') return (window.innerWidth > 1024 ? 200 : 110);
                                    return (window.innerWidth > 1024 ? 230 : 140);
                    }).strength(0.32))
                    // slightly stronger charge to give a bit more movement without overshooting
                    .force('charge', d3.forceManyBody().strength(-24))
                // center force uses current canvas center
                .force('center', d3.forceCenter(this.canvas.width / 2, this.canvas.height / 2))
                // degree-weighted gentle pull toward center: isolated nodes get stronger
                // pull, connected nodes only a tiny nudge so clusters stay readable
                .force('forceX', d3.forceX(this.canvas.width / 2).strength(d => {
                    const deg = degree[d.id] || 0;
                    return deg <= 1 ? 0.04 : 0.005;
                }))
                .force('forceY', d3.forceY(this.canvas.height / 2).strength(d => {
                    const deg = degree[d.id] || 0;
                    return deg <= 1 ? 0.04 : 0.005;
                }))
                // collision radius nudged back down so connected clusters don't spread too much
                    .force('collision', d3.forceCollide().radius(d => this.nodeTypes[d.type].radius + 18).iterations(2))
                .alphaTarget(0)
                .on('tick', () => {
                    // copy positions back to our canonical nodes array (match by id)
                    for (let i = 0; i < nodes.length; i++) {
                        const nd = nodes[i];
                        const local = this.nodes.find(x => x.id === nd.id);
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
                        if (this.autoCenterTicks <= 0) this.autoCentering = false;
                        else this.autoCentering = true;
                    }

                    // Clamp nodes to remain inside visible canvas area with padding
                    const rect = this.canvas.getBoundingClientRect();
                    const paddingClamp = 40; // keep nodes this far from edges
                    for (let i = 0; i < nodes.length; i++) {
                        const nd = nodes[i];
                        nd.x = Math.max(paddingClamp, Math.min(rect.width - paddingClamp, nd.x));
                        nd.y = Math.max(paddingClamp, Math.min(rect.height - paddingClamp, nd.y));
                    }
                    this.render();
                });

            // when simulation finishes settling, only center if this was the
            // initial auto-centering run to avoid jumping after user interaction
            const initialAutoCenter = this.autoCenterTicks > 0;
            this.simulation.on('end', () => {
                try {
                    if (initialAutoCenter) {
                        this.centerView();
                        this.render();
                    }
                } catch (e) {
                    // ignore
                }
            });

            // Attach drag handlers that interact with the simulation
            this._d3nodes = nodes;
            this._d3links = links;

            // reduce initial alpha to settle quicker
            this.simulation.alpha(0.6).restart();
            // enable auto-centering briefly after loading
            this.autoCenterTicks = 80; // number of ticks to auto-center for (tuneable)
            this.autoCentering = true;
        } catch (err) {
            console.error('Error initializing d3 simulation:', err);
            // fallback to previous runLayout behavior
            this.runLayout();
        }
    }

    // Simple iterative layout to separate nodes and avoid overlaps
    runLayout(iterations = 200) {
        if (!this.nodes || this.nodes.length === 0) return;
        
        // Detect mobile screen size for layout adjustments
        const isMobile = window.innerWidth <= 768;
        const canvasRect = this.canvas.getBoundingClientRect();
        
    const minDist = isMobile ? 80 : 140; // larger min distance on desktop for better separation
    const springLen = isMobile ? 140 : 260; // larger spring length on desktop for more spread
        
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
            this.centerView();
            if (this.simulation && typeof d3 !== 'undefined') {
                this.simulation.force('center', d3.forceCenter(this.canvas.width / 2, this.canvas.height / 2));
                this.simulation.alpha(0.3).restart();
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
                    // Desktop: original positioning
                    x = Math.random() * 300 + 100;
                    y = Math.random() * 300 + 100;
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
                x = Math.random() * 300 + 100;
                y = Math.random() * 300 + 100;
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
                x = Math.random() * 300 + 100;
                y = Math.random() * 300 + 100;
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
                x = Math.random() * 300 + 100;
                y = Math.random() * 300 + 100;
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
        
        console.log('Rendering with', this.nodes.length, 'nodes');
        
        this.ctx.save();
        this.ctx.translate(this.offsetX, this.offsetY);
        this.ctx.scale(this.scale, this.scale);
        // Branch: legacy style (original look) vs enhanced visuals
        if (this.legacyStyle) {
            // Original drawing style (keeps your original look)
            // connection lines use muted white so they don't overpower labels
            this.ctx.strokeStyle = 'rgba(255,255,255,0.16)';
            this.ctx.lineWidth = 1;
            this.connections.forEach(conn => {
                const fromNode = this.nodes.find(n => n.id === conn.from);
                const toNode = this.nodes.find(n => n.id === conn.to);
                if (fromNode && toNode) {
                    // skip drawing if either node's type is hidden
                    if (!this.visibleTypes[fromNode.type] || !this.visibleTypes[toNode.type]) return;
                    this.ctx.beginPath();
                    this.ctx.moveTo(fromNode.x, fromNode.y);
                    this.ctx.lineTo(toNode.x, toNode.y);
                    this.ctx.stroke();
                }
            });

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

                // Draw label (original styling) using muted color for each type
                // Draw a solid black background rectangle behind the text so labels sit on top of lines
                const label = String(node.label || '').slice(0, 28);
                this.ctx.font = '10px Courier New, monospace';
                const metrics = this.ctx.measureText(label);
                const pad = 6;
                const labelX = node.x;
                const labelY = node.y + nodeType.radius + 15;
                this.ctx.fillStyle = '#000000';
                this.ctx.fillRect(labelX - metrics.width / 2 - pad/2, labelY - 10, metrics.width + pad, 14);

                this.ctx.fillStyle = this.mutedLabelColor[node.type] || '#999999';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(label, labelX, labelY);
            });
        } else {
            // Enhanced visuals (alternate mode)
            // use muted white for all connection lines to keep them subtle under labels
            this.connections.forEach(conn => {
                const fromNode = this.nodes.find(n => n.id === conn.from);
                const toNode = this.nodes.find(n => n.id === conn.to);
                if (!fromNode || !toNode) return;
                if (!this.visibleTypes[fromNode.type] || !this.visibleTypes[toNode.type]) return;

                this.ctx.strokeStyle = 'rgba(255,255,255,0.18)';
                this.ctx.lineWidth = 1;
                this.ctx.beginPath();
                this.ctx.moveTo(fromNode.x, fromNode.y);
                this.ctx.lineTo(toNode.x, toNode.y);
                this.ctx.stroke();
            });

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
                this.ctx.font = '11px Courier New, monospace';
                this.ctx.textAlign = 'center';
                this.ctx.fillStyle = this.mutedLabelColor[node.type] || '#cccccc';

                // Split long labels and clamp length
                const label = String(node.label || '').slice(0, 28);
                const labelX = node.x;
                const labelY = node.y + nodeType.radius + 14;
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
            // record start position to detect click vs drag
            this._mouseStartPos = { x: node.x, y: node.y };
            // Do not open modal on immediate mousedown; use click/tap release to open
            // If simulation active, fix the node in the simulation so physics respects manual moves
            if (this.simulation && this._d3nodes) {
                const d3node = this._d3nodes.find(n => n.id === node.id);
                if (d3node) {
                    d3node.fx = node.x;
                    d3node.fy = node.y;
                    // nudge alpha to keep simulation active while dragging
                    this.simulation.alphaTarget(0.3).restart();
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
            // update d3 simulation fixed position if present
            if (this._d3nodes) {
                const d3node = this._d3nodes.find(n => n.id === this.draggedNode.id);
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
            // compare node current position to where it started
            const start = this._mouseStartPos || { x: node.x, y: node.y };
            const dx = node.x - start.x;
            const dy = node.y - start.y;
            const moved = Math.sqrt(dx*dx + dy*dy) > 8; // threshold for mouse - avoid accidental clicks
            if (!moved) {
                // It was a click (no significant movement)
                if (node.type === 'artist') this.showArtistModal(node.data);
                else this.showGroupModal(node);
            }
        }

        this.isDragging = false;
        this.nodeDragging = false;
        // release simulation fixation if present
        if (this._d3nodes && this.draggedNode) {
            const d3node = this._d3nodes.find(n => n.id === this.draggedNode.id);
            if (d3node) {
                // clear fixed positions to let physics continue
                d3node.fx = null;
                d3node.fy = null;
                this.simulation.alphaTarget(0);
            }
        }
        this.draggedNode = null;
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
            if (this._d3nodes) {
                const d3node = this._d3nodes.find(n => n.id === node.id);
                if (d3node) {
                    d3node.fx = node.x;
                    d3node.fy = node.y;
                    this.simulation.alphaTarget(0.3).restart();
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
            if (this._d3nodes) {
                const d3node = this._d3nodes.find(n => n.id === this.draggedNode.id);
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
        if (this._d3nodes && this.draggedNode) {
            const d3node = this._d3nodes.find(n => n.id === this.draggedNode.id);
            if (d3node) {
                d3node.fx = null;
                d3node.fy = null;
                this.simulation.alphaTarget(0);
            }
        }
        this.draggedNode = null;
        this._touchStartPos = null;
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
