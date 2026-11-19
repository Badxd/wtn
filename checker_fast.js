const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');
const pino = require('pino');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Jis file vicho numbers lene ne (invalid.txt ya numbers.txt)
const SOURCE_FILE = 'invalid.txt'; 

async function startProcess() {
    if (!fs.existsSync(SOURCE_FILE)) {
        console.log(`❌ File nahi mili: ${SOURCE_FILE}`);
        process.exit(1);
    }

    let numbers = fs.readFileSync(SOURCE_FILE, 'utf-8')
        .split('\n')
        .map(n => n.trim().replace(/[^0-9]/g, ''))
        .filter(n => n.length > 5 && n.length < 16);

    if (numbers.length === 0) {
        console.log("✅ File vich koi number nahi hai.");
        process.exit(0);
    }

    console.log(`📁 Total numbers: ${numbers.length}`);

    for (let i = 0; i < numbers.length; i++) {
        const phoneNumber = numbers[i];
        console.log(`\n=========================================`);
        console.log(`📱 Processing Number ${i + 1}/${numbers.length}: ${phoneNumber}`);
        console.log(`=========================================`);

        const success = await tryRegister(phoneNumber);

        if (success) {
            console.log(`\n✅ Session saved for ${phoneNumber}. Moving to next...`);
            // Remove from list so we don't process it again
            numbers.splice(i, 1);
            fs.writeFileSync('remaining_invalid.txt', numbers.join('\n'));
            i--; // Adjust index because we removed an element
        } else {
            console.log(`\n⚠️ Failed or skipped ${phoneNumber}.`);
        }
        
        // 10 second rukko taaki WhatsApp IP block na kare
        await delay(10000); 
    }

    console.log("\n🎉 Saare numbers process ho gaye.");
    process.exit(0);
}

async function tryRegister(phoneNumber) {
    const sessionDir = `sessions/session_${phoneNumber}`;
    
    // Agar pehla hi session save hai, ta skip karo
    if (fs.existsSync(`${sessionDir}/creds.json`)) {
        console.log(`⏩ Session pehla hi exist karda hai. Skipping.`);
        return true;
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    
    return new Promise(async (resolve) => {
        let resolved = false;
        
        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: ['Ubuntu', 'Chrome', '110.0.0'],
            connectTimeoutMs: 60000
        });

        sock.ev.on('creds.update', saveCreds);

        // Timeout agar 2 minute vich connect nahi hoya
        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                console.log("❌ Timeout: Connect nahi hoya.");
                sock.end(undefined);
                resolve(false);
            }
        }, 120000);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'close') {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    resolve(false);
                }
            } else if (connection === 'open') {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    resolve(true);
                    // Socket close karo taaki next number chalu ho sake
                    setTimeout(() => sock.end(undefined), 2000); 
                }
            }
        });

        if (!sock.authState.creds.registered) {
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(phoneNumber);
                    console.log(`\n🔑 PAIR CODE: ${code}`);
                    console.log(`👉 WhatsApp kholo is number te -> Linked Devices -> Link with phone number -> Code paao.`);
                } catch (error) {
                    console.log(`❌ Pair code request fail: ${error.message}`);
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        sock.end(undefined);
                        resolve(false);
                    }
                }
            }, 3000);
        }
    });
}

startProcess();
