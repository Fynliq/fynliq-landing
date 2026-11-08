// Fails when a commit carries the loader that was force-pushed into this repo in Oct-Nov 2026
// (see docs/SECURITY_INCIDENT_2026-10.md). It only reads files through git, never runs them,
// so it is safe to point at a suspect branch:  node test/supply-chain-guard.mjs origin/some-branch
import {execFileSync} from 'node:child_process';
const ref=process.argv[2]||'HEAD';
const git=(args,input)=>execFileSync('git',args,{input,maxBuffer:256*1024*1024});
const paths=git(['ls-tree','-r','-z','--name-only',ref]).toString().split('\0').filter(Boolean);
// One cat-file process for every blob: "<sha> blob <size>\n<bytes>\n" per path, in order.
const out=git(['cat-file','--batch'],paths.map(p=>ref+':'+p).join('\n')+'\n');
const files=new Map();let at=0;
for(const p of paths){const nl=out.indexOf(10,at);const [,type,size]=out.subarray(at,nl).toString().split(' ');const n=Number(size)||0;if(type==='blob')files.set(p,out.subarray(nl+1,nl+1+n));at=nl+1+n+1;}
const problems=[];const flag=(p,why)=>problems.push(p+': '+why);
const text=b=>b.includes(0)?null:b.toString('utf8');
// The loader hid behind "node api.js" and "node init" in lifecycle scripts: a root api.js, or a file with no JS/TS extension.
const lifecycle=/^(pre|post)?(dev|build|start|install|prepare|publish|test)$/;
for(const [p,b] of files){
 const s=text(b);
 if(/\.lfk$/i.test(p))flag(p,'.lfk file (the loader was disguised as a font)');
 if(s===null)continue;
 // Code pushed off-screen: a long run of tabs/spaces, then more code on the same line.
 s.split('\n').forEach((line,i)=>{if(/[\t ]{100,}\S/.test(line))flag(p+':'+(i+1),'code hidden after '+line.match(/[\t ]{100,}/)[0].length+' blank characters');});
 if(/(^|\/)\.vscode\/(tasks|settings)\.json$/.test(p)&&/"runOn"\s*:\s*"folderOpen"/.test(s))flag(p,'task that runs when the folder is opened');
 if(/(^|\/)\.vscode\/settings\.json$/.test(p)&&/"task\.allowAutomaticTasks"\s*:\s*(true|"on")/.test(s))flag(p,'turns on automatic tasks');
 if(/(^|\/)\.gitignore$/.test(p))for(const entry of s.split(/\r?\n/).map(l=>l.trim()))if(entry==='.gitignore'||/^(temp_auto_push|temp_interactive_push|config)\.bat$|^branch_structure\.json$/.test(entry))flag(p,'ignores "'+entry+'", which only the loader writes');
 if(/(^|\/)package\.json$/.test(p)){let scripts={};try{scripts=JSON.parse(s).scripts||{};}catch{flag(p,'not valid JSON');}
  for(const [name,cmd] of Object.entries(scripts))if(lifecycle.test(name))for(const m of String(cmd).matchAll(/\bnode\s+(?:--[\w-]+(?:=\S+)?\s+)*([^\s&|;-][^\s&|;]*)/g))if(m[1]==='api.js'||!/\.(c|m)?[jt]sx?$/.test(m[1]))flag(p,'"'+name+'" runs node '+m[1]);}
}
if(problems.length){console.error('FAIL supply-chain guard on '+ref+'\n  '+problems.join('\n  '));process.exit(1);}
console.log('PASS supply-chain guard on '+ref+' ('+files.size+' files)');
