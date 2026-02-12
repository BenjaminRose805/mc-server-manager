declare module "nat-upnp" {
  interface PortMappingOptions {
    public: number;
    private: number;
    ttl?: number;
    description?: string;
  }

  interface PortUnmappingOptions {
    public: number;
  }

  interface NatUpnpClient {
    portMapping(options: PortMappingOptions): Promise<void>;
    portUnmapping(options: PortUnmappingOptions): Promise<void>;
  }

  function createClient(): NatUpnpClient;

  export { createClient };
}
