import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { API_URL } from '@/api';
import { TERMS, type Part } from '@/lib/glossary';

// LRN-07: a real bird to explore — the Smithsonian's 3D scan of "Cher Ami", a Rock Pigeon (CC0), served by our
// API at /models/. three.js runs in a WebView like our maps: spin it, pinch to zoom, tap a part (or a pin) and
// the camera flies to it. Pins round the far side fade out.
const LABELS = Object.fromEntries(TERMS.filter((t) => t.part).reverse().map((t) => [t.part, t.term]));

export function Bird3D({ selected, onSelect, height = 340 }: { selected?: Part; onSelect: (p: Part) => void; height?: number }) {
  const web = useRef<WebView>(null);
  const [html] = useState(() => page(`${API_URL}/models/pigeon.glb`, selected));
  useEffect(() => {
    // before the page is up, the part it opens on is already in its HTML
    if (selected) web.current?.injectJavaScript(`window.select && window.select(${JSON.stringify(selected)}); true;`);
  }, [selected]);
  return (
    <View style={[styles.box, { height }]}>
      <WebView
        ref={web}
        originWhitelist={['*']}
        source={{ html, baseUrl: API_URL }}
        style={styles.web}
        scrollEnabled={false}
        overScrollMode="never"
        onMessage={(e) => {
          const p = e.nativeEvent.data;
          if (p in LABELS) onSelect(p as Part);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignSelf: 'stretch', overflow: 'hidden' },
  web: { flex: 1, backgroundColor: 'transparent' },
});

const page = (model: string, start?: Part) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
html,body{margin:0;height:100%;overflow:hidden;background:transparent;font-family:system-ui,sans-serif;-webkit-user-select:none;user-select:none}
canvas{display:block;touch-action:none}
#pins{position:absolute;inset:0;pointer-events:none}
.pin{position:absolute;width:30px;height:30px;margin:-15px 0 0 -15px;pointer-events:auto;display:flex;align-items:center;justify-content:center;transition:opacity .25s}
.pin i{width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 0 0 3px rgba(255,255,255,.35),0 2px 8px rgba(0,0,0,.35);transition:transform .2s,background .2s}
.pin.on i{background:#F4B400;transform:scale(1.35);box-shadow:0 0 0 4px rgba(244,180,0,.35),0 0 18px #F4B400}
.pin.on::after{content:'';position:absolute;width:30px;height:30px;border-radius:50%;border:2px solid #F4B400;animation:ring 1.4s ease-out infinite}
.pin.hid{opacity:0;pointer-events:none}
.pin b{position:absolute;left:24px;top:3px;white-space:nowrap;font:600 12px system-ui;color:#1d1b3a;background:#fff;border-radius:10px;padding:3px 8px;box-shadow:0 2px 8px rgba(0,0,0,.18);display:none}
.pin.on b{display:block}
@keyframes ring{from{transform:scale(.6);opacity:1}to{transform:scale(1.8);opacity:0}}
#load{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#6b6890;font:600 13px system-ui}
</style>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"}}</script>
</head><body>
<div id="load">Loading the bird…</div><div id="pins"></div>
<script>window.MODEL = ${JSON.stringify(model)}; window.LABELS = ${JSON.stringify(LABELS)}; window.PENDING = ${JSON.stringify(start ?? null)};</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Rough spots on the Cher Ami mount (metres, Y up, bill toward +x); each snaps to the nearest surface point.
const GUESS = {
  bill:[0.066,0.195,0.048], forehead:[0.052,0.214,0.048], crown:[0.030,0.232,0.048], nape:[0.004,0.205,0.048],
  lores:[0.047,0.211,0.061], eyering:[0.035,0.219,0.063], supercilium:[0.035,0.228,0.060], throat:[0.047,0.180,0.048],
  breast:[0.040,0.140,0.065], belly:[0.020,0.070,0.050], flanks:[0.045,0.075,0.020], mantle:[-0.010,0.165,0.000],
  back:[-0.030,0.130,-0.040], rump:[-0.045,0.090,-0.080], tail:[-0.060,0.040,-0.125], undertail:[-0.030,0.045,-0.060],
  coverts:[0.045,0.120,-0.020], secondaries:[0.035,0.080,-0.060], primaries:[0.030,0.060,-0.090], legs:[0.010,0.020,0.020],
};
const post = (m) => window.ReactNativeWebView ? window.ReactNativeWebView.postMessage(m) : 0;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.9;
const key = new THREE.DirectionalLight(0xfff1dc, 2.2);
key.position.set(0.4, 0.8, 0.5); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 6;
Object.assign(key.shadow.camera, { left: -0.3, right: 0.3, top: 0.3, bottom: -0.3, near: 0.1, far: 3 });
scene.add(key);
const rim = new THREE.DirectionalLight(0xbfd4ff, 1.4); rim.position.set(-0.6, 0.4, -0.6); scene.add(rim);
const floor = new THREE.Mesh(new THREE.CircleGeometry(0.5, 48), new THREE.ShadowMaterial({ opacity: 0.18 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.01, 10);
const home = new THREE.Vector3(0.12, 0.3, 0.5);
camera.position.copy(home);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.115, 0);
controls.enableDamping = true; controls.enablePan = false;
controls.minDistance = 0.18; controls.maxDistance = 0.9;
controls.maxPolarAngle = Math.PI * 0.62;
controls.autoRotate = true; controls.autoRotateSpeed = 1.2;
let idle; controls.addEventListener('start', () => { controls.autoRotate = false; fly = null; clearTimeout(idle); });
controls.addEventListener('end', () => { idle = setTimeout(() => (controls.autoRotate = true), 8000); });

const pins = {}, anchors = {};
let selected = null, fly = null, body = null, down = null;

new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/'))
  .load(window.MODEL, (g) => {
    const bird = g.scene;
    bird.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      if (o.name.includes('glass')) { o.material.transmission = 0; o.material.transparent = true; o.material.opacity = 0.35; }
      if (o.name.includes('cher_ami')) body = o;
    });
    scene.add(bird);
    bird.updateMatrixWorld(true);
    // snap each guess to the closest vertex, and keep its normal so pins can hide round the back
    const pos = body.geometry.attributes.position, nor = body.geometry.attributes.normal, v = new THREE.Vector3();
    for (const [part, g0] of Object.entries(GUESS)) {
      const t = new THREE.Vector3(...g0); let best = 1e9, bi = 0;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(body.matrixWorld);
        if (part !== 'legs' && v.y < 0.02) continue; // not the wooden stand
        const d = v.distanceToSquared(t); if (d < best) { best = d; bi = i; }
      }
      const p = new THREE.Vector3().fromBufferAttribute(pos, bi).applyMatrix4(body.matrixWorld);
      // feathers are bumpy: average the normals within 1 cm for a steadier facing direction
      const n = new THREE.Vector3(), m = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++)
        if (v.fromBufferAttribute(pos, i).applyMatrix4(body.matrixWorld).distanceToSquared(p) < 1e-4)
          n.add(m.fromBufferAttribute(nor, i));
      n.transformDirection(body.matrixWorld);
      anchors[part] = { p: p.addScaledVector(n, 0.002), n };
      const el = document.createElement('div');
      el.className = 'pin'; el.innerHTML = '<i></i><b>' + (window.LABELS[part] || part) + '</b>';
      el.onclick = () => { select(part); post(part); };
      document.getElementById('pins').appendChild(el); pins[part] = el;
    }
    document.getElementById('load').remove();
    // open on the slow spin, with the chosen part's pin lit; the camera only flies when a part is picked
    if (window.PENDING && pins[window.PENDING]) { selected = window.PENDING; pins[selected].classList.add('on'); }
    post('ready');
  }, undefined, () => { document.getElementById('load').textContent = 'Could not load the 3D bird'; });

// Called from the app: turn to the part and light its pin.
window.select = (part) => {
  selected = part;
  for (const k in pins) pins[k].classList.toggle('on', k === part);
  const a = anchors[part]; if (!a) { window.PENDING = part; return; }
  controls.autoRotate = false;
  // look from outside the body toward the part: out from the bird's vertical axis, a little along the surface normal
  const dir = new THREE.Vector3(a.p.x, 0, a.p.z).normalize().addScaledVector(a.n, 0.6);
  dir.y = Math.max(0.1, Math.min(0.8, dir.y + 0.2));
  dir.normalize();
  fly = { pos: a.p.clone().addScaledVector(dir, 0.42), target: a.p.clone().lerp(new THREE.Vector3(0, 0.115, 0), 0.35) };
};

const tmp = new THREE.Vector3(), eye = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  if (fly) {
    camera.position.lerp(fly.pos, 0.08); controls.target.lerp(fly.target, 0.08);
    if (camera.position.distanceTo(fly.pos) < 0.002) fly = null;
  }
  controls.update();
  renderer.render(scene, camera);
  for (const k in anchors) {
    const { p, n } = anchors[k];
    const facing = eye.subVectors(camera.position, p).normalize().dot(n) > -0.05;
    tmp.copy(p).project(camera);
    const el = pins[k];
    el.style.left = ((tmp.x + 1) / 2) * innerWidth + 'px';
    el.style.top = ((1 - tmp.y) / 2) * innerHeight + 'px';
    el.classList.toggle('hid', !facing);
  }
});
// a tap (not a drag) on the bird picks the part nearest to where it landed
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!body || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8) return;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(body)[0];
  if (!hit || hit.point.y < 0.02) return;
  let best = null, bd = 0.0016; // within 4 cm
  for (const k in anchors) { const d = anchors[k].p.distanceToSquared(hit.point); if (d < bd) { bd = d; best = k; } }
  if (best) { select(best); post(best); }
});
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
</script></body></html>
`;
