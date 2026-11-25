package com.nexusflow.core;

import java.net.URI;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.auth.credentials.*;
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.*;
import static com.nexusflow.core.AuthController.status;

@Service
class ObjectStorage implements AutoCloseable {
    private final S3Client client;
    private final String bucket;
    private final boolean local;
    private boolean prepared;

    ObjectStorage(@Value("${NEXUS_S3_ENDPOINT:}") String endpoint,@Value("${NEXUS_S3_REGION:us-east-1}") String region,
        @Value("${NEXUS_S3_BUCKET:}") String bucket,@Value("${NEXUS_S3_ACCESS_KEY:}") String access,
        @Value("${NEXUS_S3_SECRET_KEY:}") String secret,@Value("${NEXUS_S3_CREATE_BUCKET:false}") boolean create) {
        this.bucket=bucket;
        this.local=create&&!endpoint.isBlank();
        if (bucket.isBlank()) {this.client=null;return;}
        var builder=S3Client.builder().region(Region.of(region))
            .overrideConfiguration(config->config.apiCallTimeout(Duration.ofSeconds(12)).apiCallAttemptTimeout(Duration.ofSeconds(6)));
        if (!endpoint.isBlank()) {
            builder.endpointOverride(URI.create(endpoint))
                .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).chunkedEncodingEnabled(false).build());
        }
        if (!access.isBlank()&&!secret.isBlank()) builder.credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(access,secret)));
        this.client=builder.build();
    }

    boolean configured() {return client!=null;}

    void put(String key,byte[] data,String mediaType) {
        prepare();
        client.putObject(r->r.bucket(bucket).key(key).contentType(mediaType),RequestBody.fromBytes(data));
    }

    byte[] get(String key) {
        if (client==null) throw status(HttpStatus.SERVICE_UNAVAILABLE,"Attachments are not configured.");
        return client.getObjectAsBytes(r->r.bucket(bucket).key(key)).asByteArray();
    }

    void delete(String key) {
        if (client!=null) client.deleteObject(r->r.bucket(bucket).key(key));
    }

    private synchronized void prepare() {
        if (client==null) throw status(HttpStatus.SERVICE_UNAVAILABLE,"Attachments are not configured.");
        if (prepared||!local) return;
        try {client.headBucket(r->r.bucket(bucket));}
        catch (NoSuchBucketException error) {create();}
        catch (S3Exception error) {if (error.statusCode()==404) create(); else throw error;}
        prepared=true;
    }

    private void create() {
        try {client.createBucket(r->r.bucket(bucket));}
        catch (BucketAlreadyOwnedByYouException ignored) {}
    }

    @Override public void close() {if (client!=null) client.close();}
}
