#!/usr/bin/env node
/* selftest.mjs · 解梦引擎自测（合成语料，不依赖真实数据文件） */
import { buildIndex, interpret, searchEntries, matchText, pickScene } from '../web/js/engine.js';

let fail = 0;
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); else { fail++; console.log('  ✗ ' + m); } };

const DATA = [
  { k: '蛇', c: 'animal', g: 1, nm: ['蟒蛇', '长虫', '毒蛇'],
    ct: '蛇为小龙，主潜藏之力与转机，梦见蛇多主财运将至、贵人暗助，亦有警醒之意。',
    ps: '荣格视蛇为本能与智慧的双面象征，蜕皮意味着旧我剥落与新的阶段开启。',
    sc: [{ s: '被蛇追咬', v: '象征某个被你回避的现实问题正在逼近，宜直面协商，不宜再拖。' },
         { s: '打死蛇', v: '主动终结困扰的意象，预示阻力可解，但若心生不忍则提示手段可再斟酌。' },
         { s: '蛇蜕皮', v: '旧我剥落转运之兆，多对应身份居所或工作的更替前夜。' }],
    tg: ['财运', '心绪'] },
  { k: '洪水', c: 'nature', g: 0, nm: ['大水', '发水', '水灾'],
    ct: '水主财，洪水漫溢常主财源涌动，然亦有失控之虞，宜看梦中是避险还是被吞没。',
    ps: '水在梦中多映射情绪强度，泛滥的洪水对应被压抑情绪的一次性释放。',
    sc: [{ s: '洪水淹到身上', v: '情绪负荷已到临界，梦在提醒你该给积压的心事找一个出口了。' },
         { s: '躲到高处避险', v: '象征你已找到应对压力的策略，情势虽急但你仍握有主动权。' }],
    tg: ['财运', '心绪'] },
  { k: '牙齿', c: 'body', g: -1, nm: ['牙', '掉牙', '门牙', '拔牙'],
    ct: '齿为骨之余，掉牙旧说主家中长辈有变，亦主口舌是非，然若梦后无惧则不足为虑。',
    ps: '齿脱落是压力与失控感的经典意象，多出现在身份的变动期或表达受阻的阶段。',
    sc: [{ s: '牙齿脱落', v: '常与失控感、成长焦虑相关，也可能只是夜间磨牙带来的躯体信号。' },
         { s: '牙齿松动', v: '提示某件长期支撑你的事情正在变化，宜早做准备而非等到不得不变。' }],
    tg: ['健康', '人际'] },
  { k: '考试', c: 'event', g: -1, nm: ['高考', '考试迟到', '做卷子'],
    ct: '梦见考试而答不出，旧说主近期有心事未了、有所求而受阻，宜先理清头绪再行动。',
    ps: '考试梦是评价焦虑的典型呈现，往往出现在你预感自己将被评判的时期。',
    sc: [{ s: '考试迟到', v: '你担心自己赶不上某个节奏，现实里可能有一件事已让你觉得起步太晚。' },
         { s: '题目全不会', v: '对能力被检验的深层不安，与真实水平关系不大而与你对自己的评价有关。' }],
    tg: ['学业', '事业'] },
  { k: '飞翔', c: 'action', g: 2, nm: ['飞', '会飞', '飞起来', '悬浮'],
    ct: '梦飞主身心舒展、事业得势，若飞得自由则大吉，若飞而坠落则主期望过高宜稳。',
    ps: '飞行梦多在自主感充沛、压力释放良好的阶段出现，是最典型的积极梦境之一。',
    sc: [{ s: '飞得很高很顺', v: '心理能量释放良好，是现实中自主感充足的体现，可趁势推进计划。' },
         { s: '飞着飞着坠落', v: '提示期望值可能高过了当前支点，适度降低预期或先补齐基础。' }],
    tg: ['事业', '心绪'] },
];

const IDX = buildIndex(DATA);
console.log('── 索引 ──');
ok(IDX.length === DATA.reduce((n, e) => n + 1 + e.nm.length, 0), `索引项数 ${IDX.length}`);
ok(IDX[0].len >= IDX[IDX.length - 1].len, '索引按长度降序');

console.log('\n── 匹配 ──');
const h1 = matchText('梦见一条大蛇', IDX);
ok(h1.length === 1 && h1[0].key === '蛇', '单字主键命中');
const h2 = matchText('梦见蟒蛇缠着我', IDX);
ok(h2.length === 1 && h2[0].i === 0, '别名命中归并到主键');
const h3 = matchText('梦见蟒蛇', IDX);
ok(h3.length === 1, '长别名不被短主键重复计入（区间不重叠）');
const h4 = matchText('梦见发大水冲了房子', IDX);
ok(h4.length === 1 && h4[0].i === 1, '别名「大水」命中洪水');
const h5 = matchText('梦见掉牙还流血', IDX);
ok(h5.length === 1 && h5[0].i === 2, '别名「掉牙」优先于单字「牙」');
ok(matchText('今天天气不错', IDX).length === 0, '无关文本零命中');

console.log('\n── 情境 ──');
const sc1 = pickScene(DATA[0], '一条大蛇追着我咬我拼命跑', '蛇');
ok(sc1 && sc1.s === '被蛇追咬', `“被蛇追咬”命中 → ${sc1 && sc1.s}`);
const sc2 = pickScene(DATA[0], '我拿起棍子把蛇打死了', '蛇');
ok(sc2 && sc2.s === '打死蛇', `“打死蛇”命中 → ${sc2 && sc2.s}`);
const sc3 = pickScene(DATA[0], '蛇在墙皮上慢慢蠕动着', '蛇');
ok(sc3 === null || typeof sc3.s === 'string', `无对应情境时返回 ${sc3 === null ? 'null' : sc3.s}`);

console.log('\n── 解梦主流程 ──');
const r1 = interpret('梦见一条大黑蛇从房梁上垂下来，我吓得不敢动', DATA, IDX);
ok(r1 && r1.matched === 1, `命中 ${r1 && r1.matched} 象`);
ok(r1.grade && typeof r1.score === 'number' && r1.score >= 1 && r1.score <= 99, `分数 ${r1.score.toFixed(1)} 等级 ${r1.grade}`);
ok(Array.isArray(r1.summary) && r1.summary.length >= 3, `总断 ${r1.summary.length} 段`);

const r2 = interpret('梦见掉牙，还梦到在考试但一道题都不会做，后来我飞起来了', DATA, IDX);
ok(r2 && r2.matched === 3, `三象命中 ${r2 && r2.matched}`);
ok(r2.items.every(x => x.entry && x.point > 0), '每象都有倾向分');
const bad = r2.items.filter(x => x.entry.g <= -1).length;
const good = r2.items.filter(x => x.entry.g >= 1).length;
ok(bad >= 1 && good >= 1, `吉凶并见：吉 ${good} / 凶 ${bad}`);
ok(r2.summary.some(p => p.includes('为吉象')), '总断包含吉凶并见表述');

const r3 = interpret('就是一些乱七八糟的画面，说不清', DATA, IDX);
ok(r3 && r3.matched === 0 && r3.summary.length === 0, '无命中返回空结果');

console.log('\n── 边界 ──');
ok(interpret('', DATA, IDX) === null, '空输入返回 null');
ok(interpret('   ', DATA, IDX) === null, '纯空白返回 null');
ok(interpret(null, DATA, IDX) === null, 'null 输入返回 null');
const rLong = interpret('蛇'.repeat(120) + '牙齿', DATA, IDX);
ok(rLong.matched === 2, `重复词不刷屏（命中 ${rLong.matched} 象）`);
const onlyObj = interpret('牙', DATA, IDX);
ok(onlyObj.matched === 1 && onlyObj.items[0].entry.k === '牙齿', '单字「牙」命中');

console.log('\n── 分流/检索 ──');
ok(searchEntries('蛇', DATA).length === 1, '检索主键');
ok(searchEntries('大水', DATA)[0].k === '洪水', '检索别名');
ok(searchEntries('', DATA).length === DATA.length, '空检索返回全部');
ok(searchEntries('zzz', DATA).length === 0, '无结果返回空');

console.log('\n── 分值单调性 ──');
const sGood = interpret('梦见我飞得很高很顺', DATA, IDX).score;
const sBad = interpret('梦见牙齿脱落', DATA, IDX).score;
ok(sGood > sBad, `吉象分(${sGood.toFixed(1)}) > 凶象分(${sBad.toFixed(1)})`);

console.log(`\n${fail ? '✗ 失败 ' + fail + ' 项' : '✓ 全部通过'}`);
process.exit(fail ? 1 : 0);
