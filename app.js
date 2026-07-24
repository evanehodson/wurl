import { createTorusLayer } from './torus.js';
import { initFlyThrough } from './fly_through.js';

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
            },
            {
                id: 'ambient',
                type: 'ambient',
                color: '#fff5e6',
                intensity: 0.35
            }
        ],
        glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'
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
        'sky-color': '#1a6fb5',
        'horizon-color': '#e8dcc8',
        'fog-color': '#d4cbbf',
        'sky-horizon-blend': 0.45,
        'horizon-fog-blend': 0.5,
        'fog-ground-blend': 0.65,
        'atmosphere-blend': 0.8
    });

    // ── Vector tile labels (peaks, park names) ────────────────

    map.addSource('openfreemap', {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet'
    });

    // Mountain peak icon (sharp brown triangle + rounded outward white buffer stroke)
    const S = 32;
    const triData = new Uint8Array(S * S * 4);
    function segDist(px, py, ax, ay, bx, by) {
        const dx = bx - ax, dy = by - ay;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
        const ex = px - (ax + t * dx), ey = py - (ay + t * dy);
        return Math.sqrt(ex * ex + ey * ey);
    }
    function cross2(ax, ay, bx, by) { return ax * by - ay * bx; }
    const tA = [16, 3], tB = [3, 27], tC = [29, 27];
    const strokeR = 3, aa = 1.0;
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            const px = x + 0.5, py = y + 0.5;
            const d1 = cross2(px - tA[0], py - tA[1], tB[0] - tA[0], tB[1] - tA[1]);
            const d2 = cross2(px - tB[0], py - tB[1], tC[0] - tB[0], tC[1] - tB[1]);
            const d3 = cross2(px - tC[0], py - tC[1], tA[0] - tC[0], tA[1] - tC[1]);
            const inside = (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
            const eDist = Math.min(segDist(px, py, tA[0], tA[1], tB[0], tB[1]), segDist(px, py, tB[0], tB[1], tC[0], tC[1]), segDist(px, py, tC[0], tC[1], tA[0], tA[1]));
            const sd = inside ? -eDist : eDist;
            const i = (y * S + x) * 4;
            if (sd < 0) {
                triData[i] = 139; triData[i + 1] = 69; triData[i + 2] = 19; triData[i + 3] = 255;
            } else if (sd < strokeR) {
                triData[i] = 255; triData[i + 1] = 255; triData[i + 2] = 255;
                triData[i + 3] = Math.round(Math.min(1, Math.max(0, 1 - (sd - strokeR + aa) / aa)) * 255);
            }
        }
    }
    map.addImage('peak-icon', { width: S, height: S, data: triData });

    // Park/forest name labels (billboarded in screen space)
    map.addLayer({
        id: 'park-labels',
        type: 'symbol',
        source: 'openfreemap',
        'source-layer': 'park',
        minzoom: 9,
        layout: {
            'text-field': '{name}',
            'text-font': ['Noto Sans Italic'],
            'text-size': 12,
            'text-letter-spacing': 0.15,
            'text-transform': 'uppercase',
            'text-pitch-alignment': 'viewport',
            'text-rotation-alignment': 'viewport',
            'symbol-placement': 'point',
            'symbol-spacing': 300,
            'text-padding': 50
        },
        paint: {
            'text-color': '#d4edda',
            'text-halo-color': '#1a3a1a',
            'text-halo-width': 2
        }
    });

    try {
        const resp = await fetch('data/WURL_Wasatch_Ultimate_Ridge_Linkup.gpx');
        const text = await resp.text();
        const xml = new DOMParser().parseFromString(text, 'text/xml');

        const trkpts = xml.getElementsByTagName('trkpt');
        const pathPoints = [];
        const bounds = new maplibregl.LngLatBounds();
        let cumDist = 0;
        const cumDistArr = [0];
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
            cumDistArr.push(cumDist);
            profile.push({ dist: cumDist, ele });
        }

        const KNOWN_LENGTH_MI = 35.6;
        const distScale = KNOWN_LENGTH_MI / cumDist;
        profile.forEach(p => p.dist *= distScale);

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
            id: 'trail-outline',
            type: 'line',
            source: 'trail-line',
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': '#ffffff',
                'line-width': [
                    'interpolate', ['exponential', 2], ['zoom'],
                    9, 0.415,
                    10, 0.83,
                    11, 1.66,
                    12, 3.32,
                    13, 6.64,
                    14, 13.29,
                    15, 26.58,
                    16, 53.15,
                    17, 106.3,
                    18, 212.6
                ],
                'line-opacity': 1.0,
                'line-blur': 0
            }
        }, 'park-labels');
        map.addLayer({
            id: 'trail-line',
            type: 'line',
            source: 'trail-line',
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': '#ff3366',
                'line-width': [
                    'interpolate', ['exponential', 2], ['zoom'],
                    9, 0.215,
                    10, 0.43,
                    11, 0.86,
                    12, 1.72,
                    13, 3.44,
                    14, 6.89,
                    15, 13.78,
                    16, 27.55,
                    17, 55.1,
                    18, 110.2
                ],
                'line-opacity': 1.0,
                'line-blur': 0
            }
        }, 'park-labels');

        map.addLayer(createTorusLayer(map, pathPoints, waypoints));

        // Peak labels on top of everything
        map.addLayer({
            id: 'mountain-peaks',
            type: 'symbol',
            source: 'openfreemap',
            'source-layer': 'mountain_peak',
            filter: ['==', 'class', 'peak'],
            minzoom: 10,
            layout: {
                'icon-image': 'peak-icon',
                'icon-size': 0.35,
                'icon-anchor': 'bottom',
                'text-field': ['concat', ['get', 'name'], '\n', ['get', 'ele_ft'], ' ft'],
                'text-font': ['Noto Sans Italic'],
                'text-size': 9,
                'text-anchor': 'bottom',
                'text-offset': [0, -1.2],
                'text-pitch-alignment': 'viewport',
                'text-rotation-alignment': 'viewport'
            },
            paint: {
                'text-color': '#8B4513',
                'text-halo-color': '#ffffff',
                'text-halo-width': 1.2
            }
        });

        // ── Elevation Profile ────

        const canvas = document.getElementById('profile-canvas');
        const ctx = canvas.getContext('2d');
        const profilePanel = document.getElementById('elevation-profile');
        const toggleBtn = document.getElementById('profile-toggle');

        let hoverDist = null;
        let runnerDist = null;

        const flyThrough = initFlyThrough(map, pathPoints, (progress) => {
            runnerDist = progress > 0 ? (progress / 1609.34) * (KNOWN_LENGTH_MI / cumDist) : null;
            drawProfile();
        });

        function interpProfileCoords(d) {
            const scale = KNOWN_LENGTH_MI / cumDist;
            const meterDist = d / scale;
            for (let i = 1; i < pathPoints.length; i++) {
                if (cumDistArr[i] >= meterDist) {
                    const seg = cumDistArr[i] - cumDistArr[i - 1];
                    const t = seg > 0 ? (meterDist - cumDistArr[i - 1]) / seg : 0;
                    return {
                        lon: pathPoints[i - 1].lon + (pathPoints[i].lon - pathPoints[i - 1].lon) * t,
                        lat: pathPoints[i - 1].lat + (pathPoints[i].lat - pathPoints[i - 1].lat) * t
                    };
                }
            }
            return { lon: pathPoints[pathPoints.length - 1].lon, lat: pathPoints[pathPoints.length - 1].lat };
        }

        function distToMeters(d) {
            return d / (KNOWN_LENGTH_MI / cumDist);
        }

        function milesToFlyMeters(mi) {
            return mi * 1609.34;
        }

        function drawProfile() {
            const parent = canvas.parentElement;
            const w = parent.clientWidth, h = parent.clientHeight;
            if (w === 0 || h === 0) return;
            canvas.width = w * devicePixelRatio;
            canvas.height = h * devicePixelRatio;
            ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
            const pad = { top: 20, bottom: 24, left: 42, right: 14 };
            const pw = w - pad.left - pad.right, ph = h - pad.top - pad.bottom;

            ctx.clearRect(0, 0, w, h);

            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, w, h);

            if (profile.length < 2) return;

            const elevs = profile.map(p => p.ele * 3.28084);
            const dists = profile.map(p => p.dist);
            const maxE = Math.max(...elevs), minE = Math.min(...elevs);
            const maxD = dists[dists.length - 1];
            const rangeE = maxE - minE || 1;

            // Horizontal grid
            ctx.strokeStyle = '#e0e0e0';
            ctx.lineWidth = 0.5;
            for (let g = 0; g <= 4; g++) {
                const y = pad.top + (g / 4) * ph;
                ctx.beginPath();
                ctx.moveTo(pad.left, y);
                ctx.lineTo(pad.left + pw, y);
                ctx.stroke();
                const val = maxE - (g / 4) * rangeE;
                ctx.fillStyle = '#999';
                ctx.font = '8px sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText(`${Math.round(val)}'`, pad.left - 5, y + 3);
            }

            // Vertical grid + mile markers
            const totalMi = maxD;
            ctx.font = '8px sans-serif';
            ctx.textAlign = 'center';
            for (let m = 1; m <= totalMi; m++) {
                const mx = pad.left + (m / totalMi) * pw;
                ctx.strokeStyle = '#f0f0f0';
                ctx.lineWidth = 0.5;
                ctx.beginPath();
                ctx.moveTo(mx, pad.top);
                ctx.lineTo(mx, pad.top + ph);
                ctx.stroke();
                ctx.strokeStyle = '#ccc';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(mx, pad.top + ph);
                ctx.lineTo(mx, pad.top + ph + 4);
                ctx.stroke();
                ctx.fillStyle = '#999';
                ctx.fillText(`${m}`, mx, pad.top + ph + 14);
            }

            // Fill under curve
            const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ph);
            grad.addColorStop(0, 'rgba(255, 51, 102, 0.12)');
            grad.addColorStop(1, 'rgba(255, 51, 102, 0.01)');
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
            ctx.strokeStyle = '#ff3366';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Runner scrubber on profile
            const scrubDist = hoverDist !== null ? hoverDist : runnerDist;
            if (scrubDist !== null && scrubDist > 0) {
                const sx = pad.left + (scrubDist / maxD) * pw;
                let sy = pad.top, eleAtScrub = minE;
                for (let i = 1; i < profile.length; i++) {
                    if (dists[i] >= scrubDist) {
                        const t = (dists[i] - dists[i - 1]) > 0 ? (scrubDist - dists[i - 1]) / (dists[i] - dists[i - 1]) : 0;
                        eleAtScrub = elevs[i - 1] + t * (elevs[i] - elevs[i - 1]);
                        sy = pad.top + ph - ((eleAtScrub - minE) / rangeE) * ph;
                        break;
                    }
                }
                ctx.beginPath();
                ctx.moveTo(sx, pad.top);
                ctx.lineTo(sx, pad.top + ph);
                ctx.strokeStyle = 'rgba(255, 51, 102, 0.4)';
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(sx, sy, 4, 0, Math.PI * 2);
                ctx.fillStyle = '#ff3366';
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.fillStyle = '#333';
                ctx.font = 'bold 10px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(`${scrubDist.toFixed(1)} mi  ·  ${Math.round(eleAtScrub)} ft`, sx, pad.top - 5);
            }
        }

        drawProfile();
        window.addEventListener('resize', drawProfile);
        profilePanel.addEventListener('transitionend', () => drawProfile());

        toggleBtn.addEventListener('click', () => {
            profilePanel.classList.toggle('collapsed');
        });

        // ── Hover tracking: map → runner + profile ────

        map.on('mousemove', (e) => {
            let minSq = Infinity;
            let nearest = null;
            let nearestPt = null;
            for (let i = 0; i < pathPoints.length; i++) {
                const sp = map.project([pathPoints[i].lon, pathPoints[i].lat]);
                const sq = (sp.x - e.point.x) ** 2 + (sp.y - e.point.y) ** 2;
                if (sq < minSq) { minSq = sq; nearest = profile[i].dist; nearestPt = pathPoints[i]; }
            }
            if (minSq < 900 && nearestPt) {
                hoverDist = nearest;
                flyThrough.moveRunner(nearestPt.lon, nearestPt.lat);
                flyThrough.showRunner();
            } else {
                hoverDist = null;
                if (runnerDist !== null) {
                    const c = interpProfileCoords(runnerDist);
                    flyThrough.moveRunner(c.lon, c.lat);
                } else {
                    flyThrough.hideRunner();
                }
            }
            drawProfile();
        });

        map.on('mouseleave', () => {
            hoverDist = null;
            if (runnerDist !== null) {
                const c = interpProfileCoords(runnerDist);
                flyThrough.moveRunner(c.lon, c.lat);
            } else {
                flyThrough.hideRunner();
            }
            drawProfile();
        });

        // ── Click tracking: map → camera ────

        map.on('click', (e) => {
            let minSq = Infinity;
            let nearest = null;
            let nearestPt = null;
            let nearestIdx = 0;
            for (let i = 0; i < pathPoints.length; i++) {
                const sp = map.project([pathPoints[i].lon, pathPoints[i].lat]);
                const sq = (sp.x - e.point.x) ** 2 + (sp.y - e.point.y) ** 2;
                if (sq < minSq) { minSq = sq; nearestPt = pathPoints[i]; nearestIdx = i; }
            }
            if (minSq < 900 && nearestPt) {
                const meterDist = milesToFlyMeters(cumDistArr[nearestIdx]);
                flyThrough.setProgress(meterDist);
                runnerDist = (meterDist / 1609.34) * (KNOWN_LENGTH_MI / cumDist);
                flyThrough.moveRunner(nearestPt.lon, nearestPt.lat);
                flyThrough.showRunner();
                map.jumpTo({
                    center: [nearestPt.lon, nearestPt.lat]
                });
                drawProfile();
            }
        });

        // ── Hover tracking: elevation profile → runner ────

        canvas.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const pad = { top: 20, bottom: 24, left: 42, right: 14 };
            const pw = rect.width - pad.left - pad.right;
            const relX = mx - pad.left;
            if (relX < 0 || relX > pw) {
                hoverDist = null;
                if (runnerDist !== null) {
                    const c = interpProfileCoords(runnerDist);
                    flyThrough.moveRunner(c.lon, c.lat);
                } else {
                    flyThrough.hideRunner();
                }
                drawProfile();
                return;
            }
            const dists = profile.map(p => p.dist);
            const maxD = dists[dists.length - 1];
            hoverDist = (relX / pw) * maxD;
            const coords = interpProfileCoords(hoverDist);
            flyThrough.moveRunner(coords.lon, coords.lat);
            flyThrough.showRunner();
            drawProfile();
        });

        canvas.addEventListener('mouseleave', () => {
            hoverDist = null;
            if (runnerDist !== null) {
                const c = interpProfileCoords(runnerDist);
                flyThrough.moveRunner(c.lon, c.lat);
            } else {
                flyThrough.hideRunner();
            }
            drawProfile();
        });

        // ── Click tracking: elevation profile → camera ────

        canvas.addEventListener('click', (e) => {
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const pad = { top: 20, bottom: 24, left: 42, right: 14 };
            const pw = rect.width - pad.left - pad.right;
            const relX = mx - pad.left;
            if (relX < 0 || relX > pw) return;
            const dists = profile.map(p => p.dist);
            const maxD = dists[dists.length - 1];
            const clickDist = (relX / pw) * maxD;
            const meterDist = milesToFlyMeters(distToMeters(clickDist));
            const coords = interpProfileCoords(clickDist);
            flyThrough.setProgress(meterDist);
            flyThrough.moveRunner(coords.lon, coords.lat);
            flyThrough.showRunner();
            runnerDist = clickDist;
            map.jumpTo({
                center: [coords.lon, coords.lat]
            });
            drawProfile();
        });

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
