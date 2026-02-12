import rateLimit from "express-rate-limit";

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Too many authentication attempts, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "GET",
});

export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: "Too many requests, please slow down",
  standardHeaders: true,
  legacyHeaders: false,
});
