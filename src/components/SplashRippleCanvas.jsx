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

function startCanvasFallback(canvas, image, reduceMotion, markReady) {
  const context = canvas.getContext('2d')
  if (!context) return () => {}

  let animationFrame = 0
  let stopped = false
  let lastDrop = 0
  const rings = []
  const touches = []

  const addRing = (x, y, strength = 1) => {
    rings.push({ x, y, born: performance.now(), strength })
  }

  const addTouch = (x, y, strength = 1) => {
    touches.push({ x, y, born: performance.now(), strength })
  }

  const draw = (now) => {
    if (stopped) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    drawCover(context, image, canvas.width, canvas.height)

    for (let index = touches.length - 1; index >= 0; index -= 1) {
      const touch = touches[index]
      const age = (now - touch.born) / 1000
      if (age > 2.7) {
        touches.splice(index, 1)
        continue
      }
      const fade = 1 - age / 2.7
      const radius = (30 + age * 7) * (canvas.width / 390)
      const gradient = context.createRadialGradient(touch.x, touch.y, 0, touch.x, touch.y, radius)
      gradient.addColorStop(0, `rgba(4,54,70,${0.34 * fade * touch.strength})`)
      gradient.addColorStop(0.58, `rgba(6,69,82,${0.2 * fade * touch.strength})`)
      gradient.addColorStop(1, 'rgba(6,69,82,0)')
      context.fillStyle = gradient
      context.fillRect(touch.x - radius, touch.y - radius, radius * 2, radius * 2)
    }

    if (!reduceMotion) {
      if (now - lastDrop > 620 + Math.random() * 430) {
        addRing(canvas.width * (0.16 + Math.random() * 0.68), canvas.height * (0.16 + Math.random() * 0.68), 0.72)
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
        context.globalAlpha = (1 - age / 1.8) * 0.3 * ring.strength
        context.strokeStyle = '#e9ffff'
        context.lineWidth = Math.max(1, 2.4 * (1 - age / 1.8))
        context.beginPath()
        context.ellipse(ring.x, ring.y, radius, radius * 0.68, 0, 0, Math.PI * 2)
        context.stroke()
      }
      context.restore()
    }

    markReady()
    animationFrame = requestAnimationFrame(draw)
  }

  let pointer = null
  let lastPoint = null
  const eventPoint = (event) => {
    const bounds = canvas.getBoundingClientRect()
    return {
      x: (event.clientX - bounds.left) * canvas.width / bounds.width,
      y: (event.clientY - bounds.top) * canvas.height / bounds.height,
    }
  }
  const pointerDown = (event) => {
    pointer = event.pointerId
    lastPoint = eventPoint(event)
    addTouch(lastPoint.x, lastPoint.y)
    addRing(lastPoint.x, lastPoint.y, 1.25)
    try { canvas.setPointerCapture(event.pointerId) } catch (_) { /* no-op */ }
  }
  const pointerMove = (event) => {
    if (event.pointerId !== pointer || !lastPoint) return
    const point = eventPoint(event)
    const distance = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y)
    const steps = Math.max(1, Math.ceil(distance / Math.max(10, canvas.width / 35)))
    for (let step = 1; step <= steps; step += 1) {
      const amount = step / steps
      const x = lastPoint.x + (point.x - lastPoint.x) * amount
      const y = lastPoint.y + (point.y - lastPoint.y) * amount
      addTouch(x, y, 0.72)
      if (step === steps) addRing(x, y, 0.54)
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
  animationFrame = requestAnimationFrame(draw)

  return () => {
    stopped = true
    cancelAnimationFrame(animationFrame)
    canvas.removeEventListener('pointerdown', pointerDown)
    canvas.removeEventListener('pointermove', pointerMove)
    canvas.removeEventListener('pointerup', pointerEnd)
    canvas.removeEventListener('pointercancel', pointerEnd)
  }
}

function startWebGL(canvas, image, markReady) {
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
  const touchAmount = new Float32Array(pointCount)
  const touchPixels = new Uint8Array(pointCount * 4)

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
    uniform sampler2D touch;
    uniform vec2 coverScale;
    uniform float aspect;

    void main() {
      vec2 slope = (texture2D(water, uv).rg - vec2(128.0 / 255.0)) * 2.55;
      vec2 refraction = slope * vec2(0.032, 0.032 / aspect);
      vec2 sceneUv = (clamp(uv + refraction, 0.002, 0.998) - 0.5) * coverScale + 0.5;
      vec3 color = texture2D(scene, sceneUv).rgb;
      float touched = texture2D(touch, uv).r;
      vec3 deepColor = color * vec3(0.56, 0.72, 0.76);
      color = mix(color, deepColor, touched * 0.72);
      float light = dot(slope, vec2(-0.42, -0.78)) * 0.28;
      float glint = max(0.0, dot(normalize(vec3(-slope, 0.36)), normalize(vec3(-0.28, -0.52, 0.81))));
      color += light + pow(glint, 10.0) * 0.07;
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

  const touchTexture = gl.createTexture()
  gl.activeTexture(gl.TEXTURE2)
  gl.bindTexture(gl.TEXTURE_2D, touchTexture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GRID_WIDTH, gridHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, touchPixels)
  gl.uniform1i(gl.getUniformLocation(program, 'touch'), 2)

  const canvasAspect = canvas.width / canvas.height
  const imageAspect = image.naturalWidth / image.naturalHeight
  const coverX = canvasAspect < imageAspect ? canvasAspect / imageAspect : 1
  const coverY = canvasAspect > imageAspect ? imageAspect / canvasAspect : 1
  gl.uniform2f(gl.getUniformLocation(program, 'coverScale'), coverX, coverY)
  gl.uniform1f(gl.getUniformLocation(program, 'aspect'), canvas.height / canvas.width)
  gl.viewport(0, 0, canvas.width, canvas.height)

  const disturb = (normalizedX, normalizedY, power = 1, radius = 2.25) => {
    const centerX = normalizedX * GRID_WIDTH
    const centerY = normalizedY * gridHeight
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

  const stain = (normalizedX, normalizedY, strength = 1, radius = 7) => {
    const centerX = normalizedX * GRID_WIDTH
    const centerY = normalizedY * gridHeight
    for (let y = Math.max(0, Math.floor(centerY - radius)); y < Math.min(gridHeight, centerY + radius); y += 1) {
      for (let x = Math.max(0, Math.floor(centerX - radius)); x < Math.min(GRID_WIDTH, centerX + radius); x += 1) {
        const dx = x - centerX
        const dy = y - centerY
        const distance = Math.sqrt(dx * dx + dy * dy) / radius
        if (distance >= 1) continue
        const deposit = (1 - distance) * (1 - distance) * strength
        const index = y * GRID_WIDTH + x
        touchAmount[index] = 1 - (1 - touchAmount[index]) * (1 - deposit)
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
    stain(lastPoint.x, lastPoint.y, 0.9)
    disturb(lastPoint.x, lastPoint.y, 1.85, 2.1)
    try { canvas.setPointerCapture(event.pointerId) } catch (_) { /* no-op */ }
  }
  const pointerMove = (event) => {
    if (event.pointerId !== pointer || !lastPoint) return
    const point = eventPoint(event)
    const distance = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y)
    const steps = Math.max(1, Math.ceil(distance * GRID_WIDTH / 2.5))
    for (let step = 1; step <= steps; step += 1) {
      const amount = step / steps
      const x = lastPoint.x + (point.x - lastPoint.x) * amount
      const y = lastPoint.y + (point.y - lastPoint.y) * amount
      stain(x, y, 0.38, 6.2)
      disturb(x, y, 0.38, 1.8)
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
  let nextDrop = performance.now() + 140

  const render = (now) => {
    if (stopped) return
    if (now - lastFrame >= FRAME_INTERVAL) {
      lastFrame = now
      if (now >= nextDrop) {
        disturb(0.12 + Math.random() * 0.76, 0.12 + Math.random() * 0.76, 0.82 + Math.random() * 0.3, 1.7)
        nextDrop = now + 560 + Math.random() * 520
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
          touchAmount[index] *= 0.987
          touchPixels[pixel] = Math.round(touchAmount[index] * 255)
          touchPixels[pixel + 1] = 0
          touchPixels[pixel + 2] = 0
          touchPixels[pixel + 3] = 255
        }
      }

      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, waterTexture)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GRID_WIDTH, gridHeight, gl.RGBA, gl.UNSIGNED_BYTE, waterPixels)
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, touchTexture)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GRID_WIDTH, gridHeight, gl.RGBA, gl.UNSIGNED_BYTE, touchPixels)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      markReady()
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
    gl.deleteTexture(touchTexture)
    gl.deleteBuffer(buffer)
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    gl.deleteProgram(program)
  }
}

export default function SplashRippleCanvas({ src, scene, onReady }) {
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
    let ready = false
    const markReady = () => {
      if (ready || cancelled) return
      ready = true
      canvas.dataset.ready = 'true'
      onReady?.()
    }

    const start = () => {
      if (cancelled) return
      const bounds = canvas.getBoundingClientRect()
      const pixelRatio = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.max(1, Math.round(bounds.width * pixelRatio))
      canvas.height = Math.max(1, Math.round(bounds.height * pixelRatio))

      if (reduceMotion) {
        dispose = startCanvasFallback(canvas, image, true, markReady)
        return
      }

      try {
        dispose = startWebGL(canvas, image, markReady)
      } catch (error) {
        console.warn('[OpeningSplash] WebGL ripple fallback:', error)
        dispose = startCanvasFallback(canvas, image, false, markReady)
      }
    }

    if (image.complete && image.naturalWidth) start()
    else image.addEventListener('load', start, { once: true })

    return () => {
      cancelled = true
      image.removeEventListener('load', start)
      dispose()
    }
  }, [onReady, src])

  return <canvas ref={canvasRef} className={`opening-splash__ripple opening-splash__ripple--${scene}`} aria-hidden="true" />
}
