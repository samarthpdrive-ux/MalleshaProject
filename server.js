const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const VIDEOS_FILE = path.join(DATA_DIR, 'videos.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const MASTER_KEY = crypto.createHash('sha256').update(process.env.MASTER_KEY || '').digest();
const sessions = new Set();
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ACCOUNTS_FILE)) fs.writeFileSync(ACCOUNTS_FILE, '[]');
if (!fs.existsSync(VIDEOS_FILE)) fs.writeFileSync(VIDEOS_FILE, '[]');
if (!ADMIN_PASSWORD || !process.env.MASTER_KEY) console.warn('Set ADMIN_PASSWORD and MASTER_KEY in Render before using the admin panel.');
app.use(express.json()); app.use(express.static(__dirname));
const upload = multer({ dest:path.join(DATA_DIR, 'uploads'), limits:{fileSize:100 * 1024 * 1024} });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));
function encrypt(value) { const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm', MASTER_KEY, iv), encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]); return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${encrypted.toString('base64')}`; }
function decrypt(value) { const [iv,tag,text]=value.split('.').map(x=>Buffer.from(x,'base64')), decipher=crypto.createDecipheriv('aes-256-gcm',MASTER_KEY,iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(text),decipher.final()]).toString('utf8'); }
function token(req) { return (req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith('salon_admin='))?.slice(12); }
function admin(req,res,next) { return sessions.has(token(req)) ? next() : res.status(401).json({error:'Please sign in.'}); }
function safeAccounts() { return read(ACCOUNTS_FILE).map(({encrypted,...account})=>account); }
app.get('/api/videos', (req,res)=>res.json(read(VIDEOS_FILE)));
app.post('/api/admin/login', (req,res) => { if (!ADMIN_PASSWORD || !req.body.password || req.body.password !== ADMIN_PASSWORD) return res.status(401).json({error:'Invalid password.'}); const id=crypto.randomBytes(32).toString('hex'); sessions.add(id); res.setHeader('Set-Cookie',`salon_admin=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`); res.json({success:true}); });
app.post('/api/admin/logout', admin, (req,res)=>{ sessions.delete(token(req)); res.setHeader('Set-Cookie','salon_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); res.json({success:true}); });
app.get('/api/admin/accounts', admin, (req,res)=>res.json(safeAccounts()));
app.post('/api/admin/accounts', admin, (req,res)=>{ const {name,cloudName,apiKey,apiSecret}=req.body; if (![name,cloudName,apiKey,apiSecret].every(Boolean)) return res.status(400).json({error:'Complete every account field.'}); const accounts=read(ACCOUNTS_FILE); accounts.push({id:crypto.randomUUID(),name,cloudName,encrypted:encrypt(JSON.stringify({apiKey,apiSecret}))}); write(ACCOUNTS_FILE,accounts); res.status(201).json({success:true}); });
app.delete('/api/admin/accounts/:id', admin, (req,res)=>{ write(ACCOUNTS_FILE,read(ACCOUNTS_FILE).filter(a=>a.id!==req.params.id)); res.json({success:true}); });
app.post('/api/admin/upload', admin, upload.single('video'), async (req,res)=>{ try { if (!req.file) return res.status(400).json({error:'Choose an MP4 video.'}); const account=read(ACCOUNTS_FILE).find(a=>a.id===req.body.accountId); if (!account) return res.status(400).json({error:'Choose a Cloudinary account.'}); const {apiKey,apiSecret}=JSON.parse(decrypt(account.encrypted)); cloudinary.config({cloud_name:account.cloudName,api_key:apiKey,api_secret:apiSecret,secure:true}); const result=await cloudinary.uploader.upload(req.file.path,{resource_type:'video',folder:'salon-videos'}); const videos=read(VIDEOS_FILE); videos.unshift({id:result.public_id,title:req.body.title||req.file.originalname,category:req.body.category||'Salon video',artist:req.body.artist||'Mallesha Hair Studio',description:req.body.description||'',videoUrl:result.secure_url,poster:result.secure_url.replace('/upload/','/upload/so_0/').replace(/\.[^.]+$/,'.jpg')}); write(VIDEOS_FILE,videos); fs.unlink(req.file.path,()=>{}); res.status(201).json({success:true}); } catch(error) { if(req.file) fs.unlink(req.file.path,()=>{}); console.error(error); res.status(500).json({error:'Upload failed. Check Cloudinary credentials and file size.'}); } });
app.delete('/api/admin/videos/:id', admin, (req,res)=>{ write(VIDEOS_FILE,read(VIDEOS_FILE).filter(v=>v.id!==req.params.id)); res.json({success:true}); });
app.listen(PORT,()=>console.log(`Salon admin running on port ${PORT}`));
