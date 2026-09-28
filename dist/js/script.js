const carousel = document.querySelector('.filter-wrapper');

if (carousel) {
	let startX = 0;
	let startScrollLeft = 0;
	let isDragging = false;
	let suppressClick = false;

	carousel.addEventListener('pointerdown', (event) => {
		if (event.pointerType === 'mouse' && event.button !== 0) return;

		isDragging = true;
		suppressClick = false;
		startX = event.clientX;
		startScrollLeft = carousel.scrollLeft;
	});

	carousel.addEventListener('pointermove', (event) => {
		if (!isDragging) return;

		const distance = event.clientX - startX;
		suppressClick = suppressClick || Math.abs(distance) > 5;
		if (suppressClick && !carousel.hasPointerCapture(event.pointerId)) {
			carousel.setPointerCapture(event.pointerId);
			carousel.classList.add('is-dragging');
		}
		carousel.scrollLeft = startScrollLeft - distance;
	});

	const stopDragging = (event) => {
		if (!isDragging) return;

		isDragging = false;
		carousel.classList.remove('is-dragging');
		if (carousel.hasPointerCapture(event.pointerId)) {
			carousel.releasePointerCapture(event.pointerId);
		}
	};

	carousel.addEventListener('pointerup', stopDragging);
	carousel.addEventListener('pointercancel', stopDragging);

	carousel.addEventListener('click', (event) => {
		if (suppressClick) {
			event.preventDefault();
			event.stopPropagation();
			suppressClick = false;
		}
	}, true);
}