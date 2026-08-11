import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const rounded = readFileSync(path.join(scriptsDir, 'icon-source.svg'))
const square = readFileSync(path.join(scriptsDir, 'icon-square.svg'))

const outDir = path.join(scriptsDir, '..', 'public')

async function make(svgBuffer, size, fileName) {
  const outPath = path.join(outDir, fileName)
  await sharp(svgBuffer, { density: 384 }).resize(size, size).png().toFile(outPath)
  console.log('wrote', fileName)
}

await make(rounded, 192, 'pwa-192.png')
await make(rounded, 512, 'pwa-512.png')
await make(rounded, 512, 'pwa-maskable-512.png')
await make(square, 180, 'apple-touch-icon.png')
