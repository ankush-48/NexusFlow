package com.nexusflow.gateway;

import java.net.InetSocketAddress;
import java.util.List;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

class ClientAddressTest {
    private final InetSocketAddress peer = new InetSocketAddress("127.0.0.1", 12345);

    @Test void directInstallUsesItsTcpPeer() {
        assertEquals("127.0.0.1", GatewayApplication.clientAddress(peer, List.of("192.0.2.9"), false));
    }

    @Test void privateIngressAcceptsOneCanonicalClientAddress() {
        assertEquals("192.0.2.9", GatewayApplication.clientAddress(peer, List.of("192.0.2.9"), true));
        assertEquals("2001:db8::1", GatewayApplication.clientAddress(peer, List.of("2001:0db8:0:0:0:0:0:1"), true));
    }

    @Test void ambiguousOrMissingIngressIdentityUsesThePeer() {
        for (List<String> values : List.of(List.<String>of(),List.of("localhost"),List.of("invalid"),
                List.of("192.0.2.3","192.0.2.4"),List.of("192.0.2.3, 192.0.2.4"))) {
            assertEquals("127.0.0.1", GatewayApplication.clientAddress(peer, values, true));
        }
    }
}
