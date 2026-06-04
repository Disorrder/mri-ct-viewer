/**
 * GLSL source for the two materials used in the scene:
 *   1. a volume ray-marcher (renders the whole brain as a 3D box), and
 *   2. a slice sampler (renders flat axial/coronal/sagittal cut planes).
 *
 * Both share the same colormap + windowing helpers, so those live in one chunk
 * that gets prepended to each fragment shader.
 *
 * We target WebGL2 / GLSL ES 3.00 (THREE.GLSL3): `sampler3D`, `texture()`,
 * dynamic-length loops, and the `out` qualifier are all available there.
 */

/** Window/level + colormap helpers, shared by both fragment shaders. */
export const COMMON = /* glsl */ `
  // --- Window/level: the radiology knob. Map an intensity range [lo,hi] to [0,1].
  // This is exactly the DICOM "window width / window center" idea: only a slice
  // of the value range is shown, everything below is black, above is white.
  float applyWindow(float v, vec2 clim) {
    return clamp((v - clim.x) / max(clim.y - clim.x, 1e-5), 0.0, 1.0);
  }

  vec3 cmGray(float x)  { return vec3(x); }
  vec3 cmHot(float x)   { return clamp(vec3(3.0*x, 3.0*x - 1.0, 3.0*x - 2.0), 0.0, 1.0); }
  vec3 cmBone(float x)  { return clamp(vec3(x*0.95, x*0.97, x*1.06 + 0.02), 0.0, 1.0); }
  vec3 cmJet(float x)   {
    return clamp(vec3(1.5 - abs(4.0*x - 3.0),
                      1.5 - abs(4.0*x - 2.0),
                      1.5 - abs(4.0*x - 1.0)), 0.0, 1.0);
  }
  // Polynomial approximation of matplotlib "viridis" (perceptually uniform).
  vec3 cmViridis(float t) {
    const vec3 c0 = vec3(0.2777, 0.0054, 0.3341);
    const vec3 c1 = vec3(0.1051, 1.4046, 1.3846);
    const vec3 c2 = vec3(-0.3309, 0.2148, 0.0951);
    const vec3 c3 = vec3(-4.6342, -5.7991, -19.3324);
    const vec3 c4 = vec3(6.2283, 14.1799, 56.6906);
    const vec3 c5 = vec3(4.7764, -13.7451, -65.3530);
    const vec3 c6 = vec3(-5.4355, 4.6459, 26.3124);
    return c0 + t*(c1 + t*(c2 + t*(c3 + t*(c4 + t*(c5 + t*c6)))));
  }

  vec3 colormap(int mode, float x) {
    if (mode == 0) return cmGray(x);
    if (mode == 1) return cmBone(x);
    if (mode == 2) return cmHot(x);
    if (mode == 3) return cmViridis(x);
    return cmJet(x);
  }
`;

/** Names must line up with the `colormap()` switch above (index = order). */
export const COLORMAPS = ["gray", "bone", "hot", "viridis", "jet"] as const;
export type Colormap = (typeof COLORMAPS)[number];

/** Techniques for the volume ray-marcher. */
export const TECHNIQUES = ["MIP", "Isosurface", "DVR"] as const;
export type Technique = (typeof TECHNIQUES)[number];

/** How a thick slab is collapsed into one slice image (index = order). */
export const SLAB_PROJECTIONS = ["mean", "MIP", "MinIP"] as const;
export type SlabProjection = (typeof SLAB_PROJECTIONS)[number];

// ---------------------------------------------------------------------------
// Volume ray-marcher
// ---------------------------------------------------------------------------

export const VOLUME_VERT = /* glsl */ `
  out vec3 vRayOrigin;     // camera position, in normalized [0,1] texture space
  out vec3 vRayTargetDir;  // direction from camera toward this fragment

  uniform vec3 uBoxSize;   // physical box size (voxels * spacing), normalized

  // Map a point in object space to texture coords: box spans [-s/2, s/2] -> [0,1].
  vec3 toTexCoord(vec3 p) { return p / uBoxSize + 0.5; }

  void main() {
    // cameraPosition is world-space; bring it into object space (box sits at origin).
    vec3 camObj = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
    vRayOrigin = toTexCoord(camObj);
    vRayTargetDir = toTexCoord(position) - vRayOrigin;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const VOLUME_FRAG = /* glsl */ `
  precision highp float;
  precision highp sampler3D;

  in vec3 vRayOrigin;
  in vec3 vRayTargetDir;

  uniform sampler3D uData;
  uniform int   uTechnique;   // 0 MIP, 1 Isosurface, 2 DVR
  uniform int   uColormap;
  uniform int   uSteps;       // ray-march sample count
  uniform vec2  uClim;        // window: [low, high] in normalized intensity
  uniform float uIso;         // isosurface threshold
  uniform float uDensity;     // DVR opacity multiplier
  uniform vec3  uTexel;       // 1.0 / volume dims, for gradient estimation
  uniform int  uClipEnabled; // box crop (0/1)
  uniform vec3 uClipMin;     // keep voxels inside the box [min, max] per axis
  uniform vec3 uClipMax;
  uniform int  uClipInvert;  // 1 = cut OUT the box instead

  out vec4 fragColor;

  ${COMMON}

  // Intersect a ray with the unit cube [0,1]^3. Returns (tNear, tFar).
  vec2 intersectBox(vec3 orig, vec3 dir) {
    vec3 invDir = 1.0 / dir;
    vec3 tA = (vec3(0.0) - orig) * invDir;
    vec3 tB = (vec3(1.0) - orig) * invDir;
    vec3 tMin = min(tA, tB);
    vec3 tMax = max(tA, tB);
    return vec2(max(max(tMin.x, tMin.y), tMin.z),
                min(min(tMax.x, tMax.y), tMax.z));
  }

  float sampleData(vec3 p) { return texture(uData, p).r; }

  // True for samples the cut removes. Default keeps the [min,max] box; invert
  // removes it instead.
  bool clipped(vec3 p) {
    if (uClipEnabled == 0) return false;
    bool inside = all(greaterThanEqual(p, uClipMin)) && all(lessThanEqual(p, uClipMax));
    return uClipInvert == 1 ? inside : !inside;
  }

  // Surface normal from the local intensity gradient (central differences).
  vec3 gradientNormal(vec3 p) {
    return normalize(vec3(
      sampleData(p + vec3(uTexel.x, 0, 0)) - sampleData(p - vec3(uTexel.x, 0, 0)),
      sampleData(p + vec3(0, uTexel.y, 0)) - sampleData(p - vec3(0, uTexel.y, 0)),
      sampleData(p + vec3(0, 0, uTexel.z)) - sampleData(p - vec3(0, 0, uTexel.z))
    ) + 1e-6);
  }

  void main() {
    vec3 dir = normalize(vRayTargetDir);
    vec2 hit = intersectBox(vRayOrigin, dir);
    hit.x = max(hit.x, 0.0);          // never start behind the camera
    if (hit.x > hit.y) discard;       // ray misses the volume

    float dt = (hit.y - hit.x) / float(uSteps);
    vec3 p = vRayOrigin + dir * hit.x;
    vec3 stepVec = dir * dt;

    if (uTechnique == 0) {
      // --- MIP: brightest voxel along the ray (classic for angiography).
      float peak = 0.0;
      for (int i = 0; i < uSteps; i++) {
        if (!clipped(p)) peak = max(peak, sampleData(p));
        p += stepVec;
      }
      float w = applyWindow(peak, uClim);
      if (w <= 0.0) discard;
      fragColor = vec4(colormap(uColormap, w), 1.0);

    } else if (uTechnique == 1) {
      // --- Isosurface: stop at the first voxel above the threshold, then shade.
      for (int i = 0; i < uSteps; i++) {
        if (!clipped(p) && sampleData(p) >= uIso) {
          vec3 n = gradientNormal(p);
          vec3 L = normalize(vec3(0.5, 0.7, 1.0));
          float diff = max(dot(n, L), 0.0);
          vec3 base = colormap(uColormap, applyWindow(sampleData(p), uClim));
          fragColor = vec4(base * (0.25 + 0.85 * diff), 1.0);
          return;
        }
        p += stepVec;
      }
      discard;

    } else {
      // --- DVR: front-to-back alpha compositing through the whole volume.
      vec4 acc = vec4(0.0);
      for (int i = 0; i < uSteps; i++) {
        float s = clipped(p) ? 0.0 : sampleData(p);
        float w = applyWindow(s, uClim);
        float a = w * uDensity * dt * 100.0;
        vec3 c = colormap(uColormap, w);
        acc.rgb += (1.0 - acc.a) * a * c;
        acc.a   += (1.0 - acc.a) * a;
        if (acc.a >= 0.98) break;
        p += stepVec;
      }
      if (acc.a <= 0.001) discard;
      fragColor = acc;
    }
  }
`;

// ---------------------------------------------------------------------------
// Slice sampler (axial / coronal / sagittal cut planes)
// ---------------------------------------------------------------------------

export const SLICE_VERT = /* glsl */ `
  out vec3 vTexCoord;
  uniform vec3 uBoxSize;
  void main() {
    // The plane meshes are positioned inside the same box (centered at origin),
    // so a world-space position maps to a texture coord the same way.
    vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vTexCoord = worldPos / uBoxSize + 0.5;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const SLICE_FRAG = /* glsl */ `
  precision highp float;
  precision highp sampler3D;

  in vec3 vTexCoord;
  uniform sampler3D uData;
  uniform vec2  uClim;
  uniform int   uColormap;
  uniform int   uNormalAxis;  // axis the slab is collapsed along (0 x, 1 y, 2 z)
  uniform float uStepN;       // one voxel step along that axis, in [0,1] tex space
  uniform int   uSamples;     // slab thickness in voxels (>= 1)
  uniform int   uProjection;  // 0 mean, 1 MIP, 2 MinIP
  out vec4 fragColor;

  ${COMMON}

  void main() {
    vec3 tc = vTexCoord;
    if (any(lessThan(tc, vec3(0.0))) || any(greaterThan(tc, vec3(1.0)))) discard;

    // March uSamples voxels along the slice normal (a slab centered on the cut)
    // and collapse them: average, max, or min intensity.
    vec3 nrm = vec3(uNormalAxis == 0 ? 1.0 : 0.0, uNormalAxis == 1 ? 1.0 : 0.0, uNormalAxis == 2 ? 1.0 : 0.0);
    float start = -float(uSamples - 1) * 0.5;
    float sum = 0.0, mx = 0.0, mn = 1.0;
    int cnt = 0;
    for (int i = 0; i < uSamples; i++) {
      vec3 stc = tc + nrm * ((start + float(i)) * uStepN);
      if (any(lessThan(stc, vec3(0.0))) || any(greaterThan(stc, vec3(1.0)))) continue;
      float s = texture(uData, stc).r;
      sum += s;
      mx = max(mx, s);
      mn = min(mn, s);
      cnt++;
    }
    float v = cnt == 0 ? 0.0 : (uProjection == 1 ? mx : (uProjection == 2 ? mn : sum / float(cnt)));
    fragColor = vec4(colormap(uColormap, applyWindow(v, uClim)), 1.0);
  }
`;
