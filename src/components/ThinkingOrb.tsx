import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import './ThinkingOrb.css';

interface ThinkingOrbProps {
  label?: string;
  size?: number;
}

function makeRadialTexture(inner: string, mid: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, mid);
  g.addColorStop(1, 'rgba(80, 160, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeWingTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(40, 32, 2, 40, 32, 55);
  g.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  g.addColorStop(0.5, 'rgba(170, 220, 255, 0.5)');
  g.addColorStop(1, 'rgba(120, 180, 255, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(48, 32, 52, 24, -0.35, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function ThinkingOrb({ label, size = 120 }: ThinkingOrbProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      setFailed(true);
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(size, size);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
    camera.position.z = 5.4;

    const fairy = new THREE.Group();
    scene.add(fairy);

    // núcleo brilhante (corpo da Navi)
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.52, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0x9fd4ff })
    );
    const heart = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    fairy.add(core, heart);

    // halo
    const glowTex = makeRadialTexture('rgba(255,255,255,1)', 'rgba(140,200,255,0.55)');
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      })
    );
    glow.scale.set(2.7, 2.7, 1);
    fairy.add(glow);

    // asinhas
    const wingTex = makeWingTexture();
    const wingMatL = new THREE.MeshBasicMaterial({
      map: wingTex, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const wingMatR = wingMatL.clone();
    const wingGeo = new THREE.PlaneGeometry(1.0, 0.5);
    const wingL = new THREE.Mesh(wingGeo, wingMatL);
    const wingR = new THREE.Mesh(wingGeo, wingMatR);
    wingL.position.set(-0.62, 0.22, -0.12);
    wingR.position.set(0.62, 0.22, -0.12);
    wingR.rotation.y = Math.PI;
    fairy.add(wingL, wingR);

    // poeira de fada orbitando
    const dotTex = makeRadialTexture('rgba(255,255,255,1)', 'rgba(160,215,255,0.6)');
    interface Spark { s: THREE.Sprite; r: number; speed: number; phase: number; tilt: number; base: number }
    const sparks: Spark[] = [];
    for (let i = 0; i < 26; i++) {
      const mat = new THREE.SpriteMaterial({
        map: dotTex, blending: THREE.AdditiveBlending,
        depthWrite: false, transparent: true, opacity: 0.8,
      });
      const s = new THREE.Sprite(mat);
      const base = 0.05 + Math.random() * 0.09;
      s.scale.set(base, base, 1);
      fairy.add(s);
      sparks.push({
        s,
        r: 1.05 + Math.random() * 1.0,
        speed: (0.6 + Math.random() * 1.4) * (Math.random() < 0.5 ? 1 : -1),
        phase: Math.random() * Math.PI * 2,
        tilt: 0.25 + Math.random() * 0.75,
        base,
      });
    }

    const clock = new THREE.Clock();
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      // flutuação
      fairy.position.y = Math.sin(t * 2.1) * 0.24;
      fairy.rotation.y = Math.sin(t * 0.7) * 0.35;
      fairy.rotation.z = Math.sin(t * 1.3) * 0.08;

      // pulsação do núcleo
      const pulse = 1 + Math.sin(t * 3.2) * 0.1;
      core.scale.set(pulse, pulse, pulse);
      const hs = 1 - (pulse - 1);
      heart.scale.set(hs, hs, hs);
      const gs = 2.7 + Math.sin(t * 3.2) * 0.3;
      glow.scale.set(gs, gs, 1);

      // bater de asas
      const flap = Math.sin(t * 16) * 0.5;
      wingL.rotation.y = 0.45 + flap;
      wingR.rotation.y = Math.PI - 0.45 - flap;
      wingL.position.y = 0.22 + Math.sin(t * 16) * 0.05;
      wingR.position.y = 0.22 - Math.sin(t * 16) * 0.05;

      // faíscas
      for (const p of sparks) {
        const a = p.phase + t * p.speed;
        p.s.position.set(
          Math.cos(a) * p.r,
          Math.sin(a) * p.r * p.tilt + Math.sin(t * 2 + p.phase) * 0.15,
          Math.sin(a) * 0.6 - 0.2
        );
        const tw = 0.35 + ((Math.sin(t * 4 + p.phase * 3) + 1) / 2) * 0.65;
        p.s.material.opacity = tw;
        const sc = p.base * (0.7 + tw * 0.6);
        p.s.scale.set(sc, sc, 1);
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      scene.traverse(obj => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach(m => disposeMat(m));
        else if (mat) disposeMat(mat);
      });
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [size]);

  function disposeMat(m: THREE.Material) {
    const sm = m as THREE.SpriteMaterial;
    if (sm.map) sm.map.dispose();
    m.dispose();
  }

  if (failed) {
    return (
      <div className="orb-fallback" style={{ width: size, height: size }}>
        <div className="orb-fallback-core" />
        {label && <p className="orb-label">{label}</p>}
      </div>
    );
  }

  return (
    <div className="thinking-orb" style={{ width: size }}>
      <div ref={mountRef} className="orb-canvas" style={{ width: size, height: size }} />
      {label && <p className="orb-label">{label}</p>}
    </div>
  );
}
