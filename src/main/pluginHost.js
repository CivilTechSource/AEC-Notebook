// pluginHost.js — builds the HTML page served to a plugin iframe over the pnplugin:// scheme.
// Serving from a real (custom) scheme gives the page its OWN CSP (set by the protocol handler),
// so the sandboxed plugin's inline scripts run without inheriting the app's strict script-src.
const plugins = require('./plugins');

// The PluginAPI SDK injected before the plugin's own code (talks to the host via postMessage).
// On init it also applies the app's theme variables so the plugin matches the app (incl. light/dark).
const SDK = `(function(){
  var initData=null, initCbs=[], reqId=0, pending={};
  function applyTheme(theme){ if(!theme) return; var r=document.documentElement.style; try{ Object.keys(theme).forEach(function(k){ r.setProperty(k, theme[k]); }); }catch(e){} }
  window.addEventListener('message', function(e){
    var m=e.data||{};
    if(m.__pn==='init'){ initData=m.data; applyTheme(initData.theme); initCbs.forEach(function(cb){cb(initData);}); initCbs=[]; }
    else if(m.__pn==='theme'){ applyTheme(m.data); }
    else if(m.__pn==='reply' && pending[m.id]){ pending[m.id](m.result); delete pending[m.id]; }
  });
  function call(type,payload){ return new Promise(function(res){ var id=++reqId; pending[id]=res; parent.postMessage({__pn:type,id:id,payload:payload},'*'); }); }
  // Report content height so the host can size the iframe to fit (no fixed box / empty space).
  function reportSize(){ try{ var h=Math.ceil(document.documentElement.getBoundingClientRect().height); parent.postMessage({__pn:'resize',payload:{height:h}},'*'); }catch(e){} }
  window.addEventListener('load', reportSize);
  if(window.ResizeObserver){ try{ new ResizeObserver(reportSize).observe(document.documentElement); }catch(e){} }
  window.PluginAPI={
    onInit:function(cb){ if(initData) cb(initData); else initCbs.push(cb); },
    getFields:function(){ return initData? initData.fields : []; },
    writeField:function(key,value){ return call('writeField',{key:key,value:value}); },
    copy:function(text){ parent.postMessage({__pn:'copy',payload:{text:String(text)}},'*'); },
    notify:function(msg){ parent.postMessage({__pn:'notify',payload:{msg:String(msg)}},'*'); }
  };
})();`;

// Mirrors the app's tokens + component styles so plugins look native. The :root values are
// dark-theme fallbacks; the host overrides them (incl. light theme) via the init 'theme' payload.
const BASE_CSS = `:root{
  --bg:#212429;--bg-panel:#1b1d21;--bg-dark:#16171a;--bg-card:#282c32;--bg-card-2:#1e2024;
  --line:#2a2e34;--line-2:#2f343b;--line-3:#34383f;--line-4:#41464e;
  --text:#e6e8ec;--text-2:#c4c8ce;--text-3:#b6bcc4;--muted:#8a9199;--muted-2:#6a7079;--faint:#565b63;
  --accent:#5b8cff;--accent-h:#6e9bff;--green:#5fb87a;--amber:#e0a23b;--red:#e5675c;--teal:#5fb6c4;--purple:#9b6bd4;
  --radius:8px;--mono:'JetBrains Mono',ui-monospace,Menlo,monospace;
}
*{box-sizing:border-box;}
body{margin:0;padding:2px 2px 6px;background:transparent;color:var(--text);
  font-family:'Segoe UI',system-ui,-apple-system,sans-serif;font-size:13px;-webkit-font-smoothing:antialiased;}
input,select,textarea{width:100%;background:var(--bg);border:1px solid var(--line-3);color:var(--text);
  border-radius:7px;padding:7px 10px;font:inherit;font-size:13px;}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--accent);}
button,.btn{height:30px;padding:0 13px;display:inline-flex;align-items:center;justify-content:center;gap:6px;
  border:1px solid var(--line-3);border-radius:6px;font:inherit;font-size:12px;color:var(--text-2);background:transparent;cursor:pointer;}
button:hover,.btn:hover{background:var(--bg-card);border-color:var(--line-4);color:var(--text);}
button.primary,.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:500;}
button.primary:hover,.btn.primary:hover{background:var(--accent-h);}
label,.lbl{color:var(--muted);font-size:12px;}
.card{background:var(--bg-card);border:1px solid var(--line-2);border-radius:11px;padding:14px;}
.muted{color:var(--muted);} .mono{font-family:var(--mono);}
a{color:var(--accent);text-decoration:none;} a:hover{text-decoration:underline;}
::-webkit-scrollbar{width:9px;height:9px;} ::-webkit-scrollbar-thumb{background:#3a3f47;border-radius:6px;}`;

function escScript(s) { return String(s).replace(/<\/(script)/gi, '<\\/$1'); }

function buildPage(source) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head>
<body><div id="root"></div>
<script>${SDK}<\/script>
<script>try{${escScript(source)}}catch(e){document.body.innerHTML='<pre style="color:#ff7a7a">Plugin error: '+e.message+'</pre>';}<\/script>
</body></html>`;
}

async function pageFor(appRoot, id) {
  const { source } = await plugins.readPluginSource(appRoot, id);
  return buildPage(source);
}

// CSP for the plugin document: allow only its own inline script/style + data: images; no network.
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none';";

module.exports = { buildPage, pageFor, CSP };
