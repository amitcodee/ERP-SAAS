export const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0 })

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
const below100 = (n: number) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''))
const below1000 = (n: number) => (n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + below100(n % 100) : '') : below100(n))

/** Indian numbering (crore / lakh / thousand). 1250050 paise -> "Rupees Twelve Thousand Five Hundred and Fifty Paise Only" */
export function rupeesInWords(paise: number): string {
  const rupees = Math.floor(paise / 100), ps = paise % 100
  const parts: string[] = []
  let n = rupees
  for (const [div, name] of [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']] as const) {
    if (n >= div) { parts.push(below1000(Math.floor(n / div)) + ' ' + name); n %= div }
  }
  if (n > 0) parts.push(below1000(n))
  const r = parts.length ? parts.join(' ') : 'Zero'
  return `Rupees ${r}${ps ? ` and ${below100(ps)} Paise` : ''} Only`
}
