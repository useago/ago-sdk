// Vite `?raw` imports: the worklet sources are bundled as plain strings and
// turned into Blob URLs only when a session starts (never at import time).
declare module "*.worklet.js?raw" {
  const source: string;
  export default source;
}
