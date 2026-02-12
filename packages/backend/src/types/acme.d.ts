declare module "@root/acme" {
  interface ACMEOptions {
    maintainerEmail: string;
    packageAgent: string;
    notify?: (event: string, details: unknown) => void;
  }

  interface AccountCreateOptions {
    subscriberEmail: string;
    agreeToTerms: boolean;
    accountKey: unknown;
  }

  interface Http01Challenge {
    set: (opts: { token: string; keyAuthorization: string }) => Promise<void>;
    remove: (opts: { token: string }) => Promise<void>;
  }

  interface CertificateCreateOptions {
    account: unknown;
    accountKey: unknown;
    csr: unknown;
    domains: string[];
    challenges: {
      "http-01"?: Http01Challenge;
    };
  }

  interface CertificateResult {
    cert: string;
    chain: string;
  }

  interface ACMEInstance {
    init(directoryUrl: string): Promise<void>;
    accounts: {
      create(options: AccountCreateOptions): Promise<unknown>;
    };
    certificates: {
      create(options: CertificateCreateOptions): Promise<CertificateResult>;
    };
  }

  interface ACME {
    create(options: ACMEOptions): ACMEInstance;
  }

  const acme: ACME;
  export default acme;
}

declare module "@root/keypairs" {
  interface KeypairResult {
    private: unknown;
    public: unknown;
  }

  interface Keypairs {
    generate(options: { kty: string; format: string }): Promise<KeypairResult>;
    export(options: { jwk: unknown }): Promise<string>;
  }

  const keypairs: Keypairs;
  export default keypairs;
}

declare module "@root/csr" {
  interface CSRResult {
    der: unknown;
  }

  interface CSR {
    csr(options: {
      jwk: unknown;
      domains: string[];
      encoding: string;
    }): Promise<CSRResult>;
  }

  const csr: CSR;
  export default csr;
}
