/**
 * Settle Agent - Landing Page & ROI Calculator Client Script
 */

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initLandingInteractions();
  initCalculator();
  initScrollAnimations();
});

// Theme Management
function initTheme() {
  const savedTheme = localStorage.getItem('settle_theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);

  document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('settle_theme', next);
  });
}

function initLandingInteractions() {
  const token = localStorage.getItem('settle_agent_token');

  // Update navbar button if already logged in
  const navActionBtn = document.getElementById('btn-nav-action');
  if (navActionBtn && token) {
    navActionBtn.textContent = 'Go to Dashboard ➔';
    navActionBtn.href = '/dashboard';
  }



  // Hero launch buttons
  document.getElementById('btn-hero-launch')?.addEventListener('click', (e) => {
    if (token) {
      e.preventDefault();
      window.location.href = '/dashboard';
    }
  });

  document.getElementById('btn-bottom-launch')?.addEventListener('click', (e) => {
    if (token) {
      e.preventDefault();
      window.location.href = '/dashboard';
    }
  });
}

// ROI & Savings Calculator
function initCalculator() {
  const slider = document.getElementById('calc-volume-slider');
  const displayVal = document.getElementById('calc-slider-val');
  const tradCostEl = document.getElementById('calc-trad-cost');
  const solCostEl = document.getElementById('calc-sol-cost');
  const totalSavingsEl = document.getElementById('calc-total-savings');

  if (!slider) return;

  function updateSavings() {
    const volume = parseInt(slider.value, 10);
    if (displayVal) displayVal.textContent = `$${volume.toLocaleString()}`;

    // Traditional: ~7.5% in FX spread, wire fees, correspondent bank cuts
    const tradCost = volume * 0.075;
    // Solana USDC: Sub-cent network gas (<$0.001) + 0.15% tight liquidity spread
    const solCost = (volume * 0.0015) + 0.0005;
    const savings = Math.max(0, tradCost - solCost);

    if (tradCostEl) tradCostEl.textContent = `$${tradCost.toFixed(2)}`;
    if (solCostEl) solCostEl.textContent = `$${solCost.toFixed(2)}`;
    if (totalSavingsEl) totalSavingsEl.textContent = `$${savings.toFixed(2)}`;
  }

  slider.addEventListener('input', updateSavings);
  updateSavings();
}

// Scroll Reveal Animations
function initScrollAnimations() {
  const elements = document.querySelectorAll('.reveal-on-scroll');
  
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('reveal-active');
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.1,
      rootMargin: '0px 0px -40px 0px'
    });
    
    elements.forEach(el => observer.observe(el));
  } else {
    elements.forEach(el => el.classList.add('reveal-active'));
  }
}
