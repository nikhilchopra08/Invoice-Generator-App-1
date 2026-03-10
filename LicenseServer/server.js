
import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import fs from 'fs';
import path from 'path';

// Env
const STRIPE_ENABLED = (process.env.STRIPE_ENABLED || 'false').toLowerCase() === 'true';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const PORT = process.env.PORT || 8787;
const PLAN_DAYS = parseInt(process.env.PLAN_DAYS || '365', 10);

let stripe = null;
if (STRIPE_ENABLED) {
  const pkg = await import('stripe');
  stripe = new pkg.default(STRIPE_SECRET_KEY);
}

const app = express();
app.use(cors());
app.use(express.json());

// DB
const db = new Database('licenses.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS licenses (
    id TEXT PRIMARY KEY,
    key TEXT UNIQUE,
    plan_days INTEGER NOT NULL,
    max_devices INTEGER NOT NULL DEFAULT 1,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    notes TEXT
  );
  CREATE TABLE IF NOT EXISTS activations (
    id TEXT PRIMARY KEY,
    license_key TEXT NOT NULL,
    device_id TEXT NOT NULL,
    activated_at INTEGER NOT NULL
  );
`);

function now(){ return Math.floor(Date.now()/1000); }
function issueLicense(planDays = PLAN_DAYS){
  const id = nanoid(10);
  const key = [nanoid(4),nanoid(4),nanoid(4),nanoid(4)].join('-').toUpperCase();
  const issuedAt = now();
  const expiresAt = issuedAt + (planDays*86400);
  db.prepare(`INSERT INTO licenses (id, key, plan_days, max_devices, issued_at, expires_at, active) VALUES (?,?,?,?,?,?,1)`)
    .run(id, key, planDays, 1, issuedAt, expiresAt);
  return { key, expiresAt };
}

// Admin manual issue
app.post('/api/admin/issue', (req,res) => {
  const { planDays=PLAN_DAYS, notes='' } = req.body || {};
  try{
    const lic = issueLicense(planDays);
    db.prepare('UPDATE licenses SET notes=? WHERE key=?').run(notes, lic.key);
    res.json(lic);
  }catch(e){ res.status(400).json({ error:e.message }); }
});

// Verify & bind device
app.post('/api/verify', (req,res) => {
  const { key, deviceId } = req.body || {};
  if(!key || !deviceId) return res.json({ valid:false, message:'Missing key or deviceId' });
  const lic = db.prepare('SELECT * FROM licenses WHERE key=? AND active=1').get(key);
  if(!lic) return res.json({ valid:false, message:'License not found' });
  if(lic.expires_at < now()) return res.json({ valid:false, message:'License expired', expiresAt: lic.expires_at });

  const activations = db.prepare('SELECT * FROM activations WHERE license_key=?').all(key);
  const already = activations.find(a => a.device_id === deviceId);
  if(!already && activations.length >= lic.max_devices){
    return res.json({ valid:false, message:'Device limit reached' });
  }
  if(!already){
    db.prepare('INSERT INTO activations (id, license_key, device_id, activated_at) VALUES (?,?,?,?)')
      .run(nanoid(10), key, deviceId, now());
  }
  return res.json({ valid:true, expiresAt: lic.expires_at });
});

// Simple landing to sell
app.get('/', (req,res)=>{
  if(!STRIPE_ENABLED){
    res.send(`<h1>Licensing Server Online</h1><p>Stripe checkout is currently <b>disabled</b>. Contact sales for a license.</p>`);
  }else{
    res.send(`<h1>Buy License</h1><form action="/buy" method="POST"><button>Buy now</button></form>`);
  }
});

// Create checkout session (if enabled)
app.post('/buy', async (req,res) => {
  if(!STRIPE_ENABLED) return res.status(403).send('Stripe disabled');
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${req.protocol}://${req.get('host')}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${req.protocol}://${req.get('host')}/`
  });
  res.redirect(303, session.url);
});

// Success page (issues key immediately for demo; use webhooks in prod)
app.get('/success', async (req,res) => {
  if(!STRIPE_ENABLED) return res.status(403).send('Stripe disabled');
  const session = await stripe.checkout.sessions.retrieve(req.query.session_id);
  const lic = issueLicense(PLAN_DAYS);
  res.send(`<h1>Payment successful</h1><p>Your license key:</p><pre>${lic.key}</pre><p>Save it – you can enter it in the app's activation screen.</p>`);
});

// Webhook (optional, disabled unless secret provided)
if (STRIPE_ENABLED && STRIPE_WEBHOOK_SECRET) {
  app.post('/webhook', express.raw({ type:'application/json' }), (req,res) => {
    let event;
    try {
      const signature = req.headers['stripe-signature'];
      event = stripe.webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.log('Webhook signature verification failed.');
      return res.sendStatus(400);
    }
    if (event.type === 'checkout.session.completed') {
      issueLicense(PLAN_DAYS);
    }
    res.json({received:true});
  });
}

app.listen(PORT, () => console.log('License server listening on ' + PORT + ' | Stripe enabled: ' + STRIPE_ENABLED));
