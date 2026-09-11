export const BUBBLE_SKINS = [
  { id: 'puppy', label: '奶油小狗' },
  { id: 'apple-pixel', label: '青苹果像素' },
  { id: 'kakao-rainbow', label: '彩虹', preview: '/assets/bubbles/rainbow/send-01.png' },
  { id: 'kakao-water', label: '冰晶丝带', preview: '/assets/bubbles/water/send-01.png' },
  { id: 'kakao-candy', label: '糖果系', preview: '/assets/bubbles/candy/send-01.png' },
  { id: 'kakao-rainbow-bear', label: '彩虹熊', preview: '/assets/bubbles/rainbow-bear/send-01.png' },
]

const iosFrame = (src, width, height, scale, capX, capY, padding, minWidth, minHeight) => ({
  src, width, height, scale, capX, capY, padding, minWidth, minHeight,
})

const androidFrame = (src, width, height, scale, xStart, xEnd, yStart, yEnd, padding, minWidth, minHeight) => ({
  src, width, height, scale, xStart, xEnd, yStart, yEnd, padding, minWidth, minHeight,
})

export const KAKAO_BUBBLE_SKINS = {
  'kakao-rainbow': {
    send: {
      first: iosFrame('/assets/bubbles/rainbow/send-01.png', 98, 97, 2, 22, 22, '9px 18px 9px', 54, 43),
      follow: iosFrame('/assets/bubbles/rainbow/send-02.png', 98, 97, 2, 22, 22, '9px 18px 9px', 54, 43),
    },
    receive: {
      first: iosFrame('/assets/bubbles/rainbow/receive-01.png', 98, 97, 2, 22, 22, '9px 18px 9px', 54, 43),
      follow: iosFrame('/assets/bubbles/rainbow/receive-02.png', 98, 97, 2, 22, 22, '9px 18px 9px', 54, 43),
    },
  },
  'kakao-water': {
    send: {
      first: androidFrame('/assets/bubbles/water/send-01.png', 360, 150, 3, 72, 288, 60, 96, '10px 18px 9px', 70, 47),
      follow: androidFrame('/assets/bubbles/water/send-02.png', 360, 150, 3, 72, 288, 60, 96, '10px 18px 9px', 70, 47),
    },
    receive: {
      first: androidFrame('/assets/bubbles/water/receive-01.png', 360, 150, 3, 72, 288, 60, 96, '10px 18px 9px', 70, 47),
      follow: androidFrame('/assets/bubbles/water/receive-02.png', 360, 150, 3, 72, 288, 60, 96, '10px 18px 9px', 70, 47),
    },
  },
  'kakao-candy': {
    send: {
      first: iosFrame('/assets/bubbles/candy/send-01.png', 204, 157, 3, 34, 31, '14px 18px 10px', 72, 53),
      follow: iosFrame('/assets/bubbles/candy/send-02.png', 204, 126, 3, 33, 19, '10px 18px 9px', 70, 43),
    },
    receive: {
      first: iosFrame('/assets/bubbles/candy/receive-01.png', 204, 157, 3, 33, 30, '14px 18px 10px', 72, 53),
      follow: iosFrame('/assets/bubbles/candy/receive-02.png', 204, 126, 3, 33, 19, '10px 18px 9px', 70, 43),
    },
  },
  'kakao-rainbow-bear': {
    send: {
      first: androidFrame('/assets/bubbles/rainbow-bear/send-01.png', 151, 172, 3, 43, 44, 125, 126, '34px 28px 8px 10px', 62, 58),
      follow: androidFrame('/assets/bubbles/rainbow-bear/send-02.png', 151, 100, 3, 43, 44, 53, 54, '9px 28px 7px 9px', 48, 39),
    },
    receive: {
      first: androidFrame('/assets/bubbles/rainbow-bear/receive-01.png', 109, 100, 3, 65, 66, 52, 53, '9px 8px 7px 14px', 48, 39),
      follow: androidFrame('/assets/bubbles/rainbow-bear/receive-02.png', 109, 100, 3, 65, 66, 52, 53, '9px 8px 7px 14px', 48, 39),
    },
  },
}

export function getKakaoBubbleFrame(skinId, isUser, sameSenderAsPrev) {
  const skin = KAKAO_BUBBLE_SKINS[skinId]
  if (!skin) return null
  const side = isUser ? skin.send : skin.receive
  return sameSenderAsPrev ? side.follow : side.first
}

export function getNineSlice(frame) {
  if (!frame) return null

  const left = frame.xStart ?? frame.capX * frame.scale
  const top = frame.yStart ?? frame.capY * frame.scale
  const right = frame.width - (frame.xEnd ?? left + 1)
  const bottom = frame.height - (frame.yEnd ?? top + 1)

  return {
    source: `${top} ${right} ${bottom} ${left} fill`,
    width: `${top / frame.scale}px ${right / frame.scale}px ${bottom / frame.scale}px ${left / frame.scale}px`,
  }
}
