// Renders the actual background layer(s) for a group chat, absolutely
// positioned behind the real content (which sits in a sibling with
// position:relative/zIndex:1 — see GroupChatWindow.jsx). Two modes:
//
// - default: a transparent, softly frosted sage-green gradient — no solid
//   opaque block, no high-saturation/neon color, just a light tint with a
//   gentle top highlight and a soft inner shadow at the edges so existing
//   text/bubbles stay clearly readable on top of it.
// - image: the user's own uploaded photo, covered/centered (never
//   stretched), with a translucent sage tint + a real blur layer on top of
//   it (an actual DOM overlay, not just a gradient) so it reads as frosted
//   glass over the photo rather than the raw image fighting with message
//   bubbles for attention.
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
          radial-gradient(circle at 30% 8%, rgba(255,255,255,0.35), transparent 45%),
          linear-gradient(165deg, rgba(203,219,195,0.6) 0%, rgba(180,202,172,0.5) 32%, rgba(213,227,205,0.55) 68%, rgba(190,208,182,0.6) 100%)
        `,
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        boxShadow: 'inset 0 0 60px rgba(120,145,115,0.12)',
      }}
    />
  )
}
