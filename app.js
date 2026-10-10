/* ---- Config: edit limits here. min/max = allowed range, m = "near limit" margin ---- */
const P=[
 {k:'ph',  name:'pH',               unit:'',     min:6.5, max:8.5,  m:.25, dec:2, noise:.3},
 {k:'turbidity',name:'Turbidity',        unit:'NTU',  max:5,             m:1,   dec:1, noise:.8},
 {k:'dissolved_oxygen',  name:'Dissolved oxygen', unit:'mg/L', min:5,             m:1,   dec:1, noise:.6},
 {k:'tds', name:'TDS',              unit:'mg/L', max:1000,          m:100, dec:0, noise:40},
 {k:'conductivity',name:'Electrical conductivity',unit:'µS/cm',max:1500,m:150,dec:0,noise:60},
 {k:'temperature',name:'Temperature',      unit:'°C',                              dec:1, noise:1}
];
const LBL={ok:'Within limits',warn:'Near limit',bad:'Out of limits',info:'Monitored',na:'No data'};
const RANK={bad:3,warn:2,ok:1,info:0,na:0};
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=(v,p)=>Number.isFinite(v)?v.toFixed(p.dec):'–';
const fdate=d=>d.toLocaleDateString(undefined,{day:'numeric',month:'short'});
const fdt=d=>fdate(d)+', '+d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});

/* ---- State ---- */
let DATA={},END=Date.now(),S={sid:null,k:'ph',days:30},ME=null;

function status(p,v){
  if(!Number.isFinite(v))return'na';
  if(p.min==null&&p.max==null)return'info';
  if((p.min!=null&&v<p.min)||(p.max!=null&&v>p.max))return'bad';
  if((p.min!=null&&v<p.min+p.m)||(p.max!=null&&v>p.max-p.m))return'warn';
  return'ok';
}
const last=(rows,k)=>{for(let i=rows.length-1;i>=0;i--)if(Number.isFinite(rows[i][k]))return rows[i];return null};
const latest=(rows,p)=>{const r=last(rows,p.k);return r?r[p.k]:NaN};
function overall(rows){let w='na';for(const p of P){const s=status(p,latest(rows,p));if(RANK[s]>RANK[w])w=s}return w==='info'?'ok':w}
const limitText=p=>p.min!=null&&p.max!=null?`Limit ${p.min}–${p.max}`:p.max!=null?`Limit ≤ ${p.max} ${p.unit}`:p.min!=null?`Limit ≥ ${p.min} ${p.unit}`:'No limit set';

/* ---- Render ---- */
function render(){
  const names=Object.keys(DATA),rows=DATA[S.sid]||[];
  const none=!names.length;$('#content').hidden=none;$('#empty').hidden=!none;
  $('#sub').textContent=none?'No stations yet':`${names.length} station${names.length>1?'s':''}`;
  if(none){$('#stations').innerHTML='';return}
  $('#stations').innerHTML=names.map(n=>{const o=overall(DATA[n]);
    return `<button class="st ${o}" data-s="${esc(n)}" aria-current="${n===S.sid}"><span class="dot"></span><span><b>${esc(n)}</b><small>${LBL[o]}</small></span></button>`}).join('');
  const o=overall(rows),lr=rows[rows.length-1];
  $('#head').innerHTML=`<h2>${esc(S.sid)}</h2><span class="pill ${o}">${LBL[o]}</span><span class="t">${lr?'Last reading '+fdt(lr.t):'No readings yet'}</span>`+
    (canEdit()?'<button class="btn" id="delst" style="margin-left:auto">Delete station</button>':'');
  $('#tiles').innerHTML=P.map(p=>{
    const v=latest(rows,p),s=status(p,v),pts=rows.filter(r=>Number.isFinite(r[p.k])).slice(-28).map(r=>r[p.k]);
    const lo=Math.min(...pts),hi=Math.max(...pts),sp=pts.length<2?'':pts.map((x,i)=>`${(i/(pts.length-1||1))*100},${26-((x-lo)/((hi-lo)||1))*24}`).join(' ');
    return `<button class="tile ${s}" data-k="${p.k}" aria-pressed="${p.k===S.k}"><span class="n">${p.name}</span>
      <span class="v">${fmt(v,p)}<small>${p.unit}</small></span><span class="s">${LBL[s]}</span><span class="l">${limitText(p)}</span>
      <svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><polyline points="${sp}" fill="none" stroke="var(--c)" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg></button>`}).join('');
  $('#range').innerHTML=[7,14,30].map(d=>`<button data-d="${d}" aria-pressed="${d===S.days}">${d} days</button>`).join('');
  chart();alerts();readingsList();
}

function inRange(rows){const cut=END-S.days*864e5;return rows.filter(r=>r.t.getTime()>=cut)}

function chart(){
  const p=P.find(x=>x.k===S.k),rows=inRange(DATA[S.sid]).filter(r=>Number.isFinite(r[p.k]));
  $('#ct').textContent=`${p.name}${p.unit?' ('+p.unit+')':''} · ${limitText(p)}`;
  const svg=$('#chart');
  if(!rows.length){svg.innerHTML='<text x="400" y="140" text-anchor="middle" fill="var(--muted)">No readings in this period</text>';return}
  const W=800,H=280,m={l:46,r:14,t:12,b:26},vals=rows.map(r=>r[p.k]);
  let lo=Math.min(...vals,p.min??Infinity),hi=Math.max(...vals,p.max??-Infinity);
  const pad=(hi-lo)*.12||1;lo=Math.max(0,lo-pad);hi+=pad;
  const t0=rows[0].t.getTime(),t1=rows[rows.length-1].t.getTime()||t0+1;
  const X=t=>m.l+(t-t0)/((t1-t0)||1)*(W-m.l-m.r),Y=v=>H-m.b-(v-lo)/(hi-lo)*(H-m.t-m.b);
  let g='';
  for(let i=0;i<=4;i++){const v=lo+(hi-lo)*i/4,y=Y(v);g+=`<line x1="${m.l}" x2="${W-m.r}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${m.l-8}" y="${y+4}" text-anchor="end" font-size="11" fill="var(--muted)">${v.toFixed(p.dec>1?1:p.dec)}</text>`}
  for(let i=0;i<=4;i++){const t=t0+(t1-t0)*i/4;g+=`<text x="${X(t)}" y="${H-6}" text-anchor="${i===0?'start':i===4?'end':'middle'}" font-size="11" fill="var(--muted)">${fdate(new Date(t))}</text>`}
  let band='';
  if(p.min!=null||p.max!=null){
    const yt=p.max!=null?Y(p.max):m.t,yb=p.min!=null?Y(p.min):H-m.b;
    band=`<rect x="${m.l}" y="${yt}" width="${W-m.l-m.r}" height="${Math.max(0,yb-yt)}" fill="var(--band)"/>`;
    if(p.max!=null)band+=`<line x1="${m.l}" x2="${W-m.r}" y1="${yt}" y2="${yt}" stroke="var(--bad)" stroke-dasharray="5 4"/>`;
    if(p.min!=null)band+=`<line x1="${m.l}" x2="${W-m.r}" y1="${yb}" y2="${yb}" stroke="var(--bad)" stroke-dasharray="5 4"/>`;
  }
  const d=rows.map((r,i)=>(i?'L':'M')+X(r.t.getTime()).toFixed(1)+' '+Y(r[p.k]).toFixed(1)).join('');
  const bad=rows.filter(r=>status(p,r[p.k])==='bad').map(r=>`<circle cx="${X(r.t.getTime())}" cy="${Y(r[p.k])}" r="3.5" fill="var(--bad)"/>`).join('');
  svg.innerHTML=g+band+`<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>`+bad+
    `<line id="cur" y1="${m.t}" y2="${H-m.b}" stroke="var(--muted)" style="display:none"/><rect x="${m.l}" y="0" width="${W-m.l-m.r}" height="${H}" fill="transparent" id="hit"/>`;
  const tip=$('#tip'),cur=$('#cur');
  $('#hit').onpointermove=e=>{
    const b=svg.getBoundingClientRect(),x=(e.clientX-b.left)/b.width*W,t=t0+(x-m.l)/(W-m.l-m.r)*(t1-t0);
    let best=rows[0];for(const r of rows)if(Math.abs(r.t-t)<Math.abs(best.t-t))best=r;
    const px=X(best.t.getTime());cur.setAttribute('x1',px);cur.setAttribute('x2',px);cur.style.display='';
    tip.style.display='block';tip.style.left=(px/W*b.width)+'px';tip.style.top=(Y(best[p.k])/H*b.height)+'px';
    tip.textContent=`${fmt(best[p.k],p)} ${p.unit} · ${fdt(best.t)}`;
  };
  $('#hit').onpointerleave=()=>{tip.style.display='none';cur.style.display='none'};
}

function alerts(){
  const rows=inRange(DATA[S.sid]),items=[];
  for(const r of rows)for(const p of P)if(status(p,r[p.k])==='bad')items.push({r,p});
  const ul=$('#alerts');
  if(!items.length){ul.innerHTML='<li class="empty">No limit breaches in this period.</li>';return}
  ul.innerHTML=items.slice(-8).reverse().map(({r,p})=>{
    const v=r[p.k],dir=p.max!=null&&v>p.max?'above':'below',lim=dir==='above'?p.max:p.min;
    return `<li class="bad"><span class="dot"></span><span><b>${p.name}</b> ${fmt(v,p)} ${p.unit} — ${dir} the limit of ${lim}</span><span class="w">${fdt(r.t)}</span></li>`}).join('');
}

/* ---- API access (REST, see server.js). 401 means the session died (logged out
   elsewhere, or expired) — bounce back to the login screen rather than erroring. ---- */
async function api(path,method='GET',body){
  const r=await fetch('/api/'+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  if(r.status===401){showLogin();throw new Error('Your session ended — please sign in again.')}
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||'Request failed');
  return j;
}
const canEdit=()=>ME&&(ME.role==='editor'||ME.role==='admin');
const isAdmin=()=>ME&&ME.role==='admin';

let ST=[];
async function load(){
  const [st,rd]=await Promise.all([api('stations'),api('readings')]);
  ST=st;DATA={};st.forEach(x=>DATA[x.name]=[]);
  const byId=Object.fromEntries(st.map(x=>[x.id,x.name]));
  rd.forEach(r=>{const n=byId[r.station_id];if(n)DATA[n].push({...r,t:new Date(r.taken_at)})});
  END=rd.length?Math.max(...rd.map(r=>Date.parse(r.taken_at))):Date.now();
  if(!DATA[S.sid])S.sid=st.length?st[0].name:null;
  render();
}
const SH={ph:'pH',turbidity:'Turb.',dissolved_oxygen:'DO',tds:'TDS',conductivity:'EC',temperature:'Temp'};
function readingsList(){
  const rows=DATA[S.sid]||[];
  $('#rl').innerHTML=rows.length?rows.slice(-10).reverse().map(r=>`<li><span>${fdt(r.t)}</span><span class="w">${P.map(p=>SH[p.k]+' '+fmt(r[p.k],p)).join(' · ')}</span>`+
    (canEdit()?`<button class="btn" data-del="${r.id}" aria-label="Delete reading from ${fdt(r.t)}">Delete</button>`:'')+`</li>`).join(''):'<li class="empty">No readings yet for this station.</li>';
}

/* ---- Auth ---- */
function showLogin(){ME=null;$('#login').hidden=false;$('#app').hidden=true}
function showApp(){
  $('#login').hidden=true;$('#app').hidden=false;
  $('#whoami').textContent=`${ME.email} · ${ME.role}`;
  document.querySelectorAll('[data-role]').forEach(el=>{
    el.hidden = el.dataset.role==='admin' ? !isAdmin() : !canEdit();
  });
}
async function checkSession(){
  try{ME=await api('me');showApp();await load()}
  catch{showLogin()}
}
$('#fLogin').onsubmit=async e=>{
  e.preventDefault();const f=new FormData(e.target);
  try{
    const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:f.get('email'),password:f.get('password')})});
    const j=await r.json();
    if(!r.ok)throw new Error(j.error||'Could not sign in');
    ME=j;e.target.reset();$('#eLogin').textContent='';showApp();await load();
  }catch(x){$('#eLogin').textContent=x.message}
};
$('#logout').onclick=async()=>{await fetch('/api/logout',{method:'POST'});showLogin()};

/* ---- User management (admin only) ---- */
async function loadUsers(){
  const users=await api('users');
  $('#ul').innerHTML=users.map(u=>`<li><span>${esc(u.email)}</span><span class="w">${u.role}</span>`+
    (u.id!==ME.id?`<button class="btn" data-deluser="${u.id}" aria-label="Remove ${esc(u.email)}">Remove</button>`:' <span class="w">(you)</span>')+`</li>`).join('')||'<li class="empty">No users yet.</li>';
}
function openUsers(){$('#eU').textContent='';loadUsers();$('#dlgU').showModal()}
$('#fU').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);
  try{await api('users','POST',{email:f.get('email'),password:f.get('password'),role:f.get('role')});e.target.reset();await loadUsers()}
  catch(x){$('#eU').textContent=x.message}};

/* ---- Forms ---- */
const dS=$('#dlgS'),dR=$('#dlgR');
$('#rfields').innerHTML=P.map(p=>`<label>${p.name}${p.unit?' ('+p.unit+')':''}<input name="${p.k}" type="number" step="any" min="0"${p.k==='ph'?' max="14"':''}></label>`).join('');
function openStation(){$('#eS').textContent='';dS.showModal()}
function openReading(){
  if(!ST.length)return openStation();
  $('#rs').innerHTML=ST.map(x=>`<option value="${x.id}"${x.name===S.sid?' selected':''}>${esc(x.name)}</option>`).join('');
  const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());$('#rt').value=d.toISOString().slice(0,16);
  $('#eR').textContent='';dR.showModal();
}
$('#fS').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);
  try{await api('stations','POST',{name:f.get('name'),location:f.get('location')});S.sid=f.get('name').trim();e.target.reset();dS.close();await load()}
  catch(x){$('#eS').textContent=x.message}};
$('#fR').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);
  const body={station_id:+f.get('station'),taken_at:new Date(f.get('taken')).toISOString()};
  P.forEach(p=>{const v=f.get(p.k);body[p.k]=v===''?null:+v});
  try{await api('readings','POST',body);S.sid=ST.find(x=>x.id===body.station_id).name;e.target.reset();dR.close();await load()}
  catch(x){$('#eR').textContent=x.message}};

/* ---- Events ---- */
document.addEventListener('click',async e=>{
  const t=e.target,c=t.closest('[data-close]'),r=t.closest('[data-del]'),du=t.closest('[data-deluser]'),s=t.closest('[data-s]'),k=t.closest('[data-k]'),d=t.closest('[data-d]');
  try{
    if(c){c.closest('dialog').close();return}
    if(t.closest('.js-station')){openStation();return}
    if(t.closest('.js-reading')){openReading();return}
    if(t.closest('.js-users')){openUsers();return}
    if(r){if(confirm('Delete this reading?')){await api('readings/'+r.dataset.del,'DELETE');await load()}return}
    if(du){if(confirm('Remove this user? They will no longer be able to sign in.')){await api('users/'+du.dataset.deluser,'DELETE');await loadUsers()}return}
    if(t.closest('#delst')){if(confirm(`Delete "${S.sid}" and all its readings?`)){await api('stations/'+ST.find(x=>x.name===S.sid).id,'DELETE');await load()}return}
    if(s)S.sid=s.dataset.s;else if(k)S.k=k.dataset.k;else if(d)S.days=+d.dataset.d;else return;
    render();
  }catch(x){$('#msg').textContent=x.message}
});

checkSession();
