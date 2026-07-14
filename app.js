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
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'
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

        const KNOWN_LENGTH_MI = 33.4;
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
            id: 'trail-glow',
            type: 'line',
            source: 'trail-line',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
                'line-color': '#ff6b35',
                'line-width': [
                    'interpolate', ['exponential', 2], ['zoom'],
                    9, 1.0, 10, 2.0, 11, 4.0, 12, 8.0,
                    13, 16.0, 14, 32.0, 15, 64.0, 16, 128.0, 17, 256.0, 18, 512.0
                ],
                'line-opacity': 0.25,
                'line-blur': 6
            }
        }, 'trail-line');
        map.addLayer({
            id: 'trail-line',
            type: 'line',
            source: 'trail-line',
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': '#ff6b35',
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
        });

        // ── Start / Finish 3D torus (WebGL) ─────────────────

        const startFinish = [waypoints[0], waypoints[waypoints.length - 1]];

        function bearingTo(lon1, lat1, lon2, lat2) {
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const lat1r = lat1 * Math.PI / 180;
            const lat2r = lat2 * Math.PI / 180;
            const y = Math.sin(dLon) * Math.cos(lat2r);
            const x = Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLon);
            return Math.atan2(y, x) * 180 / Math.PI;
        }

        function calcBearing(points, startIdx, count) {
            let sumSin = 0, sumCos = 0;
            const end = Math.min(startIdx + count, points.length - 1);
            for (let i = startIdx; i < end; i++) {
                const b = bearingTo(points[i].lon, points[i].lat, points[i + 1].lon, points[i + 1].lat) * Math.PI / 180;
                sumSin += Math.sin(b);
                sumCos += Math.cos(b);
            }
            return Math.atan2(sumSin, sumCos) * 180 / Math.PI;
        }

        const startBearing = calcBearing(pathPoints, 0, 20);
        const finishBearing = calcBearing(pathPoints, pathPoints.length - 21, 20);

        const TORUS_R = 50, TORUS_r = 8;
        const SEG_RING = 80, SEG_TUBE = 24;

        const ringDefs = [
            { wp: startFinish[0], bearing: startBearing, label: 'START',  speed: 1.0 },
            { wp: startFinish[1], bearing: finishBearing, label: 'FINISH', speed: 0.7 }
        ];

        function makeTextCanvas(label) {
            const c = document.createElement('canvas');
            c.width = 1024; c.height = 256;
            const cx = c.getContext('2d');
            cx.fillStyle = '#ff6b35';
            cx.fillRect(0, 0, 1024, 256);
            cx.strokeStyle = '#cc5528';
            cx.lineWidth = 2;
            for (let i = 0; i < 3; i++) {
                cx.strokeRect(i * 1024 / 3 + 20, 20, 1024 / 3 - 40, 216);
            }
            cx.fillStyle = '#ffffff';
            cx.font = 'bold 80px Oswald, sans-serif';
            cx.textAlign = 'center';
            cx.textBaseline = 'middle';
            for (let i = 0; i < 3; i++) {
                cx.fillText(label, (i + 0.5) * 1024 / 3, 128);
            }
            return c;
        }

        let ringAngle = 0;
        const FLOATS = 8;
        const STRIDE = FLOATS * 4;

        function torusVert(theta, phi, cosB, sinB, wp) {
            const cp = Math.cos(phi), sp = Math.sin(phi);
            const ct = Math.cos(theta), st = Math.sin(theta);
            const x = (TORUS_R + TORUS_r * cp) * ct;
            const y = (TORUS_R + TORUS_r * cp) * st;
            const z = TORUS_r * sp;
            const x2 = z, y2 = y, z2 = x;
            const wx = x2 * sinB + z2 * cosB;
            const wy = x2 * cosB - z2 * sinB;
            const wz = y2;
            const terrainEle = map.queryTerrainElevation([wp.lon, wp.lat]) || 0;
            const mc = maplibregl.MercatorCoordinate.fromLngLat(
                [wp.lon + wx / (111320 * Math.cos(wp.lat * Math.PI / 180)),
                 wp.lat + wy / 111320], terrainEle + wz);
            const nx2 = sp, ny2 = cp * st, nz2 = cp * ct;
            const nnx = nx2 * sinB + nz2 * cosB;
            const nny = nx2 * cosB - nz2 * sinB;
            const nnz = ny2;
            const shade = 0.35 + 0.65 * Math.max(0, nnx * 0.3 - nny * 0.5 + nnz * 0.85);
            const u = theta / (Math.PI * 2);
            const v = (phi + Math.PI) / (Math.PI * 2);
            return [mc.x, mc.y, mc.z, shade, u, v, 0, 0];
        }

        function buildTorus(wp, bearingDeg, angle) {
            const b = bearingDeg * Math.PI / 180;
            const cosB = Math.cos(b), sinB = Math.sin(b);
            const out = [];
            for (let i = 0; i < SEG_RING; i++) {
                const t1 = (i / SEG_RING) * Math.PI * 2 + angle;
                const t2 = ((i + 1) / SEG_RING) * Math.PI * 2 + angle;
                for (let j = 0; j < SEG_TUBE; j++) {
                    const p1 = ((j / SEG_TUBE) - 0.5) * Math.PI * 2;
                    const p2 = (((j + 1) / SEG_TUBE) - 0.5) * Math.PI * 2;
                    const a = torusVert(t1, p1, cosB, sinB, wp);
                    const c = torusVert(t1, p2, cosB, sinB, wp);
                    const d = torusVert(t2, p2, cosB, sinB, wp);
                    const e = torusVert(t2, p1, cosB, sinB, wp);
                    out.push(...a, ...c, ...d, ...d, ...e, ...a);
                }
            }
            return new Float32Array(out);
        }

        map.addLayer({
            id: 'ring-3d', type: 'custom', renderingMode: '3d',
            onAdd: function(m, gl) {
                this.map = m;
                this.buf = gl.createBuffer();

                const vsSrc = 'attribute vec3 aPos;attribute float aShade;attribute vec2 aUV;uniform mat4 uMat;varying float vS;varying vec2 vUV;void main(){gl_Position=uMat*vec4(aPos,1.0);vS=aShade;vUV=aUV;}';
                const fsSrc = 'precision mediump float;uniform sampler2D uTex;varying float vS;varying vec2 vUV;void main(){vec4 c=texture2D(uTex,vUV);gl_FragColor=vec4(c.rgb*vS,c.a);}';

                function mkShader(type, src) {
                    const s = gl.createShader(type);
                    gl.shaderSource(s, src);
                    gl.compileShader(s);
                    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
                        console.error('[ring-3d] shader:', gl.getShaderInfoLog(s));
                    }
                    return s;
                }

                const vs = mkShader(gl.VERTEX_SHADER, vsSrc);
                const fs = mkShader(gl.FRAGMENT_SHADER, fsSrc);
                this.prg = gl.createProgram();
                gl.attachShader(this.prg, vs);
                gl.attachShader(this.prg, fs);
                gl.linkProgram(this.prg);
                if (!gl.getProgramParameter(this.prg, gl.LINK_STATUS)) {
                    console.error('[ring-3d] link:', gl.getProgramInfoLog(this.prg));
                }

                this.aPos   = gl.getAttribLocation(this.prg, 'aPos');
                this.aShade = gl.getAttribLocation(this.prg, 'aShade');
                this.aUV    = gl.getAttribLocation(this.prg, 'aUV');
                this.uMat   = gl.getUniformLocation(this.prg, 'uMat');
                this.uTex   = gl.getUniformLocation(this.prg, 'uTex');
                this.textures = [];
                for (const def of ringDefs) {
                    const tex = gl.createTexture();
                    gl.bindTexture(gl.TEXTURE_2D, tex);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, makeTextCanvas(def.label));
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    this.textures.push(tex);
                }
            },
            render: function(gl, matrix) {
                gl.useProgram(this.prg);
                gl.enable(gl.DEPTH_TEST);
                gl.depthFunc(gl.LEQUAL);
                gl.uniformMatrix4fv(this.uMat, false, matrix);
                gl.uniform1i(this.uTex, 0);
                gl.activeTexture(gl.TEXTURE0);

                for (let i = 0; i < ringDefs.length; i++) {
                    const r = ringDefs[i];
                    const data = buildTorus(r.wp, r.bearing, ringAngle * r.speed);
                    gl.bindTexture(gl.TEXTURE_2D, this.textures[i]);
                    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
                    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);

                    gl.enableVertexAttribArray(this.aPos);
                    gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, STRIDE, 0);
                    gl.enableVertexAttribArray(this.aShade);
                    gl.vertexAttribPointer(this.aShade, 1, gl.FLOAT, false, STRIDE, 12);
                    gl.enableVertexAttribArray(this.aUV);
                    gl.vertexAttribPointer(this.aUV, 2, gl.FLOAT, false, STRIDE, 16);

                    gl.drawArrays(gl.TRIANGLES, 0, data.length / FLOATS);
                }

                ringAngle += 0.018;
                this.map.triggerRepaint();
            }
        });

        // ── Elevation Profile (black-on-white with grid) ────

        const canvas = document.getElementById('profile-canvas');
        const ctx = canvas.getContext('2d');
        const profilePanel = document.getElementById('elevation-profile');
        const toggleBtn = document.getElementById('profile-toggle');

        let hoverDist = null;

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
                // Tick
                ctx.strokeStyle = '#ccc';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(mx, pad.top + ph);
                ctx.lineTo(mx, pad.top + ph + 4);
                ctx.stroke();
                // Label
                ctx.fillStyle = '#999';
                ctx.fillText(`${m}`, mx, pad.top + ph + 14);
            }

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

            // Hover indicator
            if (hoverDist !== null) {
                const hx = pad.left + (hoverDist / maxD) * pw;
                // Vertical line
                ctx.beginPath();
                ctx.moveTo(hx, pad.top);
                ctx.lineTo(hx, pad.top + ph);
                ctx.strokeStyle = 'rgba(0,0,0,0.3)';
                ctx.lineWidth = 1;
                ctx.stroke();
                // Interpolate elevation at hover distance
                let hy = pad.top, eleAtHover = minE;
                for (let i = 1; i < profile.length; i++) {
                    if (dists[i] >= hoverDist) {
                        const t = (hoverDist - dists[i - 1]) / (dists[i] - dists[i - 1]);
                        eleAtHover = elevs[i - 1] + t * (elevs[i] - elevs[i - 1]);
                        hy = pad.top + ph - ((eleAtHover - minE) / rangeE) * ph;
                        break;
                    }
                }
                // Dot
                ctx.beginPath();
                ctx.arc(hx, hy, 4, 0, Math.PI * 2);
                ctx.fillStyle = '#d85a2a';
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
                // Label
                ctx.fillStyle = '#333';
                ctx.font = 'bold 10px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(`${hoverDist.toFixed(1)} mi  ·  ${Math.round(eleAtHover)} ft`, hx, pad.top - 5);
            }
        }

        drawProfile();
        window.addEventListener('resize', drawProfile);

        // Redraw after CSS transition completes
        profilePanel.addEventListener('transitionend', () => drawProfile());

        // Toggle panel
        toggleBtn.addEventListener('click', () => {
            profilePanel.classList.toggle('collapsed');
        });

        // ── Hover tracking: map → elevation profile ────

        map.on('mousemove', (e) => {
            let minSq = Infinity;
            let nearest = null;
            for (let i = 0; i < pathPoints.length; i++) {
                const sp = map.project([pathPoints[i].lon, pathPoints[i].lat]);
                const sq = (sp.x - e.point.x) ** 2 + (sp.y - e.point.y) ** 2;
                if (sq < minSq) { minSq = sq; nearest = profile[i].dist; }
            }
            if (minSq < 900) {
                hoverDist = nearest;
            } else {
                hoverDist = null;
            }
            drawProfile();
        });

        map.on('mouseleave', () => { hoverDist = null; drawProfile(); });

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
