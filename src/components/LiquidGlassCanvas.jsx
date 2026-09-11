import { useEffect, useRef } from 'react'
import * as THREE from 'three'

const WIDTH = 1080
const HEIGHT = 1920

const vertexShader = /* glsl */ `
  in vec3 position;
  in vec2 uv;
  out vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`

const backgroundShader = /* glsl */ `
  precision highp float;
  uniform float uTime;
  in vec2 vUv;
  out vec4 outColor;

  float glow(vec2 uv, vec2 center, vec2 scale) {
    vec2 delta = (uv - center) / scale;
    return exp(-dot(delta, delta) * 2.25);
  }

  void main() {
    vec2 uv = vUv;
    float t = uTime * 0.12;
    vec3 bottom = vec3(0.012, 0.039, 0.086);
    vec3 top = vec3(0.155, 0.218, 0.315);
    vec3 color = mix(bottom, top, smoothstep(0.02, 1.0, uv.y));

    color += vec3(0.16, 0.28, 0.43) * glow(uv, vec2(0.14 + sin(t) * 0.035, 0.76), vec2(0.30, 0.24));
    color += vec3(0.30, 0.22, 0.39) * glow(uv, vec2(0.82, 0.68 + cos(t * 0.8) * 0.03), vec2(0.33, 0.27));
    color += vec3(0.10, 0.30, 0.36) * glow(uv, vec2(0.54 + cos(t * 0.7) * 0.04, 0.34), vec2(0.42, 0.22));
    color += vec3(0.08, 0.16, 0.32) * glow(uv, vec2(0.20, 0.10), vec2(0.40, 0.19));

    float ribbon = sin((uv.x * 1.25 + uv.y) * 8.0 + t * 1.7) * 0.5 + 0.5;
    color += vec3(0.025, 0.055, 0.09) * ribbon * smoothstep(0.0, 0.85, uv.y);
    float grain = fract(sin(dot(uv * vec2(1080.0, 1920.0), vec2(12.9898, 78.233))) * 43758.5453);
    color += (grain - 0.5) * 0.012;
    outColor = vec4(color, 1.0);
  }
`

const glassShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uPaintCompose;
  uniform float uTime;
  in vec2 vUv;
  out vec4 outColor;

  float sdRoundBox(vec2 p, vec2 halfSize, float radius) {
    vec2 q = abs(p) - halfSize + radius;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - radius;
  }

  float glassSdf(vec2 uv) {
    float header = sdRoundBox(uv - vec2(0.5, 0.925), vec2(0.445, 0.047), 0.026);
    float letter = sdRoundBox(uv - vec2(0.5, 0.625), vec2(0.445, 0.245), 0.047);
    float compose = sdRoundBox(uv - vec2(0.5, 0.195), vec2(0.445, 0.155), 0.047);
    return min(header, min(letter, compose));
  }

  vec3 sampleRgbSplit(vec2 uv, vec2 direction, float amount, float lod) {
    float r = textureLod(uPaintCompose, clamp(uv + direction * amount, 0.001, 0.999), lod).r;
    float g = textureLod(uPaintCompose, clamp(uv, 0.001, 0.999), lod).g;
    float b = textureLod(uPaintCompose, clamp(uv - direction * amount, 0.001, 0.999), lod).b;
    return vec3(r, g, b);
  }

  float distributionGgx(vec3 n, vec3 h, float roughness) {
    float a2 = pow(roughness, 4.0);
    float nh = max(dot(n, h), 0.0);
    float denom = nh * nh * (a2 - 1.0) + 1.0;
    return a2 / max(3.14159265 * denom * denom, 0.0001);
  }

  float geometrySchlick(float nv, float roughness) {
    float k = pow(roughness + 1.0, 2.0) / 8.0;
    return nv / max(nv * (1.0 - k) + k, 0.0001);
  }

  void main() {
    vec2 uv = vUv;
    vec3 background = textureLod(uPaintCompose, uv, 0.0).rgb;
    float d = glassSdf(uv);
    if (d > 0.004) {
      outColor = vec4(background, 1.0);
      return;
    }

    vec2 px = vec2(1.0 / 1080.0, 1.0 / 1920.0);
    vec2 gradient = vec2(
      glassSdf(uv + vec2(px.x, 0.0)) - glassSdf(uv - vec2(px.x, 0.0)),
      glassSdf(uv + vec2(0.0, px.y)) - glassSdf(uv - vec2(0.0, px.y))
    );
    vec2 normal2 = normalize(gradient + vec2(0.00001));
    float body = smoothstep(0.004, -0.052, d);
    float rim = exp(-abs(d) * 118.0);
    float innerRim = exp(-abs(d + 0.020) * 105.0);
    float wobble = sin((uv.y * 23.0 + uv.x * 11.0) + uTime * 0.45) * 0.0014;

    vec2 faceOffset = normal2 * (0.006 + rim * 0.016 + wobble);
    vec3 face = textureLod(uPaintCompose, clamp(uv - faceOffset, 0.001, 0.999), mix(0.2, 1.15, body)).rgb;
    vec3 inner = textureLod(uPaintCompose, clamp(uv + normal2 * (0.011 + innerRim * 0.010), 0.001, 0.999), 2.15).rgb;
    vec3 outer = textureLod(uPaintCompose, clamp(uv - normal2 * 0.022, 0.001, 0.999), 0.55).rgb;
    vec3 refracted = mix(outer, inner, 0.46);
    refracted = mix(refracted, face, 0.48);
    vec3 dispersion = sampleRgbSplit(uv - faceOffset, normal2, 0.0038 + rim * 0.006, 0.8);
    refracted = mix(refracted, dispersion, 0.18 + rim * 0.34);

    vec3 n = normalize(vec3(-normal2 * (2.0 + rim * 5.0), 1.0));
    vec3 v = vec3(0.0, 0.0, 1.0);
    vec3 l = normalize(vec3(-0.42, 0.70, 0.82));
    vec3 h = normalize(v + l);
    float roughness = mix(0.19, 0.09, rim);
    float nv = max(dot(n, v), 0.0);
    float nl = max(dot(n, l), 0.0);
    float vh = max(dot(v, h), 0.0);
    vec3 fresnel = vec3(0.035) + (vec3(1.0) - vec3(0.035)) * pow(1.0 - vh, 5.0);
    float geometry = geometrySchlick(nv, roughness) * geometrySchlick(nl, roughness);
    vec3 specular = distributionGgx(n, h, roughness) * geometry * fresnel / max(4.0 * nv * nl, 0.001);

    vec3 tint = vec3(0.74, 0.86, 1.0);
    vec3 glass = mix(refracted, tint, 0.055 + body * 0.025);
    glass += specular * nl * 0.23;
    glass += vec3(0.72, 0.86, 1.0) * rim * 0.16;
    glass += vec3(0.90, 0.96, 1.0) * innerRim * 0.055;
    glass -= vec3(0.025, 0.038, 0.055) * smoothstep(-0.055, -0.008, d) * 0.55;

    float mask = 1.0 - smoothstep(0.0, 0.004, d);
    outColor = vec4(mix(background, glass, mask), 1.0);
  }
`

export default function LiquidGlassCanvas() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
    } catch (error) {
      console.warn('[LIQUID_GLASS] WebGL2 unavailable:', error)
      canvas.dataset.failed = 'true'
      return undefined
    }

    renderer.setPixelRatio(1)
    renderer.setSize(WIDTH, HEIGHT, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2)
    camera.position.z = 1
    const geometry = new THREE.PlaneGeometry(2, 2)
    const backgroundMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { uTime: { value: 0 } },
      vertexShader,
      fragmentShader: backgroundShader,
      depthTest: false,
      depthWrite: false,
    })
    const backgroundScene = new THREE.Scene()
    backgroundScene.add(new THREE.Mesh(geometry, backgroundMaterial))

    const paintComposeRT = new THREE.WebGLRenderTarget(WIDTH, HEIGHT, {
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
      depthBuffer: false,
      stencilBuffer: false,
    })
    paintComposeRT.texture.colorSpace = THREE.SRGBColorSpace

    const glassMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uPaintCompose: { value: paintComposeRT.texture },
        uTime: { value: 0 },
      },
      vertexShader,
      fragmentShader: glassShader,
      depthTest: false,
      depthWrite: false,
    })
    const glassScene = new THREE.Scene()
    glassScene.add(new THREE.Mesh(geometry, glassMaterial))

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    let lastPaint = -1
    const startedAt = performance.now()

    const draw = (now) => {
      const seconds = (now - startedAt) / 1000
      if (lastPaint < 0 || seconds - lastPaint >= 1 / 30) {
        lastPaint = seconds
        backgroundMaterial.uniforms.uTime.value = seconds
        glassMaterial.uniforms.uTime.value = seconds
        renderer.setRenderTarget(paintComposeRT)
        renderer.render(backgroundScene, camera)
        renderer.setRenderTarget(null)
        renderer.render(glassScene, camera)
      }
      if (!reducedMotion) frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(frame)
      geometry.dispose()
      backgroundMaterial.dispose()
      glassMaterial.dispose()
      paintComposeRT.dispose()
      renderer.dispose()
    }
  }, [])

  return <canvas ref={canvasRef} className="liquid-glass-canvas" width={WIDTH} height={HEIGHT} aria-hidden="true" />
}
