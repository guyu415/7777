// Renders the actual background layer(s) for a group chat, absolutely
// positioned behind the real content (which sits in a sibling with
// position:relative/zIndex:1 — see GroupChatWindow.jsx). Two modes:
//
// - default: a real, medium-lightness sage green — green must clearly read
//   as the dominant color (~70-80% of the visual weight), not a near-white
//   wash with a hint of gray-green. High opacity (~0.85-0.92) on genuinely
//   sage-toned rgb values (not pastel-light ones) achieves this while still
//   keeping it semi-transparent/frosted (backdrop-filter blur) rather than
//   an opaque flat block. White is used ONLY for a small corner highlight
//   and stays low-opacity so it never washes out the green base.
// - image: the user's own uploaded photo, covered/centered (never
//   stretched), with a translucent sage tint + a real blur layer on top of
//   it (an actual DOM overlay, not just a gradient) so it reads as frosted
//   glass over the photo rather than the raw image fighting with message
//   bubbles for attention. Left untouched by the default-color deepening
//   above — a custom background must never be affected by it.
export default function GroupChatBackground({ bg }) {
  if (bg?.type === 'image' && bg.value) {
    return (
      <>
        <div
          className="absolute inset-0"
          style={{ backgroundImage: `url(${bg.value})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(165deg, rgba(188,208,180,0.42) 0%, rgba(168,193,163,0.32) 45%, rgba(198,214,193,0.4) 100%)',
            backdropFilter: 'blur(7px)',
            WebkitBackdropFilter: 'blur(7px)',
          }}
        />
      </>
    )
  }
  return (
    <div
      className="absolute inset-0"
      style={{
        background: `
          radial-gradient(circle at 22% 8%, rgba(255,255,255,0.22), transparent 38%),
          linear-gradient(165deg, rgba(134,160,120,0.9) 0%, rgba(108,136,100,0.88) 35%, rgba(146,170,132,0.88) 68%, rgba(118,146,108,0.92) 100%)
        `,
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        boxShadow: 'inset 0 0 70px rgba(55,80,50,0.16)',
      }}
    />
  )
}
