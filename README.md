# South Tyrol Music Network

A lofi, early internet-style interactive website that visualizes the South Tyrol music scene through an interactive node graph.

## Features

- **Early Internet Aesthetic**: Terminal-style green text on black background with retro styling
- **Interactive Graph**: Canvas-based visualization with draggable view and zoom
- **Artist Information**: Click on artist nodes to view detailed information in modal windows
- **Mobile Responsive**: Touch-friendly controls for mobile devices
- **Real-time Data**: Fetches artist data directly from Google Sheets

## How It Works

The website connects artists, locations, and genres through an interactive node graph:

- **Green circles**: Artists
- **Pink circles**: Locations  
- **Blue circles**: Genres
- **Lines**: Connections between artists and their associated locations/genres

### Interactions

- **Click/Tap Artist Nodes**: Opens detailed information modal
- **Drag**: Pan around the graph
- **Mouse Wheel**: Zoom in/out (desktop only)
- **Reset View Button**: Centers and resets the view

## Data Source

The website pulls data from this Google Sheet:
https://docs.google.com/spreadsheets/d/1ICmPFunrRBS-2Y8p40f8N13y9DKDzf2pl1Cat-BABP4/edit?usp=sharing

Expected columns:
- First Name
- Artist Name  
- Genre
- Location
- Location 2
- URL
- Info Text

## Technical Details

- **Lightweight**: Pure HTML, CSS, and JavaScript - no frameworks
- **Client-side only**: Runs entirely in the browser
- **Canvas-based**: Smooth rendering and interactions
- **Mobile-first**: Responsive design for all screen sizes

## Usage

1. Open `index.html` in a web browser
2. Wait for artist data to load
3. Explore the network by dragging and clicking nodes
4. Use the reset view button to center the graph

## Local Development

Serve the files using any web server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in your browser.

## Browser Compatibility

Works in all modern browsers that support:
- Canvas API
- Fetch API
- CSS Grid
- Touch Events

## Notes

- The Google Sheets must be publicly readable for the data to load
- CORS restrictions may require serving from a web server (not file://)
- Mobile users can touch artist nodes to view information
- The graph layout is randomized on each load for an organic feel