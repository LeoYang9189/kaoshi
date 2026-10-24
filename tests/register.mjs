// Test-only TypeScript/Cloudflare adapter. Application code is loaded unchanged.
import {registerHooks} from 'node:module';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const here=new URL('.',import.meta.url);
registerHooks({
  resolve(specifier,context,next){
    if(specifier==='cloudflare:workers')return {url:new URL('runtime-cloudflare.mjs',here).href,shortCircuit:true};
    if((specifier.startsWith('./')||specifier.startsWith('../'))&&context.parentURL){
      const resolved=new URL(specifier,context.parentURL);
      if(resolved.pathname.endsWith('/app/chatgpt-auth'))return {url:new URL('runtime-auth.mjs',here).href,shortCircuit:true};
      if(!/\.[a-z]+$/i.test(resolved.pathname)&&existsSync(fileURLToPath(resolved)+'.ts'))return {url:resolved.href+'.ts',shortCircuit:true};
    }
    return next(specifier,context);
  },
  load(url,context,next){
    if(url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};
    if(url.endsWith('.json')&&url.includes('/data/'))return {format:'module',shortCircuit:true,source:'export default '+readFileSync(fileURLToPath(url),'utf8')};
    return next(url,context);
  }
});
