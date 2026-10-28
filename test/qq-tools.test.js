// qq-tools 模块：qq_chat_history 跨会话读取（群号 / QQ 号）的单元测试。
// 不依赖宿主，直接构造最小 api 拿工具，断言它调用的 OneBot action 和参数、以及返回文案。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import qqTools from '../src/modules/qq-tools/index.js'

const BOT = '20000002'
const OWNER = '10000001'

// 每个用例都能换：config、返回的历史记录、记录的 OneBot 调用
let cfg
let calls
let history
let builder

const onebot = {
  call: async (action, params) => {
    calls.push({ action, params })
    return { messages: history }
  },
}

function freshConfig() {
  return { botQQ: BOT, allow: { groups: ['777'] } }
}

function boot() {
  calls = []
  history = []
  builder = null
  qqTools.setup({
    tool: (fn) => { builder = fn },
    config: () => cfg,
    core: { onebot, hub: {} },
  })
}

// 拿到 qq_chat_history 工具（按 chat/level 模拟不同场合）
function tool({ kind = 'private', userId = OWNER, groupId = '777', level = 'full' } = {}) {
  const chat = kind === 'group'
    ? { chatId: `group:${groupId}`, kind: 'group', groupId, userId }
    : { chatId: `private:${userId}`, kind: 'private', userId }
  const tools = builder({ chat, level, sessionId: 'sim' })
  return tools.find((t) => t.name === 'qq_chat_history')
}

// 一条历史记录（够 parseMessageEvent 用）
const msg = (uid, nick, text, type = 'private') => ({
  time: 1000,
  message_type: type,
  user_id: uid,
  sender: { user_id: uid, nickname: nick },
  message: [{ type: 'text', data: { text } }],
})

test('不填任何参数：翻当前这个聊天（私聊走 get_friend_msg_history，群聊走 get_group_msg_history）', async () => {
  cfg = freshConfig(); boot()
  history = [msg(OWNER, '主人', '在吗')]
  const r = await tool({ kind: 'private' }).execute({}, {})
  assert.equal(r.ok, true)
  assert.deepEqual(calls[0], { action: 'get_friend_msg_history', params: { user_id: Number(OWNER), count: 20 } })
  assert.match(r.message, /主人：在吗/)

  calls = []; history = [msg(123, '群友', '嗨', 'group')]
  const g = await tool({ kind: 'group', groupId: '777', userId: '123' }).execute({}, {})
  assert.equal(g.ok, true)
  assert.deepEqual(calls[0], { action: 'get_group_msg_history', params: { group_id: 777, count: 20 } })
  assert.match(g.message, /群友：嗨/)
})

test('count 会夹在 1~50 之间', async () => {
  cfg = freshConfig(); boot()
  await tool().execute({ count: 0 }, {})
  assert.equal(calls[0].params.count, 20, '0 / 缺省按 20')
  calls = []
  await tool().execute({ count: 500 }, {})
  assert.equal(calls[0].params.count, 50, '超过 50 按 50')
})

test('填 group：翻那个群的记录；不在白名单里直接拒绝且不调接口', async () => {
  cfg = freshConfig(); boot()
  history = [msg(123, '群友', '群里的话', 'group')]
  const ok = await tool().execute({ group: '777' }, {})
  assert.equal(ok.ok, true)
  assert.deepEqual(calls[0], { action: 'get_group_msg_history', params: { group_id: 777, count: 20 } })
  assert.match(ok.message, /群里的话/)

  calls = []
  const bad = await tool().execute({ group: '999' }, {})
  assert.equal(bad.ok, false)
  assert.match(bad.message, /不在白名单/)
  assert.equal(calls.length, 0, '非白名单群不该调接口')
})

test('填 user：翻和那个人的私聊记录；只有主人私聊（full）能用', async () => {
  cfg = freshConfig(); boot()
  history = [msg(OWNER, '主人', '问你个事'), msg(Number(BOT), '大肥鱼', '你说')]
  const r = await tool({ level: 'full' }).execute({ user: '3164134229' }, {})
  assert.equal(r.ok, true)
  assert.deepEqual(calls[0], { action: 'get_friend_msg_history', params: { user_id: 3164134229, count: 20 } })
  assert.match(r.message, /主人：问你个事/)
  assert.match(r.message, /你：你说/, '机器人自己的消息显示成「你」')

  // 非 full（群里、别人的私聊）一律拒绝
  calls = []
  const denied = await tool({ level: 'social' }).execute({ user: '3164134229' }, {})
  assert.equal(denied.ok, false)
  assert.match(denied.message, /只有主人/)
  assert.equal(calls.length, 0, '越权时不该调接口')
})

test('QQ 号参数会清洗成纯数字', async () => {
  cfg = freshConfig(); boot()
  await tool({ level: 'full' }).execute({ user: 'u3164134229xx' }, {})
  assert.equal(calls[0].params.user_id, 3164134229)
})

test('翻不到历史时的提示（私聊历史说明可能是非好友）', async () => {
  cfg = freshConfig(); boot()
  history = []
  const group = await tool().execute({ group: '777' }, {})
  assert.equal(group.ok, true)
  assert.equal(group.message, '没翻到聊天记录')

  calls = []
  const friend = await tool({ level: 'full' }).execute({ user: '123' }, {})
  assert.equal(friend.ok, true)
  assert.match(friend.message, /没翻到和这个人的私聊记录/)
})
