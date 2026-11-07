const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const API_BASE = location.protocol === 'file:' ? 'http://127.0.0.1:3000' : '';
if(location.protocol === 'file:'){ location.replace('http://127.0.0.1:3000'); }
const api = async (url, options={}) => {
  const res = await fetch(API_BASE + url, { headers:{'Content-Type':'application/json'}, ...options });
  if(!res.ok) throw new Error((await res.json().catch(()=>({}))).error || 'Terjadi kesalahan');
  return res.json();
};

let session = JSON.parse(localStorage.getItem('vlanesia_session') || 'null');
let hintsUsed = 0;
let currentScenario = 1;
let lastDiagnosis = null;
let cliState = {};
let guidedStep = 0;
let commandHistory = [];

const materials = [
  {id:'vlan',title:'01 · Konsep VLAN',heading:'VLAN & Broadcast Domain',body:`<p><b>VLAN (Virtual Local Area Network)</b> membagi satu switch fisik menjadi beberapa jaringan logis. Perangkat dalam VLAN yang sama dapat berkomunikasi jika pengalamatan benar, sedangkan perangkat pada VLAN berbeda membutuhkan proses routing.</p><div class="concept-visual"><span class="concept-box">Switch Fisik</span><span class="arrow">→</span><span class="concept-box v10">VLAN 10</span><span class="concept-box v20">VLAN 20</span><span class="concept-box v30">VLAN 30</span></div><ul><li>VLAN mengurangi cakupan broadcast domain.</li><li>VLAN ID membedakan jaringan logis.</li><li>Link yang menyala belum menjamin perangkat berada pada VLAN yang benar.</li></ul>`},
  {id:'access',title:'02 · Access Port',heading:'Access Port',body:`<p>Access port digunakan untuk menghubungkan end device seperti PC dan menjadi anggota <b>satu VLAN</b>.</p><div class="concept-visual"><span class="concept-box">PC1</span><span class="arrow">→</span><span class="concept-box v10">Fa0/1 · VLAN 10</span><span class="arrow">→</span><span class="concept-box">SW1</span></div><p>Perintah inti:</p><pre>interface fastEthernet 0/1\nswitchport mode access\nswitchport access vlan 10</pre>`},
  {id:'trunk',title:'03 · Trunk 802.1Q',heading:'Trunk Port',body:`<p>Trunk membawa lalu lintas dari beberapa VLAN antarperangkat jaringan. Pada VLANesia, trunk diperkenalkan pada Level 2 sebagai pengayaan.</p><div class="concept-visual"><span class="concept-box">SW1</span><span class="arrow">⇄ VLAN 10,20,30</span><span class="concept-box">SW2</span></div><p>Kesalahan <i>allowed VLAN</i> dapat membuat satu VLAN tidak lewat meskipun link trunk aktif.</p>`},
  {id:'routing',title:'04 · Inter-VLAN',heading:'Inter-VLAN Routing',body:`<p>Dua VLAN berbeda tidak otomatis dapat saling ping. Diperlukan perangkat Layer 3, misalnya router-on-a-stick.</p><div class="concept-visual"><span class="concept-box v10">VLAN 10</span><span class="arrow">→</span><span class="concept-box">Router / L3</span><span class="arrow">→</span><span class="concept-box v20">VLAN 20</span></div><p>Setiap VLAN memerlukan gateway yang sesuai. VLANesia mengenalkan konsep ini pada Level 3.</p>`},
  {id:'debug',title:'05 · Troubleshooting',heading:'Urutan Diagnosis',body:`<p>Ketika ping gagal, jangan langsung mengganti banyak konfigurasi. Periksa secara bertahap:</p><ol><li>Link dan kabel.</li><li>VLAN pada port.</li><li>IP dan subnet.</li><li>Sintaks CLI.</li><li>Trunk dan allowed VLAN.</li><li>Gateway / routing jika antar-VLAN.</li></ol><p>Tujuan VLANesia adalah menghubungkan <b>gejala → penyebab → tindakan perbaikan</b>.</p>`}
];

const questions = [
  {q:'Apa fungsi utama VLAN pada jaringan switch?', opts:['Mengganti IP address otomatis','Membagi jaringan fisik menjadi beberapa jaringan logis','Mengubah switch menjadi router','Meningkatkan kecepatan CPU'], a:1},
  {q:'Perintah yang menempatkan Fa0/2 ke VLAN 20 adalah...', opts:['switchport trunk vlan 20','switchport access vlan 20','ip vlan 20','interface vlan 20 access'], a:1},
  {q:'PC1 dan PC4 berada pada VLAN 10 dan satu subnet. Apa hasil ping yang diharapkan?', opts:['Berhasil jika link dan access port benar','Selalu gagal tanpa router','Hanya berhasil jika trunk aktif','Harus memakai gateway berbeda'], a:0},
  {q:'Mengapa PC pada VLAN 10 tidak langsung dapat ping PC pada VLAN 20?', opts:['Karena kabel straight-through tidak mendukung','Karena berada pada broadcast domain berbeda dan belum ada routing','Karena VLAN 20 tidak boleh memiliki IP','Karena access port selalu diblokir'], a:1},
  {q:'Jika trunk tidak mengizinkan VLAN 20, apa gejala yang paling tepat?', opts:['Semua VLAN pasti gagal','VLAN 20 tidak dapat melintasi trunk sementara VLAN lain bisa','Switch mati total','IP address otomatis berubah'], a:1}
];

function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200); }
function logAction(action,detail=''){ if(session) api('/api/log',{method:'POST',body:JSON.stringify({sessionId:session.id,action,detail})}).catch(()=>{}); }

function showView(name){
  $$('.view').forEach(v=>v.classList.remove('active'));
  $(`#view-${name}`).classList.add('active');
  $$('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  $('#viewTitle').textContent = ({home:'Beranda',material:'Materi',guide:'Petunjuk',simulation:'Simulasi',diagnostic:'Diagnostik',evaluation:'Evaluasi',dashboard:'Dashboard Guru'})[name];
  $('#sidebar').classList.remove('open');
  if(name==='dashboard') loadDashboard();
  logAction('OPEN_VIEW',name);
  window.scrollTo({top:0,behavior:'smooth'});
}

$$('[data-view]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
$$('[data-goto]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.goto)));
$('#menuBtn').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));

async function initSession(){
  const errBox=$('#loginError');
  if(session){
    try{
      const chk=await api('/api/session/validate',{method:'POST',body:JSON.stringify({id:session.id})});
      if(!chk.valid){ localStorage.removeItem('vlanesia_session'); session=null; }
      else session=chk.session;
    }catch(e){ /* server status ditangani oleh health check */ }
  }
  if(session){
    $('#sessionModal').classList.add('hidden');
    $('#profileAlias').textContent=session.alias;
    $('#profileInitial').textContent=(session.alias?.[0]||'S').toUpperCase();
  }else{
    $('#sessionModal').classList.remove('hidden');
    if(errBox) errBox.classList.add('hidden');
  }
}
$('#sessionForm').addEventListener('submit', async e=>{
  e.preventDefault(); const btn=e.currentTarget.querySelector('button[type=submit]'); const oldText=btn.textContent; const errBox=$('#loginError');
  btn.disabled=true; btn.textContent='Menghubungkan database...'; if(errBox) errBox.classList.add('hidden');
  try{
    await api('/api/health');
    session=await api('/api/session',{method:'POST',body:JSON.stringify({alias:$('#aliasInput').value,className:$('#classInput').value})});
    localStorage.setItem('vlanesia_session',JSON.stringify(session));
    $('#sessionModal').classList.add('hidden'); await initSession(); toast('Login berhasil. Sesi belajar tersimpan!');
  }catch(err){
    if(errBox){errBox.textContent='Login gagal: '+err.message+'. Pastikan membuka VLANesia lewat start.bat / http://127.0.0.1:3000, bukan dengan membuka index.html langsung.';errBox.classList.remove('hidden');}
    toast('Login gagal — server/database belum terhubung.');
  } finally {btn.disabled=false;btn.textContent=oldText;}
});
$('#profileBtn').addEventListener('click',()=>{ if(confirm('Buat sesi baru dengan alias lain?')){localStorage.removeItem('vlanesia_session');location.reload();} });

function renderMaterials(){
  $('#materialTabs').innerHTML=materials.map((m,i)=>`<button class="${i===0?'active':''}" data-mid="${m.id}">${m.title}</button>`).join('');
  const render=(m)=>$('#materialContent').innerHTML=`<span class="eyebrow">MATERI VLANESIA</span><h2>${m.heading}</h2>${m.body}<button class="btn primary" data-next-mat>Materi Berikutnya →</button>`;
  render(materials[0]);
  $('#materialTabs').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return; $$('#materialTabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');const m=materials.find(x=>x.id===b.dataset.mid);render(m);logAction('READ_MATERIAL',m.id)});
  $('#materialContent').addEventListener('click',e=>{if(!e.target.matches('[data-next-mat]'))return; const active=$('#materialTabs button.active'); const idx=materials.findIndex(x=>x.id===active.dataset.mid); if(idx<materials.length-1) $('#materialTabs button').children?.[idx+1]; const next=$$('#materialTabs button')[Math.min(idx+1,materials.length-1)]; next.click();});
}

const scenarios = {
  1:{level:1,desc:'SW1 + 4 PC · Konfigurasi dasar',mission:'Buat VLAN 10 Manajemen, VLAN 20 Keuangan, VLAN 30 IT Support. Atur Fa0/1 dan Fa0/4 sebagai access VLAN 10, lalu uji ping PC1 → PC4.',target:'same',error:null,guideTitle:'Bangun VLAN dari awal',guideMeta:'Jalankan perintah secara berurutan. Kamu boleh klik perintah untuk mengisikannya ke terminal.',commands:['enable','configure terminal','vlan 10','name Manajemen','exit','vlan 20','name Keuangan','exit','vlan 30','name IT-Support','exit','interface fastEthernet 0/1','switchport mode access','switchport access vlan 10','exit','interface fastEthernet 0/4','switchport mode access','switchport access vlan 10','exit','end','show vlan brief','write memory']},
  2:{level:1,desc:'Debugging port access',mission:'Fa0/4 masih berada di VLAN 1. Temukan dan perbaiki penyebab PC1 tidak dapat ping PC4 meskipun link menyala.',target:'same',error:'Port salah VLAN',guideTitle:'Perbaiki Fa0/4 yang salah VLAN',guideMeta:'Fokus pada interface Fa0/4. VLAN 10 sudah tersedia.',commands:['enable','configure terminal','interface fastEthernet 0/4','switchport mode access','switchport access vlan 10','exit','end','show vlan brief','write memory']},
  3:{level:1,desc:'Debugging IP/subnet',mission:'PC4 berada pada port VLAN 10 tetapi menggunakan IP 192.168.20.12. Diagnosis dan perbaiki agar PC1 dapat ping PC4.',target:'same',error:'IP tidak satu segmen',guideTitle:'Perbaiki IP PC4',guideMeta:'Port VLAN sudah benar. Gunakan perintah simulasi VLANesia berikut untuk memperbaiki IP PC4.',commands:['fix ip pc4 192.168.10.12']},
  4:{level:2,desc:'Trunk antar-switch',mission:'VLAN 20 tidak diizinkan pada trunk. Identifikasi mengapa host VLAN 20 di switch berbeda tidak terjangkau.',target:'trunk',error:'Allowed VLAN trunk',guideTitle:'Izinkan VLAN 20 melewati trunk',guideMeta:'Perintah berikut adalah abstraksi pembelajaran VLANesia untuk latihan konsep allowed VLAN.',commands:['allow vlan 20 trunk']},
  5:{level:3,desc:'Inter-VLAN routing',mission:'Ping satu VLAN berhasil tetapi ping VLAN 10 → VLAN 20 gagal. Periksa subinterface dan gateway.',target:'inter',error:'Gateway / routing',guideTitle:'Lengkapi jalur Layer 3 VLAN 20',guideMeta:'Lengkapi subinterface virtual dan gateway PC2 agar komunikasi antar-VLAN dapat dimodelkan.',commands:['create subinterface vlan 20','fix gateway pc2 192.168.20.1']}
};

function defaultState(sc=1){
  const s={mode:'user',selectedInterface:null,vlans:{1:{name:'default',ports:['Fa0/1','Fa0/2','Fa0/3','Fa0/4']}},ports:{'Fa0/1':1,'Fa0/2':1,'Fa0/3':1,'Fa0/4':1},saved:false,ips:{PC1:'192.168.10.11',PC2:'192.168.20.11',PC3:'192.168.30.11',PC4:'192.168.10.12'},trunkAllowed:[10,30],subinterfaces:[10,30],gateways:{PC1:'192.168.10.1',PC2:'192.168.20.1',PC3:'192.168.30.1',PC4:'192.168.10.1'}};
  if(sc===2){s.vlans[10]={name:'Manajemen',ports:['Fa0/1']};s.ports['Fa0/1']=10;s.vlans[1].ports=['Fa0/2','Fa0/3','Fa0/4'];}
  if(sc===3){s.vlans[10]={name:'Manajemen',ports:['Fa0/1','Fa0/4']};s.ports['Fa0/1']=10;s.ports['Fa0/4']=10;s.vlans[1].ports=['Fa0/2','Fa0/3'];s.ips.PC4='192.168.20.12';}
  if(sc===4){s.vlans[10]={name:'Manajemen',ports:['Fa0/1']};s.vlans[20]={name:'Keuangan',ports:['Fa0/2']};s.vlans[30]={name:'IT-Support',ports:['Fa0/3']};}
  if(sc===5){s.vlans[10]={name:'Manajemen',ports:['Fa0/1','Fa0/4']};s.vlans[20]={name:'Keuangan',ports:['Fa0/2']};s.vlans[30]={name:'IT-Support',ports:['Fa0/3']};s.subinterfaces=[10,30];s.gateways.PC2='192.168.20.254';}
  return s;
}

function normalizeCmd(v){return String(v||'').trim().toLowerCase().replace(/\s+/g,' ')}
function updateNextCommandSuggestion(){
  const s=scenarios[currentScenario];
  const total=s.commands.length;
  const idx=Math.min(guidedStep,total);
  const done=idx>=total;
  const next=done?'Semua langkah inti selesai — lanjut Uji Ping':s.commands[idx];
  const nextText=$('#nextCommandText'); const input=$('#cliInput'); const prog=$('#cliProgressText'); const insert=$('#nextCommandInsert');
  if(nextText) nextText.textContent=next;
  if(input) input.placeholder=done?'Konfigurasi inti selesai. Kamu tetap bisa mengetik perintah lain.':`Saran berikutnya: ${next}`;
  if(prog) prog.textContent=done?`Selesai ${total}/${total} langkah`:`Langkah ${idx+1} dari ${total}`;
  if(insert){insert.disabled=done;insert.textContent=done?'✓ Selesai':'Isi perintah →';}
  $$('#commandGuideList .command-guide-item').forEach((el,i)=>{el.classList.toggle('done',i<idx);el.classList.toggle('current',i===idx&&!done);const b=el.querySelector('b');if(b)b.textContent=i<idx?'Selesai':(i===idx&&!done?'NEXT':'Isi →');});
}
function renderCommandGuide(){
  const s=scenarios[currentScenario];
  $('#commandGuideTitle').textContent=s.guideTitle;
  $('#commandGuideMeta').textContent=s.guideMeta+' Jalankan satu perintah per baris agar prompt CLI berubah sesuai mode.';
  $('#commandGuideList').innerHTML=s.commands.map((cmd,i)=>`<button type="button" class="command-guide-item" data-command="${cmd.replace(/"/g,'&quot;')}"><span>${String(i+1).padStart(2,'0')}</span><code>${cmd}</code><b>Isi →</b></button>`).join('');
  updateNextCommandSuggestion();
}

function renderTopology(){
  const s=scenarios[currentScenario];
  $('#levelLabel').textContent=s.level; $('#scenarioDesc').textContent=s.desc; $('#missionText').textContent=s.mission;
  $('#topology').innerHTML=`<div class="packet-layer" id="packetLayer"></div><div class="device switch"><b>SW1</b><small>${s.level>1?'Trunk / routing lab':'Catalyst 2960'}</small></div>${['PC1','PC2','PC3','PC4'].map((pc,i)=>`<div class="device pc pc${i+1}" data-pc="${pc}"><b>${pc}</b><small>${cliState.ips[pc]}<br>${portForPC(pc)} · VLAN ${cliState.ports[portForPC(pc)]}</small></div>`).join('')}<div class="linkline" style="left:50%;top:94px;width:230px;transform:rotate(145deg)"></div><div class="linkline" style="left:50%;top:94px;width:150px;transform:rotate(124deg)"></div><div class="linkline" style="left:50%;top:94px;width:150px;transform:rotate(56deg)"></div><div class="linkline" style="left:50%;top:94px;width:230px;transform:rotate(35deg)"></div><div class="packet-status hidden" id="packetStatus"></div>`;
  renderVlanTable(); renderChecklist(); renderCommandGuide();
}
function portForPC(pc){return ({PC1:'Fa0/1',PC2:'Fa0/2',PC3:'Fa0/3',PC4:'Fa0/4'})[pc]}
function renderVlanTable(){
  const ids=Object.keys(cliState.vlans).map(Number).sort((a,b)=>a-b);
  $('#vlanTable').innerHTML=ids.map(id=>{const ports=Object.entries(cliState.ports).filter(([,v])=>v===id).map(([p])=>p); const v=cliState.vlans[id]; return `<tr><td><b>${id}</b></td><td>${v.name||'-'}</td><td>${ports.join(', ')||'-'}</td><td><span class="badge ${id===1?'neutral':'good'}">${id===1?'default':'active'}</span></td></tr>`}).join('');
}
function renderChecklist(){
  const checks=[['VLAN 10 dibuat',!!cliState.vlans[10]],['VLAN 20 dibuat',!!cliState.vlans[20]],['VLAN 30 dibuat',!!cliState.vlans[30]],['Fa0/1 → VLAN 10',cliState.ports['Fa0/1']===10],['Fa0/4 → VLAN 10',cliState.ports['Fa0/4']===10],['Konfigurasi disimpan',cliState.saved]];
  $('#missionChecklist').innerHTML=checks.map(([t,d])=>`<div class="check-item ${d?'done':''}"><i>${d?'✓':'·'}</i><span>${t}</span></div>`).join('');
}
function resetScenario(){
  hintsUsed=0; guidedStep=0; commandHistory=[]; cliState=defaultState(currentScenario); $('#terminalOutput').innerHTML='<div class="term-line muted">VLANesia CLI Simulator v1.0</div><div class="term-line">Switch&gt; <span class="muted">ketik <b>enable</b> untuk memulai</span></div>'; updatePrompt(); renderTopology(); lastDiagnosis=null; toast('Skenario direset');
}
$('#scenarioSelect').addEventListener('change',e=>{currentScenario=Number(e.target.value);resetScenario();logAction('SELECT_SCENARIO',currentScenario)});
$('#resetBtn').addEventListener('click',resetScenario);
$('#commandGuideList').addEventListener('click',e=>{
  const b=e.target.closest('[data-command]'); if(!b)return;
  $('#cliInput').value=b.dataset.command; $('#cliInput').focus();
  toast('Perintah dimasukkan. Tekan Kirim untuk menjalankan.');
});
$('#nextCommandInsert').addEventListener('click',()=>{
  const s=scenarios[currentScenario];
  if(guidedStep>=s.commands.length)return;
  $('#cliInput').value=s.commands[guidedStep]; $('#cliInput').focus();
  toast('Perintah berikutnya siap. Tekan Kirim atau Enter.');
});

function appendTerm(text,type=''){const d=document.createElement('div');d.className='term-line '+type;d.textContent=text;$('#terminalOutput').appendChild(d);$('#terminalOutput').scrollTop=$('#terminalOutput').scrollHeight}
function updatePrompt(){const m=cliState.mode; $('#prompt').textContent=m==='user'?'Switch>':m==='priv'?'Switch#':m==='config'?'Switch(config)#':m==='vlan'?'Switch(config-vlan)#':'Switch(config-if)#'}
function ensureVlan(id){if(!cliState.vlans[id])cliState.vlans[id]={name:`VLAN${id}`,ports:[]}}
function setPortVlan(port,id){ensureVlan(id); Object.values(cliState.vlans).forEach(v=>v.ports=(v.ports||[]).filter(p=>p!==port)); cliState.ports[port]=id; cliState.vlans[id].ports.push(port)}

function processCommand(raw){
  const cmd=raw.trim(); if(!cmd)return;
  appendTerm(`${$('#prompt').textContent} ${cmd}`);
  const low=normalizeCmd(cmd);
  if(/^vlan\s+\d+\s+name\s+.+/.test(low)){
    const m=cmd.match(/^vlan\s+(\d+)\s+name\s+(.+)$/i);
    appendTerm(`% Jalankan satu perintah per baris. Coba: vlan ${m[1]}  → Enter, lalu name ${m[2]}  → Enter.`,'info');
    $('#cliInput').placeholder=`Saran: vlan ${m[1]}`;
    toast('CLI Cisco memakai mode bertahap: VLAN dulu, lalu NAME.');
    return;
  }
  if(low==='enable'&&cliState.mode==='user'){cliState.mode='priv';appendTerm('Mode privileged EXEC aktif.','success')}
  else if((low==='configure terminal'||low==='conf t')&&cliState.mode==='priv'){cliState.mode='config';appendTerm('Enter configuration commands, one per line.','info')}
  else if(low==='exit'){if(cliState.mode==='vlan'||cliState.mode==='interface')cliState.mode='config';else if(cliState.mode==='config')cliState.mode='priv';else if(cliState.mode==='priv')cliState.mode='user'}
  else if(low==='end'){cliState.mode='priv'}
  else if(/^vlan\s+\d+$/.test(low)&&cliState.mode==='config'){const id=Number(low.split(/\s+/)[1]); if(id<2||id>4094){appendTerm('% VLAN ID harus 2–4094.','error')}else{ensureVlan(id);cliState.activeVlan=id;cliState.mode='vlan';appendTerm(`VLAN ${id} siap dikonfigurasi.`,'success')}}
  else if(low.startsWith('name ')&&cliState.mode==='vlan'){const name=cmd.slice(5).trim().replace(/\s+/g,'-');cliState.vlans[cliState.activeVlan].name=name;appendTerm(`Nama VLAN ${cliState.activeVlan} = ${name}`,'success')}
  else if(/^interface\s+(fastethernet\s*)?0\/[1-4]$/i.test(cmd)&&cliState.mode==='config'){const n=cmd.match(/0\/([1-4])/)[1];cliState.selectedInterface=`Fa0/${n}`;cliState.mode='interface';appendTerm(`Interface ${cliState.selectedInterface} dipilih.`,'info')}
  else if(low==='switchport mode access'&&cliState.mode==='interface'){appendTerm('Mode access diterapkan.','success')}
  else if(/^switchport access vlan\s+\d+$/.test(low)&&cliState.mode==='interface'){const id=Number(low.split(/\s+/).pop()); if(!cliState.vlans[id])appendTerm(`% VLAN ${id} belum dibuat.`,'error');else{setPortVlan(cliState.selectedInterface,id);appendTerm(`${cliState.selectedInterface} → VLAN ${id}`,'success')}}
  else if(low==='show vlan brief'&&(cliState.mode==='priv'||cliState.mode==='config')){Object.keys(cliState.vlans).sort((a,b)=>a-b).forEach(id=>appendTerm(`${id.padEnd(5)} ${(cliState.vlans[id].name||'-').padEnd(16)} ${Object.entries(cliState.ports).filter(([,v])=>v===Number(id)).map(([p])=>p).join(', ')}`,'info'))}
  else if(low==='write memory'||low==='do write memory'){cliState.saved=true;appendTerm('Building configuration... [OK]','success')}
  else if(low==='fix ip pc4 192.168.10.12'){cliState.ips.PC4='192.168.10.12';appendTerm('IP PC4 diperbarui ke 192.168.10.12/24','success')}
  else if(low==='allow vlan 20 trunk'){if(!cliState.trunkAllowed.includes(20))cliState.trunkAllowed.push(20);appendTerm('VLAN 20 diizinkan pada trunk virtual.','success')}
  else if(low==='create subinterface vlan 20'){if(!cliState.subinterfaces.includes(20))cliState.subinterfaces.push(20);appendTerm('Subinterface VLAN 20 dibuat.','success')}
  else if(low==='fix gateway pc2 192.168.20.1'){cliState.gateways.PC2='192.168.20.1';appendTerm('Gateway PC2 diperbaiki.','success')}
  else appendTerm('% Perintah belum dikenali. Lihat kartu NEXT di bawah terminal untuk perintah yang disarankan.','error');
  commandHistory.push(low);
  const expected=scenarios[currentScenario].commands[guidedStep];
  if(expected && normalizeCmd(expected)===low){ guidedStep++; }
  updatePrompt();renderTopology();updateNextCommandSuggestion();logAction('CLI_COMMAND',cmd);
}
$('#cliForm').addEventListener('submit',e=>{e.preventDefault();const v=$('#cliInput').value;$('#cliInput').value='';processCommand(v)});

$('#hintBtn').addEventListener('click',()=>{
  hintsUsed++;
  const map={1:['Mulai dengan enable lalu configure terminal.','Buat vlan 10, vlan 20, dan vlan 30.','Atur Fa0/1 dan Fa0/4 sebagai access vlan 10.'],2:['Periksa VLAN pada Fa0/4.','Gunakan interface fastEthernet 0/4.','Masukkan switchport access vlan 10.'],3:['Port sudah benar. Periksa IP PC4.','Bandingkan subnet PC1 dan PC4.','Ketik: fix ip pc4 192.168.10.12'],4:['Periksa daftar VLAN yang lewat trunk.','VLAN 20 belum diizinkan.','Ketik: allow vlan 20 trunk'],5:['Ping satu VLAN berhasil: fokus pada Layer 3.','Periksa subinterface VLAN 20 dan gateway PC2.','Ketik create subinterface vlan 20 lalu fix gateway pc2 192.168.20.1']};
  const hints=map[currentScenario];toast(hints[Math.min(hintsUsed-1,hints.length-1)]);logAction('USE_HINT',`scenario ${currentScenario} hint ${hintsUsed}`)
});

function subnet(ip){return ip.split('.').slice(0,3).join('.')}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function centerInTopology(el){
  const top=$('#topology').getBoundingClientRect(), r=el.getBoundingClientRect();
  return {x:r.left-top.left+r.width/2,y:r.top-top.top+r.height/2};
}
function packetEndpoints(){
  if(currentScenario<=3)return {source:$('.pc1'),target:$('.pc4')};
  if(currentScenario===4)return {source:$('.pc2'),target:$('.pc4')};
  return {source:$('.pc1'),target:$('.pc2')};
}
async function moveEnvelope(el,pt,duration=650){
  el.style.transition=`left ${duration}ms cubic-bezier(.2,.75,.25,1), top ${duration}ms cubic-bezier(.2,.75,.25,1), transform ${duration}ms ease`;
  el.style.left=`${pt.x}px`;el.style.top=`${pt.y}px`;el.style.transform='translate(-50%,-50%) scale(1.08)';
  await wait(duration+70);
}
function showPacketStatus(text,type){
  const box=$('#packetStatus');if(!box)return;box.textContent=text;box.className=`packet-status ${type}`;
}
async function animatePingEnvelope(success,error){
  const layer=$('#packetLayer'), sw=$('.device.switch');if(!layer||!sw)return;
  const {source,target}=packetEndpoints();if(!source||!target)return;
  layer.innerHTML='';showPacketStatus('Mengirim ICMP Echo…','sending');
  const a=centerInTopology(source), b=centerInTopology(sw), c=centerInTopology(target);
  const env=document.createElement('div');env.className='data-envelope request';env.innerHTML='<span>✉</span><small>ICMP</small>';layer.appendChild(env);env.style.left=`${a.x}px`;env.style.top=`${a.y}px`;
  await wait(120);await moveEnvelope(env,b,580);
  if(!success){
    env.classList.add('blocked');showPacketStatus(error?`TIMEOUT · ${error}`:'TIMEOUT','bad');
    const mark=document.createElement('div');mark.className='packet-block';mark.textContent='×';mark.style.left=`${b.x}px`;mark.style.top=`${b.y+34}px`;layer.appendChild(mark);
    await wait(850);env.classList.add('fade');await wait(320);return;
  }
  await moveEnvelope(env,c,650);env.classList.add('delivered');showPacketStatus('Echo Request diterima · mengirim Reply','good');
  await wait(280);
  const reply=document.createElement('div');reply.className='data-envelope reply';reply.innerHTML='<span>✉</span><small>REPLY</small>';layer.appendChild(reply);reply.style.left=`${c.x}px`;reply.style.top=`${c.y}px`;
  await moveEnvelope(reply,b,540);await moveEnvelope(reply,a,620);reply.classList.add('delivered');showPacketStatus('✓ Reply diterima · Ping berhasil','good');
  await wait(650);env.classList.add('fade');reply.classList.add('fade');
}

function diagnose(){
  const s=currentScenario; let success=false,error=null,title='',explanation='',steps=[];
  const sameVlan=cliState.ports['Fa0/1']===10&&cliState.ports['Fa0/4']===10;
  const sameSubnet=subnet(cliState.ips.PC1)===subnet(cliState.ips.PC4);
  if(s<=3){success=!!cliState.vlans[10]&&sameVlan&&sameSubnet; if(!cliState.vlans[10])error='VLAN belum dibuat';else if(!sameVlan)error='Port salah VLAN';else if(!sameSubnet)error='IP tidak satu segmen';}
  if(s===4){success=cliState.trunkAllowed.includes(20);if(!success)error='Allowed VLAN trunk'}
  if(s===5){success=cliState.subinterfaces.includes(20)&&cliState.gateways.PC2==='192.168.20.1';if(!success)error='Gateway / routing'}
  if(success){title='Konfigurasi memenuhi aturan skenario';explanation=s===5?'Prasyarat routing antar-VLAN terpenuhi pada model: subinterface VLAN 20 tersedia dan gateway PC2 benar.':'Perangkat yang diuji memenuhi aturan VLAN, port, IP/subnet, dan link pada skenario.';steps=[['Link','OK'],['VLAN / port','OK'],['IP / subnet','OK'],[s>3?'Trunk / routing':'Simpan konfigurasi',s>3?'OK':(cliState.saved?'OK':'Perlu perhatian')]]}
  else{title=`Ditemukan: ${error}`;explanation=({ 'VLAN belum dibuat':'VLAN 10 harus dibuat sebelum port dapat menjadi anggota VLAN tersebut.','Port salah VLAN':'Link fisik dapat aktif, tetapi Fa0/4 yang berada pada VLAN berbeda membuat PC1 dan PC4 terpisah secara logis.','IP tidak satu segmen':'Walau port berada pada VLAN yang sama, alamat IP harus berada pada subnet yang sama untuk komunikasi langsung.','Allowed VLAN trunk':'Trunk aktif tidak berarti semua VLAN selalu lewat. VLAN 20 harus diizinkan pada daftar allowed VLAN.','Gateway / routing':'Komunikasi antar-VLAN memerlukan fungsi Layer 3. Periksa subinterface dan default gateway tiap VLAN.'})[error];steps=[['Link','OK'],['VLAN / port',error==='Port salah VLAN'||error==='VLAN belum dibuat'?'Periksa':'OK'],['IP / subnet',error==='IP tidak satu segmen'?'Periksa':'OK'],['Trunk / routing',(error==='Allowed VLAN trunk'||error==='Gateway / routing')?'Periksa':'-']]}
  return {success,error,title,explanation,steps};
}

$('#pingBtn').addEventListener('click',async()=>{
  const btn=$('#pingBtn'); const oldText=btn.textContent; btn.disabled=true; btn.textContent='Menguji...';
  lastDiagnosis=diagnose();
  const d=lastDiagnosis;
  const score=Math.max(20,100-(hintsUsed*15)-(d.success?0:30));
  const pingText=d.success?`Pinging target...\nReply from target: bytes=32 time<1ms TTL=128\nReply from target: bytes=32 time<1ms TTL=128\n\nPackets: Sent = 2, Received = 2, Lost = 0 (0% loss)`:`Pinging target...\nRequest timed out.\nRequest timed out.\n\nPackets: Sent = 2, Received = 0, Lost = 2 (100% loss)`;
  localStorage.setItem('vlanesia_diag',JSON.stringify({...d,pingText}));
  btn.classList.add('pinging');
  await animatePingEnvelope(d.success,d.error);
  btn.classList.remove('pinging');
  await api('/api/attempt',{method:'POST',body:JSON.stringify({sessionId:session.id,scenario:currentScenario,level:scenarios[currentScenario].level,success:d.success,score,hintsUsed,errorType:d.error,diagnosis:d.explanation})}).catch(()=>{});
  renderDiagnostic();showView('diagnostic');toast(d.success?'Ping berhasil — amplop Reply kembali ke pengirim!':'Ping timeout — amplop berhenti di titik gangguan.');
  btn.disabled=false; btn.textContent=oldText;
});

function formatPingOutput(text, success){
  return text.split('\n').filter(Boolean).map(line=>{
    let cls='';
    if(/Reply from/i.test(line)) cls='ok';
    else if(/Request timed out/i.test(line)) cls='fail';
    else if(/Packets:/i.test(line)) cls=success?'stats-ok':'stats-fail';
    else if(/Pinging target/i.test(line)) cls='head';
    return `<div class="ping-line ${cls}">${line}</div>`;
  }).join('');
}

function renderDiagnostic(){
  const d=lastDiagnosis||JSON.parse(localStorage.getItem('vlanesia_diag')||'null'); if(!d)return;
  const loss=d.success?'0%':'100%';
  const focus=d.success?'Konektivitas sesuai skenario':(d.error||'Perlu diagnosis lanjutan');
  const nextAction=d.success?'Lanjut ke evaluasi atau coba skenario lain':(d.steps.find(([,status])=>status!=='OK')?.[0]||'Periksa kembali konfigurasi');
  $('#pingOutput').innerHTML=formatPingOutput(d.pingText,d.success);
  $('#pingBadge').textContent=d.success?'Berhasil':'Timeout'; $('#pingBadge').className=`badge ${d.success?'good':'bad'}`;
  const pingCard=$('#pingCard');
  if(pingCard){ pingCard.classList.toggle('success',!!d.success); pingCard.classList.toggle('failure',!d.success); }
  $('#pingSummary').innerHTML=`<div class="ping-stat ${d.success?'ok':'fail'}"><small>Status</small><b>${d.success?'Reply diterima':'Ping timeout'}</b></div><div class="ping-stat"><small>Packet loss</small><b>${loss}</b></div><div class="ping-stat"><small>Fokus cek</small><b>${focus}</b></div><div class="ping-stat"><small>Langkah berikutnya</small><b>${nextAction}</b></div>`;
  $('#diagTitle').textContent=d.title;$('#diagExplanation').textContent=d.explanation;
  $('#diagSteps').innerHTML=d.steps.map(([a,b],i)=>`<div class="diag-step ${b==='OK'?'ok':'warn'}"><i>${i+1}</i><b>${a}</b><span class="diag-chip ${b==='OK'?'ok':'warn'}">${b}</span></div>`).join('');
}

function renderQuiz(){
  $('#quizList').innerHTML=questions.map((q,i)=>`<div class="quiz-card card"><span class="eyebrow">SOAL ${i+1}</span><h3>${q.q}</h3><div class="options">${q.opts.map((o,j)=>`<label class="option"><input type="radio" name="q${i}" value="${j}" required><span>${String.fromCharCode(65+j)}. ${o}</span></label>`).join('')}</div></div>`).join('');
}
$('#evaluationForm').addEventListener('submit',async e=>{
  e.preventDefault(); const form=e.currentTarget; const btn=form.querySelector('button[type=submit]'); const oldText=btn.textContent; btn.disabled=true;btn.textContent='Mengirim...';
  try{
    const fd=new FormData(form); let correct=0; questions.forEach((q,i)=>{const v=Number(fd.get(`q${i}`));if(v===q.a)correct++}); const score=Math.round(correct/questions.length*100);
    const saved=await api('/api/evaluation',{method:'POST',body:JSON.stringify({sessionId:session.id,score,correct,total:questions.length,difficulty:$('#reflectionDifficulty').value,benefit:$('#reflectionBenefit').value})});
    const box=$('#evalResult');box.classList.remove('hidden');box.classList.toggle('not-passed',score<75);box.innerHTML=`<b>✓ Evaluasi tersimpan · Skor ${score}</b><br>${correct}/${questions.length} jawaban benar. ${score>=75?'Tuntas — lanjutkan ke praktik Cisco Packet Tracer.':'Belum tuntas — pelajari kembali materi dan ulangi simulasi.'}`;toast(`Evaluasi berhasil dikirim ke database #${saved.id}`);
    logAction('SUBMIT_EVALUATION',`score ${score}`);
  }catch(err){toast('Evaluasi gagal dikirim. Coba lagi setelah memastikan server aktif.')}
  finally{btn.disabled=false;btn.textContent=oldText;}
});

async function loadDashboard(){
  try{const d=await api('/api/dashboard'); const o=d.overview;$('#dashboardStats').innerHTML=`<div class="dash-stat card"><span>Sesi siswa</span><b>${o.sessions||0}</b></div><div class="dash-stat card"><span>Percobaan simulasi</span><b>${o.attempts||0}</b></div><div class="dash-stat card"><span>Rata-rata simulasi</span><b>${o.avgSimulation??'-'}</b></div><div class="dash-stat card"><span>Rata-rata evaluasi</span><b>${o.avgEvaluation??'-'}</b></div>`; const max=Math.max(1,...d.errors.map(x=>x.total));$('#errorBars').innerHTML=d.errors.length?d.errors.map(x=>`<div class="bar-row"><span>${x.label}</span><div class="bar-track"><div class="bar-fill" style="width:${x.total/max*100}%"></div></div><b>${x.total}</b></div>`).join(''):'<small>Belum ada data.</small>';$('#scenarioStats').innerHTML=d.scenarios.length?d.scenarios.map(x=>`<div class="scenario-row"><span>Skenario ${x.scenario}</span><b>${x.avg_score??0} · ${x.success_count}/${x.total} berhasil</b></div>`).join(''):'<small>Belum ada data.</small>';$('#recentTable').innerHTML=d.recent.length?d.recent.map(r=>`<tr><td><b>${r.alias}</b></td><td>${r.class_name}</td><td>${r.score}</td><td>${r.correct}/${r.total}</td><td>${new Date(r.created_at+'Z').toLocaleString('id-ID')}</td></tr>`).join(''):'<tr><td colspan="5">Belum ada evaluasi.</td></tr>';}catch(e){toast('Dashboard belum dapat dimuat')}
}
$('#refreshDashboard').addEventListener('click',loadDashboard);

renderMaterials();renderQuiz();resetScenario();renderDiagnostic();initSession();
api('/api/health').then((h)=>{$('.status-dot span').textContent=h.database||'Supabase Global';}).catch(()=>{$('.status-dot span').textContent='Supabase offline';$('.status-dot i').style.background='#d95d5d'; const e=$('#loginError'); if(e){e.textContent='Database Supabase belum terhubung. Cek file .env dan jalankan supabase_setup.sql.';e.classList.remove('hidden');}});
