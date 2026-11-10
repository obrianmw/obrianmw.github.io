// Shared behaviour for every page: theme toggle, mobile menu, scroll reveal, image lightbox

const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// Theme toggle: flips between light and dark, remembers the choice
document.querySelector('.theme-toggle')?.addEventListener('click', () => {
    const root = document.documentElement;
    const isDark = root.dataset.theme
        ? root.dataset.theme === 'dark'
        : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = isDark ? 'light' : 'dark';
    try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
});

// Mobile menu
const menuButton = document.querySelector('.menu-toggle');
const navLinks = document.querySelector('.nav-links');
if (menuButton && navLinks) {
    const setOpen = (open) => {
        navLinks.classList.toggle('is-open', open);
        menuButton.setAttribute('aria-expanded', String(open));
    };
    menuButton.addEventListener('click', () => setOpen(!navLinks.classList.contains('is-open')));
    navLinks.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setOpen(false)));
}

// Fade sections in as they scroll into view
if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                revealObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.08 });

    document.querySelectorAll('.section').forEach(el => {
        el.classList.add('reveal');
        revealObserver.observe(el);
    });
}

// Lightbox: any link with data-lightbox opens its image full size
const lightbox = document.querySelector('.lightbox');
if (lightbox) {
    const img = lightbox.querySelector('img');
    const caption = lightbox.querySelector('figcaption');
    document.querySelectorAll('a[data-lightbox]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const thumb = link.querySelector('img');
            img.src = link.href;
            img.alt = thumb ? thumb.alt : '';
            caption.textContent = link.dataset.caption || (thumb ? thumb.alt : '');
            lightbox.showModal();
        });
    });
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox || e.target.closest('.lightbox-close')) lightbox.close();
    });
}
