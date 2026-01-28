import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

interface SpriteInfo {
  name: string
  path: string
  category: string
}

/**
 * スプライトフォルダから画像ファイル一覧を取得
 */
function listSprites(baseDir: string, category: string): SpriteInfo[] {
  const sprites: SpriteInfo[] = []

  if (!fs.existsSync(baseDir)) {
    return sprites
  }

  const items = fs.readdirSync(baseDir, { withFileTypes: true })

  for (const item of items) {
    if (item.isDirectory()) {
      // サブフォルダを再帰的に探索
      const subDir = path.join(baseDir, item.name)
      const subSprites = listSpritesInFolder(subDir, category, item.name)
      sprites.push(...subSprites)
    } else if (item.isFile() && /\.(png|jpg|jpeg|gif|webp)$/i.test(item.name)) {
      // 直下の画像ファイル
      const fileName = path.parse(item.name).name
      sprites.push({
        name: fileName,
        path: `/assets/sprites/${category}/${item.name}`,
        category,
      })
    }
  }

  return sprites
}

function listSpritesInFolder(dir: string, category: string, subFolder: string): SpriteInfo[] {
  const sprites: SpriteInfo[] = []

  if (!fs.existsSync(dir)) {
    return sprites
  }

  const files = fs.readdirSync(dir)

  for (const file of files) {
    if (/\.(png|jpg|jpeg|gif|webp)$/i.test(file)) {
      const fileName = path.parse(file).name
      sprites.push({
        name: `${subFolder}/${fileName}`,
        path: `/assets/sprites/${category}/${subFolder}/${file}`,
        category,
      })
    }
  }

  return sprites
}

// GET - スプライト一覧を取得
export async function GET() {
  try {
    const publicDir = path.join(process.cwd(), 'public', 'assets', 'sprites')

    // charactersフォルダとnpcsフォルダからスプライトを取得
    const characters = listSprites(path.join(publicDir, 'characters'), 'characters')
    const npcs = listSprites(path.join(publicDir, 'npcs'), 'npcs')

    return NextResponse.json({
      success: true,
      sprites: {
        characters,
        npcs,
      },
    })
  } catch (error) {
    console.error('[API] Error listing sprites:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to list sprites' },
      { status: 500 }
    )
  }
}
