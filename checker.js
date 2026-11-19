const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');
const pino = require('pino');

// numbers.txt file read karein
const numbers = fs.readFileSync('numbers.txt', 'utf-8')
    .split('\n')
    .map(n => n.trim())
    .filter(n => n.length > 0);

// Delay function (rate limit se bachne ke liye)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }), // Terminal mein extra logs na dikhayein
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnecting...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Connected! Checking numbers shuru ho raha hai...');
            await checkNumbers(sock);
        }
    });
}

async function checkNumbers(sock) {
    let validNumbers = [];
    let invalidNumbers = [];

    for (let i = 0; i < numbers.length; i++) {
        const phoneNumber = numbers[i];
        // JID format: number@s.whatsapp.net
        const jid = `${phoneNumber}@s.whatsapp.net`;

        try {
            const [result] = await sock.onWhatsApp(jid);
            
            if (result && result.exists) {
                validNumbers.push(phoneNumber);
                console.log(`[${i + 1}/${numbers.length}] ✅ ${phoneNumber} -> REGISTERED`);
            } else {
                invalidNumbers.push(phoneNumber);
                console.log(`[${i + 1}/${numbers.length}] ❌ ${phoneNumber} -> NOT REGISTERED`);
            }

        } catch (error) {
            console.error(`[${i + 1}/${numbers.length}] ⚠️ Error checking ${phoneNumber}:`, error.message);
            invalidNumbers.push(phoneNumber); // Error ko invalid maan lete hain
        }

        // 🔴 RATE LIMITING: Har number ke beech 3 se 7 second ka random delay
        if (i < numbers.length - 1) {
            const randomDelay = Math.floor(Math.random() * 4000) + 3000; // 3000ms - 7000ms
            console.log(`   Waiting ${randomDelay / 1000}s...`);
            await delay(randomDelay);
        }
    }

    // Results ko files mein save karein
    fs.writeFileSync('valid_numbers.txt', validNumbers.join('\n'));
    fs.writeFileSync('invalid_numbers.txt', invalidNumbers.join('\n'));

    console.log('\n--- ✅ CHECK COMPLETE ---');
    console.log(`Total Checked: ${numbers.length}`);
    console.log(`Registered: ${validNumbers.length}`);
    console.log(`Not Registered: ${invalidNumbers.length}`);
    console.log('Results saved to: valid_numbers.txt and invalid_numbers.txt');
}

// Script start karein
connectToWhatsApp();
