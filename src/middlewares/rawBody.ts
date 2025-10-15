import { Request } from "express";

// This function signature matches express.json 'verify' option
export function rawBodyMiddleware(req: Request, _res: unknown, buf: Buffer): void {
    req.rawBody = buf;
}
