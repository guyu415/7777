export function rollD6() {
  const random = new Uint32Array(1)
  crypto.getRandomValues(random)
  return (random[0] % 6) + 1
}
