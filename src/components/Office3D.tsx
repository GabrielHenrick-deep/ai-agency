import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getModelFor, useChat } from '../context/ChatContext';
import { avatarEmoji, avatarGradient } from '../utils/avatar';
import {
  buildTurnMessages,
  fetchLastMeeting,
  fetchMeeting,
  fetchMeetings,
  fetchTurn,
  formatPastMeeting,
  MeetingSummary,
  PastMeeting,
  saveMeeting,
} from '../utils/meeting';
import { parseMentions } from '../utils/mention';
import { useMentions } from '../hooks/useMentions';
import { MentionPopup } from './MentionPopup';
import { parseHexColor, Visual, visualFor, YOU_CAP_COLOR } from '../utils/visuals';
import { extractCommands, extractFiles, runCommand, saveFilesToWorkspace, TASK_INSTRUCTION } from '../utils/tasks';
import './Office3D.css';

/* ============================== visuais ============================== */

const ROLE_MAP: Record<string, string> = {
  luna: 'Prompts p/ desenho',
  luisa: 'Eng. de telemetria',
  tux: 'Mascote Linux',
  linus: 'Programador sênior',
};

/* ============================== helpers ============================== */

function std(color: number, roughness = 0.85, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, ...extra });
}

function mesh<T extends THREE.BufferGeometry>(geo: T, material: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/* tela verde-fósforo do CRT */
function crtTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 190;
  const x = c.getContext('2d')!;
  x.fillStyle = '#0a120a'; x.fillRect(0, 0, 256, 190);
  x.font = 'bold 15px monospace';
  x.fillStyle = '#4dff6a';
  const lines = ['C:\\> LOTUS 1-2-3', 'Loading... OK', 'A:\\> _', 'MEM: 640K OK', 'READY.'];
  lines.forEach((l, i) => x.fillText(l, 14, 32 + i * 26));
  x.fillStyle = '#4dff6a';
  x.fillRect(14 + 8 * 15, 32 + 2 * 26 - 12, 10, 14); // cursor bloco
  // scanlines
  x.fillStyle = 'rgba(0,0,0,0.25)';
  for (let yy = 0; yy < 190; yy += 4) x.fillRect(0, yy, 256, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function kbTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 80;
  const x = c.getContext('2d')!;
  x.fillStyle = '#d9d0b8'; x.fillRect(0, 0, 256, 80);
  for (let r = 0; r < 4; r++) {
    for (let k = 0; k < 14; k++) {
      x.fillStyle = r === 0 && k < 4 ? '#d23b3b' : '#efe8d2';
      x.fillRect(8 + k * 17.5, 8 + r * 17, 15, 13);
    }
  }
  x.fillStyle = '#efe8d2';
  x.fillRect(60, 8 + 3 * 17, 120, 13); // espaço
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function paperTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 160;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f4f2ea'; x.fillRect(0, 0, 128, 160);
  x.fillStyle = '#9fd49f';
  for (let yy = 10; yy < 160; yy += 14) x.fillRect(0, yy, 128, 5);
  x.fillStyle = '#555';
  for (let yy = 18; yy < 160; yy += 22) x.fillRect(12, yy, 90, 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function nameTexture(name: string, accent: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 72;
  const x = c.getContext('2d')!;
  // chip branco arredondado, estilo "crachá flutuante"
  const r = 18;
  x.fillStyle = 'rgba(255,255,255,0.96)';
  x.beginPath();
  x.moveTo(r, 4);
  x.lineTo(252 - r, 4); x.arcTo(252, 4, 252, r, r);
  x.lineTo(252, 68 - r); x.arcTo(252, 68, 252 - r, 68, r);
  x.lineTo(r, 68); x.arcTo(4, 68, 4, 68 - r, r);
  x.lineTo(4, r); x.arcTo(4, 4, r, 4, r);
  x.closePath(); x.fill();
  // bolinha na cor do agente
  x.fillStyle = accent;
  x.beginPath(); x.arc(30, 36, 9, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#2b2f36';
  x.font = 'bold 30px sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(name.slice(0, 12), 138, 38);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* plaquinha flutuante: pill escura com estrela, igual à referência */
function tagTexture(name: string, _accent: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 72;
  const x = c.getContext('2d')!;
  const r = 30;
  x.fillStyle = 'rgba(18,20,24,0.94)';
  x.beginPath();
  x.moveTo(r, 6);
  x.lineTo(250 - r, 6); x.arcTo(250, 6, 250, 6 + r, r);
  x.lineTo(250, 66 - r); x.arcTo(250, 66, 250 - r, 66, r);
  x.lineTo(r, 66); x.arcTo(6, 66, 6, 66 - r, r);
  x.lineTo(6, 6 + r); x.arcTo(6, 6, r, 6, r);
  x.closePath(); x.fill();
  x.fillStyle = '#ffd166';
  x.font = '24px sans-serif';
  x.textAlign = 'left'; x.textBaseline = 'middle';
  x.fillText('★', 16, 39);
  x.fillStyle = '#f4f4f6';
  x.font = 'bold 22px sans-serif';
  // comporta nomes longos estilo "Personalidade: Luna"
  x.fillText(name.slice(0, 20), 46, 39);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function dayTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 0, 160);
  g.addColorStop(0, '#7ec8f7'); g.addColorStop(1, '#d8f0ff');
  x.fillStyle = g; x.fillRect(0, 0, 256, 160);
  x.fillStyle = '#ffd93b';
  x.beginPath(); x.arc(52, 40, 20, 0, Math.PI * 2); x.fill();
  x.fillStyle = 'rgba(255, 217, 59, 0.35)';
  x.beginPath(); x.arc(52, 40, 30, 0, Math.PI * 2); x.fill();
  x.fillStyle = 'rgba(255,255,255,0.95)';
  const cloud = (cx: number, cy: number, s: number) => {
    x.beginPath();
    x.arc(cx, cy, 12 * s, 0, Math.PI * 2);
    x.arc(cx + 14 * s, cy - 5 * s, 10 * s, 0, Math.PI * 2);
    x.arc(cx + 28 * s, cy, 11 * s, 0, Math.PI * 2);
    x.fill();
  };
  cloud(140, 40, 1); cloud(210, 70, 0.8); cloud(90, 80, 0.7);
  x.fillStyle = '#a9c3d9';
  for (let b = 0; b < 8; b++) {
    const w = 20 + ((b * 53) % 20), h = 34 + ((b * 37) % 44);
    const bx = b * 32;
    x.fillRect(bx, 160 - h, w, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ============================== quadros dinâmicos ============================== */

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; }
    else line = t;
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.length > 0 && lines.join(' ').length < text.length - 3) {
    lines[lines.length - 1] += '…';
  }
  return lines;
}

function drawQuestionBoard(canvas: HTMLCanvasElement, question: string, agentName: string) {
  const x = canvas.getContext('2d')!;
  x.fillStyle = '#20242e'; x.fillRect(0, 0, 512, 320);
  x.fillStyle = '#8b5cf6'; x.fillRect(0, 0, 512, 64);
  x.fillStyle = '#ffffff';
  x.font = 'bold 30px sans-serif'; x.textAlign = 'left'; x.textBaseline = 'middle';
  x.fillText('💬 ÚLTIMA PERGUNTA', 24, 34);
  x.font = '26px sans-serif'; x.fillStyle = '#ececec';
  const q = question.trim() || '— nenhuma pergunta ainda —';
  wrapLines(x, q, 464, 6).forEach((l, i) => x.fillText(l, 24, 108 + i * 32));
  x.font = 'italic 22px sans-serif'; x.fillStyle = '#9a9aa5';
  if (agentName) x.fillText(`para ${agentName}`, 24, 296);
}

function drawStatusBoard(canvas: HTMLCanvasElement, s: { model: string; msgs: number; chats: number; agents: number }) {
  const x = canvas.getContext('2d')!;
  x.fillStyle = '#20242e'; x.fillRect(0, 0, 512, 320);
  x.fillStyle = '#0f766e'; x.fillRect(0, 0, 512, 64);
  x.fillStyle = '#ffffff';
  x.font = 'bold 30px sans-serif'; x.textAlign = 'left'; x.textBaseline = 'middle';
  x.fillText('📊 PAINEL', 24, 34);
  const rows: [string, string][] = [
    ['MODELO', s.model],
    ['MENSAGENS', String(s.msgs)],
    ['CONVERSAS', String(s.chats)],
    ['AGENTES', String(s.agents)],
  ];
  rows.forEach(([k, v], i) => {
    const y = 112 + i * 50;
    x.font = '22px sans-serif'; x.fillStyle = '#9a9aa5';
    x.fillText(k, 24, y);
    x.font = 'bold 26px sans-serif'; x.fillStyle = '#ececec';
    x.fillText(v.slice(0, 24), 230, y);
  });
}

/* ============================== bonecos cartoon ============================== */

interface FaceRefs {
  /** grupos dos olhos (p/ piscar via scale.y) */
  eyes: THREE.Object3D[];
  /** grupo da boca inteira */
  mouth: THREE.Object3D;
  /** parte que "abre" ao falar (interior da boca ou o próprio bico) */
  maw: THREE.Object3D;
}

interface LegRefs {
  hipL: THREE.Object3D;
  hipR: THREE.Object3D;
  kneeL: THREE.Object3D;
  kneeR: THREE.Object3D;
}

/* entrada do terminal: comando sugerido pelo agente + resultado da execução */
interface TermEntry {
  id: string;
  cmd: string;
  status: 'pending' | 'running' | 'done' | 'error';
  output?: string;
  code?: number;
}

interface Actor {
  id: string;
  group: THREE.Group;
  head: THREE.Object3D;
  torso: THREE.Object3D;
  foreL: THREE.Object3D;
  foreR: THREE.Object3D;
  face: FaceRefs;
  legs: LegRefs | null;
  ring: THREE.Mesh | null;
  carriedMug: THREE.Object3D | null;
  penguin: boolean;
  /** y base do grupo quando sentado na cadeira */
  sitBase: number;
  /** 1 = sentado (pernas dobradas), 0 = em pé andando */
  sitPose: number;
  baseYaw: number;
  wanderT: number;
  wanderTarget: number;
  blinkT: number;
  talkT: number;
  phase: number;
}

type Built = {
  group: THREE.Group;
  refs: Pick<Actor, 'head' | 'torso' | 'foreL' | 'foreR' | 'face' | 'legs'>;
};

/* rosto minimalista: dois pontinhos de olho + boquinha que abre ao falar */
function simpleFace(head: THREE.Group): FaceRefs {
  const eyeM = std(0x1c1c22, 0.35);
  const eyes: THREE.Object3D[] = [];
  [-1, 1].forEach(side => {
    const eye = new THREE.Group();
    eye.position.set(0.115 * side, 0.03, 0.295);
    eye.add(mesh(new THREE.SphereGeometry(0.034, 10, 10), eyeM));
    head.add(eye);
    eyes.push(eye);
  });
  const mouth = new THREE.Group();
  mouth.position.set(0, -0.1, 0.305);
  const maw = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 10), std(0x5a2420, 0.5));
  maw.scale.set(1, 0.15, 0.55);
  mouth.add(maw);
  head.add(mouth);
  return { eyes, mouth, maw };
}

function createHuman(v: Visual, opts?: { cap?: number }): Built {
  const g = new THREE.Group();
  const skin = std(v.skin, 0.55);
  const shirtM = std(v.shirt, 0.85);
  const hairM = std(v.hair, 0.5);
  // PERNAS articuladas em 2 segmentos: coxa + canela com o sapato grudado nela
  // (pivôs no quadril e no joelho — ele dobra as pernas de verdade ao sentar
  // e balança coxa/canela separado quando caminha). Em pé, a sola toca o chão.
  const pantsM = std(v.pants, 0.9);
  const shoeM = std(0x1c1c22, 0.55);
  const mkLeg = (side: 1 | -1) => {
    const hip = new THREE.Group();
    hip.position.set(0.12 * side, 0.5, 0);
    // coxa entra no quadril/toquinho da calça
    hip.add(mesh(new THREE.CapsuleGeometry(0.085, 0.16, 4, 12), pantsM, 0, -0.11, 0));
    const knee = new THREE.Group();
    knee.position.set(0, -0.22, 0);
    // canela mais fina que a coxa
    knee.add(mesh(new THREE.CapsuleGeometry(0.072, 0.14, 4, 12), pantsM, 0, -0.1, 0));
    // sapato oval encaixado no fim da canela, sola encostando no chão (y = 0)
    const shoe = mesh(new THREE.SphereGeometry(0.105, 14, 14), shoeM, 0, -0.225, 0.05);
    shoe.scale.set(0.95, 0.55, 1.4);
    knee.add(shoe);
    hip.add(knee);
    g.add(hip);
    return { hip, knee };
  };
  const legL = mkLeg(-1);
  const legR = mkLeg(1);
  const legs = { hipL: legL.hip, hipR: legR.hip, kneeL: legL.knee, kneeR: legR.knee };

  // CAMISETA lisa: corpinho em cápsula, sem gravata nem blazer
  const torso = mesh(new THREE.CapsuleGeometry(0.25, 0.32, 6, 18), shirtM, 0, 0.8, 0);
  torso.scale.set(1.08, 1, 0.72);
  g.add(torso);
  // barriguinha da camiseta caindo sobre a cintura da calça (cintura fina)
  g.add(mesh(new THREE.CylinderGeometry(0.225, 0.24, 0.1, 18), shirtM, 0, 0.52, 0));

  // BRAÇOS caídos (como na folha de referência): ombro-manga + antebraço pele + mãozinha
  const mkArm = (side: 1 | -1) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.27 * side, 1.04, 0);
    shoulder.add(mesh(new THREE.SphereGeometry(0.085, 12, 12), shirtM, 0, 0.02, 0));
    shoulder.add(mesh(new THREE.CapsuleGeometry(0.055, 0.2, 4, 10), skin, 0, -0.16, 0));
    shoulder.add(mesh(new THREE.SphereGeometry(0.075, 12, 12), skin, 0, -0.31, 0));
    g.add(shoulder);
    return shoulder;
  };
  const foreL = mkArm(-1);
  const foreR = mkArm(1);

  // CABEÇÃO liso
  const head = new THREE.Group();
  head.position.set(0, 1.5, 0);
  head.add(mesh(new THREE.SphereGeometry(0.33, 28, 28), skin));
  const face = simpleFace(head);

  // orelhinhas
  [-1, 1].forEach(side => {
    const ear = mesh(new THREE.SphereGeometry(0.075, 10, 10), skin, 0.315 * side, -0.01, -0.02);
    ear.scale.set(0.5, 0.8, 0.8);
    head.add(ear);
  });

  // cabelo-capacete cobrindo topo e nuca + franja volumosa na testa
  head.add(mesh(new THREE.SphereGeometry(0.35, 26, 26), hairM, 0, 0.09, -0.08));
  const fringe = mesh(new THREE.SphereGeometry(0.24, 18, 18), hairM, 0, 0.18, 0.16);
  fringe.scale.set(1.05, 0.5, 0.6);
  head.add(fringe);

  if (v.hairStyle === 'long') {
    const back = mesh(new THREE.SphereGeometry(0.24, 16, 16), hairM, 0, -0.3, -0.26);
    back.scale.set(1.1, 1.5, 0.8);
    head.add(back);
    head.add(mesh(new THREE.SphereGeometry(0.1, 12, 12), hairM, -0.27, -0.26, -0.12));
    head.add(mesh(new THREE.SphereGeometry(0.1, 12, 12), hairM, 0.27, -0.26, -0.12));
  } else if (v.hairStyle === 'ponytail') {
    const tail = mesh(new THREE.SphereGeometry(0.12, 14, 14), hairM, 0, -0.12, -0.4);
    tail.scale.set(1, 1.7, 1);
    head.add(tail);
    head.add(mesh(new THREE.TorusGeometry(0.1, 0.03, 8, 16), std(v.tie, 0.6), 0, 0.1, -0.33));
  }
  // boné (pro dono do escritório)
  if (opts?.cap !== undefined) {
    const capMat = std(opts.cap, 0.7);
    head.add(mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.12, 20), capMat, 0, 0.32, -0.02));
    head.add(mesh(new THREE.SphereGeometry(0.06, 10, 10), capMat, 0, 0.4, -0.02));
    const brim = mesh(new THREE.BoxGeometry(0.3, 0.045, 0.24), capMat, 0, 0.29, 0.33);
    brim.rotation.x = -0.08;
    head.add(brim);
  }
  g.add(head);

  return { group: g, refs: { head, torso, foreL, foreR, face, legs } };
}

function createPenguin(_v: Visual): Built {
  const g = new THREE.Group();
  const black = std(0x141419, 0.55);   // preto azulado, leve brilho de pena
  const white = std(0xf6f8fa, 0.65);
  const orange = std(0xf0932b, 0.5);

  // CORPO em "ovo": barrigudo embaixo, afinando no peito
  const body = mesh(new THREE.SphereGeometry(0.42, 32, 32), black, 0, 0.62, 0);
  body.scale.set(1, 1.22, 0.95);
  g.add(body);

  // BARRIGA branca subindo até o peito
  const belly = mesh(new THREE.SphereGeometry(0.34, 26, 26), white, 0, 0.58, 0.28);
  belly.scale.set(0.8, 1.05, 0.5);
  g.add(belly);

  // rabichinho atrás
  const tail = mesh(new THREE.SphereGeometry(0.14, 14, 14), black, 0, 0.42, -0.36);
  tail.scale.set(0.8, 0.6, 0.7);
  g.add(tail);

  // PÉS com dedinhos (palminha oval + 3 dedos na frente)
  [-1, 1].forEach(side => {
    const foot = new THREE.Group();
    foot.position.set(0.13 * side, 0.045, 0.14);
    const palm = mesh(new THREE.SphereGeometry(0.13, 16, 16), orange);
    palm.scale.set(0.9, 0.35, 1.45);
    foot.add(palm);
    [-0.06, 0, 0.06].forEach(tx => {
      const toe = mesh(new THREE.SphereGeometry(0.038, 10, 10), orange, tx + 0, -0.005, 0.185);
      toe.scale.set(1, 0.6, 1.25);
      foot.add(toe);
    });
    g.add(foot);
  });

  // CABEÇA: continuando o ovo do corpo, com máscara branca no rosto
  const head = new THREE.Group();
  head.position.set(0, 1.28, 0.02);
  const skull = mesh(new THREE.SphereGeometry(0.3, 30, 30), black);
  skull.scale.set(1, 0.95, 0.92);
  head.add(skull);
  const mask = mesh(new THREE.SphereGeometry(0.24, 24, 24), white, 0, -0.03, 0.16);
  mask.scale.set(1.05, 0.85, 0.55);
  head.add(mask);

  // rosto minimalista: só olhos (sem boca nem blush) — Tux fala bicando
  const eyeWhiteM = std(0xffffff, 0.3);
  const pupM = std(0x14161c, 0.3);
  const hlM = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eyes: THREE.Object3D[] = [];
  [-1, 1].forEach(side => {
    const eye = new THREE.Group();
    eye.position.set(0.11 * side, 0.05, 0.30);
    eye.add(mesh(new THREE.SphereGeometry(0.058, 14, 14), eyeWhiteM));
    eye.add(mesh(new THREE.SphereGeometry(0.026, 10, 10), pupM, 0, 0, 0.043));
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 8), hlM);
    hl.position.set(-0.011, 0.013, 0.062);
    eye.add(hl);
    head.add(eye);
    eyes.push(eye);
  });

  // BICO ÚNICO: um cone só (sem boca por baixo); ao falar o bico inteiro "bica" rapidinho
  const beakG = new THREE.Group();
  beakG.position.set(0, -0.07, 0.31);
  const beak = mesh(new THREE.ConeGeometry(0.07, 0.16, 14), orange);
  beak.rotation.x = Math.PI / 2 + 0.12;
  beak.position.z = 0.05;
  beak.scale.set(1, 1, 0.8); // achatadinho, mais "pinguim"
  beakG.add(beak);
  head.add(beakG);
  const face: FaceRefs = { eyes, mouth: beakG, maw: beakG };

  // FEDORA 🎩 (aba larga + copa com faixa), levemente inclinado pra ficar estiloso
  const hat = new THREE.Group();
  hat.position.set(0.02, 0.27, 0.01);
  hat.rotation.z = 0.12;
  hat.rotation.x = -0.08;
  const hatM = std(0x39312a, 0.75);
  hat.add(mesh(new THREE.CylinderGeometry(0.29, 0.3, 0.025, 24), hatM, 0, 0, 0)); // aba
  hat.add(mesh(new THREE.CylinderGeometry(0.155, 0.185, 0.17, 20), hatM, 0, 0.095, 0)); // copa
  // faixinha da copa
  hat.add(mesh(new THREE.CylinderGeometry(0.19, 0.195, 0.035, 20), std(0x14161c, 0.6), 0, 0.028, 0));
  head.add(hat);

  g.add(head);

  // BRAÇOS iguais aos dos humanos: ombro + braço + mãozinha (pretinhos, de pena)
  const mkArm = (side: 1 | -1) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.36 * side, 1.0, 0.02);
    shoulder.add(mesh(new THREE.SphereGeometry(0.09, 12, 12), black, 0, 0, 0));
    const arm = mesh(new THREE.CapsuleGeometry(0.07, 0.26, 4, 12), black, 0, -0.17, 0);
    arm.rotation.z = -0.1 * side;
    shoulder.add(arm);
    shoulder.add(mesh(new THREE.SphereGeometry(0.075, 12, 12), black, 0, -0.34, 0.01));
    g.add(shoulder);
    return shoulder;
  };
  const foreL = mkArm(-1);
  const foreR = mkArm(1);

  return { group: g, refs: { head, torso: body, foreL, foreR, face, legs: null } };
}

/* ============================== móveis anos 80 ============================== */

function createChair() {
  const chair = new THREE.Group();
  const cushion = std(0x2f3a2e, 0.95);
  const frame = std(0x23262b, 0.55, { metalness: 0.35 });
  // assento acolchoado (caixa com leve "arredondamento" via segunda camada)
  chair.add(mesh(new THREE.BoxGeometry(0.56, 0.09, 0.52), cushion, 0, 0.5, 0));
  chair.add(mesh(new THREE.BoxGeometry(0.6, 0.03, 0.56), frame, 0, 0.45, 0));
  // encosto com almofada + carcaça
  const back = new THREE.Group();
  back.position.set(0, 0.55, -0.25);
  back.rotation.x = 0.07;
  back.add(mesh(new THREE.BoxGeometry(0.5, 0.5, 0.09), cushion, 0, 0.35, 0));
  back.add(mesh(new THREE.BoxGeometry(0.54, 0.08, 0.1), frame, 0, 0.06, 0));
  chair.add(back);
  // braços com almofadinha
  [-1, 1].forEach(side => {
    chair.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 8), frame, 0.27 * side, 0.62, -0.02));
    chair.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 8), frame, 0.27 * side, 0.62, 0.14));
    chair.add(mesh(new THREE.BoxGeometry(0.09, 0.035, 0.3), cushion, 0.27 * side, 0.735, 0.06));
  });
  // coluna + base estrela com rodinhas
  chair.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.34, 12), frame, 0, 0.27, 0));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const spoke = mesh(new THREE.BoxGeometry(0.3, 0.035, 0.055), frame, Math.cos(a) * 0.15, 0.06, Math.sin(a) * 0.15);
    spoke.rotation.y = -a;
    chair.add(spoke);
    chair.add(mesh(new THREE.SphereGeometry(0.04, 10, 10), frame, Math.cos(a) * 0.29, 0.045, Math.sin(a) * 0.29));
  }
  return chair;
}

/* cubículo individual: tampo claro + painéis verde-escuro (estilo da referência) */
function createCubicle(): THREE.Group {
  const g = new THREE.Group();
  const panel = std(0x2f3a2e, 0.9);
  const topM = std(0xe7e2d4, 0.85);
  // tampo claro (mais estreito/curto que os painéis p/ não vazar nas bordas)
  g.add(mesh(new THREE.BoxGeometry(1.62, 0.07, 1.08), topM, 0, 0.915, 0.7));
  // painel de fundo (atrás do monitor)
  g.add(mesh(new THREE.BoxGeometry(1.75, 1.15, 0.06), panel, 0, 0.575, 1.35));
  // painéis laterais
  [-0.845, 0.845].forEach(px => {
    g.add(mesh(new THREE.BoxGeometry(0.06, 1.15, 1.25), panel, px, 0.575, 0.72));
  });
  // rodapé frontal
  g.add(mesh(new THREE.BoxGeometry(1.62, 0.12, 0.05), panel, 0, 0.06, 0.16));
  return g;
}

/* pendente de teto preto (cone) com luz quente */
function createPendant(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.014, 0.014, 3.1, 6), std(0x23262b, 0.6), 0, 4.9, 0));
  const shade = mesh(new THREE.ConeGeometry(0.4, 0.45, 24, 1, true), std(0x23262b, 0.6, { side: THREE.DoubleSide }), 0, 3.3, 0);
  g.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), new THREE.MeshBasicMaterial({ color: 0xfff1cf }));
  bulb.position.set(0, 3.22, 0);
  g.add(bulb);
  const pl = new THREE.PointLight(0xffe9c4, 10, 8, 1.6);
  pl.position.set(0, 3.0, 0);
  g.add(pl);
  return g;
}

/* mesa redonda de reunião + cadeiras ao redor */
function createMeetingTable(chairs = 4): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.06, 28), std(0xe7e2d4, 0.8), 0, 0.72, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.7, 12), std(0x2f3a2e, 0.8), 0, 0.35, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.05, 20), std(0x2f3a2e, 0.8), 0, 0.03, 0));
  // papel e canetinha em cima
  g.add(mesh(new THREE.BoxGeometry(0.22, 0.01, 0.3), std(0xffffff, 0.9), 0.2, 0.76, 0.1));
  const pen = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6), std(0x23262b, 0.5), 0.28, 0.77, -0.05);
  pen.rotation.z = Math.PI / 2;
  pen.rotation.y = 0.5;
  g.add(pen);
  for (let i = 0; i < chairs; i++) {
    const a = (i / chairs) * Math.PI * 2 + 0.4;
    const c = createChair();
    c.position.set(Math.cos(a) * 1.45, 0, Math.sin(a) * 1.45);
    c.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a));
    g.add(c);
  }
  return g;
}

/* monitor CRT trambolho bege, detalhado e LIGADO */
function createCRT(): THREE.Group {
  const g = new THREE.Group();
  const beige = std(0xd9d0b8, 0.8);
  const darkBeige = std(0xb8ad90, 0.85);
  g.add(mesh(new THREE.BoxGeometry(0.44, 0.07, 0.44), darkBeige, 0, 0.035, 0)); // base
  const body = mesh(new THREE.BoxGeometry(0.62, 0.5, 0.58), beige, 0, 0.36, -0.04);
  g.add(body);
  // "bunda" traseira do tubo de raios catódicos (mais compacta)
  const butt = mesh(new THREE.BoxGeometry(0.4, 0.3, 0.18), darkBeige, 0, 0.34, -0.38);
  g.add(butt);
  g.add(mesh(new THREE.BoxGeometry(0.2, 0.08, 0.08), darkBeige, 0, 0.28, -0.49));
  // cabo saindo da traseira
  const cable = mesh(new THREE.TorusGeometry(0.1, 0.018, 8, 16, Math.PI * 1.2), std(0x3a3a3a, 0.7), 0.12, 0.2, -0.5);
  cable.rotation.z = -0.6;
  g.add(cable);
  // aletas de ventilação no topo
  for (let i = 0; i < 6; i++) {
    g.add(mesh(new THREE.BoxGeometry(0.4, 0.012, 0.05), std(0xa89d82, 0.9), 0, 0.615, 0.14 - i * 0.09));
  }
  // moldura + tela curva verde-fósforo
  g.add(mesh(new THREE.BoxGeometry(0.54, 0.4, 0.05), std(0x2a2a26, 0.7), 0, 0.38, 0.24));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.31), new THREE.MeshBasicMaterial({ map: crtTexture() }));
  screen.position.set(0, 0.38, 0.268);
  g.add(screen);
  // GLOW da tela ligada (sprite suave na frente)
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: 0x8dffab, transparent: true, opacity: 0.3,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  glow.position.set(0, 0.38, 0.3);
  glow.scale.set(0.75, 0.55, 1);
  g.add(glow);
  // botõezinhos + LED de energia ligado
  [-0.12, -0.04].forEach(bx => {
    const knob = mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 10), std(0x4a4438, 0.6), bx, 0.12, 0.26);
    knob.rotation.x = Math.PI / 2;
    g.add(knob);
  });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), new THREE.MeshBasicMaterial({ color: 0x51ff7a }));
  led.position.set(0.12, 0.12, 0.263);
  g.add(led);
  const ledGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: 0x51ff7a, transparent: true, opacity: 0.8,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  ledGlow.position.set(0.12, 0.12, 0.28);
  ledGlow.scale.set(0.09, 0.09, 1);
  g.add(ledGlow);
  // badge da marca
  g.add(mesh(new THREE.BoxGeometry(0.12, 0.03, 0.012), std(0x3a5a8c, 0.6), 0, 0.615, 0.245));
  // post-its na lateral do trambolho
  [[0xffd93b, 0.2], [0xff9ecb, 0.1]].forEach(([cc, dy], i) => {
    const st = new THREE.Mesh(
      new THREE.PlaneGeometry(0.08, 0.08),
      new THREE.MeshBasicMaterial({ color: cc as number, side: THREE.DoubleSide })
    );
    st.position.set(0.315, (dy as number) + 0.3, 0.1 + i * 0.08);
    st.rotation.y = Math.PI / 2;
    st.rotation.z = (i - 0.5) * 0.2;
    g.add(st);
  });
  return g;
}

function createKeyboard80s(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.64, 0.06, 0.24), std(0xd9d0b8, 0.85), 0, 0.03, 0));
  const keys = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.18), new THREE.MeshBasicMaterial({ map: kbTexture() }));
  keys.rotation.x = -Math.PI / 2;
  keys.position.set(0, 0.062, 0);
  g.add(keys);
  return g;
}

function createPlate(name: string, accent: string) {
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.03), std(0x4a3626, 0.85));
  plate.castShadow = true;
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.46, 0.12),
    new THREE.MeshBasicMaterial({ map: nameTexture(name, accent) })
  );
  label.position.set(0, 0.005, 0.017);
  plate.add(label);
  return plate;
}

/* anel de destaque embaixo do personagem (selecionado / falando) */
function createRing(accent: string): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.032, 10, 40),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(accent), transparent: true, opacity: 0.85 })
  );
  m.rotation.x = Math.PI / 2;
  m.visible = false;
  return m;
}

/* etiqueta de nome flutuando acima da cabeça (pill escura com ★) */
function createNameTag(name: string, accent: string): THREE.Sprite {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tagTexture(name, accent),
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  }));
  sp.scale.set(0.9, 0.25, 1);
  return sp;
}

function createRotaryPhone(): THREE.Group {
  const g = new THREE.Group();
  const cream = std(0xe8ddc2, 0.7);
  g.add(mesh(new THREE.BoxGeometry(0.3, 0.09, 0.24), cream, 0, 0.045, 0));
  const dial = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 18), std(0xf6f2e4, 0.6), 0, 0.1, 0.04);
  g.add(dial);
  g.add(mesh(new THREE.BoxGeometry(0.3, 0.05, 0.08), cream, 0, 0.12, -0.06));
  return g;
}

function createPrinter(): THREE.Group {
  const g = new THREE.Group();
  const beige = std(0xd9d0b8, 0.85);
  g.add(mesh(new THREE.BoxGeometry(0.95, 0.3, 0.6), beige, 0, 0.62, 0));
  g.add(mesh(new THREE.BoxGeometry(0.7, 0.06, 0.4), std(0x2a2a26, 0.7), 0, 0.78, 0));
  // folha contínua saindo
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.55), new THREE.MeshBasicMaterial({ map: paperTexture(), side: THREE.DoubleSide }));
  paper.position.set(0, 1.0, -0.28);
  paper.rotation.x = 0.35;
  g.add(paper);
  // mesinha
  g.add(mesh(new THREE.BoxGeometry(1.2, 0.07, 0.8), std(0x2f3a2e, 0.9), 0, 0.44, 0));
  [[-0.5, -0.3], [0.5, -0.3], [-0.5, 0.3], [0.5, 0.3]].forEach(([x, z]) => {
    g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.42, 10), std(0x23262b, 0.7), x, 0.21, z));
  });
  return g;
}

function createCoffeeCorner(scene: THREE.Scene, steam: THREE.Sprite[]) {
  const corner = new THREE.Group();
  corner.position.set(6.4, 0, -3.3);
  corner.rotation.y = -0.35;

  corner.add(mesh(new THREE.BoxGeometry(1.9, 0.9, 0.7), std(0x2f3a2e, 0.9), 0, 0.45, 0));
  corner.add(mesh(new THREE.BoxGeometry(2.0, 0.06, 0.8), std(0xe7e2d4, 0.85), 0, 0.93, 0));

  const machine = new THREE.Group();
  machine.position.set(-0.35, 0.96, 0);
  machine.add(mesh(new THREE.BoxGeometry(0.52, 0.62, 0.45), std(0xc23a2e, 0.55), 0, 0.31, 0));
  machine.add(mesh(new THREE.BoxGeometry(0.44, 0.3, 0.03), std(0x1c1f26, 0.5), 0, 0.36, 0.22));
  machine.add(mesh(new THREE.BoxGeometry(0.1, 0.08, 0.06), std(0x2b2f36), -0.12, 0.14, 0.2));
  const jar = mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.16, 14), std(0x6b3d1f, 0.3, { transparent: true, opacity: 0.85 }), 0.02, 0.08, 0.12);
  machine.add(jar);
  machine.add(mesh(new THREE.BoxGeometry(0.3, 0.04, 0.3), std(0x1c1f26), 0, 0.02, 0.05));
  const lampMat = new THREE.MeshBasicMaterial({ color: 0x51ff7a });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), lampMat);
  lamp.position.set(0.16, 0.52, 0.22);
  machine.add(lamp);
  corner.add(machine);
  corner.userData.blink = lampMat;

  const mugCols = [0xd23b3b, 0x2f6fed, 0x2f9e44, 0xe8932e];
  mugCols.forEach((cc, i) => {
    corner.add(mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.11, 12), std(cc, 0.6), 0.35 + i * 0.16, 1.02, -0.1));
  });

  const steamTex = glowTexture();
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: steamTex, transparent: true, opacity: 0.35, depthWrite: false,
    }));
    s.position.set(-0.33 + (Math.random() - 0.5) * 0.1, 1.25, 0.12);
    s.scale.set(0.18, 0.18, 1);
    corner.add(s);
    steam.push(s);
    s.userData.phase = Math.random();
  }

  [-0.7, 0.7].forEach(x => {
    corner.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 16), std(0x2f3a2e, 0.9), x, 0.55, 1.1));
    corner.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 10), std(0x23262b, 0.6), x, 0.28, 1.1));
  });

  scene.add(corner);
  return corner;
}

/* piso verde-pastel com sardas sutis (textura repetida) */
function carpetTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#98b884'; x.fillRect(0, 0, 128, 128);
  x.fillStyle = 'rgba(70,95,58,0.16)';
  for (let i = 0; i < 110; i++) {
    const px = (i * 53 + 17) % 128, py = (i * 89 + 31) % 128;
    x.fillRect(px, py, 2, 2);
  }
  x.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 40; i++) {
    const px = (i * 71 + 9) % 128, py = (i * 37 + 23) % 128;
    x.fillRect(px, py, 3, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 6);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* calendário de parede com a data real */
function createCalendar(): THREE.Group {
  const c = document.createElement('canvas');
  c.width = 192; c.height = 240;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f6f2e8'; x.fillRect(0, 0, 192, 240);
  x.fillStyle = '#d23b3b'; x.fillRect(0, 0, 192, 56);
  const now = new Date();
  const month = now.toLocaleDateString('pt-BR', { month: 'long' });
  x.fillStyle = '#fff'; x.font = 'bold 26px sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(month.toUpperCase(), 96, 30);
  x.fillStyle = '#1c1c22'; x.font = 'bold 86px sans-serif';
  x.fillText(String(now.getDate()), 96, 136);
  x.fillStyle = '#7a7a85'; x.font = '20px sans-serif';
  x.fillText(now.toLocaleDateString('pt-BR', { weekday: 'long' }), 96, 202);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;

  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.7, 0.92, 0.05), std(0x6b4a2e, 0.85)));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.82), new THREE.MeshBasicMaterial({ map: tex }));
  face.position.z = 0.028;
  g.add(face);
  // espiralzinha no topo
  for (let i = 0; i < 5; i++) {
    g.add(mesh(new THREE.TorusGeometry(0.028, 0.008, 6, 12), std(0x9a9a9a, 0.4, { metalness: 0.7 }), -0.2 + i * 0.1, 0.47, 0));
  }
  return g;
}

/* estante de livros coloridos */
function createBookshelf(): THREE.Group {
  const g = new THREE.Group();
  const wood = std(0x2f3a2e, 0.9);
  const W = 1.5, H = 2.0, D = 0.42;
  g.add(mesh(new THREE.BoxGeometry(W, H, 0.05), wood, 0, H / 2, -D / 2 + 0.03));
  g.add(mesh(new THREE.BoxGeometry(0.06, H, D), wood, -W / 2 + 0.03, H / 2, 0));
  g.add(mesh(new THREE.BoxGeometry(0.06, H, D), wood, W / 2 - 0.03, H / 2, 0));
  g.add(mesh(new THREE.BoxGeometry(W, 0.06, D), wood, 0, H - 0.03, 0));
  g.add(mesh(new THREE.BoxGeometry(W, 0.06, D), wood, 0, 0.03, 0));
  const bookCols = [0xd23b3b, 0x2f6fed, 0x2f9e44, 0xe8a91c, 0x8b5cf6, 0x22d3ee, 0xf49ac1, 0xefe8d2];
  [0.42, 0.85, 1.28, 1.71].forEach((sy, shelf) => {
    g.add(mesh(new THREE.BoxGeometry(W - 0.1, 0.04, D), wood, 0, sy - 0.21, 0));
    let bx = -W / 2 + 0.1;
    let k = 0;
    while (bx < W / 2 - 0.18) {
      const bw = 0.045 + ((shelf * 7 + k * 13) % 4) * 0.012;
      const bh = 0.26 + ((shelf * 5 + k * 11) % 3) * 0.035;
      const tilt = ((shelf + k) % 9 === 0) ? 0.16 : 0;
      const book = mesh(new THREE.BoxGeometry(bw, bh, 0.3), std(bookCols[(shelf * 3 + k) % bookCols.length], 0.85), bx + bw / 2, sy + bh / 2 - 0.19, 0);
      book.rotation.z = tilt;
      g.add(book);
      bx += bw + 0.008 + (tilt ? 0.05 : 0);
      k++;
    }
  });
  return g;
}

/* bebedouro de coluna com garrafão azul */
function createWaterCooler(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.34, 0.85, 0.34), std(0xe8e4da, 0.75), 0, 0.425, 0));
  const jug = mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.4, 16), std(0x7ec8f7, 0.25, { transparent: true, opacity: 0.55 }), 0, 1.06, 0);
  g.add(jug);
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 12), std(0x4a90d9, 0.5), 0, 0.88, 0));
  [-0.07, 0.07].forEach((tx, i) => {
    g.add(mesh(new THREE.BoxGeometry(0.05, 0.04, 0.06), std(i === 0 ? 0xd23b3b : 0x2f6fed, 0.6), tx, 0.62, 0.17));
  });
  return g;
}

/* boombox com equalizador animado */
function createBoombox(): { group: THREE.Group; bars: THREE.Mesh[] } {
  const g = new THREE.Group();
  const dark = std(0x2b2f36, 0.6);
  g.add(mesh(new THREE.BoxGeometry(0.62, 0.3, 0.18), dark, 0, 0.15, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8), std(0x9a9a9a, 0.4, { metalness: 0.7 }), 0, 0.37, 0)); // alça base
  const handle = mesh(new THREE.BoxGeometry(0.5, 0.03, 0.04), std(0x9a9a9a, 0.4, { metalness: 0.7 }), 0, 0.42, 0);
  g.add(handle);
  [-0.2, 0.2].forEach(sx => {
    const cone = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 18), std(0x14161c, 0.5), sx, 0.15, 0.09);
    cone.rotation.x = Math.PI / 2;
    g.add(cone);
    const inner = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.035, 14), std(0x8a8a92, 0.5), sx, 0.15, 0.1);
    inner.rotation.x = Math.PI / 2;
    g.add(inner);
  });
  // barras do "equalizador"
  const bars: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(
      new THREE.BoxGeometry(0.028, 0.12, 0.01),
      new THREE.MeshBasicMaterial({ color: 0x51ff7a })
    );
    b.position.set(-0.08 + i * 0.04, 0.14, 0.092);
    g.add(b);
    bars.push(b);
  }
  g.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 14), std(0xd23b3b, 0.6), 0, 0.265, 0)); // botão
  return { group: g, bars };
}

/* luminária de pé com luz quente */
function createFloorLamp(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.04, 16), std(0x3a3f4a, 0.5, { metalness: 0.6 }), 0, 0.02, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.5, 10), std(0x3a3f4a, 0.5, { metalness: 0.6 }), 0, 0.77, 0));
  const shade = mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.26, 16, 1, true), std(0xf2d8a0, 0.9, { side: THREE.DoubleSide, emissive: 0xffd9a0, emissiveIntensity: 0.55 }), 0, 1.6, 0);
  g.add(shade);
  const pl = new THREE.PointLight(0xffd9a0, 5, 5.5, 1.8);
  pl.position.set(0, 1.52, 0);
  g.add(pl);
  return g;
}

/* lixeira de arame com bolinhas de papel */
function createTrashBin(): THREE.Group {
  const g = new THREE.Group();
  const wire = std(0x8a8a92, 0.4, { metalness: 0.7, wireframe: true });
  g.add(mesh(new THREE.CylinderGeometry(0.19, 0.15, 0.38, 14, 3, true), wire, 0, 0.19, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 14), std(0x6a6a72, 0.6), 0, 0.01, 0));
  [[0.05, 0.3, 0.04], [-0.07, 0.34, -0.03], [0.35, 0.03, 0.25]].forEach(([px, py, pz]) => {
    const ball = mesh(new THREE.SphereGeometry(0.045, 6, 5), std(0xf4f2ea, 0.95), px, py, pz);
    ball.geometry.computeVertexNormals();
    g.add(ball);
  });
  return g;
}

/* ficus de canto (maior que a planta atual) */
function createFicus(scale = 1): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.24, 0.18, 0.38, 14), std(0xa3542e, 0.9), 0, 0.19, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.7, 8), std(0x5a3a22, 0.9), 0, 0.7, 0));
  const leafA = std(0x2f9e44, 0.9);
  const leafB = std(0x37b24d, 0.9);
  [[0, 1.15, 0, 0.34, leafA], [0.2, 1.0, 0.1, 0.24, leafB], [-0.2, 1.05, -0.08, 0.22, leafA], [0.05, 1.42, 0.02, 0.22, leafB], [-0.12, 1.32, 0.12, 0.18, leafA]]
    .forEach(([px, py, pz, r, m]) => {
      g.add(mesh(new THREE.SphereGeometry(r as number, 12, 12), m as THREE.Material, px as number, py as number, pz as number));
    });
  g.scale.setScalar(scale);
  return g;
}

function buildRoom(scene: THREE.Scene, benchXs: number[]): {
  clockHour: THREE.Object3D;
  clockMin: THREE.Object3D;
  eqBars: THREE.Mesh[];
} {
  scene.background = new THREE.Color(0x74886a);
  scene.fog = new THREE.Fog(0x74886a, 20, 44);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x7d9a68, 1.15));
  scene.add(new THREE.AmbientLight(0xfffaf0, 0.3));
  const dir = new THREE.DirectionalLight(0xfff6e8, 1.35);
  dir.position.set(5, 9, 7);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  dir.shadow.camera.left = -9; dir.shadow.camera.right = 9;
  dir.shadow.camera.top = 9; dir.shadow.camera.bottom = -9;
  scene.add(dir);

  // piso verde-pastel
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(26, 20), std(0xffffff, 0.95, { map: carpetTexture() }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 1.5);
  floor.receiveShadow = true;
  scene.add(floor);

  // paredes claras com divisões de painel (estilo da referência)
  const wallM = std(0xe4e8e2, 0.95);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(26, 6.5), wallM);
  back.position.set(0, 3.25, -4.5);
  back.receiveShadow = true;
  scene.add(back);
  const left = new THREE.Mesh(new THREE.PlaneGeometry(20, 6.5), std(0xdde3da, 0.95));
  left.rotation.y = Math.PI / 2;
  left.position.set(-10, 3.25, 1.5);
  scene.add(left);
  const right = new THREE.Mesh(new THREE.PlaneGeometry(20, 6.5), std(0xdde3da, 0.95));
  right.rotation.y = -Math.PI / 2;
  right.position.set(10, 3.25, 1.5);
  scene.add(right);
  // vãos verticais dos painéis
  const seamM = std(0xc6ccc2, 0.9);
  for (let sx = -11.7; sx <= 11.7; sx += 2.6) {
    const s = mesh(new THREE.BoxGeometry(0.06, 6.5, 0.04), seamM, sx, 3.25, -4.47);
    s.castShadow = false;
    scene.add(s);
  }
  for (let sz = -6.5; sz <= 9.5; sz += 2.6) {
    const sl = mesh(new THREE.BoxGeometry(0.04, 6.5, 0.06), seamM, -9.97, 3.25, sz);
    sl.castShadow = false;
    scene.add(sl);
    const sr = mesh(new THREE.BoxGeometry(0.04, 6.5, 0.06), seamM, 9.97, 3.25, sz);
    sr.castShadow = false;
    scene.add(sr);
  }
  // rodapé verde-escuro, casando com os cubículos
  const baseM = std(0x2f3a2e, 0.9);
  const baseB = mesh(new THREE.BoxGeometry(26, 0.2, 0.07), baseM, 0, 0.1, -4.45);
  baseB.castShadow = false;
  scene.add(baseB);
  [-9.95, 9.95].forEach(bx => {
    const bs = mesh(new THREE.BoxGeometry(0.07, 0.2, 20), baseM, bx, 0.1, 1.5);
    bs.castShadow = false;
    scene.add(bs);
  });

  // janela de dia com persiana
  const win = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.1), new THREE.MeshBasicMaterial({ map: dayTexture() }));
  win.position.set(-5.4, 3.0, -4.47);
  scene.add(win);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.3, 0.08), std(0xc9cfc4, 0.8));
  frame.position.set(-5.4, 3.0, -4.52);
  scene.add(frame);
  for (let i = 0; i < 7; i++) {
    const slat = mesh(new THREE.BoxGeometry(3.3, 0.09, 0.03), std(0xefe8d8, 0.8), -5.4, 2.25 + i * 0.26, -4.42);
    slat.rotation.x = 0.5;
    slat.castShadow = false;
    scene.add(slat);
  }

  // ar-condicionado de janela embaixo da vidraça
  const ac = new THREE.Group();
  ac.position.set(-5.4, 1.55, -4.35);
  ac.add(mesh(new THREE.BoxGeometry(1.15, 0.52, 0.4), std(0xd8d4c8, 0.75)));
  for (let i = 0; i < 6; i++) {
    ac.add(mesh(new THREE.BoxGeometry(0.95, 0.03, 0.02), std(0xa8a496, 0.8), 0, 0.18 - i * 0.075, 0.21));
  }
  ac.add(mesh(new THREE.BoxGeometry(0.09, 0.09, 0.03), std(0x4a4438, 0.6), 0.42, 0.15, 0.21));
  scene.add(ac);

  // sanca no topo das paredes
  const crownM = std(0xefe6d2, 0.9);
  const crownB = mesh(new THREE.BoxGeometry(26, 0.14, 0.1), crownM, 0, 6.4, -4.44);
  crownB.castShadow = false;
  scene.add(crownB);
  const crownL = mesh(new THREE.BoxGeometry(0.1, 0.14, 20), crownM, -9.94, 6.4, 1.5);
  crownL.castShadow = false;
  scene.add(crownL);
  const crownR = mesh(new THREE.BoxGeometry(0.1, 0.14, 20), crownM, 9.94, 6.4, 1.5);
  crownR.castShadow = false;
  scene.add(crownR);

  // quadro de recados clean
  const cork = new THREE.Group();
  cork.position.set(0.4, 2.8, -4.46);
  cork.add(mesh(new THREE.BoxGeometry(3.4, 1.9, 0.07), std(0x2f3a2e, 0.9)));
  const corkFace = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.7), std(0xb98d55, 0.95));
  corkFace.position.z = 0.04;
  cork.add(corkFace);
  const noteCols = [0xffd93b, 0xff9ecb, 0x8be89b, 0x9ecfff, 0xf4f2ea];
  for (let i = 0; i < 10; i++) {
    const n = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.24),
      new THREE.MeshBasicMaterial({ color: noteCols[i % noteCols.length], side: THREE.DoubleSide })
    );
    n.position.set(-1.3 + (i % 5) * 0.65, 0.45 - Math.floor(i / 5) * 0.7, 0.05);
    n.rotation.z = ((i * 37) % 20 - 10) * 0.01;
    cork.add(n);
    const pin = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), new THREE.MeshBasicMaterial({ color: 0xd23b3b }));
    pin.position.set(n.position.x, n.position.y + 0.1, 0.06);
    cork.add(pin);
  }
  scene.add(cork);

  // relógio de parede (ponteiros marcam a hora real!)
  const clockG = new THREE.Group();
  clockG.position.set(-2.4, 4.1, -4.46);
  clockG.add(new THREE.Mesh(new THREE.CircleGeometry(0.34, 28), std(0xf6f2e8, 0.8)));
  clockG.add(mesh(new THREE.TorusGeometry(0.34, 0.045, 10, 28), std(0x2f3a2e, 0.6)));
  const mkHand = (w: number, len: number, z: number) => {
    const pivot = new THREE.Group();
    pivot.position.z = z;
    const h = mesh(new THREE.BoxGeometry(w, len, 0.02), std(0x22242a), 0, len / 2 - 0.04, 0);
    pivot.add(h);
    clockG.add(pivot);
    return pivot;
  };
  const clockHour = mkHand(0.045, 0.17, 0.02);
  const clockMin = mkHand(0.03, 0.26, 0.025);
  clockG.add(mesh(new THREE.SphereGeometry(0.025, 10, 10), std(0xd23b3b, 0.5), 0, 0, 0.03));
  scene.add(clockG);

  // calendário com a data de hoje (parede esquerda)
  const cal = createCalendar();
  cal.position.set(-9.94, 2.6, -2.0);
  cal.rotation.y = Math.PI / 2;
  scene.add(cal);

  // pendentes de teto (cone preto) sobre as fileiras + mesa de reunião
  [...benchXs.map(x => [x, 0.5]), [-5.5, 3.4]].forEach(([px, pz]) => {
    const pend = createPendant();
    pend.position.set(px, 0, pz);
    scene.add(pend);
  });

  // armários de arquivo claros (igual referência) + caixa de lenço em cima
  const cab = new THREE.Group();
  cab.position.set(-8.5, 0, -3.5);
  cab.rotation.y = 0.35;
  const cabM = std(0xdcddd6, 0.85);
  const handleM = std(0x9aa098, 0.6);
  [[-0.45], [0.45]].forEach(([cx]) => {
    cab.add(mesh(new THREE.BoxGeometry(0.78, 1.6, 0.9), cabM, cx, 0.8, 0));
    [0.35, 0.8, 1.25].forEach(dy => {
      cab.add(mesh(new THREE.BoxGeometry(0.7, 0.02, 0.02), std(0xb9beb4, 0.9), cx, dy - 0.19, 0.455));
      cab.add(mesh(new THREE.BoxGeometry(0.22, 0.035, 0.03), handleM, cx, dy, 0.455));
      cab.add(mesh(new THREE.BoxGeometry(0.16, 0.06, 0.02), std(0xf6f2e8, 0.9), cx, dy - 0.12, 0.455));
    });
  });
  // caixinha de lenço em cima, como na referência
  cab.add(mesh(new THREE.BoxGeometry(0.34, 0.16, 0.22), std(0xe8e4da, 0.9), -0.45, 1.68, 0.05));
  cab.add(mesh(new THREE.BoxGeometry(0.16, 0.02, 0.1), std(0xffffff, 0.95), -0.45, 1.77, 0.05));
  scene.add(cab);

  const plant = new THREE.Group();
  plant.position.set(8.8, 0, -3.0);
  plant.add(mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.4, 14), std(0xe8e4da, 0.85), 0, 0.2, 0));
  plant.add(mesh(new THREE.SphereGeometry(0.42, 12, 12), std(0x2f9e44, 0.9), 0, 0.85, 0));
  plant.add(mesh(new THREE.SphereGeometry(0.28, 12, 12), std(0x37b24d, 0.9), 0.25, 1.1, 0.1));
  scene.add(plant);

  // ---- props ----
  // mesa redonda de reunião no canto aberto (igual referência)
  const meet = createMeetingTable(4);
  meet.position.set(-5.5, 0, 3.4);
  scene.add(meet);
  // estante na parede direita
  const shelf = createBookshelf();
  shelf.position.set(9.7, 0, 2.2);
  shelf.rotation.y = -Math.PI / 2;
  scene.add(shelf);
  // bebedouro perto do café
  const cooler = createWaterCooler();
  cooler.position.set(4.9, 0, -3.85);
  scene.add(cooler);
  // luminária de pé atrás do cantinho do café
  const lamp = createFloorLamp();
  lamp.position.set(7.5, 0, -3.9);
  scene.add(lamp);
  // mesinha lateral com boombox (equalizador anima no loop)
  const sideTable = new THREE.Group();
  sideTable.position.set(-9.0, 0, -1.6);
  sideTable.rotation.y = Math.PI / 2 - 0.25;
  sideTable.add(mesh(new THREE.BoxGeometry(0.9, 0.06, 0.5), std(0x2f3a2e, 0.85), 0, 0.56, 0));
  [[-0.38, -0.18], [0.38, -0.18], [-0.38, 0.18], [0.38, 0.18]].forEach(([px, pz]) => {
    sideTable.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.54, 8), std(0x23262b, 0.8), px, 0.27, pz));
  });
  scene.add(sideTable);
  const boom = createBoombox();
  boom.group.position.set(-9.0, 0.59, -1.6);
  boom.group.rotation.y = Math.PI / 2 - 0.25 + Math.PI;
  scene.add(boom.group);
  // lixeira perto da SUA mesa
  const bin = createTrashBin();
  bin.position.set(3.2, 0, 3.9);
  scene.add(bin);
  // ficus de canto emoldurando a frente
  const ficusL = createFicus(1.15);
  ficusL.position.set(-9.0, 0, 5.4);
  scene.add(ficusL);
  const ficusR = createFicus(0.95);
  ficusR.position.set(9.1, 0, 5.9);
  scene.add(ficusR);

  // tapete redondo sob a mesa de reunião (anel duplo)
  const rug = mesh(new THREE.CircleGeometry(2.1, 36), std(0x4a635c, 0.95), -5.5, 0.012, 3.4);
  rug.rotation.x = -Math.PI / 2;
  rug.castShadow = false;
  scene.add(rug);
  const rugRing = mesh(new THREE.RingGeometry(1.75, 2.1, 36), std(0x2f3a2e, 0.95), -5.5, 0.016, 3.4);
  rugRing.rotation.x = -Math.PI / 2;
  rugRing.castShadow = false;
  scene.add(rugRing);

  // pôsteres motivacionais na parede do fundo (moldura escura + arte geométrica)
  const mkPoster = (c1: number, c2: number) => {
    const p = new THREE.Group();
    p.add(mesh(new THREE.BoxGeometry(0.95, 1.25, 0.05), std(0x2b2f36, 0.7)));
    p.add(mesh(new THREE.BoxGeometry(0.82, 1.12, 0.02), std(c1, 0.8), 0, 0, 0.03));
    p.add(mesh(new THREE.CircleGeometry(0.26, 24), std(c2, 0.75), 0, 0.22, 0.045));
    p.add(mesh(new THREE.BoxGeometry(0.55, 0.09, 0.02), std(c2, 0.75), -0.08, -0.18, 0.045));
    p.add(mesh(new THREE.BoxGeometry(0.4, 0.07, 0.02), std(c2, 0.75), -0.15, -0.32, 0.045));
    p.children.forEach(c => (c.castShadow = false));
    return p;
  };
  const poster1 = mkPoster(0x35507a, 0xfbbf24);
  poster1.position.set(3.4, 3.5, -4.44);
  scene.add(poster1);
  const poster2 = mkPoster(0x5a3a6e, 0x4ade80);
  poster2.position.set(6.4, 3.35, -4.44);
  scene.add(poster2);

  // segunda janela com vista, na parede da DIREITA (equilibra a luz da sala)
  const winR = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.9), new THREE.MeshBasicMaterial({ map: dayTexture() }));
  winR.position.set(9.955, 3.1, -1.2);
  winR.rotation.y = -Math.PI / 2;
  scene.add(winR);
  const winRFrame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.1, 3.2), std(0xc9cfc4, 0.8));
  winRFrame.position.set(9.97, 3.1, -1.2);
  scene.add(winRFrame);

  // cantinho de descanso: 2 puffs coloridos na frente esquerda
  const puff = (px: number, pz: number, c: number) => {
    const b = mesh(new THREE.SphereGeometry(0.42, 18, 18), std(c, 0.95), px, 0.26, pz);
    b.scale.set(1, 0.62, 1);
    scene.add(b);
  };
  puff(-8.2, 4.7, 0xd95f76);
  puff(-7.1, 5.5, 0x4a7fb5);

  return { clockHour, clockMin, eqBars: boom.bars };
}

/* ============================== componente ============================== */

export function Office3D() {
  const { state, dispatch, streamMessage } = useChat();
  const mountRef = useRef<HTMLDivElement>(null);
  const balloonRef = useRef<HTMLDivElement>(null);
  const balloonTargetRef = useRef<string>('');
  const boardsRef = useRef<{
    left?: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture };
    right?: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture };
  }>({});
  const [selectedId, setSelectedId] = useState<string>('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [panelOpen, setPanelOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 900);
  const [meetingMode, setMeetingMode] = useState(false);
  // modo tarefa 🛠️: o agente EXECUTA o pedido e entrega arquivos (salvos em workspace/)
  const [taskMode, setTaskMode] = useState(false);
  const [taskNote, setTaskNote] = useState<string | null>(null);
  // terminal: comandos sugeridos pelos agentes + saída da execução
  const [termOpen, setTermOpen] = useState(false);
  const [termLog, setTermLog] = useState<TermEntry[]>([]);
  const [fixing, setFixing] = useState(false); // devolveu o erro pro agente corrigir
  const [meetingTurns, setMeetingTurns] = useState<{ agentId: string; name: string; text: string }[]>([]);
  const [meetingSpeaker, setMeetingSpeaker] = useState<string | null>(null);
  const [meetingRunning, setMeetingRunning] = useState(false);
  const [meetingTopic, setMeetingTopic] = useState<string | null>(null);
  const [pastTopic, setPastTopic] = useState<string | null>(null);
  // histórico de reuniões: lista salva no banco + ata antiga sendo visualizada
  const [historyOpen, setHistoryOpen] = useState(false);
  const [savedMeetings, setSavedMeetings] = useState<MeetingSummary[] | null>(null);
  const [viewingMeeting, setViewingMeeting] = useState<PastMeeting | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const turnAbortRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // refs p/ o loop de animação (3D lê o estado React sem recriar a cena)
  const speakerRef = useRef<string | null>(null);
  const selectedRef = useRef<string>('');
  const busyIdRef = useRef<string | null>(null);

  const agents = state.personalities;
  const idsKey = useMemo(() => agents.map(a => a.id).join(','), [agents]);
  // re-renderiza a cena quando visuais customizados mudam
  const visualsKey = useMemo(
    () => JSON.stringify(state.settings.charVisuals),
    [state.settings.charVisuals]
  );
  const mentions = useMentions(agents);

  const completeMention = (index?: number) => {
    const r = mentions.commit(input, index);
    if (!r) return;
    setInput(r.text);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(r.caret, r.caret);
      }
    });
  };

  const selected = agents.find(a => a.id === selectedId) ?? agents[0] ?? null;
  useEffect(() => {
    balloonTargetRef.current = meetingSpeaker ?? selected?.id ?? '';
  });

  // espelha estado nos refs usados pelo loop 3D
  useEffect(() => { speakerRef.current = meetingSpeaker; }, [meetingSpeaker]);
  useEffect(() => { selectedRef.current = selected?.id ?? ''; }, [selected]);
  useEffect(() => {
    busyIdRef.current = busy ? state.currentSession?.personalityId ?? null : null;
  }, [busy, state.currentSession]);

  useEffect(() => {
    if (!selectedId && agents.length > 0) {
      setSelectedId(state.currentPersonality?.id ?? agents[0].id);
    }
  }, [agents, selectedId, state.currentPersonality]);

  useEffect(() => {
    if (!selectedId || agents.length === 0) return;
    const persona = agents.find(a => a.id === selectedId);
    if (!persona) return;
    if (state.currentPersonality?.id !== selectedId) {
      dispatch({ type: 'SET_CURRENT_PERSONALITY', payload: persona });
    }
    const latest = state.sessions
      .filter(s => s.personalityId === selectedId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    if (latest && state.currentSession?.id !== latest.id) {
      dispatch({ type: 'SET_CURRENT_SESSION', payload: latest });
    } else if (!latest) {
      dispatch({ type: 'CREATE_SESSION', payload: { personalityId: selectedId } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, agents]);

  // atalhos 1–9 trocam de agente (fora de inputs)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= agents.length) setSelectedId(agents[n - 1].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [agents]);

  /* ---------- cena ---------- */
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || agents.length === 0) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // câmera de cima, meio isométrica (sem giro automático)
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 70);
    camera.position.set(3.4, 7.2, 9.2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.8, 0.2);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 4;
    controls.maxDistance = 16;
    controls.minPolarAngle = 0.3;
    controls.maxPolarAngle = 1.25;
    controls.autoRotate = false;

    // DUAS fileiras de CUBÍCULOS frente a frente (estilo da referência)
    const benchAX = -1.7;
    const benchBX = 1.7;
    const roomRefs = buildRoom(scene, [benchAX, benchBX]);

    const benchA: string[] = [];
    const benchB: string[] = [];
    // o Tux não senta nas bancadas: a mesa dele fica ao lado da SUA 🐧
    agents.filter(p => p.id !== 'tux').forEach((p, i) => (i % 2 === 0 ? benchA : benchB).push(p.id));

    const actors: Record<string, Actor> = {};
    const clickTargets: THREE.Object3D[] = [];
    const focusPoints: Record<string, THREE.Vector3> = {};
    const steam: THREE.Sprite[] = [];
    const mugSteam: THREE.Sprite[] = []; // vaporzinho das canecas levadas pelos agentes
    const mugSteamTex = glowTexture();
    let blinkMat: THREE.MeshBasicMaterial | null = null;
    let userInteracting = false;
    controls.addEventListener('start', () => { userInteracting = true; });
    controls.addEventListener('end', () => { userInteracting = false; });

    // telefone de disco na mesa de reunião + impressora matricial no fundo
    const phone = createRotaryPhone();
    phone.position.set(-5.9, 0.75, 3.5);
    phone.rotation.y = 0.4;
    scene.add(phone);
    const printer = createPrinter();
    printer.position.set(0, 0, -3.2);
    scene.add(printer);

    agents.forEach(p => {
      const v = visualFor(p.id, state.settings.charVisuals);
      const isTux = p.id === 'tux';
      const onA = benchA.includes(p.id);
      const bx = onA ? benchAX : benchBX;
      const mates = onA ? benchA : benchB;
      const seatJ = mates.indexOf(p.id);
      // Tux fica do lado da mesa do usuário (7.4, 4.4), virado pro mesmo lado
      const facing = isTux ? -2.35 : onA ? Math.PI / 2 : -Math.PI / 2;
      const seatX = isTux ? 5.4 : bx + (onA ? -1.05 : 1.05);
      const seatZ = isTux ? 4.2 : (seatJ - (mates.length - 1) / 2) * 1.9;

      // grupo do assento: tudo em coords locais (frente = +z local)
      const seat = new THREE.Group();
      seat.position.set(seatX, 0, seatZ);
      seat.rotation.y = facing;

      const built = v.kind === 'penguin' ? createPenguin(v) : createHuman(v);
      const anchor = new THREE.Group();
      // sentado na cadeira: âncora subida até o assento, perninhas encolhem (anim loop)
      anchor.position.set(0, v.kind === 'penguin' ? 0.12 : 0.2, -0.3);
      anchor.add(built.group);
      built.group.traverse(o => { o.userData.agentId = p.id; });
      clickTargets.push(built.group);
      seat.add(anchor);

      const chair = createChair();
      chair.position.set(0, 0, -0.37);
      seat.add(chair);

      // cubículo: tampo claro + painéis verde-escuro (estilo da referência)
      seat.add(createCubicle());

      // CRT de frente PARA o personagem (tela encara quem digita)
      const crt = createCRT();
      crt.position.set(-0.3, 0.95, 0.78);
      crt.rotation.y = Math.PI - 0.12;
      seat.add(crt);

      // teclado bege + mouse de bolinha (mais perto da borda, ao alcance das mãos)
      const kb = createKeyboard80s();
      kb.position.set(0.08, 0.95, 0.34);
      seat.add(kb);
      const pad = mesh(new THREE.BoxGeometry(0.24, 0.015, 0.2), std(0x3a5a8c, 0.9), 0.48, 0.955, 0.34);
      seat.add(pad);
      const mouse = mesh(new THREE.SphereGeometry(0.05, 12, 12), std(0xd9d0b8, 0.6), 0.48, 0.99, 0.34);
      mouse.scale.set(1, 0.65, 1.3);
      seat.add(mouse);

      // caneca na cor do agente
      const mugColor = new THREE.Color(v.accent);
      seat.add(mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.12, 16), std(mugColor.getHex(), 0.6), -0.68, 1.01, 0.55));

      // cartãozinho de nome no topo do painel do cubículo
      const plate = createPlate(p.name, v.accent);
      plate.position.set(0, 1.28, 1.31);
      seat.add(plate);

      // anel de destaque + nome flutuante (presos ao boneco, seguem na caminhada)
      const ring = createRing(v.accent);
      ring.position.set(0, 0.03, 0);
      anchor.add(ring);
      const tag = createNameTag(p.name, v.accent);
      tag.position.set(0, 2.3, 0);
      anchor.add(tag);
      // canequinha que ele carrega na pausa pro café
      const carriedMug = mesh(
        new THREE.CylinderGeometry(0.05, 0.045, 0.1, 12),
        std(new THREE.Color(v.accent).getHex(), 0.6),
        0, v.kind === 'penguin' ? -0.3 : -0.34, v.kind === 'penguin' ? 0.16 : 0.06
      );
      carriedMug.visible = false;
      // VAPOR subindo do café ☕💨 (só aparece quando a caneca aparece: filhos herdam o visible)
      for (let i = 0; i < 3; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: mugSteamTex, transparent: true, opacity: 0.4, depthWrite: false,
        }));
        sp.position.set((Math.random() - 0.5) * 0.04, 0.07, (Math.random() - 0.5) * 0.02);
        sp.userData.phase = Math.random();
        carriedMug.add(sp);
        mugSteam.push(sp);
      }
      built.refs.foreR.add(carriedMug);
      focusPoints[p.id] = new THREE.Vector3(seatX, 1.1, seatZ);

      scene.add(seat);

      actors[p.id] = {
        id: p.id,
        group: anchor,
        head: built.refs.head,
        torso: built.refs.torso,
        foreL: built.refs.foreL,
        foreR: built.refs.foreR,
        face: built.refs.face,
        legs: built.refs.legs,
        sitBase: v.kind === 'penguin' ? 0.12 : 0.2,
        ring,
        carriedMug,
        penguin: v.kind === 'penguin',
        sitPose: 1, // nasce sentado na cadeira
        baseYaw: facing,
        wanderT: 2 + Math.random() * 3,
        wanderTarget: 0,
        blinkT: 1 + Math.random() * 3,
        talkT: 0,
        phase: Math.random() * Math.PI * 2,
      };
    });

    // SEU bonequinho (digita junto, mas não é selecionável; personalizável na aba Bonecos)
    {
      const youSaved = state.settings.charVisuals['you'];
      const you = visualFor('you', state.settings.charVisuals);
      const capColor = youSaved?.cap ? parseHexColor(youSaved.cap, YOU_CAP_COLOR) : YOU_CAP_COLOR;
      const built = createHuman(you, { cap: capColor });
      const seat = new THREE.Group();
      // canto da frente-direita, LONGE da rota do café ☕ (que passa por x≈3.9–5.0)
      seat.position.set(7.4, 0, 4.4);
      seat.rotation.y = -2.1; // de frente pro resto do escritório
      const anchor = new THREE.Group();
      anchor.position.set(0, 0.2, -0.3);
      anchor.add(built.group);
      seat.add(anchor);
      const chair = createChair();
      chair.position.set(0, 0, -0.37);
      seat.add(chair);
      const crt = createCRT();
      crt.position.set(-0.3, 0.95, 0.78);
      crt.rotation.y = Math.PI - 0.12;
      seat.add(crt);
      const kb = createKeyboard80s();
      kb.position.set(0.08, 0.95, 0.34);
      seat.add(kb);
      seat.add(mesh(new THREE.BoxGeometry(0.24, 0.015, 0.2), std(0x3a5a8c, 0.9), 0.48, 0.955, 0.34));
      const mouse = mesh(new THREE.SphereGeometry(0.05, 12, 12), std(0xd9d0b8, 0.6), 0.48, 0.99, 0.34);
      mouse.scale.set(1, 0.65, 1.3);
      seat.add(mouse);
      seat.add(mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.12, 16), std(0x4ade80, 0.6), -0.68, 1.01, 0.55));
      const plate = createPlate('Você', '#4ade80');
      plate.position.set(0, 1.28, 1.31);
      seat.add(plate);
      const tag = createNameTag('Você', '#4ade80');
      tag.position.set(0, 2.3, 0);
      anchor.add(tag);
      seat.add(createCubicle());
      scene.add(seat);
      actors['__you'] = {
        id: '__you',
        group: anchor,
        head: built.refs.head,
        torso: built.refs.torso,
        foreL: built.refs.foreL,
        foreR: built.refs.foreR,
        face: built.refs.face,
        ring: null,
        carriedMug: null,
        penguin: false,
        legs: built.refs.legs,
        sitBase: 0.2,
        sitPose: 1,
        baseYaw: -0.4,
        wanderT: 3,
        wanderTarget: 0,
        blinkT: 2,
        talkT: 0,
        phase: 1.2,
      };
    }

    // donuts na mesa de reunião + cantinho do café ☕
    const tableDonut = (px: number, pz: number, color = 0xf49ac1) => {
      scene.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 18), std(0xf6f2e8, 0.7), px, 0.77, pz));
      const donut = mesh(new THREE.TorusGeometry(0.075, 0.045, 12, 20), std(color, 0.7), px, 0.82, pz);
      donut.rotation.x = Math.PI / 2;
      scene.add(donut);
    };
    tableDonut(-5.2, 3.2);
    tableDonut(-5.85, 3.7, 0x7ec8f7);
    const coffee = createCoffeeCorner(scene, steam);
    blinkMat = (coffee.userData.blink as THREE.MeshBasicMaterial) ?? null;

    // QUADROS dinâmicos nas paredes laterais
    const mkBoard = (key: 'left' | 'right', draw: (c: HTMLCanvasElement) => void) => {
      const canvas = document.createElement('canvas');
      canvas.width = 512; canvas.height = 320;
      draw(canvas);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      boardsRef.current[key] = { canvas, tex };
      const grp = new THREE.Group();
      grp.add(mesh(new THREE.BoxGeometry(3.8, 2.4, 0.1), std(0x2f3a2e, 0.9)));
      const face = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 2.12), new THREE.MeshBasicMaterial({ map: tex }));
      face.position.z = 0.06;
      grp.add(face);
      return grp;
    };
    const leftBoard = mkBoard('left', c => drawQuestionBoard(c, '', ''));
    leftBoard.position.set(-9.88, 2.7, 0.6);
    leftBoard.rotation.y = Math.PI / 2;
    scene.add(leftBoard);
    const rightBoard = mkBoard('right', c => drawStatusBoard(c, { model: '…', msgs: 0, chats: 0, agents: 0 }));
    rightBoard.position.set(9.88, 2.7, 0.6);
    rightBoard.rotation.y = -Math.PI / 2;
    scene.add(rightBoard);

    // ---------- pausa pro café ☕ ----------
    // de tempos em tempos um agente levanta, anda até a máquina e volta com a canequinha
    const COFFEE_POINT = new THREE.Vector3(5.75, 0, -2.5);
    const buildCoffeePath = (sx: number, sz: number): THREE.Vector3[] => {
      const pts: THREE.Vector3[] = [];
      const exitX = Math.sign(sx) * 3.9;
      pts.push(new THREE.Vector3(exitX, 0, sz));
      if (sx > 0) {
        pts.push(new THREE.Vector3(exitX, 0, -2.35));
      } else {
        pts.push(new THREE.Vector3(exitX, 0, 2.6));
        pts.push(new THREE.Vector3(5.0, 0, 2.6));
        pts.push(new THREE.Vector3(5.0, 0, -2.35));
      }
      pts.push(COFFEE_POINT.clone());
      return pts;
    };
    const coffeeBreak = {
      id: null as string | null,
      phase: 'idle' as 'idle' | 'out' | 'at' | 'back',
      waypoints: [] as THREE.Vector3[],
      wi: 0,
      waitT: 0,
      nextIn: 16 + Math.random() * 12,
    };

    // clique no bonequinho seleciona
    const ray = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    let downX = 0, downY = 0;
    const onDown = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY; };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
      const r = renderer.domElement.getBoundingClientRect();
      ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(ptr, camera);
      const hit = ray.intersectObjects(clickTargets, true)[0];
      const id = hit?.object.userData.agentId as string | undefined;
      if (id) {
        setSelectedId(id);
        // desktop: já deixa o input pronto pra digitar
        if (window.innerWidth >= 900) setTimeout(() => inputRef.current?.focus(), 60);
      }
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const clock = new THREE.Clock();
    const projV = new THREE.Vector3();
    const tmpA = new THREE.Vector3();
    const tmpB = new THREE.Vector3();
    const camTarget = controls.target.clone();
    const normAngle = (ang: number) => {
      let r = ang % (Math.PI * 2);
      if (r > Math.PI) r -= Math.PI * 2;
      if (r < -Math.PI) r += Math.PI * 2;
      return r;
    };
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      const speaker = speakerRef.current;
      const selNow = selectedRef.current;
      const busyId = busyIdRef.current;

      // câmera segue suavemente quem fala / quem está selecionado
      const focusId = speaker ?? selNow;
      const fp = focusId ? focusPoints[focusId] : undefined;
      if (fp && !userInteracting) {
        camTarget.lerp(fp, 0.035);
        controls.target.copy(camTarget);
      }
      controls.update();

      // posição do falante p/ os colegas olharem pra ele
      let speakerPos: THREE.Vector3 | null = null;
      if (speaker && actors[speaker]) {
        speakerPos = actors[speaker].head.getWorldPosition(tmpA);
      }

      // ---------- pausa pro café: escolhe alguém, anda até a máquina e volta ----------
      const dtF = 1 / 60;
      if (coffeeBreak.phase === 'idle') {
        coffeeBreak.nextIn -= dtF;
        if (coffeeBreak.nextIn <= 0) {
          const candidates = agents.filter(p => p.id !== speaker && p.id !== busyId);
          if (candidates.length > 0) {
            const pick = candidates[Math.floor(Math.random() * candidates.length)];
            coffeeBreak.id = pick.id;
            actors[pick.id].group.getWorldPosition(tmpA);
            coffeeBreak.waypoints = buildCoffeePath(tmpA.x, tmpA.z);
            coffeeBreak.wi = 0;
            coffeeBreak.phase = 'out';
          } else {
            coffeeBreak.nextIn = 6;
          }
        }
      } else if (coffeeBreak.id) {
        const ca = actors[coffeeBreak.id];
        const seatObj = ca.group.parent as THREE.Object3D;
        if (coffeeBreak.phase === 'out' || coffeeBreak.phase === 'back') {
          const wp = coffeeBreak.waypoints[coffeeBreak.wi];
          seatObj.worldToLocal(tmpA.copy(wp));
          const dx = tmpA.x - ca.group.position.x;
          const dz = tmpA.z - ca.group.position.z;
          const dist = Math.hypot(dx, dz);
          const step = 1.5 * dtF;
          if (dist <= 0.09) {
            coffeeBreak.wi++;
            if (coffeeBreak.wi >= coffeeBreak.waypoints.length) {
              if (coffeeBreak.phase === 'out') {
                coffeeBreak.phase = 'at';
                coffeeBreak.waitT = 2.5 + Math.random() * 2.5;
                if (ca.carriedMug) ca.carriedMug.visible = true;
              } else {
                coffeeBreak.phase = 'idle';
                coffeeBreak.id = null;
                coffeeBreak.nextIn = 22 + Math.random() * 18;
                ca.group.position.set(0, ca.sitBase, -0.3); // volta a sentar
                if (ca.carriedMug) ca.carriedMug.visible = false;
              }
            }
          } else {
            ca.group.position.x += (dx / dist) * Math.min(step, dist);
            ca.group.position.z += (dz / dist) * Math.min(step, dist);
            const yawT = Math.atan2(dx, dz);
            ca.group.rotation.y += normAngle(yawT - ca.group.rotation.y) * 0.14;
            ca.group.position.y = Math.abs(Math.sin(t * 11)) * 0.05; // passinhos
          }
          ca.group.getWorldPosition(tmpB);
          focusPoints[ca.id]?.set(tmpB.x, 1.1, tmpB.z);
        } else {
          // enchendo a canequinha
          coffeeBreak.waitT -= dtF;
          ca.group.position.y = Math.abs(Math.sin(t * 3)) * 0.02;
          if (coffeeBreak.waitT <= 0) {
            coffeeBreak.phase = 'back';
            coffeeBreak.waypoints = [...coffeeBreak.waypoints].reverse();
            coffeeBreak.wi = 0;
          }
        }
      }

      Object.values(actors).forEach(a => {
        const tt = t + a.phase;
        const speaking = a.id === speaker || a.id === busyId;
        const walking = coffeeBreak.id === a.id && (coffeeBreak.phase === 'out' || coffeeBreak.phase === 'back');
        // tomando café na máquina ☕
        const drinking = coffeeBreak.id === a.id && coffeeBreak.phase === 'at';

        // respiração (parada quando está caminhando — o passo já dá o balanço)
        // sentado por padrão (sitBase); de pé só quando a passeio do café está andando
        a.torso.scale.y = 1 + Math.sin(tt * 2.2) * 0.025;
        if (!walking) a.group.position.y = a.sitBase + Math.sin(tt * 2.2) * 0.012;
        if (!walking && Math.abs(a.group.rotation.y) > 0.001) a.group.rotation.y *= 0.92;

        // pernas articuladas: sentado = coxa pra frente, canela pra baixo, pé pendurado;
        // andando = pernas esticadas com balanço alternado e joelho dobrando no passo
        if (a.legs) {
          const target = walking ? 0 : 1;
          a.sitPose += (target - a.sitPose) * 0.12;
          const p = a.sitPose;
          const s = Math.sin(tt * 9);
          const SIT_HIP = -1.25, SIT_KNEE = 1.25;
          a.legs.hipL.rotation.x = SIT_HIP * p + s * 0.55 * (1 - p);
          a.legs.hipR.rotation.x = SIT_HIP * p - s * 0.55 * (1 - p);
          a.legs.kneeL.rotation.x = SIT_KNEE * p + Math.max(0, s) * 0.9 * (1 - p);
          a.legs.kneeR.rotation.x = SIT_KNEE * p + Math.max(0, -s) * 0.9 * (1 - p);
        }

        // braços / asas
        if (walking) {
          // balanço de caminhada
          a.foreL.rotation.x = Math.sin(tt * 9) * 0.5;
          a.foreR.rotation.x = Math.sin(tt * 9 + Math.PI) * 0.5;
          a.foreL.rotation.z = 0.15;
          a.foreR.rotation.z = -0.15;
        } else if (drinking) {
          // BEBENDO CAFÉ ☕: braço direito sobe a canequinha até o rosto
          // num ciclo com pausa no alto ("sorve, baixa, sorve…")
          const sip = Math.pow((Math.sin(tt * 1.6) + 1) / 2, 2);
          a.foreR.rotation.x += (-sip * 2.35 - a.foreR.rotation.x) * 0.25;
          a.foreR.rotation.z += (-0.35 - a.foreR.rotation.z) * 0.2;
          a.foreL.rotation.x += (-0.25 + Math.sin(tt * 2.3) * 0.06 - a.foreL.rotation.x) * 0.2;
          a.foreL.rotation.z += (0.2 - a.foreL.rotation.z) * 0.2;
        } else if (a.penguin) {
          const flap = speaking ? 0.55 : 0.32;
          a.foreL.rotation.z = 0.35 + Math.sin(tt * (speaking ? 12 : 9)) * flap;
          a.foreR.rotation.z = -0.35 - Math.sin(tt * (speaking ? 12 : 9) + 1.2) * flap;
          a.group.position.y += Math.abs(Math.sin(tt * 4.5)) * 0.02;
        } else if (speaking) {
          // gesticula ao falar
          a.foreL.rotation.x = -1.15 + Math.sin(tt * 6) * 0.18;
          a.foreR.rotation.x = -1.15 + Math.sin(tt * 6 + 1.4) * 0.18;
          a.foreL.rotation.z = 0.22 + Math.sin(tt * 5) * 0.12;
          a.foreR.rotation.z = -0.22 - Math.sin(tt * 5 + 0.8) * 0.12;
        } else if (a.sitPose > 0.6) {
          // DIGITANDO no teclado: antebraços pra frente sobre as teclas,
          // com batidinhas rápidas e alternadas (tipo catioro programador)
          const tapL = Math.sin(tt * 16) * 0.09 + Math.sin(tt * 23) * 0.03;
          const tapR = Math.sin(tt * 16 + 2.1) * 0.09 + Math.sin(tt * 23 + 1.3) * 0.03;
          a.foreL.rotation.x += (-1.12 + tapL - a.foreL.rotation.x) * 0.3;
          a.foreR.rotation.x += (-1.12 + tapR - a.foreR.rotation.x) * 0.3;
          a.foreL.rotation.z += (0.14 - a.foreL.rotation.z) * 0.2;
          a.foreR.rotation.z += (-0.14 - a.foreR.rotation.z) * 0.2;
        } else {
          // de pé parado (ex.: esperando o café): bracinhos soltos com balanço leve
          a.foreL.rotation.x = Math.sin(tt * 10) * 0.09;
          a.foreR.rotation.x = Math.sin(tt * 10 + Math.PI) * 0.09;
          a.foreL.rotation.z *= 0.92;
          a.foreR.rotation.z *= 0.92;
        }

        // boca abre/fecha quando fala
        if (speaking) {
          const open = Math.abs(Math.sin(tt * 13));
          if (a.penguin) {
            a.face.maw.rotation.x = open * 0.6; // mandíbula do bico abre pra baixo
          } else {
            a.face.maw.scale.y = 0.06 + open * 0.85;
          }
          a.head.rotation.z = Math.sin(tt * 3.2) * 0.05;
        } else {
          if (a.penguin) a.face.maw.rotation.x *= 0.75; // bico fecha suave
          else a.face.maw.scale.y += (0.06 - a.face.maw.scale.y) * 0.2;
          a.head.rotation.z *= 0.9;
        }

        // piscar
        a.blinkT -= 1 / 60;
        if (a.blinkT <= 0) a.blinkT = 2.2 + Math.random() * 3.2;
        const lidTarget = a.blinkT < 0.12 ? 0.1 : 1;
        a.face.eyes.forEach(e => { e.scale.y += (lidTarget - e.scale.y) * 0.6; });

        // olhar: todos olham p/ quem fala; o selecionado olha p/ a câmera
        a.group.getWorldPosition(tmpB);
        let desiredYaw = a.wanderTarget;
        if (speaker && speakerPos && a.id !== speaker && a.id !== '__you') {
          desiredYaw = normAngle(Math.atan2(speakerPos.x - tmpB.x, speakerPos.z - tmpB.z) - a.baseYaw);
        } else if (a.id === selNow && selNow) {
          desiredYaw = normAngle(Math.atan2(camera.position.x - tmpB.x, camera.position.z - tmpB.z) - a.baseYaw);
        }
        desiredYaw = Math.max(-1, Math.min(1, desiredYaw));
        a.head.rotation.y += (desiredYaw - a.head.rotation.y) * 0.06;
        // bebendo: inclina a cabeça pra trás no gole; senão, balanço sutil normal
        a.head.rotation.x = drinking
          ? -Math.pow((Math.sin(tt * 1.6) + 1) / 2, 2) * 0.38
          : Math.sin(tt * 1.4) * 0.05;

        // wander (só vale quando ninguém impõe olhar)
        a.wanderT -= 1 / 60;
        if (a.wanderT <= 0) {
          a.wanderT = 2.5 + Math.random() * 4;
          a.wanderTarget = (Math.random() - 0.5) * 0.6;
        }

        // anel: falante pulsa; selecionado/ocupado fica aceso
        if (a.ring) {
          const rm = a.ring.material as THREE.MeshBasicMaterial;
          if (a.id === speaker) {
            a.ring.visible = true;
            rm.opacity = 0.55 + Math.abs(Math.sin(t * 5)) * 0.35;
            const rs = 1 + Math.sin(t * 5) * 0.05;
            a.ring.scale.set(rs, rs, 1);
          } else if (a.id === selNow || a.id === busyId) {
            a.ring.visible = true;
            rm.opacity = 0.8;
            a.ring.scale.set(1, 1, 1);
          } else {
            a.ring.visible = false;
          }
        }
      });

      // relógio de parede marca a hora real
      const now = new Date();
      roomRefs.clockMin.rotation.z = -((now.getMinutes() + now.getSeconds() / 60) / 60) * Math.PI * 2;
      roomRefs.clockHour.rotation.z = -(((now.getHours() % 12) + now.getMinutes() / 60) / 12) * Math.PI * 2;
      // equalizador do boombox
      roomRefs.eqBars.forEach((b, i) => {
        b.scale.y = 0.25 + Math.abs(Math.sin(t * 4.5 + i * 1.3)) * 1.15;
      });

      steam.forEach(s => {
        const cyc = (t * 0.35 + (s.userData.phase as number)) % 1;
        s.position.y = 1.25 + cyc * 0.85;
        s.position.x += Math.sin(t * 2 + (s.userData.phase as number) * 9) * 0.0009;
        const sc = 0.14 + cyc * 0.3;
        s.scale.set(sc, sc, 1);
        s.material.opacity = 0.38 * (1 - cyc);
      });
      // vapor das canequinhas: sobe devagar, dá uma balançadinha e evapora
      mugSteam.forEach(s => {
        const cyc = (t * 0.55 + (s.userData.phase as number)) % 1;
        s.position.y = 0.07 + cyc * 0.13;
        s.position.x += Math.sin(t * 5 + (s.userData.phase as number) * 7) * 0.0011;
        const sc = 0.028 + cyc * 0.055;
        s.scale.set(sc, sc, 1);
        s.material.opacity = 0.5 * (1 - cyc);
      });
      if (blinkMat) {
        blinkMat.color.setHex(Math.sin(t * 4) > 0 ? 0x51ff7a : 0x1d5c30);
      }

      const bal = balloonRef.current;
      const selId = balloonTargetRef.current;
      const head = selId ? actors[selId]?.head : undefined;
      if (bal && head) {
        head.getWorldPosition(projV);
        projV.y += 0.9;
        projV.project(camera);
        if (projV.z > 1) {
          bal.style.opacity = '0';
        } else {
          const w = mount.clientWidth, h = mount.clientHeight;
          bal.style.opacity = '1';
          bal.style.transform = `translate(${(projV.x * 0.5 + 0.5) * w}px, ${(-projV.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
        }
      } else if (bal) {
        bal.style.opacity = '0';
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      ro.disconnect();
      scene.traverse(obj => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mt = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mt)) mt.forEach(x => { const s = x as THREE.MeshBasicMaterial; if (s.map) s.map.dispose(); x.dispose(); });
        else if (mt) { const s = mt as THREE.MeshBasicMaterial; if (s.map) s.map.dispose(); mt.dispose(); }
      });
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, visualsKey]);

  /* ---------- conversa ---------- */
  const sessionForSelected = useMemo(() => {
    if (!selected) return null;
    if (state.currentSession?.personalityId === selected.id) return state.currentSession;
    return state.sessions
      .filter(s => s.personalityId === selected.id)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;
  }, [selected, state.currentSession, state.sessions]);

  const lastReply = useMemo(() => {
    if (!sessionForSelected) return '';
    const found = [...sessionForSelected.messages].reverse()
      .find(m => m.role === 'assistant' && m.content.trim());
    return found?.content ?? '';
  }, [sessionForSelected]);

  const lastQuestion = useMemo(() => {
    if (!sessionForSelected) return '';
    const found = [...sessionForSelected.messages].reverse()
      .find(m => m.role === 'user' && m.content.trim());
    return found?.content ?? '';
  }, [sessionForSelected]);

  const statusInfo = useMemo(() => ({
    model: state.settings.defaultModel.split('/').pop() ?? state.settings.defaultModel,
    msgs: state.sessions.reduce((n, s) => n + s.messages.filter(m => m.role !== 'system').length, 0),
    chats: state.sessions.length,
    agents: agents.length,
  }), [state.settings.defaultModel, state.sessions, agents.length]);

  // redesenha os quadros da parede quando os dados mudam
  useEffect(() => {
    const b = boardsRef.current;
    if (b.left) {
      drawQuestionBoard(b.left.canvas, lastQuestion, selected?.name ?? '');
      b.left.tex.needsUpdate = true;
    }
    if (b.right) {
      drawStatusBoard(b.right.canvas, statusInfo);
      b.right.tex.needsUpdate = true;
    }
  }, [lastQuestion, statusInfo, selected, idsKey]);

  const thinking = busy && state.currentSession?.personalityId === selected?.id;
  const speakerTurn = meetingSpeaker
    ? [...meetingTurns].reverse().find(t => t.agentId === meetingSpeaker) ?? null
    : null;
  const balloonThinking = thinking || (!!meetingSpeaker && !speakerTurn);
  const balloonText = meetingSpeaker ? (speakerTurn?.text ?? '') : lastReply;
  const showBalloon = balloonThinking || balloonText !== '';

  // ata sempre rolada pro fim
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [meetingTurns, meetingSpeaker]);

  const runMeeting = useCallback(async (topic: string) => {
    if (meetingRunning || agents.length === 0) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setMeetingTurns([]);
    setPastTopic(null);
    setMeetingTopic(topic);
    setHistoryOpen(false);
    setViewingMeeting(null);
    setMeetingRunning(true);
    const history: { agentId: string; name: string; text: string }[] = [];
    // quem foi marcado com @ fala primeiro, na ordem da menção
    const mentionedIds = parseMentions(topic, agents);
    const ordered = [
      ...mentionedIds.map(id => agents.find(a => a.id === id)!).filter(Boolean),
      ...agents.filter(a => !mentionedIds.includes(a.id)),
    ];
    try {
      // pré-voo: garante que o backend está de pé antes de gastar 4 chamadas
      try {
        const h = await fetch('/api/health');
        if (!h.ok) throw new Error(`HTTP ${h.status}`);
      } catch (err) {
        setMeetingTurns([{
          agentId: agents[0].id,
          name: 'Sistema',
          text: `…(não consegui falar com o backend: ${(err as Error)?.message}. Confere se o "npm run dev" está rodando no PC (portas 5173 + 3001) e se o Ollama está no ar, depois tenta de novo)…`,
        }]);
        return;
      }
      // memória: última ata salva no Postgres vira contexto
      const past = await fetchLastMeeting();
      if (ctrl.signal.aborted) return;
      const pastText = past ? formatPastMeeting(past) : '';
      if (past) setPastTopic(past.topic);
      for (const a of ordered) {
        if (ctrl.signal.aborted) break;
        setMeetingSpeaker(a.id);
        const peers = agents.filter(x => x.id !== a.id).map(x => x.name);
        const messages = buildTurnMessages(a, peers, topic, history, pastText);
        let text = '';
        // cada fala tem seu próprio cancelamento: dá pra PULAR sem parar a reunião
        const turnCtrl = new AbortController();
        turnAbortRef.current = turnCtrl;
        try {
          text = await fetchTurn(getModelFor(state.settings, a.id), messages, {
            temperature: state.settings.temperature,
            // Qwen/thinking models precisam de folga: usa o mesmo limite do chat
            num_predict: state.settings.maxTokens,
          }, turnCtrl.signal, { zenApiKey: state.settings.zenApiKey, providers: state.settings.providers });
        } catch (err) {
          if (ctrl.signal.aborted) break;
          if (turnCtrl.signal.aborted) {
            text = '…(passou a vez)…';
          } else {
            text = `…(erro ao chamar o modelo: ${(err as Error)?.message ?? 'falha de rede'})…`;
          }
        } finally {
          turnAbortRef.current = null;
        }
        if (ctrl.signal.aborted) break;
        if (!text) {
          text = '…(voltei vazio — aumenta o Max tokens em Ajustes e tenta de novo)…';
        }
        history.push({ agentId: a.id, name: a.name, text });
        setMeetingTurns([...history]);
      }
      // salva a ata no Postgres (falha silenciosa se o banco estiver fora)
      if (history.length > 0 && !ctrl.signal.aborted) {
        await saveMeeting(topic, history);
      }
    } finally {
      setMeetingSpeaker(null);
      setMeetingRunning(false);
      abortRef.current = null;
    }
  }, [agents, meetingRunning, state.settings]);

  const stopMeeting = useCallback(() => {
    abortRef.current?.abort();
    turnAbortRef.current?.abort();
  }, []);

  const skipTurn = useCallback(() => {
    turnAbortRef.current?.abort();
  }, []);

  /* ---------- histórico de reuniões ---------- */
  const toggleHistory = useCallback(async () => {
    if (historyOpen || viewingMeeting) {
      setHistoryOpen(false);
      setViewingMeeting(null);
      return;
    }
    setHistoryOpen(true);
    setSavedMeetings(await fetchMeetings());
  }, [historyOpen, viewingMeeting]);

  const openSavedMeeting = useCallback(async (id: number) => {
    const m = await fetchMeeting(id);
    if (m) setViewingMeeting(m);
  }, []);

  /** pega um tema antigo e joga numa reunião nova */
  const rediscuss = useCallback((topic: string) => {
    setMeetingMode(true);
    setHistoryOpen(false);
    setViewingMeeting(null);
    runMeeting(topic);
  }, [runMeeting]);

  /* ---------- terminal dos agentes ---------- */
  const runTermEntry = useCallback(async (entry: TermEntry) => {
    setTermLog(prev => prev.map(e => (e.id === entry.id ? { ...e, status: 'running', output: undefined } : e)));
    const r = await runCommand(entry.cmd);
    const ok = r.code === 0 && !r.timedOut;
    setTermLog(prev => prev.map(e => (e.id === entry.id ? {
      ...e,
      status: ok ? 'done' : 'error',
      code: r.code,
      output: (r.output.trim() || '(sem saída)') + (r.timedOut ? '\n⏱ tempo esgotado (90s)' : ''),
    } : e)));
  }, []);

  const runAllPending = useCallback(async () => {
    for (const e of termLog.filter(x => x.status === 'pending')) {
      await runTermEntry(e);
    }
  }, [termLog, runTermEntry]);

  /**
   * FEEDBACK LOOP: manda os comandos que FALHARAM (+ saída) de volta pro agente.
   * Ele corrige os arquivos em workspace/ e devolve os comandos certos pra fila.
   */
  const askAgentToFix = useCallback(async () => {
    if (fixing || busy || !selected) return;
    if (state.currentSession?.personalityId !== selected.id) return;
    const failed = termLog.filter(e => e.status === 'error');
    if (failed.length === 0) return;
    setFixing(true);
    setBusy(true);
    setTaskNote(null);
    try {
      const report = failed
        .map(e => `$ ${e.cmd}\n  código de saída: ${e.code}\n  saída:\n${(e.output ?? '').slice(0, 2000)}`)
        .join('\n\n');
      const reply = await streamMessage(
        `FEEDBACK DO TERMINAL: os comandos que você sugeriu FALHARAM ao rodar em workspace/. ` +
        `Corrija os arquivos (entregue de novo no formato de arquivo) e devolva os comandos certos:\n\n${report}`,
        TASK_INSTRUCTION
      );
      if (!reply) return;
      const files = extractFiles(reply);
      if (files.length > 0) {
        const saved = await saveFilesToWorkspace(files);
        if (saved.length > 0) {
          setTaskNote(`🔧 correção aplicada: ${saved.length} arquivo(s) atualizados (${saved.slice(0, 3).join(', ')})`);
        }
      }
      const cmds = extractCommands(reply);
      if (cmds.length > 0) {
        // falhas antigas ficam no histórico (✖) e os comandos corrigidos entram na fila
        setTermLog(prev => [
          ...prev,
          ...cmds.map((cmd, i) => ({ id: `fix-${Date.now()}-${i}`, cmd, status: 'pending' as const })),
        ]);
        setTermOpen(true);
      }
    } finally {
      setBusy(false);
      setFixing(false);
    }
  }, [fixing, busy, selected, state.currentSession, streamMessage, termLog]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy || meetingRunning || !selected) return;
    if (meetingMode) {
      setInput('');
      runMeeting(text);
      return;
    }
    if (state.currentSession?.personalityId !== selected.id) return;
    setInput('');
    setBusy(true);
    setTaskNote(null);
    try {
      const reply = await streamMessage(text, taskMode ? TASK_INSTRUCTION : undefined);
      // modo tarefa: o agente devolve arquivos "### arquivo: ..." → salvos em workspace/
      // e comandos "### comando: ..." → vão pra fila do terminal 🖥️
      if (taskMode && reply) {
        const files = extractFiles(reply);
        if (files.length > 0) {
          const saved = await saveFilesToWorkspace(files);
          setTaskNote(
            saved.length > 0
              ? `💾 ${saved.length} arquivo(s) entregues em workspace/: ${saved.slice(0, 3).join(', ')}${saved.length > 3 ? '…' : ''}`
              : '⚠️ o agente respondeu, mas não consegui salvar os arquivos (backend no ar?)'
          );
        }
        const cmds = extractCommands(reply);
        if (cmds.length > 0) {
          setTermLog(prev => [
            ...prev,
            ...cmds.map((cmd, i) => ({ id: `${Date.now()}-${i}`, cmd, status: 'pending' as const })),
          ]);
          setTermOpen(true);
        }
      }
    } finally {
      setBusy(false);
    }
  }, [input, busy, meetingRunning, meetingMode, taskMode, selected, state.currentSession, streamMessage, runMeeting]);

  if (agents.length === 0) {
    return <div className="office-empty">Nenhum agente carregado.</div>;
  }

  return (
    <div className="office-wrap">
      <div ref={mountRef} className="office-canvas">
        <div
          ref={balloonRef}
          className="speech-balloon"
          style={{ opacity: 0, visibility: showBalloon ? 'visible' : 'hidden' }}
        >
          {balloonThinking ? (
            <span className="balloon-thinking"><i /><i /><i /></span>
          ) : (
            <span className="balloon-text">{balloonText.slice(0, 600)}{balloonText.length > 600 ? '…' : ''}</span>
          )}
        </div>
        {!panelOpen && (
          <button
            className="agents-toggle"
            onClick={() => setPanelOpen(true)}
            aria-label="Abrir lista de agentes"
            title="Equipe"
          >
            👥
          </button>
        )}
        <aside
          className={`agents-panel ${panelOpen ? 'open' : ''}`}
          style={{ display: panelOpen ? undefined : 'none' }}
          aria-label="Equipe"
        >
          <div className="agents-head">
            <div className="agents-title">Equipe · {agents.length}</div>
            <button
              className="agents-min"
              onClick={() => setPanelOpen(false)}
              aria-label="Minimizar painel da equipe"
              title="Minimizar (reabre no botão 👥)"
            >
              —
            </button>
          </div>
          {agents.map((a, i) => {
            const isSel = selected?.id === a.id;
            const isBusy = busy && state.currentSession?.personalityId === a.id;
            const isSpeaking = meetingSpeaker === a.id;
            const sess = state.sessions
              .filter(s => s.personalityId === a.id)
              .sort((x, y) => y.updatedAt.getTime() - x.updatedAt.getTime())[0];
            const prev = [...(sess?.messages ?? [])].reverse()
              .find(m => m.role === 'assistant' && m.content.trim())?.content ?? '';
            return (
              <button
                key={a.id}
                className={`agent-card ${isSel ? 'active' : ''}`}
                onClick={() => {
                  setSelectedId(a.id);
                  if (window.innerWidth < 900) setPanelOpen(false);
                }}
              >
                <span className="agent-card-avatar" style={{ background: avatarGradient(a.id) }}>
                  {avatarEmoji(a.id, a.name)}
                </span>
                <span className="agent-card-main">
                  <span className="agent-card-top">
                    <b>{a.name}</b>
                    <kbd>{i + 1}</kbd>
                  </span>
                  <span className="agent-card-role" title={a.description}>{ROLE_MAP[a.id] ?? a.description}</span>
                  <span className="agent-card-model" title="Modelo usado por este agente">
                    {getModelFor(state.settings, a.id).split('/').pop()}
                  </span>
                  <span className={`agent-card-status ${isBusy ? 'busy' : ''} ${isSpeaking ? 'speaking' : ''}`}>
                    <i />{isSpeaking ? 'falando…' : isBusy ? 'respondendo…' : 'trabalhando'}
                  </span>
                  {prev && (
                    <span className="agent-card-prev">
                      “{prev.slice(0, 64)}{prev.length > 64 ? '…' : ''}”
                    </span>
                  )}
                </span>
              </button>
            );
          })}
          <div className="agents-hint">teclas 1–{agents.length} trocam de agente</div>
        </aside>
        {(meetingTurns.length > 0 || meetingRunning || historyOpen || viewingMeeting) && (
          <aside className="meeting-panel" aria-label="Reuniões">
            <div className="meeting-head">
              <b>
                {viewingMeeting ? '📜 Ata antiga' : historyOpen ? '📜 Reuniões anteriores' : '🎙️ Ata da reunião'}
              </b>
              <div className="meeting-head-actions">
                {meetingRunning && !viewingMeeting && !historyOpen && (
                  <button className="meeting-close" onClick={skipTurn} aria-label="Pular fala" title="Pular a fala atual">
                    ⏭
                  </button>
                )}
                {viewingMeeting && (
                  <button
                    className="meeting-close"
                    onClick={() => setViewingMeeting(null)}
                    aria-label="Voltar pra lista"
                    title="Voltar pra lista"
                  >
                    ←
                  </button>
                )}
                {!meetingRunning && (
                  <button
                    className="meeting-close"
                    onClick={() => {
                      setMeetingTurns([]);
                      setPastTopic(null);
                      setMeetingTopic(null);
                      setHistoryOpen(false);
                      setViewingMeeting(null);
                    }}
                    aria-label="Fechar painel"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {viewingMeeting ? (
              /* ata antiga salva no banco, só leitura */
              <>
                <div className="meeting-topic" title="Tema dessa reunião">
                  📌 {viewingMeeting.topic}
                </div>
                <div className="meeting-memory">
                  🗓 {new Date(viewingMeeting.created_at).toLocaleString('pt-BR', {
                    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
                  })}
                </div>
                <div className="meeting-turns">
                  {viewingMeeting.turns.map((t, i) => (
                    <div key={`${t.agentId}-${i}`} className="turn">
                      <span className="turn-avatar" style={{ background: avatarGradient(t.agentId) }}>
                        {avatarEmoji(t.agentId, t.agentName)}
                      </span>
                      <div className="turn-body">
                        <b>{t.agentName}</b>
                        <p>{t.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  className="meeting-again"
                  onClick={() => rediscuss(viewingMeeting.topic)}
                  disabled={meetingRunning}
                  title="Começa uma reunião nova com esse tema"
                >
                  🎙️ discutir esse tema de novo
                </button>
              </>
            ) : historyOpen ? (
              /* lista de atas salvas no Postgres */
              <div className="meeting-turns">
                {savedMeetings === null && <div className="meeting-empty">carregando…</div>}
                {savedMeetings?.length === 0 && (
                  <div className="meeting-empty">
                    Nenhuma ata salva ainda. Comece uma reunião no modo 🎙️!
                  </div>
                )}
                {savedMeetings?.map(m => (
                  <button
                    key={m.id}
                    className="past-meeting"
                    onClick={() => openSavedMeeting(m.id)}
                    title="Abrir esta ata"
                  >
                    <span className="past-meeting-topic">{m.topic}</span>
                    <span className="past-meeting-meta">
                      {new Date(m.created_at).toLocaleString('pt-BR', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                      })}
                      {' • '}{m.turns} fala{m.turns === 1 ? '' : 's'}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              /* ata da reunião atual */
              <>
                {meetingTopic && (
                  <div className="meeting-topic" title="Tema desta reunião">
                    📌 {meetingTopic}
                  </div>
                )}
                {pastTopic && (
                  <div className="meeting-memory" title="Os agentes receberam o resumo da última reunião como contexto">
                    🔗 lembra: “{pastTopic.length > 60 ? pastTopic.slice(0, 60) + '…' : pastTopic}”
                  </div>
                )}
                <div ref={transcriptRef} className="meeting-turns">
                  {meetingTurns.map((t, i) => {
                    const ag = agents.find(a => a.id === t.agentId);
                    return (
                      <div key={`${t.agentId}-${i}`} className="turn">
                        <span
                          className="turn-avatar"
                          style={{ background: ag ? avatarGradient(ag.id) : '#555' }}
                        >
                          {ag ? avatarEmoji(ag.id, ag.name) : '•'}
                        </span>
                        <div className="turn-body">
                          <b>{t.name}</b>
                          <p>{t.text}</p>
                        </div>
                      </div>
                    );
                  })}
                  {meetingRunning && (
                    <div className="turn speaking">
                      <span className="turn-avatar pulse">🎙️</span>
                      <div className="turn-body">
                        <b>{agents.find(a => a.id === meetingSpeaker)?.name ?? '…'} está falando…</b>
                      </div>
                    </div>
                  )}
                </div>
                <div className="meeting-foot">salva no banco • vira memória da próxima reunião</div>
              </>
            )}
          </aside>
        )}
        {termOpen && (
          <aside className="terminal-panel" aria-label="Terminal">
            <div className="terminal-head">
              <b>🖥️ Terminal</b>
              <div className="meeting-head-actions">
                {termLog.some(e => e.status === 'error') && (
                  <button
                    className="meeting-close term-fix"
                    onClick={askAgentToFix}
                    disabled={fixing || busy}
                    title={`Manda os erros pro ${selected?.name ?? 'agente'} corrigir (ele ajusta os arquivos e devolve novos comandos)`}
                  >
                    {fixing ? 'corrigindo…' : '🔧 corrigir'}
                  </button>
                )}
                {termLog.some(e => e.status === 'pending') && (
                  <button
                    className="meeting-close"
                    onClick={runAllPending}
                    title="Roda todos os comandos pendentes, em sequência"
                  >
                    ▶ todos
                  </button>
                )}
                {termLog.length > 0 && (
                  <button
                    className="meeting-close"
                    onClick={() => setTermLog([])}
                    title="Limpar o histórico do terminal"
                  >
                    🧹
                  </button>
                )}
                <button
                  className="meeting-close"
                  onClick={() => setTermOpen(false)}
                  aria-label="Fechar terminal"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="terminal-body">
              {termLog.length === 0 && (
                <div className="terminal-empty">
                  Nenhum comando ainda. Peça uma tarefa no modo 🛠️ — os comandos do agente caem aqui.
                </div>
              )}
              {termLog.map(e => (
                <div key={e.id} className={`term-entry ${e.status}`}>
                  <div className="term-cmd-row">
                    <code className="term-cmd">$ {e.cmd}</code>
                    {e.status === 'pending' && (
                      <button
                        className="term-run"
                        onClick={() => runTermEntry(e)}
                        title="Executar este comando em workspace/"
                      >
                        ▶
                      </button>
                    )}
                    {e.status === 'running' && <span className="term-status running">rodando…</span>}
                    {e.status === 'done' && <span className="term-status ok">✔ {e.code}</span>}
                    {e.status === 'error' && <span className="term-status err">✖ {e.code}</span>}
                  </div>
                  {e.output !== undefined && (
                    <pre className="term-out">{e.output}</pre>
                  )}
                </div>
              ))}
            </div>
            <div className="meeting-foot">comandos rodam dentro de workspace/ • timeout 90s</div>
          </aside>
        )}
        <div className="office-hint">arraste p/ girar • scroll = zoom • clique no boneco p/ focar • 1–{agents.length} troca de agente</div>
      </div>

      <div className="office-bar">
        {taskNote && <div className="task-note">{taskNote}</div>}
        <form
          className="office-composer"
          onSubmit={e => { e.preventDefault(); mentions.close(); send(); }}
        >
          {mentions.mention && mentions.mention.matches.length > 0 && (
            <MentionPopup
              matches={mentions.mention.matches}
              active={mentions.mention.active}
              onPick={completeMention}
            />
          )}
          <button
            type="button"
            className={`meet-toggle ${taskMode ? 'on task' : ''}`}
            onClick={() => {
              setTaskMode(v => !v);
              if (!taskMode) setMeetingMode(false);
            }}
            title="Modo tarefa: o agente EXECUTA de verdade e entrega arquivos (salvos em workspace/)"
            aria-label="Alternar modo tarefa"
            aria-pressed={taskMode}
          >
            🛠️
          </button>
          <button
            type="button"
            className={`meet-toggle ${meetingMode ? 'on' : ''}`}
            onClick={() => {
              setMeetingMode(v => !v);
              if (!meetingMode) setTaskMode(false);
            }}
            title="Modo reunião: os agentes conversam entre si"
            aria-label="Alternar modo reunião"
            aria-pressed={meetingMode}
          >
            🎙️
          </button>
          <button
            type="button"
            className={`meet-toggle ${historyOpen || viewingMeeting ? 'on' : ''}`}
            onClick={toggleHistory}
            title="Histórico de reuniões: ver atas antigas e rediscutir temas"
            aria-label="Histórico de reuniões"
            aria-pressed={historyOpen || !!viewingMeeting}
          >
            📜
          </button>
          <button
            type="button"
            className={`meet-toggle ${termOpen ? 'on' : ''}`}
            onClick={() => setTermOpen(v => !v)}
            title="Terminal: comandos sugeridos pelos agentes e a saída da execução"
            aria-label="Terminal"
            aria-pressed={termOpen}
          >
            🖥️
            {termLog.some(e => e.status === 'pending') && (
              <span className="term-badge">{termLog.filter(e => e.status === 'pending').length}</span>
            )}
          </button>
          <input
            ref={inputRef}
            value={input}
            onChange={e => {
              setInput(e.target.value);
              setTaskNote(null);
              mentions.update(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onKeyDown={e => {
              const pop = mentions.mention;
              if (pop && pop.matches.length > 0) {
                if (e.key === 'ArrowDown') { e.preventDefault(); mentions.move(1); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); mentions.move(-1); return; }
                if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); completeMention(); return; }
              }
              if (e.key === 'Escape' && pop) mentions.close();
            }}
            placeholder={
              meetingMode
                ? 'Tema da reunião… (@ chama alguém primeiro)'
                : taskMode
                  ? `Pedir tarefa pra ${selected?.name ?? '…'}… (ex.: cria uma landing page de cafeteria)`
                  : (selected ? `Falar com ${selected.name}… (@ menciona)` : 'Escolha um agente…')
            }
            disabled={busy || meetingRunning || !selected}
            className="office-input"
          />
          {meetingRunning && (
            <button
              type="button"
              className="office-send skip"
              onClick={skipTurn}
              aria-label="Pular fala atual"
              title="Pular a fala atual (a reunião continua)"
            >
              ⏭
            </button>
          )}
          {meetingRunning ? (
            <button
              type="button"
              className="office-send stop"
              onClick={stopMeeting}
              aria-label="Parar reunião"
              title="Parar reunião"
            >
              ⏹
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim() || busy || !selected}
              className="office-send"
              aria-label="Enviar"
            >
              {busy ? '…' : '↑'}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
