/**
 * Discord Gateway Bot
 *
 * discord.jsを使用してDiscord Gateway接続を維持し、
 * MESSAGE_CREATEイベントをNext.jsサーバーに転送する。
 *
 * 起動方法:
 *   npm run gateway:discord
 *   または
 *   npx tsx src/gateway/discord/index.ts
 */

import { config } from 'dotenv'
import { resolve } from 'path'

// .env と .env.local を読み込み（.env.local が優先）
config({ path: resolve(process.cwd(), '.env') })
config({ path: resolve(process.cwd(), '.env.local'), override: true })
import { Client, GatewayIntentBits, Events, TextChannel, DMChannel, NewsChannel, ChannelType } from 'discord.js'
import express from 'express'
import type { Request, Response } from 'express'

// =============================================================================
// 環境変数の読み込み
// =============================================================================

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
const NEXT_SERVER_URL = process.env.NEXT_SERVER_URL || 'http://localhost:3000'
const GATEWAY_SECRET = process.env.GATEWAY_SECRET
const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || '3001', 10)
// Botに関連付けられたロールID（カンマ区切りで複数指定可能）
const DISCORD_BOT_ROLE_IDS = process.env.DISCORD_BOT_ROLE_IDS?.split(',').map(id => id.trim()).filter(id => id) || []

if (!DISCORD_BOT_TOKEN) {
  console.error('Error: DISCORD_BOT_TOKEN is required')
  process.exit(1)
}

if (!GATEWAY_SECRET) {
  console.error('Error: GATEWAY_SECRET is required')
  process.exit(1)
}

// ロールID設定のログ
if (DISCORD_BOT_ROLE_IDS.length > 0) {
  console.log(`Discord Bot Role IDs configured: ${DISCORD_BOT_ROLE_IDS.join(', ')}`)
} else {
  console.log('Warning: No DISCORD_BOT_ROLE_IDS configured. Role mentions will not trigger notifications.')
}

// =============================================================================
// Discord Client の初期化
// =============================================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
})

// =============================================================================
// イベントハンドラー
// =============================================================================

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Discord Gateway Bot ready! Logged in as ${readyClient.user.tag}`)
  console.log(`Bot ID: ${readyClient.user.id}`)
  console.log(`Forwarding messages to: ${NEXT_SERVER_URL}`)
})

client.on(Events.MessageCreate, async (message) => {
  // Bot自身のメッセージは無視
  if (message.author.bot) return

  // 自分（Bot）へのメンションかどうか
  // 1. ユーザーメンション（@Bot）
  const isUserMention = client.user ? message.mentions.users.has(client.user.id) : false
  // 2. ロールメンション（@ロール名）- 環境変数で指定されたロールIDをチェック
  const isRoleMention = DISCORD_BOT_ROLE_IDS.length > 0 &&
    message.mentions.roles.some(role => DISCORD_BOT_ROLE_IDS.includes(role.id))
  const isMention = isUserMention || isRoleMention

  // DMかどうか
  const isDM = message.channel.type === ChannelType.DM

  // チャンネル名の生成
  let channelName: string
  if (isDM) {
    channelName = message.author.username
  } else if ('guild' in message.channel && message.channel.guild && 'name' in message.channel) {
    channelName = `${message.channel.guild.name}-${message.channel.name}`
  } else {
    channelName = `channel-${message.channelId}`
  }

  // Next.jsサーバーにPOST
  const payload = {
    messageId: message.id,
    channelId: message.channelId,
    channelName,
    senderId: message.author.id,
    senderName: message.author.displayName || message.author.username,
    content: message.content,
    isDM,
    isMention,
    timestamp: message.createdTimestamp,
  }

  try {
    const response = await fetch(`${NEXT_SERVER_URL}/api/chat-webhook/discord`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gateway-Secret': GATEWAY_SECRET,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      console.error(`Failed to forward message: ${response.status} ${response.statusText}`)
    }
  } catch (error) {
    console.error('Error forwarding message to Next.js server:', error)
  }
})

client.on(Events.Error, (error) => {
  console.error('Discord client error:', error)
})

// =============================================================================
// Express サーバー（メッセージ送信用）
// =============================================================================

const app = express()
app.use(express.json())

// ヘルスチェック
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    botReady: client.isReady(),
    botUser: client.user?.tag || null,
  })
})

// メッセージ送信エンドポイント
app.post('/send', async (req: Request, res: Response) => {
  // シークレット検証
  const secret = req.headers['x-gateway-secret']
  if (secret !== GATEWAY_SECRET) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { channelId, content } = req.body as { channelId?: string; content?: string }

  if (!channelId || !content) {
    res.status(400).json({ error: 'channelId and content are required' })
    return
  }

  try {
    const channel = await client.channels.fetch(channelId)

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' })
      return
    }

    // テキストベースのチャンネルかチェック
    if (channel instanceof TextChannel || channel instanceof DMChannel || channel instanceof NewsChannel) {
      await channel.send(content)
      res.json({ success: true, messageId: null })
    } else {
      res.status(400).json({ error: 'Channel is not text-based' })
    }
  } catch (error) {
    console.error('Error sending message:', error)
    res.status(500).json({ error: 'Failed to send message' })
  }
})

// =============================================================================
// 起動
// =============================================================================

async function main() {
  // Expressサーバー起動
  app.listen(GATEWAY_PORT, () => {
    console.log(`Gateway HTTP server listening on port ${GATEWAY_PORT}`)
  })

  // Discord接続
  try {
    await client.login(DISCORD_BOT_TOKEN)
  } catch (error) {
    console.error('Failed to login to Discord:', error)
    process.exit(1)
  }
}

// シグナルハンドリング
process.on('SIGINT', async () => {
  console.log('Shutting down...')
  client.destroy()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('Shutting down...')
  client.destroy()
  process.exit(0)
})

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
