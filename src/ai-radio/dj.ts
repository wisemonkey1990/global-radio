import type { Host, Lang, Preset, PresetId } from './data'

type Daypart = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night' | 'late'

const daypart = (h: number): Daypart =>
  h < 5 ? 'late' : h < 10 ? 'dawn' : h < 12 ? 'morning' : h < 14 ? 'noon' : h < 18 ? 'afternoon' : h < 20 ? 'evening' : h < 23 ? 'night' : 'late'

const ZH = {
  greet: {
    dawn: ['早上好', '新的一天开始了'],
    morning: ['上午好', '这个上午过得还顺利吗'],
    noon: ['中午好，记得吃饭', '午休时间到了'],
    afternoon: ['下午好', '下午容易犯困，来点音乐提提神'],
    evening: ['傍晚了，下班路上辛苦了', '晚上好'],
    night: ['晚上好', '忙完一天了，歇一会儿'],
    late: ['夜深了，还没睡吗', '这么晚了，我陪你一会儿'],
  } as Record<Daypart, string[]>,
  vibe: {
    mood: ['不用选，我来替你搭，熟悉的和新鲜的混着放。', '接下来的歌不赶时间，慢慢听。'],
    discover: ['今天准备了几首你可能没听过的歌。', '耳朵打开，说不定就遇到新的最爱。'],
    focus: ['接下来的音乐没有太多起伏，适合埋头做事。', '把手机放远一点，专心一会儿。'],
    road: ['系好安全带，下一首适合在路上听。', '窗外的风景换了，歌也跟着换。'],
    night: ['音量调小一点，今晚我陪你。', '这个时间的歌，适合安静地听。'],
    oldies: ['有些老歌，一响起来就回到了从前。', '经得起时间的旋律，接着放。'],
    sport: ['心率拉起来，节拍跟上。', '再坚持一组，下一首更带劲。'],
  } as Record<PresetId, string[]>,
  sign: { randy: '我是 Randy，慢慢来。', kevin: '我是 Kevin，继续往下听。', iris: '我是 Iris，待会儿见。' },
  station: (p: Preset) => `这里是调频 ${p.freq.toFixed(1)}，${p.name}电台。`,
}

const EN = {
  greet: {
    dawn: ['Good morning', 'A fresh new day'],
    morning: ['Good morning', 'Hope the morning is treating you well'],
    noon: ['Good afternoon, don’t skip lunch', 'It’s midday'],
    afternoon: ['Good afternoon', 'That afternoon slump is real, so here’s some music'],
    evening: ['Good evening, long day behind you', 'Evening, everyone'],
    night: ['Good evening', 'The day’s done, take a breath'],
    late: ['It’s late, still up?', 'Late night, and I’m keeping you company'],
  } as Record<Daypart, string[]>,
  vibe: {
    mood: ['No need to choose, I’ll mix the familiar with the new.', 'No rush, the next few songs are easy ones.'],
    discover: ['A few songs you may not have heard yet.', 'Keep your ears open, there might be a new favorite.'],
    focus: ['Not many ups and downs ahead, good for getting things done.', 'Put the phone down for a bit, and just focus.'],
    road: ['Seat belt on, the next one is made for the road.', 'The scenery changes, and so does the music.'],
    night: ['Turn it down a little, I’m here with you tonight.', 'These are songs for listening quietly.'],
    oldies: ['Some old songs take you straight back.', 'Melodies that stand the test of time, coming up.'],
    sport: ['Get that heart rate up, keep with the beat.', 'One more set, the next track hits harder.'],
  } as Record<PresetId, string[]>,
  sign: { randy: 'I’m Randy. Take it slow.', kevin: 'I’m Kevin. Stay tuned.', iris: 'I’m Iris. See you in a bit.' },
  station: (p: Preset) => `This is FM ${p.freq.toFixed(1)}, ${EN_NAMES[p.id]} radio.`,
}

const EN_NAMES: Record<PresetId, string> = {
  mood: 'Anything Goes',
  discover: 'Fresh Finds',
  focus: 'Focus',
  road: 'On the Road',
  night: 'Late Night',
  oldies: 'Golden Oldies',
  sport: 'Workout',
}

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)]

/** One DJ break: time-of-day greeting, station ID, a line about the mood, host sign-off. */
export function djLine(lang: Lang, preset: Preset, host: Host, now = new Date()): string {
  const t = lang === 'zh' ? ZH : EN
  const dp = daypart(now.getHours())
  const glue = lang === 'zh' ? '，' : '. '
  return [pick(t.greet[dp]) + glue + t.station(preset), pick(t.vibe[preset.id]), t.sign[host.id]].join(' ')
}

