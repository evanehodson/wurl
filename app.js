const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {
            'satellite': {
                type: 'raster',
                tiles: ['https://tiles.versatiles.org/tiles/satellite/{z}/{x}/{y}'],
                tileSize: 256,
                maxzoom: 18
            }
        },
        layers: [{ id: 'satellite-layer', type: 'raster', source: 'satellite' }],
        lights: [
            {
                id: 'sun',
                type: 'directional',
                direction: [210, 55],
                color: '#ffffff',
                intensity: 1.0
            }
        ]
    },
    center: [-111.70, 40.56],
    zoom: 11,
    pitch: 60,
    bearing: -15,
    maxPitch: 85
});

// ── Custom Controls ──────────────────────────────────────────

const compass = document.getElementById('compass');
const compassArrow = document.getElementById('compass-arrow');
const btnIn = document.getElementById('zoom-in');
const btnOut = document.getElementById('zoom-out');
const modeBtn = document.getElementById('mode-btn');

// Compass rotation sync
map.on('rotate', () => {
    compassArrow.style.transform = `rotate(${-map.getBearing()}deg)`;
});

// Interactive compass drag → bearing
let dragging = false;
let dragStartAngle = 0;
let dragStartBearing = 0;

compass.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    const rect = compass.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    dragStartAngle = Math.atan2(e.clientX - cx, cy - e.clientY) * 180 / Math.PI;
    dragStartBearing = map.getBearing();
    compass.style.cursor = 'grabbing';
});

document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const rect = compass.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const angle = Math.atan2(e.clientX - cx, cy - e.clientY) * 180 / Math.PI;
    let delta = angle - dragStartAngle;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    map.setBearing(((dragStartBearing - delta) % 360 + 360) % 360);
});

document.addEventListener('mouseup', () => {
    if (dragging) {
        dragging = false;
        compass.style.cursor = 'grab';
    }
});

// Zoom buttons
btnIn.addEventListener('click', () => map.zoomIn({ duration: 200 }));
btnOut.addEventListener('click', () => map.zoomOut({ duration: 200 }));

// 2D/3D toggle
modeBtn.addEventListener('click', () => {
    if (map.getPitch() > 1) {
        map.easeTo({ pitch: 0, duration: 500 });
    } else {
        map.easeTo({ pitch: 60, duration: 500 });
    }
});

map.on('pitch', () => {
    if (map.getPitch() < 1) {
        modeBtn.textContent = '3D';
        modeBtn.classList.remove('active');
    } else {
        modeBtn.textContent = '2D';
        modeBtn.classList.add('active');
    }
});

// ── Right-click → pitch ─────────────────────────────────────

map.dragRotate.disable();
map.getCanvas().addEventListener('contextmenu', e => e.preventDefault());

let pitching = false;
let pitchStartY = 0;
let pitchStartVal = 0;

map.getCanvas().addEventListener('mousedown', (e) => {
    if (e.button === 2) {
        pitching = true;
        pitchStartY = e.clientY;
        pitchStartVal = map.getPitch();
        e.preventDefault();
    }
});

document.addEventListener('mousemove', (e) => {
    if (!pitching) return;
    const dy = pitchStartY - e.clientY;
    const p = Math.max(0, Math.min(85, pitchStartVal + dy * 0.3));
    map.setPitch(p);
});

document.addEventListener('mouseup', (e) => {
    if (e.button === 2) pitching = false;
});

// ── Load ─────────────────────────────────────────────────────

map.on('load', async () => {
    map.addSource('terrainSource', {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15
    });

    map.setTerrain({ source: 'terrainSource', exaggeration: 1.5 });

    map.setSky({
        'sky-color': '#aaccee',
        'horizon-color': '#aaccee',
        'fog-color': '#aaccee',
        'horizon-fog-blend': 0.35,
        'fog-ground-blend': 0.45,
        'sky-horizon-blend': 0.5
    });

    try {
        const resp = await fetch('data/WURL_Wasatch_Ultimate_Ridge_Linkup.gpx');
        const text = await resp.text();
        const xml = new DOMParser().parseFromString(text, 'text/xml');

        const trkpts = xml.getElementsByTagName('trkpt');
        const pathPoints = [];
        const bounds = new maplibregl.LngLatBounds();
        let cumDist = 0;
        const profile = [];

        for (let i = 0; i < trkpts.length; i++) {
            const lon = parseFloat(trkpts[i].getAttribute('lon'));
            const lat = parseFloat(trkpts[i].getAttribute('lat'));
            const el = trkpts[i].getElementsByTagName('ele')[0];
            const ele = el ? parseFloat(el.textContent) : 0;
            pathPoints.push({ lon, lat, ele });
            bounds.extend([lon, lat]);
            if (i > 0) {
                cumDist += haversine(pathPoints[i - 1].lon, pathPoints[i - 1].lat, lon, lat);
            }
            profile.push({ dist: cumDist, ele });
        }

        const wptEls = xml.getElementsByTagName('wpt');
        const waypoints = [];
        for (let j = 0; j < wptEls.length; j++) {
            const lon = parseFloat(wptEls[j].getAttribute('lon'));
            const lat = parseFloat(wptEls[j].getAttribute('lat'));
            const nameEl = wptEls[j].getElementsByTagName('name')[0];
            const name = nameEl ? nameEl.textContent : `WP ${j + 1}`;
            let nearestEle = 0, minD = Infinity;
            for (const tp of pathPoints) {
                const d = haversine(lon, lat, tp.lon, tp.lat);
                if (d < minD) { minD = d; nearestEle = tp.ele; }
            }
            waypoints.push({ name, lon, lat, ele: nearestEle, eleFt: nearestEle * 3.28084 });
        }

        const EXAG = 1.5;

        map.addSource('trail-line', {
            type: 'geojson',
            data: {
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: pathPoints.map(p => [p.lon, p.lat])
                }
            }
        });
        map.addLayer({
            id: 'trail-line',
            type: 'line',
            source: 'trail-line',
            paint: {
                'line-color': '#ff6b35',
                'line-width': [
                    'interpolate', ['exponential', 2], ['zoom'],
                    9, 0.125,
                    10, 0.25,
                    11, 0.5,
                    12, 1.0,
                    13, 2.0,
                    14, 4.0,
                    15, 8.0,
                    16, 16.0,
                    17, 32.0,
                    18, 64.0
                ],
                'line-opacity': 1.0,
                'line-blur': 0
            }
        });
        console.log('[trail] native line layer added');

        // deck.gl labels with depth-based sizing (PeakVisor-style)
        const labelDepth = (d) => {
            const c = map.getCenter();
            return Math.max(0.15, Math.min(1, 1 - haversine(d.lon, d.lat, c.lng, c.lat) / 20));
        };
        const labelSize = () => Math.max(12, Math.min(18, (map.getZoom() - 8) * 2));
        const offset = (i) => [[0, 0], [-80, 0], [80, 0], [-80, -22], [80, -22]][i % 5];
        const deckOverlay = new deck.MapboxOverlay({
            interleaved: true,
            layers: [
                new deck.TextLayer({
                    id: 'waypoint-names',
                    data: waypoints,
                    getPosition: d => [d.lon, d.lat, d.ele * EXAG + 80],
                    getText: d => d.name,
                    getSize: d => labelSize() * labelDepth(d),
                    getColor: d => { const a = Math.round(labelDepth(d) * 255); return [255, 255, 255, a]; },
                    getOutlineColor: d => { const a = Math.round(labelDepth(d) * 200); return [0, 0, 0, a]; },
                    getOutlineWidth: 2.5,
                    getPixelOffset: (_, {index}) => offset(index),
                    getTextAnchor: 'middle',
                    getAlignmentBaseline: 'bottom',
                    billboard: true,
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    fontWeight: 'bold',
                    characterSet: 'auto'
                }),
                new deck.TextLayer({
                    id: 'waypoint-elevations',
                    data: waypoints,
                    getPosition: d => [d.lon, d.lat, d.ele * EXAG + 58],
                    getText: d => `${Math.round(d.eleFt)} ft`,
                    getSize: d => labelSize() * 0.7 * labelDepth(d),
                    getColor: d => { const a = Math.round(labelDepth(d) * 255); return [255, 220, 180, a]; },
                    getOutlineColor: d => { const a = Math.round(labelDepth(d) * 180); return [0, 0, 0, a]; },
                    getOutlineWidth: 1.5,
                    getPixelOffset: (_, {index}) => offset(index),
                    getTextAnchor: 'middle',
                    getAlignmentBaseline: 'top',
                    billboard: true,
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    characterSet: 'auto'
                })
            ]
        });
        map.addControl(deckOverlay);

        // ── Elevation Profile (black-on-white with grid) ────

        const canvas = document.getElementById('profile-canvas');
        const ctx = canvas.getContext('2d');

        function drawProfile() {
            const parent = canvas.parentElement;
            const w = parent.clientWidth, h = parent.clientHeight;
            canvas.width = w * devicePixelRatio;
            canvas.height = h * devicePixelRatio;
            ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
            const pad = { top: 20, bottom: 24, left: 42, right: 14 };
            const pw = w - pad.left - pad.right, ph = h - pad.top - pad.bottom;

            ctx.clearRect(0, 0, w, h);

            // Background
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, w, h);

            if (profile.length < 2) return;

            const elevs = profile.map(p => p.ele * 3.28084);
            const dists = profile.map(p => p.dist);
            const maxE = Math.max(...elevs), minE = Math.min(...elevs);
            const maxD = dists[dists.length - 1];
            const rangeE = maxE - minE || 1;

            // Grid lines (horizontal, 4 evenly-spaced)
            ctx.strokeStyle = '#e0e0e0';
            ctx.lineWidth = 0.5;
            for (let g = 0; g <= 4; g++) {
                const y = pad.top + (g / 4) * ph;
                ctx.beginPath();
                ctx.moveTo(pad.left, y);
                ctx.lineTo(pad.left + pw, y);
                ctx.stroke();
                // Label
                const val = maxE - (g / 4) * rangeE;
                ctx.fillStyle = '#999';
                ctx.font = '8px sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText(`${Math.round(val)}'`, pad.left - 5, y + 3);
            }

            // Vertical grid lines
            ctx.strokeStyle = '#f0f0f0';
            ctx.lineWidth = 0.5;
            for (let g = 0; g <= 4; g++) {
                const x = pad.left + (g / 4) * pw;
                ctx.beginPath();
                ctx.moveTo(x, pad.top);
                ctx.lineTo(x, pad.top + ph);
                ctx.stroke();
            }

            // Distance label
            ctx.fillStyle = '#999';
            ctx.font = '8px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`${(maxD * 0.621371).toFixed(1)} mi`, pad.left + pw / 2, h - 5);

            // Title
            ctx.fillStyle = '#333';
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('ELEVATION PROFILE', pad.left, 13);

            // Fill under curve
            const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ph);
            grad.addColorStop(0, 'rgba(255, 107, 53, 0.12)');
            grad.addColorStop(1, 'rgba(255, 107, 53, 0.01)');
            ctx.beginPath();
            ctx.moveTo(pad.left, pad.top + ph);
            for (let i = 0; i < profile.length; i++) {
                const x = pad.left + (dists[i] / maxD) * pw;
                const y = pad.top + ph - ((elevs[i] - minE) / rangeE) * ph;
                ctx.lineTo(x, y);
            }
            ctx.lineTo(pad.left + pw, pad.top + ph);
            ctx.closePath();
            ctx.fillStyle = grad;
            ctx.fill();

            // Elevation line
            ctx.beginPath();
            for (let i = 0; i < profile.length; i++) {
                const x = pad.left + (dists[i] / maxD) * pw;
                const y = pad.top + ph - ((elevs[i] - minE) / rangeE) * ph;
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.strokeStyle = '#d85a2a';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        drawProfile();
        window.addEventListener('resize', drawProfile);

        map.fitBounds(bounds, { padding: 60, duration: 3500, pitch: 55, bearing: -15 });

    } catch (err) {
        console.error('Error:', err);
    }
});

function haversine(lon1, lat1, lon2, lat2) {
    const R = 3959;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
