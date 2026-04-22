/**
 * AGC Inventory — browser-side live refresh.
 *
 * Runs after each page-load and also every minute while the Atlanta shop
 * is open (08:00–18:00 US/Eastern). Outside the window, the interval
 * idles — the PHP render already painted the data on page-load, so the
 * page still shows *something* during off-hours.
 *
 * Talks to WP's admin-ajax.php. The WP side proxies to AGC Desk and
 * caches responses in a transient (TTL in agc-inventory.php), so a WP
 * instance serving 500 visitors in a minute still only generates one
 * upstream request.
 *
 * Ships no framework. Querying admin-ajax + swapping innerHTML is all
 * we need and keeps the plugin hot-reloadable on the shop's WP host
 * without a build step.
 */
(function () {
  if (typeof window === 'undefined' || !window.AGC_INV) return;

  var cfg = window.AGC_INV;

  function init() {
    var nodes = document.querySelectorAll('[data-agc-widget]');
    if (!nodes.length) return;
    nodes.forEach(function (el) {
      bind(el);
    });
  }

  function bind(root) {
    var widget = root.getAttribute('data-agc-widget');
    var metal = root.getAttribute('data-agc-metal') || '';
    var action =
      widget === 'live-inventory'
        ? 'agc_inv_live_inventory'
        : 'agc_inv_what_we_pay';

    schedule(function tick() {
      if (!inBusinessHours()) return;
      refresh(root, widget, action, metal);
    });

    // Delegated listeners — survive the innerHTML swap on each 60s poll,
    // so search + chip state don't need rebinding.
    root.addEventListener('input', function (e) {
      var input = e.target;
      if (input && input.classList && input.classList.contains('agc-inv-search-input')) {
        applyFilter(root, input.value);
      }
    });
    root.addEventListener('click', function (e) {
      var chip = e.target.closest ? e.target.closest('.agc-inv-chip') : null;
      if (!chip) return;
      var targetId = chip.getAttribute('data-agc-target');
      if (!targetId) return;
      var target = root.querySelector('#' + targetId);
      if (target && target.scrollIntoView) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  function schedule(fn) {
    // First tick on a small delay so the freshly-rendered DOM isn't
    // immediately replaced (the operator wants to see the initial paint).
    setTimeout(fn, 5000);
    setInterval(fn, cfg.refreshMs || 60000);
  }

  /**
   * Return true when the metals market is open AND we're inside one of
   * the two daily refresh windows, all in US/Eastern:
   *
   *   Day window:       08:00 – 17:00
   *   Overnight window: 18:00 – 07:00 (wraps midnight)
   *
   *   Gaps (NO refresh):   17:00 – 18:00  (COMEX daily break)
   *                        07:00 – 08:00  (pre-market quiet hour)
   *
   *   Weekend close:       Fri 17:00 – Sun 18:00  (market closed)
   *
   * Tracks CME Globex hours for precious-metals futures. The page
   * still renders during gaps/close — only the 60s poller pauses.
   */
  function inBusinessHours() {
    try {
      var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
        hour: 'numeric',
        hour12: false,
      }).formatToParts(new Date());
      var hour = 0;
      var weekday = '';
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === 'hour') hour = parseInt(parts[i].value, 10);
        if (parts[i].type === 'weekday') weekday = parts[i].value;
      }
      // Intl returns hour=24 at the exact start of the next day in some
      // runtimes; normalize so comparisons work.
      if (hour === 24) hour = 0;

      // Weekend close: Fri ≥17:00 through Sun <18:00
      if (weekday === 'Fri' && hour >= 17) return false;
      if (weekday === 'Sat') return false;
      if (weekday === 'Sun' && hour < 18) return false;

      // Daily gaps
      if (hour === 17) return false; // 17:00-17:59 (COMEX break)
      if (hour === 7) return false;  // 07:00-07:59 (pre-market quiet)

      return true;
    } catch (e) {
      // If the runtime doesn't support tz parts, always refresh —
      // erring on the side of fresh data for the operator.
      return true;
    }
  }

  function refresh(root, widget, action, metal) {
    root.classList.add('agc-inv-refreshing');
    var url =
      cfg.ajaxUrl +
      '?action=' +
      encodeURIComponent(action) +
      '&metal=' +
      encodeURIComponent(metal);
    fetch(url, { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('bad status');
        return r.json();
      })
      .then(function (json) {
        if (!json || !json.success) return;
        render(root, widget, json.data);
      })
      .catch(function () {
        // Swallow — keep whatever's on screen. The error banner only
        // fires on initial page load when there's literally no data.
      })
      .then(function () {
        root.classList.remove('agc-inv-refreshing');
      });
  }

  function render(root, widget, data) {
    // Preserve the current search query across the innerHTML swap so
    // customers aren't kicked back to an unfiltered view every 60s.
    var priorSearch = root.querySelector('.agc-inv-search-input');
    var priorQuery = priorSearch ? priorSearch.value : '';

    var sections = Array.isArray(data.sections) ? data.sections : [];

    // Spot strip (What We Pay only). Empty string on Live Inventory.
    var html =
      widget === 'what-we-pay' ? renderSpotStrip(data.spot || null) : '';

    // Toolbar: search + chips derived from the sections actually present.
    html += renderToolbar(sections, widget);

    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      if (!s.rows || !s.rows.length) continue;
      html += renderSection(widget, s.id, s.label, s.rows, data.spot || null);
    }
    if (sections.length === 0) {
      html +=
        '<p class="agc-inv-empty">' +
        (widget === 'live-inventory'
          ? 'Nothing in stock right now. Call us at 404-236-9744.'
          : 'Pricing coming soon.') +
        '</p>';
    }
    html +=
      '<p class="agc-inv-footnote">' +
      (widget === 'live-inventory' ? 'Updated ' : 'Live prices — updated ') +
      '<span class="agc-inv-updated">' +
      escapeHtml(data.updated || '') +
      '</span>. Refreshes every minute while the metals market is open (Sun 6 PM – Fri 5 PM Eastern, daily break 5–6 PM). ' +
      (widget === 'live-inventory'
        ? 'Call <a href="tel:4042369744">404-236-9744</a> to confirm availability.'
        : 'Prices are indicative; call <a href="tel:4042369744">404-236-9744</a> to schedule your appointment.') +
      '</p>';
    root.innerHTML = html;

    // Restore the search input value + re-run the filter against the
    // fresh DOM. Delegated listeners on root (see bind()) already cover
    // the input + chip clicks, so no rebinding needed.
    var newSearch = root.querySelector('.agc-inv-search-input');
    if (newSearch && priorQuery) {
      newSearch.value = priorQuery;
      applyFilter(root, priorQuery);
    }
  }

  function renderToolbar(sections, widget) {
    var placeholder =
      widget === 'live-inventory'
        ? 'Search in-stock items...'
        : 'Search what we pay...';
    var chips = '';
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      if (!s.rows || !s.rows.length) continue;
      chips +=
        '<button type="button" class="agc-inv-chip" data-agc-target="agc-section-' +
        escapeHtml(s.id) +
        '">' +
        escapeHtml(s.label) +
        '</button>';
    }
    var chipBlock = chips
      ? '<div class="agc-inv-chips" role="navigation" aria-label="Jump to category">' +
        chips +
        '</div>'
      : '';
    return (
      '<div class="agc-inv-toolbar">' +
      '<div class="agc-inv-search"><input type="search" class="agc-inv-search-input" placeholder="' +
      escapeHtml(placeholder) +
      '" aria-label="Search" /></div>' +
      chipBlock +
      '</div>'
    );
  }

  function renderSection(widget, slug, label, rows, spot) {
    var isLive = widget === 'live-inventory';
    // Premium column ALWAYS rendered on What We Pay but hidden by CSS
    // unless the wrap has .agc-inv-wrap--show-premium (toggled via the
    // operator's double-click on the hero badge). Keeps the column
    // in the DOM for instant reveal without a re-render.
    var head = isLive
      ? '<th class="agc-inv-col-item">Item</th><th class="agc-inv-col-qty">Qty</th>'
      : '<th class="agc-inv-col-item">Item</th>' +
        '<th class="agc-inv-col-premium">Premium</th>' +
        '<th class="agc-inv-col-price">We pay</th>';
    var body = '';
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      if (isLive) {
        // Defensive: skip zero-stock rows even if the PHP layer ever
        // slips up. A "0" qty on a live-inventory page would read as
        // broken / misleading, never informative.
        var qty = parseInt(r.available, 10);
        if (!(qty > 0)) continue;
        body +=
          '<tr><td class="agc-inv-col-item"><span class="agc-inv-name">' +
          escapeHtml(r.name || '') +
          '</span></td><td class="agc-inv-col-qty">' +
          qty +
          '</td></tr>';
      } else {
        body +=
          '<tr><td class="agc-inv-col-item"><span class="agc-inv-name">' +
          escapeHtml(r.name || '') +
          '</span></td>' +
          '<td class="agc-inv-col-premium">' +
          renderPremiumCell(r, spot) +
          '</td>' +
          '<td class="agc-inv-col-price">$' +
          formatMoney(r.buy_price) +
          '</td></tr>';
      }
    }
    return (
      '<section class="agc-inv-section agc-inv-section--' +
      escapeHtml(slug) +
      '" id="agc-section-' +
      escapeHtml(slug) +
      '"><h3 class="agc-inv-metal-heading">' +
      escapeHtml(label) +
      '</h3><table class="agc-inv-table"><thead><tr>' +
      head +
      '</tr></thead><tbody>' +
      body +
      '</tbody></table></section>'
    );
  }

  /**
   * Premium = how far our buy price sits from melt value. Positive = we
   * pay MORE than melt (typical for small fractionals + semi-numismatics),
   * negative = we pay BELOW melt (generic bullion). Shown as dollar
   * amount with percent subtitle; computed purely client-side from the
   * already-fetched spot + per-row weight/purity, so the premium never
   * travels through the public API payload.
   */
  function renderPremiumCell(r, spot) {
    if (!spot) return '<span class="agc-inv-premium-na">—</span>';
    var metal = (r.metal || '').toLowerCase();
    var spotPrice = Number(spot[metal] || 0);
    var weight = Number(r.weight_troy_oz || 0);
    var purity = Number(r.purity || 0);
    var melt = spotPrice * weight * purity;
    var buy = Number(r.buy_price || 0);
    if (!(melt > 0) || !(buy > 0)) {
      return '<span class="agc-inv-premium-na">—</span>';
    }
    var delta = buy - melt;
    var pct = (delta / melt) * 100;
    var sign = delta >= 0 ? '+' : '-';
    var cls =
      delta > 0
        ? 'agc-inv-premium--over'
        : delta < 0
        ? 'agc-inv-premium--under'
        : 'agc-inv-premium--flat';
    return (
      '<span class="agc-inv-premium ' +
      cls +
      '"><span class="agc-inv-premium-dollar">' +
      sign +
      '$' +
      formatMoney(Math.abs(delta)) +
      '</span><span class="agc-inv-premium-pct">' +
      sign +
      Math.abs(pct).toFixed(2) +
      '%</span></span>'
    );
  }

  /**
   * Word-substring fuzzy filter. Accepts a free-form query; splits on
   * whitespace and requires every word to appear somewhere in the
   * item name (order-independent, case-insensitive). That's forgiving
   * enough to tolerate shorthand ("eagle 1oz" finds "1 oz American
   * Gold Eagle") without the overhead of a proper trigram library.
   *
   * Hides empty sections after filtering so chips don't link to a
   * header above zero rows.
   */
  function applyFilter(root, query) {
    var q = (query || '').toLowerCase().trim();
    var words = q ? q.split(/\s+/) : [];
    var sections = root.querySelectorAll('.agc-inv-section');
    for (var i = 0; i < sections.length; i++) {
      var sec = sections[i];
      var rows = sec.querySelectorAll('tbody tr');
      var visible = 0;
      for (var j = 0; j < rows.length; j++) {
        var name = (rows[j].querySelector('.agc-inv-name') || {}).textContent || '';
        var lname = name.toLowerCase();
        var match = true;
        for (var k = 0; k < words.length; k++) {
          if (lname.indexOf(words[k]) === -1) {
            match = false;
            break;
          }
        }
        if (match) {
          rows[j].style.display = '';
          visible++;
        } else {
          rows[j].style.display = 'none';
        }
      }
      sec.style.display = visible === 0 && words.length > 0 ? 'none' : '';
    }
    // Hide the chips for empty sections too, so "jump" never lands on a
    // hidden block.
    var chips = root.querySelectorAll('.agc-inv-chip');
    for (var c = 0; c < chips.length; c++) {
      var target = chips[c].getAttribute('data-agc-target');
      var sectionEl = target ? root.querySelector('#' + target) : null;
      chips[c].style.display =
        sectionEl && sectionEl.style.display === 'none' ? 'none' : '';
    }
  }

  /**
   * Four-metal spot strip. Mirrors the PHP renderer — same classnames
   * so the CSS layer knows only one structure. When spot is null (API
   * down / cold cache), renders an empty placeholder to reserve the
   * vertical space so the page doesn't jump on the next successful poll.
   */
  function renderSpotStrip(spot) {
    var metals = [
      { key: 'gold', label: 'Gold' },
      { key: 'silver', label: 'Silver' },
      { key: 'platinum', label: 'Platinum' },
      { key: 'palladium', label: 'Palladium' },
    ];
    if (!spot) {
      return '<div class="agc-inv-spot-strip" data-agc-spot="empty"></div>';
    }
    var change = spot.change && typeof spot.change === 'object' ? spot.change : {};
    var html = '<div class="agc-inv-spot-strip" data-agc-spot="ready">';
    for (var i = 0; i < metals.length; i++) {
      var m = metals[i];
      var raw = spot[m.key];
      var priceHtml =
        raw != null && isFinite(Number(raw)) ? '$' + formatMoney(raw) : '&mdash;';
      html +=
        '<div class="agc-inv-spot agc-inv-spot--' +
        m.key +
        '"><span class="agc-inv-spot-label">' +
        m.label +
        '</span><span class="agc-inv-spot-price" data-agc-spot-metal="' +
        m.key +
        '">' +
        priceHtml +
        '</span>';
      // ±change row — same logic as the PHP renderer so both paint the
      // same thing.
      var c = change[m.key];
      if (c && c.delta != null && c.percent != null) {
        var delta = Number(c.delta);
        var percent = Number(c.percent);
        if (isFinite(delta) && isFinite(percent)) {
          var dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
          var arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '—';
          var sign = delta > 0 ? '+' : '';
          html +=
            '<span class="agc-inv-spot-change agc-inv-spot-change--' +
            dir +
            '"><span class="agc-inv-spot-change-arrow">' +
            arrow +
            '</span>' +
            escapeHtml(sign + formatMoney(delta) + ' (' + sign + percent.toFixed(2) + '%)') +
            '</span>';
        }
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function formatMoney(v) {
    var n = Number(v);
    if (!isFinite(n)) return '—';
    return n.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/**
 * Schedule-appointment drawer controller (bundled into the widget JS
 * so both Live Inventory and What We Pay get it without a second enqueue).
 *
 * Trigger: any element with [data-agc-buy-open="1"] opens the drawer.
 * Close: overlay click, ESC key, or the X button inside the drawer.
 *
 * If multiple widgets render on the same page, we bind once (IIFE-scope
 * `bound` flag) and only the FIRST drawer DOM is addressed — duplicates
 * on the page would double-fire the body scroll lock otherwise.
 */
(function () {
  var bound = false;
  function initDrawer() {
    if (bound) return;
    var drawer = document.querySelector('[data-agc-buy-drawer]');
    var overlay = document.querySelector('[data-agc-buy-overlay]');
    if (!drawer || !overlay) return;
    bound = true;

    var lastOpener = null;

    function open(opener) {
      if (opener) lastOpener = opener;
      drawer.setAttribute('aria-hidden', 'false');
      drawer.classList.add('agc-drawer--open');
      overlay.hidden = false;
      // Force reflow so the opacity transition actually animates.
      // eslint-disable-next-line no-unused-expressions
      overlay.offsetHeight;
      overlay.classList.add('agc-drawer-overlay--open');
      document.body.classList.add('agc-drawer-locked');
      var closeBtn = drawer.querySelector('[data-agc-buy-close]');
      if (closeBtn && typeof closeBtn.focus === 'function') {
        // Defer focus so the slide-in animation is visible before the
        // screen reader announces the close button.
        setTimeout(function () { closeBtn.focus(); }, 80);
      }
    }

    function close() {
      drawer.setAttribute('aria-hidden', 'true');
      drawer.classList.remove('agc-drawer--open');
      overlay.classList.remove('agc-drawer-overlay--open');
      document.body.classList.remove('agc-drawer-locked');
      setTimeout(function () {
        if (!overlay.classList.contains('agc-drawer-overlay--open')) {
          overlay.hidden = true;
        }
      }, 300);
      if (lastOpener && typeof lastOpener.focus === 'function') {
        lastOpener.focus();
      }
    }

    document.addEventListener('click', function (e) {
      var opener = e.target.closest
        ? e.target.closest('[data-agc-buy-open]')
        : null;
      if (opener) {
        e.preventDefault();
        open(opener);
        return;
      }
      var closer = e.target.closest
        ? e.target.closest('[data-agc-buy-close]')
        : null;
      if (closer) {
        e.preventDefault();
        close();
      }
    });

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && drawer.classList.contains('agc-drawer--open')) {
        close();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDrawer);
  } else {
    initDrawer();
  }
})();

/**
 * Hidden operator tool — double-clicking the LIVE badge in a widget's
 * hero reveals the premium column on What We Pay. The column is
 * always rendered; CSS hides it until this class flips on. Customers
 * never see it because the trigger is a double-click on a small
 * labeled control that reads as part of the heading.
 *
 * State is per-widget-on-the-page (not persisted) — a page reload
 * restores the hidden state so the next customer doesn't inherit
 * a reveal from the last operator who stood at the screen.
 */
(function () {
  function init() {
    document.addEventListener('dblclick', function (e) {
      var badge = e.target.closest
        ? e.target.closest('.agc-inv-hero-badge')
        : null;
      if (!badge) return;
      // The hero sits as a sibling of .agc-inv-wrap — walk from the
      // hero container to its next sibling that's the wrap, toggle
      // the reveal class there.
      var hero = badge.closest('.agc-inv-hero');
      if (!hero) return;
      var wrap = hero.nextElementSibling;
      while (wrap && !wrap.classList.contains('agc-inv-wrap')) {
        wrap = wrap.nextElementSibling;
      }
      if (!wrap) return;
      e.preventDefault();
      wrap.classList.toggle('agc-inv-wrap--show-premium');
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/**
 * "Notify me when back in stock" signup handler.
 *
 * Each row's button carries data-agc-notify="<product_id>" + the API
 * base. On click, the button is replaced inline with an email input +
 * subscribe submit. Successful POST flips the button to a green
 * "We'll email you" confirmation state and disables further clicks.
 *
 * Delegated at document level so the handler covers rows that appear
 * after a widget re-render (operators pressing 'Refresh' etc.). No
 * WordPress account / auth is required on the customer side; the API
 * endpoint is @Public.
 */
(function () {
  function init() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest
        ? e.target.closest('.agc-inv-notify-btn')
        : null;
      if (!btn) return;
      if (btn.classList.contains('is-subscribed')) return;
      if (btn.disabled) return;

      var productId = btn.getAttribute('data-agc-notify');
      var apiBase = btn.getAttribute('data-agc-api-base');
      var productName = btn.getAttribute('data-agc-product-name') || 'this item';
      if (!productId || !apiBase) return;

      e.preventDefault();
      openForm(btn, productId, apiBase, productName);
    });

    function openForm(btn, productId, apiBase, productName) {
      // Swap the button node with an inline email capture form.
      var form = document.createElement('form');
      form.className = 'agc-inv-notify-form';
      form.setAttribute('novalidate', '');
      form.innerHTML =
        '<input type="email" required autocomplete="email" placeholder="you@example.com" />' +
        '<button type="submit">Notify Me</button>';
      btn.replaceWith(form);
      var input = form.querySelector('input[type="email"]');
      var submit = form.querySelector('button[type="submit"]');
      if (input && typeof input.focus === 'function') input.focus();

      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var email = (input.value || '').trim();
        if (!email || email.indexOf('@') === -1) {
          input.focus();
          return;
        }
        submit.disabled = true;
        submit.textContent = '…';
        submitSignup(apiBase, productId, email)
          .then(function () {
            // Put a confirmed-state button in place of the form.
            var confirmed = document.createElement('button');
            confirmed.type = 'button';
            confirmed.className = 'agc-inv-notify-btn is-subscribed';
            confirmed.textContent = '✓ Subscribed';
            confirmed.setAttribute(
              'title',
              "We'll email " + email + ' when ' + productName + ' is back in stock.',
            );
            form.replaceWith(confirmed);
          })
          .catch(function (err) {
            submit.disabled = false;
            submit.textContent = 'Notify Me';
            // Minimal surface — a single alert keeps the widget JS tiny.
            // Upgrade to an inline tooltip later if the volume warrants it.
            alert(
              (err && err.message) ||
                "Couldn't sign up right now. Please try again in a minute.",
            );
          });
      });
    }

    function submitSignup(apiBase, productId, email) {
      var url = apiBase.replace(/\/$/, '') + '/public/restock-notify';
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ product_id: productId, email: email }),
      }).then(function (r) {
        if (r.ok) return r.json().catch(function () { return {}; });
        return r.json().then(function (j) {
          var msg = j && (j.message || j.error || (j.errors && j.errors[0]));
          throw new Error(msg || 'Signup failed (HTTP ' + r.status + ')');
        });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
