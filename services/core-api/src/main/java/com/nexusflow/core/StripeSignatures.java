package com.nexusflow.core;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

final class StripeSignatures {
    private StripeSignatures() {}

    static boolean verify(byte[] payload,String header,String secret,Instant now) {
        if (header==null || header.length()>2048 || !secret.startsWith("whsec_")) return false;
        try {
            String stamp=null;
            List<String> signatures=new ArrayList<>();
            for (String part:header.split(",")) {
                var pair=part.strip().split("=",2);
                if (pair.length!=2) continue;
                if ("t".equals(pair[0])) {
                    if (stamp!=null) return false;
                    stamp=pair[1];
                } else if ("v1".equals(pair[0])) signatures.add(pair[1]);
            }
            if (stamp==null || signatures.isEmpty()) return false;
            Instant sent=Instant.ofEpochSecond(Long.parseLong(stamp));
            if (sent.isBefore(now.minusSeconds(300)) || sent.isAfter(now.plusSeconds(300))) return false;
            Mac mac=Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8),"HmacSHA256"));
            mac.update((stamp+".").getBytes(StandardCharsets.UTF_8));
            byte[] expected=mac.doFinal(payload);
            for (String signature:signatures) {
                if (signature.matches("[a-fA-F0-9]{64}") && MessageDigest.isEqual(expected,HexFormat.of().parseHex(signature))) return true;
            }
            return false;
        } catch (RuntimeException | java.security.GeneralSecurityException error) {
            return false;
        }
    }
}
