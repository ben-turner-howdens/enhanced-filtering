(() => {
	const root = document.querySelector('.advanced_filters');
	const scroller = root?.querySelector('.advanced_filters__wrapper');
	const prev = root?.querySelector('.advanced_filters__arrow--prev');
	const next = root?.querySelector('.advanced_filters__arrow--next');
	const thumb = root?.querySelector('.advanced_filters__scrollbar');
	const track = root?.querySelector('.advanced_filters__scrollbar-container');
	if (!root || !scroller) return;

	const q = (sel, el = document) => el.querySelector(sel);
	const qa = (sel, el = document) => [...el.querySelectorAll(sel)];
	const path = (p) => p.replace(/\/+$/, '') || '/';
	const eq = (a, b) => a === b || a.replace(/_/g, ' ') === b.replace(/_/g, ' ');
	const keyOf = (href) => {
		const u = new URL(href, location.origin);
		return path(u.pathname) + u.search;
	};
	const links = () => qa('.advanced_filters__item a[href]', scroller);

	const isLocal = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);
	const BASE_PATH = '/hardware/screws-and-ironmongery/handles';
	let pending = null;
	let scrollX = 0;
	let keepScroll = false;

	// Full page load/refresh should not restore roundel filters.
	// Local preview stores state in #af= via pushState — strip it whenever the script
	// boots (clicks don't re-run this file; refresh does).
	if (isLocal && location.hash.startsWith('#af=')) {
		history.replaceState(null, '', location.pathname + location.search);
	}

	const navEntry = performance.getEntriesByType?.('navigation')?.[0];
	const isPageReload =
		navEntry?.type === 'reload' ||
		(typeof performance.navigation !== 'undefined' && performance.navigation.type === 1);

	if (!isLocal && isPageReload) {
		const current = path(location.pathname);
		const base = path(BASE_PATH);
		const onSection = current === base || current.startsWith(`${base}/`);
		// Query facets (?colour=…) or path facets (/door-handles) both reset to the base PLP.
		if (onSection && (location.search || current !== base)) {
			location.replace(BASE_PATH);
			return;
		}
	}

	const mount = () => {
		const nav = q('.product-listing__navigation');
		const listing = q('.js-product-listing');
		if (nav) nav.after(root);
		else if (listing) listing.before(root);
	};
	mount();

	const boxes = () => qa('.filtering-sidebar input.filtering-sidebar__facets-checkbox');
	const submitBtn = () => q('.filtering-sidebar__form-submit, button.js-update-filters');

	const paramsOf = (linkOrUrl) => {
		const u = linkOrUrl instanceof URL ? linkOrUrl : new URL(linkOrUrl.href, location.origin);
		return [...u.searchParams.entries()];
	};

	const currentUrl = () => {
		if (isLocal && location.hash.startsWith('#af=')) {
			return new URL(decodeURIComponent(location.hash.slice(4)), location.origin);
		}
		return new URL(location.href);
	};

	const IGNORE_PARAMS = new Set(['useajax', 'p', 'page', 'sortby', 'spellcheck']);

	const currentEntries = () =>
		[...currentUrl().searchParams.entries()].filter(([key]) => !IGNORE_PARAMS.has(key.toLowerCase()));

	/** Exact match: this roundel's params are the full current filter set. */
	const isExactRoundel = (link) => {
		const u = new URL(link.href, location.origin);
		if (path(u.pathname) !== path(location.pathname)) return false;

		const wanted = paramsOf(u);
		if (!wanted.length) return false;

		const current = currentEntries();
		if (!current.length || current.length !== wanted.length) return false;

		return wanted.every(([name, value]) =>
			current.some(([k, v]) => k === name && eq(v, value))
		);
	};

	const setActive = (link, { sticky = true } = {}) => {
		links().forEach((a) => {
			a.removeAttribute('aria-current');
			a.closest('.advanced_filters__item')?.classList.remove('advanced_filters__item--active');
		});

		if (!link) {
			pending = null;
			scroller.classList.remove('advanced_filters__wrapper--has-selection');
			return;
		}

		if (sticky) pending = keyOf(link.href);
		link.setAttribute('aria-current', 'true');
		link.closest('.advanced_filters__item')?.classList.add('advanced_filters__item--active');
		scroller.classList.add('advanced_filters__wrapper--has-selection');
	};

	const sync = () => {
		const exact = links().find((link) => isExactRoundel(link));
		if (exact) {
			pending = null;
			setActive(exact, { sticky: false });
			return;
		}

		if (pending) {
			const link = links().find((a) => keyOf(a.href) === pending);
			if (link) {
				setActive(link, { sticky: false });
				return;
			}
		}

		// No active filter — keep every roundel fully solid.
		setActive(null);
	};

	const restore = () => {
		if (!keepScroll) return;
		scroller.scrollLeft = scrollX;
		controls();
	};

	const refresh = () => {
		sync();
		restore();
	};

	const controls = () => {
		const max = Math.max(scroller.scrollWidth - scroller.clientWidth, 0);
		const overflow = max > 1;
		track?.classList.toggle('advanced_filters__scrollbar-container--hidden', !overflow);
		prev?.classList.toggle('advanced_filters__arrow--disabled', scroller.scrollLeft <= 1);
		next?.classList.toggle('advanced_filters__arrow--disabled', scroller.scrollLeft >= max - 1);
		if (!thumb || !track || !overflow) return;
		const w = (scroller.clientWidth / scroller.scrollWidth) * track.clientWidth;
		thumb.style.width = `${w}px`;
		thumb.style.transform = `translateX(${(scroller.scrollLeft / max) * (track.clientWidth - w)}px)`;
	};

	const step = (dir) => {
		const item = q('.advanced_filters__item', scroller);
		if (!item) return;
		const gap = parseFloat(getComputedStyle(scroller).columnGap || getComputedStyle(scroller).gap) || 0;
		scroller.scrollBy({ left: dir * (item.getBoundingClientRect().width + gap), behavior: 'smooth' });
	};

	const toggleFacet = (input) => {
		const option =
			q(`a.js-facet-option[data-id="${CSS.escape(input.id)}"]`) ||
			q(`label[for="${CSS.escape(input.id)}"] a.js-facet-option`);

		if (option) {
			const href = option.getAttribute('href');
			option.removeAttribute('href');
			if (window.jQuery) window.jQuery(option).trigger('click');
			else option.click();
			if (href != null) option.setAttribute('href', href);
			return;
		}

		input.click();
	};

	/** Replace all sidebar filters with exactly this roundel's params. */
	const setExclusiveFacets = (params) => {
		const wanted = [...params];
		boxes().forEach((input) => {
			const shouldCheck = wanted.some(([name, value]) => input.name === name && eq(input.value, value));
			if (input.checked !== shouldCheck) toggleFacet(input);
		});
	};

	const clearFacets = () => {
		const clearBtn = q('.filtering-sidebar .js-clear-filters, .js-clear-filters');
		if (clearBtn && boxes().some((b) => b.checked)) {
			if (window.jQuery) window.jQuery(clearBtn).trigger('click');
			else clearBtn.click();
			return;
		}
		boxes().forEach((input) => {
			if (input.checked) toggleFacet(input);
		});
	};

	const submitFilters = () => {
		const btn = submitBtn();
		if (!btn) return false;
		if (window.jQuery) window.jQuery(btn).trigger('click');
		else btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
		return true;
	};

	const scheduleRefresh = () => {
		[100, 500, 1000].forEach((ms, i) => setTimeout(() => {
			if (pending && links().some((a) => keyOf(a.href) === pending && isExactRoundel(a))) {
				pending = null;
			}
			refresh();
			if (i === 2) keepScroll = false;
		}, ms));
	};

	const apply = (link) => {
		const u = new URL(link.href, location.origin);
		const params = paramsOf(u);
		if (path(u.pathname) !== path(location.pathname) || !params.length) return false;
		if (!q('.filtering-sidebar') || !submitBtn()) return false;

		scrollX = scroller.scrollLeft;
		keepScroll = true;

		if (isExactRoundel(link)) {
			clearFacets();
			setActive(null);
		} else {
			setActive(link);
			setExclusiveFacets(params);
		}

		setTimeout(() => {
			submitFilters();
			scheduleRefresh();
		}, 50);

		return true;
	};

	const applyLocal = (link) => {
		const u = new URL(link.href, location.origin);
		const params = paramsOf(u);
		const exact = isExactRoundel(link);

		const next = new URL(BASE_PATH, location.origin);
		if (!exact) {
			params.forEach(([name, value]) => next.searchParams.append(name, value));
			pending = keyOf(link.href);
		} else {
			pending = null;
		}

		history.pushState(null, '', `#af=${encodeURIComponent(path(next.pathname) + next.search)}`);
		sync();
	};

	scroller.addEventListener('click', (e) => {
		const link = e.target.closest('a[href]');
		if (!link || !scroller.contains(link)) return;

		if (isLocal) {
			e.preventDefault();
			applyLocal(link);
			return;
		}

		if (apply(link)) {
			e.preventDefault();
			e.stopPropagation();
		}
	}, true);

	prev?.addEventListener('click', () => {
		if (!prev.classList.contains('advanced_filters__arrow--disabled')) step(-1);
	});
	next?.addEventListener('click', () => {
		if (!next.classList.contains('advanced_filters__arrow--disabled')) step(1);
	});

	scroller.addEventListener('scroll', () => {
		if (!keepScroll) scrollX = scroller.scrollLeft;
		controls();
	}, { passive: true });

	window.addEventListener('resize', controls);
	window.addEventListener('popstate', sync);

	['pushState', 'replaceState'].forEach((method) => {
		const original = history[method];
		history[method] = function (...args) {
			const result = original.apply(this, args);
			setTimeout(sync, 0);
			return result;
		};
	});

	const sidebarEl = q('.filtering-sidebar');
	sidebarEl?.addEventListener('change', () => setTimeout(sync, 50));
	sidebarEl?.addEventListener('listChangeEvent', () => setTimeout(sync, 100));
	submitBtn()?.addEventListener('click', () => {
		[100, 500, 1000].forEach((ms) => setTimeout(sync, ms));
	});
	q('.js-clear-filters')?.addEventListener('click', () => {
		pending = null;
		[100, 500].forEach((ms) => setTimeout(sync, ms));
	});

	new MutationObserver(() => {
		if (!root.isConnected) {
			mount();
			refresh();
		} else if (keepScroll) {
			refresh();
		}
	}).observe(document.body, { childList: true, subtree: true });

	// After a full load, only restore highlight from a live (non-reload) filtered URL.
	if (isLocal || isPageReload || (!location.search && path(location.pathname) === path(BASE_PATH))) {
		pending = null;
		setActive(null);
	} else {
		sync();
	}
	controls();
})();
