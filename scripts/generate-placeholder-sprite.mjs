import sharp from 'sharp'
import { mkdirSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')

const WIDTH = 288
const HEIGHT = 384
const COLS = 3
const ROWS = 4
const FRAME_WIDTH = 96
const FRAME_HEIGHT = 96

const ROW_LABELS = ['Down', 'Left', 'Right', 'Up']
const COLORS = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0']

function generateSVG() {
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">`

  // Background
  svg += `<rect width="${WIDTH}" height="${HEIGHT}" fill="#2a2a2a"/>`

  // Draw frames
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x = col * FRAME_WIDTH
      const y = row * FRAME_HEIGHT
      const frameNum = col

      // Frame background with slight color variation
      const hue = (row * 90) % 360
      svg += `<rect x="${x}" y="${y}" width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}" fill="hsl(${hue}, 30%, ${20 + col * 5}%)"/>`

      // Frame border
      svg += `<rect x="${x}" y="${y}" width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}" fill="none" stroke="#666" stroke-width="1"/>`

      // Character circle (simple representation)
      const cx = x + FRAME_WIDTH / 2
      const cy = y + FRAME_HEIGHT / 2
      const radius = 30

      // Body
      svg += `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${COLORS[row]}"/>`

      // Direction indicator (arrow or line)
      const arrowLength = 18
      const directionOffsets = [
        { dx: 0, dy: arrowLength },   // Down (row 0)
        { dx: -arrowLength, dy: 0 },  // Left (row 1)
        { dx: arrowLength, dy: 0 },   // Right (row 2)
        { dx: 0, dy: -arrowLength },  // Up (row 3)
      ]
      const { dx, dy } = directionOffsets[row]
      svg += `<line x1="${cx}" y1="${cy}" x2="${cx + dx}" y2="${cy + dy}" stroke="white" stroke-width="4" stroke-linecap="round"/>`

      // Walking animation indicator (leg positions)
      const legOffset = (col - 1) * 8
      svg += `<line x1="${cx - 12}" y1="${cy + radius}" x2="${cx - 12 + legOffset}" y2="${cy + radius + 15}" stroke="${COLORS[row]}" stroke-width="4"/>`
      svg += `<line x1="${cx + 12}" y1="${cy + radius}" x2="${cx + 12 - legOffset}" y2="${cy + radius + 15}" stroke="${COLORS[row]}" stroke-width="4"/>`

      // Frame number
      svg += `<text x="${x + 6}" y="${y + 20}" font-size="16" fill="#888">${frameNum}</text>`
    }
  }

  // Row labels on the right side
  for (let row = 0; row < ROWS; row++) {
    const y = row * FRAME_HEIGHT + FRAME_HEIGHT - 8
    svg += `<text x="${WIDTH - 6}" y="${y}" font-size="14" fill="#555" text-anchor="end">${ROW_LABELS[row]}</text>`
  }

  svg += '</svg>'
  return svg
}

async function main() {
  const outputDir = join(projectRoot, 'public/assets/sprites')

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  const svg = generateSVG()
  const outputPath = join(outputDir, 'alex.png')

  await sharp(Buffer.from(svg))
    .png()
    .toFile(outputPath)

  console.log(`Generated: ${outputPath}`)
  console.log(`Sprite sheet: ${WIDTH}x${HEIGHT}px (${COLS} cols x ${ROWS} rows, ${FRAME_WIDTH}x${FRAME_HEIGHT} per frame)`)
  console.log('Row 0: Down, Row 1: Left, Row 2: Right, Row 3: Up')
}

main().catch(console.error)
