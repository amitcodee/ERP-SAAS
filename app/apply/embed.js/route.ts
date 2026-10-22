// The one line an institute pastes into its website where the form should be:
//   <script src="https://<institute address>/apply/embed.js" async></script>
// It places /apply/embed in an iframe right after itself, passing on the page's address, its referrer and the ad /
// post fields (utm_*, gclid, fbclid). Those are remembered for the visit (sessionStorage), so a visitor who came from
// an ad and opened another page first is still counted for the ad. data-branch="<code>" picks the centre.
export const dynamic = 'force-static'

const SCRIPT = `(function () {
  var s = document.currentScript; if (!s) return;
  var origin = new URL(s.src).origin, keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
  var q = new URLSearchParams(location.search), seen = {}, got = false;
  keys.forEach(function (k) { var v = q.get(k); if (v) { seen[k] = v.slice(0, 200); got = true } });
  try { if (got) sessionStorage.setItem('apply_utm', JSON.stringify(seen)); else seen = JSON.parse(sessionStorage.getItem('apply_utm') || '{}') || {} } catch (e) {}
  var p = new URLSearchParams();
  p.set('page', location.href.split('#')[0].slice(0, 1500));
  if (document.referrer) p.set('ref', document.referrer.slice(0, 500));
  if (s.getAttribute('data-branch')) p.set('branch', s.getAttribute('data-branch'));
  keys.forEach(function (k) { if (typeof seen[k] === 'string') p.set(k, seen[k]) });
  var f = document.createElement('iframe');
  f.src = origin + '/apply/embed?' + p.toString();
  f.title = 'Admission form';
  f.setAttribute('loading', 'lazy');
  f.style.cssText = 'display:block;width:100%;max-width:' + (s.getAttribute('data-width') || '560px') + ';height:760px;border:0;margin:0 auto;background:transparent';
  s.parentNode.insertBefore(f, s.nextSibling);
  window.addEventListener('message', function (e) {
    if (e.origin !== origin || e.source !== f.contentWindow || !e.data || e.data.type !== 'apply:height') return;
    var h = Number(e.data.h) || 0; if (h > 200 && h < 5000) f.style.height = h + 'px';
  });
})();
`

export function GET() {
  return new Response(SCRIPT, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } })
}
