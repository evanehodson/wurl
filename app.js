// Initialize Maplibre GL Map
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
        layers: [
            {
                id: 'satellite-layer',
                type: 'raster',
                source: 'versatiles-satellite'
            }
        ]
    },
    center: [-111.65, 40.60],
    zoom: 11,
    pitch: 65
});

// Add Navigation UI Controls (Zoom / Compass Pitch)
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));

map.on('load', async () => {
    // 1. Inject Global 3D Elevation Data (Terrarium Format)
    map.addSource('terrainSource', {
        type: 'raster-dem',
        // Global open data elevation tiles
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium', // Tells Maplibre how to decode this specific data format
        tileSize: 256,
        maxzoom: 15
    });

    // Activate the 3D terrain mesh layer
    map.setTerrain({ source: 'terrainSource', exaggeration: 1.3 }); // 1.3 adds a little extra mountain drama

    // 2. Fetch and Parse your native WURL GPX file
    try {
        const response = await fetch('data/WURL_Wasatch_Ultimate_Ridge_Linkup.gpx');
        const gpxText = await response.text();
        
        // Use browser DOMParser to translate raw XML trackpoints
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(gpxText, "text/xml");
        const trackpoints = xmlDoc.getElementsByTagName("trkpt");
        
        const coordinates = [];
        const bounds = new maplibregl.LngLatBounds();

        for (let i = 0; i < trackpoints.length; i++) {
            const lon = parseFloat(trackpoints[i].getAttribute("lon"));
            const lat = parseFloat(trackpoints[i].getAttribute("lat"));
            const pt = [lon, lat];
            coordinates.push(pt);
            bounds.extend(pt);
        }

        // 3. Inject parsed GPX trail data array into a clean GeoJSON layout
        map.addSource('wurl-route', {
            type: 'geojson',
            data: {
                type: 'Feature',
                properties: {},
                geometry: {
                    type: 'LineString',
                    coordinates: coordinates
                }
            }
        });

        // 4. Draw the trail vector with an elegant glowing style
        map.addLayer({
            id: 'route-line',
            type: 'line',
            source: 'wurl-route',
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': '#00ffcc', // Sleek cyan trail line
                'line-width': 4,
                'line-opacity': 0.85
            }
        });

        // 5. Instantly sweep the camera to perfectly frame the mountain ridge line
        map.fitBounds(bounds, {
            padding: 50,
            duration: 2500
        });

    } catch (error) {
        console.error("Error reading or parsing the GPX data track:", error);
    }
});