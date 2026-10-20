import { NextResponse } from 'next/server'

/**
 * A redirect to a path on the host the browser asked for. Route handlers see the server's own address in req.url (on
 * a subdomain that is not the visitor's host), so `new URL(path, req.url)` would send them to another institute.
 */
export const redirectHere = (path: string, status = 303) => new NextResponse(null, { status, headers: { Location: path } })
