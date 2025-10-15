// capture raw body buffer for webhook signature verification
export function rawBodyMiddleware(req, _res, buf) {
    req.rawBody = buf;
}
