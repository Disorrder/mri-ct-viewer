/**
 * The Three.js side of the demo. Pure imperative Three.js (no react-three-fiber)
 * so the rendering pipeline stays readable: you can see exactly how a NIfTI
 * volume becomes a GPU 3D texture and gets ray-marched.
 *
 * Coordinate convention
 * ---------------------
 * We render in *voxel-axis space*: the volume's i/j/k axes map to the box's
 * X/Y/Z. The full voxel->world (RAS) affine from the header is shown in the UI
 * panel but not baked into geometry — keeping the math transparent. The default
 * camera framing (direction + "up") is derived from that affine so the start
 * view faces the patient's anterior (the face), whatever orientation the volume
 * is stored in — see homeCameraDirs.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Volume } from "../volume";
import { SLICE_FRAG, SLICE_VERT, VOLUME_FRAG, VOLUME_VERT } from "./glsl";
import {
  ANATOMY_WORDS,
  buildViewCubeGeometry,
  faceLabelsFromAffine,
  GIZMO_BEVEL,
  GIZMO_EDGE,
  GIZMO_FACE,
  GIZMO_HOVER,
  homeCameraDirs,
  makeLabelTexture,
  orientGizmoLabel,
} from "./viewcube";

// Render layers — in the MPR layout each viewport's camera sees only what it
// should. slicePlanes/crosshairs are ordered [sagittal, coronal, axial].
const L_PLANE = [1, 2, 3]; // sagittal, coronal, axial slice planes
const L_CROSS = [4, 5, 6]; // their crosshairs (visible in the 2D views only)

// Standard radiology plane colors (also used for crosshair lines + titles).
export const PLANE_COLORS = { axial: "#39d353", coronal: "#f5c542", sagittal: "#ff5a3c" };
const C_AXIAL = 0x39d353;
const C_CORONAL = 0xf5c542;
const C_SAGITTAL = 0xff5a3c;

const GIZMO_PX = 128; // on-screen size of the corner orientation cube
const HOME_DIST = 2.7; // camera distance for the default framing (object-space units)

/** Subset of EXT_disjoint_timer_query_webgl2 we use for real GPU timing. */
interface TimerExt {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

/** Live metrics surfaced to the ScenePerf overlay. */
export interface ViewerStats {
  fps: number; // exponentially smoothed frames/sec (the headline number)
  frameMs: number; // raw interval since the previous frame — drives the 1%-low math
  cpuMs: number; // main-thread time spent in render() this frame
  gpuMs: number; // measured GPU time per frame (timer query)
  drawCalls: number;
  triangles: number;
  lines: number;
  points: number;
  textures: number;
  geometries: number;
  programs: number;
  jsHeapMB: number;
  jsHeapLimitMB: number;
  texBytes: number; // estimated GPU texture memory — dominated by the 3D volume
  steps: number; // ray-march step budget (uSteps uniform)
  volumePixels: number; // device pixels the ray-march box covers this frame
  viewports: number; // viewports drawn this frame (1, or 4 in the MPR grid)
  drawW: number; // drawing-buffer size in device pixels
  drawH: number;
  dpr: number; // renderer pixel ratio
}

/** Result of mapping a pointer in a 2D MPR viewport to slice positions. */
export type SliceKey = "sliceX" | "sliceY" | "sliceZ";
export interface SlicePick {
  updates: Partial<Record<SliceKey, number>>;
  horizontalKey: SliceKey; // slice axis along the viewport's horizontal
  verticalKey: SliceKey; // slice axis along the viewport's vertical
}

/** Viewport arrangement. On phones the top bar drives the three single planes. */
export type Layout = "3D" | "MPR" | "axial" | "coronal" | "sagittal";

export interface ViewerParams {
  layout: Layout;
  mode: "Volume" | "Slices";
  technique: number; // 0 MIP, 1 Isosurface, 2 DVR
  colormap: number;
  steps: number;
  windowLow: number;
  windowHigh: number;
  iso: number;
  density: number;
  sliceX: number; // 0..1
  sliceY: number;
  sliceZ: number;
  showX: boolean;
  showY: boolean;
  showZ: boolean;
  clipEnabled: boolean;
  clipMin: [number, number, number]; // box lower bounds per axis (0..1)
  clipMax: [number, number, number]; // box upper bounds per axis
  clipInvert: boolean; // cut out the box instead of keeping it
  thickness: number; // slab thickness for 2D slices, in mm (>= ~1)
  slabProjection: number; // 0 mean, 1 MIP, 2 MinIP
  autoRotate: boolean;
  background: string;
}

export class VolumeViewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private ro: ResizeObserver;
  private raf = 0;

  // Default 3D framing (a face-on three-quarter view), in box/voxel-axis space.
  // Derived from the volume's affine in setVolume so it tracks anatomy; resetView
  // and the initial view both snap the camera back to it.
  private homeDir = new THREE.Vector3();
  private homeUp = new THREE.Vector3(0, 0, 1);

  private texture: THREE.Data3DTexture | null = null;
  private volumeMesh: THREE.Mesh | null = null;
  private slicePlanes: THREE.Mesh[] = [];
  private wireframe: THREE.LineSegments | null = null;
  private clipBox: THREE.LineSegments | null = null; // crop-box outline
  private volumeMat: THREE.ShaderMaterial;
  private sliceMats: THREE.ShaderMaterial[] = []; // [sagittal, coronal, axial]
  private boxSize = new THREE.Vector3(1, 1, 1);
  private spacing = new THREE.Vector3(1, 1, 1); // voxel size in mm (per axis)
  private maxDimMm = 1; // largest physical extent — 1 object-space unit in mm
  private mprZoom = 1; // shared zoom of the three 2D views (wheel over a 2D view)

  // --- MPR (2x2) layout: three orthographic cameras + crosshair line objects.
  private camSagittal: THREE.OrthographicCamera;
  private camCoronal: THREE.OrthographicCamera;
  private camAxial: THREE.OrthographicCamera;
  private crosshairs: THREE.LineSegments[] = []; // [sagittal, coronal, axial]
  private crossMat: THREE.LineBasicMaterial;
  private layout: Layout = "3D";
  // Last params pushed from the UI. setVolume rebuilds the scene objects with
  // their default visibility (planes default to visible), so it re-applies these
  // at the end — otherwise a load that doesn't change any control (e.g. the new
  // volume's auto-window equals the current one, so leva skips the update) would
  // leave the freshly built slice planes showing in Volume mode.
  private lastParams: ViewerParams | null = null;

  // --- Orientation cube (ViewCube): rotates with the camera; click a face to
  // snap the 3D camera to that anatomical view (rotation only, no translation).
  private gizmoScene = new THREE.Scene();
  private gizmoCamera: THREE.PerspectiveCamera;
  private gizmoCube: THREE.Mesh | null = null;
  private gizmoMats: THREE.MeshBasicMaterial[] = []; // one per facet (6 faces + 20 bevels)
  private gizmoBaseColors: THREE.Color[] = []; // resting color of each facet, for the hover fade
  private gizmoLabelMeshes: THREE.Mesh[] = []; // floating word planes, one per face
  private hoveredGroup = -1; // facet (material index) currently under the pointer, or -1
  private raycaster = new THREE.Raycaster();
  private tmpV = new THREE.Vector3();

  // In MPR, orbit only when the drag starts in the 3D (bottom-right) quadrant;
  // the 2D quadrants drive the crosshair. This runs in the *capture* phase so it
  // sets controls.enabled before OrbitControls' own pointerdown handler reads it.
  private onPointerDownCapture = (e: PointerEvent) => {
    // Single-plane view: no orbit, no gizmo — the whole screen drives the crosshair.
    if (this.isSingle()) {
      this.controls.enabled = false;
      return;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Orientation cube (bottom-right corner) takes priority in both layouts.
    if (x >= rect.width - GIZMO_PX && y >= rect.height - GIZMO_PX) {
      const hit = this.raycastGizmo(
        (x - (rect.width - GIZMO_PX)) / GIZMO_PX,
        (y - (rect.height - GIZMO_PX)) / GIZMO_PX,
      );
      if (hit?.face) {
        e.stopPropagation();
        this.snapToFace(hit.face.normal.clone()); // face axis or corner/edge diagonal
      }
      this.controls.enabled = false; // never orbit/crosshair from the gizmo corner
      return;
    }

    // 3D layout: orbit anywhere. MPR: orbit only in the 3D (bottom-right) quadrant.
    this.controls.enabled = this.layout !== "MPR" || (x >= rect.width / 2 && y >= rect.height / 2);
  };

  // Hover feedback for the orientation cube: highlight whichever facet the pointer
  // is over (faces, edges and corners all light up) and show a pointer cursor.
  private onPointerMove = (e: PointerEvent) => {
    if (this.isSingle()) {
      // No orientation cube in single-plane views — nothing to hover.
      this.hoveredGroup = -1;
      this.renderer.domElement.style.cursor = "";
      return;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let group = -1;
    if (x >= rect.width - GIZMO_PX && y >= rect.height - GIZMO_PX) {
      const hit = this.raycastGizmo(
        (x - (rect.width - GIZMO_PX)) / GIZMO_PX,
        (y - (rect.height - GIZMO_PX)) / GIZMO_PX,
      );
      if (hit?.face) group = hit.face.materialIndex ?? -1;
    }
    this.hoveredGroup = group;
    this.renderer.domElement.style.cursor = group >= 0 ? "pointer" : "";
  };

  private onPointerLeave = () => {
    this.hoveredGroup = -1;
    this.renderer.domElement.style.cursor = "";
  };

  // Wheel over a 2D viewport zooms all three 2D views together; over the 3D
  // quadrant it falls through to OrbitControls' dolly. Capture phase so we can
  // stop OrbitControls from also handling a 2D-view wheel.
  private onWheelCapture = (e: WheelEvent) => {
    const single = this.isSingle();
    if (this.layout !== "MPR" && !single) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // In MPR the 3D quadrant dollies via OrbitControls; everywhere else (and the
    // whole single-plane screen) the wheel zooms the shared 2D scale.
    if (!single && x >= rect.width / 2 && y >= rect.height / 2) {
      this.controls.enabled = true;
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    this.mprZoom = Math.min(8, Math.max(0.4, this.mprZoom * Math.exp(-e.deltaY * 0.0015)));
    this.layoutCameras(this.container.clientWidth, this.container.clientHeight);
  };

  // --- Performance instrumentation (polled by the ScenePerf overlay).
  private gl: WebGL2RenderingContext;
  private timerExt: TimerExt | null = null;
  private gpuQuery: WebGLQuery | null = null;
  private gpuInFlight = false;
  private lastTs = 0;
  readonly gpuName: string;
  readonly gpuTimingSupported: boolean;
  readonly stats: ViewerStats = {
    fps: 0,
    frameMs: 0,
    cpuMs: 0,
    gpuMs: 0,
    drawCalls: 0,
    triangles: 0,
    lines: 0,
    points: 0,
    textures: 0,
    geometries: 0,
    programs: 0,
    jsHeapMB: 0,
    jsHeapLimitMB: 0,
    texBytes: 0,
    steps: 0,
    volumePixels: 0,
    viewports: 1,
    drawW: 0,
    drawH: 0,
    dpr: 1,
  };

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    // Raw WebGL2 context, for real GPU timing and the device name.
    this.gl = this.renderer.getContext() as WebGL2RenderingContext;
    this.timerExt = this.gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExt | null;
    this.gpuTimingSupported = this.timerExt !== null;
    const dbg = this.gl.getExtension("WEBGL_debug_renderer_info");
    this.gpuName = dbg
      ? String(
          this.gl.getParameter(
            (dbg as { UNMASKED_RENDERER_WEBGL: number }).UNMASKED_RENDERER_WEBGL,
          ),
        )
      : "WebGL2 device";

    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.01,
      100,
    );
    // Provisional framing for an identity (RAS) affine; setVolume recomputes it
    // from the real affine once a volume loads so the start view faces the patient.
    this.setHomeFromAffine([
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ]);
    this.camera.up.copy(this.homeUp);
    this.camera.position.copy(this.homeDir).multiplyScalar(HOME_DIST);

    // The 3D (perspective) camera also sees the slice-plane layers, so the
    // fullscreen "Slices" mode works; crosshair layers (4-6) stay off it.
    L_PLANE.forEach((l) => {
      this.camera.layers.enable(l);
    });

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.container.addEventListener("pointerdown", this.onPointerDownCapture, true);
    this.container.addEventListener("wheel", this.onWheelCapture, {
      capture: true,
      passive: false,
    });
    this.container.addEventListener("pointermove", this.onPointerMove);
    this.container.addEventListener("pointerleave", this.onPointerLeave);

    // Three fixed orthographic cameras for the 2D MPR viewports. Each sees only
    // its own slice plane + crosshair layer (set up in layoutCameras / setVolume).
    const makeOrtho = () => new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
    this.camAxial = makeOrtho(); // looks down -Z, X right / Y up
    this.camAxial.position.set(0, 0, 2);
    this.camAxial.up.set(0, 1, 0);
    this.camAxial.lookAt(0, 0, 0);
    this.camAxial.layers.set(L_PLANE[2]);
    this.camAxial.layers.enable(L_CROSS[2]);

    this.camCoronal = makeOrtho(); // looks down -Y, X right / Z up
    this.camCoronal.position.set(0, 2, 0);
    this.camCoronal.up.set(0, 0, 1);
    this.camCoronal.lookAt(0, 0, 0);
    this.camCoronal.layers.set(L_PLANE[1]);
    this.camCoronal.layers.enable(L_CROSS[1]);

    this.camSagittal = makeOrtho(); // looks down -X, Y right / Z up
    this.camSagittal.position.set(2, 0, 0);
    this.camSagittal.up.set(0, 0, 1);
    this.camSagittal.lookAt(0, 0, 0);
    this.camSagittal.layers.set(L_PLANE[0]);
    this.camSagittal.layers.enable(L_CROSS[0]);

    // Per-segment colors (set in setVolume): each crosshair line is tinted by the
    // plane it represents — axial green, coronal yellow, sagittal red.
    this.crossMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });

    // We render up to 4 viewports per frame; accumulate counters across them.
    this.renderer.info.autoReset = false;

    // Orientation cube — built with neutral RAS labels; relabeled per volume.
    this.gizmoCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 10);
    this.buildGizmo(["R", "L", "A", "P", "S", "I"]);

    // Shared uniforms are duplicated per-material (Three doesn't share uniform
    // objects across materials), so we keep both in sync in applyParams().
    this.volumeMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide, // march from the far faces -> works even inside the box
      uniforms: {
        uData: { value: null },
        uTechnique: { value: 2 },
        uColormap: { value: 0 },
        uSteps: { value: 256 },
        uClim: { value: new THREE.Vector2(0.1, 0.8) },
        uIso: { value: 0.3 },
        uDensity: { value: 0.4 },
        uTexel: { value: new THREE.Vector3() },
        uBoxSize: { value: this.boxSize },
        uClipEnabled: { value: 0 },
        uClipMin: { value: new THREE.Vector3(0, 0, 0) },
        uClipMax: { value: new THREE.Vector3(1, 1, 1) },
        uClipInvert: { value: 0 },
      },
      vertexShader: VOLUME_VERT,
      fragmentShader: VOLUME_FRAG,
    });

    // One slice material per orthogonal plane; each slabs along its own axis.
    // Order matches slicePlanes: [sagittal=X, coronal=Y, axial=Z]. Shared params
    // (window / colormap / thickness / projection) are synced in applyParams.
    this.sliceMats = [0, 1, 2].map(
      (axis) =>
        new THREE.ShaderMaterial({
          glslVersion: THREE.GLSL3,
          side: THREE.DoubleSide,
          uniforms: {
            uData: { value: null },
            uClim: { value: new THREE.Vector2(0.1, 0.8) },
            uColormap: { value: 0 },
            uBoxSize: { value: this.boxSize },
            uNormalAxis: { value: axis },
            uStepN: { value: 1 },
            uSamples: { value: 1 },
            uProjection: { value: 0 },
          },
          vertexShader: SLICE_VERT,
          fragmentShader: SLICE_FRAG,
        }),
    );

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);

    this.animate = this.animate.bind(this);
    this.raf = requestAnimationFrame(this.animate);
  }

  /** Build the GPU 3D texture + geometry for a freshly parsed volume. */
  setVolume(vol: Volume) {
    this.disposeVolumeObjects();

    // --- Upload voxels as a single-channel R8 3D texture.
    const tex = new THREE.Data3DTexture(vol.texture, vol.nx, vol.ny, vol.nz);
    tex.format = THREE.RedFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
    tex.unpackAlignment = 1; // R8 rows aren't 4-byte aligned for odd widths
    tex.needsUpdate = true;
    this.texture = tex;
    // Estimated GPU texture footprint: one R8 byte per voxel. This dwarfs every
    // other texture in the scene (gizmo labels), so it's the figure worth showing.
    this.stats.texBytes = vol.nx * vol.ny * vol.nz;

    // --- Physical box size = voxel count * spacing, normalized so the largest
    // axis = 1. This is what gives the brain its correct anatomical proportions.
    const sp = vol.spacing;
    const phys = new THREE.Vector3(vol.nx * sp[0], vol.ny * sp[1], vol.nz * sp[2]);
    const maxDim = Math.max(phys.x, phys.y, phys.z);
    this.boxSize.copy(phys).divideScalar(maxDim);
    this.maxDimMm = maxDim; // 1 object-space unit == maxDim mm (uniform)
    this.mprZoom = 1;

    this.spacing.set(sp[0], sp[1], sp[2]);
    this.volumeMat.uniforms.uData.value = tex;
    this.volumeMat.uniforms.uTexel.value = new THREE.Vector3(1 / vol.nx, 1 / vol.ny, 1 / vol.nz);
    this.volumeMat.uniforms.uBoxSize.value = this.boxSize;
    // Per-axis voxel step along each slab normal (1 voxel in [0,1] tex space).
    const stepN = [1 / vol.nx, 1 / vol.ny, 1 / vol.nz];
    this.sliceMats.forEach((m, i) => {
      m.uniforms.uData.value = tex;
      m.uniforms.uBoxSize.value = this.boxSize;
      m.uniforms.uStepN.value = stepN[i];
    });

    // --- Volume ray-march box.
    const boxGeo = new THREE.BoxGeometry(this.boxSize.x, this.boxSize.y, this.boxSize.z);
    this.volumeMesh = new THREE.Mesh(boxGeo, this.volumeMat);
    this.volumeMesh.renderOrder = 1;
    this.scene.add(this.volumeMesh);

    // --- Bounding-box wireframe (shown in both modes for spatial reference).
    this.wireframe = new THREE.LineSegments(
      new THREE.EdgesGeometry(boxGeo),
      new THREE.LineBasicMaterial({ color: 0x3a6ea5, transparent: true, opacity: 0.6 }),
    );
    this.scene.add(this.wireframe);

    // --- Crop-box outline (orange); scaled/positioned to the clip bounds in
    // applyParams. A unit cube on layer 0, so it appears only in 3D views.
    this.clipBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0xffa64d, transparent: true, opacity: 0.9 }),
    );
    this.clipBox.layers.set(0);
    this.clipBox.visible = false;
    this.scene.add(this.clipBox);

    // --- Three orthogonal slice planes. Each plane spans the two box axes it is
    // NOT normal to; its position along its normal axis is the slice location.
    this.volumeMesh.layers.set(0);
    this.wireframe.layers.set(0);

    const { x: bx, y: by, z: bz } = this.boxSize;
    const sagittal = new THREE.Mesh(new THREE.PlaneGeometry(bz, by), this.sliceMats[0]); // const X
    sagittal.rotation.y = Math.PI / 2;
    const coronal = new THREE.Mesh(new THREE.PlaneGeometry(bx, bz), this.sliceMats[1]); // const Y
    coronal.rotation.x = -Math.PI / 2;
    const axial = new THREE.Mesh(new THREE.PlaneGeometry(bx, by), this.sliceMats[2]); // const Z
    this.slicePlanes = [sagittal, coronal, axial];
    this.slicePlanes.forEach((p, i) => {
      p.layers.set(L_PLANE[i]);
      this.scene.add(p);
    });

    // --- Crosshairs: a "+" of full-width lines along each plane's two in-plane
    // axes, sitting at the slice intersection point (positioned in applyParams).
    const L = 4; // long enough to span the framed viewport
    const crossGeo = [
      [0, -L, 0, 0, L, 0, 0, 0, -L, 0, 0, L], // sagittal: Y & Z lines
      [-L, 0, 0, L, 0, 0, 0, 0, -L, 0, 0, L], // coronal:  X & Z lines
      [-L, 0, 0, L, 0, 0, 0, -L, 0, 0, L, 0], // axial:    X & Y lines
    ];
    // Each line is colored by the plane it represents (a line along axis A in a
    // view shows the plane normal to the other in-plane axis B).
    const G = new THREE.Color(C_AXIAL),
      Y = new THREE.Color(C_CORONAL),
      R = new THREE.Color(C_SAGITTAL);
    const crossCol = [
      [G, G, Y, Y], // sagittal view: Y-line→axial, Z-line→coronal
      [G, G, R, R], // coronal view:  X-line→axial, Z-line→sagittal
      [Y, Y, R, R], // axial view:    X-line→coronal, Y-line→sagittal
    ];
    this.crosshairs = crossGeo.map((pts, i) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      const cols: number[] = [];
      crossCol[i].forEach((c) => {
        cols.push(c.r, c.g, c.b);
      });
      g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
      const line = new THREE.LineSegments(g, this.crossMat);
      line.layers.set(L_CROSS[i]);
      line.renderOrder = 2;
      this.scene.add(line);
      return line;
    });

    this.layoutCameras(this.container.clientWidth, this.container.clientHeight);
    this.buildGizmo(faceLabelsFromAffine(vol.affine)); // anatomical labels from the affine

    // Frame the new volume face-on: derive the default view from its affine and
    // snap the 3D camera there, so loading a dataset starts looking at the face.
    this.setHomeFromAffine(vol.affine);
    this.resetView();

    // Re-apply the current UI state so the freshly built objects get the right
    // visibility/uniforms even if no control changes to trigger applyParams next.
    if (this.lastParams) this.applyParams(this.lastParams);
  }

  /** Fit each orthographic camera's frustum to its slice plane (no distortion). */
  private layoutCameras(w: number, h: number) {
    if (w === 0 || h === 0) return;
    const aspect = w / h;
    const fitFrustum = (cam: THREE.OrthographicCamera, halfR: number, halfU: number) => {
      const m = 1.08; // a little padding around the slice
      let hr = halfR * m;
      let hu = halfU * m;
      if (aspect > hr / hu) hr = hu * aspect;
      else hu = hr / aspect;
      hr /= this.mprZoom; // shared wheel zoom of the 2D views
      hu /= this.mprZoom;
      cam.left = -hr;
      cam.right = hr;
      cam.top = hu;
      cam.bottom = -hu;
      cam.updateProjectionMatrix();
    };
    const { x: bx, y: by, z: bz } = this.boxSize;
    fitFrustum(this.camAxial, bx / 2, by / 2);
    fitFrustum(this.camCoronal, bx / 2, bz / 2);
    fitFrustum(this.camSagittal, by / 2, bz / 2);
  }

  /** Visible extent (mm) of each 2D view — for the ruler overlay (V = vertical, H = horizontal). */
  getMprView() {
    const vmm = (cam: THREE.OrthographicCamera) => (cam.top - cam.bottom) * this.maxDimMm;
    const hmm = (cam: THREE.OrthographicCamera) => (cam.right - cam.left) * this.maxDimMm;
    return {
      coronalMm: vmm(this.camCoronal),
      sagittalMm: vmm(this.camSagittal),
      axialMm: vmm(this.camAxial),
      coronalMmH: hmm(this.camCoronal),
      sagittalMmH: hmm(this.camSagittal),
      axialMmH: hmm(this.camAxial),
    };
  }

  /** (Re)build the orientation cube (chamfered ViewCube) with the 6 face labels. */
  private buildGizmo(labels: string[]) {
    this.disposeGizmoCube();
    const H = 0.62,
      G = 0.4; // face plane distance / face half-width (the gap is the bevel)
    const { geometry, kinds } = buildViewCubeGeometry(H, G);

    // One material per facet so each can highlight independently on hover.
    const mats = kinds.map(
      (k) =>
        new THREE.MeshBasicMaterial({ color: (k === "face" ? GIZMO_FACE : GIZMO_BEVEL).clone() }),
    );
    const cube = new THREE.Mesh(geometry, mats);
    cube.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 1), // outline every facet so the cuts read clearly
        new THREE.LineBasicMaterial({ color: GIZMO_EDGE }),
      ),
    );

    // A floating word plane per face, oriented explicitly so the label reads upright
    // (sides standing on the superior axis; top/bottom aligned to anterior).
    const Z = new THREE.Vector3(0, 0, 1);
    const Y = new THREE.Vector3(0, 1, 0);
    const faces: ReadonlyArray<readonly [THREE.Vector3, THREE.Vector3]> = [
      [new THREE.Vector3(1, 0, 0), Z],
      [new THREE.Vector3(-1, 0, 0), Z],
      [new THREE.Vector3(0, 1, 0), Z],
      [new THREE.Vector3(0, -1, 0), Z],
      [new THREE.Vector3(0, 0, 1), Y],
      [new THREE.Vector3(0, 0, -1), Y],
    ];
    const labelMeshes = faces.map(([normal, up], i) => {
      const mat = new THREE.MeshBasicMaterial({
        map: makeLabelTexture(ANATOMY_WORDS[labels[i]] ?? labels[i]),
        transparent: true,
        depthWrite: false,
      });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(2 * G * 0.92, 2 * G * 0.92), mat);
      plane.position.copy(normal).multiplyScalar(H + 0.012); // float just above the face
      orientGizmoLabel(plane, normal, up);
      cube.add(plane);
      return plane;
    });

    this.gizmoCube = cube;
    this.gizmoMats = mats;
    this.gizmoBaseColors = mats.map((m) => m.color.clone());
    this.gizmoLabelMeshes = labelMeshes;
    this.hoveredGroup = -1;
    this.gizmoScene.add(cube);
  }

  private disposeGizmoCube() {
    if (!this.gizmoCube) return;
    this.gizmoScene.remove(this.gizmoCube);
    this.gizmoCube.geometry.dispose();
    this.gizmoMats.forEach((m) => {
      m.dispose();
    });
    this.gizmoLabelMeshes.forEach((p) => {
      p.geometry.dispose();
      const m = p.material as THREE.MeshBasicMaterial;
      m.map?.dispose();
      m.dispose();
    });
    this.gizmoCube.children.forEach((ch) => {
      if (ch instanceof THREE.LineSegments) {
        ch.geometry.dispose();
        (ch.material as THREE.Material).dispose();
      }
    });
    this.gizmoCube = null;
    this.gizmoMats = [];
    this.gizmoBaseColors = [];
    this.gizmoLabelMeshes = [];
  }

  /** Render the orientation cube into the bottom-right corner, synced to the camera. */
  private renderGizmo(w: number) {
    if (!this.gizmoCube) return;
    this.tmpV.copy(this.camera.position).sub(this.controls.target);
    const d = this.tmpV.length() || 1;
    this.gizmoCamera.position.copy(this.tmpV).multiplyScalar(2.6 / d);
    this.gizmoCamera.up.copy(this.camera.up);
    this.gizmoCamera.lookAt(0, 0, 0);
    const r = this.renderer;
    r.setViewport(w - GIZMO_PX, 0, GIZMO_PX, GIZMO_PX);
    r.setScissor(w - GIZMO_PX, 0, GIZMO_PX, GIZMO_PX);
    r.setScissorTest(true);
    r.clearDepth(); // float over the 3D view, not occluded by it
    r.render(this.gizmoScene, this.gizmoCamera);
    r.setScissorTest(false);
  }

  /** Hit-test the gizmo at (u,v) in [0,1] of its viewport. Cube is axis-aligned at
   *  the origin, so a hit's local face normal is already the world snap direction. */
  private raycastGizmo(u: number, v: number): THREE.Intersection | null {
    if (!this.gizmoCube) return null;
    this.raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, (1 - v) * 2 - 1), this.gizmoCamera);
    return this.raycaster.intersectObject(this.gizmoCube, false)[0] ?? null;
  }

  /** Ease every facet toward its hover/resting color — called per frame for a smooth fade. */
  private updateGizmoHover() {
    for (let i = 0; i < this.gizmoMats.length; i++) {
      const target = i === this.hoveredGroup ? GIZMO_HOVER : this.gizmoBaseColors[i];
      this.gizmoMats[i].color.lerp(target, 0.18);
    }
  }

  /** Rotate the 3D camera to look along an axis (keeps target + distance). */
  private snapToFace(axis: THREE.Vector3) {
    const dist = this.camera.position.distanceTo(this.controls.target);
    this.camera.position.copy(this.controls.target).addScaledVector(axis, dist);
    this.camera.up.set(0, Math.abs(axis.z) > 0.9 ? 1 : 0, Math.abs(axis.z) > 0.9 ? 0 : 1);
    this.controls.update();
  }

  /** True when one orthogonal plane fills the screen (the phone top-bar views). */
  private isSingle(l: Layout = this.layout): boolean {
    return l === "axial" || l === "coronal" || l === "sagittal";
  }

  /** The orthographic camera for the current single-plane layout, else null. */
  private singleCam(): THREE.OrthographicCamera | null {
    return this.layout === "axial"
      ? this.camAxial
      : this.layout === "coronal"
        ? this.camCoronal
        : this.layout === "sagittal"
          ? this.camSagittal
          : null;
  }

  applyParams(p: ViewerParams) {
    this.lastParams = p;
    this.renderer.setClearColor(new THREE.Color(p.background), 1);
    this.layout = p.layout;
    const mpr = p.layout === "MPR";
    const single = this.isSingle(p.layout);
    const ortho = mpr || single; // any 2D slice layout (planes + crosshairs shown)

    // Orbit only in the fullscreen 3D layout. In MPR the capture-phase handler
    // re-enables it per pointerdown when the drag starts in the 3D quadrant;
    // single-plane views never orbit (the whole screen is one 2D slice).
    this.controls.enabled = p.layout === "3D";
    this.controls.autoRotate = p.autoRotate; // also spins the 3D quadrant in MPR
    this.controls.autoRotateSpeed = 1.5;

    // The 3D quadrant in MPR shows just the volume; in 3D layout the perspective
    // camera also shows the slice planes (for "Slices" mode). In any 2D layout
    // the perspective camera isn't rendered, so its plane layers stay off.
    L_PLANE.forEach((l) => {
      if (ortho) this.camera.layers.disable(l);
      else this.camera.layers.enable(l);
    });

    const clim = new THREE.Vector2(p.windowLow, p.windowHigh);
    this.volumeMat.uniforms.uClim.value = clim;
    this.volumeMat.uniforms.uTechnique.value = p.technique;
    this.volumeMat.uniforms.uColormap.value = p.colormap;
    this.volumeMat.uniforms.uSteps.value = p.steps;
    this.volumeMat.uniforms.uIso.value = p.iso;
    this.volumeMat.uniforms.uDensity.value = p.density;
    this.volumeMat.uniforms.uClipEnabled.value = p.clipEnabled ? 1 : 0;
    this.volumeMat.uniforms.uClipInvert.value = p.clipInvert ? 1 : 0;
    const cmin = this.volumeMat.uniforms.uClipMin.value as THREE.Vector3;
    const cmax = this.volumeMat.uniforms.uClipMax.value as THREE.Vector3;
    cmin.set(
      Math.min(p.clipMin[0], p.clipMax[0]),
      Math.min(p.clipMin[1], p.clipMax[1]),
      Math.min(p.clipMin[2], p.clipMax[2]),
    );
    cmax.set(
      Math.max(p.clipMin[0], p.clipMax[0]),
      Math.max(p.clipMin[1], p.clipMax[1]),
      Math.max(p.clipMin[2], p.clipMax[2]),
    );
    // Slab thickness (mm) -> sample count per axis (>=1), using each axis spacing.
    const sp = [this.spacing.x, this.spacing.y, this.spacing.z];
    this.sliceMats.forEach((m, i) => {
      m.uniforms.uClim.value = clim;
      m.uniforms.uColormap.value = p.colormap;
      m.uniforms.uProjection.value = p.slabProjection;
      m.uniforms.uSamples.value = Math.max(1, Math.round(p.thickness / sp[i]));
    });

    const volumeMode = p.mode === "Volume";
    const { x: bx, y: by, z: bz } = this.boxSize;
    if (this.volumeMesh) this.volumeMesh.visible = mpr || volumeMode;

    const P = new THREE.Vector3(
      (p.sliceX - 0.5) * bx,
      (p.sliceY - 0.5) * by,
      (p.sliceZ - 0.5) * bz,
    );

    if (this.slicePlanes.length === 3) {
      const [sag, cor, ax] = this.slicePlanes;
      sag.position.x = P.x;
      cor.position.y = P.y;
      ax.position.z = P.z;
      // In MPR / single-plane layouts each plane has its own viewport (and only
      // its own camera sees it), so they are always shown.
      sag.visible = ortho || (!volumeMode && p.showX);
      cor.visible = ortho || (!volumeMode && p.showY);
      ax.visible = ortho || (!volumeMode && p.showZ);
    }

    this.crosshairs.forEach((c) => {
      c.position.copy(P);
      c.visible = ortho;
    });

    // Crop-box outline: span [cmin, cmax] in object space (tc -> (t-0.5)*boxSize).
    if (this.clipBox) {
      this.clipBox.visible = p.clipEnabled;
      this.clipBox.scale.set(
        (cmax.x - cmin.x) * bx,
        (cmax.y - cmin.y) * by,
        (cmax.z - cmin.z) * bz,
      );
      this.clipBox.position.set(
        ((cmin.x + cmax.x) / 2 - 0.5) * bx,
        ((cmin.y + cmax.y) / 2 - 0.5) * by,
        ((cmin.z + cmax.z) / 2 - 0.5) * bz,
      );
    }
  }

  /** Render once and grab the canvas as a PNG data URL (whatever layout is active). */
  screenshot(): string {
    this.renderScene();
    return this.renderer.domElement.toDataURL("image/png");
  }

  /**
   * Map a pointer position (client coords) over a 2D MPR viewport to updated
   * slice fractions. Returns null in the 3D layout or over the 3D quadrant.
   */
  pickSlice(clientX: number, clientY: number): SlicePick | null {
    const single = this.singleCam();
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const { x: bx, y: by, z: bz } = this.boxSize;
    const c01 = (t: number) => Math.max(0, Math.min(1, t));

    // Single-plane view: the whole screen unprojects through the active camera.
    if (single) {
      const ndcX = (x / rect.width) * 2 - 1;
      const ndcY = (1 - y / rect.height) * 2 - 1;
      const world = new THREE.Vector3(ndcX, ndcY, 0).unproject(single);
      if (this.layout === "axial")
        return {
          updates: { sliceX: c01(world.x / bx + 0.5), sliceY: c01(world.y / by + 0.5) },
          horizontalKey: "sliceX",
          verticalKey: "sliceY",
        };
      if (this.layout === "coronal")
        return {
          updates: { sliceX: c01(world.x / bx + 0.5), sliceZ: c01(world.z / bz + 0.5) },
          horizontalKey: "sliceX",
          verticalKey: "sliceZ",
        };
      return {
        updates: { sliceY: c01(world.y / by + 0.5), sliceZ: c01(world.z / bz + 0.5) },
        horizontalKey: "sliceY",
        verticalKey: "sliceZ",
      };
    }

    if (this.layout !== "MPR") return null;
    const hw = rect.width / 2;
    const hh = rect.height / 2;

    // Layout: TL coronal, TR sagittal, BL axial, BR 3D.
    let cam: THREE.OrthographicCamera;
    let qx: number, qy: number;
    let kind: "ax" | "cor" | "sag";
    if (x < hw && y < hh) {
      cam = this.camCoronal;
      qx = 0;
      qy = 0;
      kind = "cor";
    } else if (x >= hw && y < hh) {
      cam = this.camSagittal;
      qx = hw;
      qy = 0;
      kind = "sag";
    } else if (x < hw && y >= hh) {
      cam = this.camAxial;
      qx = 0;
      qy = hh;
      kind = "ax";
    } else {
      return null; // 3D quadrant
    }

    const ndcX = ((x - qx) / hw) * 2 - 1;
    const ndcY = (1 - (y - qy) / hh) * 2 - 1; // flip: screen y is top-down
    const world = new THREE.Vector3(ndcX, ndcY, 0).unproject(cam);
    if (kind === "ax")
      return {
        updates: { sliceX: c01(world.x / bx + 0.5), sliceY: c01(world.y / by + 0.5) },
        horizontalKey: "sliceX",
        verticalKey: "sliceY",
      };
    if (kind === "cor")
      return {
        updates: { sliceX: c01(world.x / bx + 0.5), sliceZ: c01(world.z / bz + 0.5) },
        horizontalKey: "sliceX",
        verticalKey: "sliceZ",
      };
    return {
      updates: { sliceY: c01(world.y / by + 0.5), sliceZ: c01(world.z / bz + 0.5) },
      horizontalKey: "sliceY",
      verticalKey: "sliceZ",
    };
  }

  /** Store the default framing for this volume's orientation (used by resetView). */
  private setHomeFromAffine(affine: number[][]) {
    const { dir, up } = homeCameraDirs(affine);
    this.homeDir.set(dir[0], dir[1], dir[2]);
    this.homeUp.set(up[0], up[1], up[2]);
  }

  /** Reset camera framing to the default face-on three-quarter view. */
  resetView() {
    this.controls.target.set(0, 0, 0);
    this.camera.up.copy(this.homeUp);
    this.camera.position.copy(this.controls.target).addScaledVector(this.homeDir, HOME_DIST);
    this.controls.update();
  }

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.layoutCameras(w, h);
  }

  /** Draw the scene for the current layout (fullscreen 3D / single plane, or 2x2 MPR grid). */
  private renderScene() {
    const r = this.renderer;
    r.info.reset(); // we disabled autoReset; accumulate across viewports
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const dpr2 = this.renderer.getPixelRatio() ** 2; // device pixels per CSS pixel²
    const volVisible = this.volumeMesh?.visible ?? false;

    // Single orthogonal plane filling the screen (phone top-bar views). No
    // orientation cube — it's a 2D read, not a 3D orbit.
    const single = this.singleCam();
    if (single) {
      r.setScissorTest(false);
      r.setViewport(0, 0, w, h);
      r.render(this.scene, single);
      this.stats.viewports = 1;
      this.stats.volumePixels = 0; // single-plane ortho cams don't see the volume layer
      return;
    }

    if (this.layout !== "MPR") {
      r.setScissorTest(false);
      r.setViewport(0, 0, w, h);
      r.render(this.scene, this.camera);
      this.renderGizmo(w);
      this.stats.viewports = 1;
      this.stats.volumePixels = volVisible ? w * h * dpr2 : 0;
      return;
    }

    // 2x2 grid. WebGL viewport origin is bottom-left, so the top row sits high.
    const lw = Math.floor(w / 2);
    const rw = w - lw;
    const bh = Math.floor(h / 2);
    const th = h - bh;
    const views: Array<[THREE.Camera, number, number, number, number]> = [
      [this.camCoronal, 0, bh, lw, th], // top-left
      [this.camSagittal, lw, bh, rw, th], // top-right
      [this.camAxial, 0, 0, lw, bh], // bottom-left
      [this.camera, lw, 0, rw, bh], // bottom-right (3D)
    ];
    r.setScissorTest(true);
    for (const [cam, x, y, vw, vh] of views) {
      r.setViewport(x, y, vw, vh);
      r.setScissor(x, y, vw, vh);
      r.render(this.scene, cam);
    }
    r.setScissorTest(false);
    this.renderGizmo(w); // bottom-right corner = inside the 3D quadrant
    this.stats.viewports = 4;
    this.stats.volumePixels = volVisible ? rw * bh * dpr2 : 0; // volume fills the 3D quadrant only
  }

  private animate() {
    this.raf = requestAnimationFrame(this.animate);

    const now = performance.now();
    if (this.lastTs) {
      const dt = now - this.lastTs;
      // Skip implausibly long gaps (tab backgrounded / rAF throttled): they're a
      // paused loop, not a slow render, and would otherwise tank the smoothed FPS
      // on resume and poison the ScenePerf frame-time stats.
      if (dt < 300) {
        this.stats.frameMs = dt; // raw — ScenePerf derives avg/min/1%-low from it
        this.stats.fps += (1000 / Math.max(dt, 0.001) - this.stats.fps) * 0.1; // smoothed
      }
    }
    this.lastTs = now;

    this.controls.update();
    this.updateGizmoHover(); // smooth hover fade on the orientation cube

    // Read back the GPU timer query issued on an earlier frame, once ready.
    if (this.timerExt && this.gpuInFlight && this.gpuQuery) {
      const ready = this.gl.getQueryParameter(this.gpuQuery, this.gl.QUERY_RESULT_AVAILABLE);
      const disjoint = this.gl.getParameter(this.timerExt.GPU_DISJOINT_EXT);
      if (ready || disjoint) {
        if (ready && !disjoint) {
          const ns = this.gl.getQueryParameter(this.gpuQuery, this.gl.QUERY_RESULT) as number;
          this.stats.gpuMs += (ns / 1e6 - this.stats.gpuMs) * 0.2;
        }
        this.gl.deleteQuery(this.gpuQuery);
        this.gpuQuery = null;
        this.gpuInFlight = false;
      }
    }

    // Issue a fresh query around this frame's draw (only one in flight at a time).
    let timing = false;
    if (this.timerExt && !this.gpuInFlight) {
      this.gpuQuery = this.gl.createQuery();
      if (this.gpuQuery) {
        this.gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, this.gpuQuery);
        timing = true;
      }
    }

    const cpuStart = performance.now();
    this.renderScene();
    this.stats.cpuMs += (performance.now() - cpuStart - this.stats.cpuMs) * 0.1;

    if (timing) {
      this.gl.endQuery(this.timerExt!.TIME_ELAPSED_EXT);
      this.gpuInFlight = true;
    }

    // Cheap per-frame counters straight from the renderer + JS heap.
    const info = this.renderer.info;
    this.stats.drawCalls = info.render.calls;
    this.stats.triangles = info.render.triangles;
    this.stats.lines = info.render.lines;
    this.stats.points = info.render.points;
    this.stats.textures = info.memory.textures;
    this.stats.geometries = info.memory.geometries;
    this.stats.programs = info.programs ? info.programs.length : 0;
    this.stats.steps = this.volumeMat.uniforms.uSteps.value as number;
    const cv = this.renderer.domElement;
    this.stats.drawW = cv.width;
    this.stats.drawH = cv.height;
    this.stats.dpr = this.renderer.getPixelRatio();
    const mem = (
      performance as unknown as {
        memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
      }
    ).memory;
    if (mem) {
      this.stats.jsHeapMB = mem.usedJSHeapSize / 1048576;
      this.stats.jsHeapLimitMB = mem.jsHeapSizeLimit / 1048576;
    }
  }

  private disposeVolumeObjects() {
    this.texture?.dispose();
    if (this.volumeMesh) {
      this.scene.remove(this.volumeMesh);
      this.volumeMesh.geometry.dispose();
    }
    if (this.wireframe) {
      this.scene.remove(this.wireframe);
      this.wireframe.geometry.dispose();
      (this.wireframe.material as THREE.Material).dispose();
    }
    if (this.clipBox) {
      this.scene.remove(this.clipBox);
      this.clipBox.geometry.dispose();
      (this.clipBox.material as THREE.Material).dispose();
      this.clipBox = null;
    }
    this.slicePlanes.forEach((p) => {
      this.scene.remove(p);
      p.geometry.dispose();
    });
    this.slicePlanes = [];
    this.crosshairs.forEach((c) => {
      this.scene.remove(c);
      c.geometry.dispose();
    });
    this.crosshairs = [];
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.container.removeEventListener("pointerdown", this.onPointerDownCapture, true);
    this.container.removeEventListener("wheel", this.onWheelCapture, {
      capture: true,
    } as EventListenerOptions);
    this.container.removeEventListener("pointermove", this.onPointerMove);
    this.container.removeEventListener("pointerleave", this.onPointerLeave);
    if (this.gpuQuery) this.gl.deleteQuery(this.gpuQuery);
    this.ro.disconnect();
    this.controls.dispose();
    this.disposeVolumeObjects();
    this.disposeGizmoCube();
    this.volumeMat.dispose();
    this.sliceMats.forEach((m) => {
      m.dispose();
    });
    this.crossMat.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
