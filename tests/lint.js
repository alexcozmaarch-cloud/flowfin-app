// Checks that every js/ module only uses names it imports, declares, or gets from js/config.js.
const fs=require('fs'),acorn=require('acorn'),walk=require('acorn-walk'),path=require('path');
const R=require('path').join(__dirname,'..','js');
const cfg=acorn.parse(fs.readFileSync(R+'/config.js','utf8'),{ecmaVersion:2022});
const globals=new Set();cfg.body.forEach(s=>s.type==='VariableDeclaration'&&s.declarations.forEach(d=>globals.add(d.id.name)));
const BUILTIN=new Set(Object.getOwnPropertyNames(globalThis).concat(['window','document','location','history','navigator','localStorage','sessionStorage','Chart','fetch','HashChangeEvent','Event','matchMedia','requestAnimationFrame','getComputedStyle','CSS','Intl','Blob','URL','FileReader','alert','confirm','setTimeout','clearTimeout','setInterval','clearInterval','console','arguments','undefined','performance','caches','Node','Element','HTMLElement','screen','innerWidth','innerHeight','scrollTo','scrollY','devicePixelRatio','IntersectionObserver','ResizeObserver','MutationObserver','DOMParser','TextDecoder','TextEncoder','crypto','atob','btoa','structuredClone','queueMicrotask','prompt','open','print','self','top','name','event','addEventListener','removeEventListener','dispatchEvent','visualViewport']));
const exportsOf={};
for(const f of fs.readdirSync(R)){if(f==='config.js')continue;const ast=acorn.parse(fs.readFileSync(R+'/'+f,'utf8'),{ecmaVersion:2022,sourceType:'module'});
  const ex=new Set();ast.body.forEach(s=>{if(s.type==='ExportNamedDeclaration')s.specifiers.forEach(x=>ex.add(x.exported.name));});exportsOf[f]=ex;}
module.exports=function(h){let bad=0, msgs=[];
for(const f of fs.readdirSync(R)){if(f==='config.js')continue;const src=fs.readFileSync(R+'/'+f,'utf8');const ast=acorn.parse(src,{ecmaVersion:2022,sourceType:'module',locations:true});
  const imported=new Set();
  ast.body.forEach(s=>{if(s.type==='ImportDeclaration'){const from=path.basename(s.source.value);s.specifiers.forEach(x=>{imported.add(x.local.name);if(!exportsOf[from]||!exportsOf[from].has(x.imported.name)){msgs.push(f+': imports '+x.imported.name+' which '+from+' does not export');bad++;}});}});
  // scope analysis: collect all declared names anywhere (approximation: any binding in the file)
  const declared=new Set();
  walk.full(ast,n=>{if(n.type==='FunctionDeclaration'||n.type==='FunctionExpression'){if(n.id)declared.add(n.id.name);n.params.forEach(p=>walk.full(p,q=>q.type==='Identifier'&&declared.add(q.name)));}
    if(n.type==='VariableDeclarator')walk.full(n.id,q=>q.type==='Identifier'&&declared.add(q.name));
    if(n.type==='CatchClause'&&n.param)declared.add(n.param.name);
    if(n.type==='ArrowFunctionExpression')n.params.forEach(p=>walk.full(p,q=>q.type==='Identifier'&&declared.add(q.name)));});
  const missing=new Set();
  walk.ancestor(ast,{Identifier(n,_,anc){const p=anc[anc.length-2];
    if(p&&p.type==='MemberExpression'&&p.property===n&&!p.computed)return;
    if(p&&p.type==='Property'&&p.key===n&&!p.computed&&!p.shorthand)return;
    if(p&&(p.type==='ImportSpecifier'||p.type==='ExportSpecifier'))return;
    if(p&&p.type==='LabeledStatement')return;
    const x=n.name;if(declared.has(x)||imported.has(x)||globals.has(x)||BUILTIN.has(x))return;missing.add(x);}});
  if(missing.size){msgs.push(f+': not defined: '+[...missing].join(', '));bad++;}
}
h.assert(!bad, msgs.join('\n'));};
