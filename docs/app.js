(function(){
"use strict";
var SERVER = "Asana";
var PROJECT = "1220513535996204";               /* お歳暮訪問（2026年12月） */
var SEC = {plan:"1220513679683403", done:"1220513687722729", out:"1220513747916156", test:"1220513686788740"};
var SEC_NAME = {out:"対象外・郵送へ変更", test:"テストデモ", done:"訪問完了"};
var PERIOD = {from:"2026-12-01", to:"2026-12-25"};
var HISTORY_FROM = "2026-11-01";
var WD = ["日","月","火","水","木","金","土"];
var RESULTS = [
  {k:"hand",   label:"手渡し（本人）",   sub:"ご本人に手渡し",   done:true},
  {k:"family", label:"手渡し（ご家族）", sub:"ご家族・代理の方", done:true},
  {k:"leave",  label:"不在・置き配",     sub:"お手紙を添えて",   done:true},
  {k:"back",   label:"不在・持ち帰り",   sub:"再訪問する",       done:false}
];
var TOPICS = ["今後の方針","リフォーム・設備","他物件の動き","相続・代替わり","不満・ご要望"];
var QA = [
  ["今後の方針","最近の物件の運用で、お考えのことはありますか。今後のご計画があれば教えてください。","建替え・売却・バリューアップの検討の有無"],
  ["リフォーム・設備","内装や設備を入れ替えるオーナー様が増えています。気になるところはありますか。","リフォームの意欲"],
  ["他物件の動き","浴室乾燥機や宅配ボックスが人気で、反響が変わることもあります。ご興味はありますか。","設備提案のきっかけ"],
  ["相続・代替わり","ご家族や次の代と、物件をどうするか話題になることはありますか。","建替え・大規模修繕の時期"],
  ["不満・ご要望","当社の管理でご不便な点や、こうしてほしいという点があれば教えてください。","隠れたご要望・改善と提案の機会"]
];

var S = {
  mcp:null, owners:[], meGid:null, loaded:false, loading:false, error:null, freshAt:null,
  tab:"plan", planDate:todayStr(), who:lsGet("who","auto"), showTest:lsGet("showTest",null),
  area:null, areaFilter:"todo", q:"", sheet:null, busy:false
};

/* ---------- utils ---------- */
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function pad(n){return (n<10?"0":"")+n;}
function dStr(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());}
function todayStr(){return dStr(new Date());}
function addDays(s,n){var p=s.split("-");var d=new Date(+p[0],+p[1]-1,+p[2]);d.setDate(d.getDate()+n);return dStr(d);}
function md(s){if(!s)return "";var p=s.split("-");return (+p[1])+"/"+(+p[2]);}
function wd(s){var p=s.split("-");return WD[new Date(+p[0],+p[1]-1,+p[2]).getDay()];}
function lsGet(k,def){try{var v=localStorage.getItem("seibo:"+k);return v?JSON.parse(v):def;}catch(e){return def;}}
function lsSet(k,v){try{localStorage.setItem("seibo:"+k,JSON.stringify(v));}catch(e){}}
function toast(msg){var r=document.getElementById("toastRoot");r.innerHTML='<div class="toast" role="status">'+esc(msg)+'</div>';clearTimeout(toast.t);toast.t=setTimeout(function(){r.innerHTML="";},2600);}
function shortName(n){return String(n||"").replace(/[\s　]+/g," ").split(" ")[0]||n;}

/* 住所 → 市町村・町名 */
function splitAddr(a){
  var s=String(a||"").replace(/^[\s　]+/,"").replace(/^長[崎﨑]県/,"");
  var m=s.match(/^(?:.+?郡)?(.+?[市町村])(.*)$/);
  if(!m) return {city:"住所なし",area:"住所なし"};
  var city=m[1], rest=m[2].replace(/^[\s　]+/,"");
  if(rest.indexOf(city)===0) rest=rest.slice(city.length);
  var area=rest.replace(/[0-9０-９].*$/,"").replace(/[一二三四五六七八九十]+丁目.*$/,"").replace(/[\s　‐\-ー－].*$/,"").replace(/[ⅠⅡⅢⅣⅤ]+$/,"").trim();
  if(!area) area=city;
  return {city:city,area:area};
}
function navAddr(a){
  var s=String(a||"").trim().replace(/[\s　]*[0-9０-９]+[FＦ階].*$/,"").replace(/【.*?】/g,"").trim();
  if(!/^(長崎県|.+?[都道府県])/.test(s)) s="長崎県"+s;
  return s;
}
function gmapOne(a){return "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination="+encodeURIComponent(navAddr(a));}
function gmapRoute(list){
  var dest=list[list.length-1], way=list.slice(0,-1);
  var u="https://www.google.com/maps/dir/?api=1&travelmode=driving&destination="+encodeURIComponent(navAddr(dest.addr));
  if(way.length) u+="&waypoints="+way.map(function(o){return encodeURIComponent(navAddr(o.addr));}).join("%7C");
  return u;
}

/* ---------- タスクの説明欄（1行＝「項目：値」）---------- */
function parseNotes(notes){
  var f={}, visits=[], manual=[];
  String(notes||"").split(/\r?\n/).forEach(function(line){
    var m=line.match(/^\s*([^：:]{1,12})[：:]\s?(.*)$/); if(!m) return;
    var k=m[1].trim(), v=m[2].trim();
    if(k==="訪問記録"){
      var p=v.split("｜"), h=p[0].trim().match(/^(\d{4}-\d{2}-\d{2})\s*(.*)$/);
      if(h) visits.push({date:h[1],result:h[2].trim(),raw:v});
    } else if(k==="マニュアル追記"){ manual.push(v); }
    else if(!(k in f)) f[k]=v;
  });
  visits.sort(function(a,b){return a.date<b.date?-1:a.date>b.date?1:0;});
  return {f:f,visits:visits,manual:manual};
}
function parseTask(t){
  var sec="", secGid="";
  (t.memberships||[]).forEach(function(m){if(m.project&&m.project.gid===PROJECT&&m.section){sec=m.section.name;secGid=m.section.gid||"";}});
  var pn=parseNotes(t.notes), f=pn.f, addr=f["訪問先"]||"", sp=splitAddr(addr);
  var last=pn.visits.length?pn.visits[pn.visits.length-1]:null;
  var backs=pn.visits.filter(function(v){return /持ち帰り/.test(v.result);}).length;
  return {gid:t.gid, name:String(t.name||"").trim(), notes:String(t.notes||""), cd:f["家主CD"]||"", bldg:f["物件"]||"", addr:addr,
    city:sp.city, area:sp.area, region:f["エリア"]||"", mgmt:f["管理形態"]||"", mourning:f["喪中"]||"", memo:f["備考"]||"", wall:f["外壁提案"]||"",
    visits:pn.visits, last:last, backs:backs, manual:pn.manual,
    who:t.assignee?{gid:t.assignee.gid,name:t.assignee.name||""}:null,
    section:sec, secGid:secGid, url:t.permalink_url||"", due:t.due_on||"", done:!!t.completed};
}
/* テスト用：テストデモのセクション、または家主CDが「T＋数字」（完了して訪問完了へ移ってもテスト扱い） */
function isTest(o){return o.section===SEC_NAME.test||o.secGid===SEC.test||/^T\d+$/.test(o.cd);}
function isOut(o){return o.section===SEC_NAME.out||o.secGid===SEC.out;}
function testVisible(){
  if(S.showTest!==null) return S.showTest;
  return !S.owners.some(function(o){return !isTest(o);}); /* 本番データが入るまではテストを表示 */
}
function pool(){return S.owners.filter(function(o){return !isOut(o)&&(testVisible()||!isTest(o));});}
function whoKey(){
  if(S.who!=="auto") return S.who;
  return (S.meGid&&pool().some(function(o){return o.who&&o.who.gid===S.meGid;}))?"me":"all";
}
function mine(list){
  var k=whoKey();
  return list.filter(function(o){
    if(k==="all") return true;
    if(k==="none") return !o.who;
    if(k==="me") return o.who&&o.who.gid===S.meGid;
    return o.who&&o.who.gid===k;
  });
}
function resultPill(o){
  if(o.done) return '<span class="pill ok">'+esc(o.last?o.last.result:"訪問済み")+(o.last?' '+md(o.last.date):'')+'</span>';
  if(o.backs) return '<span class="pill warn">不在・持ち帰り '+o.backs+'回</span>';
  return '<span class="pill">未訪問</span>';
}

/* ---------- Asana I/O ---------- */
/* 画面 → GAS（社内ログインを確認してからAsanaを読み書き）。Asanaのトークンは画面に置かない */
function errText(e,write){
  var c=e&&e.code;
  if(c==="link_required") return (e&&e.message)||"Asanaとの連携が必要です。";
  if(c==="network") return "通信できません。電波・ネット接続を確かめてから「更新」を押してください。";
  if(c==="auth") return "社内アカウントのログインを確認できませんでした。画面を開き直して、会社のMicrosoftアカウントでログインしてください。";
  if(c==="forbidden") return "このアカウントでは使えません（社内の社員アカウントのみ）。";
  if(c==="not_configured") return "アプリの設定がまだ終わっていません。沖田までご連絡ください。";
  if(write&&(c==="server"||c==="unknown")) return "保存できたか確認できませんでした。「更新」を押して、Asanaの内容を確かめてください。";
  if(c==="server") return "サーバーに一時的につながりません。少し待ってから「更新」を押してください。";
  if(c==="asana") return "Asanaが処理を受け付けませんでした："+(e.message||"");
  return (e&&e.message)||"通信でエラーが起きました。「更新」を押してもう一度お試しください。";
}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
function apiErr(code,msg){var e=new Error(msg||code);e.code=code;return e;}
async function api(action,data,opts){
  var url=(window.APP_CONFIG||{}).apiUrl; if(!url) throw apiErr("not_configured");
  if(!window.Auth) throw apiErr("not_configured");
  var token=await window.Auth.token();
  var body=JSON.stringify(Object.assign({action:action,token:token},data||{}));
  var tries=(opts&&opts.read)?2:1, last=null;
  for(var i=0;i<tries;i++){
    try{
      /* text/plain で送る（GASはCORSの事前確認に応えられないため） */
      var res=await fetch(url,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:body,redirect:"follow"});
      var txt=await res.text(), j=null;
      try{ j=JSON.parse(txt); }catch(x){ throw apiErr("server"); }
      if(!j.ok) throw apiErr(j.code||"unknown", j.error);
      return j;
    }catch(e){
      last = e.code ? e : apiErr("network");
      if(last.code!=="server"&&last.code!=="network") throw last;
      if(i<tries-1) await sleep(800+Math.random()*700);
    }
  }
  throw last;
}
function normName(s){return String(s||"").replace(/[\s　]/g,"");}
async function loadAll(force){
  if(S.loading) return;
  S.loading=true;S.error=null;render();
  try{
    var j=await api("list",{refresh:!!force},{read:true});
    S.user=j.user||null;
    S.owners=(j.tasks||[]).map(parseTask);
    /* 「自分」：ログインした人の名前とAsanaの担当者名（空白を除く）が同じ人 */
    var me=S.user?normName(S.user.name):"";
    var hit=S.owners.find(function(o){return o.who&&me&&normName(o.who.name)===me;});
    S.meGid=hit?hit.who.gid:(lsGet("meGid",null));
    S.loaded=true;S.freshAt=j.at||Date.now();S.needLink=false;
  }catch(e){ if(e.code==="link_required"){S.needLink=true;S.error=null;} else S.error=errText(e,false); }
  S.loading=false;render();
}

/* ---------- plan order (per device) ---------- */
function planList(date){
  var list=mine(pool()).filter(function(o){return o.due===date;});
  var order=lsGet("order:"+date,[]);
  list.sort(function(a,b){
    var ia=order.indexOf(a.gid), ib=order.indexOf(b.gid);
    if(ia<0&&ib<0) return (a.city+a.area+a.addr).localeCompare(b.city+b.area+b.addr,"ja",{numeric:true});
    if(ia<0) return 1; if(ib<0) return -1; return ia-ib;
  });
  return list;
}
function saveOrder(date,list){lsSet("order:"+date,list.map(function(o){return o.gid;}));}

/* ---------- views ---------- */
function whoChips(){
  var all=pool(), people={}, none=0;
  all.forEach(function(o){ if(o.who){var p=people[o.who.gid]=people[o.who.gid]||{name:o.who.name,n:0};p.n++;} else none++; });
  var k=whoKey(), h='<div class="chips" role="group" aria-label="担当者">';
  if(S.meGid) h+='<button type="button" class="chip" data-who="me" aria-pressed="'+(k==="me")+'">自分</button>';
  h+='<button type="button" class="chip" data-who="all" aria-pressed="'+(k==="all")+'">全員<span class="c">'+all.length+'</span></button>';
  Object.keys(people).sort(function(a,b){return people[a].name.localeCompare(people[b].name,"ja");}).forEach(function(g){
    if(g===S.meGid) return;
    h+='<button type="button" class="chip" data-who="'+esc(g)+'" aria-pressed="'+(k===g)+'">'+esc(shortName(people[g].name))+'<span class="c">'+people[g].n+'</span></button>';
  });
  if(none) h+='<button type="button" class="chip" data-who="none" aria-pressed="'+(k==="none")+'">担当未定<span class="c">'+none+'</span></button>';
  return h+'</div>';
}
function progress(){
  var list=mine(pool()), done=list.filter(function(o){return o.done;}).length, n=list.length;
  var pct=n?Math.round(done/n*100):0, planned=list.filter(function(o){return o.due;}).length;
  return '<div class="prog"><div class="row"><span>手渡し訪問の進み具合</span><b>'+done+' / '+n+'件（'+pct+'%）</b></div>'+
    '<div class="bar" aria-hidden="true"><i style="width:'+pct+'%"></i></div>'+
    '<div class="row hint"><span>日程が決まっている '+planned+'件</span><span>日程未定 '+(n-planned)+'件</span></div></div>';
}
/* 外壁修繕提案リストの判定（説明欄「外壁提案：要＝…／実施済＝…」）。要が1棟でもあれば「外壁 提案」 */
function wallPill(o){
  var w=o.wall; if(!w) return "";
  if(/(^|／)要/.test(w)) return '<span class="pill warn">外壁 提案'+(/見積提出済/.test(w)?'（見積済）':'')+'</span>';
  if(/実施済/.test(w)) return '<span class="pill">外壁 実施済</span>';
  return '<span class="pill">外壁 不要</span>';
}
function ownerCard(o,idx,mode){
  var planned=o.due===S.planDate, k=whoKey();
  var num=idx!=null?'<span class="no'+(o.done?' ok':'')+'">'+(o.done?'✓':(idx+1))+'</span>':'<span class="no plain">'+(o.done?"済":"・")+'</span>';
  var h='<article class="card">'+num+
    '<button type="button" class="nm" data-open="'+o.gid+'">'+esc(o.name)+' 様'+(o.cd?'<small>家主CD '+esc(o.cd)+'</small>':'')+'</button>'+
    '<div class="ad">'+esc(o.addr||"訪問先の住所なし")+(o.bldg?' ／ '+esc(o.bldg):'')+'</div>'+
    '<div class="row">'+resultPill(o)+(o.mourning?'<span class="pill bad">喪中</span>':'')+
      (k!=="me"&&o.who?'<span class="pill">担当 '+esc(shortName(o.who.name))+'</span>':(k==="all"&&!o.who?'<span class="pill warn">担当未定</span>':''))+
      wallPill(o)+
      (isTest(o)?'<span class="pill acc">テスト</span>':'')+
      (o.memo?'<span class="memo">※'+esc(o.memo)+'</span>':'')+'</div>'+
    '<div class="acts">';
  if(mode==="plan"){
    h+='<a class="btn route-b" href="'+esc(gmapOne(o.addr))+'" target="_blank" rel="noopener">ナビ</a>'+
       (o.done?'<button type="button" class="btn ghost" data-open="'+o.gid+'">訪問済み・詳細</button>'
              :'<button type="button" class="btn pri" data-rec="'+o.gid+'">訪問を記録</button>')+
       '<span class="move"><button type="button" aria-label="上へ" data-up="'+o.gid+'">↑</button><button type="button" aria-label="下へ" data-down="'+o.gid+'">↓</button></span>';
  } else {
    h+='<a class="btn ghost" href="'+esc(gmapOne(o.addr))+'" target="_blank" rel="noopener">ナビ</a>'+
       (o.done?'<button type="button" class="btn ghost" data-open="'+o.gid+'">詳細</button>':
       (planned?'<button type="button" class="btn ghost" data-unplan="'+o.gid+'">'+md(S.planDate)+'の予定から外す</button>'
               :'<button type="button" class="btn pri" data-plan="'+o.gid+'">'+md(S.planDate)+'の予定に追加</button>'));
  }
  return h+'</div></article>';
}
function dateList(){
  var t=todayStr(), set={}, list=mine(pool());
  set[t]=1;
  for(var d=PERIOD.from; d<=PERIOD.to; d=addDays(d,1)) set[d]=1;
  list.forEach(function(o){ if(o.due&&o.due>=HISTORY_FROM) set[o.due]=1; });
  return Object.keys(set).sort().filter(function(d){return d>=t||list.some(function(o){return o.due===d;});});
}
function viewPlan(){
  var t=todayStr(), byDue={};
  mine(pool()).forEach(function(o){if(o.due){var b=byDue[o.due]=byDue[o.due]||{n:0,done:0};b.n++;if(o.done)b.done++;}});
  var h=whoChips()+progress()+'<div class="dates" id="dateStrip" role="group" aria-label="予定日">';
  dateList().forEach(function(d){
    var b=byDue[d], c=b?b.n:0, past=d<t;
    h+='<button type="button" class="date'+(past?' past':'')+(!c&&!past?' zero':'')+'" data-date="'+d+'" aria-pressed="'+(d===S.planDate)+'"><div class="w">'+(d===t?"今日":d===addDays(t,1)?"明日":wd(d))+'</div><div class="d">'+md(d)+'</div><div class="c">'+(c?(b.done?"済"+b.done+"/"+c:c+"件"):"—")+'</div></button>';
  });
  h+='</div>';
  var list=planList(S.planDate), todo=list.filter(function(o){return !o.done;}), routable=todo.filter(function(o){return o.addr;});
  var isPast=S.planDate<t, doneN=list.length-todo.length;
  h+='<h2 class="sec">'+md(S.planDate)+'（'+wd(S.planDate)+'）の'+(isPast?'訪問実績':'訪問予定')+'<span class="n">'+list.length+'件'+(doneN?' ・ 訪問済み '+doneN+'件':'')+'</span></h2>';
  if(list.length){
    var chunks=[];for(var k=0;k<routable.length;k+=4) chunks.push(routable.slice(k,k+4));
    if(chunks.length) h+='<div class="route"><p>まだ訪問していないお宅を、現在地から順番に回るルートをGoogleマップで開きます。1本のルートは4件までです。</p><div class="btns">'+
      chunks.map(function(ch,ci){var a=ci*4+1,b=ci*4+ch.length;return '<a class="btn route-b" href="'+esc(gmapRoute(ch))+'" target="_blank" rel="noopener">ルート '+(chunks.length>1?(a+"〜"+b+"件目"):"を開く")+'</a>';}).join("")+
      '</div></div>';
    h+='<div class="list" style="margin-top:10px">'+list.map(function(o,i){return ownerCard(o,i,"plan");}).join("")+'</div>';
  } else {
    h+='<div class="empty"><b>この日の予定はまだありません</b>「エリア」タブで町ごとにオーナーを選び、「予定に追加」を押すとここに並びます。Asanaの期日にも反映されます。</div>';
  }
  var over=mine(pool()).filter(function(o){return o.due&&o.due<t&&!o.done;}).sort(function(a,b){return a.due<b.due?-1:1;});
  if(over.length){
    h+='<details class="over"><summary>期日を過ぎてまだ渡せていないお宅 '+over.length+'件</summary><div class="list">'+
      over.map(function(o){return ownerCard(o,null,"pick").replace('<div class="row">','<div class="row"><span class="pill bad">期日 '+md(o.due)+'</span>');}).join("")+'</div></details>';
  }
  return h;
}

function areaPool(){
  return mine(pool()).filter(function(o){
    if(o.done) return false;
    if(S.areaFilter==="todo") return !o.backs;
    if(S.areaFilter==="back") return o.backs>0;
    if(S.areaFilter==="nodate") return !o.due;
    return true;
  });
}
function viewArea(){
  var filters=[["todo","未訪問"],["back","不在・持ち帰り"],["nodate","日程未定"],["all","まだ渡していない全件"]];
  var h=whoChips()+'<div class="chips wrapc" role="group" aria-label="絞り込み">'+filters.map(function(f){return '<button type="button" class="chip" data-af="'+f[0]+'" aria-pressed="'+(S.areaFilter===f[0])+'">'+f[1]+'</button>';}).join("")+'</div>';
  var ap=areaPool();
  if(S.area){
    var list=ap.filter(function(o){return o.city+"|"+o.area===S.area;}).sort(function(a,b){return a.addr.localeCompare(b.addr,"ja",{numeric:true});});
    var p=S.area.split("|");
    h+='<button type="button" class="btn ghost back" data-area="">← 町の一覧へ</button>';
    h+='<h2 class="sec">'+esc(p[0])+' '+esc(p[1])+'<span class="n">'+list.length+'件 ・ '+md(S.planDate)+'の予定に追加できます</span></h2>';
    h+=list.length?'<div class="list">'+list.map(function(o){return ownerCard(o,null,"pick");}).join("")+'</div>':'<div class="empty"><b>条件に合うお宅はありません</b>上の絞り込みを「まだ渡していない全件」にすると表示されます。</div>';
    return h;
  }
  var groups={}, all=mine(pool());
  ap.forEach(function(o){var k=o.city+"|"+o.area;(groups[k]=groups[k]||{city:o.city,area:o.area,n:0,done:0,tot:0}).n++;});
  all.forEach(function(o){var g=groups[o.city+"|"+o.area];if(g){g.tot++;if(o.done)g.done++;}});
  var byCity={};Object.keys(groups).forEach(function(k){var g=groups[k];(byCity[g.city]=byCity[g.city]||[]).push(g);});
  var cities=Object.keys(byCity).sort(function(a,b){return byCity[b].reduce(function(s,g){return s+g.n;},0)-byCity[a].reduce(function(s,g){return s+g.n;},0);});
  h+='<h2 class="sec">町名から探す<span class="n">'+ap.length+'件</span></h2>';
  if(!cities.length) return h+'<div class="empty"><b>条件に合うお宅はありません</b>絞り込みや担当者を変えてみてください。</div>';
  cities.forEach(function(c){
    var gs=byCity[c].sort(function(a,b){return KANA.compare(yomi(a.area),yomi(b.area));});
    var lastRow=null;
    h+='<div class="cityh">'+esc(c)+'</div><div class="towns">'+gs.map(function(g){
      var row=kanaRow(yomi(g.area)), head="";
      if(row!==lastRow){ lastRow=row; head='<div class="rowh">'+esc(row)+'</div>'; }
      var pct=Math.round(g.done/Math.max(1,g.tot)*100);
      return head+'<button type="button" class="town" data-area="'+esc(g.city+"|"+g.area)+'"><span class="t">'+esc(g.area)+'</span><span class="s">'+g.n+'件 ・ 済 '+g.done+'/'+g.tot+'</span><span class="bar" aria-label="お渡し済みの割合 '+pct+'%"><i style="width:'+pct+'%"></i></span></button>';
    }).join("")+'</div>';
  });
  h+='<p class="hint" style="margin-top:14px">町名は五十音順です。赤い線は、その町でお渡し済みの割合です。</p>';
  return h;
}

var YOMI={
"久留里郷":"くるりごう","元村郷":"もとむらごう","左底郷":"さそこごう","西時津郷":"にしとぎつごう","日並郷":"ひなみごう","浜田郷":"はまだごう","野田郷":"のだごう","子々川郷":"ししがわごう",
"まなび野":"まなびの","岡郷":"おかごう","丸田郷":"まるたごう","嬉里郷":"うれしざとごう","吉無田郷":"よしむたごう","高田郷":"こうだごう","三根郷":"みつねごう","斉藤郷":"さいとうごう","本川内郷":"ほんかわちごう","岡郷":"おかごう","平木場郷":"ひらこばごう","長与町":"ながよちょう","時津町":"とぎつちょう",
"かき道":"かきどう","けやき台町":"けやきだいまち","ダイヤランド":"だいやらんど","愛宕":"あたご","旭町":"あさひまち","伊勢町":"いせまち","稲佐町":"いなさまち","栄町":"さかえまち","横尾":"よこお","岡町":"おかまち","桶屋町":"おけやまち","音無町":"おとなしまち","下西山町":"しもにしやままち","家野町":"いえのまち","花園町":"はなぞのまち","花丘町":"はなおかまち","界":"さかい","滑石":"なめし","樺島町":"かばしままち","丸山町":"まるやままち","岩見町":"いわみまち","岩川町":"いわかわまち","岩屋町":"いわやまち","魚の町":"うおのまち","京泊":"きょうどまり","興善町":"こうぜんまち","玉園町":"たまぞのまち","琴海戸根町":"きんかいとねまち","金屋町":"かなやまち","金堀町":"かなほりまち","恵美須町":"えびすまち","現川町":"うつつがわまち","古川町":"ふるかわまち","戸町":"とまち","五島町":"ごとうまち","御船蔵町":"おふなぐらまち","江平":"えびら","江里町":"えりまち","香焼町":"こうやぎまち","高尾町":"たかおまち","高平町":"たかひらまち","今博多町":"いまはかたまち","坂本":"さかもと","桜町":"さくらまち","桜馬場":"さくらのばば","三景台町":"さんけいだいまち","三原":"みはら","三重田町":"みえだまち","三芳町":"みよしまち","若草町":"わかくさまち","秋月町":"あきづきまち","住吉台町":"すみよしだいまち","住吉町":"すみよしまち","出島町":"でじままち","出来大工町":"できだいくまち","女の都":"めのと","勝山町":"かつやままち","小ヶ倉町":"こがくらまち","小江原":"こえばる","小江原町":"こえばるまち","小峰町":"こみねまち","昭和":"しょうわ","昭和町":"しょうわまち","松山町":"まつやままち","上戸石町":"かみといしまち","上戸町":"かみとまち","上小島":"かみこしま","上野町":"うえのまち","城栄町":"じょうえいまち","城山台":"しろやまだい","城山町":"しろやままち","新戸町":"しんとまち","新大工町":"しんだいくまち","諏訪町":"すわまち","畝刈町":"うねかりまち","清水町":"しみずまち","西海町":"さいかいまち","西坂町":"にしざかまち","西山":"にしやま","西山台":"にしやまだい","西小島":"にしこしま","西北町":"さいほくまち","西町":"にしまち","青山町":"あおやままち","石神町":"いしがみまち","赤迫":"あかさこ","千歳町":"ちとせまち","川平町":"かわびらまち","川口町":"かわぐちまち","川上町":"かわかみまち","扇町":"おうぎまち","泉":"いずみ","船大工町":"ふなだいくまち","銭座町":"ぜんざまち","大井手町":"おおいでまち","大浦町":"おおうらまち","大園町":"おおぞのまち","大橋町":"おおはしまち","大黒町":"だいこくまち","大山町":"おおやままち","大鳥町":"おおとりまち","大浜町":"おおはままち","鍛冶屋町":"かじやまち","竹の久保町":"たけのくぼまち","中園町":"なかぞのまち","中川":"なかがわ","中里町":"なかざとまち","辻町":"つじまち","天神町":"てんじんまち","田上":"たがみ","田中町":"たなかまち","東古川町":"ひがしふるかわまち","東町":"ひがしまち","東琴平":"ひがしことひら","銅座町":"どうざまち","南ヶ丘町":"みなみがおかまち","南町":"みなみまち","虹が丘町":"にじがおかまち","馬町":"うままち","梅ヶ崎町":"うめがさきまち","八つ尾町":"やつおまち","八幡町":"やはたまち","浜口町":"はまぐちまち","浜町":"はまのまち","浜平":"はまひら","富士見町":"ふじみまち","風頭町":"かざがしらまち","平間町":"ひらままち","平野町":"ひらのまち","平和町":"へいわまち","片淵":"かたふち","弁天町":"べんてんまち","宝栄町":"ほうえいまち","宝町":"たからまち","北陽町":"ほくようまち","本河内":"ほんごうち","本原町":"もとはらまち","本尾町":"もとおまち","万屋町":"よろずやまち","万才町":"まんざいまち","鳴滝":"なるたき","茂木町":"もぎまち","目覚町":"めざめまち","矢上町":"やがみまち","柳谷町":"やなぎだにまち","油屋町":"あぶらやまち","油木町":"ゆのきまち","葉山":"はやま","立岩町":"たていわまち","梁川町":"やながわまち","緑が丘町":"みどりがおかまち","緑町":"みどりまち","籠町":"かごまち","芒塚":"すすきづか","深堀町":"ふかほりまち","為石町":"ためしまち","布巻町":"ぬのまきまち","新戸町":"しんとまち","金堀町":"かなほりまち","岩瀬道町":"いわせどうまち","立神町":"たてがみまち","飽の浦町":"あくのうらまち","水の浦町":"みずのうらまち","丸尾町":"まるおまち","西泊町":"にしどまりまち","木鉢町":"きばちまち","小瀬戸町":"こせどまち","神ノ島町":"かみのしままち","女神":"めがみ","春木町":"はるきまち","平戸小屋町":"ひらどごやまち","寿町":"ことぶきまち","筑後町":"ちくごまち","上町":"うえまち","賑町":"にぎわいまち","築町":"つきまち","常盤町":"ときわまち","松が枝町":"まつがえまち","南山手町":"みなみやまてまち","東山手町":"ひがしやまてまち","十人町":"じゅうにんまち","館内町":"かんないまち","本石灰町":"もとしっくいまち","思案橋":"しあんばし","鍛冶屋町":"かじやまち","寺町":"てらまち","麹屋町":"こうじやまち","炉粕町":"ろかすまち","上西山町":"かみにしやままち","西山本町":"にしやまほんまち","西山町":"にしやままち","夫婦川町":"めおとがわまち","伊良林":"いらばやし","中川町":"なかがわまち","蛍茶屋":"ほたるぢゃや","鳴見台":"なるみだい","矢の平":"やのひら","上銭座町":"かみぜんざまち","坂本町":"さかもとまち","山里町":"やまざとまち","橋口町":"はしぐちまち","岡町":"おかまち","大手":"おおて","文教町":"ぶんきょうまち","若葉町":"わかばまち","住吉":"すみよし","赤迫町":"あかさこまち","西町":"にしまち","石神町":"いしがみまち","三川町":"みかわまち","川平":"かわびら","葉山町":"はやままち","豊洋台":"ほうようだい","女の都町":"めのとまち","西城山町":"にししろやままち","江川町":"えがわまち","鶴見台":"つるみだい","ダイヤランド":"だいやらんど","上小島町":"かみこしままち","田上町":"たがみまち","東望":"とうぼう","中里":"なかざと","古賀町":"こがまち","戸石町":"といしまち","牧島町":"まきしままち","矢上":"やがみ","東町":"ひがしまち","平山町":"ひらやままち","新牧野町":"しんまきのまち","大籠町":"おおごもりまち","宮摺町":"みやずりまち","福田本町":"ふくだほんまち","小江町":"こえまち","手熊町":"てぐままち","柿泊町":"かきどまりまち","式見町":"しきみまち","畝刈":"うねかり","三京町":"さんきょうまち","京泊町":"きょうどまりまち","岩見":"いわみ","三和町":"さんわまち","野母崎":"のもざき","外海":"そとめ","琴海":"きんかい"
};
Object.assign(YOMI,{
"小ケ倉町":"こがくらまち","北栄町":"ほくえいまち","白鳥町":"しらとりまち","磯道町":"いそみちまち","網場町":"あばまち","松原町":"まつばらまち","春日町":"かすがまち","高丘":"たかおか","出雲":"いずも","西立神町":"にしたてがみまち","光町":"ひかりまち","大浦東町":"おおうらひがしまち","茂里町":"もりまち","江戸町":"えどまち","浦郷":"うらごう","本河内":"ほんごうち",
"小船越町":"こふなこしまち","多良見町囲":"たらみちょうかこい","久山町":"くやままち","川内町":"かわちまち","八天町":"はってんまち","小野町":"おのまち","鷲崎町":"わしざきまち","多良見町木床":"たらみちょうきどこ","多良見町化屋":"たらみちょうけや","多良見町市布":"たらみちょういちぬの","多良見町舟津":"たらみちょうふなつ","仲沖町":"なかおきまち","永昌町":"えいしょうまち","破籠井町":"わりごいまち","城見町":"しろみまち","早見町":"はやみまち","泉町":"いずみまち","西郷町":"さいごうまち","福田町":"ふくだまち","栗面町":"くりものまち","貝津町":"かいづまち","栄田町":"さかえだまち","真崎町":"まさきまち","日の出町":"ひのでまち","幸町":"さいわいまち","原口町":"はらぐちまち","山川町":"やまのかわまち","久山台":"くやまだい","小長井町小川原浦":"こながいちょうおがわらうら","立石町":"たていしまち","堂崎町":"どうざきまち","飯盛町里":"いいもりちょうさと","天満町":"てんままち","東小路町":"ひがしこうじまち",
"久原":"くばら","荒平町":"あらひらまち","竹松本町":"たけまつほんまち","杭出津":"くいでつ","古賀島町":"こがしままち","上諏訪町":"かみすわまち","三城町":"さんじょうまち","宮小路":"みやしょうじ","鬼橋町":"おにばしまち","玖島":"くしま","木場":"こば","赤佐古町":"あかさこまち","諏訪":"すわ","坂口町":"さかぐちまち","大里町":"おおざとまち","富の原":"とみのはら","沖田町":"おきたまち","黒丸町":"くろまるまち","徳泉川内町":"とくせんかわちまち","大川田町":"おおかわだまち","池田":"いけだ","桜馬場":"さくらばば"
});
var KANA=(typeof Intl!=="undefined"&&Intl.Collator)?new Intl.Collator("ja"):{compare:function(a,b){return a<b?-1:a>b?1:0;}};
function yomi(t){ var y=YOMI[t]; if(y) return y; if(/^[ぁ-んァ-ンー]+/.test(t)) return t.replace(/[ァ-ン]/g,function(c){return String.fromCharCode(c.charCodeAt(0)-0x60);}); return "ん"+t; }
function kanaRow(y){
  var c=y.charAt(0), rows=[["あ","あいうえおぁぃぅぇぉ"],["か","かきくけこがぎぐげご"],["さ","さしすせそざじずぜぞ"],["た","たちつてとだぢづでどっ"],["な","なにぬねの"],["は","はひふへほばびぶべぼぱぴぷぺぽ"],["ま","まみむめも"],["や","やゆよゃゅょ"],["ら","らりるれろ"],["わ","わをん"]];
  if(y.indexOf("ん")===0&&y.length>1&&!YOMI[y]) return "その他";
  for(var i=0;i<rows.length;i++){ if(rows[i][1].indexOf(c)>=0) return rows[i][0]+"行"; }
  return "その他";
}

function searchResults(){
  var q=S.q.replace(/[\s　]/g,"");
  if(!q) return '<div class="empty" style="margin-top:12px"><b>名前・物件名・町名・家主CDを入力してください</b>例：「久山町」「セジュール」「861」など。空白の入り方が違っても見つかります。</div>';
  var list=pool().filter(function(o){return (o.name+o.cd+o.addr+o.bldg).replace(/[\s　]/g,"").indexOf(q)>=0;}).slice(0,60);
  return '<h2 class="sec">検索結果<span class="n">'+list.length+'件'+(list.length===60?'（上位60件）':'')+'</span></h2>'+
    (list.length?'<div class="list">'+list.map(function(o){return ownerCard(o,null,"pick");}).join("")+'</div>':'<div class="empty"><b>見つかりませんでした</b>一部だけ（例：名字だけ）で試してください。</div>');
}
function viewSearch(){
  return '<input class="search" id="q" type="search" placeholder="氏名・物件名・住所・家主CDで検索" value="'+esc(S.q)+'" autocomplete="off"><div id="sres">'+searchResults()+'</div>'+
    '<p class="hint" style="margin-top:14px">検索は担当者に関係なく全件から探します。'+
    (S.owners.some(isTest)?' <button type="button" class="chip" data-test aria-pressed="'+testVisible()+'">テスト用のデータを表示</button>':'')+'</p>';
}

function render(){
  var fr=document.getElementById("fresh");
  if(S.loaded) fr.textContent=pool().length+"件 ・ "+new Date(S.freshAt).toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"})+" 時点のAsana";
  var b=document.getElementById("banner");
  if(S.needLink) b.innerHTML='<div class="banner"><b>最初に1回だけ、Asanaとの連携をお願いします</b>'+
    '記録をあなたの名前でAsanaに残すための設定です。下のボタンを押すとAsanaの画面が開くので、自分のAsanaアカウントで「許可」を押してください。終わったら、このアプリを開き直してください。'+
    '<div style="margin-top:10px"><button type="button" class="btn pri" id="linkAsana">Asanaと連携する</button></div></div>';
  else if(S.error) b.innerHTML='<div class="banner bad"><b>読み込めませんでした</b>'+esc(S.error)+'</div>';
  else if(S.loaded&&testVisible()&&S.owners.every(isTest)) b.innerHTML='<div class="banner"><b>テスト用のデータを表示しています</b>本番のオーナーはまだAsanaに登録されていません。テスト用の'+S.owners.length+'件で操作を試せます。</div>';
  else b.innerHTML="";
  var v=document.getElementById("view");
  if(!S.loaded&&(S.needLink||S.error)){ v.innerHTML=""; }
  else if(!S.loaded){
    v.innerHTML='<h2 class="sec">訪問先を読み込んでいます</h2><div class="list"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>'+
      '<p class="hint" style="margin-top:12px">会社のMicrosoftアカウントで確認してから読み込みます。読み込んだデータはこの画面の中だけで使い、ほかには保存しません。</p>';
  } else {
    v.innerHTML=S.tab==="plan"?viewPlan():S.tab==="area"?viewArea():viewSearch();
  }
  document.querySelectorAll("nav.tabs [data-tab]").forEach(function(t){t.setAttribute("aria-selected",String(t.dataset.tab===S.tab));});
  document.getElementById("reload").disabled=S.loading;
  var uw=document.getElementById("who");
  if(uw) uw.textContent=S.user?S.user.name:"";
  var strip=document.getElementById("dateStrip");
  if(strip){var sel=strip.querySelector('[aria-pressed="true"]');if(sel)strip.scrollLeft=Math.max(0,sel.offsetLeft-strip.offsetLeft-16);}
  renderSheet();
}

/* ---------- sheet: detail + record ---------- */
function resOf(k){return RESULTS.find(function(r){return r.k===k;});}

/* ---------- 不在・持ち帰りのときの次回訪問日（自動） ---------- */
/* 担当者ごとの休み（曜日：0=日〜6=土）。奥村さん＝土日、細田さん・本多さん＝火水。ほかの人は土日 */
// 休みの曜日（0=日,2=火,3=水,6=土）。カスタマー課＝土日休、リーシング課＝火水休
var OFF_DAYS = {
  // カスタマー課：奥村・執行・伊東・武石
  "1204295765043224":[0,6], "1212623117477712":[0,6], "1209086435166455":[0,6], "1209551911855496":[0,6],
  // リーシング課：細田・本多・西村・安永・村田
  "1205973182458264":[2,3], "1207663483133353":[2,3], "1206491427938946":[2,3], "1220423072951619":[2,3], "1209878684554299":[2,3]
};
var SPARE_DAY = "2026-12-24";   /* 予備日 */
function isWorkday(whoGid, d){
  var p=d.split("-"), w=new Date(+p[0],+p[1]-1,+p[2]).getDay();
  return (OFF_DAYS[whoGid]||[0,6]).indexOf(w)<0;
}
/* 戻り値：{date, why} */
function suggestNext(o, from){
  var whoGid=o.who?o.who.gid:"", start=addDays(from,1);
  if(start<PERIOD.from) start=PERIOD.from;
  var mineAhead=S.owners.filter(function(x){
    return x.gid!==o.gid && !x.done && x.due && x.due>=start && x.due<=PERIOD.to &&
      (whoGid ? (x.who&&x.who.gid===whoGid) : !x.who);
  }).sort(function(a,b){return a.due<b.due?-1:a.due>b.due?1:0;});
  var town=mineAhead.find(function(x){return x.city===o.city&&x.area===o.area;});
  if(town) return {date:town.due, why:"同じ町（"+o.area+"）を回る予定の日"};
  var city=mineAhead.find(function(x){return x.city===o.city;});
  if(city) return {date:city.due, why:"同じ"+o.city+"を回る予定の日"};
  for(var d=start; d<=PERIOD.to; d=addDays(d,1)){ if(isWorkday(whoGid,d)) return {date:d, why:"次の出勤日"}; }
  return {date:SPARE_DAY, why:"予備日"};
}
function openSheet(gid,rec){
  var o=S.owners.find(function(x){return x.gid===gid;});if(!o)return;
  S.sheet={gid:gid,rec:!!rec,res:null,topics:[],talk:"",next:"",err:"",vdate:todayStr(),complete:null,mailAsk:false};
  renderSheet(true);
}
function willComplete(sh){ if(sh.complete!==null) return sh.complete; var r=resOf(sh.res); return !!(r&&r.done); }
function closeSheet(){S.sheet=null;renderSheet();}
function visitLine(sh){
  var r=resOf(sh.res);
  return "訪問記録："+sh.vdate+" "+r.label+(sh.topics.length?"｜話題："+sh.topics.join("、"):"")+(sh.talk.trim()?"｜面談内容あり":"");
}
function changes(o,sh){
  var c=[];
  if(sh.res){ c.push("訪問記録："+md(sh.vdate)+" "+resOf(sh.res).label+(sh.topics.length?"（話題："+sh.topics.join("、")+"）":"")); c.push("コメントに訪問の内容を残す"+(sh.talk.trim()?"（面談内容を含む）":"")); }
  if(willComplete(sh)&&!o.done) c.push("タスクを完了にして「訪問完了」へ移動");
  if(sh.next) c.push("次回訪問予定（期日）："+md(sh.next));
  return c;
}
function kvRows(o){
  var hist=o.visits.length?o.visits.map(function(v){return md(v.date)+" "+v.raw.replace(/^\S+\s*/,"");}).join("\n"):"まだありません";
  var r=[["家主CD",o.cd||"—"],["物件",o.bldg||"—"],["訪問先",o.addr||"—"],["エリア",o.region||"—"],["管理形態",o.mgmt||"—"],
    ["担当者",o.who?o.who.name:"未定"],["予定（期日）",o.due?md(o.due)+"（"+wd(o.due)+"）":"未定"],["訪問記録",hist],
    ["マニュアル",o.manual.length?"追記済み "+o.manual.join("、"):(o.visits.some(function(v){return /面談内容あり/.test(v.raw);})?"訪問終了後にまとめて追記":"—")],["セクション",o.section||"—"]];
  if(o.wall) r.splice(2,0,["外壁提案",o.wall.replace(/／/g,"\n")]);
  if(o.mourning) r.unshift(["喪中",o.mourning]);
  if(o.memo) r.unshift(["注意","※"+o.memo]);
  return r;
}
function renderSheet(scrollTop){
  var root=document.getElementById("sheetRoot");
  var sh=S.sheet; if(!sh){root.innerHTML="";return;}
  var o=S.owners.find(function(x){return x.gid===sh.gid;}); if(!o){root.innerHTML="";return;}
  var h='<div class="scrim" data-close></div><div class="sheet" role="dialog" aria-modal="true" aria-label="'+esc(o.name)+'"><div class="in">'+
    '<div class="grab"><h3>'+esc(o.name)+' 様</h3><button type="button" class="iconbtn" data-close>閉じる</button></div>'+
    '<dl class="kv">'+kvRows(o).map(function(r){return '<dt>'+esc(r[0])+'</dt><dd>'+esc(r[1])+'</dd>';}).join("")+'</dl>'+
    '<div class="acts"><a class="btn route-b" href="'+esc(gmapOne(o.addr))+'" target="_blank" rel="noopener">ナビ</a>'+
    (o.url?'<a class="btn ghost" href="'+esc(o.url)+'" target="_blank" rel="noopener">Asanaで開く</a>':'')+
    (o.done?'':(o.due===S.planDate?'<button type="button" class="btn ghost" data-unplan="'+o.gid+'">予定から外す</button>':'<button type="button" class="btn ghost" data-plan="'+o.gid+'">'+md(S.planDate)+'の予定に追加</button>'))+'</div>';
  if(o.done){
    h+='<div class="done-box"><b>お渡し済み（Asanaのタスクは完了しています）</b>'+
      '<span>記録を直す・もう一度訪問する場合は、完了を取り消してから記録してください。</span>'+
      (sh.err?'<div class="err" role="alert">'+esc(sh.err)+'</div>':'')+
      '<button type="button" class="btn ghost" data-reopen="'+o.gid+'" '+(S.busy?'disabled':'')+'>完了を取り消す</button></div></div></div>';
    var ps=root.querySelector(".sheet")?root.querySelector(".sheet").scrollTop:0; root.innerHTML=h; var se=root.querySelector(".sheet"); if(se&&!scrollTop) se.scrollTop=ps;
    return;
  }
  var wc=willComplete(sh), r=resOf(sh.res);
  h+='<section class="rec" aria-label="訪問を記録"><h4>訪問を記録</h4>'+
    '<div class="fld"><label for="vDate">訪問日</label><input type="date" id="vDate" value="'+esc(sh.vdate)+'" max="'+todayStr()+'"><span class="hint">前日以前の訪問をあとから記録するときは、日付を変えてください。</span></div>'+
    '<div class="fld"><span class="lb">結果</span><div class="seg" role="group">'+
      RESULTS.map(function(x){return '<button type="button" data-res="'+x.k+'" aria-pressed="'+(sh.res===x.k)+'">'+x.label+'<small>'+x.sub+'</small></button>';}).join("")+
    '</div></div>'+
    '<div class="fld"><span class="lb">話題に出たこと（いくつでも）</span><div class="opts" role="group">'+
      TOPICS.map(function(tp){return '<button type="button" data-topic="'+esc(tp)+'" aria-pressed="'+(sh.topics.indexOf(tp)>=0)+'">'+esc(tp)+'</button>';}).join("")+'</div>'+
      '<details class="qa"><summary>質問例を見る</summary><dl>'+QA.map(function(q){return '<div><dt>'+esc(q[0])+'</dt><dd>「'+esc(q[1])+'」<br>ねらい：'+esc(q[2])+'</dd></div>';}).join("")+'</dl></details></div>'+
    '<div class="fld"><label for="talk">面談内容（話したこと・聞き出した情報）</label><textarea id="talk" placeholder="例：奥様対応。来年、外壁の塗り替えを考えている。息子さんが相続予定。">'+esc(sh.talk)+'</textarea>'+
      '<span class="hint">Asanaのコメントに残ります。社内マニュアルへは、訪問がすべて終わったあとに管理推進課でまとめて追記します。</span></div>'+
    (sh.res==="back"?'<div class="fld"><label for="nextD">次回の訪問日（Asanaの期日になります）</label><input type="date" id="nextD" value="'+esc(sh.next)+'" min="'+todayStr()+'">'+
      (sh.nextWhy?'<span class="hint">自動で入れました：'+esc(sh.nextWhy)+'（'+md(sh.next)+'・'+wd(sh.next)+'）。別の日にするときは日付を変えてください。</span>':'')+'</div>':'')+
    '<label class="check" for="doneChk"><input type="checkbox" id="doneChk"'+(wc?' checked':'')+'><span><b>お渡し済みにする</b><br><span class="hint">Asanaのタスクを完了にして「訪問完了」へ移します。手渡し・置き配を選ぶと自動でチェックが付きます。</span></span></label>';
  var ch=changes(o,sh);
  h+='<div class="summary"><b>Asanaに保存される内容</b>'+(ch.length?'<ul>'+ch.map(function(x){return '<li>'+esc(x)+'</li>';}).join("")+'</ul>':'<div class="hint">まず「結果」を選んでください。</div>')+'</div>'+
    (sh.err?'<div class="err" role="alert">'+esc(sh.err)+'</div>':'')+
    '<button type="button" class="btn pri" id="saveRec" '+(S.busy||!sh.res?'disabled':'')+' style="width:100%;min-height:52px;font-size:16px">'+(S.busy?'保存しています…':'Asanaに保存')+'</button>'+
    '<div style="display:grid;gap:6px;margin-top:6px"><span class="hint">お歳暮を郵送に切り替えるお宅は、訪問の対象から外せます（「対象外・郵送へ変更」へ移動）。</span>'+
      (sh.mailAsk?'<div style="display:flex;gap:8px"><button type="button" class="btn warnb" data-mail="yes" style="flex:1" '+(S.busy?'disabled':'')+'>郵送に切り替える</button><button type="button" class="btn ghost" data-mail="no" style="flex:1">やめる</button></div>'
                 :'<button type="button" class="btn ghost" data-mail="ask">郵送に切り替える…</button>')+'</div>'+
    '</section></div></div>';
  var prevScroll=root.querySelector(".sheet")?root.querySelector(".sheet").scrollTop:0;
  root.innerHTML=h;
  var el=root.querySelector(".sheet");
  if(el){ if(scrollTop&&sh.rec){var rr=el.querySelector(".rec");el.scrollTop=rr?rr.offsetTop-10:0;} else if(!scrollTop) el.scrollTop=prevScroll; }
}

async function saveRecord(){
  var sh=S.sheet; var o=S.owners.find(function(x){return x.gid===sh.gid;}); if(!o||S.busy||!sh.res) return;
  var vdate=sh.vdate||todayStr(), wc=willComplete(sh)&&!o.done, r=resOf(sh.res);
  if(vdate>todayStr()){sh.err="訪問日に未来の日付は入れられません。";renderSheet();return;}
  var line=visitLine(sh)+(S.user?"｜担当："+S.user.name:"");
  var due=(sh.next&&sh.res==="back")?sh.next:"";
  var talk=sh.talk.trim();
  var comment="【お歳暮訪問 "+vdate.replace(/-/g,"/")+"】"+r.label+
    (sh.topics.length?"\n話題："+sh.topics.join("、"):"")+
    (talk?"\n面談内容：\n"+talk:"");
  if(!sh.rid) sh.rid=Date.now().toString(36)+Math.random().toString(36).slice(2,8); /* 二重送信を防ぐID */
  S.busy=true;sh.err="";renderSheet();
  try{
    var j=await api("record",{gid:o.gid,line:line,comment:comment,complete:wc,due:due,rid:sh.rid});
    var newNotes=j.notes||(o.notes.replace(/\s+$/,"")+"\n"+line);
    o.notes=newNotes; var pn=parseNotes(newNotes); o.visits=pn.visits; o.last=pn.visits[pn.visits.length-1]||null;
    o.backs=pn.visits.filter(function(v){return /持ち帰り/.test(v.result);}).length;
    if(due) o.due=due;
    if(wc){ o.done=true; o.section=SEC_NAME.done; o.secGid=SEC.done; }
    S.busy=false;S.sheet=null;toast(wc?"Asanaに保存し、お渡し済みにしました":"Asanaに保存しました");render();
  }catch(e){S.busy=false;sh.err=errText(e,true);renderSheet();}
}
async function reopenTask(gid){
  var o=S.owners.find(function(x){return x.gid===gid;}); if(!o||S.busy) return;
  S.busy=true;renderSheet();
  try{ await api("reopen",{gid:gid,test:isTest(o)}); o.done=false; if(!isTest(o)){o.section="訪問予定";o.secGid=SEC.plan;} S.busy=false; toast("完了を取り消しました"); render(); }
  catch(e){ S.busy=false; if(S.sheet) S.sheet.err=errText(e,true); renderSheet(); }
}
async function switchToMail(gid){
  var o=S.owners.find(function(x){return x.gid===gid;}); if(!o||S.busy) return;
  S.busy=true;renderSheet();
  try{
    await api("mail",{gid:gid,comment:"【お歳暮】"+todayStr().replace(/-/g,"/")+" 郵送に切り替え（訪問の対象から外しました）"});
    o.section=SEC_NAME.out; o.secGid=SEC.out; S.busy=false; S.sheet=null; toast("郵送に切り替えました"); render();
  }catch(e){ S.busy=false; if(S.sheet) S.sheet.err=errText(e,true); renderSheet(); }
}
async function setPlan(gid,date){
  var o=S.owners.find(function(x){return x.gid===gid;}); if(!o||S.busy) return;
  S.busy=true;
  try{
    await api("plan",{gid:gid,due:date||null});
    o.due=date||"";
    if(date){var l=planList(date).filter(function(x){return x.gid!==gid;});l.push(o);saveOrder(date,l);}
    toast(date?md(date)+"の予定に追加しました":"予定から外しました");
  }catch(e){toast(errText(e,true));}
  S.busy=false;render();
}

/* ---------- events ---------- */
document.addEventListener("click",function(ev){
  var t=ev.target.closest("button,[data-close]"); if(!t) return;
  var d=t.dataset;
  if(d.tab){S.tab=d.tab;S.sheet=null;render();window.scrollTo(0,0);return;}
  if(t.id==="reload"){loadAll(true);return;}
  if(t.id==="linkAsana"){
    t.disabled=true;
    api("linkStart",{}).then(function(j){ location.href=j.url; })
      .catch(function(e){ t.disabled=false; toast(errText(e,false)); });
    return;
  }
  if(d.who){S.who=d.who;lsSet("who",d.who);render();return;}
  if(d.test!==undefined){S.showTest=!testVisible();lsSet("showTest",S.showTest);render();return;}
  if(d.date){S.planDate=d.date;render();return;}
  if(d.close!==undefined){closeSheet();return;}
  if(d.open){openSheet(d.open,false);return;}
  if(d.rec){openSheet(d.rec,true);return;}
  if(d.plan){setPlan(d.plan,S.planDate);return;}
  if(d.unplan){setPlan(d.unplan,null);return;}
  if(d.up||d.down){var gid=d.up||d.down,l=planList(S.planDate),i=l.findIndex(function(o){return o.gid===gid;}),j=d.up?i-1:i+1;
    if(i>=0&&j>=0&&j<l.length){var tmp=l[i];l[i]=l[j];l[j]=tmp;saveOrder(S.planDate,l);render();}return;}
  if(d.af){S.areaFilter=d.af;render();return;}
  if(d.area!==undefined){S.area=d.area||null;render();window.scrollTo(0,0);return;}
  if(S.sheet){
    if(d.res){S.sheet.res=S.sheet.res===d.res?null:d.res;S.sheet.complete=null;
      if(S.sheet.res==="back"){ var so=S.owners.find(function(x){return x.gid===S.sheet.gid;}); var sg=suggestNext(so,S.sheet.vdate||todayStr()); S.sheet.next=sg.date; S.sheet.nextWhy=sg.why; }
      else { S.sheet.next=""; S.sheet.nextWhy=""; }
      renderSheet();return;}
    if(d.topic){var i2=S.sheet.topics.indexOf(d.topic);if(i2>=0)S.sheet.topics.splice(i2,1);else S.sheet.topics.push(d.topic);renderSheet();return;}
    if(t.id==="saveRec"){saveRecord();return;}
    if(d.reopen){reopenTask(d.reopen);return;}
    if(d.mail==="ask"){S.sheet.mailAsk=true;renderSheet();return;}
    if(d.mail==="no"){S.sheet.mailAsk=false;renderSheet();return;}
    if(d.mail==="yes"){switchToMail(S.sheet.gid);return;}
  }
});
document.addEventListener("input",function(ev){
  var t=ev.target;
  if(t.id==="q"){S.q=t.value;var r=document.getElementById("sres");if(r)r.innerHTML=searchResults();return;}
  if(!S.sheet) return;
  if(t.id==="talk"){S.sheet.talk=t.value;var box=document.querySelector(".summary");var o=S.owners.find(function(x){return x.gid===S.sheet.gid;});
    var ch=changes(o,S.sheet);if(box)box.innerHTML='<b>Asanaに保存される内容</b>'+(ch.length?'<ul>'+ch.map(function(x){return '<li>'+esc(x)+'</li>';}).join("")+'</ul>':'<div class="hint">まず「結果」を選んでください。</div>');}
});
document.addEventListener("change",function(ev){
  var t=ev.target; if(!S.sheet) return;
  if(t.id==="nextD"){S.sheet.next=t.value;S.sheet.nextWhy="";renderSheet();}
  if(t.id==="vDate"){S.sheet.vdate=t.value||todayStr();renderSheet();}
  if(t.id==="doneChk"){S.sheet.complete=t.checked;renderSheet();}
});
document.addEventListener("keydown",function(ev){if(ev.key==="Escape"&&S.sheet)closeSheet();});

/* ---------- boot ---------- */
render();
if(window.Auth&&window.Auth.ready){
  window.Auth.ready.then(function(){loadAll(false);}).catch(function(e){S.error=errText(apiErr("auth"),false);render();});
} else { S.error=errText(apiErr("not_configured"),false); render(); }
document.getElementById("signout").addEventListener("click",function(){ if(window.Auth) window.Auth.signOut(); });
})();
