/**
 * Settle Agent - Dedicated Merchant Dashboard
 * Full authentication guard, live data polling & Solana execution
 */

// Intercept all fetch requests to inject JWT auth header
(function() {
  const originalFetch = window.fetch;
  window.fetch = async (url, options = {}) => {
    const token = localStorage.getItem('settle_agent_token');
    if (token) {
      options.headers = options.headers || {};
      if (!(options.headers instanceof Headers)) {
        options.headers['Authorization'] = `Bearer ${token}`;
      } else {
        options.headers.set('Authorization', `Bearer ${token}`);
      }
    }
    return originalFetch(url, options);
  };
})();

const STATE = {
  token: localStorage.getItem('settle_agent_token') || null,
  merchant: null,
  products: [],
  pendingReorders: [],
  allReorders: [],
  stats: null,
  wallet: null,
  logs: [],
  telegramMessages: [],
  pollingInterval: null
};

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  setupEventListeners();
  await verifySessionAndInit();
});

// Theme Management
function initTheme() {
  const savedTheme = localStorage.getItem('settle_theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);

  document.getElementById('btn-dash-theme-toggle')?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('settle_theme', next);
  });
}

// Session Verification & Auth Guard
async function verifySessionAndInit() {
  if (!STATE.token) {
    window.location.replace('/login');
    return;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${STATE.token}` }
    });
    const data = await res.json();

    if (!data.success || !data.merchant) {
      // Invalid or expired token
      localStorage.removeItem('settle_agent_token');
      window.location.replace('/login');
      return;
    }

    STATE.merchant = data.merchant;
    renderMerchantProfile(data.merchant);

    // Initial data fetch & polling
    await loadAllData();
    startPolling();
  } catch (err) {
    console.error('Session verification failed:', err);
    // On network error or server disconnect, redirect to login
    localStorage.removeItem('settle_agent_token');
    window.location.replace('/login');
  }
}

function renderMerchantProfile(merchant) {
  const avatarEl = document.getElementById('user-avatar-initial');
  if (avatarEl && merchant.name) {
    avatarEl.textContent = merchant.name.charAt(0).toUpperCase();
  }
}

function setupEventListeners() {
  // Sidebar navigation
  document.querySelectorAll('.nav-side-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-side-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.getAttribute('data-dash-tab');

      // Hide all panes
      document.querySelectorAll('.dash-view-pane').forEach(p => p.style.display = 'none');

      const titleEl = document.getElementById('dash-heading-title');

      if (tab === 'overview') {
        document.getElementById('pane-dashboard').style.display = 'block';
        if (titleEl) titleEl.textContent = 'Dashboard';
      } else if (tab === 'inventory') {
        document.getElementById('pane-inventory').style.display = 'block';
        if (titleEl) titleEl.textContent = 'Inventory & Stock Buffer';
      } else if (tab === 'suppliers') {
        document.getElementById('pane-suppliers').style.display = 'block';
        if (titleEl) titleEl.textContent = 'Suppliers & Corridors';
      } else {
        document.getElementById('pane-dashboard').style.display = 'block';
        if (titleEl) titleEl.textContent = 'Dashboard';
      }
    });
  });

  // Wallet Faucet Airdrop Button
  document.getElementById('btn-wallet-airdrop')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-wallet-airdrop');
    btn.disabled = true;
    btn.textContent = 'Requesting SOL...';
    try {
      const res = await fetch('/api/wallet/airdrop', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        await fetchWallet();
      } else {
        alert(data.error || 'Airdrop rate-limited.');
      }
    } catch (e) {
      alert(`Error: ${e.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = '+ Request 1 SOL Faucet';
    }
  });

  // Timeframe selector
  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Logout button
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    localStorage.removeItem('settle_agent_token');
    window.location.replace('/login');
  });

  // Quick SOL Faucet Trigger
  document.getElementById('btn-quick-sol-faucet')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const btn = document.getElementById('btn-quick-sol-faucet');
    btn.disabled = true;
    btn.textContent = '...';
    try {
      const res = await fetch('/api/wallet/airdrop', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        await fetchWallet();
      }
    } catch (e) {
      console.warn('Airdrop request failed:', e);
    } finally {
      btn.disabled = false;
      btn.textContent = '+1 SOL';
    }
  });

  // Force Agent Scan Buttons
  document.querySelectorAll('#btn-force-scan').forEach(btn => {
    btn.addEventListener('click', handleForceScan);
  });

  // Modal Closes
  document.getElementById('btn-close-modal')?.addEventListener('click', closeModal);
  document.getElementById('modal-done-btn')?.addEventListener('click', closeModal);

  // --- FUND USDC POSITION MODAL ---
  const fundModal = document.getElementById('fund-usdc-modal');
  const openFundModal = () => {
    if (STATE.wallet?.merchant?.publicKey) {
      const addrEl = document.getElementById('deposit-wallet-address');
      if (addrEl) addrEl.textContent = STATE.wallet.merchant.publicKey;
    }
    fundModal?.classList.add('active');
  };

  const closeFundModal = () => fundModal?.classList.remove('active');

  document.getElementById('btn-header-fund-usdc')?.addEventListener('click', openFundModal);
  document.getElementById('btn-card-fund-usdc')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openFundModal();
  });
  document.getElementById('btn-close-fund-modal')?.addEventListener('click', closeFundModal);
  document.getElementById('btn-cancel-fund')?.addEventListener('click', closeFundModal);

  // Quick Amount Selectors
  document.querySelectorAll('.btn-amt-select').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-amt-select').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const amt = btn.getAttribute('data-amt');
      const customInput = document.getElementById('fund-custom-amount');
      if (customInput && amt) customInput.value = amt;
    });
  });

  // Confirm Deposit & Fund USDC
  document.getElementById('btn-confirm-fund')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirm-fund');
    const amountInput = document.getElementById('fund-custom-amount');
    const paymentMethodEl = document.getElementById('fund-payment-method');
    const amount = Number(amountInput?.value || 1000);
    const paymentMethod = paymentMethodEl?.value || 'Direct On-Chain Transfer';

    if (amount <= 0) {
      alert('Please enter an amount greater than $0');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Crediting Treasury...';

    try {
      const res = await fetch('/api/wallet/fund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, paymentMethod })
      });
      const data = await res.json();

      if (data.success) {
        closeFundModal();
        await loadAllData();
      } else {
        alert(data.error || 'Funding failed');
      }
    } catch (err) {
      alert(`Funding error: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Deposit & Credit USDC';
    }
  });
  // --- SANDBOX/LIVE MODE SWITCHER ---
  const sandboxBtn = document.getElementById('toggle-mode-sandbox');
  const liveBtn = document.getElementById('toggle-mode-live');
  const sandboxPanel = document.getElementById('dashboard-sandbox-panel');
  const mainnetModal = document.getElementById('mainnet-restricted-modal');

  sandboxBtn?.addEventListener('click', async () => {
    STATE.isLive = false;

    // Set active styles for Sandbox
    sandboxBtn.classList.add('active');
    sandboxBtn.style.background = 'var(--solana-green)';
    sandboxBtn.style.color = '#0c0d12';

    // Set inactive styles for Live
    liveBtn?.classList.remove('active');
    if (liveBtn) {
      liveBtn.style.background = 'transparent';
      liveBtn.style.color = 'var(--text-dim)';
    }

    // Show panel
    if (sandboxPanel) {
      sandboxPanel.style.display = 'flex';
    }

    await loadAllData();
  });

  liveBtn?.addEventListener('click', () => {
    // Show mainnet restricted modal instead of toggling
    mainnetModal?.classList.add('active');
  });

  const closeMainnetModal = () => {
    mainnetModal?.classList.remove('active');
  };

  document.getElementById('btn-close-mainnet-modal-x')?.addEventListener('click', closeMainnetModal);
  document.getElementById('btn-close-mainnet-modal-cancel')?.addEventListener('click', closeMainnetModal);
  document.getElementById('btn-close-mainnet-modal-confirm')?.addEventListener('click', closeMainnetModal);

  // --- SANDBOX TESTING CONTROLS ---
  // Sandbox Fund USDC
  document.getElementById('sandbox-btn-fund-usdc')?.addEventListener('click', async () => {
    const btn = document.getElementById('sandbox-btn-fund-usdc');
    btn.disabled = true;
    btn.textContent = 'Funding...';
    
    try {
      const res = await fetch('/api/wallet/fund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 10000, paymentMethod: 'Testing Sandbox Faucet' })
      });
      const data = await res.json();
      if (data.success) {
        await loadAllData();
      } else {
        alert(data.error || 'Funding failed');
      }
    } catch (err) {
      alert(`Funding error: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Instantly Fund $10,000 USDC';
    }
  });

  // Sandbox Deplete Stock & Scan
  document.getElementById('sandbox-btn-deplete-stock')?.addEventListener('click', async () => {
    const btn = document.getElementById('sandbox-btn-deplete-stock');
    if (!STATE.products || STATE.products.length === 0) {
      alert('No products available to deplete. Please add a product first.');
      return;
    }
    
    btn.disabled = true;
    btn.textContent = 'Depleting...';
    
    try {
      // Find a product that has stock > 0, otherwise just use the first product
      const product = STATE.products.find(p => p.current_stock > 0) || STATE.products[0];
      
      // 1. Deplete the stock by selling the current_stock
      const sellQty = Math.max(1, product.current_stock);
      btn.textContent = 'Creating Stock Sale...';
      const sellRes = await fetch('/api/inventory/sell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id, quantity: sellQty })
      });
      const sellData = await sellRes.json();
      
      if (!sellData.success) {
        throw new Error(sellData.error || 'Failed to trigger stock depletion');
      }
      
      // 2. Force an inventory scan to trigger a reorder request
      btn.textContent = 'Scanning Inventory...';
      const scanRes = await fetch('/api/reorders/scan', { method: 'POST' });
      const scanData = await scanRes.json();
      
      alert(`Successfully depleted stock for "${product.name}" and generated a new reorder request proposal!`);
      await loadAllData();
    } catch (err) {
      alert(`Sandbox Action Failed: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Deplete Stock & Request';
    }
  });

  // Sandbox Copy Public Key
  document.getElementById('sandbox-btn-copy-pubkey')?.addEventListener('click', () => {
    const txt = document.getElementById('sandbox-pubkey-txt').textContent;
    navigator.clipboard.writeText(txt).then(() => {
      alert('Merchant Solana Address copied to clipboard!');
    }).catch(err => {
      console.error('Failed to copy address:', err);
    });
  });
  // --- ADD INVENTORY PRODUCT MODAL ---
  const prodModal = document.getElementById('add-product-modal');
  const openProdModal = () => prodModal?.classList.add('active');
  const closeProdModal = () => {
    prodModal?.classList.remove('active');
    document.getElementById('form-add-product')?.reset();
  };

  document.getElementById('btn-open-add-product')?.addEventListener('click', openProdModal);
  document.getElementById('btn-inventory-add-product')?.addEventListener('click', openProdModal);
  document.getElementById('btn-close-product-modal')?.addEventListener('click', closeProdModal);
  document.getElementById('btn-cancel-product')?.addEventListener('click', closeProdModal);

  document.getElementById('form-add-product')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-submit-add-product');
    const name = document.getElementById('add-prod-name').value;
    const sku = document.getElementById('add-prod-sku').value;
    const category = document.getElementById('add-prod-category').value;
    const currentStock = Number(document.getElementById('add-prod-stock').value);
    const minThreshold = Number(document.getElementById('add-prod-threshold').value);
    const reorderQuantity = Number(document.getElementById('add-prod-reorder-qty').value);
    const unitCostUsdc = Number(document.getElementById('add-prod-cost').value);
    const supplierId = document.getElementById('add-prod-supplier').value;

    btn.disabled = true;
    btn.textContent = 'Adding to Inventory...';

    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          sku,
          category,
          currentStock,
          minThreshold,
          reorderQuantity,
          unitCostUsdc,
          supplierId
        })
      });
      const data = await res.json();

      if (data.success) {
        closeProdModal();
        await loadAllData();
      } else {
        alert(data.error || 'Failed to add product');
      }
    } catch (err) {
      alert(`Error creating product: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Add Product to Inventory';
    }
  });

  // --- ADD SUPPLIER MODAL ---
  const suppModal = document.getElementById('add-supplier-modal');
  const openSuppModal = () => suppModal?.classList.add('active');
  const closeSuppModal = () => {
    suppModal?.classList.remove('active');
    document.getElementById('form-add-supplier')?.reset();
  };

  const suppCountrySelect = document.getElementById('add-supp-country');
  const suppBankSelect = document.getElementById('add-supp-bank-name');
  const suppAcctLabel = document.getElementById('lbl-add-supp-acct');
  const suppAcctInput = document.getElementById('add-supp-account-num');
  const suppCorridorNotice = document.getElementById('modal-corridor-notice');

  function updateSupplierModalFields() {
    const country = suppCountrySelect?.value || 'Nigeria';
    if (!suppBankSelect) return;

    if (country === 'Nigeria') {
      suppBankSelect.innerHTML = `
        <option value="Access Bank">Access Bank (NIBSS Instant)</option>
        <option value="Zenith Bank">Zenith Bank Nigeria</option>
        <option value="GTBank">Guaranty Trust Bank (GTBank)</option>
        <option value="United Bank for Africa (UBA)">United Bank for Africa (UBA)</option>
        <option value="First Bank of Nigeria">First Bank of Nigeria</option>
        <option value="Stanbic IBTC">Stanbic IBTC Bank</option>
        <option value="Kuda MFB">Kuda Microfinance Bank</option>
      `;
      if (suppAcctLabel) suppAcctLabel.textContent = 'Bank Account Number *';
      if (suppAcctInput) suppAcctInput.placeholder = '10-digit NUBAN Account';
      if (suppCorridorNotice) {
        suppCorridorNotice.style.backgroundColor = 'rgba(34, 197, 94, 0.08)';
        suppCorridorNotice.style.borderColor = 'rgba(34, 197, 94, 0.25)';
        suppCorridorNotice.style.color = '#22c55e';
        suppCorridorNotice.innerHTML = '✦ <strong>Launch Settlement Rail:</strong> Solana USDC restock payments are automatically converted to Naira (NGN) and deposited instantly via Nigerian NIBSS interbank rails.';
      }
    } else if (country === 'Ghana') {
      suppBankSelect.innerHTML = `
        <option value="MTN Mobile Money">MTN MoMo (Ghana)</option>
        <option value="Telecel Cash">Telecel Cash</option>
        <option value="AT Money">AT Money (AirtelTigo)</option>
        <option value="GCB Bank">GCB Bank Ghana</option>
        <option value="Ecobank Ghana">Ecobank Ghana</option>
      `;
      if (suppAcctLabel) suppAcctLabel.textContent = 'MoMo / Account Number *';
      if (suppAcctInput) suppAcctInput.placeholder = 'e.g. 0244123456';
      if (suppCorridorNotice) {
        suppCorridorNotice.style.backgroundColor = 'rgba(245, 158, 11, 0.08)';
        suppCorridorNotice.style.borderColor = 'rgba(245, 158, 11, 0.25)';
        suppCorridorNotice.style.color = '#d97706';
        suppCorridorNotice.innerHTML = '⚡ <strong>Ghana Corridor:</strong> Dedicated Solana USDC receiving address is provisioned immediately. Local MoMo fiat off-ramp is <strong>COMING SOON</strong>.';
      }
    } else if (country === 'Kenya') {
      suppBankSelect.innerHTML = `
        <option value="Safaricom M-Pesa">Safaricom M-Pesa</option>
        <option value="Airtel Money Kenya">Airtel Money Kenya</option>
        <option value="Equity Bank Kenya">Equity Bank Kenya</option>
        <option value="KCB Bank">KCB Bank Kenya</option>
      `;
      if (suppAcctLabel) suppAcctLabel.textContent = 'M-Pesa / Account Number *';
      if (suppAcctInput) suppAcctInput.placeholder = 'e.g. 0712345678';
      if (suppCorridorNotice) {
        suppCorridorNotice.style.backgroundColor = 'rgba(245, 158, 11, 0.08)';
        suppCorridorNotice.style.borderColor = 'rgba(245, 158, 11, 0.25)';
        suppCorridorNotice.style.color = '#d97706';
        suppCorridorNotice.innerHTML = '⚡ <strong>Kenya Corridor:</strong> Dedicated Solana USDC receiving address is provisioned immediately. Local M-Pesa fiat off-ramp is <strong>COMING SOON</strong>.';
      }
    } else if (country === 'Rwanda') {
      suppBankSelect.innerHTML = `
        <option value="MTN MoMo Rwanda">MTN MoMo Rwanda</option>
        <option value="Airtel Money Rwanda">Airtel Money Rwanda</option>
        <option value="Bank of Kigali">Bank of Kigali</option>
      `;
      if (suppAcctLabel) suppAcctLabel.textContent = 'MoMo Phone Number *';
      if (suppAcctInput) suppAcctInput.placeholder = 'e.g. 0781234567';
      if (suppCorridorNotice) {
        suppCorridorNotice.style.backgroundColor = 'rgba(245, 158, 11, 0.08)';
        suppCorridorNotice.style.borderColor = 'rgba(245, 158, 11, 0.25)';
        suppCorridorNotice.style.color = '#d97706';
        suppCorridorNotice.innerHTML = '⚡ <strong>Rwanda Corridor:</strong> Dedicated Solana USDC receiving address is provisioned immediately. Local MoMo fiat off-ramp is <strong>COMING SOON</strong>.';
      }
    }
  }

  suppCountrySelect?.addEventListener('change', updateSupplierModalFields);

  document.getElementById('btn-open-add-supplier')?.addEventListener('click', () => {
    updateSupplierModalFields();
    openSuppModal();
  });
  document.getElementById('btn-close-supplier-modal')?.addEventListener('click', closeSuppModal);
  document.getElementById('btn-cancel-supplier')?.addEventListener('click', closeSuppModal);

  document.getElementById('form-add-supplier')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-submit-add-supplier');
    const name = document.getElementById('add-supp-name').value;
    const email = document.getElementById('add-supp-email').value;
    const phone = document.getElementById('add-supp-phone').value;
    const country = document.getElementById('add-supp-country').value;
    const bankName = document.getElementById('add-supp-bank-name').value;
    const bankAccountNumber = document.getElementById('add-supp-account-num').value;
    const bankAccountName = document.getElementById('add-supp-account-name').value;
    const solanaPublicKey = document.getElementById('add-supp-solana-key').value;

    let corridorCurrency = 'NGN';
    if (country === 'Ghana') corridorCurrency = 'GHS';
    else if (country === 'Kenya') corridorCurrency = 'KES';
    else if (country === 'Rwanda') corridorCurrency = 'RWF';

    btn.disabled = true;
    btn.textContent = 'Saving Supplier & Provisioning Wallet...';

    try {
      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          phone,
          country,
          corridorCurrency,
          bankName,
          bankAccountNumber,
          bankAccountName,
          solanaPublicKey
        })
      });
      const data = await res.json();

      if (data.success) {
        closeSuppModal();
        await loadAllData();
      } else {
        alert(data.error || 'Failed to register supplier');
      }
    } catch (err) {
      alert(`Error registering supplier: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save & Connect Supplier';
    }
  });

  // --- SUPPLIER SEARCH & FILTER LISTENERS ---
  const searchInput = document.getElementById('input-search-suppliers');
  let searchDebounce = null;
  searchInput?.addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      SUPPLIER_FILTER.search = e.target.value;
      fetchSuppliers();
    }, 250);
  });

  const filterChips = document.querySelectorAll('.btn-supp-filter');
  filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      filterChips.forEach(c => {
        c.style.backgroundColor = 'var(--bg-card)';
        c.style.color = 'var(--text-main)';
        c.classList.remove('active');
      });
      chip.style.backgroundColor = 'var(--solana-green)';
      chip.style.color = '#0d0e12';
      chip.classList.add('active');
      SUPPLIER_FILTER.country = chip.dataset.country;
      fetchSuppliers();
    });
  });
}

// Data Polling
function startPolling() {
  if (STATE.pollingInterval) clearInterval(STATE.pollingInterval);
  STATE.pollingInterval = setInterval(loadAllData, 3000);
}

async function loadAllData() {
  try {
    await Promise.all([
      fetchStats(),
      fetchInventory(),
      fetchSuppliers(),
      fetchReorders(),
      fetchWallet(),
      fetchTelegramMessages(),
      fetchLogs()
    ]);
  } catch (err) {
    console.warn('Dashboard sync warning:', err);
  }
}

let SUPPLIER_FILTER = { search: '', country: 'ALL' };

async function fetchSuppliers() {
  try {
    let url = '/api/suppliers';
    const params = new URLSearchParams();
    if (SUPPLIER_FILTER.search) params.append('search', SUPPLIER_FILTER.search);
    if (SUPPLIER_FILTER.country && SUPPLIER_FILTER.country !== 'ALL') params.append('country', SUPPLIER_FILTER.country);
    
    const qs = params.toString();
    if (qs) url += `?${qs}`;

    const res = await fetch(url);
    const data = await res.json();
    if (data.success && data.suppliers) {
      STATE.suppliers = data.suppliers;
      renderSuppliers(data.suppliers);
      if (!SUPPLIER_FILTER.search && SUPPLIER_FILTER.country === 'ALL') {
        populateSupplierDropdown(data.suppliers);
      }
    }
  } catch (e) {
    console.warn('Suppliers fetch failed:', e);
  }
}

function renderSuppliers(suppliers) {
  const container = document.getElementById('suppliers-grid');
  if (!container) return;

  if (suppliers.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 50px 20px; background-color: var(--bg-card); border-radius: 12px; border: 1px dashed var(--border-color);">
        <div style="font-size: 2rem; margin-bottom: 8px;">🏢</div>
        <strong style="display: block; font-size: 1rem; color: var(--text-heading); margin-bottom: 4px;">No suppliers found matching your query</strong>
        <p style="font-size: 0.82rem; margin-bottom: 16px;">Try adjusting your search or corridor filter</p>
        <button class="btn-volt-action" onclick="document.getElementById('btn-open-add-supplier').click()" style="width: auto; margin: 0 auto;">+ Connect New Supplier</button>
      </div>
    `;
    return;
  }

  container.innerHTML = suppliers.map(s => {
    let flag = '🇳🇬';
    let isNigeria = s.country?.toLowerCase() === 'nigeria';
    if (s.country === 'Ghana') flag = '🇬🇭';
    else if (s.country === 'Kenya') flag = '🇰🇪';
    else if (s.country === 'Rwanda') flag = '🇷🇼';
    else if (s.country === 'China') flag = '🇨🇳';

    const kycBadge = isNigeria 
      ? `<span style="background-color: rgba(34, 197, 94, 0.15); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.3); padding: 3px 8px; border-radius: 9999px; font-size: 0.7rem; font-weight: 700;">● Verified NIBSS Rail</span>`
      : `<span style="background-color: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); padding: 3px 8px; border-radius: 9999px; font-size: 0.7rem; font-weight: 700;">⚡ Pure USDC (Off-Ramp Soon)</span>`;

    const cleanPubKey = s.solana_public_key || '9tK8...SolanaKey';
    const shortKey = `${cleanPubKey.slice(0, 6)}...${cleanPubKey.slice(-4)}`;

    return `
      <div class="cur-pos-card" style="padding: 22px; display: flex; flex-direction: column; justify-content: space-between; border-color: ${isNigeria ? 'rgba(34, 197, 94, 0.3)' : 'var(--border-color)'};">
        <div>
          <div class="cur-card-top" style="margin-bottom: 14px;">
            <div class="cur-flag-wrap">
              <span class="cur-icon-circle" style="font-size: 1.4rem;">${flag}</span>
              <div>
                <span class="cur-code" style="font-size: 1.05rem; font-weight: 800;">${escapeHtml(s.name)}</span>
                <span class="cur-chain">${escapeHtml(s.country)} • ${escapeHtml(s.category || 'Wholesale Supplier')}</span>
              </div>
            </div>
            ${kycBadge}
          </div>

          <!-- Dedicated Solana Web3 Address -->
          <div style="background-color: var(--bg-card-inner); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
              <span style="font-size: 0.7rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Dedicated Solana Address</span>
              <button onclick="navigator.clipboard.writeText('${cleanPubKey}'); this.textContent='Copied!'; setTimeout(() => this.textContent='Copy', 1200);" style="background: none; border: none; color: var(--solana-green); font-size: 0.72rem; font-weight: 700; cursor: pointer; padding: 0;">Copy</button>
            </div>
            <div style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--solana-green); word-break: break-all;">
              <a href="https://explorer.solana.com/address/${cleanPubKey}?cluster=devnet" target="_blank" style="color: var(--solana-green); text-decoration: none;" title="View on Solana Explorer">
                ${shortKey} ↗
              </a>
            </div>
          </div>

          <!-- Bank Account / MoMo Details -->
          <div style="font-size: 0.8rem; color: var(--text-main); margin-bottom: 12px; line-height: 1.4;">
            <div style="font-weight: 700; color: var(--text-heading);">${escapeHtml(s.bank_name)}</div>
            <div style="color: var(--text-muted); font-size: 0.76rem; font-family: var(--font-mono);">
              Acct: ${escapeHtml(s.bank_account_number)} • ${escapeHtml(s.bank_account_name)}
            </div>
            ${s.email ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">📧 ${escapeHtml(s.email)}</div>` : ''}
          </div>
        </div>

        <div style="padding-top: 12px; border-top: 1px solid var(--border-color); display: flex; align-items: center; justify-content: space-between;">
          <span style="font-size: 0.72rem; color: var(--text-muted);">Payout: ${escapeHtml(s.corridor_currency)} Rail</span>
          <button class="btn-micro-faucet" onclick="document.getElementById('btn-inventory-add-product').click()" style="background-color: var(--bg-card); border: 1px solid var(--border-color); color: var(--text-main); font-size: 0.72rem; padding: 4px 10px; cursor: pointer;">+ Link Product</button>
        </div>
      </div>
    `;
  }).join('');
}

function populateSupplierDropdown(suppliers) {
  const select = document.getElementById('add-prod-supplier');
  if (!select || !suppliers || suppliers.length === 0) return;

  select.innerHTML = suppliers.map(s => {
    let flag = '🇳🇬';
    if (s.country === 'Ghana') flag = '🇬🇭';
    else if (s.country === 'Kenya') flag = '🇰🇪';
    else if (s.country === 'China') flag = '🇨🇳';
    return `<option value="${s.id}">${escapeHtml(s.name)} (${s.country} ${flag} - ${s.corridor_currency} ${escapeHtml(s.bank_name)})</option>`;
  }).join('');
}

async function fetchStats() {
  try {
    const isLive = STATE.isLive || false;
    const res = await fetch(`/api/stats?isLive=${isLive}`);
    const data = await res.json();
    if (data.success && data.stats) {
      STATE.stats = data;
      renderKPIs(data.stats, data.fxQuote);
    }
  } catch (e) {
    console.warn('Stats fetch failed:', e);
  }
}

function updateBalancesUI() {
  const usdcBalance = STATE.wallet?.merchant?.usdcBalance ?? 0;
  const ngnBalance = STATE.wallet?.merchant?.ngnBalance ?? 0;
  const solBalance = STATE.wallet?.merchant?.solBalance ?? 0;
  
  const fxRate = STATE.stats?.fxQuote?.rate ?? 1520;
  const ngnInUsdc = ngnBalance / fxRate;
  const solInUsd = solBalance * 150;
  const ghsInUsdc = 0;
  
  const totalWorkingCap = usdcBalance + ngnInUsdc + solInUsd + ghsInUsdc;

  const stageBalanceEl = document.getElementById('stage-total-balance');
  if (stageBalanceEl) {
    stageBalanceEl.innerHTML = `$${Math.round(totalWorkingCap).toLocaleString()}<span class="balance-cents">.00 USDC</span>`;
  }

  const posUsdc = document.getElementById('pos-usdc-amount');
  if (posUsdc) {
    posUsdc.textContent = `$${Number(usdcBalance.toFixed(2)).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  }

  const posNgnAmount = document.getElementById('pos-ngn-amount');
  if (posNgnAmount) {
    posNgnAmount.textContent = `₦${Math.round(ngnBalance).toLocaleString()}`;
  }

  const posNgnUsd = document.getElementById('pos-ngn-usd');
  if (posNgnUsd) {
    posNgnUsd.textContent = `≈ $${ngnInUsdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
  }

  const posSol = document.getElementById('pos-sol-amount');
  if (posSol) {
    posSol.textContent = `${solBalance.toFixed(2)} SOL`;
  }

  const posSolUsd = document.getElementById('pos-sol-usd');
  if (posSolUsd) {
    posSolUsd.textContent = `≈ $${solInUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
  }

  const usdcBalEl = document.getElementById('wallet-usdc-amount');
  if (usdcBalEl) {
    usdcBalEl.textContent = `$${Number(usdcBalance.toFixed(2)).toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC`;
  }

  // Update chart volume settled element
  const chartVolumeEl = document.getElementById('chart-volume-settled');
  if (chartVolumeEl) {
    const vol = STATE.stats?.stats?.volumeSettledUsdc ?? 0;
    chartVolumeEl.innerHTML = `$${Number(vol.toFixed(2)).toLocaleString()} <span class="chart-unit">USDC</span>`;
  }
}

function renderKPIs(stats, fxQuote) {
  updateBalancesUI();

  if (fxQuote) {
    const topbarPill = document.getElementById('topbar-rate-pill');
    if (topbarPill) {
      topbarPill.textContent = `🇳🇬 1 USDC = ₦${fxQuote.rate.toLocaleString()}`;
    }

    const posNgnRate = document.getElementById('pos-ngn-rate');
    if (posNgnRate) {
      posNgnRate.textContent = `₦${Math.round(fxQuote.rate).toLocaleString()}/USDC`;
    }
  }
}

async function fetchWallet() {
  try {
    const isLive = STATE.isLive || false;
    const res = await fetch(`/api/wallet?isLive=${isLive}`);
    const data = await res.json();
    if (data.success && data.merchant) {
      STATE.wallet = data;
      const solBal = data.merchant.solBalance.toFixed(2);

      const solBalEl = document.getElementById('wallet-sol-amount');
      if (solBalEl) solBalEl.textContent = `${solBal} SOL Devnet`;

      updateBalancesUI();
    }
  } catch (e) {
    console.warn('Wallet fetch failed:', e);
  }
}

async function fetchInventory() {
  try {
    const res = await fetch('/api/inventory');
    const data = await res.json();
    if (data.success && data.products) {
      STATE.products = data.products;
      renderInventory(data.products);
    }
  } catch (e) {
    console.warn('Inventory fetch failed:', e);
  }
}

function renderInventory(products) {
  const tbody = document.getElementById('inventory-table-body');
  const voltList = document.getElementById('volt-inventory-list');
  const lowCountEl = document.getElementById('kpi-low-stock-alert');
  const stockStatusEl = document.getElementById('kpi-stock-status');

  const lowCount = products.filter(p => p.current_stock <= p.min_threshold).length;
  if (lowCountEl) lowCountEl.textContent = `${lowCount} Items Low`;
  if (stockStatusEl) {
    stockStatusEl.textContent = lowCount > 0 ? 'Restock Req' : 'Healthy';
    stockStatusEl.className = lowCount > 0 ? 'quad-pct negative' : 'quad-pct positive';
  }

  // Populate Volt Portfolio Card
  if (voltList && products.length > 0) {
    const totalUnits = products.reduce((acc, cur) => acc + cur.current_stock, 0) || 1;
    const icons = ['⚡', '🔌', '🔋', '🎧', '📱', '💻'];
    voltList.innerHTML = products.slice(0, 5).map((p, idx) => {
      const pct = Math.round((p.current_stock / totalUnits) * 100);
      const isLow = p.current_stock <= p.min_threshold;
      return `
        <div class="volt-item-row">
          <div class="v-item-left">
            <div class="v-avatar">${icons[idx % icons.length]}</div>
            <div>
              <div class="v-name">${escapeHtml(p.name)}</div>
              <div class="v-sku">${escapeHtml(p.sku)}</div>
            </div>
          </div>
          <div class="v-item-right">
            <div class="v-pct">${pct}%</div>
            <span class="v-badge ${isLow ? 'low' : 'ok'}">${isLow ? `${p.current_stock} Low` : `${p.current_stock} Units`}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // Populate Dedicated Inventory Table
  if (tbody) {
    if (products.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 24px;">No products tracked.</td></tr>`;
      return;
    }
    tbody.innerHTML = products.map(p => {
      const isLow = p.current_stock <= p.min_threshold;
      const stockClass = isLow ? 'low' : 'healthy';

      return `
        <tr>
          <td class="product-cell">
            <span class="p-name">${escapeHtml(p.name)}</span>
            <span class="p-sku">SKU: ${escapeHtml(p.sku)}</span>
          </td>
          <td>
            <div class="stock-meter">
              <span class="stock-pill ${stockClass}">${p.current_stock} units</span>
            </div>
          </td>
          <td style="color: var(--text-muted); font-family: var(--font-mono);">${p.min_threshold} units</td>
          <td style="font-weight: 700; font-family: var(--font-mono);">$${p.unit_cost_usdc.toFixed(2)} USDC</td>
          <td>
            <span style="font-size: 0.8rem; font-weight: 600;">${escapeHtml(p.supplier_name)}</span>
            <span style="display: block; font-size: 0.72rem; color: var(--solana-green);">Payout in NGN (Nigeria 🇳🇬)</span>
          </td>
          <td>
            <div class="sales-sim-actions">
              <button class="btn-sim" onclick="simulateSale('${p.id}', 1)" title="Simulate 1 sale">-1</button>
              <button class="btn-sim" onclick="simulateSale('${p.id}', 5)" title="Simulate 5 sales">-5</button>
              <button class="btn-sim btn-deplete" onclick="depleteStock('${p.id}')" title="Trigger Settle Agent">Deplete</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }
}

async function simulateSale(productId, quantity) {
  try {
    const res = await fetch('/api/inventory/sell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, quantity })
    });
    const data = await res.json();
    if (data.success) {
      loadAllData();
    }
  } catch (e) {
    console.error('Error simulating sale:', e);
  }
}

async function depleteStock(productId) {
  const p = STATE.products.find(item => item.id === productId);
  if (!p) return;
  const targetStock = Math.max(1, p.min_threshold - 3);
  const diff = p.current_stock - targetStock;
  if (diff > 0) {
    await simulateSale(productId, diff);
  } else {
    await simulateSale(productId, 1);
  }
}

async function fetchReorders() {
  try {
    const isLive = STATE.isLive || false;
    const res = await fetch(`/api/reorders?isLive=${isLive}`);
    const data = await res.json();
    if (data.success) {
      STATE.pendingReorders = data.pending;
      STATE.allReorders = data.all;
      renderPendingApprovals(data.pending);
      renderSettlementHistory(data.all);
    }
  } catch (e) {
    console.warn('Reorders fetch failed:', e);
  }
}

function renderPendingApprovals(pending) {
  const zone = document.getElementById('approval-zone');
  const apProductTitle = document.getElementById('ap-product-title');
  const btnApprove = document.getElementById('btn-quick-approve');
  const btnReject = document.getElementById('btn-quick-reject');

  if (!pending || pending.length === 0) {
    if (zone) zone.style.display = 'none';
    return;
  }

  if (zone) zone.style.display = 'flex';
  const firstOrder = pending[0];

  if (apProductTitle) {
    apProductTitle.textContent = `${firstOrder.product_name || 'Product'} (${firstOrder.quantity} Units)`;
    const textSpan = apProductTitle.nextElementSibling;
    if (textSpan) {
      textSpan.textContent = `Supplier: ${firstOrder.supplier_name || 'Nigeria Supplier'} • $${firstOrder.total_usdc.toFixed(2)} USDC (₦${firstOrder.total_ngn.toLocaleString()} NGN)`;
    }
  }

  if (btnApprove) {
    btnApprove.onclick = () => approveReorder(firstOrder.id);
  }
  if (btnReject) {
    btnReject.onclick = () => rejectReorder(firstOrder.id);
  }
}

async function approveReorder(reorderId) {
  const btn = document.getElementById('btn-quick-approve');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Broadcasting Solana...';
  }

  try {
    const res = await fetch(`/api/reorders/${reorderId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'WEB_DASHBOARD' })
    });
    const data = await res.json();
    if (data.success) {
      showReceiptModal(data.reorder);
      await loadAllData();
    } else {
      alert(`Approval error: ${data.error}`);
    }
  } catch (e) {
    alert(`Failed to approve: ${e.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Approve & Pay (Solana)';
    }
  }
}

async function rejectReorder(reorderId) {
  try {
    const res = await fetch(`/api/reorders/${reorderId}/reject`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      await loadAllData();
    }
  } catch (e) {
    console.error('Reject error:', e);
  }
}

function renderSettlementHistory(all) {
  const tbody = document.getElementById('history-table-body');
  if (!tbody) return;

  if (!all || all.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 24px;">No transactions settled yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = all.map(ord => {
    let txLink = `<span style="color: var(--text-dim); font-size: 0.75rem;">Pending</span>`;
    if (ord.solana_tx_signature) {
      // Every stored signature is a confirmed on-chain SPL USDC transfer;
      // settlements that cannot be confirmed are marked FAILED and store no signature.
      const label = 'Devnet On-Chain';
      const color = 'rgba(20,241,149,0.15)';
      const textColor = '#14f195';
      const title = 'On-Chain Devnet verified USDC transfer.';
      
      txLink = `
        <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start;">
          <a href="https://explorer.solana.com/tx/${ord.solana_tx_signature}?cluster=devnet" target="_blank" class="link-explorer" style="font-size: 0.8rem;">
            <span>${ord.solana_tx_signature.substring(0, 10)}...</span> ↗
          </a>
          <span style="background: ${color}; color: ${textColor}; font-size: 0.6rem; padding: 2px 6px; border-radius: 4px; font-weight: 700; text-transform: uppercase;" title="${title}">${label}</span>
        </div>
      `;
    }

    return `
      <tr>
        <td style="font-family: var(--font-mono); font-size: 0.78rem; font-weight: 700;">#${ord.id}</td>
        <td>
          <span style="font-weight: 600; font-size: 0.85rem;">${escapeHtml(ord.product_name || 'Restock')}</span>
          <span style="display: block; font-size: 0.72rem; color: var(--text-dim);">${escapeHtml(ord.supplier_name || 'Supplier')}</span>
        </td>
        <td style="font-family: var(--font-mono);">${ord.quantity} units</td>
        <td style="font-family: var(--font-mono); font-weight: 700; color: var(--solana-green);">$${ord.total_usdc.toFixed(2)}</td>
        <td style="font-family: var(--font-mono); font-size: 0.82rem;">₦${ord.total_ngn.toLocaleString()}</td>
        <td><span class="status-pill status-${ord.status}">${ord.status.replace('_', ' ')}</span></td>
        <td>${txLink}</td>
      </tr>
    `;
  }).join('');
}

async function fetchTelegramMessages() {
  try {
    const res = await fetch('/api/telegram/messages');
    const data = await res.json();
    if (data.success && data.messages) {
      STATE.telegramMessages = data.messages;
      renderTelegramChat(data.messages);
    }
  } catch (e) {
    console.warn('Telegram fetch failed:', e);
  }
}

function renderTelegramChat(messages) {
  const container = document.getElementById('telegram-chat-body');
  if (!container) return;

  if (messages.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-dim); padding: 40px;">No alerts yet. AI Agent is monitoring.</div>`;
    return;
  }

  container.innerHTML = messages.map(msg => {
    return `
      <div class="telegram-msg">
        <div class="tg-msg-text">${formatMarkdownText(msg.text)}</div>
      </div>
    `;
  }).join('');
}

async function fetchLogs() {
  try {
    const res = await fetch('/api/logs?limit=30');
    const data = await res.json();
    if (data.success && data.logs) {
      STATE.logs = data.logs;
      renderLogs(data.logs);
    }
  } catch (e) {
    console.warn('Logs fetch failed:', e);
  }
}

function renderLogs(logs) {
  const container = document.getElementById('terminal-logs');
  if (!container) return;

  container.innerHTML = logs.map(l => {
    const time = new Date(l.created_at).toLocaleTimeString();
    return `
      <div class="log-entry">
        <span class="log-time">[${time}]</span>
        <span class="log-tag ${l.severity}">${l.event_type}</span>
        <span class="log-msg">${escapeHtml(l.message)}</span>
      </div>
    `;
  }).join('');
}

async function handleForceScan() {
  const btns = document.querySelectorAll('#btn-force-scan');
  btns.forEach(b => { b.disabled = true; b.textContent = 'Scanning...'; });
  try {
    await fetch('/api/reorders/scan', { method: 'POST' });
    await loadAllData();
  } catch (e) {
    console.error('Scan error:', e);
  } finally {
    btns.forEach(b => { b.disabled = false; b.textContent = 'Run AI Stock Scan'; });
  }
}

function showReceiptModal(reorder) {
  const modal = document.getElementById('receipt-modal');
  const body = document.getElementById('receipt-modal-body');
  const link = document.getElementById('modal-explorer-link');

  body.innerHTML = `
    <div class="receipt-row">
      <span class="r-label">Reorder ID</span>
      <span class="r-val">#${reorder.id}</span>
    </div>
    <div class="receipt-row">
      <span class="r-label">Product Restocked</span>
      <span class="r-val">${escapeHtml(reorder.product_name)} (${reorder.quantity} units)</span>
    </div>
    <div class="receipt-row">
      <span class="r-label">USDC Settled (Solana)</span>
      <span class="r-val" style="color: var(--solana-green); font-family: var(--font-mono); font-size: 1.1rem;">$${reorder.total_usdc.toFixed(2)} USDC</span>
    </div>
    <div class="receipt-row">
      <span class="r-label">NGN Payout Equivalent</span>
      <span class="r-val">₦${reorder.total_ngn.toLocaleString()} NGN</span>
    </div>
    <div class="receipt-row">
      <span class="r-label">FX Corridor Oracle Rate</span>
      <span class="r-val">1 USDC = ₦${reorder.fx_rate_ngn.toLocaleString()}</span>
    </div>
    <div class="receipt-row">
      <span class="r-label">Supplier Destination</span>
      <span class="r-val">${escapeHtml(reorder.supplier_name)}</span>
    </div>
    <div class="receipt-row">
      <span class="r-label">Bank Settlement Account</span>
      <span class="r-val">${escapeHtml(reorder.supplier_bank_name)} (${escapeHtml(reorder.supplier_bank_account)})</span>
    </div>
    <div class="receipt-row">
      <span class="r-label">Settlement Rail Speed</span>
      <span class="r-val" style="color: var(--solana-cyan);">< 2.4 seconds</span>
    </div>
    <div class="receipt-tx-box">
      <strong style="color: var(--text-muted); display: block; margin-bottom: 4px;">Solana Tx Hash:</strong>
      ${reorder.solana_tx_signature || 'Confirmed'}
    </div>
  `;

  if (reorder.solana_explorer_url) {
    link.href = reorder.solana_explorer_url;
    link.style.display = 'inline-flex';
  } else {
    link.style.display = 'none';
  }

  modal.classList.add('active');
}

function closeModal() {
  document.getElementById('receipt-modal')?.classList.remove('active');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatMarkdownText(text) {
  if (!text) return '';
  return escapeHtml(text)
    .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
    .replace(/`(.*?)`/g, '<code style="background: rgba(0,0,0,0.3); padding: 1px 4px; border-radius: 3px; font-family: monospace;">$1</code>');
}
