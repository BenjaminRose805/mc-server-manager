import natUpnp from "nat-upnp";
import { logger } from "../utils/logger.js";

const client = natUpnp.createClient();

export async function setupPortForwarding(port: number): Promise<boolean> {
  try {
    await client.portMapping({
      public: port,
      private: port,
      ttl: 0,
      description: "MC Server Manager",
    });
    logger.info({ port }, "UPnP port mapping created");
    return true;
  } catch (error) {
    logger.warn({ error, port }, "UPnP port mapping failed");
    return false;
  }
}

export async function removePortForwarding(port: number): Promise<void> {
  try {
    await client.portUnmapping({ public: port });
    logger.info({ port }, "UPnP port mapping removed");
  } catch (error) {
    logger.warn({ error, port }, "UPnP port unmapping failed");
  }
}
