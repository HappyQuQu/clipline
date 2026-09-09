import { useEffect, useRef, useState } from 'react';
import { Archive, ArrowClockwise, ArrowCounterClockwise, ArrowsOut, CalendarBlank, CaretLeft, CaretRight, Check, CheckCircle, Clock, ClosedCaptioning, DownloadSimple, Eye, FilmStrip, FolderOpen, Gear, HardDrives, Info, ListChecks, MagnifyingGlass, Microphone, Minus, Pause, Play, Plus, Scissors, SidebarSimple, SkipBack, SkipForward, Sparkle, SpeakerHigh, SpeakerSlash, VideoCamera, WarningCircle, X } from '@phosphor-icons/react';
import { ManagePage } from './App.jsx';
import { StudioLibrary, StudioTasks } from './StudioPages.jsx';

const demoDate = '2026-06-02';
const initialClips = [
  {id:1,time:'09:35',start:2148,end:2470,range:'09:35:48 – 09:41:10',duration:'05:22',status:'已识别',tone:'green',asset:'/assets/printer-0935.jpg',labels:['3D 打印机','工作室'],date:demoDate,source:'工作室'},
  {id:2,time:'09:30',start:1820,end:2148,range:'09:30:20 – 09:35:48',duration:'05:28',status:'未识别',tone:'neutral',asset:'/assets/printer-0930.jpg',labels:[],date:demoDate,source:'工作室'},
  {id:3,time:'09:24',start:1498,end:1820,range:'09:24:58 – 09:30:20',duration:'05:22',status:'视觉完成',tone:'blue',asset:'/assets/printer-0924.jpg',labels:['3D 打印机'],date:demoDate,source:'工作室'},
  {id:4,time:'09:19',start:1178,end:1497,range:'09:19:38 – 09:24:57',duration:'05:19',status:'视觉完成',tone:'blue',asset:'/assets/printer-0919.jpg',labels:['工作台'],date:demoDate,source:'工作室'},
  {id:5,time:'09:14',start:852,end:1177,range:'09:14:12 – 09:19:37',duration:'05:25',status:'未识别',tone:'neutral',asset:'/assets/printer-0914.jpg',labels:[],date:demoDate,source:'工作室'},
  {id:6,time:'09:08',start:508,end:852,range:'09:08:28 – 09:14:12',duration:'05:44',status:'未识别',tone:'neutral',asset:'/assets/printer-0914.jpg',labels:[],date:demoDate,source:'工作室'},
].map(c=>({...c,transcriptReady:c.id===1,visionReady:c.id===1||c.status==='视觉完成',recognitionTasks:{}}));
const transcript = [
  {at:2154,text:'这次打印的底板已经完成了。'},
  {at:2174,text:'打印完成后先不要取下，让它自然冷却。'},
  {at:2206,text:'检查一下边缘，看看有没有翘起来。'},
  {at:2251,text:'这一版的效果比上一次更好。'},
  {at:2308,text:'等温度降下来，再把模型取下来。'},
  {at:2372,text:'下一个模型用同样的参数就可以。'},
];
const initialTasks = [
  {id:1,title:'工作室 · 精准导出',range:'09:35:48 – 09:41:10',kind:'精准导出',status:'进行中',progress:68,created:'今天 12:24',result:'正在处理录像'},
  {id:2,clipId:1,title:'工作室 · 字幕识别',range:'09:35:48 – 09:41:10',kind:'语音识别',status:'已完成',progress:100,created:'今天 12:18',result:'6 条示例字幕'},
  {id:3,title:'工作室 · 片段导出',range:'09:08:28 – 09:14:12',kind:'快速导出',status:'已完成',progress:100,created:'今天 11:42',result:'导出已完成'},
  {id:4,clipId:3,title:'工作室 · 画面识别',range:'09:24:58 – 09:30:20',kind:'视觉识别',status:'失败',progress:41,created:'今天 12:20',result:'模型不可用，请检查模型设置后重试'},
];
const clockTime = value => {const seconds=9*3600+Math.max(0,Number.isFinite(value)?value:0);return `${String(Math.floor(seconds/3600)%24).padStart(2,'0')}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(Math.floor(seconds)%60).padStart(2,'0')}`;};
const durationTime = value => `${String(Math.floor(Math.max(0,value)/60)).padStart(2,'0')}:${String(Math.floor(Math.max(0,value)%60)).padStart(2,'0')}`;
const clipTranscripts = clip => clip.transcriptReady ? (clip.transcriptItems || (clip.id===1?transcript:[])) : [];
const exampleTranscripts = clip => [
  {at:Math.min(clip.end-1,clip.start+6),text:'示例字幕：这段录像记录了工作室的画面。'},
  {at:Math.min(clip.end-1,clip.start+26),text:'示例字幕：点击这一行，可以跳转到对应时刻。'},
];
const nav = [{id:'review',label:'回看',icon:Play},{id:'library',label:'片段库',icon:Archive},{id:'tasks',label:'任务',icon:ListChecks},{id:'manage',label:'管理',icon:Gear}];

function TimeInput({label,value,min,max,onCommit,notify}) {
  const [draft,setDraft]=useState(()=>clockTime(value));
  useEffect(()=>{setDraft(clockTime(value));},[value]);
  const commit=inputValue=>{
    const normalized=inputValue.trim().replaceAll('：',':');
    const match=/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/.exec(normalized);
    if(!match){
      setDraft(clockTime(value));
      notify(`${label}格式不正确，请输入 HH:MM:SS，例如 09:24:00`);
      return;
    }
    const seconds=(Number(match[1])-9)*3600+Number(match[2])*60+Number(match[3]);
    const next=Math.max(min,Math.min(max,seconds));
    setDraft(clockTime(next));
    onCommit(next);
    if(next!==seconds)notify(`${label}已调整到 ${clockTime(next)}，可选范围为 ${clockTime(min)} – ${clockTime(max)}`);
  };
  return <input aria-label={label} type="text" value={draft} placeholder="HH:MM:SS" autoComplete="off" spellCheck={false}
    onChange={event=>setDraft(event.target.value)}
    onBlur={event=>commit(event.currentTarget.value)}
    onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}}}
  />;
}

function useDialog(ref, close) {
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement;
    const element = ref.current;
    const focusTarget=element?.querySelector('input:not(:disabled),textarea:not(:disabled),select:not(:disabled)')||element;
    focusTarget?.focus();
    const onKey = e => {
      if(e.key === 'Escape') closeRef.current();
      if(e.key !== 'Tab') return;
      const list = [...(element?.querySelectorAll('button:not(:disabled),input,select,a[href],[tabindex="0"]') || [])];
      const first = list[0], last = list.at(-1);
      if(e.shiftKey && (document.activeElement === first || document.activeElement === element)){e.preventDefault();last?.focus();}
      else if(!e.shiftKey && document.activeElement === last){e.preventDefault();first?.focus();}
    };
    document.addEventListener('keydown',onKey);
    return () => {document.removeEventListener('keydown',onKey);previous?.focus();};
  }, [ref]);
}

export function Workspace() {
  const [page,setPage] = useState('review');
  const [clips,setClips] = useState(initialClips);
  const [selected,setSelected] = useState(1);
  const [seek,setSeek] = useState(2174);
  const [date,setDate] = useState(demoDate);
  const [tasks,setTasks] = useState(initialTasks);
  const [exportClips,setExportClips] = useState(null);
  const [range,setRange] = useState(null);
  const [searchOpen,setSearchOpen] = useState(false);
  const [notice,setNotice] = useState('');
  const [collapsed,setCollapsed] = useState(false);
  const [reviewTab,setReviewTab] = useState({tab:'字幕'});
  const notify = value => setNotice(value);
  useEffect(()=>{window.scrollTo({top:0,behavior:'instant'});},[page]);
  useEffect(() => {if(!notice)return;const timer=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(timer);},[notice]);
  useEffect(() => {
    const timer=setInterval(()=>setTasks(list=>list.some(t=>t.status==='进行中')?list.map(t=>t.status==='进行中'?{...t,progress:Math.min(100,t.progress+4),status:t.progress>=96?'已完成':'进行中',result:t.progress>=96?(t.kind==='语音识别'?'2 条示例字幕':t.kind==='视觉识别'?'2 个示例标签':'导出演示已完成'):t.result}:t):list),1800);
    return()=>clearInterval(timer);
  },[]);
  useEffect(()=>{const handler=e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setSearchOpen(true);}};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);},[]);
  const openClip = (clip,time=clip.start,tab='字幕') => {setSelected(clip.id);setSeek(time);setDate(clip.date);setReviewTab({tab});setPage('review');};
  const addTask = task => {const nextTask={id:Date.now()+Math.random(),created:'刚刚',status:'进行中',progress:0,...task};setTasks(list=>[nextTask,...list]);return nextTask.id;};
  const recognize = (items,kind='语音识别') => {
    const created=items.map(clip=>({clipId:clip.id,id:addTask({clipId:clip.id,title:`工作室 · ${kind}`,range:clip.range,kind,result:'正在生成示例结果'})}));
    setClips(list=>list.map(c=>{const task=created.find(item=>item.clipId===c.id);return task?{...c,status:'识别中',tone:'blue',recognitionTasks:{...c.recognitionTasks,[kind]:task.id}}:c;}));
    notify(`已添加 ${items.length} 个${kind}演示任务`);
  };
  const retryTask=task=>{
    setTasks(list=>list.map(t=>t.id===task.id?{...t,status:'进行中',progress:0,result:'正在重试演示任务'}:t));
    if(task.clipId&&task.kind.includes('识别'))setClips(list=>list.map(c=>c.id===task.clipId?{...c,status:'识别中',tone:'blue',recognitionTasks:{...c.recognitionTasks,[task.kind]:task.id}}:c));
    notify('任务已重新排队');
  };
  useEffect(()=>{setClips(list=>{
    let changed=false;
    const next=list.map(clip=>{
      const completed=Object.entries(clip.recognitionTasks||{}).filter(([,id])=>tasks.some(task=>task.id===id&&task.clipId===clip.id&&task.status==='已完成'));
      if(!completed.length)return clip;
      changed=true;
      const updated={...clip,recognitionTasks:{...clip.recognitionTasks}};
      for(const [kind] of completed){
        delete updated.recognitionTasks[kind];
        if(kind==='语音识别'){updated.transcriptReady=true;updated.transcriptDemo=true;updated.transcriptItems=exampleTranscripts(clip);}
        if(kind==='视觉识别'){updated.visionReady=true;updated.visionDemo=true;updated.labels=['3D 打印机','工作台'];}
      }
      updated.status=Object.keys(updated.recognitionTasks).length?'识别中':updated.transcriptReady&&updated.visionReady?'已识别':updated.transcriptReady?'字幕完成':'视觉完成';
      updated.tone=updated.status==='识别中'?'blue':'green';
      return updated;
    });
    return changed?next:list;
  });},[tasks]);
  return <div className={`studio ${collapsed?'is-collapsed':''}`}>
    <aside className="s-sidebar">
      <button className="s-brand" onClick={()=>setPage('review')} aria-label="Clipline 首页"><img src="/assets/clipline-logo.svg" alt=""/><span>Clipline<small>录像工作台</small></span></button>
      <div className="s-space-label">工作空间</div>
      <nav aria-label="主导航">{nav.map(({id,label,icon:Icon})=><button key={id} className={page===id?'active':''} onClick={()=>setPage(id)} title={label} aria-current={page===id?'page':undefined}><Icon size={21} weight={page===id?'fill':'regular'}/><span>{label}</span>{id==='tasks'&&tasks.filter(t=>t.status==='进行中').length>0&&<em>{tasks.filter(t=>t.status==='进行中').length}</em>}</button>)}</nav>
      <div className="s-source-nav"><div className="s-space-label">录像源<span>1</span></div><button className="s-source-link" onClick={()=>{setDate(demoDate);setPage('review');}}><span className="s-source-dot"/><span>工作室<small>小米摄像机 · NAS 目录</small></span></button></div>
      <div className="s-sidebar-bottom"><div className="s-index-card"><HardDrives size={20}/><div><strong>本地录像库</strong><small>123 个片段已索引</small></div><span className="s-source-dot"/></div><div className="s-prototype-label"><span>交互原型</span><small>演示数据</small><button className="s-icon-button" aria-label={collapsed?'展开导航':'折叠导航'} onClick={()=>setCollapsed(!collapsed)}><SidebarSimple size={18}/></button></div></div>
    </aside>
    <section className="s-app-body">
      <header className="s-global-bar"><div className="s-breadcrumb">工作空间<CaretRight size={12}/><strong>{nav.find(n=>n.id===page)?.label}</strong></div><button className="s-search-trigger" onClick={()=>setSearchOpen(true)}><MagnifyingGlass size={17}/><span>搜索字幕、片段或标签</span><kbd>⌘ K</kbd></button><span className="s-user-avatar" title="本地工作空间">QU</span></header>
      <main className="s-main">
        {page==='review'&&<Review clips={clips} selected={selected} setSelected={setSelected} seek={seek} setSeek={setSeek} date={date} setDate={setDate} requestedTab={reviewTab} onLibrary={()=>setPage('library')} onRecognize={recognize} onExport={(items,nextRange)=>{setRange(nextRange);setExportClips(items);}} notify={notify}/>}
        {page==='library'&&<StudioLibrary clips={clips} onOpen={openClip} onExport={items=>{setRange(null);setExportClips(items);}} onRecognize={recognize}/>}
        {page==='tasks'&&<StudioTasks tasks={tasks} onRetry={retryTask} onDownload={()=>notify('这是交互原型；实际录像下载将在接入后端后可用')} onClear={()=>setTasks(list=>list.filter(t=>t.status!=='已完成'))} onOpen={task=>{const taskClip=clips.find(c=>c.id===task.clipId)||clips.find(c=>c.range===task.range)||clips[0];openClip(taskClip,taskClip.start,task.kind==='视觉识别'?'详情':'字幕');}}/>}
        {page==='manage'&&<div className="studio-legacy"><ManagePage/></div>}
      </main>
    </section>
    {notice&&<div className="s-toast" role="status"><CheckCircle size={20} weight="fill"/>{notice}<button aria-label="关闭提示" onClick={()=>setNotice('')}><X size={16}/></button></div>}
    {searchOpen&&<SearchDialog clips={clips} onClose={()=>setSearchOpen(false)} onOpen={(clip,time)=>{openClip(clip,time);setSearchOpen(false);}}/>}
    {exportClips&&<ExportDialog clips={exportClips} availableClips={clips} range={range} onClose={()=>setExportClips(null)} onCreate={task=>addTask(task)} onTasks={()=>{setExportClips(null);setPage('tasks');}}/>}
  </div>;
}

function Review({clips,selected,setSelected,seek,setSeek,date,setDate,requestedTab,onLibrary,onRecognize,onExport,notify}) {
  const clip=clips.find(c=>c.id===selected)||clips[0];
  const [playing,setPlaying]=useState(false);
  const [rate,setRate]=useState(1);
  const [muted,setMuted]=useState(true);
  const [captions,setCaptions]=useState(false);
  const [inspector,setInspector]=useState(true);
  const [detailTab,setDetailTab]=useState(requestedTab.tab);
  const [trim,setTrim]=useState(false);
  const [trimStart,setTrimStart]=useState(2148);
  const [trimEnd,setTrimEnd]=useState(2470);
  const [zoom,setZoom]=useState(60);
  const [focus,setFocus]=useState(false);
  const hasClips=date===demoDate;
  const currentTranscript=clipTranscripts(clip);
  const transcriptIndex=currentTranscript.findLastIndex(t=>t.at<=seek);
  const shownTranscript=currentTranscript[Math.max(0,transcriptIndex)];
  const transcriptAvailable=currentTranscript.length>0;
  const recordingStart=Math.min(...clips.map(c=>c.start));
  const recordingEnd=Math.max(...clips.map(c=>c.end));
  const trimClips=clips.filter(c=>c.start<trimEnd&&c.end>trimStart);
  const trimActual=trimClips.reduce((sum,c)=>sum+Math.max(0,Math.min(c.end,trimEnd)-Math.max(c.start,trimStart)),0);
  const trackStart=zoom===60?0:Math.max(0,Math.min(3600-zoom*60,Math.floor((clip.start-zoom*15)/60)*60));
  const trackEnd=trackStart+zoom*60;
  const trackPercent=value=>Math.max(0,Math.min(100,(value-trackStart)/(trackEnd-trackStart)*100));
  const selectClip=c=>{setSelected(c.id);setSeek(c.start);if(!trim){setTrimStart(c.start);setTrimEnd(c.end);}};
  const adjacent=offset=>{const i=clips.findIndex(c=>c.id===selected);const c=clips[i+offset];if(c)selectClip(c);};
  useEffect(()=>{
    if(!playing||!hasClips)return;
    const timer=setTimeout(()=>{
      const nextSeek=seek+rate;
      if(nextSeek<clip.end){setSeek(nextSeek);return;}
      const next=clips.filter(c=>c.id!==clip.id&&c.start>=clip.end).sort((a,b)=>a.start-b.start)[0];
      if(next){
        setSelected(next.id);setSeek(Math.min(next.end,next.start+Math.max(0,nextSeek-clip.end)));
        if(next.start>clip.end)notify(`已跳过 ${durationTime(next.start-clip.end)} 无录像区间，继续播放`);
      }else{setSeek(clip.end);setPlaying(false);}
    },1000);
    return()=>clearTimeout(timer);
  },[playing,rate,seek,clip.id,clip.end,clips,hasClips,setSeek,setSelected]);
  useEffect(()=>{if(!trim){setTrimStart(clip.start);setTrimEnd(clip.end);}},[clip.id,clip.start,clip.end,trim]);
  useEffect(()=>{setDetailTab(requestedTab.tab);setInspector(true);},[requestedTab]);
  useEffect(()=>{setPlaying(false);setTrim(false);},[date]);
  useEffect(()=>{const key=e=>{if(['INPUT','TEXTAREA','SELECT','BUTTON'].includes(e.target.tagName)||e.target.closest('[role="dialog"]'))return;if(e.code==='Space'&&hasClips){e.preventDefault();setPlaying(p=>!p);}if(e.key==='Escape')setFocus(false);};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[hasClips]);
  const jumpDate=offset=>{const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()+offset);setDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);};
  const seekTimeline=value=>{const target=clips.find(c=>value>=c.start&&value<=c.end);if(target){setSelected(target.id);setSeek(value);}else notify('这个时间没有录像，点击蓝色区间查看相邻片段');};
  return <section className={`s-review ${focus?'is-focus':''}`}>
    <div className="s-page-heading"><div><div className="s-eyebrow">REVIEW YOUR MOMENTS</div><h1>录像回看<span>从时间里，找到你需要的片段。</span></h1></div><div className="s-review-filters"><label className="s-source-select"><VideoCamera size={17}/><select aria-label="当前录像源" defaultValue="工作室"><option>工作室</option></select></label><div className="s-date-filter"><button aria-label="前一天" onClick={()=>jumpDate(-1)}><CaretLeft size={15}/></button><label><CalendarBlank size={17}/><input aria-label="回看日期" type="date" value={date} onChange={e=>{if(e.target.value)setDate(e.target.value);}}/></label><button aria-label="后一天" onClick={()=>jumpDate(1)}><CaretRight size={15}/></button></div></div></div>
    <div className={`s-review-grid ${!inspector?'no-inspector':''}`}>
      <div className="s-viewing-column">
        <div className="s-video-heading"><div><span className="s-source-dot"/><strong>工作室</strong><span className="s-video-quality">1920 × 1080</span></div><div><button className={`s-icon-button ${inspector?'selected':''}`} aria-label={inspector?'收起片段信息':'打开片段信息'} onClick={()=>setInspector(!inspector)}><SidebarSimple size={19}/></button><button className={`s-button ${trim?'':'primary'}`} disabled={!hasClips} onClick={()=>setTrim(!trim)}>{trim?<X size={16}/>:<Scissors size={16}/>}<span>{trim?'取消截取':'截取片段'}</span></button></div></div>
        <div className="s-player">
          <div className="s-player-frame">
            {hasClips?<><img src={clip.id===1?'/assets/printer-main.png':clip.asset} alt={`工作室 ${clip.time} 的 3D 打印机录像画面`}/><div className="s-video-stamp"><span>录像回放</span><time>{date.replaceAll('-','.')} &nbsp; {clockTime(seek)}</time></div><div className="s-video-demo">画面预览 · 播放交互演示</div>{captions&&transcriptAvailable&&<div className="s-caption">{shownTranscript.text}</div>}{!playing&&<button className="s-center-play" aria-label="开始播放预览" onClick={()=>{if(seek>=clip.end)setSeek(clip.start);setPlaying(true);}}><Play size={27} weight="fill"/></button>}</>:<div className="s-no-video"><FilmStrip size={38}/><h2>这一天还没有录像</h2><p>切换日期，或查看最近一次索引的内容。</p><button className="s-button" onClick={()=>setDate(demoDate)}>查看 6 月 2 日录像<CaretRight size={15}/></button></div>}
          </div>
          <div className="s-player-controlbar"><div className="s-transport"><button aria-label="前一片段" disabled={!hasClips||selected===6} onClick={()=>adjacent(1)}><SkipBack size={18}/></button><button className="s-play-toggle" aria-label={playing?'暂停预览':'播放预览'} disabled={!hasClips} onClick={()=>{if(seek>=clip.end)setSeek(clip.start);setPlaying(!playing);}}>{playing?<Pause size={20} weight="fill"/>:<Play size={20} weight="fill"/>}</button><button aria-label="后一片段" disabled={!hasClips||selected===1} onClick={()=>adjacent(-1)}><SkipForward size={18}/></button></div><time>{hasClips?clockTime(seek):'--:--:--'}<span>/ {hasClips?clockTime(clip.end):'--:--:--'}</span></time><div className="s-control-spacer"/><button className="s-skip" aria-label="后退十秒" disabled={!hasClips} onClick={()=>setSeek(Math.max(clip.start,seek-10))}><ArrowCounterClockwise size={17}/><small>10</small></button><label className="s-rate"><select aria-label="播放速度" value={rate} onChange={e=>setRate(Number(e.target.value))}>{[0.5,1,1.5,2,4].map(r=><option key={r} value={r}>{r}×</option>)}</select></label><button className={captions?'on':''} aria-label="切换画面字幕" aria-pressed={captions} disabled={!hasClips||!transcriptAvailable} onClick={()=>setCaptions(!captions)}><ClosedCaptioning size={21}/></button><button aria-label={muted?'开启声音预览':'静音预览'} aria-pressed={!muted} onClick={()=>{setMuted(!muted);notify('原型使用静态录像帧，暂无音频播放');}}>{muted?<SpeakerSlash size={19}/>:<SpeakerHigh size={19}/>}</button><button aria-label={focus?'退出专注模式':'专注回看'} onClick={()=>setFocus(!focus)}>{focus?<X size={19}/>:<ArrowsOut size={19}/>}</button></div>
        </div>
        <section className="s-timeline" aria-label="录像时间轴">
          <div className="s-timeline-top"><div><strong>时间轴</strong><span className="s-timeline-legend"><i/>有录像<span className="gap"/>无录像</span></div><div className="s-timeline-tools"><button className="s-icon-button" aria-label="缩小时间轴" onClick={()=>setZoom(v=>v===15?30:60)} disabled={zoom===60}><Minus size={14}/></button><select aria-label="时间轴范围" value={zoom} onChange={e=>setZoom(Number(e.target.value))}><option value={60}>1 小时</option><option value={30}>30 分钟</option><option value={15}>15 分钟</option></select><button className="s-icon-button" aria-label="放大时间轴" onClick={()=>setZoom(v=>v===60?30:15)} disabled={zoom===15}><Plus size={14}/></button></div></div>
          <div className="s-timeline-ruler">{Array.from({length:7},(_,i)=><time key={i}>{trackStart+i*(trackEnd-trackStart)/6>=3600?'10:00':clockTime(trackStart+i*(trackEnd-trackStart)/6).slice(0,5)}</time>)}</div>
          <div className="s-timeline-track" onClick={e=>{if(!hasClips)return;const box=e.currentTarget.getBoundingClientRect();seekTimeline(trackStart+(e.clientX-box.left)/box.width*(trackEnd-trackStart));}}>
            <div className="s-timeline-ticks"/>{hasClips&&clips.filter(c=>c.end>trackStart&&c.start<trackEnd).map(c=><button key={c.id} aria-label={`定位 ${c.range}`} className={`s-recording ${c.id===selected?'active':''}`} style={{left:`${trackPercent(c.start)}%`,width:`${Math.max(.2,trackPercent(c.end)-trackPercent(c.start)-.2)}%`}} onClick={e=>{if(e.detail===0){e.stopPropagation();selectClip(c);}}}/>)}
            {hasClips&&<div className="s-playhead" style={{left:`${trackPercent(seek)}%`}}><span/>{zoom!==60&&<time>{clockTime(seek)}</time>}</div>}
          </div>
          <div className="s-timeline-bottom"><span>{hasClips?<><span className="s-source-dot"/>当前片段 <strong>{clip.range}</strong></>:'当前日期没有已索引录像'}</span><span>{hasClips?`${clips.length} 个片段`:'0 个片段'}</span></div>
          {trim&&hasClips&&<div className="s-trim-editor">
            <div className="s-trim-inputs">
              <label>起点<TimeInput label="截取起点" value={trimStart} min={recordingStart} max={trimEnd-1} onCommit={setTrimStart} notify={notify}/></label><span>—</span>
              <label>终点<TimeInput label="截取终点" value={trimEnd} min={trimStart+1} max={recordingEnd} onCommit={setTrimEnd} notify={notify}/></label>
              <span className="s-trim-duration">{trimClips.length} 个片段 · 录像 {durationTime(trimActual)}{trimEnd-trimStart>trimActual&&` · 断档 ${durationTime(trimEnd-trimStart-trimActual)}`}</span>
            </div>
            <button className="s-button primary" disabled={!trimClips.length||trimActual<=0} onClick={()=>onExport(trimClips,{start:trimStart,end:trimEnd})}><DownloadSimple size={16}/>导出区间</button>
          </div>}
        </section>
        <section className="s-filmstrip-section"><header><h2>当天片段<span>{hasClips?clips.length:0}</span></h2><button onClick={onLibrary}>进入片段库<CaretRight size={14}/></button></header>{hasClips?<div className="s-filmstrip">{clips.map(c=><button className={`s-filmstrip-clip ${selected===c.id?'active':''}`} key={c.id} onClick={()=>selectClip(c)} aria-label={`播放 ${c.time} 片段`} aria-pressed={selected===c.id}><div><img src={c.asset} alt={`${c.time} 录像缩略图`}/><span>{c.duration}</span>{selected===c.id&&<i><Play weight="fill" size={12}/>当前</i>}</div><strong>{c.range.split(' – ')[0]}<span className={`s-clip-dot ${c.tone}`}/></strong><small>{c.status}</small></button>)}</div>:<div className="s-empty-strip"><CalendarBlank size={22}/><span>试试切换到有录像的日期</span></div>}</section>
      </div>
      {inspector&&<aside className="s-inspector">
        <header><h2>片段信息</h2><span className="s-pill">{hasClips?clip.duration:'无片段'}</span></header>
        <div className="s-inspector-tabs" role="tablist" aria-label="片段信息">{['字幕','详情'].map(t=><button role="tab" aria-selected={t===detailTab} className={t===detailTab?'active':''} key={t} onClick={()=>setDetailTab(t)}>{t==='字幕'?<ClosedCaptioning size={17}/>:<Info size={17}/>} {t}{t==='字幕'&&hasClips&&transcriptAvailable&&<small>{currentTranscript.length}</small>}</button>)}</div>
        {detailTab==='字幕'?<>
          <div className="s-transcript-status"><span><CheckCircle size={14}/>{hasClips&&transcriptAvailable?'示例字幕已就绪':'暂无字幕'}</span><small>中文</small></div>
          {hasClips&&transcriptAvailable?<>
            <p className="s-transcript-hint">点击示例字幕，跳转到对应时刻</p>
            <div className="s-transcript-list">{currentTranscript.map((t,i)=><button key={t.at} className={i===transcriptIndex?'active':''} onClick={()=>setSeek(t.at)}><time>{clockTime(t.at)}</time><p>{t.text}</p>{i===transcriptIndex&&<Play size={12} weight="fill"/>}</button>)}</div>
            <div className="s-inspector-bottom"><span><Sparkle size={15}/>交互演示 · 示例字幕</span><button className="s-icon-button" title="导出示例字幕" aria-label="导出字幕" onClick={()=>{const text='交互原型示例字幕，非实际识别结果\n\n'+currentTranscript.map((t,i)=>`${i+1}\n${durationTime(t.at-clip.start)} ${t.text}`).join('\n\n');const a=document.createElement('a');const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));a.href=url;a.download=`工作室-${clip.time.replace(':','')}-示例字幕.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}><DownloadSimple size={17}/></button></div>
          </>:<div className="s-inspector-empty"><Microphone size={28}/><strong>{hasClips?'让录像变得可搜索':'选择一个录像片段'}</strong><p>此原型会生成示例字幕，用来演示按内容定位录像。</p><button className="s-button" disabled={!hasClips||Boolean(clip.recognitionTasks?.['语音识别'])} onClick={()=>onRecognize([clip])}>{clip.recognitionTasks?.['语音识别']?'识别中…':'识别字幕'}</button></div>}
        </>:hasClips?<div className="s-clip-details">
          <img src={clip.asset} alt="片段预览"/><dl><div><dt>录像源</dt><dd>工作室</dd></div><div><dt>日期</dt><dd>{date}</dd></div><div><dt>时间范围</dt><dd>{clip.range}</dd></div><div><dt>分辨率</dt><dd>1920 × 1080</dd></div><div><dt>视频编码</dt><dd>H.264</dd></div></dl>
          <h3>画面标签{clip.visionDemo?' · 示例结果':''}</h3><div className="s-labels">{clip.labels.length?clip.labels.map(label=><span key={label}>{label}</span>):<small>暂无标签</small>}</div>
          <button className="s-button" disabled={Boolean(clip.recognitionTasks?.['视觉识别'])} onClick={()=>onRecognize([clip],'视觉识别')}><Eye size={16}/>{clip.recognitionTasks?.['视觉识别']?'识别中…':'识别画面'}</button>
          <p className="s-file-note">{clip.visionDemo?'这里展示演示标签，非实际模型识别结果。':'原始文件保存在 NAS 目录中。导出和识别不会改写源录像。'}</p>
        </div>:<div className="s-inspector-empty"><FilmStrip size={28}/><strong>当前日期没有片段</strong><p>切换到有录像的日期后查看片段信息。</p></div>}
      </aside>}
    </div>
    <footer className="s-review-footer"><span><FolderOpen size={14}/>录像目录已索引 · 共 123 个片段</span><button onClick={()=>notify('目录扫描演示已完成，没有发现新片段')}><ArrowClockwise size={14}/>重新扫描</button></footer>
  </section>;
}

function SearchDialog({clips,onClose,onOpen}) {
  const ref=useRef(null);useDialog(ref,onClose);
  const [query,setQuery]=useState('');
  const normalizedQuery=query.trim().toLowerCase();
  const matchingClips=clips.filter(c=>`${c.time} ${c.range} ${c.labels.join(' ')} 工作室`.toLowerCase().includes(normalizedQuery));
  const matchingText=clips.flatMap(clip=>clipTranscripts(clip).map(t=>({...t,clip}))).filter(t=>`${t.text} ${clockTime(t.at)}`.toLowerCase().includes(normalizedQuery));
  return <div className="s-modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}>
    <section className="s-search-dialog" role="dialog" aria-modal="true" aria-labelledby="s-search-title" tabIndex={-1} ref={ref}>
      <div className="s-search-input"><MagnifyingGlass size={23}/><input autoFocus aria-label="搜索录像内容" placeholder="搜索字幕、时间或画面标签…" value={query} onChange={e=>setQuery(e.target.value)}/><button className="s-icon-button" aria-label="关闭搜索" onClick={onClose}><X size={19}/></button></div>
      <div className="s-search-dialog-content"><h2 id="s-search-title">{normalizedQuery?'搜索结果':'试试搜索「打印」或「09:35」'}</h2>
        {matchingText.slice(0,4).map(t=><button className="s-search-result" key={`${t.clip.id}-${t.at}`} onClick={()=>onOpen(t.clip,t.at)}><ClosedCaptioning size={21}/><div><strong>{t.text}</strong><small>工作室 · {t.clip.date} · 示例字幕</small></div><time>{clockTime(t.at)}</time></button>)}
        {matchingClips.slice(0,3).map(c=><button className="s-search-result" key={c.id} onClick={()=>onOpen(c)}><img src={c.asset} alt=""/><div><strong>工作室 · {c.time}</strong><small>{c.labels.join(' · ')||'录像片段'}</small></div><time>{c.duration}</time></button>)}
        {!matchingText.length&&!matchingClips.length&&<div className="s-search-empty"><MagnifyingGlass size={30}/><strong>没有找到相关内容</strong><p>换一个时间、字幕关键词或标签试试。</p></div>}
      </div><footer><span>点击结果直接打开回看</span><kbd>Esc 关闭</kbd></footer>
    </section>
  </div>;
}

function ExportDialog({clips,availableClips=clips,range,onClose,onCreate,onTasks}) {
  const ref=useRef(null);useDialog(ref,onClose);
  const [done,setDone]=useState(false);
  const [mode,setMode]=useState('快速导出');
  const start=range?.start??Math.min(...clips.map(c=>c.start));
  const end=range?.end??Math.max(...clips.map(c=>c.end));
  const actual=clips.reduce((sum,c)=>sum+Math.max(0,Math.min(c.end,end)-Math.max(c.start,start)),0);
  const available=availableClips.reduce((sum,c)=>sum+Math.max(0,Math.min(c.end,end)-Math.max(c.start,start)),0);
  const gap=Math.max(0,end-start-actual);
  const missing=Math.max(0,end-start-available);
  const omitted=Math.max(0,available-actual);
  const [filename,setFilename]=useState(`工作室_20260602_${clockTime(start).replaceAll(':','')}-${clockTime(end).replaceAll(':','')}`);
  useEffect(()=>{if(done)ref.current?.querySelector('button')?.focus();},[done]);
  return <div className="s-modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}>
    <section className="s-export-dialog" role="dialog" aria-modal="true" aria-labelledby="s-export-title" tabIndex={-1} ref={ref}>
      {done?<div className="s-export-done"><CheckCircle size={52} weight="fill"/><h2 id="s-export-title">导出任务已创建</h2><p>继续整理你的录像，任务会在后台处理。</p><button className="s-button primary" onClick={onTasks}>查看任务<CaretRight size={16}/></button><button className="s-button" onClick={onClose}>继续浏览</button><small>交互原型 · 演示任务不会生成实际视频</small></div>:<>
        <header><div><span className="s-eyebrow">EXPORT CLIP</span><h2 id="s-export-title">留住这段录像</h2><p>将选中的内容导出为一个视频文件。</p></div><button className="s-icon-button" onClick={onClose} aria-label="关闭导出"><X size={20}/></button></header>
        <div className="s-export-preview"><img src={clips[0].asset} alt="所选录像画面"/><div><span>工作室 · {demoDate}</span><strong>{clockTime(start)} – {clockTime(end)}</strong><small>{clips.length} 个片段 · 实际录像 {durationTime(actual)}</small></div></div>
        <label className="s-export-name">文件名称<div><input value={filename} onChange={e=>setFilename(e.target.value)} aria-label="导出文件名称"/><span>.mp4</span></div></label>
        <fieldset><legend>导出方式</legend>{['快速导出','精准导出'].map(m=><button key={m} className={m===mode?'selected':''} onClick={()=>setMode(m)} aria-pressed={m===mode}><span className="s-radio">{m===mode&&<i/>}</span><div><strong>{m}</strong><small>{m==='快速导出'?'保留原画质，起止时间贴近关键帧':'精确到所选时间，需要重新编码'}</small></div>{m==='快速导出'&&<em>推荐</em>}</button>)}</fieldset>
        {gap>0&&<div className="s-export-gap"><WarningCircle size={19}/><p>{missing>0&&`范围内有 ${durationTime(missing)} 无录像断档。`}{omitted>0&&`有 ${durationTime(omitted)} 录像未被选中。`}导出将跳过这些区间，仅保留选中的实际录像。</p></div>}
        <footer><span><Check size={14}/>原始录像保持不变</span><button className="s-button primary" disabled={!filename.trim()||actual<=0} onClick={()=>{const outputName=`${filename.trim().replace(/\.mp4$/i,'')}.mp4`;onCreate({title:outputName,filename:outputName,clipIds:clips.map(c=>c.id),range:`${clockTime(start)} – ${clockTime(end)}`,start,end,actualDuration:actual,kind:mode,result:'正在生成导出演示任务'});setDone(true);}}><DownloadSimple size={17}/>创建导出任务</button></footer>
      </>}
    </section>
  </div>;
}
