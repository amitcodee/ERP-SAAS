// Checks, in the browser, that a picture is usable as an ID-card photo: exactly one face, looking straight at the
// camera, close enough, evenly lit and sharp. Nothing leaves the device: the face detector (MediaPipe BlazeFace) and
// its model are served from this origin and run in WebAssembly.
import type { FaceDetector } from '@mediapipe/tasks-vision'

export type FaceCheck = {
  ok: boolean
  /** What to tell the person: the first thing to fix, or that the picture is good. */
  message: string
  /** The square to cut out for the ID photo (pixels of the source), when a single face was found. */
  crop: { x: number; y: number; side: number } | null
}

let loading: Promise<FaceDetector> | null = null
let lastTs = 0 // the detector wants a rising time stamp with every picture
/** Loads the detector once. Rejects when the device cannot run it; the caller then lets the photo through unchecked. */
export function loadFaceDetector(): Promise<FaceDetector> {
  loading ??= (async () => {
    const { FaceDetector } = await import('@mediapipe/tasks-vision')
    // The runtime announces its start ("INFO: Created TensorFlow Lite ...") through console.error; that is not an error.
    const real = console.error
    console.error = (...a: unknown[]) => { if (!String(a[0]).startsWith('INFO: Created TensorFlow Lite')) real(...a) }
    const det = await FaceDetector.createFromOptions(
      { wasmLoaderPath: '/api/face-wasm/vision_wasm_internal.js', wasmBinaryPath: '/api/face-wasm/vision_wasm_internal.wasm' },
      { baseOptions: { modelAssetPath: '/face/blaze_face_short_range.tflite', delegate: 'CPU' }, runningMode: 'VIDEO', minDetectionConfidence: 0.6 },
    )
    return det
  })().catch((e) => { loading = null; throw e })
  return loading
}

const FACE_SHARE = 0.5 // the face fills this share of the photo's width
const MIN_FACE_PX = 110 // a smaller face is too coarse to print
const SHARP_MIN = 35 // below this the face is blurred (variance of the Laplacian over the face area)
const PROBE = 160
let probe: HTMLCanvasElement | null = null

/** Brightness (0-255), left/right difference and sharpness (variance of the Laplacian) of the face area. */
function pixels(src: CanvasImageSource, x: number, y: number, w: number, h: number) {
  probe ??= Object.assign(document.createElement('canvas'), { width: PROBE, height: PROBE })
  const ctx = probe.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, x, y, w, h, 0, 0, PROBE, PROBE)
  const d = ctx.getImageData(0, 0, PROBE, PROBE).data
  const g = new Float32Array(PROBE * PROBE)
  let sum = 0, left = 0, right = 0
  for (let i = 0; i < g.length; i++) {
    const v = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
    g[i] = v; sum += v
    if (i % PROBE < PROBE / 2) left += v; else right += v
  }
  let lapSum = 0, lapSq = 0, n = 0
  for (let r = 1; r < PROBE - 1; r++) {
    for (let c = 1; c < PROBE - 1; c++) {
      const i = r * PROBE + c
      const l = g[i - 1] + g[i + 1] + g[i - PROBE] + g[i + PROBE] - 4 * g[i]
      lapSum += l; lapSq += l * l; n++
    }
  }
  const half = g.length / 2
  return { mean: sum / g.length, side: Math.abs(left - right) / half, sharp: lapSq / n - (lapSum / n) ** 2 }
}

/**
 * Checks one frame or picture. `live` = a camera frame (the person can move, so the face must sit fully inside the
 * frame); otherwise an uploaded picture, where the cut-out is fitted into the picture instead.
 */
export function checkFace(det: FaceDetector, src: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement, w: number, h: number, live: boolean): FaceCheck {
  lastTs = Math.max(lastTs + 1, performance.now())
  const faces = det.detectForVideo(src, lastTs).detections.filter((f) => f.boundingBox && f.keypoints?.length >= 6)
  if (!faces.length) return { ok: false, message: 'No face found. Look straight at the camera.', crop: null }
  if (faces.length > 1) return { ok: false, message: 'Only one person should be in the picture.', crop: null }

  const b = faces[0].boundingBox!
  const [re, le, nose, mouth, rEar, lEar] = faces[0].keypoints.map((k) => ({ x: k.x * w, y: k.y * h }))
  const cx = b.originX + b.width / 2, cy = b.originY + b.height / 2
  let side = b.width / FACE_SHARE
  let x = cx - side / 2, y = cy - side * 0.56 // a little more room above, for the hair
  // A cut-out that sticks a little out of the frame is moved back in; further out, the person is asked to move.
  const fits = side <= Math.min(w, h) && Math.max(-x, -y, x + side - w, y + side - h) <= side * 0.12
  side = Math.min(side, w, h)
  x = Math.min(Math.max(x, 0), w - side); y = Math.min(Math.max(y, 0), h - side)
  const crop = { x, y, side }
  const fail = (message: string): FaceCheck => ({ ok: false, message, crop })

  if (b.width < Math.max(MIN_FACE_PX, live ? Math.min(w, h) * 0.22 : 0)) return fail(live ? 'Come closer to the camera.' : 'The face is too small in this picture. Use a closer one.')
  if (live && !fits) return fail(b.width / FACE_SHARE > Math.min(w, h) ? 'Move back a little.' : 'Keep your whole face in the middle.')

  // Head pose from the six landmarks: eyes level (tilt), nose midway between the ears and the eyes (turn), nose
  // between the eye line and the mouth (chin up / down).
  const eyeDist = Math.hypot(le.x - re.x, le.y - re.y) || 1
  let tilt = Math.abs(Math.atan2(le.y - re.y, le.x - re.x) * 180 / Math.PI)
  if (tilt > 90) tilt = 180 - tilt
  if (tilt > 10) return fail('Keep your head straight, do not tilt it.')
  const mid = { x: (re.x + le.x) / 2, y: (re.y + le.y) / 2 }
  const dR = Math.abs(nose.x - rEar.x), dL = Math.abs(lEar.x - nose.x)
  if (Math.abs(nose.x - mid.x) / eyeDist > 0.2 || Math.min(dR, dL) / (Math.max(dR, dL) || 1) < 0.55) return fail('Turn your face to the front.')
  const pitch = (nose.y - mid.y) / ((mouth.y - mid.y) || 1)
  if (pitch < 0.36) return fail('Lower your chin a little.')
  if (pitch > 0.86) return fail('Raise your chin a little.')

  const px = pixels(src, Math.max(b.originX, 0), Math.max(b.originY, 0), Math.min(b.width, w - Math.max(b.originX, 0)), Math.min(b.height, h - Math.max(b.originY, 0)))
  if (px.mean < 65) return fail('Too dark. Face the light.')
  if (px.mean > 215) return fail('Too bright. Move away from the strong light.')
  if (px.side > 60) return fail('One side of the face is in shadow. Face the light.')
  if (px.sharp < SHARP_MIN) return fail(live ? 'The picture is blurred. Hold still.' : 'This picture is blurred. Use a sharper one.')
  return { ok: true, message: 'Good. Face is clear and to the front.', crop }
}
