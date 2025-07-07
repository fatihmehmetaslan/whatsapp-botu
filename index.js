require('dotenv').config();
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { OpenAI } = require('openai');

// — OpenAI Ayarları —
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

ipcMain.handle('clearChatMemory', () => {
  chatHistory = [];
  saveChatHistory();
  return true;
});
ipcMain.handle('exportChatToText', () => {
  const lines = chatHistory.map(m => `${m.role === 'user' ? 'Sen' : 'Badi'}: ${m.content}`);
  return lines.join('\n\n');
});

// — WhatsApp Bot —
let mainWindow;
const client = new Client();

client.on('qr', qr => {
  qrcode.generate(qr, { small: true }, qrAscii => {
    if (mainWindow) mainWindow.webContents.send('show-qr', qrAscii);
  });
});

client.on('ready', () => console.log('Bot çalışıyor!'));

// — Excel/ODS Stok Verisi Okuma —
function loadStockData() {
  const filePath = path.join(__dirname, 'stoklar.ods');
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

function formatStockReply(row) {
  const qty = Number(row['Adet'] || 0);
  const product = `"${row['Ürün Adı']}"`;
  const details = `Renk: ${row['Renk']}, Beden: ${row['Beden']}`;
  return qty > 0
    ? `✔️ ${product} (${details}) stokta var. Kalan adet: ${qty}.`
    : `❌ Üzgünüz, ${product} (${details}) stoğumuzda kalmamış.`;
}

function checkStock(messageText) {
  const rows = loadStockData();
  const text = messageText.toLowerCase();
  const codeMatch = rows.find(r => r['Stok Kodu'] && text.includes(r['Stok Kodu'].toString()));
  if (codeMatch) return formatStockReply(codeMatch);
  for (const row of rows) {
    const name = (row['Ürün Adı'] || '').toLowerCase();
    const color = (row['Renk'] || '').toLowerCase();
    const size = (row['Beden'] || '').toLowerCase();
    if (
      name && text.includes(name) &&
      (!text.includes('renk') || text.includes(color)) &&
      (!text.includes('beden') || text.includes(size))
    ) {
      return formatStockReply(row);
    }
  }
  return null;
}

// — ChatGPT Fonksiyonu —
// Global sohbet geçmişi
let chatHistory = [];
const memoryFilePath = path.join(app.getPath('userData'), 'badiMemory.json');

// Hafızayı dosyaya kaydetme
function saveChatHistory() {
  const dir = path.dirname(memoryFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(memoryFilePath, JSON.stringify(chatHistory, null, 2));
}

// Hafızayı yükle (uygulama açılırken çağrılacak)
function loadChatHistory() {
  if (fs.existsSync(memoryFilePath)) {
    try {
      const data = fs.readFileSync(memoryFilePath, 'utf-8');
      chatHistory = JSON.parse(data);
    } catch (error) {
      console.error('Hafıza dosyası okunamadı:', error);
      chatHistory = [];
    }
  } else {
    chatHistory = [];
  }
}

async function askOpenAI(prompt) {
  try {
    // Kullanıcı mesajını geçmişe ekle
    chatHistory.push({ role: 'user', content: prompt });

    // API çağrısı için chatHistory hazır
    const res = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: chatHistory.map(message => ({
        role: message.role,
        content: typeof message.content === 'object' ? JSON.stringify(message.content) : message.content
      })),
    });

    let aiResponse = res.choices[0].message.content.trim();

    // Bazı gereksiz selamlama ve noktalama işaretlerini temizle
    const startPattern = /^(?:[!?.,-]*\s*)?(?:merhaba(?:lar)?|selam(?:lar)?|günaydın|iyi\s+günler|nasılsın|selamın\s+aleyküm|hoş\s+geldiniz)/i;
    aiResponse = aiResponse.replace(startPattern, '').trim();
    aiResponse = aiResponse.replace(/^[!?.,-]+\s*/, '').trim();

    // Asistan cevabını geçmişe ekle
    chatHistory.push({ role: 'assistant', content: aiResponse });
    saveChatHistory(); // Geçmişi kaydet

    return aiResponse;
  } catch (err) {
    console.error('OpenAI Hatası:', err.message);
    if (err.code === 'insufficient_quota' || err.status === 429) {
      return 'API kotası aşıldı, lütfen yöneticinize bildirin.';
    }
    return 'Şu anda yardımcı olamıyorum.';
  }
}

// — Mesaj Geldiğinde WhatsApp Bot —
client.on('message', async message => {
  const text = message.body.toLowerCase();

  for (const q of getQuestions()) {
    if (text.includes(q.question.toLowerCase())) return message.reply(q.answer);
  }

  const stockReply = checkStock(message.body);
  if (stockReply) return message.reply(stockReply);

  const aiReply = await askOpenAI(message.body);
  await message.reply(aiReply);
});

// IPC: Sohbet dosyasını oku
ipcMain.handle('readChatFile', async () => {
  const filePath = path.join(__dirname, 'badi_sohbet.txt');
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content;
  } catch (err) {
    console.error('Dosya okunamadı:', err);
    return null;
  }
});

client.initialize();

// — JSON Soru-Cevap Yönetimi —
const dataFile = path.join(__dirname, 'questions.json');
function getQuestions() {
  return fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf-8')) : [];
}
function saveQuestions(arr) {
  fs.writeFileSync(dataFile, JSON.stringify(arr, null, 2));
}

// — IPC Handlers —

// Chat hafızasını sadece hafıza değişkeninden döndür (dosyayı tekrar yükleme)
ipcMain.handle('getChatMemory', () => {
  return chatHistory;
});

// Soruları al, ekle, sil
ipcMain.handle('getQuestions', () => getQuestions());
ipcMain.handle('addQuestion', (_e, { question, answer }) => {
  const list = getQuestions();
  list.push({ question, answer });
  saveQuestions(list);
  return true;
});
ipcMain.handle('deleteQuestion', (_e, { question }) => {
  const filtered = getQuestions().filter(q => q.question !== question);
  saveQuestions(filtered);
  return true;
});

// ChatGPT sorusu sor
ipcMain.handle('ask-chatgpt', async (event, userMessage) => {
  try {
    const aiResponse = await askOpenAI(userMessage);
    return aiResponse;
  } catch (error) {
    console.error('Chat geçmişi kaydedilirken bir hata oluştu:', error);
    return 'Üzgünüm, şu anda yardımcı olamıyorum.';
  }
});

// Hafızaya manuel mesaj eklemek istersen, genelde gerek yok
ipcMain.handle('saveChatMessage', async (_e, { role, content }) => {
  try {
    chatHistory.push({ role, content });
    saveChatHistory();
    return true;
  } catch (err) {
    console.error('saveChatMessage Hatası:', err);
    return false;
  }
});

// Chat penceresi açma
ipcMain.on('open-chat-window', () => {
  const chatWindow = new BrowserWindow({
    width: 400,
    height: 600,
    parent: mainWindow,
    modal: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  chatWindow.loadFile(path.join(__dirname, 'chat.html'));

  chatWindow.once('ready-to-show', () => {
    chatWindow.show();
  });
});

// Ana pencere oluşturma
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  mainWindow.loadFile('index.html');
}

// Uygulama hazır olunca hafızayı yükle ve pencereyi oluştur
app.whenReady().then(() => {
  loadChatHistory();   // <--- Hafıza sadece burada yükleniyor
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
