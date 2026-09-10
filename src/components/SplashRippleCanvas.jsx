import { useEffect, useRef } from 'react'

const GRID_WIDTH = 112
const FRAME_INTERVAL = 1000 / 30

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Unable to compile splash shader'
    gl.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}

function drawCover(context, image, width, height) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight)
  const drawWidth = image.naturalWidth * scale
  const drawHeight = image.naturalHeight * scale
  context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
}

function startCanvasFallback(canvas, image, reduceMotion) {
  const context = canvas.getContext('2d')
  if (!context) return () => {}

  let animationFrame = 0
  let stopped = false
  let lastDrop = 0
  const rings = []

  const addRing = (x, y, strength = 1) => {
    rings.push({ x, y, born: performance.now(), strength })
  }

  const draw = (now) => {
    if (stopped) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    drawCover(context, image, canvas.width, canvas.height)

    if (!reduceMotion) {
      if (now - lastDrop > 950 + Math.random() * 650) {
        addRing(canvas.width * (0.16 + Math.random() * 0.68), canvas.height * (0.16 + Math.random() * 0.68), 0.55)
        lastDrop = now
      }

      context.save()
      context.globalCompositeOperation = 'screen'
      for (let index = rings.length - 1; index >= 0; index -= 1) {
        const ring = rings[index]
        const age = (now - ring.born) / 1000
        if (age > 1.8) {
          rings.splice(index, 1)
          continue
        }
        const radius = (18 + age * 94) * (canvas.width / 390)
        context.globalAlpha = (1 - age / 1.8) * 0.2 * ring.strength
        context.strokeStyle = '#e9ffff'
        context.lineWidth = Math.max(1, 2.4 * (1 - age / 1.8))
        context.beginPath()
        context.ellipse(ring.x, ring.y, radius, radius * 0.68, 0, 0, Math.PI * 2)
        context.stroke()
      }
      context.restore()
    }

    canvas.dataset.ready = 'true'
    animationFrame = requestAnimationFrame(draw)
  }

  const pointerDown = (event) => {
    const bounds = canvas.getBoundingClientRect()
    addRing(
      (event.clientX - bounds.left) * canvas.width / bounds.width,
      (event.clientY - bounds.top) * canvas.height / bounds.height,
      1,
    )
  }
  canvas.addEventListener('pointerdown', pointerDown)
  animationFrame = requestAnimationFrame(draw)

  return () => {
    stopped = true
    cancelAnimationFrame(animationFrame)
    canvas.removeEventListener('pointerdown', pointerDown)
  }
}

function startWebGL(canvas, image) {
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: 'low-power',
  })
  if (!gl) throw new Error('WebGL unavailable')

  const gridHeight = Math.max(80, Math.round(GRID_WIDTH * canvas.height / canvas.width))
  const pointCount = GRID_WIDTH * gridHeight
  let current = new Float32Array(pointCount)
  let previous = new Float32Array(pointCount)
  let next = new Float32Array(pointCount)
  const waterPixels = new Uint8Array(pointCount * 4)

  const vertexSource = `
    attribute vec2 position;
    varying vec2 uv;
    void main() {
      uv = vec2((position.x + 1.0) * 0.5, (1.0 - position.y) * 0.5);
      gl_Position = vec4(position, 0.0, 1.0);
    }
  `
  const fragmentSource = `
    precision highp float;
    varying vec2 uv;
    uniform sampler2D scene;
    uniform sampler2D water;
    uniform vec2 coverScale;
    uniform float aspect;

    void main() {
      vec2 slope = (texture2D(water, uv).rg - vec2(128.0 / 255.0)) * 2.15;
      vec2 refraction = slope * vec2(0.027, 0.027 / aspect);
      vec2 sceneUv = (clamp(uv + refraction, 0.002, 0.998) - 0.5) * coverScale + 0.5;
      vec3 color = texture2D(scene, sceneUv).rgb;
      float light = dot(slope, vec2(-0.42, -0.78)) * 0.23;
      float glint = max(0.0, dot(normalize(vec3(-slope, 0.36)), normalize(vec3(-0.28, -0.52, 0.81))));
      color += light + pow(glint, 10.0) * 0.05;
      gl_FragColor = vec4(color, 1.0);
    }
  `

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  const program = gl.createProgram()
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || 'Unable to link splash shader')
  }
  gl.useProgram(program)

  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 1, -1, -1, 1,
    -1, 1, 1, -1, 1, 1,
  ]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'position')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

  const sceneTexture = gl.createTexture()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, sceneTexture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
  gl.uniform1i(gl.getUniformLocation(program, 'scene'), 0)

  const waterTexture = gl.createTexture()
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, waterTexture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GRID_WIDTH, gridHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, waterPixels)
  gl.uniform1i(gl.getUniformLocation(program, 'water'), 1)

  const canvasAspect = canvas.width / canvas.height
  const imageAspect = image.naturalWidth / image.naturalHeight
  const coverX = canvasAspect < imageAspect ? canvasAspect / imageAspect : 1
  const coverY = canvasAspect > imageAspect ? imageAspect / canvasAspect : 1
  gl.uniform2f(gl.getUniformLocation(program, 'coverScale'), coverX, coverY)
  gl.uniform1f(gl.getUniformLocation(program, 'aspect'), canvas.height / canvas.width)
  gl.viewport(0, 0, canvas.width, canvas.height)

  const disturb = (normalizedX, normalizedY, power = 1) => {
    const centerX = normalizedX * GRID_WIDTH
    const centerY = normalizedY * gridHeight
    const radius = 3.4
    for (let y = Math.max(1, Math.floor(centerY - radius * 2)); y < Math.min(gridHeight - 1, centerY + radius * 2); y += 1) {
      for (let x = Math.max(1, Math.floor(centerX - radius * 2)); x < Math.min(GRID_WIDTH - 1, centerX + radius * 2); x += 1) {
        const dx = x - centerX
        const dy = y - centerY
        const distance = (dx * dx + dy * dy) / (radius * radius)
        if (distance > 4) continue
        const impulse = Math.exp(-distance * 1.72) * power
        const index = y * GRID_WIDTH + x
        current[index] = clamp(current[index] + impulse, -4, 4)
        previous[index] = clamp(previous[index] + impulse * 0.62, -4, 4)
      }
    }
  }

  let pointer = null
  let lastPoint = null
  const eventPoint = (event) => {
    const bounds = canvas.getBoundingClientRect()
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
    }
  }
  const pointerDown = (event) => {
    pointer = event.pointerId
    lastPoint = eventPoint(event)
    disturb(lastPoint.x, lastPoint.y, 1.3)
  }
  const pointerMove = (event) => {
    if (event.pointerId !== pointer || !lastPoint) return
    const point = eventPoint(event)
    const distance = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y)
    const steps = Math.max(1, Math.ceil(distance * GRID_WIDTH / 2.5))
    for (let step = 1; step <= steps; step += 1) {
      const amount = step / steps
      disturb(
        lastPoint.x + (point.x - lastPoint.x) * amount,
        lastPoint.y + (point.y - lastPoint.y) * amount,
        0.32,
      )
    }
    lastPoint = point
  }
  const pointerEnd = (event) => {
    if (event.pointerId !== pointer) return
    pointer = null
    lastPoint = null
  }
  canvas.addEventListener('pointerdown', pointerDown)
  canvas.addEventListener('pointermove', pointerMove)
  canvas.addEventListener('pointerup', pointerEnd)
  canvas.addEventListener('pointercancel', pointerEnd)

  let animationFrame = 0
  let stopped = false
  let lastFrame = 0
  let nextDrop = performance.now() + 240

  const render = (now) => {
    if (stopped) return
    if (now - lastFrame >= FRAME_INTERVAL) {
      lastFrame = now
      if (now >= nextDrop) {
        disturb(0.12 + Math.random() * 0.76, 0.12 + Math.random() * 0.76, 0.62 + Math.random() * 0.32)
        nextDrop = now + 720 + Math.random() * 760
      }

      for (let step = 0; step < 2; step += 1) {
        for (let y = 1; y < gridHeight - 1; y += 1) {
          for (let x = 1; x < GRID_WIDTH - 1; x += 1) {
            const index = y * GRID_WIDTH + x
            const height = current[index]
            const laplacian = current[index - 1] + current[index + 1]
              + current[index - GRID_WIDTH] + current[index + GRID_WIDTH] - 4 * height
            next[index] = clamp((2 * height - previous[index] + 0.23 * laplacian) * 0.984, -4, 4)
          }
        }
        const oldPrevious = previous
        previous = current
        current = next
        next = oldPrevious
      }

      for (let y = 0; y < gridHeight; y += 1) {
        for (let x = 0; x < GRID_WIDTH; x += 1) {
          const index = y * GRID_WIDTH + x
          const gradientX = (current[y * GRID_WIDTH + Math.min(GRID_WIDTH - 1, x + 1)]
            - current[y * GRID_WIDTH + Math.max(0, x - 1)]) * 0.72
          const gradientY = (current[Math.min(gridHeight - 1, y + 1) * GRID_WIDTH + x]
            - current[Math.max(0, y - 1) * GRID_WIDTH + x]) * 0.72
          const pixel = index * 4
          waterPixels[pixel] = clamp(Math.round(128 + gradientX * 100), 0, 255)
          waterPixels[pixel + 1] = clamp(Math.round(128 + gradientY * 100), 0, 255)
          waterPixels[pixel + 2] = 128
          waterPixels[pixel + 3] = 255
        }
      }

      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, waterTexture)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GRID_WIDTH, gridHeight, gl.RGBA, gl.UNSIGNED_BYTE, waterPixels)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      canvas.dataset.ready = 'true'
    }
    animationFrame = requestAnimationFrame(render)
  }
  animationFrame = requestAnimationFrame(render)

  return () => {
    stopped = true
    cancelAnimationFrame(animationFrame)
    canvas.removeEventListener('pointerdown', pointerDown)
    canvas.removeEventListener('pointermove', pointerMove)
    canvas.removeEventListener('pointerup', pointerEnd)
    canvas.removeEventListener('pointercancel', pointerEnd)
    gl.deleteTexture(sceneTexture)
    gl.deleteTexture(waterTexture)
    gl.deleteBuffer(buffer)
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    gl.deleteProgram(program)
  }
}

export default function SplashRippleCanvas({ src }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let dispose = () => {}
    let cancelled = false
    const image = new Image()
    image.decoding = 'async'
    image.src = src

    const start = () => {
      if (cancelled) return
      const bounds = canvas.getBoundingClientRect()
      const pixelRatio = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.max(1, Math.round(bounds.width * pixelRatio))
      canvas.height = Math.max(1, Math.round(bounds.height * pixelRatio))

      if (reduceMotion) {
        dispose = startCanvasFallback(canvas, image, true)
        return
      }

      try {
        dispose = startWebGL(canvas, image)
      } catch (error) {
        console.warn('[OpeningSplash] WebGL ripple fallback:', error)
        dispose = startCanvasFallback(canvas, image, false)
      }
    }

    if (image.complete && image.naturalWidth) start()
    else image.addEventListener('load', start, { once: true })

    return () => {
      cancelled = true
      image.removeEventListener('load', start)
      dispose()
    }
  }, [src])

  return <canvas ref={canvasRef} className="opening-splash__ripple" aria-hidden="true" />
}
