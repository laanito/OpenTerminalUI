import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  GridHelper,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  WebGLRenderer,
  type Material,
} from "three";

const PARTICLE_COUNT = 1000;
const TRANSITION_DURATION_MS = 800;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function mountTerminalBackgroundScene(container: HTMLDivElement): (() => void) | undefined {
  const scene = new Scene();
  const camera = new PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 900);
  camera.position.set(0, 10, 120);

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
  } catch (error) {
    console.warn("TerminalBackground disabled: WebGL unavailable", error);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  const sceneRoot = new Group();
  scene.add(sceneRoot);

  const particleGeometry = new BufferGeometry();
  const particlePositions = new Float32Array(PARTICLE_COUNT * 3);
  const particleBasePositions = new Float32Array(PARTICLE_COUNT * 3);
  const particleColors = new Float32Array(PARTICLE_COUNT * 3);
  const particleScatterVectors = new Float32Array(PARTICLE_COUNT * 3);
  const amberColor = new Color("#ff9500");
  const cyanColor = new Color("#18ffff");

  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    const i3 = i * 3;
    const radius = 80 + Math.random() * 90;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * 0.55 * Math.cos(phi);
    const z = radius * Math.sin(phi) * Math.sin(theta);

    particlePositions[i3] = x;
    particlePositions[i3 + 1] = y;
    particlePositions[i3 + 2] = z;
    particleBasePositions[i3] = x;
    particleBasePositions[i3 + 1] = y;
    particleBasePositions[i3 + 2] = z;

    const scatterTheta = Math.random() * Math.PI * 2;
    const scatterPhi = Math.acos(2 * Math.random() - 1);
    particleScatterVectors[i3] = Math.sin(scatterPhi) * Math.cos(scatterTheta);
    particleScatterVectors[i3 + 1] = Math.cos(scatterPhi);
    particleScatterVectors[i3 + 2] = Math.sin(scatterPhi) * Math.sin(scatterTheta);

    const color = Math.random() > 0.35 ? amberColor : cyanColor;
    const intensity = color === amberColor ? 0.2 : 0.11;
    particleColors[i3] = color.r * intensity;
    particleColors[i3 + 1] = color.g * intensity;
    particleColors[i3 + 2] = color.b * intensity;
  }

  particleGeometry.setAttribute("position", new BufferAttribute(particlePositions, 3));
  particleGeometry.setAttribute("color", new BufferAttribute(particleColors, 3));
  const particleMaterial = new PointsMaterial({
    size: 1.35,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const particleCloud = new Points(particleGeometry, particleMaterial);
  sceneRoot.add(particleCloud);

  const wireGeometry = new PlaneGeometry(340, 230, 64, 64);
  const wireMaterial = new MeshBasicMaterial({
    color: 0xff9500,
    wireframe: true,
    transparent: true,
    opacity: 0.05,
  });
  const wireSurface = new Mesh(wireGeometry, wireMaterial);
  wireSurface.rotation.x = -Math.PI / 2.75;
  wireSurface.position.set(0, -35, -70);
  sceneRoot.add(wireSurface);

  const grid = new GridHelper(460, 56, 0xffffff, 0xffffff);
  const gridMaterial = grid.material as Material & { opacity: number; transparent: boolean };
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.03;
  grid.position.set(0, -52, -130);
  sceneRoot.add(grid);

  let mouseX = 0;
  let mouseY = 0;
  let transitionStart = -1;
  const onMouseMove = (event: MouseEvent) => {
    mouseX = (event.clientX / window.innerWidth) * 2 - 1;
    mouseY = (event.clientY / window.innerHeight) * 2 - 1;
  };
  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  const onTransition = () => {
    transitionStart = performance.now();
  };

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("resize", onResize);
  window.addEventListener("ot-terminal-transition", onTransition as EventListener);

  let rafId = 0;
  const animate = (time: number) => {
    const nowSec = time * 0.001;
    const positionsAttr = particleGeometry.getAttribute("position") as BufferAttribute;
    const positions = positionsAttr.array as Float32Array;
    const transitionProgress = transitionStart < 0 ? 0 : clamp((time - transitionStart) / TRANSITION_DURATION_MS, 0, 1);
    const transitionEase = easeOutCubic(transitionProgress);
    const scatterStrength = Math.sin(Math.PI * transitionProgress) * 12;

    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      const i3 = i * 3;
      const baseX = particleBasePositions[i3];
      const baseY = particleBasePositions[i3 + 1];
      const baseZ = particleBasePositions[i3 + 2];
      positions[i3] = baseX + Math.sin(nowSec * 0.22 + i * 0.017) * 1.8 + particleScatterVectors[i3] * scatterStrength;
      positions[i3 + 1] = baseY + Math.cos(nowSec * 0.19 + i * 0.013) * 1.3 + particleScatterVectors[i3 + 1] * scatterStrength;
      positions[i3 + 2] = baseZ + Math.sin(nowSec * 0.16 + i * 0.019) * 1.6 + particleScatterVectors[i3 + 2] * scatterStrength;
    }
    positionsAttr.needsUpdate = true;

    const wireAttr = wireGeometry.getAttribute("position") as BufferAttribute;
    const wirePositions = wireAttr.array as Float32Array;
    for (let i = 0; i < wirePositions.length; i += 3) {
      const vx = wirePositions[i];
      const vz = wirePositions[i + 2];
      wirePositions[i + 1] = Math.sin(vx * 0.045 + nowSec * 0.95) * 2.4 + Math.cos(vz * 0.04 + nowSec * 0.72) * 1.6;
    }
    wireAttr.needsUpdate = true;

    sceneRoot.rotation.y += (mouseX * 0.09 - sceneRoot.rotation.y) * 0.045;
    sceneRoot.rotation.x += (-mouseY * 0.06 - sceneRoot.rotation.x) * 0.045;
    const baseZ = transitionStart >= 0 ? 120 - 24 * transitionEase : 120;
    camera.position.z += (baseZ - camera.position.z) * 0.08;
    if (transitionStart >= 0 && transitionProgress >= 1) transitionStart = -1;
    renderer.render(scene, camera);
    rafId = window.requestAnimationFrame(animate);
  };
  rafId = window.requestAnimationFrame(animate);

  return () => {
    window.cancelAnimationFrame(rafId);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("ot-terminal-transition", onTransition as EventListener);
    sceneRoot.remove(particleCloud, wireSurface, grid);
    particleGeometry.dispose();
    particleMaterial.dispose();
    wireGeometry.dispose();
    wireMaterial.dispose();
    grid.geometry.dispose();
    gridMaterial.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
  };
}
