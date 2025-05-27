const { ipcRenderer, clipboard } = require('electron');
const QrCode = require('qrcode-reader');
const jimp = require('jimp');

// Global state
let accounts = [];
let updateInterval;

// Error handling helper
function showError(title, message) {
    console.error(title, message);
    alert(`${title}: ${message}`);
}

// UI Functions
function showAddModal() {
    try {
        document.getElementById('add-modal').style.display = 'block';
    } catch (err) {
        showError('UI Error', 'Failed to show add modal: ' + err.message);
    }
}

function hideAddModal() {
    try {
        document.getElementById('add-modal').style.display = 'none';
        // Clear inputs
        document.getElementById('account-name').value = '';
        document.getElementById('issuer').value = '';
        document.getElementById('secret').value = '';
        document.getElementById('qr-input').value = '';
        document.getElementById('drop-zone').classList.remove('drag-over');
    } catch (err) {
        showError('UI Error', 'Failed to hide add modal: ' + err.message);
    }
}

async function saveAccount() {
    try {
        const name = document.getElementById('account-name').value;
        const issuer = document.getElementById('issuer').value;
        const secret = document.getElementById('secret').value;

        if (!name || !secret) {
            showError('Validation Error', 'Account name and secret are required!');
            return;
        }

        await ipcRenderer.invoke('add-account', { name, issuer, secret });
        hideAddModal();
        await loadAccounts();
    } catch (error) {
        showError('Save Error', 'Failed to save account: ' + error.message);
    }
}

async function deleteAccount(id) {
    try {
        if (confirm('Are you sure you want to delete this account?')) {
            await ipcRenderer.invoke('delete-account', id);
            await loadAccounts();
        }
    } catch (error) {
        showError('Delete Error', 'Failed to delete account: ' + error.message);
    }
}

async function loadAccounts() {
    try {
        accounts = await ipcRenderer.invoke('get-accounts');
        await renderAccounts();
    } catch (error) {
        showError('Load Error', 'Failed to load accounts: ' + error.message);
    }
}

async function updateTOTPCodes() {
    try {
        for (const account of accounts) {
            try {
                const code = await ipcRenderer.invoke('generate-totp', account.secret);
                const codeElement = document.getElementById(`code-${account.id}`);
                if (codeElement) {
                    codeElement.textContent = code;
                }
            } catch (error) {
                console.error('Error generating TOTP for account:', account.name, error);
                const codeElement = document.getElementById(`code-${account.id}`);
                if (codeElement) {
                    codeElement.textContent = 'Error';
                    codeElement.style.color = '#ff453a';
                }
            }
        }
    } catch (error) {
        showError('TOTP Error', 'Failed to update TOTP codes: ' + error.message);
    }
}

async function renderAccounts() {
    try {
        const container = document.getElementById('accounts-list');
        if (!container) {
            throw new Error('Accounts list container not found');
        }

        container.innerHTML = '';

        if (accounts.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>No accounts added yet</p>
                    <p>Click "Add Account" to get started</p>
                </div>
            `;
            return;
        }

        accounts.forEach(account => {
            const card = document.createElement('div');
            card.className = 'account-card';
            card.innerHTML = `
                <div class="account-info">
                    <h3>${account.name}</h3>
                    ${account.issuer ? `<p>${account.issuer}</p>` : ''}
                </div>
                <div class="totp-code" id="code-${account.id}">------</div>
                <div class="action-buttons">
                    <button onclick="deleteAccount(${account.id})">Delete</button>
                </div>
            `;
            container.appendChild(card);
        });

        await updateTOTPCodes();
    } catch (error) {
        showError('Render Error', 'Failed to render accounts: ' + error.message);
    }
}

// QR Code processing
async function processQRCode(imageData) {
    try {
        const image = await jimp.read(imageData);
        const qr = new QrCode();
        
        return new Promise((resolve, reject) => {
            qr.callback = (err, value) => {
                if (err) {
                    reject(new Error('Could not read QR code'));
                    return;
                }
                
                try {
                    // Parse otpauth URI
                    const uri = value.result;
                    if (!uri.startsWith('otpauth://totp/')) {
                        throw new Error('Invalid QR code format');
                    }

                    const url = new URL(uri);
                    const label = decodeURIComponent(url.pathname.substring(1));
                    const secret = url.searchParams.get('secret');
                    const issuer = url.searchParams.get('issuer');

                    if (!secret) {
                        throw new Error('QR code missing secret key');
                    }

                    // Populate form fields
                    document.getElementById('account-name').value = label.split(':').pop() || label;
                    document.getElementById('issuer').value = issuer || '';
                    document.getElementById('secret').value = secret;
                    resolve();
                } catch (error) {
                    reject(new Error('Invalid QR code format: ' + error.message));
                }
            };

            qr.decode(image.bitmap);
        });
    } catch (error) {
        throw new Error('Error processing image: ' + error.message);
    }
}

// File input handling
document.getElementById('qr-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
        await processQRCode(await file.arrayBuffer());
    } catch (error) {
        showError('QR Code Error', error.message);
    }
});

// Drag and drop handling
const dropZone = document.getElementById('drop-zone');

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');

    try {
        const items = e.dataTransfer.items;
        
        for (let item of items) {
            if (item.type.startsWith('image/')) {
                const file = item.getAsFile();
                await processQRCode(await file.arrayBuffer());
                return;
            }
        }
        throw new Error('No image found in dropped items');
    } catch (error) {
        showError('Drop Error', error.message);
    }
});

// Clipboard paste handling
document.addEventListener('paste', async (e) => {
    try {
        const items = e.clipboardData.items;
        
        for (let item of items) {
            if (item.type.startsWith('image/')) {
                const file = item.getAsFile();
                await processQRCode(await file.arrayBuffer());
                return;
            }
        }
    } catch (error) {
        showError('Paste Error', error.message);
    }
});

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log('DOM loaded, initializing app...');
        await loadAccounts();
        
        // Update TOTP codes every 30 seconds
        updateInterval = setInterval(() => {
            updateTOTPCodes().catch(error => {
                console.error('Error in TOTP update interval:', error);
            });
        }, 30000);

        console.log('App initialized successfully');
    } catch (error) {
        showError('Initialization Error', 'Failed to initialize app: ' + error.message);
    }
});

// Cleanup
window.addEventListener('beforeunload', () => {
    if (updateInterval) {
        clearInterval(updateInterval);
    }
}); 