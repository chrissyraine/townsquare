import { useState, useEffect } from 'react';

// gettownsquare.app marketing landing + owner sign-in.
// Self-contained FSS-branded surface (matches the other Forever Still .app pages),
// shown when there's no session. The sign-in posts to the same /api/auth/login the
// hub already uses; on success it hands the session up to App via onLogin.
export default function Landing({ onLogin }) {
  const [slug, setSlug] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // gain a solid nav background once scrolled
  useEffect(() => {
    const nav = document.getElementById('tsnav');
    const onScroll = () => nav && nav.classList.toggle('scrolled', window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ slug: slug.trim(), pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error === 'invalid_login' ? 'Invalid slug or PIN. Please try again.' : (data.error || 'Login failed.'));
      } else {
        onLogin({ slug: data.slug, name: data.name, town: data.town, modules: data.modules || {} });
      }
    } catch {
      setError('Network error connecting to TownSquare.');
    } finally {
      setLoading(false);
    }
  };

  const products = [
    { n: 'The Hearth', d: 'Reviews & retention', t: 'module' },
    { n: 'Belltower', d: 'Bookings & appointments', t: 'module' },
    { n: 'Drawbridge', d: 'Live menus', t: 'module' },
    { n: 'The Herald', d: 'Announcements & hours', t: 'module' },
    { n: 'The Forge', d: 'Design-it-yourself', t: 'launch tile' },
    { n: 'The Courier', d: 'Calls & SMS', t: 'launch tile' },
  ];

  return (
    <div className="tsl">
      <style>{CSS}</style>

      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true"><defs>
        <symbol id="ts-pav" viewBox="0 0 100 100"><path d="M50 14 L84 40 H16 Z M20 40h60v6H20z M26 48h6v26h-6z M44 48h6v26h-6z M62 48h6v26h-6z M74 48h6v26h-6z M16 76h68v7H16z" /></symbol>
        <symbol id="ts-star" viewBox="0 0 24 24"><path d="M12 0 L14 10 L24 12 L14 14 L12 24 L10 14 L0 12 L10 10 Z" /></symbol>
      </defs></svg>

      <nav className="tsl-nav" id="tsnav">
        <div className="tsl-wrap tsl-nav__in">
          <a href="#top" className="tsl-lock">
            <svg className="tsl-lock__mark" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#1c1a18" stroke="rgba(200,169,106,.4)" /><use href="#ts-pav" x="14" y="14" width="72" height="72" fill="var(--g)" /></svg>
            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}><span className="tsl-lock__name">TownSquare</span><span className="tsl-lock__sub">by Forever Still Studio</span></span>
          </a>
          <a href="#signin" className="tsl-navcta">Sign in</a>
        </div>
      </nav>

      <main id="top">
        {/* HERO */}
        <section className="tsl-hero">
          <div className="tsl-glow" aria-hidden="true" />
          <div className="tsl-sparkles" aria-hidden="true">
            <span className="spk" style={{ top: '22%', left: '13%', width: 16, height: 16, '--dur': '9s', '--delay': '0s', '--max': .6 }}><svg viewBox="0 0 24 24"><use href="#ts-star" /></svg></span>
            <span className="spk" style={{ top: '30%', left: '82%', width: 20, height: 20, '--dur': '11s', '--delay': '1.6s', '--max': .5 }}><svg viewBox="0 0 24 24"><use href="#ts-star" /></svg></span>
            <span className="spk" style={{ top: '68%', left: '24%', width: 12, height: 12, '--dur': '8s', '--delay': '3.2s', '--max': .55 }}><svg viewBox="0 0 24 24"><use href="#ts-star" /></svg></span>
          </div>
          <div className="tsl-wrap tsl-hero__in">
            <span className="tsl-script">TownSquare</span>
            <h1 className="tsl-tag">All your tools. <em>One login.</em></h1>
            <p className="tsl-head">The owner hub for your Forever Still toolkit</p>
            <p className="tsl-sub">Stop juggling a different login for every tool. TownSquare brings your reviews, bookings, live menu, and announcements under one roof — one sign-in, every tool, on one beautiful dashboard.</p>
            <div className="tsl-ctas">
              <a href="#signin" className="tsl-btn tsl-btn--p">Sign in to your hub</a>
              <a href="#unifies" className="tsl-btn tsl-btn--g">See what it unifies</a>
            </div>
          </div>
        </section>

        {/* UNIFIES */}
        <section className="tsl-cream" id="unifies">
          <div className="tsl-wrap">
            <div className="tsl-sec"><span className="tsl-eyebrow">One roof</span><div className="tsl-rule" /><h2>Everything, <em>in one place.</em></h2></div>
            <div className="tsl-grid">
              {products.map((p) => (
                <div className="tsl-card" key={p.n}>
                  <div className="tsl-card__top"><span className="tsl-card__name">{p.n}</span><span className="tsl-card__tag">{p.t}</span></div>
                  <p>{p.d}</p>
                </div>
              ))}
              <div className="tsl-card tsl-card--more">
                <div className="tsl-card__top"><span className="tsl-card__name">More, anytime</span></div>
                <p>Add a tool whenever you're ready — it just appears as a new tab in your hub.</p>
              </div>
            </div>
          </div>
        </section>

        {/* HOW */}
        <section id="how">
          <div className="tsl-wrap">
            <div className="tsl-sec"><span className="tsl-eyebrow" style={{ display: 'block', textAlign: 'center' }}>How it works</span><div className="tsl-rule" /><h2 style={{ color: 'var(--text)', textAlign: 'center' }}>One door to <em style={{ color: 'var(--blush)' }}>all of it.</em></h2></div>
            <div className="tsl-steps">
              <div className="tsl-step"><div className="tsl-step__n">1</div><h3>Sign in once</h3><p>One TownSquare login — no more remembering a PIN for every separate tool.</p></div>
              <div className="tsl-step"><div className="tsl-step__n">2</div><h3>Manage every tool</h3><p>Your reviews, bookings, menu, and announcements each become a tab on one dashboard.</p></div>
              <div className="tsl-step"><div className="tsl-step__n">3</div><h3>Grow when ready</h3><p>Turn on a new tool and it slots right in. Each still works on its own, too.</p></div>
            </div>
          </div>
        </section>

        {/* SIGN IN */}
        <section className="tsl-cream" id="signin">
          <div className="tsl-wrap tsl-wrap--narrow">
            <div className="tsl-sec"><span className="tsl-eyebrow">Owner sign-in</span><div className="tsl-rule" /><h2>Enter <em>your hub.</em></h2></div>
            <form className="tsl-form" onSubmit={handleSubmit} noValidate>
              <label htmlFor="ts-slug">Business slug</label>
              <input id="ts-slug" type="text" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="your-business" autoComplete="username" required />
              <label htmlFor="ts-pin">Access PIN</label>
              <input id="ts-pin" type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••••" inputMode="numeric" autoComplete="current-password" required />
              {error && <div className="tsl-err">{error}</div>}
              <button type="submit" className="tsl-btn tsl-btn--p tsl-form__submit" disabled={loading}>{loading ? 'Authenticating…' : 'Enter the hub'}</button>
            </form>
            <p className="tsl-form__note">New to TownSquare? <a href="mailto:chrissy@foreverstillstudio.com?subject=TownSquare%20%E2%80%94%20set%20me%20up">Ask Chrissy to set you up.</a></p>
          </div>
        </section>

        {/* FAMILY */}
        <section className="tsl-family" id="family">
          <div className="tsl-wrap tsl-wrap--narrow">
            <p className="tsl-eyebrow">Part of the Forever Still family</p>
            <h2>Quietly powerful tools, <em>built by a real person.</em></h2>
            <p>TownSquare is made by <a href="https://www.foreverstillstudio.com" target="_blank" rel="noopener" style={{ color: 'var(--g)' }}>Forever Still Studio</a> — boutique web design and software for local businesses. Same care, same hands-on support, same person who answers her own phone.</p>
            <div className="tsl-sibs">
              <span className="tsl-sib"><b>The Hearth</b> · reviews</span>
              <span className="tsl-sib"><b>Belltower</b> · booking</span>
              <span className="tsl-sib"><b>Drawbridge</b> · live menus</span>
              <span className="tsl-sib"><b>The Forge</b> · design-it-yourself</span>
              <span className="tsl-sib"><b>The Courier</b> · calls &amp; SMS</span>
            </div>
          </div>
        </section>
      </main>

      <footer className="tsl-foot">
        <div className="tsl-wrap">
          <svg className="tsl-foot__mark" viewBox="0 0 100 100"><use href="#ts-pav" fill="var(--g)" /></svg>
          <div className="tsl-foot__brand">Town<span>Square</span></div>
          <p>By <a href="https://www.foreverstillstudio.com" target="_blank" rel="noopener">Forever Still Studio</a> · one hub for your whole toolkit</p>
        </div>
      </footer>
    </div>
  );
}

const CSS = `
.tsl{--bg:#121212;--bg-soft:#161616;--bg-warm:#1c1a18;--g:#C8A96A;--g-ink:#7a6228;--blush:#d4a5a5;
  --text:#F4EDE0;--text-muted:#b9ad9f;--text-soft:#E8DFD0;--rule:rgba(200,169,106,.30);--cream:#F4EDE0;--ink:#1A1A1A;--ink-soft:#4a423a;
  --disp:'Cormorant Garamond',Georgia,serif;--script:'Tangerine',cursive;--sans:'Montserrat',system-ui,sans-serif;
  background:var(--bg);color:var(--text);font-family:var(--sans);font-size:17px;line-height:1.7;-webkit-font-smoothing:antialiased}
.tsl a{color:inherit;text-decoration:none}
.tsl em{font-style:italic}
.tsl-wrap{width:100%;max-width:1080px;margin:0 auto;padding:0 40px}
.tsl-wrap--narrow{max-width:720px}
.tsl section{padding:100px 0;position:relative}
.tsl-eyebrow{font-size:11px;font-weight:600;letter-spacing:.28em;text-transform:uppercase;color:var(--g)}
.tsl-rule{width:48px;height:1px;background:var(--g);margin:18px auto 26px}
.tsl h2{font-family:var(--disp);font-weight:300;line-height:1.12;font-size:clamp(2rem,4.4vw,3rem)}
.tsl-btn{display:inline-block;font-family:var(--sans);font-size:11px;font-weight:500;letter-spacing:.18em;text-transform:uppercase;padding:14px 32px;border:1px solid currentColor;cursor:pointer;transition:background .25s,color .25s}
.tsl-btn--p{background:var(--g);border-color:var(--g);color:#121212}
.tsl-btn--p:hover{background:transparent;color:var(--g)}
.tsl-btn--g{background:transparent;border-color:var(--g);color:var(--g)}
.tsl-btn--g:hover{background:var(--g);color:#121212}

.tsl-nav{position:fixed;top:0;left:0;right:0;z-index:100;padding:16px 0;transition:background .4s}
.tsl-nav.scrolled{background:rgba(13,11,11,.92);backdrop-filter:blur(12px);border-bottom:1px solid var(--rule)}
.tsl-nav__in{display:flex;align-items:center;justify-content:space-between}
.tsl-lock{display:flex;align-items:center;gap:12px}
.tsl-lock__mark{width:42px;height:42px;flex:none}
.tsl-lock__name{font-family:var(--disp);font-size:24px;font-weight:400;color:var(--text);line-height:1}
.tsl-lock__sub{font-size:8.5px;font-weight:600;letter-spacing:.24em;text-transform:uppercase;color:var(--g);margin-top:4px}
.tsl-navcta{display:inline-flex;align-items:center;min-height:40px;font-size:11px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:var(--g);border:1px solid var(--g);padding:0 22px;transition:background .2s,color .2s}
.tsl-navcta:hover{background:var(--g);color:var(--bg)}

.tsl-hero{min-height:92vh;display:flex;align-items:center;text-align:center;overflow:hidden;padding:140px 0 70px}
.tsl-glow{position:absolute;inset:0;z-index:0;pointer-events:none;opacity:.6}
.tsl-glow::before{content:"";position:absolute;inset:0;background:radial-gradient(50% 42% at 50% -2%,color-mix(in srgb,var(--g) 30%,transparent),transparent 64%),radial-gradient(46% 38% at 50% 108%,color-mix(in srgb,var(--g) 24%,transparent),transparent 62%)}
.tsl-sparkles{position:absolute;inset:0;z-index:1;pointer-events:none;overflow:hidden}
.tsl-sparkles .spk{position:absolute;color:var(--g);opacity:0;animation:tslspk var(--dur,10s) ease-in-out infinite;animation-delay:var(--delay,0s)}
.tsl-sparkles .spk svg{display:block;width:100%;height:100%;fill:currentColor}
@keyframes tslspk{0%{opacity:0;transform:translateY(12px) scale(.6)}20%,80%{opacity:var(--max,.55)}50%{opacity:var(--max,.55);transform:translateY(-14px) scale(1) rotate(18deg)}100%{opacity:0;transform:translateY(-34px) scale(.6)}}
.tsl-hero__in{position:relative;z-index:2}
.tsl-script{font-family:var(--script);font-size:42px;line-height:1.15;color:var(--g);display:block;margin-bottom:4px}
.tsl-tag{font-family:var(--disp);font-size:clamp(44px,6.6vw,78px);font-weight:300;line-height:1.05;letter-spacing:-.01em;color:var(--text);margin-bottom:22px}
.tsl-tag em{color:var(--blush)}
.tsl-head{font-family:var(--sans);font-size:13px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--g);opacity:.85;margin-bottom:1.6rem}
.tsl-sub{font-size:16px;font-weight:300;color:var(--text-muted);line-height:1.85;max-width:620px;margin:0 auto 38px}
.tsl-ctas{display:flex;gap:16px;justify-content:center;flex-wrap:wrap}

.tsl-cream{background:var(--cream);color:var(--ink);border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
.tsl-cream h2{color:var(--ink)}
.tsl-cream h2 em{color:var(--g-ink)}
.tsl-cream .tsl-eyebrow{color:var(--g-ink)}
.tsl-sec{text-align:center;margin-bottom:3.2rem}
.tsl-sec h2{margin-top:.3rem}

.tsl-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--rule);border:1px solid var(--rule)}
.tsl-card{background:var(--cream);padding:2rem;transition:background .2s}
.tsl-card:hover{background:#efe6d6}
.tsl-card__top{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:.4rem}
.tsl-card__name{font-family:var(--disp);font-size:1.5rem;font-weight:400;color:var(--ink)}
.tsl-card__tag{font-size:9px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--g-ink);border:1px solid rgba(168,137,74,.45);border-radius:2px;padding:3px 8px;white-space:nowrap}
.tsl-card p{font-size:14px;color:var(--ink-soft);line-height:1.7}
.tsl-card--more{background:#efe6d6}

.tsl-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:2.5rem}
.tsl-step{text-align:center;position:relative}
.tsl-step:not(:last-child)::after{content:'';position:absolute;top:1.4rem;right:-1.25rem;width:2.5rem;height:1px;background:linear-gradient(to right,var(--g),rgba(200,169,106,.15))}
.tsl-step__n{font-family:var(--disp);font-style:italic;font-size:3.2rem;color:var(--g);line-height:1;margin-bottom:.5rem}
.tsl-step h3{font-family:var(--disp);color:var(--text);font-size:1.45rem;font-weight:400;margin-bottom:.4rem}
.tsl-step p{font-size:14px;color:var(--text-muted);line-height:1.8}

.tsl-form{max-width:440px;margin:0 auto;text-align:left}
.tsl-form label{display:block;font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--g-ink);margin:0 0 .4rem}
.tsl-form input{width:100%;background:#fffaf3;border:1px solid var(--rule);color:var(--ink);font-family:var(--sans);font-size:15px;padding:13px 15px;margin-bottom:1.1rem;outline:none;transition:border-color .2s}
.tsl-form input:focus{border-color:var(--g)}
.tsl-form__submit{width:100%;margin-top:.4rem}
.tsl-err{color:#b4452f;font-size:13px;margin-bottom:1rem}
.tsl-form__note{text-align:center;font-size:13px;color:var(--ink-soft);margin-top:1.4rem}
.tsl-form__note a{color:var(--g-ink);border-bottom:1px solid rgba(168,137,74,.4)}

.tsl-family{text-align:center;padding:80px 0}
.tsl-family .tsl-eyebrow{color:var(--g)}
.tsl-family h2{color:var(--text);margin:1rem 0}
.tsl-family h2 em{color:var(--blush)}
.tsl-family p{font-size:15px;color:var(--text-muted);max-width:580px;margin:0 auto;line-height:1.85}
.tsl-sibs{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-top:1.6rem}
.tsl-sib{font-size:11px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--text-soft);border:1px solid var(--rule);padding:8px 18px}
.tsl-sib b{color:var(--g);font-weight:600}

.tsl-foot{padding:2.75rem 0;border-top:1px solid var(--rule);text-align:center;background:var(--bg)}
.tsl-foot__mark{width:38px;height:38px;margin:0 auto .7rem}
.tsl-foot__brand{font-family:var(--disp);font-size:1.6rem;color:var(--text)}
.tsl-foot__brand span{color:var(--g)}
.tsl-foot p{font-size:12px;letter-spacing:.06em;color:var(--text-muted);margin-top:.5rem}
.tsl-foot a{color:var(--g)}

@media(max-width:900px){.tsl-grid,.tsl-steps{grid-template-columns:1fr;gap:2.2rem}.tsl-step:not(:last-child)::after{display:none}.tsl-grid{gap:1px}}
@media(max-width:768px){.tsl section{padding:72px 0}.tsl-wrap{padding:0 24px}.tsl-ctas{flex-direction:column}.tsl-ctas .tsl-btn{text-align:center}}
@media(prefers-reduced-motion:reduce){.tsl-sparkles .spk{animation:none}}
`;
