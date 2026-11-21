import { RhythmSession } from './core.mjs';
import { SampleAudio } from './sample-audio.mjs';
import { scoreRun, formatAchievement } from './scoring.mjs';
import { Leaderboards } from './leaderboard.mjs';
import { createPlayer, loadToySdk } from './player.mjs';
import { CalibrationSession, CONTINUOUS_CALIBRATION_BEAT_MS as CALIBRATION_BEAT_MS } from './calibration.mjs';

const $ = id=>document.getElementById(id);
const panel=$('panel'), video=$('pv');
const requireHost=document.documentElement.dataset.environment==='toy';
if(requireHost)document.body.classList.add('host-mode');
const difficultyButtons=[...document.querySelectorAll('[data-difficulty]')];
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const signed=value=>`${value<0?'−':'+'}${Math.abs(value).toFixed(0)} ms`;
let prefs={};
try{prefs=JSON.parse(localStorage.getItem('xterfusion-lab-v1')||'{}')||{};}catch{prefs={};}
let chart,alignment,manifest,audioEngine,player,boards,session,result;
let screen='menu',difficultyId=prefs.lastDifficulty||'easy',busy=true,active=false,frameId=0,revision=0,lastPhase='';
let feedbackTime=0,historyFrozen=false,resumeAfterHistory=false;
let resultUnlockAt=0,resultLockTimer=0;
let calibration,calibrating=false,calibrationCount=0,calibrationMediaOffset=14;
let calibrationProfile=prefs.calibration&&typeof prefs.calibration==='object'?prefs.calibration:null;

function showError(message){$('error').textContent=message;$('error').hidden=false;}
function setScreen(next){
  if(next!=='result'){clearTimeout(resultLockTimer);resultUnlockAt=0;}
  screen=next;panel.dataset.screen=next;lastPhase='';
  for(const id of ['menu','game','result','calibration'])$(id).hidden=id!==(next==='playing'?'game':next==='calibrating'?'calibration':next);
  document.body.dataset.phase='';
}
function savePreferences(){
  try{localStorage.setItem('xterfusion-lab-v1',JSON.stringify({mediaOffset:Number($('media-offset').value),
    inputOffset:Number($('input-offset').value),hitVolume:Number($('hit-volume').value),sampleSound:$('tap-sound').checked,lastDifficulty:difficultyId,calibration:calibrationProfile}));return true;}catch{return false;}
}
function setHitVolume(value,persist=true){
  const volume=clamp(Number.isFinite(value)?value:150,0,300);
  for(const id of ['hit-volume','game-hit-volume'])$(id).value=volume;
  for(const id of ['hit-volume-value','game-hit-volume-value'])$(id).textContent=`${volume}%`;
  audioEngine?.setHitVolume(volume);
  if(persist)savePreferences();
}
function isResultLocked(){return screen==='result'&&performance.now()<resultUnlockAt;}
function lockResultActions(snapshot,token){
  resultUnlockAt=performance.now()+1200;
  $('result').dataset.locked='true';$('result-lock-note').hidden=false;
  for(const id of ['retry','choose','submit-score'])$(id).disabled=true;
  clearTimeout(resultLockTimer);
  resultLockTimer=setTimeout(()=>{
    if(screen!=='result'||result!==snapshot||revision!==token)return;
    resultUnlockAt=0;$('result').dataset.locked='false';$('result-lock-note').hidden=true;
    $('retry').disabled=false;$('choose').disabled=false;$('submit-score').disabled=snapshot.submitted||!snapshot.eligible;
  },1200);
}
function feedback(text,rating=''){$('feedback').textContent=text;$('feedback').dataset.rating=rating;feedbackTime=performance.now();}
function practiceNotice(){if(session){$('practice-indicator').hidden=!session.practiceReasons.size;}}
function onSeek(time){
  audioEngine?.stop();
  if(calibrating&&!busy){finishCalibration('time-jump');return;}
  if(!active)return;
  session.seek(time);practiceNotice();feedback('已跳转 · 本轮仅作练习');
}
function currentDifficulty(){return chart.difficulties.find(item=>item.id===difficultyId);}
function settingsChanged(event){
  if(event?.target?.id==='input-offset'||event?.target?.id==='media-offset')calibrationProfile=null;
  $('media-offset').value=clamp(Number($('media-offset').value)||0,-1000,1000);
  $('input-offset').value=clamp(Number($('input-offset').value)||0,-350,350);
  if(audioEngine)audioEngine.hitsEnabled=$('tap-sound').checked;
  savePreferences();renderCalibrationSummary();
}
async function start(id=difficultyId){
  if(busy||isResultLocked())return;
  const selected=chart.difficulties.find(item=>item.id===id);
  if(!selected)return;
  busy=true;active=false;calibrating=false;revision++;result=null;difficultyId=id;savePreferences();
  setScreen('playing');$('game-volume').open=false;$('phase').textContent='准备';$('phase-note').textContent=selected.label;
  $('practice-indicator').hidden=true;$('pause').disabled=true;$('abort').disabled=true;
  feedback('正在定位第一句…');$('error').hidden=true;
  try{
    await audioEngine.unlock();
    audioEngine.stop();
    session=new RhythmSession(chart,{difficulty:id,offsetMs:Number($('media-offset').value),inputOffsetMs:Number($('input-offset').value)});
    await player.seekAndPlay(session.rounds[0].demoStartMs+session.offsetMs-2000);
    active=true;lastPhase='';feedback('先听，下一句轮到你');
  }catch(error){showError(`无法开始：${error.message}`);setScreen('menu');}
  finally{busy=false;$('pause').disabled=false;$('abort').disabled=false;}
}
function strike(){
  if(!active||busy||screen!=='playing')return;
  if(!player.playing()){feedback('当前暂停或缓冲中');return;}
  const now=player.now();session.advance(now,true);const judgement=session.hit(now);
  if(judgement.rating==='ignored')return;
  audioEngine.playHit(judgement);
  if(judgement.rating==='extra'){feedback('多打 · 扣分','extra');return;}
  const names={criticalPerfect:'CRITICAL PERFECT',perfect:'PERFECT',great:'GREAT',good:'GOOD'};
  feedback(`${names[judgement.rating]}  ${signed(judgement.errorMs)}`,judgement.rating);
}
function showMenu(){
  if(busy||isResultLocked())return;
  active=false;calibrating=false;revision++;result=null;setScreen('menu');
  $('loading').textContent='选一个难度，即可开始。音乐不会因结算而停止。';
}
function finishGame(){
  active=false;revision++;
  const summary=session.summary(),score=scoreRun(summary),selected=currentDifficulty();
  const previous=boards.bestLocal(difficultyId);
  const best=summary.eligible?boards.recordLocal(difficultyId,score.units):previous;
  result={difficulty:difficultyId,summary,score,eligible:summary.eligible,submitted:false};
  setScreen('result');
  lockResultActions(result,revision);
  const area=$('result');area.dataset.difficulty=difficultyId;area.dataset.units=score.units;area.dataset.eligible=String(summary.eligible);
  $('result-difficulty').textContent=`${selected.label} · ${summary.total}拍`;
  $('result-score').textContent=score.percentage;$('result-grade').textContent=score.grade;
  $('result-badge').textContent=score.theoretical?'THEORETICAL · 完全理论':
    summary.hit===summary.total&&summary.extra===0?(summary.criticalPerfect+summary.perfect===summary.total?'ALL PERFECT':'FULL COMBO'):'';
  $('personal-best').textContent=best===null?'暂无个人最佳':`个人最佳 ${formatAchievement(best)}${summary.eligible&&(previous===null||score.units>previous)?' · NEW BEST':''}`;
  $('result-notice').textContent=summary.eligible?'本轮完成。后续音乐继续播放。':`练习成绩，不入榜：${summary.practiceReasons.join('、')||'存在跳过的落点'}`;
  const stats=$('judgements');stats.replaceChildren();
  for(const [key,label]of [['criticalPerfect','CP'],['perfect','P'],['great','GREAT'],['good','GOOD'],['miss','MISS'],['extra','EXTRA']]){
    const item=document.createElement('div'),name=document.createElement('small'),count=document.createElement('span');
    name.textContent=label;count.textContent=summary[key];count.id=`count-${key}`;item.append(name,count);stats.append(item);
  }
  $('submit-score').hidden=true;$('rank-list').replaceChildren();$('rank-status').textContent='正在读取当前难度榜单…';
  void renderRanking(result,revision);
}
async function renderRanking(snapshot,token){
  const ranking=await boards.read(snapshot.difficulty);
  if(screen!=='result'||result!==snapshot||token!==revision)return;
  const list=$('rank-list');list.replaceChildren();
  if(!ranking.remote){$('rank-status').textContent='本地试玩 · 全站榜待 Toy 发布接入，当前仅记录个人最佳。';return;}
  $('submit-score').hidden=!snapshot.eligible;
  $('submit-score').disabled=snapshot.submitted||isResultLocked();
  $('submit-score').textContent=snapshot.submitted?'已提交':'提交本次成绩';
  if(ranking.status==='unavailable'){$('rank-status').textContent='榜单暂不可用，本次成绩已保留。可以稍后重新提交。';return;}
  $('rank-status').textContent=ranking.entries.length?'同难度总榜 · 同分先达成者靠前':'当前难度暂无上榜成绩。';
  for(const row of ranking.entries){
    const item=document.createElement('li');
    for(const text of [String(row.rank),row.nickname,formatAchievement(row.score)]){const cell=document.createElement('span');cell.textContent=text;item.append(cell);}
    list.append(item);
  }
}
async function submitResult(){
  const snapshot=result,token=revision;
  if(!snapshot?.eligible||snapshot.submitted||isResultLocked())return;
  $('submit-score').disabled=true;$('rank-status').textContent='正在提交…首次上榜可能需要平台确认。';
  try{
    const response=await boards.submit(snapshot.difficulty,snapshot.score.units);
    if(screen!=='result'||snapshot!==result||token!==revision)return;
    if(response.status!=='remote'){$('rank-status').textContent='当前环境未连接平台，仅保存了个人最佳。';$('submit-score').hidden=true;return;}
    snapshot.submitted=true;await renderRanking(snapshot,token);
    if(screen==='result'&&snapshot===result&&token===revision){$('rank-status').textContent=response.ranked?`已提交 · 当前总榜第 ${response.rank} 名`:'已提交，暂未取得个人名次。';}
  }catch(error){
    if(screen==='result'&&snapshot===result&&token===revision){$('submit-score').disabled=false;$('rank-status').textContent=`提交未完成：${error.message||'请登录或稍后重试'}。点击可手动重试。`;}
  }
}
function renderPhase(now,playing){
  const phase=session.phaseAt(now),selected=currentDifficulty();
  const key=`${phase.kind}:${phase.round.id}:${playing}`;
  if(lastPhase===key)return;lastPhase=key;
  document.body.dataset.phase=playing?phase.kind:'';
  $('pause').textContent=playing?'暂停':'继续';
  if(!playing){$('phase').textContent='暂停';$('phase-note').textContent='音乐停下，判定也停下';return;}
  const labels={prelude:'准备',demo:'听',answer:phase.round.kind==='stream'?'连打':'你',complete:'收尾',gap:'等'};
  $('phase').textContent=labels[phase.kind];
  $('phase-note').textContent=phase.round.kind==='stream'?'硬核 · 高速跟拍':`${selected.label} · ${String(phase.round.id).padStart(2,'0')} / ${selected.roundCount}`;
}
function tick(){
  if(historyFrozen)return;
  const now=player.now(),playing=player.playing(),rate=player.rate();
  audioEngine.sync(now,!busy&&playing,rate);
  if(active){
    if(playing&&Math.abs(rate-1)>.0001){session.invalidate('变速练习');practiceNotice();}
    const misses=session.advance(now,playing);
    if(misses.length&&performance.now()-feedbackTime>180)feedback('MISS · 继续接','miss');
    if(playing&&now>=session.endVideoMs)finishGame();
    else renderPhase(now,playing);
  }
  if(calibrating&&!busy)updateCalibration(now,playing,rate);
  frameId=requestAnimationFrame(tick);
}

function renderCalibrationSummary(){
  const valid=calibrationProfile&&calibrationProfile.offsetMs===Number($('input-offset').value);
  $('calibration-summary').textContent=valid?`已校准 ${signed(calibrationProfile.offsetMs)} · 更换耳机后请重测`:'建议开始前校准 · 结果仅保存在本机';
}
async function startCalibration(){
  if(busy)return;
  busy=true;active=false;calibrating=false;result=null;revision++;
  calibrationMediaOffset=Number($('media-offset').value);
  calibration=new CalibrationSession({mediaOffsetMs:calibrationMediaOffset,rounds:1,joinAnywhere:true,beats:CALIBRATION_BEAT_MS,referenceOffsetMs:Number($('input-offset').value)});calibrationCount=0;calibration.beginRound(0);
  setScreen('calibrating');$('calibration').dataset.status='collecting';delete $('calibration').dataset.offsetMs;
  $('calibration-phase').textContent='准备';$('calibration-note').textContent='连续跟拍约14秒 · 从任意一拍加入';
  $('calibration-feedback').textContent='随时跟入，每拍一下；不用等待，也不必先休息两拍。';
  $('retry-calibration').hidden=true;$('resume-calibration').hidden=true;$('cancel-calibration').disabled=true;$('cancel-calibration').textContent='取消校准';
  try{
    await audioEngine.unlock();audioEngine.stop();
    await player.seekAndPlay(CALIBRATION_BEAT_MS[0]+calibrationMediaOffset-750);
    calibrating=true;
  }catch(error){finishCalibration('start-failed');showError(error.message);}
  finally{busy=false;$('cancel-calibration').disabled=false;}
}
function calibrationStrike(){
  if(!calibrating||busy||!player.playing())return;
  const raw=player.now();
  if(raw<CALIBRATION_BEAT_MS[0]+calibrationMediaOffset-250)return;
  const tap=calibration.tap(raw);
  if(tap.accepted){
    calibrationCount=tap.count;
    $('calibration-feedback').textContent=`已记录 ${calibrationCount} 拍 · 继续随音乐跟拍`;
  }else if(tap.reason==='duplicate')$('calibration-feedback').textContent='每拍只敲一次，不需要连点。';
  else $('calibration-feedback').textContent='这一拍未记录，继续跟随音乐。';
}
function finishCalibration(reason){
  calibrating=false;
  const analysis=reason?{ok:false,reason,sampleCount:0}:calibration.result();
  const messages={'insufficient-taps':'采样不足','rounds-disagree':'两轮偏移差异过大','segments-disagree':'前后跟拍偏移差异过大','unstable':'节奏波动偏大',
    'excess-extra-taps':'额外点击较多','first-target-missed':'错过了第一拍','offset-out-of-range':'偏移超出可测范围',
    'non-monotonic-time':'播放器时间发生跳变','time-jump':'校准中发生了跳转','changed-rate':'请将播放器恢复到1倍速','start-failed':'起播未完成'};
  $('retry-calibration').hidden=false;$('resume-calibration').hidden=true;$('cancel-calibration').disabled=false;$('cancel-calibration').textContent='返回难度选择';
  $('calibration').dataset.status=analysis.ok?'saved':'failed';
  $('calibration').dataset.sampleCount=String(analysis.sampleCount);
  if(analysis.ok){
    const offset=Math.round(analysis.offsetMs);
    $('input-offset').value=offset;
    calibrationProfile={offsetMs:offset,jitterMs:Number(analysis.jitterMs.toFixed(1)),sampleCount:analysis.sampleCount,version:2};
    const stored=savePreferences();
    $('calibration').dataset.offsetMs=String(offset);
    $('calibration-phase').textContent=signed(offset);
    $('calibration-note').textContent=stored?'校准完成 · 已保存到本机':'校准完成 · 已应用，暂未持久保存';
    $('calibration-feedback').textContent=`${analysis.sampleCount}个有效样本 · 波动约${analysis.jitterMs.toFixed(1)} ms${stored?' · 更换耳机后请重测':' · 本地存储不可用，刷新后需重校'}`;
    renderCalibrationSummary();
  }else{
    $('calibration-phase').textContent='再试一次';
    $('calibration-note').textContent=messages[analysis.reason]||'暂未取得稳定结果';
    $('calibration-feedback').textContent=`未覆盖原补偿 ${signed(Number($('input-offset').value))}。从任意一拍跟入，尽量多跟拍一会儿即可。`;
  }
}
function updateCalibration(now,playing,rate){
  if(playing&&Math.abs(rate-1)>.0001){finishCalibration('changed-rate');return;}
  $('resume-calibration').hidden=playing;
  if(!playing){$('calibration-phase').textContent='暂停';return;}
  $('calibration-phase').textContent=now<CALIBRATION_BEAT_MS[0]+calibrationMediaOffset?'准备':'跟拍';
  $('calibration-note').textContent=`连续跟拍 · 已记录${calibrationCount}拍 · 随时加入`;
  if(now>=CALIBRATION_BEAT_MS.at(-1)+calibrationMediaOffset+450)finishCalibration();
}

function loadingStage(message){$('loading').textContent=message;globalThis.__toyBoot?.setPhase(message);}

async function init(){
  loadingStage('正在读取谱面…');
  [chart,alignment,manifest]=await Promise.all(['./data/chart.json','./data/alignment.json','./data/audio-manifest.json'].map(async url=>{
    const response=await fetch(url);if(!response.ok)throw new Error(`读取失败：${url}`);return response.json();
  }));
  $('media-offset').value=clamp(Number.isFinite(prefs.mediaOffset)?prefs.mediaOffset:alignment.offsetMs,-1000,1000);
  $('input-offset').value=clamp(Number(prefs.inputOffset)||0,-350,350);$('tap-sound').checked=prefs.sampleSound!==false;
  setHitVolume(Number.isFinite(prefs.hitVolume)?prefs.hitVolume:150,false);
  const Audio=window.AudioContext||window.webkitAudioContext;
  if(!Audio)throw new Error('当前环境不支持 Web Audio');
  audioEngine=new SampleAudio(new Audio({latencyHint:'interactive'}),{backingEnabled:false});audioEngine.hitsEnabled=$('tap-sound').checked;audioEngine.setHitVolume(Number($('hit-volume').value));
  loadingStage('正在连接 B站播放器…');
  const toy=await loadToySdk({required:requireHost});
  player=await createPlayer(video,{toy,requireHost,onSeek,onPause:()=>audioEngine.stop(),onContainer:state=>{
    document.documentElement.style.setProperty('--safe-bottom',`${Math.max(0,Number(state.safeArea?.bottom)||0)}px`);
  }});
  if(requireHost&&player.kind!=='host')throw new Error('当前环境不支持半屏视频联动。请使用最新版哔哩哔哩 App，从配套视频打开半屏 Toy 游玩。');
  $('environment-notice').hidden=player.kind==='host';$('toy-sound-notice').hidden=player.kind!=='host';
  if(player.kind!=='host')$('environment-notice').textContent='本地调试模式 · 正式游玩请使用最新版 B站 App＋配套视频半屏 Toy。';
  loadingStage('正在加载鼓点采样（约 4 MB）…');
  await audioEngine.load(manifest);
  if(player.kind==='host'){document.body.classList.add('host-mode');if(video){video.pause();video.removeAttribute('src');video.load();}}
  else{
    audioEngine.attachVideo(video,{muted:false});
    video.addEventListener('play',()=>audioEngine.unlock().catch(error=>showError(error.message)));
    video.addEventListener('error',()=>showError('PV加载失败，请检查本地视频路径。'));
    const preview=()=>{video.currentTime=Math.max(0,(chart.rounds[0].demoStartMs+alignment.offsetMs-2000)/1000);};
    if(video.readyState>=1)preview();else video.addEventListener('loadedmetadata',preview,{once:true});
  }
  loadingStage('正在准备排行榜…');
  boards=new Leaderboards({toy});await boards.init();
  if(globalThis.__toyBoot&&!globalThis.__toyBoot.ready())throw new Error('本次启动已超时，请重新打开页面');
  busy=false;for(const button of difficultyButtons){button.disabled=false;button.addEventListener('click',()=>start(button.dataset.difficulty));}
  $('loading').textContent='选难度开始 · Space / F / J · 支持双指交替';
  $('calibrate').disabled=false;renderCalibrationSummary();
  $('calibrate').addEventListener('click',startCalibration);
  $('retry-calibration').addEventListener('click',startCalibration);
  $('resume-calibration').addEventListener('click',async()=>{try{await audioEngine.unlock();await Promise.resolve(player.resume());$('resume-calibration').blur();}catch(error){showError(error.message);}});
  $('cancel-calibration').addEventListener('click',showMenu);
  $('retry').addEventListener('click',()=>start(result?.difficulty||difficultyId));
  $('choose').addEventListener('click',showMenu);$('abort').addEventListener('click',showMenu);
  $('submit-score').addEventListener('click',submitResult);
  $('pause').addEventListener('click',async()=>{
    if(!active||busy)return;
    try{await audioEngine.unlock();await Promise.resolve(player.playing()?player.pause():player.resume());lastPhase='';$('pause').blur();}
    catch(error){showError(`播放控制失败：${error.message}`);}
  });
  for(const id of ['hit-volume','game-hit-volume']){
    $(id).addEventListener('input',event=>setHitVolume(Number(event.target.value),false));
    $(id).addEventListener('change',savePreferences);
  }
  for(const id of ['media-offset','input-offset','tap-sound'])$(id).addEventListener('change',settingsChanged);
  $('restore-offset').addEventListener('click',()=>{$('media-offset').value=alignment.offsetMs;calibrationProfile=null;settingsChanged();});
  document.addEventListener('pointerdown',event=>{
    if((!active&&!calibrating)||event.button!==0||event.target.closest?.('[data-ui]'))return;
    document.activeElement?.blur();
    event.preventDefault();if(calibrating)calibrationStrike();else strike();
  },{passive:false});
  document.addEventListener('keydown',event=>{
    if((!active&&!calibrating)||!['Space','KeyF','KeyJ'].includes(event.code)||event.repeat||event.ctrlKey||event.altKey||event.metaKey)return;
    const element=document.activeElement;
    if(element?.offsetParent!==null&&element?.matches('input,select,textarea'))return;
    if(event.code==='Space'&&element?.offsetParent!==null&&element?.matches('button,summary,a'))return;
    event.preventDefault();if(calibrating)calibrationStrike();else strike();
  });
  document.addEventListener('visibilitychange',async()=>{
    try{if(document.hidden&&(active||calibrating)){audioEngine.stop();await Promise.resolve(player.pause());feedback('返回后点击继续');}
      else if(!document.hidden)await player.refresh();}catch(error){showError(`播放器状态暂不可用：${error.message}`);}
  });
  frameId=requestAnimationFrame(tick);
}
window.addEventListener('pagehide',event=>{
  revision++;cancelAnimationFrame(frameId);
  if(event.persisted){
    historyFrozen=true;resumeAfterHistory=Boolean(!active&&!calibrating&&player?.playing());audioEngine?.stop();
    Promise.resolve(player?.pause()).catch(()=>{});
    return;
  }
  player?.destroy();audioEngine?.dispose().catch(()=>{});
});
window.addEventListener('pageshow',async event=>{
  if(!event.persisted||!historyFrozen)return;
  historyFrozen=false;
  if(!player)return; // Initial decoding may still finish and start the loop itself.
  try{
    await player.refresh();
    if(resumeAfterHistory){await audioEngine.unlock();await Promise.resolve(player.resume());}
    else if(active)feedback('页面已恢复，点击继续');
    else if(calibrating)$('calibration-feedback').textContent='页面已恢复，请恢复播放器后继续跟拍。';
  }catch(error){showError(`恢复播放未完成：${error.message}`);}
  lastPhase='';frameId=requestAnimationFrame(tick);
  if(screen==='result'&&result)void renderRanking(result,revision);
});
init().catch(error=>{globalThis.__toyBoot?.fail(error.message);$('loading').textContent=requireHost?'请更换游玩环境后重试。':'加载未完成，请刷新重试。';showError(requireHost?`请使用最新版哔哩哔哩 App，从配套视频打开半屏 Toy。${error.message}`:error.message);});
