// Shared with the browser: labels and the row shape, no server code.
export const DOC_KINDS = { photo: 'Photo', id_proof: 'ID proof', marksheet: 'Marksheet / certificate', payment_proof: 'Payment proof', payment_slip: 'Paper slip', other: 'Other' } as const
export type DocKind = keyof typeof DOC_KINDS
export type DocumentRow = {
  id: string; kind: DocKind; fileName: string; mime: string; sizeBytes: number; uploadedAt: string; uploadedBy: string | null
  /** For a proof of payment or a paper slip: the payment it belongs to. `nth` = 1 for the student's first payment, 2 for the second... */
  payment: { receiptNo: string; amount: number; nth: number } | null
}
/** "1st", "2nd", "3rd", "4th"... */
export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
/** What a document is, in words: "Proof of payment · 1st installment". */
export const docLabel = (d: DocumentRow) => (d.payment ? `${d.kind === 'payment_slip' ? 'Paper slip' : 'Proof of payment'} · ${ordinal(d.payment.nth)} installment` : DOC_KINDS[d.kind] ?? d.kind)
