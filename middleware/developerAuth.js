/**
 * developerAuth.js
 * -----------------
 * Middleware that restricts access to developer-only endpoints.
 * The caller must pass the correct secret key in the request header:
 *
 *   Header:  x-developer-key: <DEVELOPER_SECRET_KEY from .env>
 *
 * This is completely separate from org-admin JWT auth.
 * Only the developer (who controls the .env) knows this key.
 */

const developerAuth = (req, res, next) => {
    const providedKey = req.headers["x-developer-key"];
    const expectedKey = process.env.DEVELOPER_SECRET_KEY;

    if (!expectedKey) {
        console.error("❌ DEVELOPER_SECRET_KEY is not set in .env");
        return res.status(500).json({ message: "Server misconfiguration: developer key not set." });
    }

    if (!providedKey || providedKey !== expectedKey) {
        return res.status(403).json({ message: "Forbidden: invalid or missing developer key." });
    }

    next();
};

module.exports = developerAuth;
