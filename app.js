// Initialize Maplibre GL Map with clean, open satellite tiles
const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {
            'versatiles-satellite': {
                type: 'raster',
                tiles: ['https://tiles.versatiles.org/tiles/satellite/{z}/{x}/{y}'],
                tileSize: 256,
                maxzoom: 18
            }
        },
        layers: [{ id: 'satellite-layer', type: 'raster', source: 'versatiles-satellite' }]
    },
    center: [-111.65, 40.60],
    zoom: 11,
    pitch: 65,
    bearing: -20
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));

map.on('load', async () => {
    // Inject global elevation tiles
    map.addSource('terrainSource', {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15
    });
    map.setTerrain({ source: 'terrainSource', exaggeration: 1.3 });

    try {
        const response = await fetch('data/WURL_Wasatch_Ultimate_Ridge_Linkup.gpx');
        const gpxText = await response.text();
        
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(gpxText, "text/xml");
        
        // 1. Parse your path coordinates
        const trackpoints = xmlDoc.getElementsByTagName("trkpt");
        const pathCoordinates = [];
        const bounds = new maplibregl.LngLatBounds();

        for (let i = 0; i < trackpoints.length; i++) {
            const lon = parseFloat(trackpoints[i].getAttribute("lon"));
            const lat = parseFloat(trackpoints[i].getAttribute("lat"));
            // IMPORTANT: If your GPX contains <ele> tags, we pull them to anchor the line strictly in 3D space
            const eleEl = trackpoints[i].getElementsByTagName("ele")[0];
            const ele = eleEl ? parseFloat(eleEl.textContent) : 0;
            
            const pt = [lon, lat, ele];
            pathCoordinates.push(pt);
            bounds.extend([lon, lat]);
        }

        // 2. Instantiate deck.gl's overlay layer right inside Maplibre's WebGL context
        const deckOverlay = new deck.MapboxOverlay({
            interleaved: true, // Forces deck.gl to share the map's depth buffer
            layers: [
                new deck.PathLayer({
                    id: '3d-trail-tube',
                    data: [{ path: pathCoordinates }],
                    getPath: d => d.path,
                    // Style attributes
                    getColor: [0, 255, 204, 230], // Vibrant Cyan with clean transparency
                    getWidth: 15, // True physical thickness scale
                    widthUnits: 'meters', // The line is precisely 15 meters wide in the actual world
                    widthMinPixels: 3, // Prevents disappearing when zoomed out
                    capRounded: true,
                    jointRounded: true,
                    billboard: false, // FALSE ensures it behaves like a physical 3D pipe laid on terrain
                    shadowEnabled: true 
                })
            ]
        });

        map.addControl(deckOverlay);

        // 3. Render traditional HTML waypoint billboards
        const waypoints = xmlDoc.getElementsByTagName("wpt");
        for (let j = 0; j < waypoints.length; j++) {
            const lon = parseFloat(waypoints[j].getAttribute("lon"));
            const lat = parseFloat(waypoints[j].getAttribute("lat"));
            const nameEl = waypoints[j].getElementsByTagName("name")[0];
            const wpName = nameEl ? nameEl.textContent : `Checkpoint ${j + 1}`;

            const el = document.createElement('div');
            el.className = 'marker-billboard';
            el.innerHTML = `
                <div class="billboard-pin"></div>
                <div class="billboard-label">${wpName}</div>
            `;

            new maplibregl.Marker({ element: el, anchor: 'bottom' })
                .setLngLat([lon, lat])
                .addTo(map);
        }

        map.fitBounds(bounds, { padding: 50, duration: 2500 });

    } catch (error) {
        console.error("Error creating true 3D pipeline:", error);
    }
});