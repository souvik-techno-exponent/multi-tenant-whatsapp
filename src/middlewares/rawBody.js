// middleware to capture raw body buffer for signature verification
export function rawBodyMiddleware(req, _res, buf) {
    req.rawBody = buf;
}
