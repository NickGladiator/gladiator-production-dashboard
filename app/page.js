"use client";
import { useState, useEffect, useCallback } from "react";
import { CATEGORIES, mergeData, getRankings, computeOverall, computeBonus, hasData } from "../lib/transform";

const C = {
  orange:"#D17512",brightOrange:"#FE8909",tan:"#D4C9BA",brown:"#8F774D",
  dark:"#342C29",darker:"#1e1a18",white:"#FEFEFE",
};
const BAR_COLORS=["#FE8909","#D17512","#8F774D","#7a6540","#6b5a3e","#5c4e35","#4e432d","#403826","#342e1f","#2a251a","#221e15","#1a1810"];
const SOURCE_COLORS={"hcp":"#FE8909","sheets":"#4CAF50","slack":"#8B74E8"};
const SOURCE_LABELS={"hcp":"Housecall Pro","sheets":"Google Sheets","slack":"Slack"};

function parseLocal(str){const p=str.split("-").map(Number);return new Date(p[0],p[1]-1,p[2]);}
function friendlyRange(s,e){if(!s||!e)return"";const a=parseLocal(s).toLocaleDateString("en-US",{month:"short",day:"numeric"});const b=parseLocal(e).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});return a+" - "+b;}
function getMedal(r){return["🥇","🥈","🥉"][r]??`#${r+1}`;}

function AnimatedBar({pct,color,delay=0}){
  const[w,setW]=useState(0);
  useEffect(()=>{const t=setTimeout(()=>setW(Math.max(pct,3)),delay);return()=>clearTimeout(t);},[pct,delay]);
  return(<div style={{flex:1,height:22,background:"rgba(255,255,255,.06)",borderRadius:4,overflow:"hidden"}}><div style={{width:`${w}%`,height:"100%",background:color,borderRadius:4,transition:"width .6s cubic-bezier(.4,0,.2,1)"}}/></div>);
}

function TitleSlide({dateRange}){
  return(<div style={{height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden",background:C.dark}}>
    <div style={{position:"absolute",top:0,left:0,right:0,height:5,background:`linear-gradient(90deg,${C.brightOrange},${C.orange})`}}/>
    <div style={{position:"absolute",bottom:0,left:0,right:0,height:5,background:`linear-gradient(90deg,${C.orange},${C.brightOrange})`}}/>
    <div style={{fontSize:68,marginBottom:10}}>⚔️</div>
    <div style={{fontFamily:"Georgia,serif",fontSize:52,fontWeight:"bold",color:C.brightOrange,letterSpacing:6,textTransform:"uppercase"}}>GLADIATOR</div>
    <div style={{fontFamily:"Georgia,serif",fontSize:18,color:C.tan,letterSpacing:10,textTransform:"uppercase",marginTop:6}}>Exterior Services</div>
    <div style={{marginTop:32,padding:"12px 36px",background:`linear-gradient(135deg,${C.orange},${C.brightOrange})`,borderRadius:6,color:C.white,fontSize:18,fontWeight:"bold",letterSpacing:3}}>PRODUCTION STANDINGS</div>
    <div style={{marginTop:14,color:C.tan,fontSize:15,opacity:.75,letterSpacing:1}}>📅 {dateRange}</div>
  </div>);
}

function CategorySlide({category,techs}){
  const noData=!hasData(techs,category.key);
  const ranked=getRankings(techs,category.key,category.higherIsBetter);
  const vals=ranked.map(t=>t[category.key]);
  const max=Math.max(...vals),min=Math.min(...vals),range=max-min||1;
  const total=ranked.length,rowGap=total>8?5:9,fontSize=total>8?12:13;
  const srcColor=SOURCE_COLORS[category.source]||C.tan;
  function fmt(v,t){
    if(category.key==="tips")return`$${(v/100).toFixed(2)}`;
    if(category.key==="chargeRate")return`$${v.toFixed(0)}/hr`;
    if(category.key==="callbackRate"){const jobs=t.jobsCompleted??0,cbs=t.callbacks??0;return`${v}% (${jobs}j / ${cbs}cb)`;}
    if(category.key==="upsellDollars")return`$${v.toFixed(2)}`;
    return v;
  }
  return(<div style={{height:"100%",display:"flex",flexDirection:"column",padding:"20px 44px",boxSizing:"border-box",background:C.dark}}>
    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,borderBottom:"1px solid rgba(255,255,255,.08)",paddingBottom:14}}>
      <div style={{fontSize:32}}>{category.icon}</div>
      <div style={{flex:1}}>
        <div style={{fontFamily:"Georgia,serif",fontSize:26,fontWeight:"bold",color:C.brightOrange,textTransform:"uppercase",letterSpacing:2}}>{category.label}</div>
        <div style={{color:C.tan,fontSize:11,opacity:.6,marginTop:1}}>{category.higherIsBetter?"↑ Higher is better":"↓ Lower is better"}</div>
      </div>
      <div style={{padding:"4px 12px",background:"rgba(255,255,255,.05)",borderRadius:20,color:srcColor,fontSize:10,letterSpacing:1}}>{SOURCE_LABELS[category.source]}</div>
    </div>
    {noData?(<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,opacity:.4}}><div style={{fontSize:48}}>—</div><div style={{color:C.tan,fontSize:16,letterSpacing:2}}>NO DATA THIS WEEK</div></div>):(
      <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",gap:rowGap}}>
        {ranked.map((t,i)=>{
          const pct=category.higherIsBetter?((t[category.key]-min)/range)*100:((max-t[category.key])/range)*100;
          const isFirst=t._rank===0,isLast=i===total-1;
          return(<div key={t.name} style={{display:"flex",alignItems:"center",gap:10,opacity:isLast?0.55:1}}>
            <div style={{width:30,fontSize:t._rank<3?16:fontSize,textAlign:"center",color:t._rank<3?C.white:"rgba(255,255,255,.45)",fontWeight:"bold"}}>{getMedal(t._rank)}</div>
            <div style={{width:140,color:isFirst?C.brightOrange:C.white,fontSize,fontWeight:isFirst?"bold":"normal",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.name}</div>
            <AnimatedBar pct={Math.max(pct,3)} color={BAR_COLORS[t._rank]??"#1a1810"} delay={i*60}/>
            <div style={{width:120,textAlign:"right",color:isFirst?C.brightOrange:C.white,fontWeight:isFirst?"bold":"normal",fontSize:isFirst?fontSize+2:fontSize}}>{fmt(t[category.key],t)}</div>
          </div>);
        })}
      </div>
    )}
    <div style={{marginTop:10,display:"flex",justifyContent:"space-between",color:C.tan,fontSize:10,opacity:.3}}><span>GLADIATOR EXTERIOR SERVICES</span><span>PRODUCTION STANDINGS</span></div>
  </div>);
}

function BonusSlide({techs}){
  const ranked=computeBonus(techs);
  const totalPayout=ranked.reduce((s,t)=>s+t.payout,0);
  const maxPayout=ranked[0]?.payout||1,total=ranked.length,rowGap=total>8?5:9,fontSize=total>8?12:13;
  return(<div style={{height:"100%",display:"flex",flexDirection:"column",padding:"20px 44px",boxSizing:"border-box",background:C.dark}}>
    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,borderBottom:"1px solid rgba(255,255,255,.08)",paddingBottom:14}}>
      <div style={{fontSize:32}}>💵</div>
      <div style={{flex:1}}>
        <div style={{fontFamily:"Georgia,serif",fontSize:26,fontWeight:"bold",color:C.brightOrange,textTransform:"uppercase",letterSpacing:2}}>P4P Bonus Payout</div>
        <div style={{color:C.tan,fontSize:11,opacity:.6,marginTop:1}}>Performance dollars from P4P</div>
      </div>
      <div style={{textAlign:"right"}}>
        <div style={{color:C.tan,fontSize:10,opacity:.5,letterSpacing:1}}>TOTAL PAYOUT</div>
        <div style={{color:C.brightOrange,fontSize:22,fontWeight:"bold"}}>${totalPayout.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
      </div>
    </div>
    <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",gap:rowGap}}>
      {ranked.map((t,i)=>{
        const pct=(t.payout/maxPayout)*100,isFirst=i===0,isLast=i===total-1;
        return(<div key={t.name} style={{display:"flex",alignItems:"center",gap:10,opacity:isLast?0.55:1}}>
          <div style={{width:30,fontSize:i<3?16:fontSize,textAlign:"center",color:i<3?C.white:"rgba(255,255,255,.45)",fontWeight:"bold"}}>{getMedal(i)}</div>
          <div style={{width:140,color:isFirst?C.brightOrange:C.white,fontSize,fontWeight:isFirst?"bold":"normal"}}>{t.name}</div>
          <AnimatedBar pct={Math.max(pct,3)} color={BAR_COLORS[i]??"#1a1810"} delay={i*60}/>
          <div style={{width:130,textAlign:"right"}}><span style={{color:isFirst?C.brightOrange:C.white,fontWeight:isFirst?"bold":"normal",fontSize:isFirst?fontSize+2:fontSize}}>${t.payout.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
        </div>);
      })}
    </div>
    <div style={{marginTop:10,display:"flex",justifyContent:"space-between",color:C.tan,fontSize:10,opacity:.3}}><span>GLADIATOR EXTERIOR SERVICES</span><span>PRODUCTION STANDINGS</span></div>
  </div>);
}

function OverallSlide({techs}){
  const ranked=computeOverall(techs);
  const active=ranked.filter(t=>t.active),inactive=ranked.filter(t=>!t.active);
  const[show,setShow]=useState(false);
  useEffect(()=>{setShow(false);const t=setTimeout(()=>setShow(true),150);return()=>clearTimeout(t);},[]);
  const total=active.length,fontSize=total>8?12:14,rowGap=total>8?6:10;
  return(<div style={{height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"20px 56px",boxSizing:"border-box",position:"relative",background:C.dark}}>
    <div style={{position:"absolute",top:0,left:0,right:0,height:5,background:`linear-gradient(90deg,${C.brightOrange},${C.orange})`}}/>
    <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:20}}>
      <div style={{fontSize:48,transition:"transform .6s",transform:show?"scale(1)":"scale(0.4)"}}>🏆</div>
      <div>
        <div style={{fontSize:11,color:C.tan,letterSpacing:4,textTransform:"uppercase",opacity:.6}}>Overall Best Tech</div>
        <div style={{fontFamily:"Georgia,serif",fontSize:36,fontWeight:"bold",color:C.brightOrange,transition:"opacity .6s, transform .6s",opacity:show?1:0,transform:show?"translateY(0)":"translateY(16px)"}}>{active[0]?.name??"—"}</div>
      </div>
    </div>
    <div style={{width:"70%",display:"flex",flexDirection:"column",gap:rowGap}}>
      {active.map((item,i)=>{
        const isFirst=i===0,pct=(item.pts/active[0].pts)*100;
        return(<div key={item.name} style={{display:"flex",alignItems:"center",gap:10,transition:`opacity .4s ${i*50}ms, transform .4s ${i*50}ms`,opacity:show?1:0,transform:show?"translateX(0)":"translateX(-20px)"}}>
          <div style={{width:30,fontSize:i<3?16:fontSize,textAlign:"center",color:i<3?C.white:"rgba(255,255,255,.4)"}}>{getMedal(i)}</div>
          <div style={{width:140,color:isFirst?C.brightOrange:C.white,fontSize,fontWeight:isFirst?"bold":"normal"}}>{item.name}</div>
          <AnimatedBar pct={Math.max(pct,3)} color={isFirst?C.brightOrange:BAR_COLORS[i]??"#1a1810"} delay={i*50}/>
          <div style={{width:50,textAlign:"right",color:isFirst?C.brightOrange:C.tan,fontSize,opacity:isFirst?1:.7}}>{item.pts} pts</div>
        </div>);
      })}
      {inactive.length>0&&(<div style={{marginTop:8,borderTop:"1px solid rgba(255,255,255,.08)",paddingTop:8,display:"flex",flexWrap:"wrap",gap:6}}>
        {inactive.map(t=>(<div key={t.name} style={{color:C.tan,fontSize:11,opacity:.3,padding:"2px 8px",border:"1px solid rgba(255,255,255,.08)",borderRadius:3}}>{t.name}</div>))}
      </div>)}
    </div>
    <div style={{marginTop:20,padding:"7px 22px",border:"1px solid rgba(254,137,9,.3)",borderRadius:4,color:C.orange,fontSize:11,letterSpacing:2}}>KEEP PUSHING ⚔️</div>
  </div>);
}

function DashboardCard({category,techs}){
  const noData=!hasData(techs,category.key);
  const ranked=getRankings(techs,category.key,category.higherIsBetter);
  const vals=ranked.map(t=>t[category.key]);
  const max=Math.max(...vals),min=Math.min(...vals),range=max-min||1;
  function fmt(v,t){
    if(category.key==="tips")return`$${(v/100).toFixed(2)}`;
    if(category.key==="chargeRate")return`$${v.toFixed(0)}/hr`;
    if(category.key==="callbackRate")return`${v}% (${t.jobsCompleted??0}j/${t.callbacks??0}cb)`;
    if(category.key==="upsellDollars")return`$${v.toFixed(2)}`;
    return v;
  }
  return(<div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:8,padding:"14px 16px"}}>
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,borderBottom:"1px solid rgba(255,255,255,.06)",paddingBottom:10}}>
      <span style={{fontSize:18}}>{category.icon}</span>
      <span style={{color:C.brightOrange,fontWeight:"bold",fontSize:12,letterSpacing:1,textTransform:"uppercase"}}>{category.label}</span>
    </div>
    {noData?(<div style={{color:C.tan,fontSize:11,opacity:.4,textAlign:"center",padding:"10px 0"}}>No data</div>):(
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {ranked.map((t,i)=>{
          const pct=category.higherIsBetter?((t[category.key]-min)/range)*100:((max-t[category.key])/range)*100;
          const isFirst=t._rank===0;
          return(<div key={t.name} style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:20,fontSize:t._rank<3?12:10,textAlign:"center"}}>{getMedal(t._rank)}</div>
            <div style={{width:110,fontSize:11,color:isFirst?C.brightOrange:C.white,fontWeight:isFirst?"bold":"normal",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.name}</div>
            <div style={{flex:1,height:6,background:"rgba(255,255,255,.06)",borderRadius:3,overflow:"hidden"}}>
              <div style={{width:`${Math.max(pct,3)}%`,height:"100%",background:BAR_COLORS[t._rank]??"#1a1810",borderRadius:3}}/>
            </div>
            <div style={{width:90,textAlign:"right",fontSize:11,color:isFirst?C.brightOrange:C.tan}}>{fmt(t[category.key],t)}</div>
          </div>);
        })}
      </div>
    )}
  </div>);
}

function Dashboard({data,onBack}){
  const{techs,dateRange}=data;
  const overall=computeOverall(techs);
  const active=overall.filter(t=>t.active);
  return(<div style={{minHeight:"100vh",background:C.darker,fontFamily:"system-ui,sans-serif"}}>
    <div style={{background:C.dark,borderBottom:"1px solid rgba(255,255,255,.08)",padding:"12px 24px",display:"flex",alignItems:"center",gap:16}}>
      <span style={{fontSize:24}}>⚔️</span>
      <div>
        <div style={{fontFamily:"Georgia,serif",color:C.brightOrange,fontWeight:"bold",fontSize:18,letterSpacing:2}}>GLADIATOR</div>
        <div style={{color:C.tan,fontSize:11,opacity:.6}}>📅 {dateRange}</div>
      </div>
      <div style={{flex:1}}/>
      {active[0]&&(<div style={{textAlign:"right"}}>
        <div style={{color:C.tan,fontSize:10,opacity:.5,letterSpacing:1}}>🏆 OVERALL LEADER</div>
        <div style={{color:C.brightOrange,fontWeight:"bold",fontSize:16}}>{active[0].name}</div>
      </div>)}
      <button onClick={onBack} style={{padding:"6px 14px",background:"transparent",border:"1px solid rgba(255,255,255,.15)",borderRadius:4,color:C.tan,fontSize:12,cursor:"pointer"}}>← Back</button>
    </div>
    <div style={{padding:24,display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(340px, 1fr))",gap:16}}>
      {CATEGORIES.map(cat=><DashboardCard key={cat.key} category={cat} techs={techs}/>)}
    </div>
  </div>);
}

function SetupScreen({onGenerate}){
  const today=new Date();
  const fmt=d=>d.toISOString().slice(0,10);
  const[start,setStart]=useState(fmt(new Date(today.getFullYear(),today.getMonth(),1)));
  const[end,setEnd]=useState(fmt(today));
  const[mode,setMode]=useState("slideshow");
  const[status,setStatus]=useState("");
  const[error,setError]=useState("");
  const range=friendlyRange(start,end);

  const generate=async()=>{
    setError("");setStatus("Connecting to Housecall Pro...");
    try{
      const hcpRes=await fetch(`/api/hcp?startDate=${start}&endDate=${end}`);
      const hcpData=await hcpRes.json();
      if(hcpData.error)throw new Error("HCP: "+hcpData.error);
      const techNames=encodeURIComponent(JSON.stringify(hcpData.data.map(t=>t.tech)));
      setStatus("Loading Sheets & Slack...");
      const[sheetsRes,slackRes]=await Promise.all([
        fetch(`/api/sheets?startDate=${start}&endDate=${end}&techs=${techNames}`),
        fetch(`/api/slack?startDate=${start}&endDate=${end}`),
      ]);
      setStatus("Processing data...");
      const sheetsData=await sheetsRes.json(),slackData=await slackRes.json();
      if(sheetsData.error)throw new Error("Sheets: "+sheetsData.error);
      if(slackData.error)throw new Error("Slack: "+slackData.error);
      const merged=mergeData(hcpData.data,sheetsData.data,slackData.data);
      setStatus("");
      onGenerate({techs:merged,dateRange:range,mode});
    }catch(err){setStatus("");setError(err.message);}
  };

  const modeBtn=(val,icon,label,desc)=>(
    <div onClick={()=>setMode(val)} style={{flex:1,padding:"14px 12px",borderRadius:7,border:`2px solid ${mode===val?C.brightOrange:"rgba(255,255,255,.1)"}`,background:mode===val?"rgba(254,137,9,.1)":"rgba(255,255,255,.03)",cursor:"pointer",textAlign:"center"}}>
      <div style={{fontSize:28,marginBottom:4}}>{icon}</div>
      <div style={{color:mode===val?C.brightOrange:C.white,fontWeight:"bold",fontSize:13}}>{label}</div>
      <div style={{color:C.tan,fontSize:11,opacity:.6,marginTop:3}}>{desc}</div>
    </div>
  );

  return(<div style={{minHeight:"100vh",background:C.darker,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:40,fontFamily:"system-ui,sans-serif"}}>
    <div style={{fontSize:48,marginBottom:6}}>⚔️</div>
    <div style={{fontFamily:"Georgia,serif",fontSize:32,fontWeight:"bold",color:C.brightOrange,letterSpacing:3,marginBottom:2}}>GLADIATOR</div>
    <div style={{color:C.tan,fontSize:12,letterSpacing:4,marginBottom:32,opacity:.7}}>PRODUCTION MEETING GENERATOR</div>
    <div style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",borderRadius:10,padding:32,maxWidth:480,width:"100%",display:"flex",flexDirection:"column",gap:20}}>
      <div>
        <div style={{color:C.brightOrange,fontSize:11,letterSpacing:3,fontWeight:"bold",marginBottom:10}}>📅 SELECT DATE RANGE</div>
        <div style={{display:"flex",gap:12,alignItems:"center"}}>
          <div style={{flex:1}}>
            <label style={{color:C.tan,fontSize:11,display:"block",marginBottom:4,opacity:.6}}>FROM</label>
            <input type="date" value={start} onChange={e=>setStart(e.target.value)} style={{width:"100%",padding:"10px 12px",background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.15)",borderRadius:5,color:C.white,fontSize:14,boxSizing:"border-box",colorScheme:"dark"}}/>
          </div>
          <div style={{color:C.tan,marginTop:16,opacity:.4}}>→</div>
          <div style={{flex:1}}>
            <label style={{color:C.tan,fontSize:11,display:"block",marginBottom:4,opacity:.6}}>TO</label>
            <input type="date" value={end} onChange={e=>setEnd(e.target.value)} style={{width:"100%",padding:"10px 12px",background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.15)",borderRadius:5,color:C.white,fontSize:14,boxSizing:"border-box",colorScheme:"dark"}}/>
          </div>
        </div>
        {range&&(<div style={{marginTop:10,padding:"8px 12px",background:"rgba(254,137,9,.08)",borderRadius:5,border:"1px solid rgba(254,137,9,.2)",color:C.brightOrange,fontSize:13,textAlign:"center"}}>📅 {range}</div>)}
      </div>
      <div>
        <div style={{color:C.brightOrange,fontSize:11,letterSpacing:3,fontWeight:"bold",marginBottom:10}}>🎯 SELECT VIEW</div>
        <div style={{display:"flex",gap:10}}>
          {modeBtn("slideshow","📽️","Slideshow","One category at a time")}
          {modeBtn("dashboard","📊","Dashboard","All categories at once")}
        </div>
      </div>
      {error&&<div style={{color:"#ff6b6b",fontSize:13,padding:"10px 14px",background:"rgba(255,107,107,.1)",borderRadius:5,border:"1px solid rgba(255,107,107,.2)"}}>⚠️ {error}</div>}
      {status&&<div style={{color:C.tan,fontSize:13,textAlign:"center",opacity:.7}}>⏳ {status}</div>}
      <button onClick={generate} disabled={!!status} style={{padding:"16px 0",background:status?"rgba(254,137,9,.3)":`linear-gradient(135deg,${C.orange},${C.brightOrange})`,border:"none",borderRadius:6,color:C.white,fontSize:17,fontWeight:"bold",cursor:status?"not-allowed":"pointer",letterSpacing:2,boxShadow:status?"none":"0 4px 20px rgba(254,137,9,.3)"}}>
        {status?"Loading...":"⚔️ GENERATE STANDINGS"}
      </button>
    </div>
  </div>);
}

function Slideshow({data,onBack}){
  const{techs,dateRange}=data;
  const total=CATEGORIES.length+3;
  const[slide,setSlide]=useState(0);
  const[animKey,setAnimKey]=useState(0);
  const[dir,setDir]=useState(1);
  const go=useCallback((n)=>{if(n<0||n>=total)return;setDir(n>slide?1:-1);setSlide(n);setAnimKey(k=>k+1);},[slide,total]);
  useEffect(()=>{const h=e=>{if(e.key==="ArrowRight"||e.key==="ArrowDown")go(slide+1);if(e.key==="ArrowLeft"||e.key==="ArrowUp")go(slide-1);};window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h);},[go,slide]);
  const slideNames=["Intro",...CATEGORIES.map(c=>c.label),"P4P Bonus","Overall"];
  const slides=[
    <TitleSlide key="title" dateRange={dateRange}/>,
    ...CATEGORIES.map(cat=><CategorySlide key={cat.key} category={cat} techs={techs}/>),
    <BonusSlide key="bonus" techs={techs}/>,
    <OverallSlide key="overall" techs={techs}/>,
  ];
  return(<div style={{height:"100vh",background:C.darker,display:"flex",flexDirection:"column",fontFamily:"system-ui,sans-serif"}}>
    <div style={{flex:1,position:"relative",overflow:"hidden"}}>
      <div key={animKey} style={{height:"100%",animation:`slideIn${dir>0?"Right":"Left"} 0.35s cubic-bezier(.4,0,.2,1) forwards`}}>{slides[slide]}</div>
      {slide>0&&(<button onClick={()=>go(slide-1)} style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",background:"rgba(0,0,0,.45)",border:"1px solid rgba(255,255,255,.15)",borderRadius:"50%",width:42,height:42,color:C.white,fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>‹</button>)}
      {slide<total-1&&(<button onClick={()=>go(slide+1)} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"rgba(0,0,0,.45)",border:"1px solid rgba(255,255,255,.15)",borderRadius:"50%",width:42,height:42,color:C.white,fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>›</button>)}
    </div>
    <div style={{background:"#1a1512",borderTop:"1px solid rgba(255,255,255,.08)",padding:"10px 20px",display:"flex",alignItems:"center",gap:12}}>
      <button onClick={onBack} style={{padding:"6px 14px",background:"transparent",border:"1px solid rgba(255,255,255,.15)",borderRadius:4,color:C.tan,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>← Change Dates</button>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        {Object.entries(SOURCE_LABELS).map(([key,label])=>(<div key={key} style={{display:"flex",alignItems:"center",gap:4}}><div style={{width:7,height:7,borderRadius:"50%",background:SOURCE_COLORS[key]}}/><span style={{color:C.tan,fontSize:10,opacity:.45}}>{label}</span></div>))}
      </div>
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
        {slideNames.map((name,i)=>(<div key={i} onClick={()=>go(i)} title={name} style={{width:i===slide?22:8,height:8,borderRadius:4,background:i===slide?C.brightOrange:"rgba(255,255,255,.18)",transition:"all .25s",cursor:"pointer"}}/>))}
      </div>
      <div style={{color:C.tan,fontSize:12,opacity:.4,whiteSpace:"nowrap"}}>{slideNames[slide]} · {slide+1}/{total}</div>
      <div style={{color:C.tan,fontSize:11,opacity:.25,whiteSpace:"nowrap"}}>← → keys</div>
    </div>
    <style>{`@keyframes slideInRight{from{opacity:0;transform:translateX(40px)}to{opacity:1;transform:translateX(0)}}@keyframes slideInLeft{from{opacity:0;transform:translateX(-40px)}to{opacity:1;transform:translateX(0)}}`}</style>
  </div>);
}

export default function App(){
  const[data,setData]=useState(null);
  if(!data)return<SetupScreen onGenerate={setData}/>;
  if(data.mode==="dashboard")return<Dashboard data={data} onBack={()=>setData(null)}/>;
  return<Slideshow data={data} onBack={()=>setData(null)}/>;
}
