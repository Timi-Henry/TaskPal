import { useEffect, useRef } from "react";

const vertexShaderSource = `
attribute vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const fragmentShaderSource = `
precision highp float;

uniform vec2 iResolution;
uniform float iTime;
uniform sampler2D iChannel0;

float noise2(vec2 p) {
  return texture2D(iChannel0, p).r;
}

float pattern(vec2 p) {
  return noise2(p * 0.2);
}

void mainImage(out vec4 O, in vec2 I) {
  vec2 R = iResolution.xy;
  vec2 uv = ((I + vec2(15.0, 0.0)) * 2.0 - R) / R.y;

  O = vec4(0.0);

  float dist = dot(uv, uv);

  float x = dot(
    normalize(abs(uv) + vec2(0.000001)),
    vec2(1.0, 0.0)
  ) * 0.1 - iTime * 0.05;

  float y = dot(
    normalize(uv + vec2(0.000001)),
    vec2(0.0, 1.0)
  ) * 0.16 - iTime * 0.1;

  float n1 = pattern(vec2(x, y) + dist * 0.08);
  float n2 = pattern(
    vec2(x, y) + dist * 0.08 + vec2(0.0, 0.006)
  );
  float n3 = pattern(
    vec2(x, y) + dist * 0.08 + vec2(0.0, -0.006)
  );

  float d1 = n1 - dist * 1.6;
  float d2 = n2 - dist * 1.6;
  float d3 = n3 - dist * 1.6;

  O.rgb += vec3(d2, d1, d3);

  vec3 v = O.rgb * 2.0;
  O.rgb = 2.0 / (1.0 + exp(-2.0 * v)) - 1.0;
  O.a = 1.0;
}

void main() {
  vec4 color = vec4(0.0);
  mainImage(color, gl_FragCoord.xy);
  gl_FragColor = color;
}
`;

function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);

  if (!shader) {
    throw new Error("Unable to create shader");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(error ?? "Shader compilation failed");
  }

  return shader;
}

type View = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D | null;
  width: number;
  height: number;
  startedAt: number;
};

type Renderer = {
  add: (canvas: HTMLCanvasElement) => () => void;
  count: () => number;
  dispose: () => void;
};

function createRenderer(): Renderer | null {
  const source = document.createElement("canvas");
  const context = source.getContext("webgl", {
    alpha: false,
    antialias: false,
  });
  if (!context) return null;
  const gl: WebGLRenderingContext = context;

  source.hidden = true;
  source.setAttribute("aria-hidden", "true");
  source.dataset.taskpalShaderSource = "true";

  const views = new Map<HTMLCanvasElement, View>();
  const visible = new Set<View>();
  const pending = new Set<View>();
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame: number | null = null;
  let disposed = false;
  let lost = false;
  let vertex: WebGLShader | null = null;
  let fragment: WebGLShader | null = null;
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let texture: WebGLTexture | null = null;
  let resolution: WebGLUniformLocation | null = null;
  let time: WebGLUniformLocation | null = null;

  function releaseResources() {
    if (texture) gl.deleteTexture(texture);
    if (buffer) gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    texture = buffer = program = vertex = fragment = null;
  }

  function initialize() {
    releaseResources();
    vertex = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    const nextProgram = gl.createProgram();
    if (!nextProgram) throw new Error("Unable to create program");
    program = nextProgram;
    gl.attachShader(nextProgram, vertex);
    gl.attachShader(nextProgram, fragment);
    gl.linkProgram(nextProgram);
    if (!gl.getProgramParameter(nextProgram, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(nextProgram) ?? "Link failed");
    }
    gl.useProgram(nextProgram);

    // Identical deterministic noise texture to the original implementation.
    const size = 256;
    const pixels = new Uint8Array(size * size * 4);
    let seed = 123456789;
    for (let i = 0; i < size * size; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const value = seed >>> 24;
      const offset = i * 4;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }
    texture = gl.createTexture();
    if (!texture) throw new Error("Unable to create texture");
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(gl.getUniformLocation(nextProgram, "iChannel0"), 0);

    buffer = gl.createBuffer();
    if (!buffer) throw new Error("Unable to create buffer");
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(nextProgram, "a_position");
    if (position < 0) throw new Error("Missing position attribute");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    resolution = gl.getUniformLocation(nextProgram, "iResolution");
    time = gl.getUniformLocation(nextProgram, "iTime");
  }

  function cancelFrame() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  function schedule() {
    if (
      !disposed &&
      !lost &&
      !document.hidden &&
      (visible.size || pending.size) &&
      frame === null
    ) {
      frame = requestAnimationFrame(render);
    }
  }

  function render(now: number) {
    frame = null;
    if (disposed || lost || document.hidden) return;
    const targets = new Set([...visible, ...pending]);
    if (!targets.size) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let requiredWidth = 1;
    let requiredHeight = 1;
    for (const view of targets) {
      requiredWidth = Math.max(requiredWidth, Math.round(view.width * dpr));
      requiredHeight = Math.max(requiredHeight, Math.round(view.height * dpr));
    }
    // Reuse one backing buffer; do not resize it for every differently sized row.
    if (source.width !== requiredWidth) source.width = requiredWidth;
    if (source.height !== requiredHeight) source.height = requiredHeight;

    for (const view of targets) {
      const width = Math.max(1, Math.round(view.width * dpr));
      const height = Math.max(1, Math.round(view.height * dpr));
      view.context ??= view.canvas.getContext("2d", { alpha: false });
      if (!view.context) continue;
      if (view.canvas.width !== width) view.canvas.width = width;
      if (view.canvas.height !== height) view.canvas.height = height;

      gl.viewport(0, 0, width, height);
      gl.uniform2f(resolution, width, height);
      gl.uniform1f(time, motion.matches ? 0 : (now - view.startedAt) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      // WebGL draws in the lower-left of its shared buffer. drawImage uses
      // top-left source coordinates, so copy the matching bottom rectangle.
      view.context.drawImage(source, 0, source.height - height, width, height, 0, 0, width, height);
      pending.delete(view);
    }
    if (!motion.matches && visible.size) schedule();
  }

  const intersection = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const view = views.get(entry.target as HTMLCanvasElement);
      if (!view) continue;
      if (entry.isIntersecting) {
        visible.add(view);
        pending.add(view);
      } else {
        visible.delete(view);
      }
    }
    if (!visible.size && !pending.size) cancelFrame();
    schedule();
  });

  const resize = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const view = views.get(entry.target as HTMLCanvasElement);
      if (!view) continue;
      view.width = entry.contentRect.width;
      view.height = entry.contentRect.height;
      pending.add(view);
    }
    schedule();
  });

  function motionChanged() {
    cancelFrame();
    for (const view of views.values()) pending.add(view);
    schedule();
  }

  function visibilityChanged() {
    if (document.hidden) cancelFrame();
    else schedule();
  }

  function contextLost(event: Event) {
    event.preventDefault();
    lost = true;
    cancelFrame();
  }

  function contextRestored() {
    try {
      initialize();
      lost = false;
      for (const view of views.values()) pending.add(view);
      schedule();
    } catch (error) {
      console.error("TaskPal shader restoration failed:", error);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelFrame();
    intersection.disconnect();
    resize.disconnect();
    motion.removeEventListener("change", motionChanged);
    document.removeEventListener("visibilitychange", visibilityChanged);
    window.removeEventListener("resize", schedule);
    source.removeEventListener("webglcontextlost", contextLost);
    source.removeEventListener("webglcontextrestored", contextRestored);
    releaseResources();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    source.remove();
    views.clear();
    visible.clear();
    pending.clear();
  }

  source.addEventListener("webglcontextlost", contextLost);
  source.addEventListener("webglcontextrestored", contextRestored);
  motion.addEventListener("change", motionChanged);
  document.addEventListener("visibilitychange", visibilityChanged);
  window.addEventListener("resize", schedule);
  try {
    initialize();
    document.body.append(source);
  } catch (error) {
    console.error("TaskPal shader setup failed:", error);
    dispose();
    return null;
  }

  return {
    add(canvas) {
      const rect = canvas.getBoundingClientRect();
      const view: View = {
        canvas,
        context: null,
        width: rect.width,
        height: rect.height,
        startedAt: performance.now(),
      };
      views.set(canvas, view);
      // Every row gets a frame, including rows below the viewport.
      pending.add(view);
      if (rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth)
        visible.add(view);
      intersection.observe(canvas);
      resize.observe(canvas);
      schedule();
      return () => {
        intersection.unobserve(canvas);
        resize.unobserve(canvas);
        visible.delete(view);
        pending.delete(view);
        views.delete(canvas);
        // Release the detached row's pixel buffer too.
        canvas.width = canvas.height = 1;
        if (!visible.size && !pending.size) cancelFrame();
      };
    },
    count: () => views.size,
    dispose,
  };
}

let sharedRenderer: Renderer | null = null;
let disposalTimer: number | undefined;

function subscribe(canvas: HTMLCanvasElement) {
  window.clearTimeout(disposalTimer);
  disposalTimer = undefined;
  sharedRenderer ??= createRenderer();
  const renderer = sharedRenderer;
  const unsubscribe = renderer?.add(canvas);
  return () => {
    unsubscribe?.();
    if (renderer && renderer.count() === 0) {
      disposalTimer = window.setTimeout(() => {
        if (sharedRenderer === renderer && renderer.count() === 0) {
          renderer.dispose();
          sharedRenderer = null;
        }
      }, 0);
    }
  };
}

export default function ShaderBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return subscribe(canvas);
  }, []);
  return <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />;
}
