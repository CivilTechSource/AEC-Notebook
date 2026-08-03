// Sample plugin. Runs inside a sandboxed iframe — it only has access to its own
// document, not the host app. Renders a small click counter.
const root = document.getElementById('root');
let count = 0;

const btn = document.createElement('button');
btn.style.cssText = 'padding:8px 14px;font-size:15px;border-radius:6px;border:1px solid #ccc;cursor:pointer';
const label = document.createElement('p');

function paint() { label.textContent = 'You clicked ' + count + ' time' + (count === 1 ? '' : 's'); }
btn.textContent = 'Click me';
btn.onclick = () => { count++; paint(); };
paint();

const h = document.createElement('h3');
h.textContent = '👋 Hello Counter';
root.appendChild(h);
root.appendChild(btn);
root.appendChild(label);
