// Tiny dependency-free WebGL engine for Relax Hub.
// Flat-shaded, vertex-coloured low-poly meshes, a few point lights, fog,
// emissive surfaces and canvas textures — rendered at low resolution and
// upscaled with nearest-neighbour filtering for a crunchy retro 3D look.

// ------------------------------------------------------------------ math ---
export const v3 = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm(a) {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

export const m4 = {
  ident() {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  },
  chain(...ms) {
    return ms.reduce((acc, m) => m4.mul(acc, m));
  },
  T(x, y, z) {
    const m = m4.ident();
    m[12] = x;
    m[13] = y;
    m[14] = z;
    return m;
  },
  S(x, y = x, z = x) {
    const m = m4.ident();
    m[0] = x;
    m[5] = y;
    m[10] = z;
    return m;
  },
  RX(a) {
    const m = m4.ident(), c = Math.cos(a), s = Math.sin(a);
    m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
    return m;
  },
  RY(a) {
    const m = m4.ident(), c = Math.cos(a), s = Math.sin(a);
    m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
    return m;
  },
  RZ(a) {
    const m = m4.ident(), c = Math.cos(a), s = Math.sin(a);
    m[0] = c; m[1] = s; m[4] = -s; m[5] = c;
    return m;
  },
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    const m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) * nf;
    m[11] = -1;
    m[14] = 2 * far * near * nf;
    return m;
  },
  lookAt(eye, target, up = [0, 1, 0]) {
    const z = v3.norm(v3.sub(eye, target));
    const x = v3.norm(v3.cross(up, z));
    const y = v3.cross(z, x);
    const m = new Float32Array(16);
    m[0] = x[0]; m[1] = y[0]; m[2] = z[0];
    m[4] = x[1]; m[5] = y[1]; m[6] = z[1];
    m[8] = x[2]; m[9] = y[2]; m[10] = z[2];
    m[12] = -v3.dot(x, eye); m[13] = -v3.dot(y, eye); m[14] = -v3.dot(z, eye); m[15] = 1;
    return m;
  },
  invert(m) {
    const a = m, o = new Float32Array(16);
    const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4];
    const b03 = a[1] * a[6] - a[2] * a[5], b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
    const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12], b08 = a[8] * a[15] - a[11] * a[12];
    const b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return m4.ident();
    det = 1 / det;
    o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det;
    o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
    o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det;
    o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
    o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det;
    o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
    o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det;
    o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
    o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det;
    o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
    o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det;
    o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
    o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det;
    o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
    o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det;
    o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
    return o;
  },
  apply(m, p) {
    const [x, y, z] = p;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [
      (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
      w,
    ];
  },
};

export function hex(c) {
  const n = parseInt(c.slice(1, 7), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const col = (c) => (typeof c === "string" ? hex(c) : c);

// -------------------------------------------------------------- geometry ---
// Vertex layout: position(3) normal(3) colour(3) emissive(1) uv(2) = 12 floats
export class Geo {
  constructor() {
    this.data = [];
    this.m = null; // optional transform applied to added geometry
  }
  with(m, fn) {
    const prev = this.m;
    this.m = prev ? m4.mul(prev, m) : m;
    fn();
    this.m = prev;
    return this;
  }
  tp(p) {
    return this.m ? m4.apply(this.m, p).slice(0, 3) : p;
  }
  tri(a, b, c, color, em = 0, uvs = [[0, 0], [1, 0], [1, 1]]) {
    a = this.tp(a); b = this.tp(b); c = this.tp(c);
    const n = v3.norm(v3.cross(v3.sub(b, a), v3.sub(c, a)));
    const k = col(color);
    [a, b, c].forEach((p, i) => this.data.push(p[0], p[1], p[2], n[0], n[1], n[2], k[0], k[1], k[2], em, uvs[i][0], uvs[i][1]));
    return this;
  }
  /** p0..p3 counter-clockwise as seen from the front */
  quad(p0, p1, p2, p3, color, em = 0, uv = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    this.tri(p0, p1, p2, color, em, [uv[0], uv[1], uv[2]]);
    this.tri(p0, p2, p3, color, em, [uv[0], uv[2], uv[3]]);
    return this;
  }
  /** Axis-aligned box centred at (x,y,z). color: string | {px,nx,py,ny,pz,nz,all} */
  box(x, y, z, w, h, d, color, o = {}) {
    const X0 = x - w / 2, X1 = x + w / 2, Y0 = y - h / 2, Y1 = y + h / 2, Z0 = z - d / 2, Z1 = z + d / 2;
    const c = (f) => (typeof color === "object" && !Array.isArray(color) ? color[f] || color.all : color);
    const em = o.em || 0;
    const skip = o.skip || "";
    if (!skip.includes("pz")) this.quad([X0, Y0, Z1], [X1, Y0, Z1], [X1, Y1, Z1], [X0, Y1, Z1], c("pz"), em);
    if (!skip.includes("nz")) this.quad([X1, Y0, Z0], [X0, Y0, Z0], [X0, Y1, Z0], [X1, Y1, Z0], c("nz"), em);
    if (!skip.includes("px")) this.quad([X1, Y0, Z1], [X1, Y0, Z0], [X1, Y1, Z0], [X1, Y1, Z1], c("px"), em);
    if (!skip.includes("nx")) this.quad([X0, Y0, Z0], [X0, Y0, Z1], [X0, Y1, Z1], [X0, Y1, Z0], c("nx"), em);
    if (!skip.includes("py")) this.quad([X0, Y1, Z1], [X1, Y1, Z1], [X1, Y1, Z0], [X0, Y1, Z0], c("py"), em);
    if (!skip.includes("ny")) this.quad([X0, Y0, Z0], [X1, Y0, Z0], [X1, Y0, Z1], [X0, Y0, Z1], c("ny"), em);
    return this;
  }
  /** Vertical cylinder; base centre (x,y,z) */
  cyl(x, y, z, r, h, seg, color, o = {}) {
    const em = o.em || 0, r2 = o.r2 ?? r;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p = (a, rr, yy) => [x + Math.cos(a) * rr, yy, z - Math.sin(a) * rr];
      if (r > 0 || r2 > 0) this.quad(p(a0, r, y), p(a1, r, y), p(a1, r2, y + h), p(a0, r2, y + h), color, em);
      if (o.top !== false && r2 > 0) this.tri([x, y + h, z], p(a0, r2, y + h), p(a1, r2, y + h), o.topColor || color, em);
      if (o.bottom !== false && r > 0) this.tri([x, y, z], p(a1, r, y), p(a0, r, y), color, em);
    }
    return this;
  }
  sphere(x, y, z, r, segW, segH, colorFn, em = 0) {
    const P = (t, f) => {
      const th = (t / segH) * Math.PI, ph = (f / segW) * Math.PI * 2;
      return [x + Math.sin(th) * Math.cos(ph) * r, y + Math.cos(th) * r, z - Math.sin(th) * Math.sin(ph) * r];
    };
    for (let t = 0; t < segH; t++) {
      for (let f = 0; f < segW; f++) {
        const tl = P(t, f), tr = P(t, f + 1), bl = P(t + 1, f), br = P(t + 1, f + 1);
        const mid = v3.scale(v3.add(v3.add(tl, br), v3.add(tr, bl)), 0.25);
        const c = typeof colorFn === "function" ? colorFn(v3.norm(v3.sub(mid, [x, y, z])), t, f) : colorFn;
        if (t === 0) this.tri(bl, br, tr, c, em);
        else if (t === segH - 1) this.tri(bl, tr, tl, c, em);
        else this.quad(bl, br, tr, tl, c, em);
      }
    }
    return this;
  }
}

// -------------------------------------------------------------- renderer ---
const VS = `
attribute vec3 aPos; attribute vec3 aNor; attribute vec4 aCol; attribute vec2 aUV;
uniform mat4 uProj; uniform mat4 uView; uniform mat4 uModel;
varying vec3 vNor; varying vec4 vCol; varying vec2 vUV; varying vec3 vW; varying float vDepth;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vW = w.xyz;
  vNor = (uModel * vec4(aNor, 0.0)).xyz;
  vCol = aCol; vUV = aUV;
  vec4 v = uView * w;
  vDepth = -v.z;
  gl_Position = uProj * v;
}`;
const FS = `
precision mediump float;
varying vec3 vNor; varying vec4 vCol; varying vec2 vUV; varying vec3 vW; varying float vDepth;
uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uSky; uniform vec3 uGround;
uniform vec3 uFogCol; uniform vec3 uFog; // near, far, enabled
uniform vec3 uPL[4]; uniform vec3 uPLC[4]; uniform float uPLR;
uniform vec4 uTint; uniform float uUseTex; uniform sampler2D uTex; uniform float uLevels;
void main() {
  vec3 c = vCol.rgb * uTint.rgb;
  if (uUseTex > 0.5) {
    vec4 t = texture2D(uTex, vUV);
    if (t.a < 0.5) discard;
    c *= t.rgb;
  }
  vec3 n = normalize(vNor);
  vec3 light = mix(uGround, uSky, n.y * 0.5 + 0.5) + uSunCol * max(dot(n, -uSun), 0.0);
  for (int i = 0; i < 4; i++) {
    vec3 L = uPL[i] - vW;
    float d = length(L);
    float att = max(0.0, 1.0 - d / uPLR);
    light += uPLC[i] * att * att * max(dot(n, L / max(d, 0.001)), 0.0);
  }
  float em = max(vCol.a, uTint.a);
  vec3 o = mix(c * light, c, em);
  float f = uFog.z * clamp((vDepth - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  o = mix(o, uFogCol, f);
  // ordered-ish dither + colour quantisation for that 32-bit console look
  float dn = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  o = floor(o * uLevels + 0.5 + dn * 0.9) / uLevels;
  gl_FragColor = vec4(o, 1.0);
}`;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const opts = { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: "high-performance" };
    const gl = canvas.getContext("webgl2", opts) || canvas.getContext("webgl", opts);
    if (!gl) throw new Error("WebGL is not available on this device.");
    this.gl = gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    gl.useProgram(p);
    this.p = p;
    this.a = {};
    for (const n of ["aPos", "aNor", "aCol", "aUV"]) this.a[n] = gl.getAttribLocation(p, n);
    this.u = {};
    for (const n of ["uProj", "uView", "uModel", "uSun", "uSunCol", "uSky", "uGround", "uFogCol", "uFog", "uPL", "uPLC", "uPLR", "uTint", "uUseTex", "uTex", "uLevels"]) {
      this.u[n] = gl.getUniformLocation(p, n);
    }
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    this.white = this.texture(Object.assign(document.createElement("canvas"), { width: 1, height: 1 }), "#ffffff");
    this.lost = false;
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
    });
  }

  mesh(geo) {
    const gl = this.gl;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geo.data), gl.STATIC_DRAW);
    return { buf, count: geo.data.length / 12 };
  }

  texture(canvas, fill) {
    const gl = this.gl;
    if (fill) {
      const g = canvas.getContext("2d");
      g.fillStyle = fill;
      g.fillRect(0, 0, canvas.width, canvas.height);
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    const t = {
      tex,
      canvas,
      update: () => {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      },
      dispose: () => gl.deleteTexture(tex),
    };
    return t;
  }

  resize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  begin(cam, env) {
    const gl = this.gl, u = this.u;
    gl.clearColor(...env.clear, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(u.uProj, false, cam.proj);
    gl.uniformMatrix4fv(u.uView, false, cam.view);
    gl.uniform3fv(u.uSun, v3.norm(env.sun));
    gl.uniform3fv(u.uSunCol, env.sunCol);
    gl.uniform3fv(u.uSky, env.sky);
    gl.uniform3fv(u.uGround, env.ground);
    gl.uniform3fv(u.uFogCol, env.clear);
    gl.uniform1f(u.uLevels, env.levels || 28);
    const pl = new Float32Array(12), plc = new Float32Array(12);
    (env.lights || []).slice(0, 4).forEach((l, i) => {
      pl.set(l.p, i * 3);
      plc.set(l.c, i * 3);
    });
    gl.uniform3fv(u.uPL, pl);
    gl.uniform3fv(u.uPLC, plc);
    gl.uniform1f(u.uPLR, env.lightRange || 7);
    this.fog = env.fog || [8, 60];
    gl.uniform1i(u.uTex, 0);
  }

  draw(mesh, model, o = {}) {
    const gl = this.gl, u = this.u, a = this.a;
    gl.uniformMatrix4fv(u.uModel, false, model || IDENT);
    const t = o.tint ? col(o.tint) : [1, 1, 1];
    gl.uniform4f(u.uTint, t[0], t[1], t[2], o.em || 0);
    gl.uniform3f(u.uFog, this.fog[0], this.fog[1], o.fog === false ? 0 : 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, (o.tex || this.white).tex);
    gl.uniform1f(u.uUseTex, o.tex ? 1 : 0);
    if (o.additive) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
    } else {
      gl.disable(gl.BLEND);
      gl.depthMask(o.depthWrite !== false);
    }
    if (o.cull === false) gl.disable(gl.CULL_FACE);
    else gl.enable(gl.CULL_FACE);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
    const S = 48;
    gl.enableVertexAttribArray(a.aPos);
    gl.vertexAttribPointer(a.aPos, 3, gl.FLOAT, false, S, 0);
    if (a.aNor >= 0) { gl.enableVertexAttribArray(a.aNor); gl.vertexAttribPointer(a.aNor, 3, gl.FLOAT, false, S, 12); }
    if (a.aCol >= 0) { gl.enableVertexAttribArray(a.aCol); gl.vertexAttribPointer(a.aCol, 4, gl.FLOAT, false, S, 24); }
    if (a.aUV >= 0) { gl.enableVertexAttribArray(a.aUV); gl.vertexAttribPointer(a.aUV, 2, gl.FLOAT, false, S, 40); }
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }
}
const IDENT = m4.ident();

/** Camera helper with projection, view and screen projection / picking. */
export class Camera {
  constructor() {
    this.eye = [0, 3, 8];
    this.target = [0, 1, 0];
    this.fov = 0.9;
    this.aspect = 16 / 9;
    this.near = 0.1;
    this.far = 400;
    this.update();
  }
  update() {
    this.proj = m4.perspective(this.fov, this.aspect, this.near, this.far);
    this.view = m4.lookAt(this.eye, this.target);
    this.vp = m4.mul(this.proj, this.view);
    this.ivp = m4.invert(this.vp);
  }
  /** world → [x, y] in 0..1 screen space (y down), plus visible flag */
  project(p) {
    const c = m4.apply(this.vp, p);
    return { x: (c[0] + 1) / 2, y: (1 - c[1]) / 2, visible: c[3] > 0 && c[2] < 1 };
  }
  /** screen (0..1) → ray intersection with horizontal plane y = h */
  pickPlane(sx, sy, h = 0) {
    const nx = sx * 2 - 1, ny = 1 - sy * 2;
    const a = m4.apply(this.ivp, [nx, ny, -1]);
    const b = m4.apply(this.ivp, [nx, ny, 1]);
    const dir = v3.sub(b, a);
    if (Math.abs(dir[1]) < 1e-6) return null;
    const t = (h - a[1]) / dir[1];
    if (t < 0) return null;
    return v3.add(a, v3.scale(dir, t));
  }
}
