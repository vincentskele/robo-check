document.addEventListener("DOMContentLoaded", function () {
    console.log("✅ DOM fully loaded. Initializing script...");

    const verificationForm = document.getElementById('verificationForm');
    const resultBox = document.getElementById('verificationResult');
    const discordInput = document.getElementById('discordId');
    const twitterInput = document.getElementById('twitterHandle');
    const walletInput = document.getElementById('walletAddress');
    const walletSelect = document.getElementById('walletSelect');
    const linkedWalletsPanel = document.getElementById('linkedWalletsPanel');
    const walletList = document.getElementById('walletList');
    const accountSummaryText = document.getElementById('accountSummaryText');
    const addAnotherWalletButton = document.getElementById('addAnotherWalletButton');
    const confirmOverlay = document.getElementById('confirmOverlay');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmProceedButton = document.getElementById('confirmProceedButton');
    const confirmCancelButton = document.getElementById('confirmCancelButton');
    const addWalletOverlay = document.getElementById('addWalletOverlay');
    const addWalletAddressInput = document.getElementById('addWalletAddressInput');
    const addWalletSelect = document.getElementById('addWalletSelect');
    const addWalletResult = document.getElementById('addWalletResult');
    const addWalletSubmitButton = document.getElementById('addWalletSubmitButton');
    const addWalletCloseButton = document.getElementById('addWalletCloseButton');
    const addWalletStatus = document.getElementById('addWalletStatus');
    const addWalletStatusText = document.getElementById('addWalletStatusText');

    if (!verificationForm) {
        console.error("❌ Error: 'verificationForm' element not found in the DOM!");
        return;
    }

    let vanityAddress = "";
    let accountToken = "";
    let linkedAccount = null;
    let confirmHandler = null;
    let pendingAdditionalWalletAddress = '';

    const discordIdPattern = /^\d{17,20}$/;
    const twitterPattern = /^[A-Za-z0-9_]{1,15}$/;
    const solanaAddressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

    function setResult(html) {
        if (resultBox) resultBox.innerHTML = html;
    }

    function setPanelVisibility(isVisible) {
        if (!linkedWalletsPanel) return;
        linkedWalletsPanel.classList.toggle('hidden', !isVisible);
    }

    function getAccountHeaders() {
        return accountToken
            ? {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accountToken}`,
            }
            : { 'Content-Type': 'application/json' };
    }

    function getSortedWallets(account) {
        const wallets = Array.isArray(account?.wallets) ? [...account.wallets] : [];
        return wallets.sort((left, right) => {
            if (Boolean(left?.isPrimary) !== Boolean(right?.isPrimary)) {
                return left?.isPrimary ? -1 : 1;
            }
            return String(left?.walletAddress || '').localeCompare(String(right?.walletAddress || ''));
        });
    }

    function populateWalletSelect(selectEl, wallets, preferredValue = '') {
        if (!selectEl) return;
        const sortedWallets = getSortedWallets({ wallets });
        selectEl.innerHTML = '<option value="">Custom wallet</option>';
        sortedWallets.forEach((wallet) => {
            const option = document.createElement('option');
            option.value = wallet.walletAddress;
            option.textContent = wallet.isPrimary
                ? `Primary: ${wallet.walletAddress}`
                : `Linked: ${wallet.walletAddress}`;
            selectEl.appendChild(option);
        });
        selectEl.classList.toggle('hidden', sortedWallets.length === 0);
        selectEl.value = preferredValue && sortedWallets.some((wallet) => wallet.walletAddress === preferredValue)
            ? preferredValue
            : '';
    }

    function applyWalletSelection(selectEl, inputEl, hintValue = '') {
        if (!selectEl || !inputEl) return;
        const selectedWallet = String(selectEl.value || '').trim();
        if (selectedWallet) {
            inputEl.value = selectedWallet;
            inputEl.readOnly = true;
        } else {
            inputEl.readOnly = false;
            if (hintValue === 'clear') {
                inputEl.value = '';
            }
        }
    }

    function renderWalletList(account) {
        if (!walletList) return;

        const wallets = Array.isArray(account?.wallets) ? account.wallets : [];
        if (!wallets.length) {
            walletList.innerHTML = `<div class="wallet-card empty-wallet-card">No linked wallets yet. Verify one below to get started.</div>`;
            return;
        }

        walletList.innerHTML = '';
        wallets.forEach((wallet) => {
            const card = document.createElement('div');
            card.className = 'wallet-card';
            card.innerHTML = `
                <div class="wallet-card-header">
                    <div>
                        <div class="wallet-card-title">${wallet.isPrimary ? 'Primary Wallet' : 'Linked Wallet'}</div>
                        <div class="wallet-address">${wallet.walletAddress}</div>
                    </div>
                </div>
                <div class="wallet-card-actions"></div>
            `;

            const actions = card.querySelector('.wallet-card-actions');
            if (actions && !wallet.isPrimary) {
                const primaryButton = document.createElement('button');
                primaryButton.type = 'button';
                primaryButton.className = 'secondary-button compact-button';
                primaryButton.textContent = 'Set Primary Wallet';
                primaryButton.addEventListener('click', async () => {
                    try {
                        primaryButton.disabled = true;
                        const response = await fetch('/api/account/primary-wallet', {
                            method: 'PUT',
                            headers: getAccountHeaders(),
                            body: JSON.stringify({ walletAddress: wallet.walletAddress }),
                        });
                        const payload = await response.json();
                        if (!response.ok) throw new Error(payload.error || 'Failed to update primary wallet.');
                        linkedAccount = payload.account;
                        hydrateAccountUi(linkedAccount);
                        setResult('<p>✅ Primary wallet updated.</p>');
                    } catch (error) {
                        setResult(`<p>❌ ${error.message}</p>`);
                    } finally {
                        primaryButton.disabled = false;
                    }
                });
                actions.appendChild(primaryButton);
            }

            const unlinkButton = document.createElement('button');
            unlinkButton.type = 'button';
            unlinkButton.className = 'danger-button compact-button';
            unlinkButton.textContent = 'Unlink Wallet';
            unlinkButton.addEventListener('click', () => {
                openConfirmation(
                    `Unlink wallet ${wallet.walletAddress}?`,
                    async () => {
                        try {
                            unlinkButton.disabled = true;
                            const response = await fetch(`/api/account/wallet/${encodeURIComponent(wallet.walletAddress)}`, {
                                method: 'DELETE',
                                headers: getAccountHeaders(),
                            });
                            const payload = await response.json();
                            if (!response.ok) throw new Error(payload.error || 'Failed to unlink wallet.');
                            linkedAccount = payload.account;
                            hydrateAccountUi(linkedAccount);
                            setResult('<p>✅ Wallet unlinked.</p>');
                        } catch (error) {
                            setResult(`<p>❌ ${error.message}</p>`);
                        } finally {
                            unlinkButton.disabled = false;
                        }
                    }
                );
            });
            actions.appendChild(unlinkButton);
            walletList.appendChild(card);
        });
    }

    function hydrateAccountUi(account) {
        linkedAccount = account;
        setPanelVisibility(Boolean(accountToken));

        const walletCount = Array.isArray(account?.wallets) ? account.wallets.length : 0;
        if (accountSummaryText) {
            accountSummaryText.textContent = walletCount
                ? `Discord connected. ${walletCount} wallet${walletCount === 1 ? '' : 's'} linked. Pick a primary wallet for Volt and redemption flows.`
                : 'Discord connected. No linked wallets yet. Add one below to start verification.';
        }

        if (twitterInput && !twitterInput.value) {
            twitterInput.value = account?.twitterHandle || '';
        }
        if (discordInput && account?.discordId) {
            discordInput.value = account.discordId;
        }
        if (walletInput) {
            walletInput.value = '';
            walletInput.readOnly = false;
        }
        populateWalletSelect(walletSelect, account?.wallets || [], account?.primaryWalletAddress || account?.walletAddress || '');
        applyWalletSelection(walletSelect, walletInput);

        renderWalletList(account);
    }

    function openConfirmation(message, onConfirm) {
        if (!confirmOverlay || !confirmMessage || !confirmProceedButton) return;
        confirmMessage.textContent = message;
        confirmHandler = async () => {
            closeConfirmation();
            await onConfirm();
        };
        confirmOverlay.classList.remove('hidden');
        confirmOverlay.setAttribute('aria-hidden', 'false');
    }

    function closeConfirmation() {
        if (!confirmOverlay) return;
        confirmOverlay.classList.add('hidden');
        confirmOverlay.setAttribute('aria-hidden', 'true');
        confirmHandler = null;
    }

    function setAddWalletResult(html = '') {
        if (!addWalletResult) return;
        addWalletResult.innerHTML = html;
        addWalletResult.classList.toggle('hidden', !html);
    }

    function setAddWalletStatus({ visible = false, complete = false, text = '' } = {}) {
        if (!addWalletStatus) return;
        addWalletStatus.classList.toggle('hidden', !visible);
        addWalletStatus.classList.toggle('is-complete', Boolean(complete));
        if (addWalletStatusText) {
            addWalletStatusText.textContent = text || (complete ? 'Verification complete' : 'Waiting for payment...');
        }
    }

    function openAddWalletModal() {
        if (!addWalletOverlay) return;
        setAddWalletResult('');
        setAddWalletStatus({ visible: false });
        if (addWalletAddressInput) {
            addWalletAddressInput.value = '';
            addWalletAddressInput.readOnly = false;
        }
        populateWalletSelect(addWalletSelect, linkedAccount?.wallets || [], '');
        pendingAdditionalWalletAddress = '';
        if (addWalletSubmitButton) {
            addWalletSubmitButton.disabled = false;
            addWalletSubmitButton.classList.remove('hidden');
        }
        addWalletOverlay.classList.remove('hidden');
        addWalletOverlay.setAttribute('aria-hidden', 'false');
        addWalletAddressInput?.focus();
    }

    function closeAddWalletModal() {
        if (!addWalletOverlay) return;
        addWalletOverlay.classList.add('hidden');
        addWalletOverlay.setAttribute('aria-hidden', 'true');
        setAddWalletResult('');
        setAddWalletStatus({ visible: false });
        pendingAdditionalWalletAddress = '';
    }

    async function submitAdditionalWalletVerification() {
        const discordId = String(discordInput?.value || linkedAccount?.discordId || '').trim();
        let twitterHandle = String(linkedAccount?.twitterHandle || twitterInput?.value || '').trim().replace(/^@+/, '');
        const walletAddress = String(addWalletAddressInput?.value || '').trim();

        if (!discordIdPattern.test(discordId)) {
            setAddWalletResult('<p>❌ Please link your Discord account first.</p>');
            return;
        }

        if (twitterHandle && !twitterPattern.test(twitterHandle)) {
            setAddWalletResult('<p>❌ Your current X username is invalid. Update it in your Volt profile first.</p>');
            return;
        }

        if (!solanaAddressPattern.test(walletAddress)) {
            setAddWalletResult('<p>❌ Invalid Solana wallet address.</p>');
            return;
        }

        try {
            if (addWalletSubmitButton) addWalletSubmitButton.disabled = true;
            const response = await fetch('/payment-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ discordId, twitterHandle, walletAddress })
            });

            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.error || response.statusText || 'Failed to generate verification.');
            }

            const displayAddress = vanityAddress || payload.receivingAddress;
            pendingAdditionalWalletAddress = walletAddress;
            setAddWalletResult(`
                <p><strong>Verification Generated</strong></p>
                <p>Amount to send: <strong>${payload.amount} SOL</strong></p>
                <p>Send to wallet: <strong>${displayAddress}</strong></p>
                <p>Expires at: <strong>${new Date(payload.expiresAt).toLocaleString()}</strong></p>
                <p>Please send the exact amount from <strong>${walletAddress}</strong> before expiration.</p>
            `);
            setAddWalletStatus({
                visible: true,
                complete: false,
                text: 'Waiting for payment...',
            });
            if (addWalletAddressInput) {
                addWalletAddressInput.readOnly = true;
            }
            if (addWalletSubmitButton) {
                addWalletSubmitButton.classList.add('hidden');
            }
            setResult('<p>📝 Additional wallet verification created. Complete the payment shown in the popup.</p>');
        } catch (error) {
            setAddWalletResult(`<p>❌ ${error.message}</p>`);
        } finally {
            if (addWalletSubmitButton && !pendingAdditionalWalletAddress) addWalletSubmitButton.disabled = false;
        }
    }

    async function fetchVanityAddress() {
        try {
            const response = await fetch('/api/address');
            const data = await response.json();
            vanityAddress = data.address;
        } catch (error) {
            console.error("❌ Error fetching vanity address:", error);
        }
    }

    async function loadAccount() {
        if (!accountToken) {
            setPanelVisibility(false);
            return;
        }

        try {
            const response = await fetch('/api/account', {
                headers: { Authorization: `Bearer ${accountToken}` },
            });
            const account = await response.json();
            if (!response.ok) throw new Error(account.error || 'Failed to load linked wallets.');
            hydrateAccountUi(account);
        } catch (error) {
            console.error('❌ Error loading account:', error);
            if (/Unauthorized|Missing account token|expired/i.test(String(error.message || ''))) {
                accountToken = '';
                window.localStorage.removeItem('roboCheckAccountToken');
            }
            setResult(`<p>❌ ${error.message}</p>`);
            setPanelVisibility(false);
        }
    }

    const discordLinkButton = document.getElementById('discordLinkButton');
    if (discordLinkButton) {
        discordLinkButton.addEventListener('click', () => {
            window.location.href = '/auth/discord';
        });
    }

    confirmProceedButton?.addEventListener('click', async () => {
        if (confirmHandler) await confirmHandler();
    });
    confirmCancelButton?.addEventListener('click', closeConfirmation);
    confirmOverlay?.addEventListener('click', (event) => {
        if (event.target === confirmOverlay) closeConfirmation();
    });

    addAnotherWalletButton?.addEventListener('click', () => {
        openAddWalletModal();
    });
    walletSelect?.addEventListener('change', () => {
        applyWalletSelection(walletSelect, walletInput, 'clear');
    });
    addWalletSelect?.addEventListener('change', () => {
        applyWalletSelection(addWalletSelect, addWalletAddressInput, 'clear');
    });
    addWalletSubmitButton?.addEventListener('click', submitAdditionalWalletVerification);
    addWalletCloseButton?.addEventListener('click', closeAddWalletModal);
    addWalletOverlay?.addEventListener('click', (event) => {
        if (event.target === addWalletOverlay) closeAddWalletModal();
    });

    const urlParams = new URLSearchParams(window.location.search);
    const linkedDiscordId = urlParams.get('discordId');
    const linkedAccountToken = urlParams.get('accountToken');
    if (linkedDiscordId && discordInput) {
        discordInput.value = linkedDiscordId;
    }
    if (linkedAccountToken) {
        accountToken = linkedAccountToken;
        window.localStorage.setItem('roboCheckAccountToken', linkedAccountToken);
    } else {
        accountToken = window.localStorage.getItem('roboCheckAccountToken') || '';
    }
    if (linkedDiscordId || linkedAccountToken) {
        setResult('<p>✅ Discord account linked.</p>');
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('discordId');
        cleanUrl.searchParams.delete('accountToken');
        window.history.replaceState({}, document.title, cleanUrl.pathname + cleanUrl.search);
    }

    fetchVanityAddress();
    loadAccount();

    verificationForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        const submitButton = this.querySelector("button[type='submit']");
        submitButton.disabled = true;

        const discordId = String(discordInput?.value || '').trim();
        let twitterHandle = String(twitterInput?.value || '').trim().replace(/^@+/, '');
        const walletAddress = String(walletInput?.value || '').trim();

        if (!discordIdPattern.test(discordId)) {
            setResult(`<p>❌ Invalid Discord ID. Must be 17-20 digits.</p>`);
            submitButton.disabled = false;
            return;
        }

        if (twitterHandle && !twitterPattern.test(twitterHandle)) {
            setResult(`<p>❌ Invalid X Username. Only letters, numbers, and underscores allowed (max 15 chars).</p>`);
            submitButton.disabled = false;
            return;
        }

        if (!solanaAddressPattern.test(walletAddress)) {
            setResult(`<p>❌ Invalid Solana Wallet Address. Must be 32-44 characters long and base58 encoded.</p>`);
            submitButton.disabled = false;
            return;
        }

        if (!twitterHandle && linkedAccount?.twitterHandle) {
            twitterHandle = linkedAccount.twitterHandle;
        }

        try {
            const response = await fetch('/payment-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ discordId, twitterHandle, walletAddress })
            });

            const payload = await response.json();
            if (!response.ok) {
                setResult(`<p>❌ Error: ${payload.error || response.statusText}</p>`);
                submitButton.disabled = false;
                return;
            }

            const displayAddress = vanityAddress || payload.receivingAddress;
            setResult(`
                <p><strong>Verification Generated</strong></p>
                <p>Amount to send: <strong>${payload.amount} SOL</strong></p>
                <p>Send to wallet: <strong>${displayAddress}</strong></p>
                <p>Expires at: <strong>${new Date(payload.expiresAt).toLocaleString()}</strong></p>
                <p>Please send the exact amount from <strong>${walletAddress}</strong> before expiration.</p>
            `);
        } catch (error) {
            setResult(`<p>❌ An error occurred: ${error.message}</p>`);
            console.error("❌ Verification Error:", error);
        }

        submitButton.disabled = false;
    });

    const socket = new WebSocket("ws://localhost:4000");

    socket.addEventListener("open", () => {
        console.log("✅ WebSocket connected. Listening for payment confirmations...");
    });

    socket.addEventListener("message", async (event) => {
        const data = JSON.parse(event.data);
        const currentDiscordId = String(discordInput?.value || '').trim();

        if (data.status === "confirmed" && data.walletAddress && String(data.discordId || '') === currentDiscordId) {
            setResult(`
                <p>✅ <strong>Confirmed!</strong></p>
                <p>Your transaction of <strong>${data.amount} SOL</strong> has been successfully received.</p>
                <p>Wallet <strong>${data.walletAddress}</strong> is now linked. Please allow 15-45 minutes for roles to update.</p>
            `);
            if (
                addWalletOverlay &&
                !addWalletOverlay.classList.contains('hidden') &&
                pendingAdditionalWalletAddress &&
                String(data.walletAddress).trim().toLowerCase() === pendingAdditionalWalletAddress.trim().toLowerCase()
            ) {
                setAddWalletStatus({
                    visible: true,
                    complete: true,
                    text: 'Verification complete',
                });
                setAddWalletResult(`
                    <p><strong>Verification Complete</strong></p>
                    <p>Wallet <strong>${data.walletAddress}</strong> is now linked to your Discord account.</p>
                `);
            }
            await loadAccount();
        }
    });

    socket.addEventListener("close", () => {
        console.log("❌ WebSocket connection closed.");
    });

    socket.addEventListener("error", (error) => {
        console.error("❌ WebSocket Error:", error);
    });
});
