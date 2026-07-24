let animFrame = null;
let running = false;

function toRad(d) { return d * Math.PI / 180; }
function toDeg(r) { return r * 180 / Math.PI; }

function haversine(lon1, lat1, lon2, lat2) {
    var R = 6371000;
    var dLat = toRad(lat2 - lat1);
    var dLon = toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(lon1, lat1, lon2, lat2) {
    var dLon = toRad(lon2 - lon1);
    var y = Math.sin(dLon) * Math.cos(toRad(lat2));
    var x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function buildCumDist(pts) {
    var cum = [0];
    for (var i = 1; i < pts.length; i++) {
        cum.push(cum[i - 1] + haversine(pts[i - 1].lon, pts[i - 1].lat, pts[i].lon, pts[i].lat));
    }
    return cum;
}

function interpAt(cum, pts, dist) {
    var total = cum[cum.length - 1];
    var d = Math.max(0, Math.min(dist, total));
    var lo = 0, hi = cum.length - 1;
    while (lo < hi - 1) {
        var mid = (lo + hi) >> 1;
        if (cum[mid] <= d) lo = mid; else hi = mid;
    }
    var seg = cum[hi] - cum[lo];
    var t = seg > 0 ? (d - cum[lo]) / seg : 0;
    return {
        lon: pts[lo].lon + (pts[hi].lon - pts[lo].lon) * t,
        lat: pts[lo].lat + (pts[hi].lat - pts[lo].lat) * t,
        ele: pts[lo].ele + (pts[hi].ele - pts[lo].ele) * t
    };
}

export function initFlyThrough(map, pathPoints, onProgress) {
    var SPEED = 1200;
    var CAM_ABOVE = 5000;
    var EARTH_CIRC = 40075016.686;
    var HEADING_FORWARD = SPEED * 2;
    var LOOK_AHEAD = SPEED * 2;
    var LERP_RATE = 3;

    var cumDist = buildCumDist(pathPoints);
    var totalLen = cumDist[cumDist.length - 1];

    var progress = 0;
    var lastTime = null;
    var smoothBearing = null, smoothZoom = null, smoothSurfEle = null;

    var btn = document.getElementById('flythrough-btn');
    var playIcon = document.getElementById('play-icon');
    var pauseIcon = document.getElementById('pause-icon');
    var backBtn = document.getElementById('flythrough-back');
    var stopBtn = document.getElementById('flythrough-stop');

    // Create runner source and layer once
    map.addSource('fly-runner', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'Point', coordinates: [pathPoints[0].lon, pathPoints[0].lat] } }
    });

    if (!map.hasImage('runner-dot')) {
        var S = 64;
        var c = document.createElement('canvas');
        c.width = S; c.height = S;
        var cx = c.getContext('2d');
        cx.shadowColor = '#ff3366';
        cx.shadowBlur = 12;
        cx.beginPath();
        cx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
        cx.fillStyle = '#ff3366';
        cx.fill();
        cx.shadowBlur = 0;
        cx.lineWidth = 7;
        cx.strokeStyle = '#ffffff';
        cx.stroke();
        map.addImage('runner-dot', {
            width: S, height: S,
            data: cx.getImageData(0, 0, S, S).data
        });
    }

    map.addLayer({
        id: 'fly-runner-layer',
        type: 'symbol',
        source: 'fly-runner',
        layout: {
            'icon-image': 'runner-dot',
            'icon-size': 0.3,
            'icon-allow-overlap': true,
            'icon-pitch-alignment': 'map',
            'icon-rotation-alignment': 'map',
            'visibility': 'none'
        }
    });

    var runnerSource = map.getSource('fly-runner');

    function moveRunner(lon, lat) {
        if (runnerSource) {
            try {
                runnerSource.setData({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [lon, lat] }
                });
            } catch (e) { }
        }
    }

    function showRunner() {
        map.setLayoutProperty('fly-runner-layer', 'visibility', 'visible');
    }

    function hideRunner() {
        map.setLayoutProperty('fly-runner-layer', 'visibility', 'none');
    }

    function tick(now) {
        if (!running) return;

        if (lastTime === null) lastTime = now;
        var dt = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;

        progress = Math.min(progress + SPEED * dt, totalLen);

        if (onProgress) onProgress(progress, totalLen);

        var dot = interpAt(cumDist, pathPoints, progress);

        moveRunner(dot.lon, dot.lat);
        showRunner();

        var headingDx = 0, headingDy = 0;
        var hSamples = 20;
        var aheadEnd = Math.min(progress + HEADING_FORWARD, totalLen);
        for (var i = 0; i < hSamples; i++) {
            var d1 = progress + (aheadEnd - progress) * i / hSamples;
            var d2 = Math.min(d1 + SPEED * 0.1, aheadEnd);
            var p1 = interpAt(cumDist, pathPoints, d1);
            var p2 = interpAt(cumDist, pathPoints, d2);
            var b = toRad(bearingDeg(p1.lon, p1.lat, p2.lon, p2.lat));
            headingDx += Math.cos(b);
            headingDy += Math.sin(b);
        }
        var targetBearing = (toDeg(Math.atan2(headingDy, headingDx)) + 360) % 360;

        var maxAheadEle = dot.ele;
        for (var t = 0; t <= LOOK_AHEAD; t += SPEED * 0.5) {
            var p = interpAt(cumDist, pathPoints, Math.min(progress + t, totalLen));
            if (p.ele > maxAheadEle) maxAheadEle = p.ele;
        }
        var targetZoom = Math.log2(EARTH_CIRC * Math.cos(toRad(dot.lat)) / (maxAheadEle * 2 + CAM_ABOVE));
        targetZoom = Math.max(2, Math.min(18, targetZoom));

        if (smoothBearing === null) {
            smoothBearing = targetBearing;
            smoothZoom = targetZoom;
            smoothSurfEle = dot.ele;
        }

        var lerp = 1 - Math.exp(-LERP_RATE * dt);
        var slowLerp = 1 - Math.exp(-0.8 * dt);
        smoothZoom += (targetZoom - smoothZoom) * lerp;

        var bDiff = targetBearing - smoothBearing;
        if (bDiff > 180) bDiff -= 360;
        if (bDiff < -180) bDiff += 360;
        smoothBearing = ((smoothBearing + bDiff * lerp) % 360 + 360) % 360;

        var surfEle = dot.ele;
        try {
            var qe = map.queryTerrainElevation([dot.lon, dot.lat]);
            if (qe != null && !isNaN(qe)) surfEle = qe;
        } catch (e) { }
        smoothSurfEle += (surfEle - smoothSurfEle) * slowLerp;

        var headRad = toRad(smoothBearing);
        var cosLat = Math.cos(toRad(dot.lat));
        var dLat = smoothSurfEle * Math.cos(headRad) / 111320;
        var dLon = smoothSurfEle * Math.sin(headRad) / (111320 * cosLat);

        var easeMs = Math.max(Math.round(dt * 1000), 1);
        map.easeTo({
            center: [dot.lon + dLon, dot.lat + dLat],
            bearing: smoothBearing,
            pitch: 45,
            zoom: smoothZoom,
            duration: easeMs,
            easing: function(t) { return t; }
        });

        if (progress >= totalLen) {
            stopAll();
            return;
        }

        animFrame = requestAnimationFrame(tick);
    }

    function updateButtons() {
        if (running) {
            playIcon.style.display = 'none';
            pauseIcon.style.display = 'block';
            btn.title = 'Pause flythrough';
            btn.classList.add('active');
            if (stopBtn) stopBtn.style.display = 'flex';
        } else {
            playIcon.style.display = 'block';
            pauseIcon.style.display = 'none';
            btn.title = progress > 0 && progress < totalLen ? 'Resume flythrough' : 'Play flythrough';
            btn.classList.remove('active');
            if (stopBtn) stopBtn.style.display = progress > 0 ? 'flex' : 'none';
        }
    }

    function pauseAll() {
        running = false;
        if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
        map.stop();
        if (onProgress) onProgress(progress, totalLen);
        updateButtons();
    }

    function stopAll() {
        running = false;
        if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
        map.stop();
        progress = 0;
        lastTime = null;
        smoothBearing = null;
        smoothZoom = null;
        smoothSurfEle = null;
        hideRunner();
        if (onProgress) onProgress(0, totalLen);
        updateButtons();
    }

    function resumeAll() {
        running = true;
        lastTime = null;
        updateButtons();
        try {
            animFrame = requestAnimationFrame(tick);
        } catch (e) {
            running = false;
            updateButtons();
        }
    }

    btn.addEventListener('click', function () {
        if (running) {
            pauseAll();
            return;
        }

        if (progress > 0 && progress < totalLen) {
            resumeAll();
            return;
        }

        progress = 0;
        lastTime = null;
        smoothBearing = null;
        smoothZoom = null;
        smoothSurfEle = null;
        resumeAll();
    });

    if (backBtn) {
        backBtn.addEventListener('click', function () {
            stopAll();
            progress = 0;
            lastTime = null;
            smoothBearing = null;
            smoothZoom = null;
            smoothSurfEle = null;
            resumeAll();
        });
    }

    if (stopBtn) {
        stopBtn.addEventListener('click', function () {
            stopAll();
        });
    }

    function setProgress(meters) {
        progress = Math.max(0, Math.min(meters, totalLen));
        lastTime = null;
        smoothBearing = null;
        smoothZoom = null;
        smoothSurfEle = null;
        if (onProgress) onProgress(progress, totalLen);
    }

    return { moveRunner, showRunner, hideRunner, setProgress };
}
