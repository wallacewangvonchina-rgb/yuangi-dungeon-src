/**
 * 程序化音效：整个工程没有任何音频素材（`AUDIOS = {}`），
 * 所以这里不引入文件，直接用 WebAudio 现场合成。
 *
 * 两点必须守住的约束：
 * 1) 浏览器的自动播放策略要求 AudioContext 只能在一次用户手势之后出声，
 *    因此这里懒创建——第一次 pointerdown / keydown 时才 `new AudioContext()`。
 * 2) 音效是"打击感的第三件套"（顿帧 / 震屏 / 音效），不该盖过玩家自己的音乐，
 *    所以主音量压得比较低，并且提供静音开关（M）。
 */

type OscType = OscillatorType;

const STORE_KEY = 'yuangi-dungeon:muted';
/** 主音量。故意偏低：音效负责"有反馈"，不负责"被听见"。 */
const MASTER_GAIN = 0.32;

let ctx: AudioContext | undefined;
let master: GainNode | undefined;
let noise: AudioBuffer | undefined;
let muted = false;
let loaded = false;

const readMuted = (): boolean => {
  if (loaded) {
    return muted;
  }
  loaded = true;
  try {
    muted = window.localStorage.getItem(STORE_KEY) === '1';
  } catch {
    muted = false;
  }
  return muted;
};

const persistMuted = (value: boolean): void => {
  try {
    window.localStorage.setItem(STORE_KEY, value ? '1' : '0');
  } catch {
    // 隐私模式下写不了 localStorage：静音只在本次会话生效即可。
  }
};

/** 白噪声缓冲：所有"风声 / 撞击 / 脚步"类音效的原料。 */
const buildNoise = (c: AudioContext): AudioBuffer => {
  const buffer = c.createBuffer(1, Math.floor(c.sampleRate * 0.6), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
};

/** 确保 AudioContext 存在并处于 running。必须在用户手势里调用。 */
const ensure = (): boolean => {
  readMuted();
  if (typeof window === 'undefined') {
    return false;
  }
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) {
      return false;
    }
    try {
      ctx = new Ctor();
    } catch {
      return false;
    }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_GAIN;
    master.connect(ctx.destination);
    noise = buildNoise(ctx);
  }
  if (ctx.state === 'suspended') {
    void ctx.resume();
  }
  return true;
};

const t0 = (): number => (ctx ? ctx.currentTime : 0);

interface ToneOpts {
  freq: number;
  /** 目标频率：给了就做一次 frequency 扫描。 */
  to?: number;
  dur: number;
  type?: OscType;
  gain?: number;
  delay?: number;
}

/** 一个带指数包络的振荡器音。指数包络是"打击感"的关键：起音极快、尾巴干净。 */
const tone = (o: ToneOpts): void => {
  if (!ctx || !master) {
    return;
  }
  const start = t0() + (o.delay ?? 0);
  const dur = Math.max(0.02, o.dur);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(Math.max(1, o.freq), start);
  if (o.to !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), start + dur);
  }
  const peak = o.gain ?? 0.3;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.012, dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(start);
  osc.stop(start + dur + 0.03);
};

interface BurstOpts {
  dur: number;
  gain?: number;
  delay?: number;
  /** 滤波器扫描起止频率：从高到低是"挥空"，由低到高是"发射"。 */
  from?: number;
  to?: number;
  q?: number;
  type?: BiquadFilterType;
}

/** 一段带扫频滤波的白噪声。 */
const burst = (o: BurstOpts): void => {
  if (!ctx || !master || !noise) {
    return;
  }
  const start = t0() + (o.delay ?? 0);
  const dur = Math.max(0.02, o.dur);
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = o.type ?? 'bandpass';
  filter.Q.value = o.q ?? 0.9;
  filter.frequency.setValueAtTime(Math.max(40, o.from ?? 2400), start);
  filter.frequency.exponentialRampToValueAtTime(
    Math.max(40, o.to ?? 600),
    start + dur,
  );
  const g = ctx.createGain();
  const peak = o.gain ?? 0.3;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.01, dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start(start);
  src.stop(start + dur + 0.03);
};

export const sfx = {
  /** 在第一次用户手势里调用，解锁音频。重复调用无副作用。 */
  unlock(): void {
    ensure();
  },

  isMuted(): boolean {
    return readMuted();
  },

  /** 返回切换后的静音状态。 */
  toggleMute(): boolean {
    const next = !readMuted();
    loaded = true;
    muted = next;
    persistMuted(next);
    if (ensure() && master && ctx) {
      master.gain.setTargetAtTime(next ? 0 : MASTER_GAIN, ctx.currentTime, 0.02);
    }
    return next;
  },

  /** 挥剑：一段快速下滑的风声。重击更低更长。 */
  swing(heavy = false): void {
    if (!ensure()) return;
    burst(
      heavy
        ? { dur: 0.26, gain: 0.34, from: 1900, to: 260, q: 0.8 }
        : { dur: 0.16, gain: 0.26, from: 2900, to: 620, q: 0.8 },
    );
  },

  /** 命中：低频闷响 + 一记高频碎裂。 */
  hit(heavy = false): void {
    if (!ensure()) return;
    tone({ freq: heavy ? 150 : 190, to: 62, dur: heavy ? 0.14 : 0.09, type: 'triangle', gain: 0.3 });
    burst({ dur: 0.05, gain: 0.22, from: 3200, to: 1100, type: 'highpass', q: 0.6 });
  },

  /** 击杀：比命中更重的闷响，带一点金属余韵。 */
  kill(): void {
    if (!ensure()) return;
    tone({ freq: 130, to: 46, dur: 0.2, type: 'square', gain: 0.26 });
    burst({ dur: 0.16, gain: 0.28, from: 2600, to: 320, q: 0.7 });
    tone({ freq: 940, to: 620, dur: 0.14, type: 'triangle', gain: 0.1, delay: 0.02 });
  },

  /** 冲刺 / 冲撞斩：由低到高的起跳风声。 */
  dash(): void {
    if (!ensure()) return;
    burst({ dur: 0.2, gain: 0.3, from: 700, to: 2600, q: 0.7 });
  },

  /** 突刺：极短的一记破空。 */
  thrust(): void {
    if (!ensure()) return;
    burst({ dur: 0.13, gain: 0.34, from: 4200, to: 900, q: 1.1 });
    tone({ freq: 1750, to: 2400, dur: 0.08, type: 'triangle', gain: 0.1 });
  },

  /** 嗜血斩：比普攻更"厚"的一刀。 */
  blood(): void {
    if (!ensure()) return;
    burst({ dur: 0.22, gain: 0.32, from: 1400, to: 200, q: 1.2 });
    tone({ freq: 220, to: 90, dur: 0.16, type: 'sawtooth', gain: 0.12 });
  },

  /** 回血：两个上行音，柔和一点，别和伤害音混。 */
  heal(): void {
    if (!ensure()) return;
    tone({ freq: 660, dur: 0.12, type: 'sine', gain: 0.16 });
    tone({ freq: 990, dur: 0.18, type: 'sine', gain: 0.14, delay: 0.08 });
  },

  /** 玩家受伤：低频撞击，比敌人挨打更沉。 */
  hurt(): void {
    if (!ensure()) return;
    tone({ freq: 120, to: 52, dur: 0.22, type: 'square', gain: 0.3 });
    burst({ dur: 0.12, gain: 0.2, from: 900, to: 180, q: 0.7 });
  },

  /** 蓄力跨过一档：音高随档位上升，玩家不看 UI 也知道"又上了一级"。 */
  chargeStep(level: number): void {
    if (!ensure()) return;
    const base = level >= 3 ? 880 : level === 2 ? 660 : 494;
    tone({ freq: base, dur: 0.1, type: 'triangle', gain: 0.16 });
  },

  /** 蓄力释放：按档位给出不同的"落刀"重量。 */
  chargeRelease(level: number): void {
    if (!ensure()) return;
    if (level <= 0) {
      // 误触保护触发：只给一个很轻的"空挥"。
      burst({ dur: 0.08, gain: 0.12, from: 1800, to: 700 });
      return;
    }
    const heavy = level >= 2;
    burst({ dur: heavy ? 0.28 : 0.16, gain: 0.34, from: heavy ? 1700 : 2600, to: 240 });
    tone({
      freq: level >= 3 ? 90 : 130,
      to: 44,
      dur: heavy ? 0.22 : 0.12,
      type: 'triangle',
      gain: 0.22,
    });
  },

  /** 捡金币：短促的高音，堆叠起来像"叮叮叮"。 */
  coin(): void {
    if (!ensure()) return;
    tone({ freq: 1180, to: 1760, dur: 0.07, type: 'square', gain: 0.12 });
  },

  /** 升级 / 通关：三音上行。 */
  levelUp(): void {
    if (!ensure()) return;
    [523, 659, 880].forEach((f, i) => {
      tone({ freq: f, dur: 0.26, type: 'triangle', gain: 0.18, delay: i * 0.09 });
    });
  },

  /** 传送门开启：下行闪烁，提示"可以走了"。 */
  portal(): void {
    if (!ensure()) return;
    tone({ freq: 880, to: 300, dur: 0.5, type: 'sine', gain: 0.16 });
    tone({ freq: 1320, to: 450, dur: 0.5, type: 'sine', gain: 0.1, delay: 0.06 });
  },
};
