(() => {
	const AF_BASE_PATH = '/hardware/screws-and-ironmongery/handles';
	const afIsLocal = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);
	const afNormPath = (pathname) => pathname.replace(/\/+$/, '') || '/';
	const afPagePath = afNormPath(location.pathname);

	// Prod: only fire on the handles PLP (and child paths). Local preview always runs.
	if (!afIsLocal && afPagePath !== AF_BASE_PATH && !afPagePath.startsWith(`${AF_BASE_PATH}/`)) return;

	const afRoot = document.querySelector('.advanced_filters');
	const afScroller = afRoot?.querySelector('.advanced_filters__wrapper');
	if (!afRoot || !afScroller || afRoot.dataset.afReady) return;
	afRoot.dataset.afReady = '1';

	const afPrevBtn = afRoot.querySelector('.advanced_filters__arrow--prev');
	const afNextBtn = afRoot.querySelector('.advanced_filters__arrow--next');
	const afThumb = afRoot.querySelector('.advanced_filters__scrollbar');
	const afTrack = afRoot.querySelector('.advanced_filters__scrollbar-container');

	const afQuery = (sel, el = document) => el.querySelector(sel);
	const afQueryAll = (sel, el = document) => [...el.querySelectorAll(sel)];
	// URL uses Fuller_and_Forge; checkbox value is "Fuller and Forge"
	const afNormalize = (value) =>
		decodeURIComponent(String(value)).replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
	const afValuesEqual = (a, b) => afNormalize(a) === afNormalize(b);
	const afParseUrl = (href) => new URL(href, location.origin);
	const afLinkKey = (href) => {
		const url = afParseUrl(href);
		return afNormPath(url.pathname) + url.search;
	};
	const afLinks = () => afQueryAll('.advanced_filters__item a[href]', afScroller);
	const afFacetBoxes = () => afQueryAll('.filtering-sidebar input.filtering-sidebar__facets-checkbox');
	const afSubmitBtn = () => afQuery('.filtering-sidebar__form-submit, button.js-update-filters');
	const afTriggerClick = (el) => {
		if (!el) return;
		if (window.jQuery) window.jQuery(el).trigger('click');
		else el.click();
	};

	const AF_IGNORE_PARAMS = new Set(['useajax', 'p', 'page', 'sortby', 'spellcheck']);
	let afPendingKey = null;
	let afScrollX = 0;
	let afBusy = false;

	const afMaxScroll = () => Math.max(afScroller.scrollWidth - afScroller.clientWidth, 0);
	const afClampScroll = (x) => Math.max(0, Math.min(afMaxScroll(), x));

	const afWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	/** Poll until `test()` is true or timeout — used to wait out PLP AJAX sidebar rebuilds. */
	const afWaitFor = async (test, { timeout = 2000, interval = 50 } = {}) => {
		const start = Date.now();
		while (Date.now() - start < timeout) {
			if (test()) return true;
			await afWait(interval);
		}
		return test();
	};

	// Local preview stores filter state in #af= — clear on full boot/refresh.
	if (afIsLocal && location.hash.startsWith('#af=')) {
		history.replaceState(null, '', location.pathname + location.search);
	}

	const afMount = () => {
		const nav = afQuery('.product-listing__navigation');
		const listing = afQuery('.js-product-listing');
		if (nav) {
			if (nav.nextElementSibling !== afRoot) nav.after(afRoot);
			return;
		}
		if (listing && listing.previousElementSibling !== afRoot) listing.before(afRoot);
	};
	afMount();

	const afParamsOf = (url) => [...url.searchParams.entries()];

	const afCurrentUrl = () => {
		if (afIsLocal && location.hash.startsWith('#af=')) {
			return new URL(decodeURIComponent(location.hash.slice(4)), location.origin);
		}
		return new URL(location.href);
	};

	const afCurrentEntries = () =>
		[...afCurrentUrl().searchParams.entries()].filter(([key]) => !AF_IGNORE_PARAMS.has(key.toLowerCase()));

	const afIsExactRoundel = (link) => {
		let url;
		try {
			url = afParseUrl(link.href);
		} catch {
			return false;
		}
		if (!afIsLocal && url.origin !== location.origin) return false;

		const liveUrl = afCurrentUrl();
		if (afNormPath(url.pathname) !== afNormPath(afIsLocal ? liveUrl.pathname : location.pathname)) return false;

		const wanted = afParamsOf(url);
		if (!wanted.length) return false;
		const current = afCurrentEntries();
		if (!current.length || current.length !== wanted.length) return false;
		return wanted.every(([name, value]) =>
			current.some(([key, val]) => key === name && afValuesEqual(val, value))
		);
	};

	const afSetActive = (link, sticky = true) => {
		afLinks().forEach((anchor) => {
			anchor.removeAttribute('aria-current');
			anchor.closest('.advanced_filters__item')?.classList.remove('advanced_filters__item--active');
		});
		if (!link) {
			afPendingKey = null;
			afScroller.classList.remove('advanced_filters__wrapper--has-selection');
			return;
		}
		if (sticky) afPendingKey = afLinkKey(link.href);
		link.setAttribute('aria-current', 'true');
		link.closest('.advanced_filters__item')?.classList.add('advanced_filters__item--active');
		afScroller.classList.add('advanced_filters__wrapper--has-selection');
	};

	const afSync = () => {
		if (afPendingKey) {
			const pending = afLinks().find((anchor) => afLinkKey(anchor.href) === afPendingKey);
			if (pending) {
				if (afIsExactRoundel(pending)) afPendingKey = null;
				afSetActive(pending, false);
				return;
			}
		}
		const exact = afLinks()
			.filter(afIsExactRoundel)
			.sort((a, b) => afParamsOf(afParseUrl(b.href)).length - afParamsOf(afParseUrl(a.href)).length)[0];
		if (exact) {
			afSetActive(exact, false);
			return;
		}
		afSetActive(null);
	};

	const afUpdateControls = () => {
		const maxScroll = afMaxScroll();
		const hasOverflow = maxScroll > 1;
		afTrack?.classList.toggle('advanced_filters__scrollbar-container--hidden', !hasOverflow);
		afPrevBtn?.classList.toggle('advanced_filters__arrow--disabled', !hasOverflow || afScroller.scrollLeft <= 1);
		afNextBtn?.classList.toggle('advanced_filters__arrow--disabled', !hasOverflow || afScroller.scrollLeft >= maxScroll - 1);
		if (!afThumb || !afTrack || !hasOverflow) return;
		const thumbWidth = (afScroller.clientWidth / afScroller.scrollWidth) * afTrack.clientWidth;
		afThumb.style.width = `${thumbWidth}px`;
		afThumb.style.transform = `translateX(${(afScroller.scrollLeft / maxScroll) * (afTrack.clientWidth - thumbWidth)}px)`;
	};

	const afStep = (direction) => {
		const item = afQuery('.advanced_filters__item', afScroller);
		if (!item) return;
		const gap = parseFloat(getComputedStyle(afScroller).columnGap || getComputedStyle(afScroller).gap) || 0;
		const delta = direction * (item.getBoundingClientRect().width + gap);
		afScrollX = afClampScroll(afScroller.scrollLeft + delta);
		afScroller.scrollTo({ left: afScrollX, behavior: 'smooth' });
		afUpdateControls();
	};

	const afFindFacet = (name, value) =>
		afFacetBoxes().find((input) => input.name === name && afValuesEqual(input.value, value));

	const afToggleFacet = (input) => {
		const id = CSS.escape(input.id);
		const option =
			afQuery(`a.js-facet-option[data-id="${id}"]`) ||
			afQuery(`label[for="${id}"] a.js-facet-option`);
		if (option) {
			const href = option.getAttribute('href');
			option.removeAttribute('href');
			afTriggerClick(option);
			if (href != null) option.setAttribute('href', href);
			return;
		}
		input.click();
	};

	const afClearFacets = () => {
		const clearBtn = afQuery('.filtering-sidebar .js-clear-filters, .js-clear-filters');
		const hasChecked = afFacetBoxes().some((box) => box.checked);
		const hasUrlFilters = afCurrentEntries().length > 0;
		if (clearBtn && (hasChecked || hasUrlFilters)) {
			afTriggerClick(clearBtn);
			return true;
		}
		let cleared = false;
		afFacetBoxes().forEach((input) => {
			if (!input.checked) return;
			afToggleFacet(input);
			cleared = true;
		});
		return cleared;
	};

	const afSubmitFilters = () => {
		const btn = afSubmitBtn();
		if (!btn) return false;
		if (window.jQuery) window.jQuery(btn).trigger('click');
		else btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
		return true;
	};

	const afAllChecked = (params) =>
		params.every(([name, value]) => Boolean(afFindFacet(name, value)?.checked));

	const afNoneChecked = () => !afFacetBoxes().some((box) => box.checked);

	/**
	 * Seamless exclusive apply via the real sidebar.
	 * Critical: wait for clear/each toggle to settle before the next step — a fixed 100ms
	 * after Clear often lost the race (AJAX rebuilt the sidebar and wiped Fuller / Kitchen).
	 * Polls are short-interval so it still feels instant when the PLP is quick.
	 */
	const afApplyExclusive = async (params) => {
		if (afClearFacets()) {
			await afWaitFor(() => afNoneChecked() && afCurrentEntries().length === 0, {
				timeout: 1200,
				interval: 40,
			});
			await afWait(60);
		}

		for (let i = 0; i < params.length; i += 1) {
			const [name, value] = params[i];
			await afWaitFor(() => Boolean(afFindFacet(name, value)), { timeout: 800, interval: 40 });
			const input = afFindFacet(name, value);
			if (!input) continue;
			if (!input.checked) afToggleFacet(input);
			await afWaitFor(() => Boolean(afFindFacet(name, value)?.checked), {
				timeout: 800,
				interval: 40,
			});
			if (i < params.length - 1) await afWait(80);
		}

		await afWaitFor(() => afAllChecked(params), { timeout: 600, interval: 40 });
		afSubmitFilters();
		await afWait(200);
		afSync();
	};

	const afApply = (link) => {
		let url;
		try {
			url = afParseUrl(link.href);
		} catch {
			return false;
		}
		if (url.origin !== location.origin) return false;

		const params = afParamsOf(url);
		if (afNormPath(url.pathname) !== afPagePath || !params.length) return false;
		if (!afQuery('.filtering-sidebar') || !afSubmitBtn()) return false;
		if (afBusy) return true;

		afScrollX = afScroller.scrollLeft;
		afBusy = true;

		const finish = () => {
			afBusy = false;
			afScroller.scrollLeft = afClampScroll(afScrollX);
			afUpdateControls();
			afSync();
		};

		if (afIsExactRoundel(link)) {
			afSetActive(null);
			(async () => {
				afClearFacets();
				await afWaitFor(() => afNoneChecked(), { timeout: 1200, interval: 40 });
				afSubmitFilters();
				await afWait(200);
			})().finally(finish);
		} else {
			afSetActive(link);
			afApplyExclusive(params).finally(finish);
		}

		return true;
	};

	const afApplyLocal = (link) => {
		let url;
		try {
			url = afParseUrl(link.href);
		} catch {
			return;
		}
		const params = afParamsOf(url);
		const exact = afIsExactRoundel(link);
		const nextUrl = new URL(AF_BASE_PATH, location.origin);

		if (!exact) {
			params.forEach(([name, value]) => nextUrl.searchParams.append(name, value));
			afPendingKey = afLinkKey(link.href);
		} else {
			afPendingKey = null;
		}

		history.pushState(null, '', `#af=${encodeURIComponent(afNormPath(nextUrl.pathname) + nextUrl.search)}`);
		afSync();
	};

	afScroller.addEventListener(
		'click',
		(event) => {
			const link = event.target.closest('a[href]');
			if (!link || !afScroller.contains(link)) return;

			if (afIsLocal) {
				event.preventDefault();
				afApplyLocal(link);
				return;
			}

			if (afApply(link)) {
				event.preventDefault();
				event.stopPropagation();
			}
		},
		true
	);

	afPrevBtn?.addEventListener('click', () => {
		if (!afPrevBtn.classList.contains('advanced_filters__arrow--disabled')) afStep(-1);
	});
	afNextBtn?.addEventListener('click', () => {
		if (!afNextBtn.classList.contains('advanced_filters__arrow--disabled')) afStep(1);
	});

	afScroller.addEventListener(
		'scroll',
		() => {
			afScrollX = afScroller.scrollLeft;
			afUpdateControls();
		},
		{ passive: true }
	);

	window.addEventListener('resize', afUpdateControls);
	window.addEventListener('popstate', afSync);

	['pushState', 'replaceState'].forEach((method) => {
		const afOriginalHistory = history[method];
		history[method] = function (...args) {
			const result = afOriginalHistory.apply(this, args);
			setTimeout(afSync, 0);
			return result;
		};
	});

	const afSidebar = afQuery('.filtering-sidebar');
	afSidebar?.addEventListener('change', () => setTimeout(afSync, 50));
	afSidebar?.addEventListener('listChangeEvent', () => setTimeout(afSync, 100));
	afSubmitBtn()?.addEventListener('click', () => {
		setTimeout(afSync, 100);
		setTimeout(afSync, 500);
		setTimeout(afSync, 1000);
	});
	afQuery('.js-clear-filters')?.addEventListener('click', () => {
		afPendingKey = null;
		setTimeout(afSync, 100);
		setTimeout(afSync, 500);
	});

	new MutationObserver(() => {
		if (!afRoot.isConnected) {
			afMount();
			afSync();
			afScroller.scrollLeft = afClampScroll(afScrollX);
			afUpdateControls();
		}
	}).observe(document.body, { childList: true, subtree: true });

	afSync();
	afUpdateControls();
})();
