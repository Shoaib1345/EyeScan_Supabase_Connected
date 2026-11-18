/* EyeScan — Supabase-backed doctor registration, authentication and eye-image storage.
   Node.js 18+; uses native fetch, no runtime dependencies. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://khywsjnfriabcveonglz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_TTe16gKdPgaBByeT-cPihA_h5ORHjnP';
const BUCKET = 'eye-images';
const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const EXT_MIME = Object.fromEntries(Object.entries(MIME_EXT).map(([k,v]) => [v,k]));
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Content-Length':Buffer.byteLength(body), 'Cache-Control':'no-store' });
  res.end(body);
}
function readBody(req, limit=16*1024*1024) {
  return new Promise((resolve,reject)=>{ let size=0; const chunks=[];
    req.on('data',c=>{ size+=c.length; if(size>limit){ reject(new Error('Upload too large (max 12 MB image).')); req.destroy(); } else chunks.push(c); });
    req.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8'))); req.on('error',reject);
  });
}
function tokenFrom(req,url) {
  const auth=req.headers.authorization||'';
  if(auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const cookie=(req.headers.cookie||'').match(/(?:^|;\s*)sid=([^;]+)/); if(cookie) return decodeURIComponent(cookie[1]);
  return url.searchParams.get('sid');
}
async function sb(pathname, token, options={}) {
  const headers = Object.assign({ apikey:SUPABASE_KEY, Authorization:'Bearer '+(token||SUPABASE_KEY) }, options.headers||{});
  const response = await fetch(SUPABASE_URL+pathname, {...options, headers});
  const text = await response.text(); let data={}; try{data=text?JSON.parse(text):{};}catch{data={message:text};}
  if(!response.ok){ const e=new Error(data.msg||data.message||data.error_description||data.error||`Supabase request failed (${response.status})`); e.status=response.status; throw e; }
  return {data,status:response.status,headers:response.headers};
}
async function currentUser(token) { if(!token) return null; try { return (await sb('/auth/v1/user',token)).data; } catch { return null; } }
async function profileFor(user, token) {
  const rows=(await sb('/rest/v1/profiles?select=id,name,email,specialization&id=eq.'+encodeURIComponent(user.id),token)).data;
  if(rows && rows[0]) return rows[0];
  const meta=user.user_metadata||{};
  const p={id:user.id,name:meta.name||user.email||'Doctor',email:user.email||'',specialization:meta.specialization||''};
  try { await sb('/rest/v1/profiles',token,{method:'POST',headers:{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(p)}); } catch(e) { if(e.status!==409) throw e; }
  return p;
}
function publicImage(row) {
  return {id:row.id,label:row.label,note:row.note,createdAt:row.created_at,size:Number(row.size||0),url:'/api/images/'+row.id+'/file'};
}
async function signedImageUrl(row, token) {
  const r=await sb('/storage/v1/object/sign/'+BUCKET+'/'+row.storage_path,token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:3600})});
  const raw = r.data && (r.data.signedURL || r.data.signedUrl || r.data.url || '');
  if (!raw) throw new Error('Supabase did not return a signed image URL.');
  const relativePath = String(raw).replace(/^\/+/, '');
  return /^https?:\/\//i.test(raw)
    ? raw
    : new URL('/' + (relativePath.startsWith('storage/v1/') ? relativePath : 'storage/v1/' + relativePath), SUPABASE_URL).toString();
}
const SPA_PATHS=new Set(['/','/index.html','/signin.html','/signup.html','/app.html','/login.html','/register.html','/dashboard.html']);
const PUBLIC_MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.ico':'image/x-icon'};
function isWithinRoot(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
function serveFile(res,file,mime){ fs.stat(file,(err,st)=>{if(err)return sendJSON(res,404,{error:'Not found'});res.writeHead(200,{'Content-Type':mime,'Content-Length':st.size,'Cache-Control':'no-cache, no-store, must-revalidate'});fs.createReadStream(file).pipe(res);}); }
function serveStatic(res,urlPath){
  let rel = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath).replace(/\\/g,'/');
  const safe = rel.startsWith('/') ? rel.slice(1) : rel;
  const file = path.resolve(PUBLIC, safe || 'index.html');
  if(!isWithinRoot(PUBLIC, file)) return sendJSON(res,403,{error:'Forbidden'});
  serveFile(res,file,PUBLIC_MIME[path.extname(file).toLowerCase()]||'application/octet-stream');
}
const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost'), p=u.pathname;
 res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Vary','Origin');
 if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'86400'});return res.end();}
 try {
  if(p==='/api/register'&&req.method==='POST'){
   const b=JSON.parse(await readBody(req,1024*1024)); const name=String(b.name||'').trim(),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||''),specialization=String(b.specialization||'').trim();
   if(!name)return sendJSON(res,400,{error:'Full name is required.'}); if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return sendJSON(res,400,{error:'Enter a valid email address.'}); if(password.length<6)return sendJSON(res,400,{error:'Password must be at least 6 characters.'});
   let a;
   try {
    a=await sb('/auth/v1/signup',null,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,data:{name,specialization}})});
   } catch(e) {
    if(e.status===429 || /email.*rate.?limit|rate.?limit.*email|over_email_send_rate_limit/i.test(e.message)) {
     return sendJSON(res,429,{error:'Supabase is temporarily limiting signup or confirmation emails. Wait before trying again; repeated attempts will not help. If the account may already exist, check your inbox and spam folder, or confirm the user in Supabase Auth > Users for testing. For regular email signups, configure a custom SMTP provider in Supabase Authentication > SMTP Settings. Keep email confirmation enabled in production.'});
    }
    throw e;
   }
   if(!a.data.access_token) return sendJSON(res,200,{ok:true,needsConfirmation:true,message:'Account created. Please verify your email, then sign in.'});
   const token=a.data.access_token,user=a.data.user; const profile={id:user.id,name,email,specialization};
   await sb('/rest/v1/profiles',token,{method:'POST',headers:{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(profile)});
   res.setHeader('Set-Cookie',`sid=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
   return sendJSON(res,201,{ok:true,token,user:profile});
  }
  if(p==='/api/login'&&req.method==='POST'){
   const b=JSON.parse(await readBody(req,1024*1024));
   let a;
   try {
    a=await sb('/auth/v1/token?grant_type=password',null,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:String(b.email||'').trim().toLowerCase(),password:String(b.password||'')})});
   } catch(e) {
    if(e.status===400 && /^invalid login credentials$/i.test(e.message)) {
     return sendJSON(res,401,{error:'Email or password is incorrect. If this is an older local account, it must be registered in Supabase before you can sign in.'});
    }
    if(e.status===400 && /^email not confirmed$/i.test(e.message)) {
     return sendJSON(res,403,{error:'Your email address is not verified. Check your inbox and follow the confirmation link, then sign in again. If you cannot find the email, confirm this user in Supabase Auth > Users or request another confirmation email. Keep email confirmation enabled in production.'});
    }
    throw e;
   }
   const token=a.data.access_token,user=a.data.user,profile=await profileFor(user,token); res.setHeader('Set-Cookie',`sid=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`); return sendJSON(res,200,{ok:true,token,user:profile});
  }
  if(p==='/api/logout'&&req.method==='POST'){
   const token=tokenFrom(req,u); if(token) { try{await sb('/auth/v1/logout',token,{method:'POST'});}catch(e){} } res.setHeader('Set-Cookie','sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'); return sendJSON(res,200,{ok:true});
  }
  if(p==='/api/me'&&req.method==='GET'){
   const token=tokenFrom(req,u),user=await currentUser(token); if(!user)return sendJSON(res,401,{error:'Not logged in'}); const profile=await profileFor(user,token); return sendJSON(res,200,{token,user:profile});
  }
  if(p==='/api/images'&&req.method==='POST'){
   const token=tokenFrom(req,u),user=await currentUser(token); if(!user)return sendJSON(res,401,{error:'Please sign in first.'});
   const b=JSON.parse(await readBody(req)); const label=String(b.label||'').toLowerCase(); if(!['positive','negative'].includes(label))return sendJSON(res,400,{error:'Label must be "positive" or "negative".'});
   const m=String(b.dataUrl||'').match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/s); if(!m)return sendJSON(res,400,{error:'Please choose a valid image file (JPG, PNG, WEBP or GIF).'});
   const buf=Buffer.from(m[2],'base64'); if(!buf.length)return sendJSON(res,400,{error:'The image file appears to be empty.'}); if(buf.length>12*1024*1024)return sendJSON(res,413,{error:'Image too large (max 12 MB).'});
   const storagePath=user.id+'/'+crypto.randomUUID()+MIME_EXT[m[1]];
   await sb('/storage/v1/object/'+BUCKET+'/'+storagePath,token,{method:'POST',headers:{'Content-Type':m[1],'x-upsert':'false'},body:buf});
   try { const ins=await sb('/rest/v1/eye_images?select=*',token,{method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({doctor_id:user.id,storage_path:storagePath,label,note:String(b.note||'').slice(0,300),size:buf.length})}); return sendJSON(res,201,{ok:true,image:publicImage(ins.data[0])}); }
   catch(e){ try{await sb('/storage/v1/object/'+BUCKET+'/'+storagePath,token,{method:'DELETE'});}catch{} throw e; }
  }
  if(p==='/api/images'&&req.method==='GET'){
   const token=tokenFrom(req,u),user=await currentUser(token); if(!user)return sendJSON(res,401,{error:'Please sign in first.'});
   const rows=(await sb('/rest/v1/eye_images?select=*&order=created_at.desc',token)).data; return sendJSON(res,200,{images:rows.map(publicImage)});
  }
  const im=p.match(/^\/api\/images\/([0-9a-f-]{36})\/file$/);
  if(im&&req.method==='GET'){
   const token=tokenFrom(req,u),user=await currentUser(token); if(!user)return sendJSON(res,401,{error:'Please sign in first.'}); const rows=(await sb('/rest/v1/eye_images?select=*&id=eq.'+im[1]+'&limit=1',token)).data; if(!rows.length)return sendJSON(res,404,{error:'Image not found'}); const signed=await signedImageUrl(rows[0],token); return res.writeHead(302,{Location:signed,'Cache-Control':'private, no-store'}).end();
  }
  if(req.method==='GET'){if(SPA_PATHS.has(p))return serveFile(res,path.join(PUBLIC,'index.html'),'text/html; charset=utf-8');return serveStatic(res,p);}
  return sendJSON(res,404,{error:'Not found'});
 } catch(err){console.error(err); return sendJSON(res,err.status|| (err.message.includes('too large')?413:500),{error:err.message||'Server error'});}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`EyeScan server running on http://localhost:${PORT} (Supabase: ${SUPABASE_URL})`));
