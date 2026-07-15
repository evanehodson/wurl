const TORUS_R = 100, TORUS_r = 20;
const SEG_RING = 80, SEG_TUBE = 24;
const FLOATS = 8;
const STRIDE = FLOATS * 4;

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

function makeTextCanvas(label) {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 256;
    const cx = c.getContext('2d');
    cx.fillStyle = '#ff6b35';
    cx.fillRect(0, 0, 1024, 256);
    cx.fillStyle = '#ffffff';
    cx.font = 'bold 80px Oswald, sans-serif';
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    for (let i = 0; i < 3; i++) {
        cx.fillText(label, (i + 0.5) * 1024 / 3, 64);
    }
    for (let i = 0; i < 3; i++) {
        const x = (i + 0.5) * 1024 / 3;
        cx.save();
        cx.translate(x, 192);
        cx.rotate(Math.PI);
        cx.fillText(label, 0, 0);
        cx.restore();
    }
    return c;
}

const ELEVATION_BIAS = 0.5;

function torusVert(theta, phi, cosB, sinB, wp, origin, map, angle) {
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
    const vertex = maplibregl.MercatorCoordinate.fromLngLat(
        [wp.lon + wx / (111320 * Math.cos(wp.lat * Math.PI / 180)),
         wp.lat + wy / 111320], terrainEle + wz + ELEVATION_BIAS);
    const nx2 = sp, ny2 = cp * st, nz2 = cp * ct;
    const nnx = nx2 * sinB + nz2 * cosB;
    const nny = nx2 * cosB - nz2 * sinB;
    const nnz = ny2;
    const shade = 0.35 + 0.65 * Math.max(0, nnx * 0.3 - nny * 0.5 + nnz * 0.85);
    const u = (theta - angle) / (Math.PI * 2);
    const v = (phi + Math.PI + angle) / (Math.PI * 2);
    return [vertex.x - origin.x, vertex.y - origin.y, vertex.z - origin.z, shade, u, v, 0, 0];
}

function buildTorus(wp, bearingDeg, angle, map) {
    const terrainEle = map.queryTerrainElevation([wp.lon, wp.lat]) || 0;
    const origin = maplibregl.MercatorCoordinate.fromLngLat([wp.lon, wp.lat], terrainEle + ELEVATION_BIAS);
    const b = bearingDeg * Math.PI / 180;
    const cosB = Math.cos(b), sinB = Math.sin(b);
    const out = [];
    for (let i = 0; i < SEG_RING; i++) {
        const t1 = (i / SEG_RING) * Math.PI * 2 + angle;
        const t2 = ((i + 1) / SEG_RING) * Math.PI * 2 + angle;
        for (let j = 0; j < SEG_TUBE; j++) {
            const p1 = ((j / SEG_TUBE) - 0.5) * Math.PI * 2;
            const p2 = (((j + 1) / SEG_TUBE) - 0.5) * Math.PI * 2;
            const a = torusVert(t1, p1, cosB, sinB, wp, origin, map, angle);
            const c = torusVert(t1, p2, cosB, sinB, wp, origin, map, angle);
            const d = torusVert(t2, p2, cosB, sinB, wp, origin, map, angle);
            const e = torusVert(t2, p1, cosB, sinB, wp, origin, map, angle);
            out.push(...a, ...c, ...d, ...d, ...e, ...a);
        }
    }
    return { vertices: new Float32Array(out), origin: [origin.x, origin.y, origin.z] };
}

// Double-precision matrix translation helper
function translateMatrix(matrix, x, y, z) {
    const translated = new Float32Array(matrix);
    translated[12] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
    translated[13] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
    translated[14] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
    translated[15] = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
    return translated;
}

export function createTorusLayer(map, pathPoints, waypoints) {
    const startFinish = [waypoints[0], waypoints[waypoints.length - 1]];
    const startBearing = calcBearing(pathPoints, 0, 20);
    const finishBearing = calcBearing(pathPoints, pathPoints.length - 21, 20);

    const ringDefs = [
        { wp: startFinish[0], bearing: startBearing, label: 'START',  speed: 1.0 },
        { wp: startFinish[1], bearing: finishBearing, label: 'FINISH', speed: 0.7 }
    ];

    let ringAngle = 0;

    // Removed direct coordinate addition (uOrigin + aPos) to prevent 32-bit float precision loss
    const vsSrc = 'attribute vec3 aPos;attribute float aShade;attribute vec2 aUV;uniform mat4 uMat;varying float vS;varying vec2 vUV;void main(){gl_Position=uMat*vec4(aPos,1.0);vS=aShade;vUV=aUV;}';
    const fsSrc = 'precision mediump float;uniform sampler2D uTex;varying float vS;varying vec2 vUV;void main(){vec4 c=texture2D(uTex,vUV);gl_FragColor=vec4(c.rgb*vS,c.a);}';

    return {
        id: 'ring-3d', type: 'custom', renderingMode: '3d',
        onAdd: function(m, gl) {
            this.map = m;
            this.buf = gl.createBuffer();

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
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
                this.textures.push(tex);
            }
        },
        render: function(gl, matrix) {
            gl.useProgram(this.prg);

            // Configure proper depth testing and terrain occlusion
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LEQUAL);
            gl.depthMask(true); // Ensures geometry can render with clean self-occlusion

            gl.enable(gl.CULL_FACE);
            gl.cullFace(gl.BACK);

            gl.uniform1i(this.uTex, 0);
            gl.activeTexture(gl.TEXTURE0);

            for (let i = 0; i < ringDefs.length; i++) {
                const r = ringDefs[i];
                const { vertices, origin } = buildTorus(r.wp, r.bearing, ringAngle * r.speed, this.map);
                
                // CPU Matrix translation to preserve 64-bit precision
                const translatedMatrix = translateMatrix(matrix, origin[0], origin[1], origin[2]);
                gl.uniformMatrix4fv(this.uMat, false, translatedMatrix);

                gl.bindTexture(gl.TEXTURE_2D, this.textures[i]);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
                gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);

                gl.enableVertexAttribArray(this.aPos);
                gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, STRIDE, 0);
                gl.enableVertexAttribArray(this.aShade);
                gl.vertexAttribPointer(this.aShade, 1, gl.FLOAT, false, STRIDE, 12);
                gl.enableVertexAttribArray(this.aUV);
                gl.vertexAttribPointer(this.aUV, 2, gl.FLOAT, false, STRIDE, 16);

                gl.drawArrays(gl.TRIANGLES, 0, vertices.length / FLOATS);
            }

            // Cleanup WebGL state cleanly for MapLibre
            gl.disable(gl.CULL_FACE);
            
            ringAngle += 0.018;
            this.map.triggerRepaint();
        }
    };
}