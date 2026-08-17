(() => {
    const deck = document.querySelector('.mobile-page-deck');
    const mobileQuery = window.matchMedia('(max-width: 700px)');

    if (!deck) return;

    const getPages = () => Array.from(deck.querySelectorAll('.mobile-page'));
    let progress = null;
    let buttons = [];
    let scrollFrame = null;

    const pageLeft = (page) => page.getBoundingClientRect().left - deck.getBoundingClientRect().left + deck.scrollLeft;

    const setActive = (index) => {
        buttons.forEach((button, buttonIndex) => {
            button.setAttribute('aria-current', buttonIndex === index ? 'true' : 'false');
        });

        const activeButton = buttons[index];
        if (activeButton && progress) {
            const targetLeft = activeButton.offsetLeft - ((progress.clientWidth - activeButton.clientWidth) / 2);
            progress.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
        }
    };

    const updateActivePage = () => {
        scrollFrame = null;
        const pages = getPages();
        if (!pages.length) return;

        let activeIndex = 0;
        let closestDistance = Number.POSITIVE_INFINITY;

        pages.forEach((page, index) => {
            const distance = Math.abs(pageLeft(page) - deck.scrollLeft);
            if (distance < closestDistance) {
                closestDistance = distance;
                activeIndex = index;
            }
        });

        setActive(activeIndex);
    };

    const buildProgress = () => {
        if (!mobileQuery.matches || progress) return;

        const pages = getPages();
        if (pages.length < 2) return;

        progress = document.createElement('nav');
        progress.className = 'mobile-page-progress';
        progress.setAttribute('aria-label', 'Swipe page navigation');

        buttons = pages.map((page, index) => {
            const label = page.dataset.mobilePageLabel || `Page ${index + 1}`;
            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('aria-label', label);
            button.setAttribute('title', label);
            button.setAttribute('aria-current', index === 0 ? 'true' : 'false');
            button.addEventListener('click', () => {
                deck.scrollTo({ left: pageLeft(page), behavior: 'smooth' });
            });
            progress.appendChild(button);
            return button;
        });

        document.body.appendChild(progress);
        updateActivePage();
    };

    const removeProgress = () => {
        progress?.remove();
        progress = null;
        buttons = [];
    };

    deck.addEventListener('scroll', () => {
        if (scrollFrame !== null) return;
        scrollFrame = window.requestAnimationFrame(updateActivePage);
    }, { passive: true });

    document.addEventListener('click', (event) => {
        if (!mobileQuery.matches) return;

        const link = event.target.closest('a[href^="#"]');
        const hash = link?.getAttribute('href');
        if (!hash || hash === '#') return;

        const target = document.querySelector(hash);
        const page = target?.closest('.mobile-page');
        if (!target || !page || !deck.contains(page)) return;

        event.preventDefault();
        deck.scrollTo({ left: pageLeft(page), behavior: 'smooth' });
        window.history.pushState(null, '', hash);

        if (target !== page) {
            window.setTimeout(() => {
                const targetTop = target.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop;
                page.scrollTo({ top: targetTop, behavior: 'smooth' });
            }, 180);
        }
    });

    const handleViewportChange = () => {
        if (mobileQuery.matches) {
            buildProgress();
        } else {
            removeProgress();
            deck.scrollLeft = 0;
        }
    };

    mobileQuery.addEventListener?.('change', handleViewportChange);
    window.addEventListener('resize', updateActivePage, { passive: true });
    handleViewportChange();
})();

