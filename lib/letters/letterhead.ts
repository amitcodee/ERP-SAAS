// A plain letterhead for a company that has none uploaded yet: the name at the top, the contact at the foot, as a
// full A4 page (SVG) the letter is printed on, like public/letterhead.jpg. The text box sits between 34 mm and 263 mm
// from the top (app/globals.css .lt-text), so the header and footer stay outside it.
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export function plainLetterhead(c: { name: string; legalName: string; contactPhone?: string | null; contactEmail?: string | null }): string {
  const navy = '#0a1d6b'
  const contact = [c.contactPhone, c.contactEmail].filter(Boolean).join('   ·   ')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297">
<rect width="210" height="297" fill="#fff"/>
<rect x="0" y="0" width="5" height="297" fill="${navy}"/>
<text x="22" y="19" font-family="Poppins, Arial, sans-serif" font-size="10" font-weight="700" fill="${navy}">${esc(c.name)}</text>
${c.legalName && c.legalName !== c.name ? `<text x="22" y="25.5" font-family="Arial, sans-serif" font-size="3.4" fill="#4b5263">${esc(c.legalName)}</text>` : ''}
<rect x="22" y="28.5" width="172" height="0.5" fill="${navy}"/>
<rect x="22" y="268" width="172" height="0.3" fill="#9aa3c0"/>
${contact ? `<text x="22" y="274" font-family="Arial, sans-serif" font-size="3.2" fill="#4b5263">${esc(contact)}</text>` : ''}
<rect x="0" y="289" width="210" height="8" fill="${navy}"/>
</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
