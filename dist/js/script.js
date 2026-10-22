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
	const afValuesEqual = (a, b) => a === b || a.replace(/_/g, ' ') === b.replace(/_/g, ' ');
	const afParseUrl = (href) => new URL(href, location.origin);
	const afLinkKey = (href) => {
		const url = afParseUrl(href);
		return afNormPath(url.pathname) + url.search;
	};
	const afLinks = () => afQueryAll('.advanced_filters__item a[href]', afScroller);
	const afFacetBoxes = () => afQueryAll('.filtering-sidebar input.filtering-sidebar__facets-checkbox');
	const afSubmitBtn = () => afQuery('.filtering-sidebar__form-submit, button.js-update-filters');
	const afDefer = (fn, delays) => delays.forEach((ms, i) => setTimeout(() => fn(i), ms));
	const afTriggerClick = (el) => {
		if (!el) return;
		if (window.jQuery) window.jQuery(el).trigger('click');
		else el.click();
	};

	const AF_IGNORE_PARAMS = new Set(['useajax', 'p', 'page', 'sortby', 'spellcheck']);
	let afPendingKey = null;
	let afScrollX = 0;
	let afKeepScroll = false;

	// Local preview stores filter state in #af= — clear on full boot/refresh.
	if (afIsLocal && location.hash.startsWith('#af=')) {
		history.replaceState(null, '', location.pathname + location.search);
	}

	const afIsReload = performance.getEntriesByType?.('navigation')?.[0]?.type === 'reload';
	if (!afIsLocal && afIsReload && (location.search || afPagePath !== AF_BASE_PATH)) {
		location.replace(AF_BASE_PATH);
		return;
	}

	const afMount = () => {
		const nav = afQuery('.product-listing__navigation');
		const listing = afQuery('.js-product-listing');
		if (nav) nav.after(afRoot);
		else if (listing) listing.before(afRoot);
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
		const exact = afLinks().find(afIsExactRoundel);
		if (exact) {
			afPendingKey = null;
			afSetActive(exact, false);
			return;
		}
		if (afPendingKey) {
			const link = afLinks().find((anchor) => afLinkKey(anchor.href) === afPendingKey);
			if (link) {
				afSetActive(link, false);
				return;
			}
		}
		afSetActive(null);
	};

	const afUpdateControls = () => {
		const maxScroll = Math.max(afScroller.scrollWidth - afScroller.clientWidth, 0);
		const hasOverflow = maxScroll > 1;
		afTrack?.classList.toggle('advanced_filters__scrollbar-container--hidden', !hasOverflow);
		afPrevBtn?.classList.toggle('advanced_filters__arrow--disabled', afScroller.scrollLeft <= 1);
		afNextBtn?.classList.toggle('advanced_filters__arrow--disabled', afScroller.scrollLeft >= maxScroll - 1);
		if (!afThumb || !afTrack || !hasOverflow) return;
		const thumbWidth = (afScroller.clientWidth / afScroller.scrollWidth) * afTrack.clientWidth;
		afThumb.style.width = `${thumbWidth}px`;
		afThumb.style.transform = `translateX(${(afScroller.scrollLeft / maxScroll) * (afTrack.clientWidth - thumbWidth)}px)`;
	};

	const afRefresh = () => {
		afSync();
		if (afKeepScroll) {
			afScroller.scrollLeft = afScrollX;
			afUpdateControls();
		}
	};

	const afStep = (direction) => {
		const item = afQuery('.advanced_filters__item', afScroller);
		if (!item) return;
		const gap = parseFloat(getComputedStyle(afScroller).columnGap || getComputedStyle(afScroller).gap) || 0;
		afScroller.scrollBy({ left: direction * (item.getBoundingClientRect().width + gap), behavior: 'smooth' });
	};

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

	/** Turn on only the roundel's facets (assumes prior filters already cleared). */
	const afEnableFacets = (params) => {
		afFacetBoxes().forEach((input) => {
			const shouldCheck = params.some(([name, value]) => input.name === name && afValuesEqual(input.value, value));
			if (shouldCheck && !input.checked) afToggleFacet(input);
		});
	};

	/**
	 * Wipe every active filter. Prefer the site Clear control so URL-only / chip-only
	 * selections (where the checkbox has left the DOM) are removed too.
	 * @returns {boolean} true when a clear was attempted (caller should wait before re-applying).
	 */
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

	const afAfterApply = () => {
		afDefer((i) => {
			if (afPendingKey && afLinks().some((anchor) => afLinkKey(anchor.href) === afPendingKey && afIsExactRoundel(anchor))) {
				afPendingKey = null;
			}
			afRefresh();
			if (i === 2) afKeepScroll = false;
		}, [100, 500, 1000]);
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

		afScrollX = afScroller.scrollLeft;
		afKeepScroll = true;

		// Clear-then-set so switching Chrome → Black (etc.) never stacks prior colours
		// when the previous checkbox has disappeared from the sidebar after AJAX.
		if (afIsExactRoundel(link)) {
			afClearFacets();
			afSetActive(null);
			setTimeout(() => {
				afSubmitFilters();
				afAfterApply();
			}, 50);
		} else {
			afSetActive(link);
			const needsSettle = afClearFacets();
			setTimeout(
				() => {
					afEnableFacets(params);
					setTimeout(() => {
						afSubmitFilters();
						afAfterApply();
					}, 50);
				},
				needsSettle ? 120 : 0
			);
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
			if (!afKeepScroll) afScrollX = afScroller.scrollLeft;
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
	afSubmitBtn()?.addEventListener('click', () => afDefer(() => afSync(), [100, 500, 1000]));
	afQuery('.js-clear-filters')?.addEventListener('click', () => {
		afPendingKey = null;
		afDefer(() => afSync(), [100, 500]);
	});

	new MutationObserver(() => {
		if (!afRoot.isConnected) {
			afMount();
			afRefresh();
		} else if (afKeepScroll) {
			afRefresh();
		}
	}).observe(document.body, { childList: true, subtree: true });

	if (afIsLocal || afIsReload || (!location.search && afPagePath === AF_BASE_PATH)) afSetActive(null);
	else afSync();
	afUpdateControls();
})();
