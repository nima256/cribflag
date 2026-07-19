const fs=require('fs');const path=require('path');const cp=require('child_process');
const root=path.join(__dirname,'..');
const files=[];function walk(dir){for(const n of fs.readdirSync(dir)){const p=path.join(dir,n);if(p.includes('node_modules'))continue;const s=fs.statSync(p);if(s.isDirectory())walk(p);else if(p.endsWith('.js'))files.push(p);}}
walk(root);let failed=0;for(const f of files){const r=cp.spawnSync(process.execPath,['--check',f],{encoding:'utf8'});if(r.status!==0){failed++;console.error(`FAIL ${path.relative(root,f)}\n${r.stderr}`);}}
if(failed)process.exit(1);console.log(`Syntax OK: ${files.length} JavaScript files`);
