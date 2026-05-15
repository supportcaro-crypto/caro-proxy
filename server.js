const express = require('express');
const cors = require('cors');
const https = require('https');
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
    const fetch = require('node-fetch');
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
    const fetch = require('node-fetch');
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

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log('Caro Proxy running on port ' + PORT);
});
