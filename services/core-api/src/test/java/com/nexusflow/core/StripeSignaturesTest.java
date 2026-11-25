package com.nexusflow.core;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

class StripeSignaturesTest {
    private static final String SECRET="whsec_automated_test_only";
    private static final Instant TIME=Instant.ofEpochSecond(1_800_000_000L);

    @Test
    void verifiesExactBytesAndAcceptsRotatedSigningHeaders() throws Exception {
        byte[] body="{ \"id\": \"evt_test\" }".getBytes(StandardCharsets.UTF_8);
        String signature=sign(body,TIME.getEpochSecond());
        assertTrue(StripeSignatures.verify(body,"t="+TIME.getEpochSecond()+",v1="+"a".repeat(64)+",v1="+signature,SECRET,TIME));
        assertFalse(StripeSignatures.verify("{}".getBytes(StandardCharsets.UTF_8),"t="+TIME.getEpochSecond()+",v1="+signature,SECRET,TIME));
    }

    @Test
    void rejectsStaleAndMalformedSignatures() throws Exception {
        byte[] payload={1,2,3};
        var stale=TIME.minusSeconds(301).getEpochSecond();
        assertFalse(StripeSignatures.verify(payload,"t="+stale+",v1="+sign(payload,stale),SECRET,TIME));
        assertFalse(StripeSignatures.verify(payload,"t=oops,v1=deadbeef",SECRET,TIME));
        assertFalse(StripeSignatures.verify(payload,null,SECRET,TIME));
    }

    @Test
    void detectsMismatchedAttachmentContent() {
        byte[] png={(byte)0x89,80,78,71,13,10,26,10};
        assertEquals("image/png",AttachmentController.mediaType("status.png",png));
        assertThrows(ResponseStatusException.class,()->AttachmentController.mediaType("status.pdf",png));
        assertThrows(ResponseStatusException.class,()->AttachmentController.mediaType("status.html","<h1>test</h1>".getBytes(StandardCharsets.UTF_8)));
    }

    private static String sign(byte[] body,long timestamp) throws Exception {
        Mac mac=Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(SECRET.getBytes(StandardCharsets.UTF_8),"HmacSHA256"));
        mac.update((timestamp+".").getBytes(StandardCharsets.UTF_8));
        return HexFormat.of().formatHex(mac.doFinal(body));
    }
}
