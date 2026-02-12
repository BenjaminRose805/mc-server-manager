import { promises as fs } from "node:fs";
import path from "node:path";
import forge from "node-forge";
import { logger } from "../utils/logger.js";

export interface TLSConfig {
  mode: "letsencrypt" | "custom" | "self-signed" | "disabled";
  domain?: string;
  email?: string;
  certPath?: string;
  keyPath?: string;
}

export async function setupTLS(
  config: TLSConfig,
  dataDir: string,
): Promise<{ cert: string; key: string } | null> {
  try {
    switch (config.mode) {
      case "letsencrypt":
        return await setupLetsEncrypt(config.domain!, config.email!, dataDir);
      case "custom":
        return await loadCustomCert(config.certPath!, config.keyPath!);
      case "self-signed":
        return await generateSelfSignedCert(dataDir);
      case "disabled":
        return null;
    }
  } catch (err) {
    logger.error(
      { err, mode: config.mode },
      "TLS setup failed, falling back to HTTP",
    );
    return null;
  }
}

export function isCertExpiringSoon(certPem: string): boolean {
  const cert = forge.pki.certificateFromPem(certPem);
  const expiryDate = cert.validity.notAfter;
  const daysRemaining =
    (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return daysRemaining < 30;
}

async function certExists(certPath: string, keyPath: string): Promise<boolean> {
  try {
    await fs.access(certPath);
    await fs.access(keyPath);
    return true;
  } catch {
    return false;
  }
}

// ACME / Let's Encrypt flow:
// 1. Check for existing valid cert on disk
// 2. If missing or expiring, provision new cert via HTTP-01 challenge
// 3. Challenge files are written to {dataDir}/acme-challenge/ and served by the ACME route
async function setupLetsEncrypt(
  domain: string,
  email: string,
  dataDir: string,
): Promise<{ cert: string; key: string }> {
  const certDir = path.join(dataDir, "certs", domain);
  await fs.mkdir(certDir, { recursive: true });

  const certPath = path.join(certDir, "cert.pem");
  const keyPath = path.join(certDir, "key.pem");

  if (await certExists(certPath, keyPath)) {
    const cert = await fs.readFile(certPath, "utf-8");
    const key = await fs.readFile(keyPath, "utf-8");

    if (!isCertExpiringSoon(cert)) {
      logger.info({ domain }, "Using existing Let's Encrypt certificate");
      return { cert, key };
    }
    logger.info({ domain }, "Certificate expiring soon, renewing");
  }

  // @root/acme is a CommonJS module without type declarations
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ACME =
    (await import("@root/acme")).default || (await import("@root/acme"));
  const Keypairs =
    (await import("@root/keypairs")).default ||
    (await import("@root/keypairs"));
  const CSR =
    (await import("@root/csr")).default || (await import("@root/csr"));

  const acme = ACME.create({
    maintainerEmail: email,
    packageAgent: "mc-server-manager/1.0",
    notify: (ev: string, msg: unknown) => {
      logger.info({ event: ev, message: msg }, "ACME event");
    },
  });

  await acme.init("https://acme-v02.api.letsencrypt.org/directory");

  // Generate account keypair and register
  const accountKeypair = await Keypairs.generate({ kty: "EC", format: "jwk" });
  const accountKey = accountKeypair.private;

  const account = await acme.accounts.create({
    subscriberEmail: email,
    agreeToTerms: true,
    accountKey,
  });

  // Generate server keypair for the certificate
  const serverKeypair = await Keypairs.generate({ kty: "RSA", format: "jwk" });
  const serverKey = serverKeypair.private;
  const serverKeyPem: string = await Keypairs.export({ jwk: serverKey });

  // Create CSR
  const encoding = await CSR.csr({
    jwk: serverKey,
    domains: [domain],
    encoding: "der",
  });
  const csr = encoding.der;

  // Challenge dir for HTTP-01 tokens
  const challengeDir = path.join(dataDir, "acme-challenge");
  await fs.mkdir(challengeDir, { recursive: true });

  const pems = await acme.certificates.create({
    account,
    accountKey,
    csr,
    domains: [domain],
    challenges: {
      "http-01": {
        set: async (opts: { token: string; keyAuthorization: string }) => {
          await fs.writeFile(
            path.join(challengeDir, opts.token),
            opts.keyAuthorization,
          );
        },
        remove: async (opts: { token: string }) => {
          await fs.unlink(path.join(challengeDir, opts.token)).catch(() => {});
        },
      },
    },
  });

  const fullchain = pems.cert + "\n" + pems.chain + "\n";
  await fs.writeFile(certPath, fullchain);
  await fs.writeFile(keyPath, serverKeyPem);

  logger.info({ domain }, "Let's Encrypt certificate provisioned");
  return { cert: fullchain, key: serverKeyPem };
}

async function loadCustomCert(
  certPath: string,
  keyPath: string,
): Promise<{ cert: string; key: string }> {
  const cert = await fs.readFile(certPath, "utf-8");
  const key = await fs.readFile(keyPath, "utf-8");
  logger.info({ certPath, keyPath }, "Loaded custom TLS certificate");
  return { cert, key };
}

async function generateSelfSignedCert(
  dataDir: string,
): Promise<{ cert: string; key: string }> {
  const certDir = path.join(dataDir, "certs", "self-signed");
  await fs.mkdir(certDir, { recursive: true });

  const certPath = path.join(certDir, "cert.pem");
  const keyPath = path.join(certDir, "key.pem");

  if (await certExists(certPath, keyPath)) {
    const existingCert = await fs.readFile(certPath, "utf-8");
    const existingKey = await fs.readFile(keyPath, "utf-8");

    if (!isCertExpiringSoon(existingCert)) {
      logger.warn(
        "Using existing self-signed certificate (not trusted by browsers)",
      );
      return { cert: existingCert, key: existingKey };
    }
  }

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  const attrs: forge.pki.CertificateField[] = [
    { name: "commonName", value: "localhost" },
    { name: "organizationName", value: "MC Server Manager" },
  ];

  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    {
      name: "subjectAltName",
      altNames: [
        { type: 2, value: "localhost" },
        { type: 7, ip: "127.0.0.1" },
      ],
    },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

  await fs.writeFile(certPath, certPem);
  await fs.writeFile(keyPath, keyPem);

  logger.warn("Generated self-signed certificate (not trusted by browsers)");
  return { cert: certPem, key: keyPem };
}
