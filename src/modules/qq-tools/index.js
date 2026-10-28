// 内置模块：基础 QQ 工具。翻聊天记录；主人私聊里还能让她主动给别人发消息。

import { defineTool, str, int } from '../../tools/tools.js'
import { parseMessageEvent } from '../../chat/inbound.js'

export default {
  id: 'qq-tools',
  name: '基础 QQ 工具',
  version: '1.0.0',
  description: '翻聊天记录（qq_chat_history，可指定白名单里的群号；主人还能翻和某个好友的私聊）；主人私聊里让她主动给白名单里的人和群发消息（qq_send_message）',
  setup(api) {
    const { hub, onebot } = api.core
    api.tool(({ chat, level }) => {
      if (chat.kind === 'system') return []
      const tools = [defineTool({
        name: 'qq_chat_history',
        description: '翻翻聊天记录（只读，最多 50 条）：什么都不填就翻当前这个聊天；填群号翻白名单里那个群的记录；填 QQ 号翻和那个人的私聊记录（只有主人能用，且得是好友）。',
        properties: {
          count: int('要翻多少条，默认 20，最多 50'),
          group: str('可选：群号。填了就翻那个群的记录（得在白名单里）'),
          user: str('可选：QQ 号。填了就翻和那个人的私聊记录（只有主人私聊里能用）'),
        },
        execute: async ({ count, group, user }) => {
          const n = Math.max(1, Math.min(50, Number(count) || 20))
          const gid = String(group ?? '').replace(/\D/g, '')
          const uid = String(user ?? '').replace(/\D/g, '')
          // 别人的私聊只有主人能翻（群里、别人私聊里都不给）
          if (uid && level !== 'full') return { ok: false, message: '只有主人私聊里能翻别人的私聊记录' }
          if (gid && !api.config().allow.groups.includes(gid)) return { ok: false, message: '这个群不在白名单里，翻不了' }
          // 指定 QQ 号 = 私聊记录；指定群号 / 本来就在群里 = 群记录；都没有 = 当前这个聊天
          const kind = uid ? 'private' : gid || chat.kind === 'group' ? 'group' : 'private'
          const r = kind === 'group'
            ? await onebot.call('get_group_msg_history', { group_id: Number(gid || chat.groupId), count: n }, { timeoutMs: 15000 })
            : await onebot.call('get_friend_msg_history', { user_id: Number(uid || chat.userId), count: n }, { timeoutMs: 15000 })
          const msgs = (r?.messages || []).slice(-n)
          if (!msgs.length) return { ok: true, message: uid ? '没翻到和这个人的私聊记录（可能不是好友，或者还没聊过）' : '没翻到聊天记录' }
          const self = String(api.config().botQQ)
          const lines = msgs.map((m) => {
            const p = parseMessageEvent({ ...m, message_type: m.message_type || kind }, self)
            const who = String(m.user_id ?? m.sender?.user_id) === self ? '你' : (m.sender?.card || m.sender?.nickname || String(m.user_id ?? ''))
            const t = m.time ? new Date(m.time * 1000).toTimeString().slice(0, 5) : ''
            return `${t} ${who}：${(p.text || '（图片/表情）').slice(0, 150)}`
          })
          return { ok: true, message: lines.join('\n') }
        },
      })]
      if (level === 'full') tools.push(defineTool({
        name: 'qq_send_message',
        description: '主动给某个 QQ 好友或群发一条消息（不是回复当前聊天时用）。target 写 private:QQ号 或 group:群号；只能发给白名单里的人和群。',
        properties: { target: str('private:QQ号 或 group:群号'), text: str('要发的话，可以用 ||| 分多条、<voice>…</voice> 发语音、<sticker:名字> 发表情') },
        required: ['target', 'text'],
        execute: async ({ target, text }) => {
          const cfg = api.config()
          const [kind, id] = String(target || '').split(':')
          const okList = kind === 'group' ? cfg.allow.groups : kind === 'private' ? [cfg.ownerQQ, ...cfg.allow.private] : []
          if (!okList.includes(String(id))) return { ok: false, message: '不在白名单里，不能发' }
          await hub.deliver(`${kind}:${id}`, String(text || ''))
          return { ok: true, message: '发出去了' }
        },
      }))
      return tools
    })
    return {}
  },
}
