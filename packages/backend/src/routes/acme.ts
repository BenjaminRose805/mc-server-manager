import { Router } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export const acmeRouter = Router();

const TOKEN_REGEX = /^[a-zA-Z0-9_-]+$/;

acmeRouter.get("/.well-known/acme-challenge/:token", async (req, res) => {
  const { token } = req.params;

  if (!TOKEN_REGEX.test(token)) {
    return res.status(400).send("Invalid token");
  }

  try {
    const filePath = path.join(config.dataDir, "acme-challenge", token);
    const content = await fs.readFile(filePath, "utf-8");
    res.type("text/plain").send(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return res.status(404).send("Challenge not found");
    }
    throw error;
  }
});
