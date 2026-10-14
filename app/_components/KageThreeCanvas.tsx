"use client";

import React, { useEffect, useRef } from "react";
import * as THREE from "three";

export function KageThreeCanvas({ activeChapter = 0 }: { activeChapter?: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // -------------------------------------------------------------------------
    // PROCEDURAL HELPERS & MATH
    // -------------------------------------------------------------------------
    const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const smooth = (e0: number, e1: number, x: number) => {
      const t = clamp((x - e0) / (e1 - e0), 0, 1);
      return t * t * (3 - 2 * t);
    };
    const TAU = Math.PI * 2;
    const damp = (cur: number, to: number, rate: number, dt: number) =>
      lerp(cur, to, 1 - Math.exp(-rate * dt));

    function mulberry32(a: number) {
      return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function cvs(w: number, h: number): HTMLCanvasElement {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      return c;
    }

    function fbmCanvas(
      W: number,
      H: number,
      seed: number,
      octaves = 4,
      baseCells = 3,
      contrast = 1
    ): HTMLCanvasElement {
      const out = cvs(W, H);
      const o = out.getContext("2d")!;
      o.fillStyle = "#808080";
      o.fillRect(0, 0, W, H);
      let cells = baseCells;
      let alpha = 1;
      for (let i = 0; i < octaves; i++) {
        const n = cvs(cells, cells);
        const nx = n.getContext("2d")!;
        const im = nx.createImageData(cells, cells);
        const d = im.data;
        const r = mulberry32(seed + i * 977);
        for (let k = 0; k < cells * cells; k++) {
          const v = 128 + (r() - 0.5) * 255 * contrast;
          d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = clamp(v, 0, 255);
          d[k * 4 + 3] = 255;
        }
        nx.putImageData(im, 0, 0);
        o.globalAlpha = alpha;
        o.globalCompositeOperation = i === 0 ? "source-over" : "overlay";
        o.drawImage(n, 0, 0, W, H);
        cells *= 2;
        alpha *= 0.62;
      }
      o.globalAlpha = 1;
      o.globalCompositeOperation = "source-over";
      return out;
    }

    function normalFromHeight(hc: HTMLCanvasElement, strength = 2.0): HTMLCanvasElement {
      const W = hc.width;
      const H = hc.height;
      const b = cvs(W, H);
      const bx = b.getContext("2d")!;
      bx.drawImage(hc, 0, 0);
      const src = bx.getImageData(0, 0, W, H).data;
      const out = cvs(W, H);
      const ox = out.getContext("2d")!;
      const im = ox.createImageData(W, H);
      const d = im.data;
      const at = (x: number, y: number) =>
        src[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
      const s = strength;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const gx = (at(x + 1, y) - at(x - 1, y)) * s;
          const gy = (at(x, y + 1) - at(x, y - 1)) * s;
          const nx = -gx;
          const ny = gy;
          const nz = 1;
          const il = 1 / Math.hypot(nx, ny, nz);
          const i = (y * W + x) * 4;
          d[i] = (nx * il * 0.5 + 0.5) * 255;
          d[i + 1] = (ny * il * 0.5 + 0.5) * 255;
          d[i + 2] = (nz * il * 0.5 + 0.5) * 255;
          d[i + 3] = 255;
        }
      }
      ox.putImageData(im, 0, 0);
      return out;
    }

    // -------------------------------------------------------------------------
    // TEXTURE GENERATORS
    // -------------------------------------------------------------------------
    function texWall() {
      const W = 512;
      const H = 512;
      const c = cvs(W, H);
      const x = c.getContext("2d")!;
      x.fillStyle = "#10161a";
      x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = "overlay";
      x.globalAlpha = 0.8;
      x.drawImage(fbmCanvas(W, H, 41, 4, 3, 1), 0, 0);
      x.globalAlpha = 1;
      x.globalCompositeOperation = "source-over";

      for (let i = 1; i < 6; i++) {
        const y = (H / 6) * i;
        x.fillStyle = "rgba(0,0,0,0.45)";
        x.fillRect(0, y - 1.5, W, 3);
        x.fillStyle = "rgba(190,205,205,0.05)";
        x.fillRect(0, y + 2, W, 2);
      }
      const h = cvs(W, H);
      const hx = h.getContext("2d")!;
      hx.fillStyle = "#808080";
      hx.fillRect(0, 0, W, H);
      for (let i = 1; i < 6; i++) {
        hx.fillStyle = "#2a2a2a";
        hx.fillRect(0, (H / 6) * i - 2, W, 4);
      }
      return { map: c, normal: normalFromHeight(h, 1.8) };
    }

    function texFloor() {
      const W = 512;
      const H = 512;
      const c = cvs(W, H);
      const x = c.getContext("2d")!;
      x.fillStyle = "#0a0f12";
      x.fillRect(0, 0, W, H);
      const N = 4;
      const S = W / N;
      x.strokeStyle = "rgba(0,0,0,0.72)";
      x.lineWidth = 3;
      for (let i = 0; i <= N; i++) {
        x.beginPath();
        x.moveTo(i * S, 0);
        x.lineTo(i * S, H);
        x.stroke();
        x.beginPath();
        x.moveTo(0, i * S);
        x.lineTo(W, i * S);
        x.stroke();
      }
      const h = cvs(W, H);
      const hx = h.getContext("2d")!;
      hx.fillStyle = "#8c8c8c";
      hx.fillRect(0, 0, W, H);
      hx.strokeStyle = "#303030";
      hx.lineWidth = 4;
      for (let i = 0; i <= N; i++) {
        hx.beginPath();
        hx.moveTo(i * S, 0);
        hx.lineTo(i * S, H);
        hx.stroke();
        hx.beginPath();
        hx.moveTo(0, i * S);
        hx.lineTo(W, i * S);
        hx.stroke();
      }
      return { map: c, normal: normalFromHeight(h, 1.5) };
    }

    function texWood() {
      const W = 256;
      const H = 256;
      const c = cvs(W, H);
      const x = c.getContext("2d")!;
      x.fillStyle = "#241c17";
      x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = "overlay";
      x.globalAlpha = 0.5;
      x.drawImage(fbmCanvas(W, H, 131, 4, 3, 1), 0, 0);
      x.globalAlpha = 1;
      x.globalCompositeOperation = "source-over";
      const h = cvs(W, H);
      const hx = h.getContext("2d")!;
      hx.fillStyle = "#808080";
      hx.fillRect(0, 0, W, H);
      return { map: c, normal: normalFromHeight(h, 1.5) };
    }

    function texShoji() {
      const W = 256;
      const H = 256;
      const c = cvs(W, H);
      const x = c.getContext("2d")!;
      x.fillStyle = "rgba(228,222,206,0.06)";
      x.fillRect(0, 0, W, H);
      x.strokeStyle = "rgba(10,8,7,0.88)";
      x.lineWidth = 4;
      const cols = 8;
      const rows = 6;
      for (let i = 1; i < cols; i++) {
        x.beginPath();
        x.moveTo((W / cols) * i, 0);
        x.lineTo((W / cols) * i, H);
        x.stroke();
      }
      for (let j = 1; j < rows; j++) {
        x.beginPath();
        x.moveTo(0, (H / rows) * j);
        x.lineTo(W, (H / rows) * j);
        x.stroke();
      }
      return c;
    }

    function texSky() {
      const W = 512;
      const H = 512;
      const c = cvs(W, H);
      const x = c.getContext("2d")!;
      const g = x.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "rgb(6,10,15)");
      g.addColorStop(0.34, "rgb(13,22,31)");
      g.addColorStop(0.66, "rgb(17,26,34)");
      g.addColorStop(0.88, "rgb(24,35,42)");
      g.addColorStop(1, "rgb(14,22,28)");
      x.fillStyle = g;
      x.fillRect(0, 0, W, H);

      const rnd = mulberry32(881);
      for (let i = 0; i < 280; i++) {
        const sx = rnd() * W;
        const sy = rnd() * H * 0.75;
        const r = 0.5 + rnd() * rnd() * 1.5;
        x.fillStyle = `rgba(214,232,240,${(0.15 + rnd() * 0.45) * (1 - sy / H)})`;
        x.beginPath();
        x.arc(sx, sy, r, 0, TAU);
        x.fill();
      }
      return c;
    }

    function texRidge() {
      const W = 1024;
      const H = 256;
      const c = cvs(W, H);
      const x = c.getContext("2d")!;
      const rnd = mulberry32(1207);
      x.beginPath();
      x.moveTo(0, H);
      for (let i = 0; i <= W; i += 8) {
        const t = i / W;
        const ridge = 0.45 + 0.35 * Math.sin(t * 5 + 1.2) + 0.1 * Math.sin(t * 12);
        x.lineTo(i, H - ridge * H * 0.8);
      }
      x.lineTo(W, H);
      x.closePath();
      x.fillStyle = "#050809";
      x.fill();

      for (let i = 0; i < 180; i++) {
        const px = rnd() * W;
        const t = px / W;
        const ridge = 0.45 + 0.35 * Math.sin(t * 5 + 1.2) + 0.1 * Math.sin(t * 12);
        const by = H - ridge * H * 0.8;
        const hh = 6 + rnd() * 18;
        const ww = 2 + rnd() * 4;
        x.beginPath();
        x.moveTo(px, by - hh);
        x.lineTo(px + ww, by + 2);
        x.lineTo(px - ww, by + 2);
        x.closePath();
        x.fill();
      }
      return c;
    }

    function texMoon() {
      const S = 512;
      const c = cvs(S, S);
      const x = c.getContext("2d")!;
      const R = S / 2 - 1;
      const rnd = mulberry32(91);

      x.beginPath();
      x.arc(S / 2, S / 2, R, 0, TAU);
      x.closePath();
      x.save();
      x.clip();

      const g = x.createRadialGradient(S * 0.46, S * 0.44, S * 0.05, S / 2, S / 2, R);
      g.addColorStop(0, "rgb(170,170,170)");
      g.addColorStop(0.55, "rgb(160,160,160)");
      g.addColorStop(1, "rgb(195,195,195)");
      x.fillStyle = g;
      x.fillRect(0, 0, S, S);

      // Craters & Maria
      for (let i = 0; i < 280; i++) {
        const a = rnd() * TAU;
        const rr = Math.sqrt(rnd()) * 0.95;
        const cx2 = S / 2 + Math.cos(a) * rr * R;
        const cy = S / 2 + Math.sin(a) * rr * R;
        const r = (1 + rnd() * rnd() * 14) * (S / 512);
        const lg = x.createLinearGradient(-r, -r, r, r);
        lg.addColorStop(0, "rgba(255,255,255,0.35)");
        lg.addColorStop(1, "rgba(0,0,0,0.35)");
        x.save();
        x.translate(cx2, cy);
        x.strokeStyle = lg;
        x.lineWidth = Math.max(0.8, r * 0.25);
        x.beginPath();
        x.arc(0, 0, r, 0, TAU);
        x.stroke();
        x.restore();
      }

      x.restore();
      return c;
    }

    function texGlow(inner = "rgba(255,255,255,1)", mid = "rgba(255,255,255,0.35)") {
      const S = 256;
      const c = cvs(S, S);
      const x = c.getContext("2d")!;
      const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      g.addColorStop(0, inner);
      g.addColorStop(0.28, mid);
      g.addColorStop(0.62, "rgba(255,255,255,0.07)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = g;
      x.fillRect(0, 0, S, S);
      return c;
    }

    function texLeaf() {
      const S = 128;
      const c = cvs(S, S);
      const x = c.getContext("2d")!;
      x.translate(S / 2, S * 0.92);
      x.scale(S / 2.2, -S / 2.2);
      x.beginPath();
      const lobes = 5;
      const spread = 1.9;
      for (let i = 0; i < lobes; i++) {
        const a = -spread / 2 + spread * (i / (lobes - 1)) + Math.PI / 2;
        const len = i === 2 ? 0.96 : i === 1 || i === 3 ? 0.82 : 0.6;
        x.moveTo(0, 0.02);
        x.lineTo(Math.cos(a - 0.17) * len * 0.55, Math.sin(a - 0.17) * len * 0.55);
        x.lineTo(Math.cos(a) * len, Math.sin(a) * len);
        x.lineTo(Math.cos(a + 0.17) * len * 0.55, Math.sin(a + 0.17) * len * 0.55);
        x.closePath();
      }
      x.fillStyle = "#fff";
      x.fill();
      return c;
    }

    // -------------------------------------------------------------------------
    // THREE.JS SETUP & WORLD SCENE
    // -------------------------------------------------------------------------
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050a0e, 0.0168);

    const camera = new THREE.PerspectiveCamera(
      36,
      window.innerWidth / window.innerHeight,
      0.35,
      220
    );

    // Light
    const ambLight = new THREE.AmbientLight(0x0e1820, 1.2);
    scene.add(ambLight);

    const dirLight = new THREE.DirectionalLight(0xe0231c, 1.8);
    dirLight.position.set(18, 32, -60);
    scene.add(dirLight);

    // 1. SKY & RIDGES
    const skyTex = new THREE.CanvasTexture(texSky());
    const sky = new THREE.Mesh(
      new THREE.PlaneGeometry(360, 190),
      new THREE.MeshBasicMaterial({ map: skyTex, depthWrite: false, fog: false })
    );
    sky.position.set(0, 62, -108);
    scene.add(sky);

    const ridgeTex = new THREE.CanvasTexture(texRidge());
    const ridge = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 22),
      new THREE.MeshBasicMaterial({ map: ridgeTex, transparent: true, depthWrite: false, fog: false })
    );
    ridge.position.set(0, 10, -75);
    scene.add(ridge);

    // 2. FLOOR & PODIUM
    const fT = texFloor();
    const floorMat = new THREE.MeshStandardMaterial({
      map: new THREE.CanvasTexture(fT.map),
      normalMap: new THREE.CanvasTexture(fT.normal),
      roughness: 0.74,
      metalness: 0.06,
      color: 0x69757a,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -18);
    scene.add(floor);

    // 3. SANMON TEMPLE
    const TEMPLE_Z = -44;
    const PODIUM = 7.0;
    const templeGroup = new THREE.Group();

    const wT = texWall();
    const wallMat = new THREE.MeshStandardMaterial({
      map: new THREE.CanvasTexture(wT.map),
      normalMap: new THREE.CanvasTexture(wT.normal),
      roughness: 0.78,
      color: 0x525c60,
    });

    const plat = new THREE.Mesh(new THREE.BoxGeometry(42, PODIUM, 24), wallMat);
    plat.position.set(0, PODIUM / 2, TEMPLE_Z - 1);
    templeGroup.add(plat);

    // Temple Body
    const woodT = texWood();
    const timberMat = new THREE.MeshStandardMaterial({
      map: new THREE.CanvasTexture(woodT.map),
      roughness: 0.8,
      color: 0x565150,
    });

    const core = new THREE.Mesh(new THREE.BoxGeometry(14, 5.2, 8.4), timberMat);
    core.position.set(0, PODIUM + 2.6, TEMPLE_Z);
    templeGroup.add(core);

    // Shoji Windows (Glowing)
    const shojiMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.06, 0.48, 0.18),
      fog: true,
    });
    const shojiGridMat = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(texShoji()),
      transparent: true,
      depthWrite: false,
    });
    for (let i = 0; i < 5; i++) {
      const x = -5.6 + i * 2.8;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.5), shojiMat);
      p.position.set(x, PODIUM + 2.6, TEMPLE_Z + 4.25);
      templeGroup.add(p);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.5), shojiGridMat);
      s.position.set(x, PODIUM + 2.6, TEMPLE_Z + 4.28);
      templeGroup.add(s);
    }

    // Temple Upper Storey & Flaring Roof
    const upperCore = new THREE.Mesh(new THREE.BoxGeometry(10.5, 3.8, 6.2), timberMat);
    upperCore.position.set(0, PODIUM + 9.5, TEMPLE_Z);
    templeGroup.add(upperCore);

    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x2b343a,
      roughness: 0.74,
      metalness: 0.1,
    });
    const lowerRoof = new THREE.Mesh(new THREE.BoxGeometry(18, 0.6, 12), roofMat);
    lowerRoof.position.set(0, PODIUM + 5.5, TEMPLE_Z);
    templeGroup.add(lowerRoof);

    const mainRoof = new THREE.Mesh(new THREE.BoxGeometry(20, 0.8, 14), roofMat);
    mainRoof.position.set(0, PODIUM + 11.6, TEMPLE_Z);
    templeGroup.add(mainRoof);

    scene.add(templeGroup);

    // 4. VERMILION MOON & HALO
    const moonTex = new THREE.CanvasTexture(texMoon());
    const moon = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 18),
      new THREE.MeshBasicMaterial({
        map: moonTex,
        color: new THREE.Color(3.6, 0.64, 0.61),
        transparent: true,
        depthWrite: false,
        fog: false,
      })
    );
    moon.position.set(17.9, 31.9, -72);
    scene.add(moon);

    const haloTex = new THREE.CanvasTexture(
      texGlow("rgba(255,124,112,0.9)", "rgba(206,52,48,0.26)")
    );
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(54, 54),
      new THREE.MeshBasicMaterial({
        map: haloTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        opacity: 0.5,
      })
    );
    halo.position.set(17.9, 31.9, -72.5);
    scene.add(halo);

    // 5. VERMILION TORII GATE
    const lacMat = new THREE.MeshStandardMaterial({
      color: 0xe0231c,
      roughness: 0.8,
      metalness: 0.05,
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0x7a5d2a,
      roughness: 0.5,
      metalness: 0.6,
    });
    const torii = new THREE.Group();
    [-3.2, 3.2].forEach((x) => {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 7.5, 16), lacMat);
      col.position.set(x, 3.75, 0);
      torii.add(col);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.48, 0.5, 16), goldMat);
      foot.position.set(x, 0.25, 0);
      torii.add(foot);
    });
    const nuki = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.45, 0.4), lacMat);
    nuki.position.set(0, 5.8, 0);
    torii.add(nuki);

    const kasagi = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.55, 0.55), lacMat);
    kasagi.position.set(0, 7.5, 0);
    torii.add(kasagi);

    torii.position.set(0, 0, -8.6);
    scene.add(torii);

    // 6. GLOWING STONE LANTERNS
    const lanternGlowTex = new THREE.CanvasTexture(
      texGlow("rgba(255,120,60,0.9)", "rgba(255,60,24,0.28)")
    );
    const lanternGlowMat = new THREE.MeshBasicMaterial({
      map: lanternGlowTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.6,
    });
    const lanternGroup = new THREE.Group();
    [
      [-5.5, -3.5],
      [5.5, -3.5],
      [-7.0, -12.0],
      [7.0, -12.0],
    ].forEach(([x, z]) => {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.6), wallMat);
      l.position.set(x, 0.9, z);
      lanternGroup.add(l);
      const glw = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 3.5), lanternGlowMat);
      glw.position.set(x, 1.5, z);
      lanternGroup.add(glw);
    });
    scene.add(lanternGroup);

    // 7. INSTANCED MAPLE LEAF FALL
    const leafTex = new THREE.CanvasTexture(texLeaf());
    const leafMat = new THREE.MeshStandardMaterial({
      map: leafTex,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      color: 0x40080a,
      emissive: 0x780200,
      emissiveIntensity: 0.7,
    });
    const LEAF_COUNT = 90;
    const leafInst = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.35, 0.35),
      leafMat,
      LEAF_COUNT
    );
    const rnd = mulberry32(404);
    const leaves = Array.from({ length: LEAF_COUNT }, () => ({
      x: (rnd() - 0.5) * 35,
      y: rnd() * 20 + 2,
      z: (rnd() - 0.5) * 35,
      fall: 0.6 + rnd() * 0.8,
      spin: (rnd() - 0.5) * 2.5,
      roll: rnd() * TAU,
    }));
    scene.add(leafInst);

    // -------------------------------------------------------------------------
    // CAMERA WAYPOINTS & SCROLL RIG
    // -------------------------------------------------------------------------
    const waypoints = [
      // 0: Hero
      { pos: [0, 4.2, 8.5], look: [0, 6.2, -44] },
      // 1: Gate / Sanmon
      { pos: [-2.8, 3.6, 2.2], look: [-0.5, 7.5, -44] },
      // 2: Pathways / Gardens
      { pos: [4.8, 3.2, -4.5], look: [1.2, 8.0, -44] },
      // 3: Lessons / Craft
      { pos: [-4.2, 5.0, -14.0], look: [0, 8.5, -44] },
      // 4: Eternity / Afterlight
      { pos: [1.5, 2.6, -18.5], look: [12.0, 22.0, -72] },
      // 5: Care Network
      { pos: [0, 4.5, 0], look: [0, 6.5, -44] },
    ];

    let currentPos = new THREE.Vector3(0, 4.2, 8.5);
    let currentLook = new THREE.Vector3(0, 6.2, -44);
    let targetPos = new THREE.Vector3();
    let targetLook = new THREE.Vector3();
    let mouseX = 0;
    let mouseY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
      mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("mousemove", handleMouseMove);

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    let isVoiceActive = false;
    const handleVoiceSession = (e: Event) => {
      const customEvent = e as CustomEvent<{ active?: boolean }>;
      isVoiceActive = Boolean(customEvent.detail?.active);
    };
    window.addEventListener("medvoice:voice-session-active", handleVoiceSession);

    // -------------------------------------------------------------------------
    // ANIMATION LOOP
    // -------------------------------------------------------------------------
    let animId: number;
    let lastTime = performance.now();
    const dummy = new THREE.Object3D();

    const animate = (time: number) => {
      if (document.visibilityState === "hidden" || isVoiceActive) {
        // Suspend GPU rendering during active voice consultations or hidden tabs
        animId = requestAnimationFrame(animate);
        return;
      }

      const dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      // Update Active Chapter Waypoint
      const wp = waypoints[clamp(activeChapter, 0, waypoints.length - 1)];
      targetPos.set(wp.pos[0] + mouseX * 0.8, wp.pos[1] - mouseY * 0.5, wp.pos[2]);
      targetLook.set(wp.look[0] + mouseX * 0.5, wp.look[1] - mouseY * 0.3, wp.look[2]);

      currentPos.x = damp(currentPos.x, targetPos.x, 3.5, dt);
      currentPos.y = damp(currentPos.y, targetPos.y, 3.5, dt);
      currentPos.z = damp(currentPos.z, targetPos.z, 3.5, dt);

      currentLook.x = damp(currentLook.x, targetLook.x, 3.5, dt);
      currentLook.y = damp(currentLook.y, targetLook.y, 3.5, dt);
      currentLook.z = damp(currentLook.z, targetLook.z, 3.5, dt);

      camera.position.copy(currentPos);
      camera.lookAt(currentLook);

      // Animate Falling Leaves
      leaves.forEach((leaf, i) => {
        leaf.y -= leaf.fall * dt;
        leaf.roll += leaf.spin * dt;
        if (leaf.y < 0.2) leaf.y = 18;

        dummy.position.set(leaf.x, leaf.y, leaf.z);
        dummy.rotation.set(leaf.roll, leaf.roll * 0.5, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        leafInst.setMatrixAt(i, dummy.matrix);
      });
      leafInst.instanceMatrix.needsUpdate = true;

      renderer.render(scene, camera);
      animId = requestAnimationFrame(animate);
    };

    animId = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("medvoice:voice-session-active", handleVoiceSession);
      cancelAnimationFrame(animId);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [activeChapter]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 w-full h-full pointer-events-none z-0"
      aria-hidden="true"
    />
  );
}
