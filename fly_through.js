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

export function initFlyThrough(map, pathPoints) {
    var SPEED = 800;
    var CAM_ABOVE = 1000;
    var EARTH_CIRC = 40075016.686;
    var HEADING_LOOKBACK = SPEED * 5;

    var cumDist = buildCumDist(pathPoints);
    var totalLen = cumDist[cumDist.length - 1];

    var maxEle = 0;
    for (var i = 0; i < pathPoints.length; i++) {
        if (pathPoints[i].ele > maxEle) maxEle = pathPoints[i].ele;
    }
    var camAlt = maxEle * 1.5 + CAM_ABOVE;
    var avgLat = (pathPoints[0].lat + pathPoints[pathPoints.length - 1].lat) / 2;
    var fixedZoom = Math.log2(EARTH_CIRC * Math.cos(toRad(avgLat)) / camAlt);
    fixedZoom = Math.max(2, Math.min(18, fixedZoom));

    var progress = 0;
    var lastTime = null;

    var btn = document.getElementById('flythrough-btn');
    var runnerSource = null;
    var runnerExists = false;

    function ensureRunner() {
        if (runnerExists) {
            try { map.removeLayer('fly-runner-layer'); } catch (e) { }
            try { map.removeSource('fly-runner'); } catch (e) { }
            runnerExists = false;
        }

        map.addSource('fly-runner', {
            type: 'geojson',
            data: {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [pathPoints[0].lon, pathPoints[0].lat] }
            }
        });

        if (!map.hasImage('runner-dot')) {
            var S = 64;
            var c = document.createElement('canvas');
            c.width = S; c.height = S;
            var cx = c.getContext('2d');
            cx.beginPath();
            cx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
            cx.fillStyle = '#ff6b35';
            cx.fill();
            cx.lineWidth = 4;
            cx.strokeStyle = '#fff';
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
                'icon-size': 0.5,
                'icon-allow-overlap': true
            }
        });

        runnerSource = map.getSource('fly-runner');
        runnerExists = true;
    }

    function removeRunner() {
        try { map.removeLayer('fly-runner-layer'); } catch (e) { }
        try { map.removeSource('fly-runner'); } catch (e) { }
        runnerSource = null;
        runnerExists = false;
    }

    function tick(now) {
        if (!running) return;

        if (lastTime === null) lastTime = now;
        var dt = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;

        progress = Math.min(progress + SPEED * dt, totalLen);

        var dot = interpAt(cumDist, pathPoints, progress);

        if (runnerSource) {
            try {
                runnerSource.setData({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [dot.lon, dot.lat] }
                });
            } catch (e) { }
        }

        var lookbackPos = interpAt(cumDist, pathPoints, Math.max(0, progress - HEADING_LOOKBACK));
        var heading = bearingDeg(lookbackPos.lon, lookbackPos.lat, dot.lon, dot.lat);

        var surfEle = dot.ele;
        try {
            var qe = map.queryTerrainElevation([dot.lon, dot.lat]);
            if (qe != null && !isNaN(qe)) surfEle = qe;
        } catch (e) { }

        var headRad = toRad(heading);
        var cosLat = Math.cos(toRad(dot.lat));
        var dLat = surfEle * Math.cos(headRad) / 111320;
        var dLon = surfEle * Math.sin(headRad) / (111320 * cosLat);

        map.jumpTo({
            center: [dot.lon + dLon, dot.lat + dLat],
            bearing: heading,
            pitch: 45,
            zoom: fixedZoom
        });

        if (progress >= totalLen) {
            stopAll();
            return;
        }

        animFrame = requestAnimationFrame(tick);
    }

    function stopAll() {
        running = false;
        if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
        btn.classList.remove('active');
        btn.innerHTML = '&#9654;';
        btn.title = 'Play flythrough';
        removeRunner();
    }

    btn.addEventListener('click', function () {
        if (running) {
            stopAll();
            return;
        }

        running = true;
        progress = 0;
        lastTime = null;
        btn.classList.add('active');
        btn.innerHTML = '&#9209;';
        btn.title = 'Stop flythrough';

        try {
            ensureRunner();
            animFrame = requestAnimationFrame(tick);
        } catch (e) {
            running = false;
            btn.classList.remove('active');
            btn.innerHTML = '&#9654;';
            btn.title = 'Play flythrough';
        }
    });
}
