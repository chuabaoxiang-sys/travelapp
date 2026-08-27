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
// maskable图标要求"全出血"（背景铺满整个画布、四角不透明）——系统会自己套遮罩形状，
// 图标本身如果已经带圆角、四角是透明的，遮罩一套就可能露出四角空白或图标显得特别小。
// 之前误用了 rounded（带圆角、四角透明），改用本来就是给apple-touch-icon准备的
// square（真正铺满整个方形画布，没有预先裁圆角）
await make(square, 512, 'pwa-maskable-512.png')
await make(square, 180, 'apple-touch-icon.png')
