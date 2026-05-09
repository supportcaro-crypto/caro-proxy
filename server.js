const express = require('express');
const cors = require('cors');
const https = require('https');
const { spawn } = require('child_process');
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const FIREBASE_PROJECT = "caroinsyria";
const FIREBASE_API_KEY = "AIzaSyAn4mAV61z2eMbaI_oZUINDqQd6YSomAcs";
const PROXY_SECRET = "caro_proxy_2025_pX7#nR";

const CLOUDINARY_CLOUD_NAME = "danjopn9s";
const CLOUDINARY_API_KEY = "141246199985152";
const CLOUDINARY_API_SECRET = "5nMfPPpxk8NVdqRZm3Tm1Qp8Iyk";

const GROQ_API_KEY = "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";

function checkSecret(req, res) {
  const { secret } = req.body || {};
  if (secret !== PROXY_SECRET) {
    res.status(403).json({ success: false, error: 'forbidden' });
    return false;
  }
  return true;
}

async function sha256(str) {
  const { createHash } = require('crypto');
  return createHash('sha1').update(str).digest('hex');
}

app.get('/', (req, res) => {
  res.json({ status: 'running', app: 'Caro Proxy Server' });
});

app.post('/sign-upload', async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { paramsToSign } = req.body;
  const sortedKeys = Object.keys(paramsToSign).sort();
  const paramString = sortedKeys.map(k => k + '=' + paramsToSign[k]).join('&') + CLOUDINARY_API_SECRET;
  const signature = await sha256(paramString);
  res.json({ success: true, signature, api_key: CLOUDINARY_API_KEY, cloud_name: CLOUDINARY_CLOUD_NAME });
});

app.post('/sign-delete', async (req, res) => {
  if (!checkSecret(req, res)) return;
  const { public_id } = req.body;
  const timestamp = Math.floor(Date.now() / 1000);
  const paramString = 'public_id=' + public_id + '&timestamp=' + timestamp + CLOUDINARY_API_SECRET;
  const signature = await sha256(paramString);
  res.json({ success: true, signature, api_key: CLOUDINARY_API_KEY, timestamp, cloud_name: CLOUDINARY_CLOUD_NAME });
});

app.post('/send-email', async (req, res) => {
  const { to_email, otp_code, user_name } = req.body;
  try {
    const emailjs = require('@emailjs/nodejs');
    await emailjs.send('service_cb3prgt', 'template_q3by3k4', {
      email: to_email,
      otp_code: otp_code,
      user_name: user_name || 'مستخدم'
    }, { publicKey: 'ZItSgkAWpyo2cTF5I', privateKey: 'OFjz4oBlbmnFWgCc0DJiu' });
    res.json({ success: true });
  } catch (err) {
    console.error('EmailJS error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/send-sms', async (req, res) => {
  const { phone, message } = req.body;
  try {
    const smsDoc = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'firestore.googleapis.com',
        path: '/v1/projects/' + FIREBASE_PROJECT + '/databases/(default)/documents/settings/smsGateway?key=' + FIREBASE_API_KEY,
        method: 'GET'
      };
      const r = https.request(options, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => resolve(JSON.parse(data)));
      });
      r.on('error', reject);
      r.end();
    });
    const smsUrl = smsDoc.fields.url.stringValue;
    const { default: fetch } = await import('node-fetch');
    const smsResp = await fetch(smsUrl + '/send-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message, secret: 'caro_secret_2025_xK9#mQ' })
    });
    const data = await smsResp.json();
    res.json(data);
  } catch (err) {
    console.error('SMS proxy error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/chat', async (req, res) => {
  const { messages, model, max_tokens, temperature } = req.body;
  if (!checkSecret(req, res)) return;
  try {
    const { default: fetch } = await import('node-fetch');
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY
      },
      body: JSON.stringify({
        model: model || 'llama-3.3-70b-versatile',
        messages,
        max_tokens: max_tokens || 1024,
        temperature: temperature || 0.7
      })
    });
    const data = await groqRes.json();
    res.json(data);
  } catch (err) {
    console.error('Groq error:', err);
    res.status(500).json({ error: err.message });
  }
});

let currentTunnelUrl = null;
let saveInterval = null;

function saveUrlToFirestore(url, retry) {
  const body = JSON.stringify({ fields: { url: { stringValue: url } } });
  const options = {
    hostname: 'firestore.googleapis.com',
    path: '/v1/projects/' + FIREBASE_PROJECT + '/databases/(default)/documents/settings/proxyGateway?key=' + FIREBASE_API_KEY,
    method: 'PATCH',
    family: 4,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  };
  const req = https.request(options, (r) => {
    r.on('data', () => {});
    r.on('end', () => console.log('URL saved:', url));
  });
  req.on('error', (e) => {
    console.error('Firestore error:', e.message);
    if (retry !== false) {
      console.log('Retrying in 15s...');
      setTimeout(() => saveUrlToFirestore(url, true), 15000);
    }
  });
  req.write(body); req.end();
}

function startPeriodicSave() {
  if (saveInterval) clearInterval(saveInterval);
  saveInterval = setInterval(() => {
    if (currentTunnelUrl) {
      console.log('Periodic save:', currentTunnelUrl);
      saveUrlToFirestore(currentTunnelUrl, false);
    }
  }, 30000);
}

function startTunnel() {
  console.log('Starting tunnel...');
  const cf = spawn('cloudflared', ['tunnel', '--url', 'http://localhost:4000']);
  cf.stderr.on('data', (data) => {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/);
    if (match) {
      currentTunnelUrl = match[0];
      console.log('Tunnel URL:', currentTunnelUrl);
      saveUrlToFirestore(currentTunnelUrl, true);
    }
  });
  cf.on('close', (code) => {
    currentTunnelUrl = null;
    const delay = code === 0 ? 3000 : 15000;
    console.log('Restarting tunnel in ' + delay/1000 + 's...');
    setTimeout(startTunnel, delay);
  });
}

app.listen(4000, () => {
  console.log('Caro Proxy running on port 4000');
  startTunnel();
  startPeriodicSave();
});
